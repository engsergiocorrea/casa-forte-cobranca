// Login único Casa Forte no Financeiro.
// Os sistemas em *.casaforteinc.com.br compartilham a sessão Supabase no cookie
// `cf-sso` (domínio pai). Aqui o painel aceita essa sessão: confere o token no
// Supabase (idjzh) e a permissão do módulo "financeiro" no Portal. Resultado em
// cache por alguns minutos para não consultar a cada clique.
// Envs: SUPABASE_URL + SUPABASE_ANON_KEY (públicos do idjzh), PORTAL_URL
// (padrão https://sistemas.casaforteinc.com.br) e PORTAL_INTERNAL_API_KEY.
export const SSO_COOKIE = "cf-sso";
export const SSO_DOMINIO = ".casaforteinc.com.br";
const PORTAL = () => (process.env.PORTAL_URL ?? "https://sistemas.casaforteinc.com.br").trim().replace(/\/$/, "");

export function ehDominioCasaForte(host?: string | null): boolean {
  const h = (host ?? "").split(",")[0].trim().split(":")[0].toLowerCase();
  return h === "casaforteinc.com.br" || h.endsWith(".casaforteinc.com.br");
}

export function urlLoginUnico(destino: string): string {
  return `${PORTAL()}/login?next=${encodeURIComponent(destino)}`;
}

type CookieLeitor = { getAll(): { name: string; value: string }[] };

// O @supabase/ssr grava "base64-<json>" e, se passar de ~3KB, divide em
// cf-sso.0, cf-sso.1, ...
export function lerSessaoSso(cookies: CookieLeitor): { token: string; expira: number } | null {
  const todos = cookies.getAll();
  let valor = todos.find((c) => c.name === SSO_COOKIE)?.value ?? "";
  if (!valor) {
    const partes = todos.filter((c) => /^cf-sso\.\d+$/.test(c.name)).sort((a, b) => Number(a.name.split(".")[1]) - Number(b.name.split(".")[1]));
    valor = partes.map((c) => c.value).join("");
  }
  if (!valor) return null;
  try {
    let json = valor;
    if (json.startsWith("base64-")) {
      const b64 = json.slice(7).replace(/-/g, "+").replace(/_/g, "/");
      json = new TextDecoder().decode(Uint8Array.from(atob(b64 + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0)));
    }
    const s = JSON.parse(json);
    const token = typeof s?.access_token === "string" ? s.access_token : "";
    return token ? { token, expira: Number(s?.expires_at ?? 0) * 1000 } : null;
  } catch {
    return null;
  }
}

const cache = new Map<string, { usuario: string | null; ate: number }>();

function apelido(nome: string, email: string): string {
  const base = (nome || email.split("@")[0]).trim().split(/\s+/)[0] ?? "";
  return base.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "") || "usuario";
}

// Devolve o apelido do usuário (ex.: "sergio") se a sessão vale e ele tem acesso
// ao Financeiro; null caso contrário. Nunca lança.
export async function usuarioSso(cookies: CookieLeitor): Promise<string | null> {
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const anon = (process.env.SUPABASE_ANON_KEY ?? "").trim();
  const chave = (process.env.PORTAL_INTERNAL_API_KEY ?? "").trim();
  if (!url || !anon || !chave) return null;
  const s = lerSessaoSso(cookies);
  if (!s || s.expira < Date.now()) return null;
  const c = cache.get(s.token);
  if (c && c.ate > Date.now()) return c.usuario;
  let usuario: string | null = null;
  try {
    const u = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${s.token}` }, cache: "no-store" });
    if (u.ok) {
      const email = String((await u.json())?.email ?? "").toLowerCase();
      if (email) {
        const r = await fetch(`${PORTAL()}/api/internal/access/check`, {
          method: "POST", cache: "no-store",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
          body: JSON.stringify({ email, module: "financeiro" }),
        });
        const j = r.ok ? await r.json() : null;
        if (j?.allowed) usuario = apelido(String(j?.profile?.nome ?? ""), email);
      }
    }
  } catch {
    return null; // falha de rede: não guarda no cache
  }
  if (cache.size > 500) cache.clear();
  cache.set(s.token, { usuario, ate: Math.min(Date.now() + 5 * 60_000, s.expira) });
  return usuario;
}

// Encerra a sessão compartilhada no Supabase (sai de todos os sistemas).
export async function sairSso(cookies: CookieLeitor): Promise<void> {
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const anon = (process.env.SUPABASE_ANON_KEY ?? "").trim();
  const s = lerSessaoSso(cookies);
  if (!url || !anon || !s) return;
  cache.delete(s.token);
  await fetch(`${url}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: anon, Authorization: `Bearer ${s.token}` } }).catch(() => {});
}
