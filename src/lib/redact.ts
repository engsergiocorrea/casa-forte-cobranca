// Redação de PII para exibição/auditoria de payloads do Sienge em staging.
// Mantém a ESTRUTURA (chaves) intacta — é o que precisamos para cristalizar o
// mapper — mas mascara valores sensíveis (CPF/CNPJ, e-mail, telefone).
// Regra do CLAUDE.md: "Preserve payload bruto redigido para auditoria durante
// staging; não exponha CPF/telefone em logs de produção."

const PII_KEY = /cpf|cnpj|document|email|e-mail|phone|telefone|celular|mobile|\brg\b/i;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/;
const PHONE_RE = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}\b/;

export function maskValue(v: unknown): string {
  const s = String(v ?? "");
  if (s.length <= 4) return "••••";
  return `${s.slice(0, 2)}${"•".repeat(Math.min(s.length - 4, 8))}${s.slice(-2)}`;
}

function looksLikePii(s: string): boolean {
  return CPF_RE.test(s) || CNPJ_RE.test(s) || EMAIL_RE.test(s);
}

export function redact(value: unknown, keyHint = ""): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, keyHint));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redact(v, k);
    return out;
  }
  if (PII_KEY.test(keyHint)) return maskValue(value);
  if (typeof value === "string" && looksLikePii(value)) return maskValue(value);
  return value;
}

// Para mensagens de erro (podem ecoar trechos do corpo da resposta).
export function redactText(s: string): string {
  return s
    .replace(new RegExp(CPF_RE, "g"), "•CPF•")
    .replace(new RegExp(CNPJ_RE, "g"), "•CNPJ•")
    .replace(new RegExp(EMAIL_RE, "g"), "•EMAIL•")
    .replace(new RegExp(PHONE_RE, "g"), "•FONE•");
}
