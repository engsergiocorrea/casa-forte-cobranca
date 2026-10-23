import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sienge } from "@/lib/sienge/client";
import { normalizeInstallmentsList } from "@/lib/sienge/mapper";
import { localDateKey, diffDias } from "@/lib/collection/date";
import { usuarioPainel } from "@/lib/painel/auth";
import { contratos } from "@/lib/painel/sienge-cache";
import { cacheDe } from "@/lib/painel/parcelas";

// Parcelas vencidas e em aberto (Sienge, ao vivo, sem limite diário), com a
// última cobrança registrada e se o cliente está em pausa.
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  const hoje = localDateKey(new Date(), env().TIMEZONE);
  const cs = (await contratos()).filter((c) => c.billId && !/cancel/i.test(c.situacao));
  const cache = await cacheDe(cs.map((c) => c.billId!) );
  const pausas = await db.pausaRegua.findMany({ where: { removidaEm: null } });
  const linhas = (await Promise.all(cs.map(async (c) => {
    let ps; try { ps = normalizeInstallmentsList(await sienge.getInstallments(c.billId!)); } catch { return []; }
    return ps.filter((p) => p.balanceDue > 0).map((p) => {
      const venc = p.dueDate.toISOString().slice(0, 10);
      return { venc, p };
    }).filter((x) => diffDias(hoje, x.venc) < 0).map(({ venc, p }) => {
      const cli = c.clientes[0];
      const pausa = pausas.find((z) => (z.customerId && z.customerId === cli?.id) || (z.billId && z.billId === c.billId));
      return { customerId: cli?.id ?? null, cliente: cli?.nome ?? "", contrato: c.numero, empreendimento: c.empreendimento, unidades: c.unidades.join(", "),
        billId: c.billId, installmentId: p.installmentId, parcela: cache.get(`${c.billId}/${p.installmentId}`)?.parcela ?? null,
        vencimento: venc, diasAtraso: -diffDias(hoje, venc), saldo: p.balanceDue, boletoGerado: p.generatedBoleto, pausa: pausa?.motivo ?? null };
    });
  }))).flat().sort((x, y) => y.diasAtraso - x.diasAtraso);
  const ultimas = await db.comunicacao.findMany({ where: { tipo: "COBRANCA", status: { in: ["ENVIADA", "ENTREGUE", "LIDA"] }, billId: { in: linhas.map((l) => l.billId!) } }, orderBy: { enviadaEm: "desc" } });
  return NextResponse.json(linhas.map((l) => ({ ...l, ultimaCobranca: ultimas.find((u) => u.billId === l.billId && u.installmentId === l.installmentId)?.enviadaEm ?? null })));
}
