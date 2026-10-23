import { afterEach, describe, expect, it } from "vitest";
import { usuarioDoHeader, usuariosConfigurados } from "../src/lib/painel/usuarios";

const basic = (u: string, p: string) => `Basic ${btoa(`${u}:${p}`)}`;
const env = process.env;
afterEach(() => { delete env.DASHBOARD_USERS; delete env.DASHBOARD_BASIC_USER; delete env.DASHBOARD_BASIC_PASS; });

describe("usuários do painel", () => {
  it("vários usuários, cada um com sua senha (nome sem diferenciar maiúsculas)", () => {
    env.DASHBOARD_USERS = "sergio:Senha1, bruna:Outra:Com:DoisPontos";
    expect([...usuariosConfigurados().keys()]).toEqual(["sergio", "bruna"]);
    expect(usuarioDoHeader(basic("Bruna", "Outra:Com:DoisPontos"))).toBe("bruna");
    expect(usuarioDoHeader(basic("sergio", "Senha1"))).toBe("sergio");
    expect(usuarioDoHeader(basic("sergio", "errada"))).toBeNull();
    expect(usuarioDoHeader(basic("ninguem", "Senha1"))).toBeNull();
  });
  it("login antigo continua valendo junto", () => {
    env.DASHBOARD_USERS = "bruna:B1";
    env.DASHBOARD_BASIC_USER = "admin"; env.DASHBOARD_BASIC_PASS = "A1";
    expect(usuarioDoHeader(basic("admin", "A1"))).toBe("admin");
    expect(usuarioDoHeader(basic("bruna", "B1"))).toBe("bruna");
  });
  it("sem usuários configurados ninguém entra", () => {
    expect(usuariosConfigurados().size).toBe(0);
    expect(usuarioDoHeader(basic("x", "y"))).toBeNull();
    expect(usuarioDoHeader(null)).toBeNull();
    expect(usuarioDoHeader("Basic !!!")).toBeNull();
  });
});
