import type { NormalizedBankMovement } from "../sienge/mapper";
import { addDaysKey } from "../collection/date";

// Seleção PURA (sem I/O) dos recebimentos que merecem confirmação ao cliente,
// a partir dos movimentos de caixa/banco do Sienge.
//
// Por que bank-movement: só existe movimento quando DINHEIRO entrou numa conta.
// Baixas sem dinheiro (cancelamento, renegociação, perda por inadimplência,
// abatimento) não geram movimento de caixa/banco — então "ter movimento de
// Recebimento" é a prova de que foi pagamento de verdade.
//
// Regras (conservadoras — na dúvida, NÃO confirma):
//  - só movimentos do Contas a Receber (origem CR) com título+parcela+cliente;
//  - a parcela precisa ter um movimento PRINCIPAL de recebimento
//    (operação 1 "Recebimento", tipo E, histórico 14);
//  - movimentos acessórios aceitos: 19 "Recebimento acréscimo" (E) e
//    20 "Desconto concedido" (S). Qualquer outro código → descarta a parcela
//    inteira (MOVIMENTO_NAO_RECONHECIDO) para revisão humana;
//  - valor líquido (entradas − saídas) precisa ser > 0;
//  - data do pagamento >= data de corte.

export const HIST_RECEBIMENTO = 14;
export const HIST_ACRESCIMO = 19;
export const HIST_DESCONTO = 20;
export const OP_RECEBIMENTO = 1;

export type Recebimento = {
  billId: number;
  installmentId: number;
  clientId: number;
  clientName: string;
  contrato: string;
  paidDate: string;      // yyyy-mm-dd (último movimento principal)
  valor: number;         // líquido: principal + acréscimo − desconto
  movementIds: number[];
};

export type Descartado = { billId: number | null; installmentId: number | null; motivo: string };

const isPrincipal = (m: NormalizedBankMovement) =>
  m.operationId === OP_RECEBIMENTO && m.operationType === "E" && m.historicId === HIST_RECEBIMENTO && m.amount > 0;
const isAcessorio = (m: NormalizedBankMovement) =>
  (m.historicId === HIST_ACRESCIMO && m.operationType === "E") || (m.historicId === HIST_DESCONTO && m.operationType === "S");

export function selecionarRecebimentos(movs: NormalizedBankMovement[], startDate: string): { recebimentos: Recebimento[]; descartados: Descartado[] } {
  const descartados: Descartado[] = [];
  const grupos = new Map<string, NormalizedBankMovement[]>();

  for (const m of movs) {
    if (m.origin !== "CR") continue; // transferências, pagamentos a fornecedor etc. não são recebimento de cliente
    if (!m.billId || !m.installmentId || !m.clientId) { descartados.push({ billId: m.billId, installmentId: m.installmentId, motivo: "SEM_TITULO_OU_CLIENTE" }); continue; }
    const k = `${m.billId}/${m.installmentId}`;
    grupos.set(k, [...(grupos.get(k) ?? []), m]);
  }

  const recebimentos: Recebimento[] = [];
  for (const g of grupos.values()) {
    const { billId, installmentId } = g[0];
    const principais = g.filter(isPrincipal);
    if (!principais.length) { descartados.push({ billId, installmentId, motivo: "SEM_RECEBIMENTO_PRINCIPAL" }); continue; }
    if (g.some((m) => !isPrincipal(m) && !isAcessorio(m))) { descartados.push({ billId, installmentId, motivo: "MOVIMENTO_NAO_RECONHECIDO" }); continue; }
    if (new Set(g.map((m) => m.clientId)).size > 1) { descartados.push({ billId, installmentId, motivo: "CLIENTE_DIVERGENTE" }); continue; }

    const paidDate = principais.map((m) => m.date).sort().at(-1)!;
    if (paidDate < startDate) continue; // antes do corte: backlog, nunca confirma

    const valor = Math.round(g.reduce((s, m) => s + (m.operationType === "E" ? m.amount : -m.amount), 0) * 100) / 100;
    if (valor <= 0) { descartados.push({ billId, installmentId, motivo: "VALOR_LIQUIDO_ZERO" }); continue; }

    recebimentos.push({
      billId: billId!, installmentId: installmentId!, clientId: g[0].clientId!, clientName: g[0].clientName,
      contrato: g[0].contrato, paidDate, valor, movementIds: g.map((m) => m.id).sort((a, b) => a - b),
    });
  }
  recebimentos.sort((a, b) => a.paidDate.localeCompare(b.paidDate) || a.billId - b.billId || a.installmentId - b.installmentId);
  return { recebimentos, descartados };
}

// Agrupa por cliente: quem pagou várias parcelas recebe UMA mensagem só.
export function agruparPorCliente(rs: Recebimento[]): Map<number, Recebimento[]> {
  const m = new Map<number, Recebimento[]>();
  for (const r of rs) m.set(r.clientId, [...(m.get(r.clientId) ?? []), r]);
  return m;
}

// Janela da consulta ao bank-movement (datas yyyy-mm-dd). Olha para TRÁS
// (baixa lançada dias depois do pagamento) e para a FRENTE (baixa do retorno
// Bradesco lançada com a data do crédito, ex.: pago na sexta, crédito na
// segunda; ou pagamento antecipado). Nunca começa antes da data de corte.
export function janelaBusca(hoje: string, corte: string, diasAtras: number, diasFrente: number): { inicio: string; fim: string } | null {
  const atras = addDaysKey(hoje, -diasAtras);
  const inicio = atras > corte ? atras : corte;
  const fim = addDaysKey(hoje, diasFrente);
  return inicio > fim ? null : { inicio, fim };
}
