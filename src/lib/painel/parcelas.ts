import { db } from "../db";
import { sienge } from "../sienge/client";
import { normalizeIncomeInstallments, type NormalizedIncomeInstallment } from "../sienge/mapper";

// Cache das parcelas do Sienge (nº "4/60", unidade, documento). Gravado pela
// régua (janela diária) e, quando faltar, por 1 chamada bulk por título.

// Saldo COM correção monetária (o mesmo valor do boleto). O saldo do Sienge
// REST (balanceDue) vem sem correção; o fator corrigido/base vem do bulk
// (ParcelaCache, atualizado todo dia). Sem fator, devolve o saldo como está.
export function corrigir(saldoAtual: number, base?: number | null, corrigido?: number | null): number {
  if (!(saldoAtual > 0)) return 0;
  const b = Number(base) || 0, c = Number(corrigido) || 0;
  return b > 0 && c > 0 ? Math.round(saldoAtual * (c / b) * 100) / 100 : saldoAtual;
}
export const corrigirPeloCache = (saldoAtual: number, c?: { saldoBase: unknown; saldoCorrigido: unknown } | null) =>
  corrigir(saldoAtual, c ? Number(c.saldoBase) : null, c ? Number(c.saldoCorrigido) : null);

export async function salvarParcelas(ps: NormalizedIncomeInstallment[]) {
  for (const p of ps) {
    if (!p.billId || !p.installmentId || !p.parcela) continue;
    const data = {
      parcela: p.parcela, tipoParc: p.tipoParc, unidade: p.unidade, documento: p.documento, centroCusto: p.centroCusto,
      vencimento: p.vencimento, clientId: p.clientId, clientName: p.clientName, valorOriginal: p.valorOriginal ?? 0,
      saldoBase: p.saldo ?? 0, saldoCorrigido: p.saldoCorrigido ?? 0,
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
  const ps = normalizeIncomeInstallments(await sienge.listIncomeByBills(faltam));
  await salvarParcelas(ps);
  // A resposta traz o título inteiro: grava o histórico de pagamentos junto.
  const { salvarHistorico } = await import("./historico");
  await salvarHistorico(ps).catch(() => null);
  return { consultouSienge: true };
}

export async function cacheDe(billIds: number[]) {
  const rows = await db.parcelaCache.findMany({ where: { billId: { in: billIds } } });
  return new Map(rows.map((r) => [`${r.billId}/${r.installmentId}`, r]));
}
