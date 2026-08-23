import { env } from "../env";

// Introspecção READ-ONLY dos templates na Meta (WhatsApp Manager).
// Confirma se um template está APROVADO e qual a estrutura real (nº de
// variáveis do corpo, existência de botão de URL dinâmico) — para enviarmos
// exatamente o que a Meta espera, sem supor. Mesma regra do Sienge: capturar a
// estrutura real da API, nunca inventar. Nunca expõe o token.
export type TemplateInfo = {
  name: string;
  found: boolean;
  status: string | null; // APPROVED | PENDING | REJECTED | PAUSED | ...
  category: string | null;
  language: string | null;
  bodyParamCount: number | null;
  hasUrlButton: boolean;
  urlButtonHasVariable: boolean;
  error?: string;
};

const empty = (name: string): TemplateInfo => ({
  name, found: false, status: null, category: null, language: null,
  bodyParamCount: null, hasUrlButton: false, urlButtonHasVariable: false,
});

export async function getTemplateInfo(name: string): Promise<TemplateInfo> {
  const e = env();
  if (!e.WHATSAPP_ACCESS_TOKEN || !e.WHATSAPP_WABA_ID) return { ...empty(name), error: "sem_credenciais" };
  try {
    const url = `https://graph.facebook.com/${e.META_GRAPH_API_VERSION}/${e.WHATSAPP_WABA_ID}/message_templates?name=${encodeURIComponent(name)}&limit=10`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${e.WHATSAPP_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(15_000), cache: "no-store",
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ...empty(name), error: `meta_${r.status}` };
    const list: any[] = Array.isArray(j?.data) ? j.data : [];
    const t = list.find((x) => x?.name === name) ?? list[0];
    if (!t) return empty(name);
    const comps: any[] = Array.isArray(t.components) ? t.components : [];
    const body = comps.find((c) => c?.type === "BODY");
    const bodyParamCount = body?.text ? (String(body.text).match(/\{\{\d+\}\}/g) || []).length : 0;
    const buttons: any[] = comps.find((c) => c?.type === "BUTTONS")?.buttons ?? [];
    const urlBtn = buttons.find((b) => b?.type === "URL");
    return {
      name, found: true,
      status: t.status ?? null, category: t.category ?? null, language: t.language ?? null,
      bodyParamCount,
      hasUrlButton: !!urlBtn,
      urlButtonHasVariable: !!urlBtn && /\{\{\d+\}\}/.test(String(urlBtn?.url ?? "")),
    };
  } catch (err: any) {
    return { ...empty(name), error: String(err?.message ?? err).slice(0, 120) };
  }
}
