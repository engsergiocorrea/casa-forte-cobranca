import { db } from "../db";
import { env } from "../env";
import { sienge } from "../sienge/client";
import { normalizeCustomerPhones, normalizeInstallmentsList } from "../sienge/mapper";
import { localDateKey, diffDias } from "../collection/date";
import { contratosDoCliente } from "./sienge-cache";
import { cacheDe, corrigirPeloCache } from "./parcelas";

// Ficha do cliente: extrato de cada contrato com TODAS as parcelas criadas
// (Sienge, ao vivo: saldo e boleto) + valor original e nº "4/60" (ParcelaCache)
// + pagamentos (PagamentoHistorico: data, valor pago, atraso), comunicações e pausas.
// Usada pela ficha do painel, pelo extrato em PDF e pelo Brain.
export async function fichaCliente(customerId: number) {
  const hoje = localDateKey(new Date(), env().TIMEZONE);
  const contratos = await contratosDoCliente(customerId);
  const billIds = contratos.map((c) => c.billId).filter(Boolean) as number[];
  const [cache, baixas, syncs] = await Promise.all([
    cacheDe(billIds),
    db.pagamentoHistorico.findMany({ where: { billId: { in: billIds } } }),
    db.historicoSync.findMany({ where: { billId: { in: billIds } } }),
  ]);
  const pagosPor = new Map<string, { valor: number; jurosMulta: number; ultimo: string; outras: string[] }>();
  for (const b of baixas) {
    const k = `${b.billId}/${b.installmentId}`;
    const g = pagosPor.get(k) ?? { valor: 0, jurosMulta: 0, ultimo: "", outras: [] };
    if (b.real) { g.valor += Number(b.liquido); g.jurosMulta += Number(b.juros) + Number(b.multa); if (b.pagoEm > g.ultimo) g.ultimo = b.pagoEm; }
    else if (b.operacao && !g.outras.includes(b.operacao)) g.outras.push(b.operacao);
    pagosPor.set(k, g);
  }

  const fichas = await Promise.all(contratos.map(async (c) => {
    if (!c.billId) return { ...c, parcelas: [], resumo: null, sincronizadoEm: null };
    const ps = normalizeInstallmentsList(await sienge.getInstallments(c.billId)).sort((x, y) => +x.dueDate - +y.dueDate);
    const parcelas = ps.map((p) => {
      const venc = p.dueDate.toISOString().slice(0, 10);
      const chave = `${c.billId}/${p.installmentId}`;
      const k = cache.get(chave);
      const pg = pagosPor.get(chave);
      const paga = p.balanceDue <= 0;
      return {
        billId: c.billId, installmentId: p.installmentId, parcela: k?.parcela ?? null, tipoParc: k?.tipoParc ?? p.conditionTypeId ?? null,
        vencimento: venc, saldo: corrigirPeloCache(p.balanceDue, k), saldoSemCorrecao: p.balanceDue, paga, boletoGerado: p.generatedBoleto, diasAteVencimento: diffDias(hoje, venc),
        valorOriginal: k && Number(k.valorOriginal) > 0 ? Number(k.valorOriginal) : null,
        valorPago: pg?.valor ? pg.valor : null, jurosMulta: pg?.jurosMulta || 0, pagoEm: pg?.ultimo || null,
        atrasoPagamento: pg?.ultimo ? Math.max(0, diffDias(venc, pg.ultimo)) : null,
        parcial: !paga && Boolean(pg?.valor), outrasBaixas: pg?.outras ?? [],
      };
    });
    const pagas = parcelas.filter((p) => p.paga), abertas = parcelas.filter((p) => !p.paga);
    const resumo = {
      criadas: parcelas.length, pagas: pagas.length, emAberto: abertas.length,
      vencidas: abertas.filter((p) => p.diasAteVencimento < 0).length,
      valorContrato: parcelas.reduce((s, p) => s + (p.valorOriginal ?? 0), 0),
      totalPago: parcelas.reduce((s, p) => s + (p.valorPago ?? 0), 0),
      saldoAberto: abertas.reduce((s, p) => s + p.saldo, 0),
      saldoVencido: abertas.filter((p) => p.diasAteVencimento < 0).reduce((s, p) => s + p.saldo, 0),
      pagasComAtraso: pagas.filter((p) => (p.atrasoPagamento ?? 0) > 0).length,
    };
    return { ...c, parcelas, resumo, sincronizadoEm: syncs.find((s) => s.billId === c.billId)?.sincronizadoEm ?? null };
  }));

  let nome = contratos[0]?.clientes[0]?.nome ?? "", telefone: string | null = null;
  try { const cli = await sienge.getCustomer(customerId); nome = cli?.name ?? nome; telefone = normalizeCustomerPhones(cli)[0]?.numero ?? null; } catch { /* sem cadastro */ }

  const [comunicacoes, confirmacoes, pausas] = await Promise.all([
    db.comunicacao.findMany({ where: { customerId }, orderBy: { atualizadaEm: "desc" }, take: 60 }),
    db.paymentConfirmation.findMany({ where: { clientId: customerId }, orderBy: { updatedAt: "desc" }, take: 30 }),
    db.pausaRegua.findMany({ where: { removidaEm: null, OR: [{ customerId }, { billId: { in: billIds } }] } }),
  ]);
  return {
    customerId, nome, telefone, contratos: fichas,
    comunicacoes: comunicacoes.map((c) => ({ tipo: c.tipo, etapa: c.etapa, status: c.status, motivo: c.motivo, detalhe: c.detalhe, contrato: c.contrato, parcela: c.parcela, vencimento: c.dueDate?.toISOString().slice(0, 10) ?? null, valor: c.valor != null ? Number(c.valor) : null, solicitadoPor: c.solicitadoPor, enviadaEm: c.enviadaEm, atualizadaEm: c.atualizadaEm, conteudo: c.conteudo })),
    confirmacoes: confirmacoes.map((c) => ({ contrato: c.contrato, installmentId: c.installmentId, status: c.status, valor: Number(c.valor), pagoEm: c.paidDate.toISOString().slice(0, 10), enviadaEm: c.sentAt, detalhe: c.detail })),
    pausas: pausas.map((p) => ({ id: p.id, tipos: p.tipos, ate: p.ate?.toISOString().slice(0, 10) ?? null, motivo: p.motivo, contrato: p.contrato })),
  };
}

export type FichaCliente = Awaited<ReturnType<typeof fichaCliente>>;
