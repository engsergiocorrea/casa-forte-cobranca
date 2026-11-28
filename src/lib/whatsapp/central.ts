import { env } from "../env";

// Central de WhatsApp da Casa Forte (no braIAn). Enquanto o canal for
// "evolution", o Financeiro segue enviando direto pela Evolution; quando a
// diretoria troca para "meta" no Portal (/whatsapp), os envios passam pela
// central (número oficial na Meta: texto em 24h, modelo aprovado fora disso).
// Autenticação: BRAIN_API_TOKEN (o mesmo que o braIAn usa para falar com o Financeiro).

export type ModeloCentral = { nome: string; campos: Record<string, string> };

let cache: { ate: number; canal: "evolution" | "meta" } | null = null;

const base = () => (env().BRAIN_URL || "https://casaforte-ia-production.up.railway.app").replace(/\/$/, "");

export async function canalWhatsApp(): Promise<"evolution" | "meta"> {
  if (cache && cache.ate > Date.now()) return cache.canal;
  let canal: "evolution" | "meta" = "evolution";
  const chave = env().BRAIN_API_TOKEN;
  if (chave) {
    try {
      const r = await fetch(`${base()}/central/config`, { headers: { Authorization: `Bearer ${chave}` }, cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (r.ok) canal = ((await r.json()) as { canal?: string }).canal === "meta" ? "meta" : "evolution";
    } catch { /* central fora: mantém Evolution */ }
  }
  cache = { ate: Date.now() + 30_000, canal };
  return canal;
}

export async function enviarPelaCentral(p: {
  para: string;
  texto?: string;
  documento?: { base64?: string; url?: string; nome: string; mime?: string };
  modelo?: ModeloCentral;
  origem: string;
}): Promise<{ success: boolean; messageId: string | null; error?: string }> {
  try {
    const r = await fetch(`${base()}/central/enviar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env().BRAIN_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(p),
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; erro?: string; wamid?: string };
    return j.ok ? { success: true, messageId: j.wamid ?? null } : { success: false, messageId: null, error: j.erro ?? `central ${r.status}` };
  } catch (e) {
    return { success: false, messageId: null, error: `Conexão central: ${(e as Error).message}` };
  }
}
