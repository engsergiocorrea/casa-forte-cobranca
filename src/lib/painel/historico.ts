import { db } from "../db";
import { sienge } from "../sienge/client";
import { normalizeIncomeInstallments, type NormalizedIncomeInstallment } from "../sienge/mapper";
import { diffDias } from "../collection/date";
import { salvarParcelas } from "./parcelas";
import { contratos } from "./sienge-cache";

// Histórico de pagamentos do Sienge (todas as baixas desde o início de cada
// contrato). Fonte: bulk income (by-bills = título inteiro; by-due-date = só
// as parcelas da janela). Bulk tem limite de 20 chamadas/dia: a sincronização
// completa usa 1 chamada por lote de títulos (hoje 42 contratos = 1 chamada).

const LOTE = 40;
const REAL = /receb|adiant/i; // mesmo critério do comprovante (sem baixas administrativas)

// Regrava as baixas das parcelas recebidas (troca as antigas daquela parcela pelas novas).
export async function salvarHistorico(ps: NormalizedIncomeInstallment[]) {
  for (const p of ps) {
    if (!p.billId || !p.installmentId) continue;
    const baixas = p.baixas.filter((b) => b.pagoEm);
    await db.$transaction([
      db.pagamentoHistorico.deleteMany({ where: { billId: p.billId, installmentId: p.installmentId } }),
      ...(baixas.length ? [db.pagamentoHistorico.createMany({
        data: baixas.map((b, seq) => ({
          billId: p.billId, installmentId: p.installmentId, seq, clientId: p.clientId,
          parcela: p.parcela, vencimento: p.vencimento, pagoEm: b.pagoEm, operacao: b.operacao, real: REAL.test(b.operacao),
          bruto: b.bruto, seguro: b.seguro ?? 0, desconto: b.desconto, juros: b.juros, multa: b.multa, liquido: b.liquido,
        })),
      })] : []),
    ]);
  }
}

// Sincroniza o histórico completo dos títulos (padrão: todos os contratos).
export async function sincronizarHistorico(billIds?: number[]) {
  const alvo = [...new Set(billIds?.length ? billIds : (await contratos(true)).map((c) => c.billId).filter(Boolean) as number[])];
  let chamadas = 0, parcelas = 0, baixas = 0;
  for (let i = 0; i < alvo.length; i += LOTE) {
    const lote = alvo.slice(i, i + LOTE);
    const ps = normalizeIncomeInstallments(await sienge.listIncomeByBills(lote));
    chamadas++;
    await salvarParcelas(ps).catch(() => null);
    await salvarHistorico(ps);
    parcelas += ps.length; baixas += ps.reduce((s, p) => s + p.baixas.length, 0);
    const agora = new Date();
    for (const b of lote) await db.historicoSync.upsert({ where: { billId: b }, create: { billId: b, sincronizadoEm: agora }, update: { sincronizadoEm: agora } });
  }
  return { titulos: alvo.length, chamadasSienge: chamadas, parcelas, baixas };
}

// Histórico de um título, pronto para a tela: uma linha por pagamento real,
// do mais recente para o mais antigo, com dias de atraso e resumo.
export async function historicoDoTitulo(billId: number) {
  const [rows, sync] = await Promise.all([
    db.pagamentoHistorico.findMany({ where: { billId }, orderBy: [{ pagoEm: "desc" }, { installmentId: "desc" }] }),
    db.historicoSync.findUnique({ where: { billId } }),
  ]);
  const pagamentos = rows.map((r) => ({
    installmentId: r.installmentId, parcela: r.parcela, vencimento: r.vencimento, pagoEm: r.pagoEm, operacao: r.operacao, real: r.real,
    valorPago: Number(r.liquido), jurosMulta: Number(r.juros) + Number(r.multa), desconto: Number(r.desconto),
    diasAtraso: r.vencimento && r.pagoEm ? Math.max(0, diffDias(r.vencimento, r.pagoEm)) : 0,
  }));
  const reais = pagamentos.filter((p) => p.real);
  const atrasados = reais.filter((p) => p.diasAtraso > 0);
  return {
    sincronizadoEm: sync?.sincronizadoEm ?? null,
    resumo: {
      pagamentos: reais.length,
      totalPago: reais.reduce((s, p) => s + p.valorPago, 0),
      jurosMulta: reais.reduce((s, p) => s + p.jurosMulta, 0),
      emDia: reais.length - atrasados.length,
      comAtraso: atrasados.length,
      atrasoMedio: atrasados.length ? Math.round(atrasados.reduce((s, p) => s + p.diasAtraso, 0) / atrasados.length) : 0,
      primeiro: reais.length ? reais[reais.length - 1].pagoEm : null,
      ultimo: reais.length ? reais[0].pagoEm : null,
    },
    pagamentos,
  };
}
