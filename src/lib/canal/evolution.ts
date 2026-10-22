import { evolutionNumberExists, evolutionSendDocument, evolutionSendText, type EvolutionResult } from "../whatsapp/evolution";
import { renderTexto } from "./modelos";
import type { CanalWhatsApp, MensagemPadrao, ResultadoEnvio } from "./tipos";

// Canal Evolution (WhatsApp via QR, texto livre). Com anexo: documento com o
// texto como legenda; sem anexo: só texto. Nunca cai de documento para texto
// depois de uma tentativa (risco de duplicar).

export type EvolutionDeps = {
  sendText: typeof evolutionSendText;
  sendDocument: typeof evolutionSendDocument;
  numberExists: typeof evolutionNumberExists;
};
const DEPS: EvolutionDeps = { sendText: evolutionSendText, sendDocument: evolutionSendDocument, numberExists: evolutionNumberExists };

const resultado = (r: EvolutionResult): ResultadoEnvio => ({
  sucesso: r.success,
  providerMessageId: r.messageId,
  erro: r.error,
  incerto: !r.success && String(r.error ?? "").startsWith("Conexão Evolution"),
});

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
      return resultado(await deps.sendText({ to: para, text: texto }));
    },
  };
}
