// Regra de liberação (decisão do usuário 25/11/2026): a comissão inteira fica
// disponível quando o SINAL do contrato estiver totalmente pago no Sienge.
// No Sienge o sinal é a condição de pagamento com conditionTypeId "SI"
// (conferido nos contratos SANTORINI102 e SANTORINI-008); pode haver várias
// linhas SI (sinal parcelado). Funções puras — testadas em tests/comissoes.test.ts.

export type CondicaoSienge = {
  conditionTypeId?: string; totalValue?: number; amountPaid?: number;
  outstandingBalance?: number; statusSituacao?: string;
};

export type SituacaoSinal = {
  temSinal: boolean;   // o contrato tem condição SI
  quitado: boolean;    // todas as condições SI pagas
  total: number;
  pago: number;
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function situacaoSinal(contrato: { paymentConditions?: CondicaoSienge[] | null } | null | undefined): SituacaoSinal {
  const sinais = (contrato?.paymentConditions ?? []).filter((c) => String(c?.conditionTypeId ?? "").trim().toUpperCase() === "SI");
  const total = sinais.reduce((s, c) => s + num(c.totalValue), 0);
  const pago = sinais.reduce((s, c) => s + num(c.amountPaid), 0);
  // Quitada = Sienge marca PAGO, ou saldo zerado com algo pago. Na dúvida, NÃO libera.
  const quitada = (c: CondicaoSienge) =>
    String(c.statusSituacao ?? "").toUpperCase() === "PAGO" || (num(c.outstandingBalance) <= 0.005 && num(c.amountPaid) > 0);
  return { temSinal: sinais.length > 0, quitado: sinais.length > 0 && sinais.every(quitada), total: round(total), pago: round(pago) };
}

const round = (n: number) => Math.round(n * 100) / 100;

// "CASA 108", "CASA108", "Casa 108" → "CASA108" (para casar unidade do
// Contratos com a do Sienge).
export const chaveUnidade = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^([A-Z]+)0+(\d)/, "$1$2");

// "Casas Santorini" ~ "SANTORINI"; "UMÁ Milagres" ~ "UMÁ MILAGRES".
export function mesmoEmpreendimento(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\b(CASAS?|CONDOMINIO|RESIDENCIAL|EMPREENDIMENTO)\b/g, "").replace(/[^A-Z0-9]/g, "");
  const x = n(a), y = n(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}
