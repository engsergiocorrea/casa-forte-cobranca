import { db } from "../db";
import { env } from "../env";
import { sienge } from "../sienge/client";
import { normalizeInstallmentsList, normalizePaymentSlip, normalizeCustomerPhones } from "../sienge/mapper";
import { daysFromDue } from "./date";
import { previewMensagem, type EtapaRegua } from "./messages";
import { canSendTo } from "../safety";
import { evolutionSendText, evolutionSendDocument } from "../whatsapp/evolution";

// Régua de cobrança AUTOMÁTICA — lê direto do Sienge (mesma fonte do envio
// manual comprovado) e dispara por Evolution, SEMPRE atrás da trava canSendTo.
// Idempotente: grava cada envio em CollectionSend (dedupeKey) e não reenvia a
// mesma etapa/parcela/vencimento já ENVIADA. Cada parcela casa com uma etapa
// só no dia exato (offset -10/0/+1), então o volume por dia é naturalmente
// limitado e cada estágio dispara uma vez.

const fmtBRL = (n: number) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (d: Date) => isNaN(+d) ? "" : d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
const ymd = (d: Date) => (isNaN(+d) ? "" : d.toISOString().slice(0, 10));
const offsetDe = (e: EtapaRegua) => (e === "D-10" ? -10 : e === "D0" ? 0 : 1);
const etapaDe = (o: number): EtapaRegua | null => (o === -10 ? "D-10" : o === 0 ? "D0" : o === 1 ? "D+1" : null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ReguaSummary = {
  provider: string;
  contratos: number; elegiveis: number;
  enviados: number; dryRun: number; bloqueados: number; semTelefone: number; jaEnviados: number; erros: number;
  skipped?: string;
};

// Garante que as 3 etapas da régua (D-10/D0/D+1) existam no banco, SEM alterar
// o `enabled` de quem já existe. Substitui o seed (que não roda no deploy) e
// deixa os botões de liga/desliga sempre disponíveis no painel.
export async function ensureCollectionRules() {
  const defs = [
    { name: "D-10", dayOffset: -10, templateName: process.env.WA_TEMPLATE_D_MINUS_10 || "cf_cobranca_d_menos_10" },
    { name: "D0", dayOffset: 0, templateName: process.env.WA_TEMPLATE_DUE_TODAY || "cf_cobranca_vence_hoje" },
    { name: "D+1", dayOffset: 1, templateName: process.env.WA_TEMPLATE_D_PLUS_1 || "cf_cobranca_atraso_1d" },
  ];
  for (const d of defs) {
    await db.collectionRule.upsert({
      where: { name: d.name },
      update: {}, // não mexe em enabled/sendHour do que já existe
      create: { ...d, enabled: false, languageCode: process.env.WA_TEMPLATE_LANGUAGE || "pt_BR", sendHour: 9 },
    });
  }
}

export async function runReguaFromSienge(now = new Date()): Promise<ReguaSummary> {
  const e = env();
  const base: ReguaSummary = { provider: e.WHATSAPP_PROVIDER, contratos: 0, elegiveis: 0, enviados: 0, dryRun: 0, bloqueados: 0, semTelefone: 0, jaEnviados: 0, erros: 0 };

  await ensureCollectionRules();
  const rules = await db.collectionRule.findMany({ where: { enabled: true } });
  const offsets = new Set(rules.map((r) => r.dayOffset));
  if (!offsets.size) return { ...base, skipped: "nenhuma_regra_ativa" };

  const allowlist = e.WHATSAPP_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean);

  // Contratos ativos do Sienge (paginado, teto defensivo).
  const contratos: any[] = [];
  for (let off = 0; off < 1000; off += 200) {
    const raw = await sienge.listSalesContracts(200, off);
    const page = (Array.isArray(raw) ? raw : (raw?.results ?? raw?.data ?? [])) as any[];
    contratos.push(...page);
    if (page.length < 200) break;
  }

  for (const c of contratos) {
    if (/cancel/i.test(String(c?.situation ?? ""))) continue;
    const billId = Number(c?.receivableBillId);
    if (!billId) continue;
    base.contratos++;

    const empreend = String(c?.enterpriseName ?? "");
    const unidades = (Array.isArray(c?.salesContractUnits) ? c.salesContractUnits : []).map((u: any) => u?.name).filter(Boolean);
    const imovel = `${empreend}${unidades.length ? " — " + unidades.join(", ") : ""}`;
    const cli = (Array.isArray(c?.salesContractCustomers) ? c.salesContractCustomers : [])[0];
    const nome = String(cli?.name ?? "cliente").trim().split(/\s+/)[0];
    const customerId = Number(cli?.id ?? cli?.customerId) || null;

    let parcelas;
    try { parcelas = normalizeInstallmentsList(await sienge.getInstallments(billId)); }
    catch { base.erros++; continue; }

    // telefone e boleto só são buscados quando há parcela elegível.
    let phone: string | null = null;

    for (const p of parcelas) {
      const etapa = etapaDe(daysFromDue(now, p.dueDate, e.TIMEZONE));
      if (!etapa || !offsets.has(offsetDe(etapa))) continue;
      if (p.paid || p.balanceDue <= 0) continue;
      base.elegiveis++;

      const dedupeKey = `${billId}:${p.installmentId}:${etapa}:${ymd(p.dueDate)}`;
      const existing = await db.collectionSend.findUnique({ where: { dedupeKey } });
      if (existing?.status === "SENT") { base.jaEnviados++; continue; }

      if (phone === null && customerId) {
        try { phone = normalizeCustomerPhones(await sienge.getCustomer(customerId))[0]?.numero ?? ""; }
        catch { phone = ""; }
      }
      const numero = phone ?? "";

      let boleto: { url: string | null; linhaDigitavel: string | null } = { url: null, linhaDigitavel: null };
      try { boleto = normalizePaymentSlip(await sienge.getPaymentSlip(billId, p.installmentId)); } catch { /* segue sem boleto */ }

      const dados = { nome, imovel, vencimento: fmtData(p.dueDate), valor: fmtBRL(p.balanceDue) };
      const texto = `${previewMensagem(etapa, dados)}${boleto.url ? `\n\nBoleto: ${boleto.url}` : ""}${boleto.linhaDigitavel ? `\nLinha digitável: ${boleto.linhaDigitavel}` : ""}`;

      let status = "", motivo: string | null = null, messageId: string | null = null, boletoSent = false, detail: string | null = null;

      if (!numero) { status = "NO_PHONE"; base.semTelefone++; }
      else {
        const gate = canSendTo(numero, {
          appMode: e.APP_MODE, outboundEnabled: e.OUTBOUND_MESSAGING_ENABLED, dryRun: e.WHATSAPP_DRY_RUN,
          allowAllProduction: e.WHATSAPP_ALLOW_ALL_PRODUCTION, allowlist,
        });
        if (!gate.allowed) {
          motivo = gate.reason;
          if (gate.reason === "DRY_RUN" || gate.reason === "MASTER_SWITCH_OFF") { status = "DRY_RUN"; base.dryRun++; }
          else { status = "BLOCKED"; base.bloqueados++; }
        } else {
          const r = await evolutionSendText({ to: numero, text: texto });
          if (!r.success) { status = "ERROR"; detail = String(r.error ?? "").slice(0, 200); base.erros++; }
          else {
            messageId = r.messageId; status = "SENT"; base.enviados++;
            if (boleto.url) {
              const doc = await evolutionSendDocument({ to: numero, mediaUrl: boleto.url, fileName: `boleto-${p.installmentId}.pdf`, caption: `Boleto — ${imovel}` });
              boletoSent = !!doc.success;
            }
            await sleep(1200); // throttle entre envios reais (evita flood/ban)
          }
        }
      }

      await db.collectionSend.upsert({
        where: { dedupeKey },
        update: { status, motivo, messageId, boletoSent, detail, phone: numero, valor: p.balanceDue, etapa, dueDate: p.dueDate },
        create: { dedupeKey, billId, installmentId: p.installmentId, etapa, dueDate: p.dueDate, valor: p.balanceDue, phone: numero, status, motivo, messageId, boletoSent, detail },
      });
    }
  }

  return base;
}

