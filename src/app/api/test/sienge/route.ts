import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { siengePing } from "@/lib/sienge/client";

export const dynamic = "force-dynamic";

// Diagnóstico READ-ONLY da conexão com a API do Sienge.
// - Só funciona em APP_MODE=staging.
// - Exige Authorization: Bearer <CRON_SECRET> (mesmo padrão da rota de teste do WhatsApp).
// - Faz UM GET (nunca POST/PUT/PATCH/DELETE) a um endpoint de listagem read-only.
// - Retorna JSON sanitizado: sem usuário, senha, Basic Auth, Authorization, tokens
//   nem o corpo bruto do Sienge — apenas status e um "count" defensivo.
const ENDPOINTS: Record<string, string> = {
  customers: "/customers?limit=1",
  "sales-contracts": "/sales-contracts?limit=1",
  units: "/units?limit=1",
};

export async function GET(req: NextRequest) {
  const e = env();
  if (e.APP_MODE !== "staging") {
    return NextResponse.json({ ok: false, error: "only_staging" }, { status: 403 });
  }
  if (req.headers.get("authorization") !== `Bearer ${e.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const resource = req.nextUrl.searchParams.get("resource") ?? "customers";
  const endpoint = ENDPOINTS[resource] ?? ENDPOINTS.customers;
  const base = { subdomain: e.SIENGE_SUBDOMAIN, endpoint };

  try {
    const r = await siengePing(endpoint);
    if (r.httpStatus === 401) return NextResponse.json({ ok: false, status: "authentication_failed", ...base });
    if (r.httpStatus === 403) return NextResponse.json({ ok: false, status: "permission_denied", ...base });
    if (!r.ok) return NextResponse.json({ ok: false, status: "error", httpStatus: r.httpStatus, ...base });
    return NextResponse.json({ ok: true, status: "connected", ...base, count: r.count });
  } catch {
    // Erro de rede/timeout — não vaza detalhes de credencial.
    return NextResponse.json({ ok: false, status: "connection_error", ...base });
  }
}
