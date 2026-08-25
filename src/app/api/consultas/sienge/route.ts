import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sienge, siengePing, extractCount } from "@/lib/sienge/client";
import { normalizeReceivableBill, normalizeInstallmentsList, normalizePaymentSlip, normalizeCustomerPhones } from "@/lib/sienge/mapper";
import { daysFromDue } from "@/lib/collection/date";
import { previewMensagem, templateNameFor, type EtapaRegua } from "@/lib/collection/messages";
import { sendWhatsAppTemplate } from "@/lib/whatsapp/client";
import { getTemplateInfo } from "@/lib/whatsapp/templates";
import { evolutionSendText, evolutionSendDocument } from "@/lib/whatsapp/evolution";
import { canSendTo } from "@/lib/safety";
import { runReguaFromSienge } from "@/lib/collection/regua";
import { db } from "@/lib/db";
import { redact, redactText } from "@/lib/redact";

const WA_LANG = () => process.env.WA_TEMPLATE_LANGUAGE || "pt_BR";

const fmtBRL = (n: number) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (d: Date) => isNaN(+d) ? "" : d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
const etapaDe = (offset: number): EtapaRegua | null => offset === -10 ? "D-10" : offset === 0 ? "D0" : offset === 1 ? "D+1" : null;

export const dynamic = "force-dynamic";

// Backend da página /consultas (staging).
// - READ-ONLY: apenas GETs ao Sienge; nunca POST/PUT/PATCH/DELETE.
// - Só em APP_MODE=staging.
// - Exige que o Basic Auth do painel esteja CONFIGURADO (DASHBOARD_BASIC_USER/
//   PASS). O middleware faz a autenticação; aqui garantimos que ela não está
//   desligada por falta de configuração.
// - Todo payload sai REDIGIDO (CPF/CNPJ/e-mail/telefone mascarados). A
//   estrutura (chaves) fica intacta para cristalizarmos o mapper.
// - Nunca retorna credenciais/headers.

function guard(): NextResponse | null {
  if (env().APP_MODE !== "staging") {
    return NextResponse.json({ ok: false, error: "only_staging" }, { status: 403 });
  }
  if (!process.env.DASHBOARD_BASIC_USER || !process.env.DASHBOARD_BASIC_PASS) {
    return NextResponse.json(
      { ok: false, error: "painel_sem_senha", detail: "Defina DASHBOARD_BASIC_USER e DASHBOARD_BASIC_PASS nas Variables do Railway para liberar as consultas." },
      { status: 403 },
    );
  }
  return null;
}

const clampLimit = (v: string | null) => Math.min(Math.max(Number(v ?? 5) || 5, 1), 20);

