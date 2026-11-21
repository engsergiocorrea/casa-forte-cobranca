import { describe, expect, it } from "vitest";
import { ehDominioCasaForte, lerSessaoSso, urlLoginUnico } from "../src/lib/painel/sso";

const b64url = (s: string) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jar = (c: Record<string, string>) => ({ getAll: () => Object.entries(c).map(([name, value]) => ({ name, value })) });

describe("login único (cf-sso)", () => {
  const sessao = JSON.stringify({ access_token: "tok.abc.def", expires_at: 2_000_000_000, user: { email: "a@b.com" } });

  it("lê o cookie inteiro em base64", () => {
    expect(lerSessaoSso(jar({ "cf-sso": "base64-" + b64url(sessao) }))).toEqual({ token: "tok.abc.def", expira: 2_000_000_000_000 });
  });

  it("junta o cookie dividido em partes na ordem certa", () => {
    const v = "base64-" + b64url(sessao);
    const meio = Math.floor(v.length / 2);
    expect(lerSessaoSso(jar({ "cf-sso.1": v.slice(meio), "cf-sso.0": v.slice(0, meio) }))?.token).toBe("tok.abc.def");
  });

  it("ignora cookie ausente ou corrompido", () => {
    expect(lerSessaoSso(jar({}))).toBeNull();
    expect(lerSessaoSso(jar({ "cf-sso": "base64-@@@" }))).toBeNull();
  });

  it("só considera domínios Casa Forte", () => {
    expect(ehDominioCasaForte("cobranca.casaforteinc.com.br")).toBe(true);
    expect(ehDominioCasaForte("casaforteinc.com.br:443")).toBe(true);
    expect(ehDominioCasaForte("casaforteinc.com.br.evil.com")).toBe(false);
    expect(ehDominioCasaForte("localhost:3107")).toBe(false);
  });

  it("monta o link do login único com retorno", () => {
    expect(urlLoginUnico("https://cobranca.casaforteinc.com.br/")).toBe("https://sistemas.casaforteinc.com.br/login?next=https%3A%2F%2Fcobranca.casaforteinc.com.br%2F");
  });
});
