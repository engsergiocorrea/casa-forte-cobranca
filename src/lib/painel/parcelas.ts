import { db } from "../db";
import { sienge } from "../sienge/client";
import { normalizeIncomeInstallments, type NormalizedIncomeInstallment } from "../sienge/mapper";

// Cache das parcelas do Sienge (nº "4/60", unidade, documento). Gravado pela
// régua (janela diária) e, quando faltar, por 1 chamada bulk por título.

export async function salvarParcelas(ps: NormalizedIncomeInstallment[]) {
  for (const p of ps) {
    if (!p.billId || !p.installmentId || !p.parcela) continue;
    const data = {
      parcela: p.parcela, tipoParc: p.tipoParc, unidade: p.unidade, documento: p.documento, centroCusto: p.centroCusto,
      vencimento: p.vencimento, clientId: p.clientId, clientName: p.clientName,
    };
    await db.parcelaCache.upsert({ where: { billId_installmentId: { billId: p.billId, installmentId: p.installmentId } }, create: { billId: p.billId, installmentId: p.installmentId, ...data }, update: data });
  }
}

// Garante o cache dos títulos informados; busca no Sienge (1 chamada bulk)
// só os que ainda não têm nenhuma parcela em cache.
export async function garantirCache(billIds: number[]): Promise<{ consultouSienge: boolean }> {
  const unicos = [...new Set(billIds)].filter(Boolean);
  if (!unicos.length) return { consultouSienge: false };
  const comCache = new Set((await db.parcelaCache.findMany({ where: { billId: { in: unicos } }, select: { billId: true }, distinct: ["billId"] })).map((x) => x.billId));
  const faltam = unicos.filter((b) => !comCache.has(b));
  if (!faltam.length) return { consultouSienge: false };
  await salvarParcelas(normalizeIncomeInstallments(await sienge.listIncomeByBills(faltam)));
  return { consultouSienge: true };
}

export async function cacheDe(billIds: number[]) {
  const rows = await db.parcelaCache.findMany({ where: { billId: { in: billIds } } });
  return new Map(rows.map((r) => [`${r.billId}/${r.installmentId}`, r]));
}