export async function GET(req: NextRequest) {
  const blocked = guard();
  if (blocked) return blocked;

  const q = req.nextUrl.searchParams;
  const action = q.get("action") ?? "status";

  try {
    if (action === "status") {
      const [customers, contracts, units] = await Promise.all([
        siengePing("/customers?limit=1"),
        siengePing("/sales-contracts?limit=1"),
        siengePing("/units?limit=1"),
      ]);
      return NextResponse.json({ ok: true, action, status: { customers, contracts, units } });
    }

    // Clientes agrupados por empreendimento (via contratos de venda — read-only).
    if (action === "empreendimentos") {
      const raw = await sienge.listSalesContracts(200, 0);
      const contratos = (Array.isArray(raw) ? raw : raw?.results ?? raw?.data ?? []) as any[];
      const grupos = new Map<string, any>();
      for (const c of contratos) {
        const nome = String(c?.enterpriseName ?? "(sem empreendimento)");
        if (!grupos.has(nome)) grupos.set(nome, { empreendimento: nome, enterpriseId: c?.enterpriseId ?? null, contratos: [] });
        grupos.get(nome).contratos.push({
          contratoId: c?.id ?? null,
          numero: c?.number ?? null,
          situacao: c?.situation ?? null,
          valor: c?.totalSellingValue ?? c?.value ?? null,
          receivableBillId: c?.receivableBillId ?? null,
          dataContrato: c?.contractDate ?? null,
          clientes: (Array.isArray(c?.salesContractCustomers) ? c.salesContractCustomers : [])
            .map((x: any) => ({ nome: x?.name ?? null, customerId: Number(x?.id ?? x?.customerId) || null, principal: !!x?.main, conjuge: !!x?.spouse })),
          unidades: (Array.isArray(c?.salesContractUnits) ? c.salesContractUnits : [])
            .map((x: any) => x?.name).filter(Boolean),
        });
      }
      const lista = [...grupos.values()].sort((a, b) => a.empreendimento.localeCompare(b.empreendimento));
      // redige por segurança (nomes ficam visíveis; CPF/e-mail/telefone não vêm aqui).
      return NextResponse.json({ ok: true, action, empreendimentos: redact(lista) });
    }

    if (action === "customers" || action === "sales-contracts" || action === "units") {
      const limit = clampLimit(q.get("limit"));
      const offset = Math.max(Number(q.get("offset") ?? 0) || 0, 0);
      const fn = action === "customers" ? sienge.listCustomers : action === "sales-contracts" ? sienge.listSalesContracts : sienge.listUnits;
      const raw = await fn(limit, offset);
      return NextResponse.json({ ok: true, action, count: extractCount(raw), payload: redact(raw) });
    }

    if (action === "customer") {
      const id = Number(q.get("id"));
      if (!id) return NextResponse.json({ ok: false, error: "informe_id" }, { status: 400 });
      const raw = await sienge.getCustomer(id);
      return NextResponse.json({ ok: true, action, payload: redact(raw) });
    }

    if (action === "contract") {
      const id = Number(q.get("id"));
      if (!id) return NextResponse.json({ ok: false, error: "informe_id" }, { status: 400 });
      const raw = await sienge.getSalesContract(id);
      return NextResponse.json({ ok: true, action, payload: redact(raw) });
    }

    if (action === "bill") {
      const billId = Number(q.get("billId"));
      if (!billId) return NextResponse.json({ ok: false, error: "informe_billId" }, { status: 400 });
      const installmentId = Number(q.get("installmentId"));
      const raw = await sienge.getReceivableBill(billId);
      // Visão normalizada (mapper defensivo) ao lado do payload redigido — é a
      // comparação que usaremos para cristalizar os tipos com dados reais.
      let normalized: unknown = null;
      try { normalized = redact(normalizeReceivableBill(raw, installmentId)); } catch { normalized = null; }
      return NextResponse.json({ ok: true, action, payload: redact(raw), normalized });
    }

    // Parcelas de um título, com a etapa da régua (D-10/D0/D+1) de HOJE.
    if (action === "parcelas") {
      const billId = Number(q.get("billId"));
      if (!billId) return NextResponse.json({ ok: false, error: "informe_billId" }, { status: 400 });
      const rows = normalizeInstallmentsList(await sienge.getInstallments(billId));
      const now = new Date();
      const parcelas = rows.map((r) => {
        const etapa = etapaDe(daysFromDue(now, r.dueDate, env().TIMEZONE));
        return {
          installmentId: r.installmentId,
          vencimento: fmtData(r.dueDate),
          saldo: r.balanceDue,
          saldoFmt: fmtBRL(r.balanceDue),
          paga: r.paid,
          boletoGerado: r.generatedBoleto,
          etapa,
          elegivelHoje: !!etapa && r.balanceDue > 0 && !r.paid,
        };
      });
      return NextResponse.json({ ok: true, action, billId, parcelas });
    }

    // Telefones do cadastro do cliente no Sienge (sob demanda, por customerId).
    // Retornados em E.164 para preencher o envio — o número só sai de verdade se
    // estiver na WHATSAPP_ALLOWLIST. ids não são PII (podem ir na query).
    if (action === "telefones") {
      const ids = [...new Set((q.get("customerIds") ?? "").split(",").map((s) => Number(s.trim())).filter(Boolean))].slice(0, 6);
      if (!ids.length) return NextResponse.json({ ok: false, error: "informe_customerIds" }, { status: 400 });
      const clientes = await Promise.all(ids.map(async (id) => {
        try {
          const c = await sienge.getCustomer(id);
          return { customerId: id, nome: (c?.name ?? null), telefones: normalizeCustomerPhones(c) };
        } catch {
          return { customerId: id, nome: null, telefones: [] as ReturnType<typeof normalizeCustomerPhones> };
        }
      }));
      return NextResponse.json({ ok: true, action, clientes });
    }

    // 2ª via do boleto (link + linha digitável).
    if (action === "boleto") {
      const billId = Number(q.get("billId"));
      const installmentId = Number(q.get("installmentId"));
      if (!billId || !installmentId) return NextResponse.json({ ok: false, error: "informe_billId_e_installmentId" }, { status: 400 });
      return NextResponse.json({ ok: true, action, boleto: normalizePaymentSlip(await sienge.getPaymentSlip(billId, installmentId)) });
    }

    // Prontidão do envio real: estado das travas + status dos templates na Meta.
    // Não expõe segredos — só booleanos e metadados do template.
    if (action === "preflight") {
      const e = env();
      const allowlist = e.WHATSAPP_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean);
      const provider = e.WHATSAPP_PROVIDER;
      // Templates só importam no canal Meta; Evolution manda texto livre.
      const templates = provider === "meta"
        ? await Promise.all([...new Set([templateNameFor("D-10"), templateNameFor("D0"), templateNameFor("D+1")])].map(getTemplateInfo))
        : [];
      const credsPresent = provider === "meta"
        ? !!e.WHATSAPP_ACCESS_TOKEN && !!e.WHATSAPP_PHONE_NUMBER_ID && !!e.WHATSAPP_WABA_ID
        : !!e.EVOLUTION_API_URL && !!e.EVOLUTION_API_KEY;
      return NextResponse.json({
        ok: true, action,
        gate: {
          provider,
          appMode: e.APP_MODE,
          outboundEnabled: e.OUTBOUND_MESSAGING_ENABLED,
          dryRun: e.WHATSAPP_DRY_RUN,
          allowAllProduction: e.WHATSAPP_ALLOW_ALL_PRODUCTION,
          allowlistCount: allowlist.length,
          credsPresent,
        },
        templates,
      });
    }

    // Amostra de clientes reais do Sienge → mostra os CÓDIGOS aceitos
    // (personType/typeId/sex/mailingAddress/civilStatus) p/ configurar o
    // cadastro automático sem adivinhar. Sem PII (nome/CPF/e-mail não saem).
    if (action === "amostra-cliente") {
      const raw = await sienge.listCustomers(5, 0);
      const rows = (Array.isArray(raw) ? raw : (raw?.results ?? raw?.data ?? [])) as any[];
      const pick = (c: any) => ({
        personType: c?.personType ?? null,
        typeId: c?.typeId ?? c?.customerTypeId ?? c?.type?.id ?? null,
        sex: c?.naturalPersonData?.sex ?? c?.sex ?? null,
        mailingAddress: c?.naturalPersonData?.mailingAddress ?? c?.mailingAddress ?? null,
        civilStatus: c?.naturalPersonData?.civilStatus ?? c?.civilStatus ?? null,
      });
      const amostra = rows.map(pick);
      const distinct = (k: keyof ReturnType<typeof pick>) => [...new Set(amostra.map((a) => a[k]).filter((v) => v != null))];
      return NextResponse.json({
        ok: true, action,
        valores: {
          personType: distinct("personType"), typeId: distinct("typeId"),
          sex: distinct("sex"), mailingAddress: distinct("mailingAddress"), civilStatus: distinct("civilStatus"),
        },
      });
    }

    // Estado da régua automática: regras (etapas on/off) + últimos envios.
    if (action === "regua") {
      const rules = await db.collectionRule.findMany({ orderBy: { dayOffset: "asc" } });
      const recentes = await db.collectionSend.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
      return NextResponse.json({
        ok: true, action,
        regras: rules.map((r) => ({ name: r.name, dayOffset: r.dayOffset, enabled: r.enabled, sendHour: r.sendHour })),
        recentes: recentes.map((s) => ({
          etapa: s.etapa, vencimento: s.dueDate.toLocaleDateString("pt-BR", { timeZone: "UTC" }),
          valor: Number(s.valor), status: s.status, motivo: s.motivo, boletoSent: s.boletoSent,
          quando: s.createdAt.toISOString(), telefone: maskPhone(s.phone),
        })),
      });
    }

    return NextResponse.json({ ok: false, error: "acao_desconhecida" }, { status: 400 });
  } catch (e: any) {
    const msg = redactText(String(e?.message ?? e)).slice(0, 300);
    const status = /Sienge 401/.test(msg) ? "authentication_failed" : /Sienge 403/.test(msg) ? "permission_denied" : /Sienge 404/.test(msg) ? "not_found" : "error";
    return NextResponse.json({ ok: false, error: status, detail: msg });
  }
}

