import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { runRegua } from "@/lib/regua/executar";

// Régua v2 — boleto D-10, lembrete D0, cobrança D+1/7/15. Bearer CRON_SECRET.
//   POST              → executa (só tipos ligados; REGUA_DRY_RUN=true só registra)
//   POST ?preview=1   → mostra o plano do dia e o texto de cada mensagem (todos os
//                       tipos, não grava, não envia)
//   GET  ?billId=N    → SÓ LEITURA: comunicações registradas (sem billId, as 50 últimas)
// Cada POST usa 1 das 20 chamadas/dia do bulk-data do Sienge.
export const dynamic = "force-dynamic";

const autorizado = (req: NextRequest) => req.headers.get("authorization") === `Bearer ${env().CRON_SECRET}`;
const mascarar = (s: string | null) => s?.replace(/\d{4,}(?=\d{3})/g, (m) => "•".repeat(m.length)) ?? null;

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return new NextResponse("unauthorized", { status: 401 });
  return NextResponse.json(await runRegua({ preview: req.nextUrl.searchParams.get("preview") === "1" }));
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return new NextResponse("unauthorized", { status: 401 });
  const billId = Number(req.nextUrl.searchParams.get("billId")) || undefined;
  const rows = await db.comunicacao.findMany({ where: billId ? { billId } : undefined, orderBy: { atualizadaEm: "desc" }, take: 50 });
  return NextResponse.json(rows.map((r) => ({
    tipo: r.tipo, etapa: r.etapa, status: r.status, motivo: r.motivo, detalhe: mascarar(r.detalhe),
    contrato: r.contrato, parcela: r.parcela, billId: r.billId, installmentId: r.installmentId,
    vencimento: r.dueDate?.toISOString().slice(0, 10) ?? null, valor: r.valor != null ? Number(r.valor) : null,
    destino: mascarar(r.destino), tentativas: r.tentativas, solicitadoPor: r.solicitadoPor,
    enviadaEm: r.enviadaEm, atualizadaEm: r.atualizadaEm,
  })));
}
