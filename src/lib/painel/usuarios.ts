// Usuários do painel (Basic Auth), sem banco — funciona no middleware (edge).
//   DASHBOARD_USERS = "sergio:senhaForte1,bruna:senhaForte2"   (um por pessoa)
//   + o login antigo DASHBOARD_BASIC_USER / DASHBOARD_BASIC_PASS, se existir.
// O nome do usuário vai para a auditoria (solicitadoPor = "painel:<usuário>").
// Senha não pode conter vírgula (separa usuários); ":" é permitido.

export function usuariosConfigurados(): Map<string, string> {
  const m = new Map<string, string>();
  for (const item of (process.env.DASHBOARD_USERS ?? "").split(",")) {
    const i = item.indexOf(":");
    if (i <= 0) continue;
    const u = item.slice(0, i).trim().toLowerCase(), p = item.slice(i + 1).trim();
    if (u && p) m.set(u, p);
  }
  const lu = process.env.DASHBOARD_BASIC_USER?.trim(), lp = process.env.DASHBOARD_BASIC_PASS?.trim();
  if (lu && lp && !m.has(lu.toLowerCase())) m.set(lu.toLowerCase(), lp);
  return m;
}

// Comparação em tempo constante (não revela a senha pelo tempo de resposta).
function iguais(a: string, b: string) {
  let r = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
}

// Devolve o usuário autenticado pelo header "Authorization: Basic …", ou null.
export function usuarioDoHeader(auth: string | null): string | null {
  if (!auth?.startsWith("Basic ")) return null;
  let dec = "";
  try { dec = atob(auth.slice(6)); } catch { return null; }
  const i = dec.indexOf(":");
  if (i <= 0) return null;
  const u = dec.slice(0, i).trim().toLowerCase(), p = dec.slice(i + 1);
  const senha = usuariosConfigurados().get(u);
  return senha != null && iguais(p, senha) ? u : null;
}
