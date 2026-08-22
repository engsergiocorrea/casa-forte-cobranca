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

export function canSendTo(phone: string, cfg: SafetyConfig) {
  const normalized = normalizePhone(phone);
  if (!cfg.outboundEnabled) return { allowed: false, reason: "MASTER_SWITCH_OFF" } as const;
  if (cfg.dryRun) return { allowed: false, reason: "DRY_RUN" } as const;
  const allowed = new Set(cfg.allowlist.map(normalizePhone));
  if (allowed.has(normalized)) return { allowed: true, reason: "ALLOWLIST" } as const;
  if (cfg.appMode === "production" && cfg.allowAllProduction) return { allowed: true, reason: "PRODUCTION_ALL" } as const;
  return { allowed: false, reason: "NOT_ALLOWLISTED" } as const;
}
