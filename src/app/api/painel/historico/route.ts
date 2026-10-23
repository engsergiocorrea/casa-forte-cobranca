import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { usuarioPainel } from "@/lib/painel/auth";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  const q = req.nextUrl.searchParams;
  const dias = Math.min(90, Math.max(1, Number(q.get("dias")) || 7));
  const desde = new Date(Date.now() - dias * 86400000);
  const tipo = q.get("tipo") || undefined, status = q.get("status") || undefined;
  const [coms, confs] = await Promise.all([
    db.comunicacao.findMany({ where: { atualizadaEm: { gte: desde }, ...(tipo && tipo !== "CONFIRMACAO" ? { tipo } : {}), ...(status ? { status } : {}) }, orderBy: { atualizadaEm: "desc" }, take: 300 }),
    !tipo || tipo === "CONFIRMACAO" ? db.paymentConfirmation.findMany({ where: { updatedAt: { gte: desde }, ...(status ? { status } : {}) }, orderBy: { updatedAt: "desc" }, take: 200 }) : Promise.resolve([]),
  ]);
  const linhas = [
    ...(tipo === "CONFIRMACAO" ? [] : coms.map((c) => ({ quando: c.atualizadaEm, tipo: c.tipo, etapa: c.etapa, status: c.status, motivo: c.motivo, detalhe: c.detalhe, cliente: c.clienteNome, customerId: c.customerId, contrato: c.contrato, parcela: c.parcela, vencimento: c.dueDate?.toISOString().slice(0, 10) ?? null, valor: c.valor != null ? Number(c.valor) : null, solicitadoPor: c.solicitadoPor }))),
    ...confs.map((c) => ({ quando: c.updatedAt, tipo: "CONFIRMACAO", etapa: null, status: c.status, motivo: c.motivo, detalhe: c.detail, cliente: null, customerId: c.clientId, contrato: c.contrato, parcela: null, vencimento: null, valor: Number(c.valor), solicitadoPor: "cron" })),
  ].sort((x, y) => +new Date(y.quando) - +new Date(x.quando));
  return NextResponse.json(linhas);
}
