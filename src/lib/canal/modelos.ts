import type { ItemParcela, MensagemPadrao, ModeloMensagem } from "./tipos";

// Catálogo de modelos de mensagem. Para cada modelo:
//  - texto livre (usado pela Evolution e como prévia/auditoria);
//  - nome do template Meta + variáveis em ordem ({{1}}..{{n}}) para a Fase 4.
// Tom formal, mesmo padrão da confirmação de pagamento (sem "Oi").

export const SENHA_BOLETO = "🔒 A senha para abrir o boleto são os 5 primeiros dígitos do seu CPF (ou CNPJ).";
const RODAPE = "🤖 Esta é uma mensagem automática da Casa Forte. Em caso de dúvida, basta responder esta mensagem.\n\n#aquiécasaforte";

function linhasParcela(i: ItemParcela, rotuloVenc: string): string {
  return [
    `📄 Parcela ${i.parcela}`,
    `📅 ${rotuloVenc}: ${i.vencimento}`,
    `💰 ${i.valor}`,
    i.linhaDigitavel ? `🔢 Linha digitável: ${i.linhaDigitavel}` : null,
    i.boletoUrl ? `🔗 Boleto: ${i.boletoUrl}` : null,
  ].filter(Boolean).join("\n");
}

// Agrupa as parcelas por imóvel: o imóvel aparece uma vez, com suas parcelas embaixo.
function blocos(itens: ItemParcela[], rotuloVenc = "Vencimento"): string {
  const porImovel = new Map<string, ItemParcela[]>();
  for (const i of itens) porImovel.set(i.imovel, [...(porImovel.get(i.imovel) ?? []), i]);
  return [...porImovel].map(([imovel, ps]) => `🏠 ${imovel}\n\n${ps.map((p) => linhasParcela(p, rotuloVenc)).join("\n\n")}`).join("\n\n");
}

export function renderTexto(m: MensagemPadrao): string {
  const plural = m.itens.length > 1;
  const temBoleto = m.itens.some((i) => i.boletoUrl || i.linhaDigitavel);
  const senha = temBoleto ? `\n\n${SENHA_BOLETO}` : "";

  if (m.modelo === "boleto_mes") {
    return `📄 ${plural ? "Boletos disponíveis" : "Boleto disponível"}\n\n${m.nome}, ${plural ? "seguem os boletos das parcelas" : "segue o boleto da parcela"} do seu imóvel:\n\n${blocos(m.itens)}${senha}\n\n${RODAPE}`;
  }
  if (m.modelo === "lembrete_vencimento") {
    return `📅 Vencimento hoje\n\n${m.nome}, lembramos que ${plural ? "as parcelas abaixo vencem" : "a parcela abaixo vence"} hoje:\n\n${blocos(m.itens)}${senha}\n\nSe o pagamento já foi feito, por favor desconsidere esta mensagem.\n\n${RODAPE}`;
  }
  // cobranca_atraso — cita o boleto só quando ele existe
  const pedido = temBoleto
    ? "Pedimos a gentileza de regularizar o pagamento. Os dados para pagamento seguem abaixo:"
    : "Pedimos a gentileza de regularizar o pagamento:";
  return `⚠️ ${plural ? "Parcelas em aberto" : "Parcela em aberto"}\n\n${m.nome}, consta${plural ? "m" : ""} em aberto ${plural ? "as parcelas abaixo" : "a parcela abaixo"}. ${pedido}\n\n${blocos(m.itens, "Vencida em")}${senha}\n\nSe o pagamento já foi feito, por favor desconsidere esta mensagem.\n\n${RODAPE}`;
}

// Fase 4 (Meta): nome do template aprovado e variáveis na ordem do template.
// Com várias parcelas, a Meta recebe a lista já formatada numa variável só.
export const TEMPLATE_META: Record<ModeloMensagem, string> = {
  boleto_mes: "boleto_mes",
  lembrete_vencimento: "lembrete_vencimento",
  cobranca_atraso: "cobranca_atraso",
};
export function variaveisMeta(m: MensagemPadrao): string[] {
  const lista = m.itens.map((i) => `${i.imovel} · parcela ${i.parcela} · ${i.vencimento} · ${i.valor}`).join(" | ");
  return [m.nome, lista];
}