// ---------------------------------------------------------------------------
// Cobrança de INADIMPLÊNCIA (manual e curada): lista todos os inadimplentes e
// envia lembrete só para os que o usuário marcar. Mesmo motor/travas do resto.
// ---------------------------------------------------------------------------

export type Inadimplente = {
  billId: number; installmentId: number; numero: string | null;
  empreendimento: string; imovel: string; clienteNome: string | null; customerId: number | null;
  vencimento: string; diasAtraso: number; saldo: number; saldoFmt: string; boletoGerado: boolean;
};

// Varre os contratos do Sienge e devolve as parcelas VENCIDAS em aberto
// (saldo > 0 e dias de atraso > 0), ordenadas do maior atraso p/ o menor.
export async function listarInadimplentes(now = new Date()): Promise<Inadimplente[]> {
  const e = env();
  const contratos: any[] = [];
  for (let off = 0; off < 1000; off += 200) {
    const raw = await sienge.listSalesContracts(200, off);
    const page = (Array.isArray(raw) ? raw : (raw?.results ?? raw?.data ?? [])) as any[];
    contratos.push(...page);
    if (page.length < 200) break;
  }
  const ativos = contratos.filter((c) => Number(c?.receivableBillId) && !/cancel/i.test(String(c?.situation ?? "")));

  const listas = await Promise.all(ativos.map(async (c): Promise<Inadimplente[]> => {
    const billId = Number(c.receivableBillId);
    let parcelas;
    try { parcelas = normalizeInstallmentsList(await sienge.getInstallments(billId)); } catch { return []; }
    const empreendimento = String(c?.enterpriseName ?? "");
    const unidades = (Array.isArray(c?.salesContractUnits) ? c.salesContractUnits : []).map((u: any) => u?.name).filter(Boolean);
    const imovel = `${empreendimento}${unidades.length ? " — " + unidades.join(", ") : ""}`;
    const cli = (Array.isArray(c?.salesContractCustomers) ? c.salesContractCustomers : [])[0];
    const clienteNome = cli?.name ?? null;
    const customerId = Number(cli?.id ?? cli?.customerId) || null;
    return parcelas
      .map((p) => ({ p, atraso: daysFromDue(now, p.dueDate, e.TIMEZONE) }))
      .filter(({ p, atraso }) => !p.paid && p.balanceDue > 0 && atraso > 0)
      .map(({ p, atraso }) => ({
        billId, installmentId: p.installmentId, numero: c?.number ?? String(c?.id ?? ""),
        empreendimento, imovel, clienteNome, customerId,
        vencimento: fmtData(p.dueDate), diasAtraso: atraso, saldo: p.balanceDue, saldoFmt: fmtBRL(p.balanceDue),
        boletoGerado: p.generatedBoleto,
      }));
  }));
  return listas.flat().sort((a, b) => b.diasAtraso - a.diasAtraso);
}

