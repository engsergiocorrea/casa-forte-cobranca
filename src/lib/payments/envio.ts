import { evolutionSendDocument, evolutionSendText, type EvolutionResult } from "../whatsapp/evolution";

// Envio de UMA confirmação: só texto, ou PDF do comprovante com o texto como
// legenda. Regras:
//  - pdfEnabled=false → sendText (comportamento original);
//  - falha ao GERAR o PDF → sendText e devolve pdfErro (nada foi enviado ainda);
//  - falha ao ENVIAR o documento → devolve o erro e NUNCA tenta sendText
//    depois (a mensagem pode ter saído; reenviar arrisca duplicar).
// As dependências são injetáveis para testar sem rede.

export type EnvioDeps = {
  sendText: typeof evolutionSendText;
  sendDocument: typeof evolutionSendDocument;
};

export type EnvioParams = {
  to: string;
  texto: string;
  pdfEnabled: boolean;
  fileName: string;
  gerarPdf: () => Promise<Uint8Array>;
};

export type EnvioResultado = { result: EvolutionResult; via: "text" | "document"; pdfErro?: string };

export async function enviarConfirmacao(p: EnvioParams, deps: EnvioDeps = { sendText: evolutionSendText, sendDocument: evolutionSendDocument }): Promise<EnvioResultado> {
  if (!p.pdfEnabled) return { result: await deps.sendText({ to: p.to, text: p.texto }), via: "text" };

  let pdf: Uint8Array;
  try {
    pdf = await p.gerarPdf();
  } catch (err: any) {
    const pdfErro = String(err?.message ?? err).slice(0, 150);
    return { result: await deps.sendText({ to: p.to, text: p.texto }), via: "text", pdfErro };
  }

  // Evolution aceita URL ou base64 puro em `media`.
  const result = await deps.sendDocument({ to: p.to, mediaUrl: Buffer.from(pdf).toString("base64"), fileName: p.fileName, caption: p.texto });
  return { result, via: "document" };
}
