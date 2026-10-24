import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("../src/lib/env", () => ({ env: () => ({ BRAIN_API_TOKEN: process.env.TESTE_BRAIN_TOKEN ?? "" }) }));
const { usuarioPainel } = await import("../src/lib/painel/auth");

const req = (headers: Record<string, string>) => new NextRequest("https://cobranca.test/api/painel/clientes?q=x", { headers });
const TOKEN = "token-do-brain-1234567890";
afterEach(() => { delete process.env.TESTE_BRAIN_TOKEN; delete process.env.DASHBOARD_USERS; });

describe("Casa Forte Brain no painel", () => {
  it("rota liberada aceita o token do Brain e registra quem pediu", () => {
    process.env.TESTE_BRAIN_TOKEN = TOKEN;
    expect(usuarioPainel(req({ authorization: `Bearer ${TOKEN}`, "x-brain-ator": "Sérgio" }), { brain: true })).toEqual({ usuario: "brain:sergio" });
  });
  it("rota não liberada recusa o token, mesmo correto", () => {
    process.env.TESTE_BRAIN_TOKEN = TOKEN;
    expect("erro" in usuarioPainel(req({ authorization: `Bearer ${TOKEN}` }))).toBe(true);
  });
  it("token errado, ou Brain sem token configurado, é recusado", () => {
    process.env.TESTE_BRAIN_TOKEN = TOKEN;
    expect("erro" in usuarioPainel(req({ authorization: "Bearer outro-token-qualquer-123" }), { brain: true })).toBe(true);
    delete process.env.TESTE_BRAIN_TOKEN;
    expect("erro" in usuarioPainel(req({ authorization: "Bearer " }), { brain: true })).toBe(true);
  });
  it("login do painel continua funcionando nas rotas liberadas", () => {
    process.env.DASHBOARD_USERS = "bruna:B1";
    expect(usuarioPainel(req({ authorization: `Basic ${btoa("bruna:B1")}` }), { brain: true })).toEqual({ usuario: "bruna" });
  });
});
