import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sienge, siengePing, extractCount } from "@/lib/sienge/client";
import { normalizeReceivableBill } from "@/lib/sienge/mapper";
import { redact, redactText } from "@/lib/redact";

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

    return NextResponse.json({ ok: false, error: "acao_desconhecida" }, { status: 400 });
  } catch (e: any) {
    const msg = redactText(String(e?.message ?? e)).slice(0, 300);
    const status = /Sienge 401/.test(msg) ? "authentication_failed" : /Sienge 403/.test(msg) ? "permission_denied" : /Sienge 404/.test(msg) ? "not_found" : "error";
    return NextResponse.json({ ok: false, error: status, detail: msg });
  }
}
