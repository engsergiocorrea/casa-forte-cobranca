import { describe, expect, it } from "vitest";
import { bodyParameters, previewMensagem, templateNameFor } from "../src/lib/collection/messages";

const d = { nome: "Bruna", imovel: "Umá Milagres — A-03", vencimento: "10/09/2026", valor: "R$ 1.234,56" };

describe("mensagens de cobrança", () => {
  it("body params na ordem nome/imovel/venc/valor", () => {
    expect(bodyParameters(d)).toEqual(["Bruna", "Umá Milagres — A-03", "10/09/2026", "R$ 1.234,56"]);
  });
  it("templateName por etapa", () => {
    expect(templateNameFor("D-10")).toContain("d_menos_10");
    expect(templateNameFor("D0")).toContain("vence_hoje");
    expect(templateNameFor("D+1")).toContain("atraso");
  });
  it("preview inclui os dados e difere por etapa", () => {
    const a = previewMensagem("D-10", d), b = previewMensagem("D0", d), c = previewMensagem("D+1", d);
    for (const t of [a, b, c]) { expect(t).toContain("Bruna"); expect(t).toContain("R$ 1.234,56"); }
    expect(a).toContain("10 dias");
    expect(b).toContain("vence hoje");
    expect(c).toContain("em aberto");
  });
  it("todas as etapas avisam a senha do boleto (5 primeiros dígitos do CPF/CNPJ)", () => {
    for (const etapa of ["D-10", "D0", "D+1"] as const) {
      const t = previewMensagem(etapa, d);
      expect(t).toMatch(/5 primeiros d[íi]gitos/i);
      expect(t).toMatch(/CPF/i);
    }
  });
});

import { normalizePaymentSlip, normalizeInstallmentRow } from "../src/lib/sienge/mapper";
describe("mapper de parcela e boleto (schema real)", () => {
  it("boleto: extrai url e linha digitável de results[]", () => {
    const b = normalizePaymentSlip({ results: [{ urlReport: "https://x/boleto.pdf", digitableNumber: "23790.001" }] });
    expect(b.url).toBe("https://x/boleto.pdf");
    expect(b.linhaDigitavel).toBe("23790.001");
  });
  it("parcela: saldo=0 marca paga; usa balanceDue e generatedBoleto", () => {
    const p = normalizeInstallmentRow({ receivableBillId: 40, installmentId: 2, dueDate: "2026-09-10", balanceDue: 0, generatedBoleto: true });
    expect(p.paid).toBe(true); expect(p.generatedBoleto).toBe(true); expect(p.installmentId).toBe(2);
  });
});