export type ItemLembrete = { billId: number; installmentId: number; customerId?: number; nome?: string; imovel?: string; to?: string };

// Prepara UM lembrete (mesma base para a prévia e o envio real, garantindo que
// o que você revisa é idêntico ao que sai): revalida a parcela no Sienge,
// resolve o telefone do cadastro e monta a mensagem de atraso (D+1) + boleto.
type LembretePronto = {
  billId: number; installmentId: number; numero: string; saldo: number; dueDate: Date;
  dados: { nome: string; imovel: string; vencimento: string; valor: string };
  texto: string; boletoUrl: string | null;
};
async function prepararLembrete(it: ItemLembrete): Promise<{ skip: string } | LembretePronto> {
  const billId = Number(it.billId), installmentId = Number(it.installmentId);
  const rows = normalizeInstallmentsList(await sienge.getInstallments(billId));
  const p = rows.find((r) => r.installmentId === installmentId);
  if (!p) return { skip: "NAO_ENCONTRADA" };
  if (p.paid || p.balanceDue <= 0) return { skip: "PAGA" };

  let numero = String(it.to ?? "").trim();
  if (!numero && it.customerId) {
    try { numero = normalizeCustomerPhones(await sienge.getCustomer(it.customerId))[0]?.numero ?? ""; } catch { /* sem telefone */ }
  }
  let boleto: { url: string | null; linhaDigitavel: string | null } = { url: null, linhaDigitavel: null };
  try { boleto = normalizePaymentSlip(await sienge.getPaymentSlip(billId, installmentId)); } catch { /* segue sem boleto */ }

  const nome = String(it.nome ?? "cliente").trim().split(/\s+/)[0];
  const dados = { nome, imovel: String(it.imovel ?? ""), vencimento: fmtData(p.dueDate), valor: fmtBRL(p.balanceDue) };
  const texto = `${previewMensagem("D+1", dados)}${boleto.url ? `\n\nBoleto: ${boleto.url}` : ""}${boleto.linhaDigitavel ? `\nLinha digitável: ${boleto.linhaDigitavel}` : ""}`;
  return { billId, installmentId, numero, saldo: p.balanceDue, dueDate: p.dueDate, dados, texto, boletoUrl: boleto.url };
}