// Máscara de telefone p/ o log da régua (mostra só o fim, confirma o cliente).
function maskPhone(p: string): string {
  const d = String(p ?? "").replace(/\D/g, "");
  if (d.length < 4) return p ? "•••" : "";
  return `•••••${d.slice(-4)}`;
}

// POST /api/consultas/sienge
//   { action:"simular", billId, installmentId, nome, imovel, etapa }
//   { action:"enviar",  billId, installmentId, nome, imovel, etapa, to }
// - "simular": dry-run — monta a mensagem + boleto e devolve o preview + o
//   motivo do bloqueio. NUNCA envia.
// - "enviar": envio REAL, mas SEMPRE através da trava canSendTo (dentro de
//   sendWhatsAppTemplate). Enquanto OUTBOUND_MESSAGING_ENABLED=false ou
//   WHATSAPP_DRY_RUN=true, o retorno vem como dry-run (nada sai). Com as travas
//   liberadas, só envia se o número estiver na WHATSAPP_ALLOWLIST.
// Recebe nome/imóvel/telefone no BODY (não na URL) para não pôr PII em query.
export async function POST(req: NextRequest) {
  const blocked = guard();
  if (blocked) return blocked;
  try {
    const body = await req.json().catch(() => ({}));
    const acao = body?.action;

    // Liga/desliga uma etapa da régua (D-10 / D0 / D+1).
    if (acao === "regua-toggle") {
      const name = String(body.name ?? "");
      if (!["D-10", "D0", "D+1"].includes(name)) return NextResponse.json({ ok: false, error: "etapa_invalida" }, { status: 400 });
      const rule = await db.collectionRule.update({ where: { name }, data: { enabled: !!body.enabled } });
      return NextResponse.json({ ok: true, action: acao, name: rule.name, enabled: rule.enabled });
    }

    // Roda a régua agora (mesmo motor do cron; respeita todas as travas).
    if (acao === "regua-rodar") {
      const resumo = await runReguaFromSienge(new Date());
      return NextResponse.json({ ok: true, action: acao, resumo });
    }

    if (acao !== "simular" && acao !== "enviar") {
      return NextResponse.json({ ok: false, error: "acao_desconhecida" }, { status: 400 });
    }
    const billId = Number(body.billId);
    const installmentId = Number(body.installmentId);
    if (!billId || !installmentId) return NextResponse.json({ ok: false, error: "informe_billId_e_installmentId" }, { status: 400 });
    const etapa: EtapaRegua = (["D-10", "D0", "D+1"].includes(body.etapa) ? body.etapa : "D0");

    const rows = normalizeInstallmentsList(await sienge.getInstallments(billId));
    const p = rows.find((r) => r.installmentId === installmentId);
    if (!p) return NextResponse.json({ ok: false, error: "parcela_nao_encontrada" }, { status: 404 });
    // Trava financeira: nunca cobrar parcela paga/sem saldo (fonte: Sienge).
    if (p.paid || p.balanceDue <= 0) return NextResponse.json({ ok: false, error: "parcela_sem_saldo" }, { status: 409 });

    const boleto = normalizePaymentSlip(await sienge.getPaymentSlip(billId, installmentId));
    const nome = String(body.nome ?? "cliente").trim().split(/\s+/)[0];
    const dados = { nome, imovel: String(body.imovel ?? ""), vencimento: fmtData(p.dueDate), valor: fmtBRL(p.balanceDue) };
    const preview = previewMensagem(etapa, dados);
    const template = templateNameFor(etapa);
    const e = env();

    if (acao === "simular") {
      const motivo = !e.OUTBOUND_MESSAGING_ENABLED ? "MASTER_SWITCH_OFF" : e.WHATSAPP_DRY_RUN ? "DRY_RUN" : "PERMITIDO";
      return NextResponse.json({ ok: true, action: "simular", enviado: false, motivo, template, preview, boleto, saldo: p.balanceDue, paga: p.paid });
    }

    // acao === "enviar" — envio real, SEMPRE atrás da trava canSendTo.
    const to = String(body.to ?? "").trim();
    if (!to) return NextResponse.json({ ok: false, error: "informe_numero" }, { status: 400 });
    const provider = e.WHATSAPP_PROVIDER;

    // Trava única (independe do canal): master switch, dry-run e allowlist.
    const allowlist = e.WHATSAPP_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean);
    const gate = canSendTo(to, {
      appMode: e.APP_MODE, outboundEnabled: e.OUTBOUND_MESSAGING_ENABLED, dryRun: e.WHATSAPP_DRY_RUN,
      allowAllProduction: e.WHATSAPP_ALLOW_ALL_PRODUCTION, allowlist,
    });
    if (!gate.allowed) {
      return NextResponse.json({ ok: true, action: "enviar", enviado: false, motivo: gate.reason, provider, template, preview, boleto });
    }

    if (provider === "evolution") {
      // Texto livre (sem template) + link/linha do boleto; PDF como documento (best-effort).
      const texto = `${preview}${boleto.url ? `\n\nBoleto: ${boleto.url}` : ""}${boleto.linhaDigitavel ? `\nLinha digitável: ${boleto.linhaDigitavel}` : ""}`;
      const r = await evolutionSendText({ to, text: texto });
      if (!r.success) return NextResponse.json({ ok: false, error: "evolution_erro", detail: redactText(String(r.error ?? "")).slice(0, 200), provider });
      let boletoEnviado = false;
      if (boleto.url) {
        const doc = await evolutionSendDocument({ to, mediaUrl: boleto.url, fileName: `boleto-${installmentId}.pdf`, caption: `Boleto — ${dados.imovel}` });
        boletoEnviado = !!doc.success;
      }
      return NextResponse.json({ ok: true, action: "enviar", enviado: true, motivo: "ENVIADO", provider, messageId: r.messageId, boletoEnviado, boleto, preview });
    }

    // provider === "meta" — Cloud API oficial: confere template aprovado.
    const info = await getTemplateInfo(template);
    if (info.found && info.status && info.status !== "APPROVED") {
      return NextResponse.json({ ok: false, error: "template_nao_aprovado", detail: `Template ${template} está ${info.status} na Meta.`, template, templateStatus: info.status });
    }
    const urlButtonParam = info.hasUrlButton && info.urlButtonHasVariable && boleto.url ? boleto.url : undefined;
    const result = await sendWhatsAppTemplate({
      to, templateName: template, languageCode: WA_LANG(),
      bodyParameters: [dados.nome, dados.imovel, dados.vencimento, dados.valor],
      urlButtonParam,
    });
    return NextResponse.json({
      ok: true, action: "enviar", provider,
      enviado: !result.dryRun,
      motivo: result.dryRun ? (result as any).reason : "ENVIADO",
      messageId: result.id, template, templateStatus: info.status,
      boletoNoTemplate: !!urlButtonParam, boleto, preview,
    });
  } catch (e: any) {
    const msg = redactText(String(e?.message ?? e)).slice(0, 300);
    const status = /bloqueado pela seguran/i.test(msg) ? "bloqueado_seguranca"
      : /Credenciais/i.test(msg) ? "credenciais_incompletas"
      : /WhatsApp \d/i.test(msg) ? "meta_erro" : "error";
    return NextResponse.json({ ok: false, error: status, detail: msg });
  }
}
