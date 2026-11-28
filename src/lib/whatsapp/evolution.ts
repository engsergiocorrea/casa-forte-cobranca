import { canalWhatsApp, enviarPelaCentral, type ModeloCentral } from "./central";
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
// Número no formato da Evolution: só dígitos, com DDI. Se já vem em E.164
// ("+351…", como sai de normalizeCustomerPhones), é usado como está — antes,
// número estrangeiro curto (ex.: +351 com 8 dígitos = 11 dígitos) caía na
// regra brasileira de "10–11 dígitos = DDD+número" e ganhava um 55 na frente.
// Número plausível para o WhatsApp: DDI + número, entre 10 e 15 dígitos
// (E.164). Antes exigia 12+ (formato do Brasil) e recusava, p.ex., os EUA/Canadá
// (+1 + 10 dígitos = 11) — caso SANTORINI102, 22/10/2026.
export function numeroValido(digitos: string): boolean {
  return /^\d{10,15}$/.test(digitos) && !digitos.startsWith("0");
}

export function toEvolutionNumber(to: string) {
  const s = String(to ?? "").trim();
  if (s.startsWith("+")) return s.replace(/\D/g, "");
  return toBrazilE164(s).replace(/\D/g, "");
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
      // Evolution v2 manda o motivo em response.message (ex.: [{ exists: false, ... }]
      // = número sem WhatsApp). Guarda o status HTTP + o motivo, sem a apikey.
      const motivo = resp?.response?.message ?? resp?.message ?? resp?.error ?? null;
      const msg = `Evolution status ${r.status}${motivo != null ? `: ${typeof motivo === "string" ? motivo : JSON.stringify(motivo)}` : ""}`;
      return { success: false, messageId: null, error: msg.slice(0, 300) };
    }
    const messageId = resp?.key?.id ?? resp?.messageId ?? null;
    return { success: true, messageId: typeof messageId === "string" ? messageId : null };
  } catch (e: any) {
    return { success: false, messageId: null, error: `Conexão Evolution: ${String(e?.message ?? e).slice(0, 150)}` };
  }
}

// O número tem WhatsApp? POST /chat/whatsappNumbers/{instance} → [{ exists, jid }].
// null = não deu para saber (falha de rede/HTTP) — quem chama segue o fluxo normal.
export async function evolutionNumberExists(to: string): Promise<boolean | null> {
  const cfg = config();
  const number = toEvolutionNumber(to);
  if (!cfg || !number) return null;
  try {
    const r = await fetch(`${cfg.apiUrl}/chat/whatsappNumbers/${cfg.instance}`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: cfg.apiKey },
      body: JSON.stringify({ numbers: [number] }), signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const it = Array.isArray(j) ? j[0] : null;
    return typeof it?.exists === "boolean" ? it.exists : null;
  } catch { return null; }
}

// Com o canal "meta" (Portal → WhatsApp), estes dois envios passam pela central.
// `modelo` é o modelo aprovado usado quando a pessoa não falou com o número nas
// últimas 24h; sem ele, vai o "aviso_interno" (Financeiro) com o texto.
export async function evolutionSendText(params: { to: string; text: string; modelo?: ModeloCentral; origem?: string }): Promise<EvolutionResult> {
  const number = toEvolutionNumber(params.to);
  if (!numeroValido(number)) return { success: false, messageId: null, error: "Telefone inválido." };
  if ((await canalWhatsApp()) === "meta") {
    return enviarPelaCentral({ para: number, texto: params.text, origem: params.origem ?? "financeiro", modelo: params.modelo ?? avisoPadrao(params.text) });
  }
  return post("/message/sendText/{instance}", { number, text: params.text });
}

function avisoPadrao(texto: string): ModeloCentral {
  const plano = texto.replace(/\*/g, "").trim();
  // Régua de cobrança (textos de canal/modelos.ts): "📅 Vencimento hoje" / "⚠️ Parcela(s) em aberto".
  const regua = /^(📅|⚠️)/u.exec(plano);
  if (regua) {
    const corpo = plano.split("\n").slice(1).join("\n").trim();
    const nome = (corpo.split(",")[0] ?? "").trim().slice(0, 40) || "Cliente";
    const parcelas = corpo.split("\n").slice(1).filter((l) => /🏠|📄|📅|💰|🔢|🔗/u.test(l)).join(" · ").slice(0, 900) || "-";
    return { nome: regua[1] === "📅" ? "lembrete_vencimento" : "cobranca_atraso", campos: { nome, parcelas } };
  }
  const [primeira, ...resto] = plano.split("\n");
  return { nome: "aviso_interno", campos: { assunto: primeira.replace(/^\W+/u, "").trim().slice(0, 60) || "Financeiro", texto: (resto.join(" ").trim() || plano).slice(0, 900), quem: "Financeiro" } };
}

// `mediaUrl` vai no campo `media` da Evolution: aceita URL pública OU base64 puro.
export async function evolutionSendDocument(params: { to: string; mediaUrl: string; fileName: string; caption?: string; modelo?: ModeloCentral; origem?: string }): Promise<EvolutionResult> {
  const number = toEvolutionNumber(params.to);
  if (!numeroValido(number)) return { success: false, messageId: null, error: "Telefone inválido." };
  if ((await canalWhatsApp()) === "meta") {
    const ehUrl = /^https?:\/\//.test(params.mediaUrl);
    return enviarPelaCentral({
      para: number,
      texto: params.caption,
      documento: ehUrl ? { url: params.mediaUrl, nome: params.fileName, mime: "application/pdf" } : { base64: params.mediaUrl, nome: params.fileName, mime: "application/pdf" },
      origem: params.origem ?? "financeiro",
      modelo: params.modelo, // sem modelo: só sai dentro da janela de 24h
    });
  }
  return post("/message/sendMedia/{instance}", {
    number, mediatype: "document", mimetype: "application/pdf",
    caption: params.caption ?? "", media: params.mediaUrl, fileName: params.fileName,
  });
}
