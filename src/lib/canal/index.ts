import { env } from "../env";
import { criarCanalEvolution } from "./evolution";
import type { CanalWhatsApp } from "./tipos";

// Canal ativo, escolhido por WHATSAPP_PROVIDER. A Meta entra na Fase 4
// (templates aprovados + upload de mídia) — ver docs/ARQUITETURA-COMUNICACAO.md §8.
export function canalAtual(): CanalWhatsApp {
  const p = env().WHATSAPP_PROVIDER;
  if (p === "evolution") return criarCanalEvolution();
  throw new Error(`Canal "${p}" ainda não implementado na régua v2 (Fase 4).`);
}

export type { CanalWhatsApp, MensagemPadrao, ResultadoEnvio, ItemParcela, ModeloMensagem } from "./tipos";
