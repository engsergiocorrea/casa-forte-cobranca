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
});
