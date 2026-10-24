import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sienge } from "@/lib/sienge/client";
import { normalizeCustomerPhones, normalizeInstallmentsList } from "@/lib/sienge/mapper";
import { localDateKey, diffDias } from "@/lib/collection/date";
import { usuarioPainel } from "@/lib/painel/auth";
import { contratosDoCliente } from "@/lib/painel/sienge-cache";
import { cacheDe } from "@/lib/painel/parcelas";

// Ficha do cliente: contratos, parcelas (Sienge, ao vivo), comunicações e pausas.
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req, { brain: true }); if ("erro" in a) return a.erro;
  const customerId = Number(req.nextUrl.searchParams.get("customerId"));
  if (!customerId) return NextResponse.json({ erro: "customerId" }, { status: 400 });
  const hoje = localDateKey(new Date(), env().TIMEZONE);
  const contratos = await contratosDoCliente(customerId);
  const billIds = contratos.map((c) => c.billId).filter(Boolean) as number[];
  const cache = await cacheDe(billIds);

  const fichas = await Promise.all(contratos.map(async (c) => {
    if (!c.billId) return { ...c, parcelas: [] };
    const ps = normalizeInstallmentsList(await sienge.getInstallments(c.billId)).sort((x, y) => +x.dueDate - +y.dueDate);
    return {
      ...c,
      parcelas: ps.map((p) => {
        const venc = p.dueDate.toISOString().slice(0, 10);
        const k = cache.get(`${c.billId}/${p.installmentId}`);
        return { billId: c.billId, installmentId: p.installmentId, parcela: k?.parcela ?? null, tipoParc: k?.tipoParc ?? p.conditionTypeId ?? null,
          vencimento: venc, saldo: p.balanceDue, paga: p.balanceDue <= 0, boletoGerado: p.generatedBoleto, diasAteVencimento: diffDias(hoje, venc) };
      }),
    };
  }));

  let nome = contratos[0]?.clientes[0]?.nome ?? "", telefone: string | null = null;
  try { const cli = await sienge.getCustomer(customerId); nome = cli?.name ?? nome; telefone = normalizeCustomerPhones(cli)[0]?.numero ?? null; } catch { /* sem cadastro */ }

  const [comunicacoes, confirmacoes, pausas] = await Promise.all([
    db.comunicacao.findMany({ where: { customerId }, orderBy: { atualizadaEm: "desc" }, take: 60 }),
    db.paymentConfirmation.findMany({ where: { clientId: customerId }, orderBy: { updatedAt: "desc" }, take: 30 }),
    db.pausaRegua.findMany({ where: { removidaEm: null, OR: [{ customerId }, { billId: { in: billIds } }] } }),
  ]);
  return NextResponse.json({
    customerId, nome, telefone, contratos: fichas,
    comunicacoes: comunicacoes.map((c) => ({ tipo: c.tipo, etapa: c.etapa, status: c.status, motivo: c.motivo, detalhe: c.detalhe, contrato: c.contrato, parcela: c.parcela, vencimento: c.dueDate?.toISOString().slice(0, 10) ?? null, valor: c.valor != null ? Number(c.valor) : null, solicitadoPor: c.solicitadoPor, enviadaEm: c.enviadaEm, atualizadaEm: c.atualizadaEm, conteudo: c.conteudo })),
    confirmacoes: confirmacoes.map((c) => ({ contrato: c.contrato, installmentId: c.installmentId, status: c.status, valor: Number(c.valor), pagoEm: c.paidDate.toISOString().slice(0, 10), enviadaEm: c.sentAt, detalhe: c.detail })),
    pausas: pausas.map((p) => ({ id: p.id, tipos: p.tipos, ate: p.ate?.toISOString().slice(0, 10) ?? null, motivo: p.motivo, contrato: p.contrato })),
  });
}
