import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sienge, siengePing, extractCount } from "@/lib/sienge/client";
import { normalizeReceivableBill, normalizeInstallmentsList, normalizePaymentSlip } from "@/lib/sienge/mapper";
import { daysFromDue } from "@/lib/collection/date";
import { previewMensagem, templateNameFor, type EtapaRegua } from "@/lib/collection/messages";
import { redact, redactText } from "@/lib/redact";

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
            .map((x: any) => ({ nome: x?.name ?? null, principal: !!x?.main, conjuge: !!x?.spouse })),
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

    // 2ª via do boleto (link + linha digitável).
    if (action === "boleto") {
      const billId = Number(q.get("billId"));
      const installmentId = Number(q.get("installmentId"));
      if (!billId || !installmentId) return NextResponse.json({ ok: false, error: "informe_billId_e_installmentId" }, { status: 400 });
      return NextResponse.json({ ok: true, action, boleto: normalizePaymentSlip(await sienge.getPaymentSlip(billId, installmentId)) });
    }

    return NextResponse.json({ ok: false, error: "acao_desconhecida" }, { status: 400 });
  } catch (e: any) {
    const msg = redactText(String(e?.message ?? e)).slice(0, 300);
    const status = /Sienge 401/.test(msg) ? "authentication_failed" : /Sienge 403/.test(msg) ? "permission_denied" : /Sienge 404/.test(msg) ? "not_found" : "error";
    return NextResponse.json({ ok: false, error: status, detail: msg });
  }
}

// POST /api/consultas/sienge  { action:"simular", billId, installmentId, nome, imovel, etapa }
// Simula a cobrança de uma parcela: monta a mensagem (com boleto) e aplica o
// safety gate. Em staging/dry-run NÃO envia nada — só devolve o preview e o
// motivo do bloqueio. Recebe nome/imóvel no BODY (não na URL) para não pôr PII
// em query string.
export async function POST(req: NextRequest) {
  const blocked = guard();
  if (blocked) return blocked;
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action !== "simular") return NextResponse.json({ ok: false, error: "acao_desconhecida" }, { status: 400 });
    const billId = Number(body.billId);
    const installmentId = Number(body.installmentId);
    if (!billId || !installmentId) return NextResponse.json({ ok: false, error: "informe_billId_e_installmentId" }, { status: 400 });
    const etapa: EtapaRegua = (["D-10", "D0", "D+1"].includes(body.etapa) ? body.etapa : "D0");

    const rows = normalizeInstallmentsList(await sienge.getInstallments(billId));
    const p = rows.find((r) => r.installmentId === installmentId);
    if (!p) return NextResponse.json({ ok: false, error: "parcela_nao_encontrada" }, { status: 404 });

    const boleto = normalizePaymentSlip(await sienge.getPaymentSlip(billId, installmentId));
    const nome = String(body.nome ?? "cliente").trim().split(/\s+/)[0];
    const dados = { nome, imovel: String(body.imovel ?? ""), vencimento: fmtData(p.dueDate), valor: fmtBRL(p.balanceDue) };
    const preview = previewMensagem(etapa, dados);

    const e = env();
    const motivo = !e.OUTBOUND_MESSAGING_ENABLED ? "MASTER_SWITCH_OFF" : e.WHATSAPP_DRY_RUN ? "DRY_RUN" : "PERMITIDO";
    return NextResponse.json({
      ok: true, action: "simular", enviado: false, motivo,
      template: templateNameFor(etapa), preview,
      boleto, saldo: p.balanceDue, paga: p.paid,
    });
  } catch (e: any) {
    const msg = redactText(String(e?.message ?? e)).slice(0, 300);
    return NextResponse.json({ ok: false, error: "error", detail: msg });
  }
}
