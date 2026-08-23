import { describe, expect, it } from "vitest";
import { redact, redactText } from "../src/lib/redact";

describe("redação de PII (payload redigido)", () => {
  it("mascara valor por chave sensível, preservando a estrutura", () => {
    const out = redact({ cpf: "123.456.789-01", name: "Fulano", nested: { email: "a@b.com" } }) as any;
    expect(out.cpf).not.toContain("123.456");
    expect(out.name).toBe("Fulano");
    expect(out.nested.email).not.toContain("a@b.com");
    expect(Object.keys(out)).toEqual(["cpf", "name", "nested"]);
  });
  it("mascara CPF/e-mail mesmo em chave neutra", () => {
    const out = redact({ obs: "contato: joao@x.com", doc2: "111.222.333-44" }) as any;
    expect(out.obs).not.toContain("joao@x.com");
    expect(out.doc2).not.toContain("111.222.333-44");
  });
  it("arrays e não-PII passam intactos", () => {
    const out = redact({ items: [{ value: 1200.5, dueDate: "2026-09-10" }] }) as any;
    expect(out.items[0].value).toBe(1200.5);
    expect(out.items[0].dueDate).toBe("2026-09-10");
  });
  it("redactText limpa CPF/e-mail de mensagens de erro", () => {
    const s = redactText("erro cliente 123.456.789-01 contato a@b.com");
    expect(s).not.toContain("123.456.789-01");
    expect(s).not.toContain("a@b.com");
  });
});
