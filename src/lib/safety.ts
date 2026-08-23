export type SafetyConfig = {
  appMode: "staging" | "production";
  outboundEnabled: boolean;
  dryRun: boolean;
  allowAllProduction: boolean;
  allowlist: string[];
};

export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

// Telefone do Sienge → E.164 brasileiro. O Sienge costuma guardar sem o DDI
// (ex.: "82 99999-9999"); o WhatsApp exige o país (55). Regras: 12–13 dígitos
// começando com 55 já têm país; 10–11 dígitos (DDD+número) recebem 55; demais
// casos ficam como estão (melhor esforço).
export function toBrazilE164(raw: string): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return `+${d}`;
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  return `+${d}`;
}

export function canSendTo(phone: string, cfg: SafetyConfig) {
  const normalized = normalizePhone(phone);
  if (!cfg.outboundEnabled) return { allowed: false, reason: "MASTER_SWITCH_OFF" } as const;
  if (cfg.dryRun) return { allowed: false, reason: "DRY_RUN" } as const;
  const allowed = new Set(cfg.allowlist.map(normalizePhone));
  if (allowed.has(normalized)) return { allowed: true, reason: "ALLOWLIST" } as const;
  if (cfg.appMode === "production" && cfg.allowAllProduction) return { allowed: true, reason: "PRODUCTION_ALL" } as const;
  return { allowed: false, reason: "NOT_ALLOWLISTED" } as const;
}
