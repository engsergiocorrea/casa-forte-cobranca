import { describe, expect, it } from "vitest";
import { canSendTo, normalizePhone } from "../src/lib/safety";
const base = { appMode: "staging" as const, outboundEnabled: false, dryRun: true, allowAllProduction: false, allowlist: ["+5582999999999"] };
describe("WhatsApp safety gate", () => {
  it("normaliza telefone", () => expect(normalizePhone("(82) 99999-9999")).toBe("+82999999999"));
  it("master switch bloqueia tudo", () => expect(canSendTo("+5582999999999", base).allowed).toBe(false));
  it("dry run bloqueia chamada externa", () => expect(canSendTo("+5582999999999", { ...base, outboundEnabled: true }).reason).toBe("DRY_RUN"));
  it("staging só libera allowlist quando dry-run off", () => expect(canSendTo("+5582999999999", { ...base, outboundEnabled: true, dryRun: false }).allowed).toBe(true));
  it("staging bloqueia número fora da allowlist", () => expect(canSendTo("+5582888888888", { ...base, outboundEnabled: true, dryRun: false }).allowed).toBe(false));
  it("production continua fechado sem liberação explícita", () => expect(canSendTo("+5582888888888", { ...base, appMode: "production", outboundEnabled: true, dryRun: false }).allowed).toBe(false));
});

import { toEvolutionNumber } from "../src/lib/whatsapp/evolution";
describe("número para a Evolution", () => {
  it("E.164 estrangeiro curto não vira número brasileiro", () => {
    expect(toEvolutionNumber("+35191234567")).toBe("35191234567");
    expect(toEvolutionNumber("+351912345678")).toBe("351912345678");
  });
  it("número brasileiro sem DDI continua ganhando o 55", () => {
    expect(toEvolutionNumber("(82) 99999-9999")).toBe("5582999999999");
    expect(toEvolutionNumber("+5582999999999")).toBe("5582999999999");
  });
});

