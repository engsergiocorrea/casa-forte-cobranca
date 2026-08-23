// Mensagens de cobrança da Casa Forte (WhatsApp).
// No WhatsApp oficial (Meta), mensagens proativas exigem TEMPLATE aprovado.
// Aqui ficam: o nome do template, os parâmetros na ordem ({{1}}..{{n}}) e um
// "preview" em texto — usado no modo dry-run para registrar exatamente o que
// SERIA enviado, sem enviar. Os textos para submissão à Meta estão em
// docs/WHATSAPP-TEMPLATES.md e devem bater com estes.

export type EtapaRegua = "D-10" | "D0" | "D+1";

export type DadosCobranca = {
  nome: string;          // 1o nome do cliente
  imovel: string;        // empreendimento + unidade (ex.: "Umá Milagres — A-03")
  vencimento: string;    // dd/mm/aaaa
  valor: string;         // "R$ 1.234,56"
};

// Ordem dos parâmetros do template ({{1}}..{{4}}) — a mesma para as 3 etapas.
export function bodyParameters(d: DadosCobranca): string[] {
  return [d.nome, d.imovel, d.vencimento, d.valor];
}

export function templateNameFor(etapa: EtapaRegua): string {
  if (etapa === "D-10") return process.env.WA_TEMPLATE_D_MINUS_10 || "cf_cobranca_d_menos_10";
  if (etapa === "D0") return process.env.WA_TEMPLATE_DUE_TODAY || "cf_cobranca_vence_hoje";
  return process.env.WA_TEMPLATE_D_PLUS_1 || "cf_cobranca_atraso_1d";
}

// Preview textual (o que o cliente veria) — para o dry-run e para conferência.
export function previewMensagem(etapa: EtapaRegua, d: DadosCobranca): string {
  if (etapa === "D-10") {
    return `Olá, ${d.nome}! Aqui é da Casa Forte. A parcela do seu imóvel ${d.imovel} vence em ${d.vencimento} (faltam 10 dias), no valor de ${d.valor}. Segue o boleto para pagamento. Qualquer dúvida, é só responder por aqui.`;
  }
  if (etapa === "D0") {
    return `Olá, ${d.nome}! A parcela do seu imóvel ${d.imovel} vence hoje (${d.vencimento}), no valor de ${d.valor}. Segue o boleto. Se o pagamento já foi feito, por favor desconsidere. Obrigado! — Casa Forte`;
  }
  return `Olá, ${d.nome}. A parcela do seu imóvel ${d.imovel}, com vencimento em ${d.vencimento} (${d.valor}), consta em aberto. Segue o boleto atualizado. Se já efetuou o pagamento, desconsidere; para negociar, fale com a gente. — Casa Forte`;
}
