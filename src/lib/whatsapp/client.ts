import { env } from "../env";
import { canSendTo, normalizePhone } from "../safety";

export type TemplateParameter = { type: "text"; text: string };
// urlButtonParam: valor da variável do BOTÃO de URL do template (ex.: link do
// boleto), quando o template aprovado tiver um botão de URL dinâmico. Só é
// enviado se informado — caso contrário a mensagem sai só com o corpo.
export type SendTemplateInput = { to: string; templateName: string; languageCode: string; bodyParameters?: string[]; urlButtonParam?: string };

export async function sendWhatsAppTemplate(input: SendTemplateInput) {
  const e = env();
  const allowlist = e.WHATSAPP_ALLOWLIST.split(",").map(s => s.trim()).filter(Boolean);
  const gate = canSendTo(input.to, {
    appMode: e.APP_MODE, outboundEnabled: e.OUTBOUND_MESSAGING_ENABLED, dryRun: e.WHATSAPP_DRY_RUN,
    allowAllProduction: e.WHATSAPP_ALLOW_ALL_PRODUCTION, allowlist
  });
  if (!gate.allowed) {
    if (gate.reason === "DRY_RUN" || gate.reason === "MASTER_SWITCH_OFF") {
      console.log("[WHATSAPP SAFE MODE]", gate.reason, { ...input, to: normalizePhone(input.to) });
      return { id: `dryrun_${crypto.randomUUID()}`, dryRun: true, reason: gate.reason };
    }
    throw new Error(`Envio bloqueado pela segurança: ${gate.reason} (${normalizePhone(input.to)})`);
  }
  if (!e.WHATSAPP_ACCESS_TOKEN || !e.WHATSAPP_PHONE_NUMBER_ID || e.META_GRAPH_API_VERSION.includes("XX")) {
    throw new Error("Credenciais/versão Meta incompletas.");
  }
  const components: any[] = [];
  if (input.bodyParameters?.length) {
    components.push({ type: "body", parameters: input.bodyParameters.map(text => ({ type: "text", text })) });
  }
  if (input.urlButtonParam) {
    // Botão de URL dinâmico (o valor é só o trecho variável do link do template).
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: input.urlButtonParam }] });
  }
  const res = await fetch(`https://graph.facebook.com/${e.META_GRAPH_API_VERSION}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${e.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", recipient_type: "individual", to: normalizePhone(input.to).slice(1), type: "template",
      template: { name: input.templateName, language: { code: input.languageCode }, ...(components.length ? { components } : {}) }
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${JSON.stringify(body).slice(0, 800)}`);
  const id = body?.messages?.[0]?.id;
  if (!id) throw new Error(`WhatsApp sem message id: ${JSON.stringify(body).slice(0, 800)}`);
  return { id, dryRun: false };
}
