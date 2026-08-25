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

export async function runReguaFromSienge(now = new Date()): Promise<ReguaSummary> {
  const e = env();
  const base: ReguaSummary = { provider: e.WHATSAPP_PROVIDER, contratos: 0, elegiveis: 0, enviados: 0, dryRun: 0, bloqueados: 0, semTelefone: 0, jaEnviados: 0, erros: 0 };

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
