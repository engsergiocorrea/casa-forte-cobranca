import { env } from "../env";
import { toBrazilE164 } from "../safety";

// Cliente server-only para a Evolution API (WhatsApp não-oficial) — MESMO
// formato usado pelos outros apps do ecossistema (casaforte-portal / compras):
//   POST {EVOLUTION_API_URL}/message/sendText/{instance}   body {number, text}
//   POST {EVOLUTION_API_URL}/message/sendMedia/{instance}  body {number, mediatype, mimetype, media, fileName, caption}
//   header: apikey: {EVOLUTION_API_KEY}
// Nunca loga a apikey nem o telefone. Falha de forma controlada (nunca lança).

export type EvolutionResult = { success: boolean; messageId: string | null; error?: string };

function config() {
  const apiUrl = env().EVOLUTION_API_URL.trim().replace(/\/$/, "");
  const apiKey = env().EVOLUTION_API_KEY.trim();
  const instance = env().EVOLUTION_INSTANCE.trim() || "casaforte";
  if (!apiUrl || !apiKey) return null;
  return { apiUrl, apiKey, instance };
}

export function isEvolutionConfigured() {
  return config() !== null;
}

// Evolution espera o número só com dígitos e DDI (ex.: 5582999999999).
function toEvolutionNumber(to: string) {
  return toBrazilE164(to).replace(/\D/g, "");
}

async function post(endpointPath: string, body: Record<string, unknown>): Promise<EvolutionResult> {
  const cfg = config();
  if (!cfg) return { success: false, messageId: null, error: "Evolution API não configurada (EVOLUTION_API_URL/KEY)." };
  const endpoint = `${cfg.apiUrl}${endpointPath.replace("{instance}", cfg.instance)}`;
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    let resp: any = null;
    try { resp = await r.json(); } catch { /* sem corpo JSON */ }
    if (!r.ok) {
      const msg = (resp && typeof resp === "object" && "message" in resp ? String((resp as any).message) : null) ?? `Evolution status ${r.status}`;
      return { success: false, messageId: null, error: String(msg).slice(0, 200) };
    }
    const messageId = resp?.key?.id ?? resp?.messageId ?? null;
    return { success: true, messageId: typeof messageId === "string" ? messageId : null };
  } catch (e: any) {
    return { success: false, messageId: null, error: `Conexão Evolution: ${String(e?.message ?? e).slice(0, 150)}` };
  }
}

export function evolutionSendText(params: { to: string; text: string }): Promise<EvolutionResult> {
  const number = toEvolutionNumber(params.to);
  if (!number || number.length < 12) return Promise.resolve({ success: false, messageId: null, error: "Telefone inválido." });
  return post("/message/sendText/{instance}", { number, text: params.text });
}

export function evolutionSendDocument(params: { to: string; mediaUrl: string; fileName: string; caption?: string }): Promise<EvolutionResult> {
  const number = toEvolutionNumber(params.to);
  if (!number || number.length < 12) return Promise.resolve({ success: false, messageId: null, error: "Telefone inválido." });
  return post("/message/sendMedia/{instance}", {
    number, mediatype: "document", mimetype: "application/pdf",
    caption: params.caption ?? "", media: params.mediaUrl, fileName: params.fileName,
  });
}
