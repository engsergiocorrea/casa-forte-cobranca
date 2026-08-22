import { describe, expect, it } from "vitest";
import { daysFromDue } from "../src/lib/collection/date";
describe("collection offsets", () => {
  it("D-3", () => expect(daysFromDue(new Date("2026-09-07T12:00:00Z"), new Date("2026-09-10T12:00:00Z"))).toBe(-3));
  // "hoje" precisa cair no dia 10 no fuso America/Maceio: 12:00Z = 09:00 em Maceio (dia 10).
  // (01:00Z seria 22:00 do dia 9 em Maceio — coberto pelo teste de fuso abaixo.)
  it("D0", () => expect(daysFromDue(new Date("2026-09-10T12:00:00Z"), new Date("2026-09-10T23:00:00Z"))).toBe(0));
  it("D+7", () => expect(daysFromDue(new Date("2026-09-17T12:00:00Z"), new Date("2026-09-10T12:00:00Z"))).toBe(7));
  it("não vira o dia cedo demais por causa do UTC", () => expect(daysFromDue(new Date("2026-09-10T01:00:00Z"), new Date("2026-09-10T12:00:00Z"), "America/Maceio")).toBe(-1));
});
