import { usuariosConfigurados } from "./usuarios";

// Sessão do painel (tela de login própria): cookie httpOnly assinado com
// HMAC-SHA256. Funciona no middleware (edge) e nas rotas (Node) — Web Crypto.
// Valor: base64url("usuario|expiraEmSegundos|versao") + "." + assinatura.
// A "versao" muda quando a senha do usuário muda (troca de senha derruba sessões).

export const SESSAO_COOKIE = "cf_sessao";
export const SESSAO_HORAS = 12;
export const SESSAO_DIAS_LEMBRAR = 30;

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) => {
  let s = ""; for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const deB64url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

function segredo(): string | null {
  const s = process.env.SESSION_SECRET || process.env.CRON_SECRET || "";
  return s.length >= 16 && s !== "CHANGE_ME_CHANGE_ME" ? s : null;
}
async function assinar(texto: string): Promise<string | null> {
  const s = segredo(); if (!s) return null;
  const key = await crypto.subtle.importKey("raw", enc.encode(s), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(texto)));
}
async function versaoDaSenha(usuario: string): Promise<string> {
  const senha = usuariosConfigurados().get(usuario) ?? "";
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(`${usuario}:${senha}`))).slice(0, 12);
}

export async function criarSessao(usuario: string, lembrar: boolean): Promise<{ valor: string; maxAge: number } | null> {
  const maxAge = lembrar ? SESSAO_DIAS_LEMBRAR * 86400 : SESSAO_HORAS * 3600;
  const corpo = `${usuario}|${Math.floor(Date.now() / 1000) + maxAge}|${await versaoDaSenha(usuario)}`;
  const sig = await assinar(corpo);
  return sig ? { valor: `${b64url(enc.encode(corpo))}.${sig}`, maxAge } : null;
}

// Usuário da sessão, ou null (ausente, adulterada, expirada, senha trocada ou usuário removido).
export async function usuarioDaSessao(valor: string | undefined | null): Promise<string | null> {
  if (!valor || !valor.includes(".")) return null;
  const [corpoB64, sig] = valor.split(".");
  let corpo = ""; try { corpo = deB64url(corpoB64); } catch { return null; }
  const esperado = await assinar(corpo);
  if (!esperado || esperado.length !== sig.length) return null;
  let r = 0; for (let i = 0; i < sig.length; i++) r |= sig.charCodeAt(i) ^ esperado.charCodeAt(i);
  if (r !== 0) return null;
  const [usuario, exp, versao] = corpo.split("|");
  if (!usuario || !(Number(exp) > Date.now() / 1000)) return null;
  if (!usuariosConfigurados().has(usuario)) return null;
  return versao === (await versaoDaSenha(usuario)) ? usuario : null;
}