// Trava do envio MANUAL (revisado): NÃO usa allowlist — a revisão + confirmação
// do usuário é a segurança. Depende só das travas-mestras (master switch e
// dry-run). A allowlist continua valendo só na régua AUTOMÁTICA (sem revisão).
function canSendManual(e: ReturnType<typeof env>): { allowed: boolean; reason: "PERMITIDO" | "MASTER_SWITCH_OFF" | "DRY_RUN" } {
  if (!e.OUTBOUND_MESSAGING_ENABLED) return { allowed: false, reason: "MASTER_SWITCH_OFF" };
  if (e.WHATSAPP_DRY_RUN) return { allowed: false, reason: "DRY_RUN" };
  return { allowed: true, reason: "PERMITIDO" };
}

function gateReason(numero: string, e: ReturnType<typeof env>) {
  if (!numero) return { enviaria: false, motivo: "NO_PHONE" as const };
  const g = canSendManual(e);
  return { enviaria: g.allowed, motivo: g.reason };
}

// PRÉVIA (não envia nada): monta, para cada parcela marcada, quem receberia, o
// telefone e a mensagem exata — para você CONFERIR os clientes antes do envio.
export async function preverLembretes(itens: ItemLembrete[]) {
  const e = env();
  const previews: any[] = [];
  for (const it of itens) {
    const billId = Number(it.billId), installmentId = Number(it.installmentId);
    try {
      const r = await prepararLembrete(it);
      if ("skip" in r) { previews.push({ billId, installmentId, nome: it.nome ?? null, enviaria: false, motivo: r.skip }); continue; }
      const g = gateReason(r.numero, e);
      previews.push({
        billId, installmentId, nome: r.dados.nome, telefone: r.numero || null,
        imovel: r.dados.imovel, vencimento: r.dados.vencimento, saldoFmt: r.dados.valor,
        temBoleto: !!r.boletoUrl, mensagem: r.texto, enviaria: g.enviaria, motivo: g.motivo,
      });
    } catch (err: any) {
      previews.push({ billId, installmentId, enviaria: false, motivo: "ERRO", detail: String(err?.message ?? err).slice(0, 200) });
    }
  }
  const enviaraveis = previews.filter((p) => p.enviaria).length;
  return { total: itens.length, enviaraveis, previews };
}

// ENVIO REAL (o último comando é do usuário). Revalida no Sienge, passa por
// canSendTo e registra em CollectionSend.
export async function enviarLembretes(itens: ItemLembrete[], now = new Date()) {
  const e = env();
  const resultados: any[] = [];

  for (const it of itens) {
    const billId = Number(it.billId), installmentId = Number(it.installmentId);
    try {
      const prep = await prepararLembrete(it);
      if ("skip" in prep) { resultados.push({ billId, installmentId, status: prep.skip }); continue; }
      const { numero, texto, boletoUrl, saldo, dueDate, dados } = prep;

      let status = "", motivo: string | null = null, messageId: string | null = null, boletoSent = false, detail: string | null = null;
      if (!numero) { status = "NO_PHONE"; }
      else {
        const gate = canSendManual(e); // manual revisado: sem allowlist, só travas-mestras
        if (!gate.allowed) { motivo = gate.reason; status = "DRY_RUN"; }
        else {
          const r = await evolutionSendText({ to: numero, text: texto });
          if (!r.success) { status = "ERROR"; detail = String(r.error ?? "").slice(0, 200); }
          else {
            messageId = r.messageId; status = "SENT";
            if (boletoUrl) { const d = await evolutionSendDocument({ to: numero, mediaUrl: boletoUrl, fileName: `boleto-${installmentId}.pdf`, caption: `Boleto — ${dados.imovel}` }); boletoSent = !!d.success; }
            await sleep(1200);
          }
        }
      }
      await db.collectionSend.upsert({
        where: { dedupeKey: `manual:${billId}:${installmentId}:${ymd(now)}` },
        update: { status, motivo, messageId, boletoSent, detail, phone: numero, valor: saldo, etapa: "D+1", dueDate },
        create: { dedupeKey: `manual:${billId}:${installmentId}:${ymd(now)}`, billId, installmentId, etapa: "D+1", dueDate, valor: saldo, phone: numero, status, motivo, messageId, boletoSent, detail },
      });
      resultados.push({ billId, installmentId, nome: dados.nome, status, motivo, boletoSent });
    } catch (err: any) {
      resultados.push({ billId, installmentId, status: "ERRO", detail: String(err?.message ?? err).slice(0, 200) });
    }
  }

  const contagem = resultados.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {} as Record<string, number>);
  return { total: itens.length, contagem, resultados };
}
