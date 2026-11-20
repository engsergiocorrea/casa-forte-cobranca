import { evolutionNumberExists, evolutionSendDocument, evolutionSendText, type EvolutionResult } from "../whatsapp/evolution";
import { renderTexto } from "./modelos";
import type { CanalWhatsApp, ItemParcela, MensagemPadrao, ResultadoEnvio } from "./tipos";

// Canal Evolution (WhatsApp via QR, texto livre). Com anexo: documento com o
// texto como legenda; sem anexo: só texto. Nunca cai de documento para texto
// depois de uma tentativa (risco de duplicar).
//
// Boleto em PDF: o link do Sienge (urlReport) baixa o PDF sem login (protegido
// pela senha do CPF). O PDF é baixado ANTES de qualquer envio; se falhar, a
// mensagem sai como hoje (texto com o link) — nada é enviado duas vezes.
//   1 parcela  → o PDF vai como documento, com a mensagem como legenda;
//   2+ parcelas → a mensagem em texto e, logo depois, um PDF por parcela
//                 (os PDFs extras não mudam o status: a mensagem já saiu).

export type EvolutionDeps = {
  sendText: typeof evolutionSendText;
  sendDocument: typeof evolutionSendDocument;
  numberExists: typeof evolutionNumberExists;
  baixarPdf?: (url: string) => Promise<string | null>;
};

// PDF do boleto em base64, ou null (link expirado, página de erro, timeout).
export async function baixarPdfBoleto(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 500 || buf.length > 8_000_000 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
    return buf.toString("base64");
  } catch { return null; }
}

const DEPS: EvolutionDeps = { sendText: evolutionSendText, sendDocument: evolutionSendDocument, numberExists: evolutionNumberExists, baixarPdf: baixarPdfBoleto };

const resultado = (r: EvolutionResult): ResultadoEnvio => ({
  sucesso: r.success,
  providerMessageId: r.messageId,
  erro: r.error,
  incerto: !r.success && String(r.error ?? "").startsWith("Conexão Evolution"),
});

export const nomeArquivoBoleto = (i: ItemParcela) =>
  `Boleto Casa Forte - parcela ${i.parcela.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "")}.pdf`;

export function criarCanalEvolution(deps: EvolutionDeps = DEPS): CanalWhatsApp {
  return {
    nome: "evolution",
    numeroTemWhatsApp: (e164) => deps.numberExists(e164),
    async enviar(msg: MensagemPadrao, para: string) {
      const texto = renderTexto(msg);
      const media = msg.anexo?.url ?? msg.anexo?.base64;
      if (msg.anexo && media) {
        return resultado(await deps.sendDocument({ to: para, mediaUrl: media, fileName: msg.anexo.nomeArquivo, caption: texto }));
      }

      const baixar = deps.baixarPdf;
      const pdfs = baixar
        ? await Promise.all(msg.itens.map(async (i) => (i.boletoUrl ? { nome: nomeArquivoBoleto(i), base64: await baixar(i.boletoUrl) } : null)))
        : [];
      const prontos = pdfs.filter((p): p is { nome: string; base64: string } => Boolean(p?.base64));

      // O link do boleto do Sienge expira em 5 minutos: com o PDF anexado, ele
      // sai do texto (fica a linha digitável). Sem PDF, o link continua.
      const semLink = (m: MensagemPadrao) => renderTexto({ ...m, itens: m.itens.map((i) => ({ ...i, boletoUrl: null })) });
      if (msg.itens.length === 1 && prontos.length === 1) {
        return resultado(await deps.sendDocument({ to: para, mediaUrl: prontos[0].base64, fileName: prontos[0].nome, caption: semLink(msg) }));
      }
      const todosComPdf = prontos.length > 0 && prontos.length === msg.itens.filter((i) => i.boletoUrl).length;
      const r = resultado(await deps.sendText({ to: para, text: todosComPdf ? semLink(msg) : texto }));
      if (r.sucesso) for (const p of prontos) await deps.sendDocument({ to: para, mediaUrl: p.base64, fileName: p.nome }).catch(() => null);
      return r;
    },
  };
}
