import { NextRequest, NextResponse } from "next/server";
import { usuarioDoHeader, usuariosConfigurados } from "./lib/painel/usuarios";
import { SESSAO_COOKIE, usuarioDaSessao } from "./lib/painel/sessao";
import { ehDominioCasaForte, urlLoginUnico, usuarioSso } from "./lib/painel/sso";

// Cabeçalho interno com o usuário da sessão, preenchido SÓ aqui (sempre
// sobrescrito/apagado — o navegador não consegue forjar). As rotas leem em
// usuarioPainel(). Login: tela própria (/login) com cookie assinado; o Basic
// Auth antigo continua aceito (scripts/curl), mas sem o pop-up do navegador.
const CABECALHO_USUARIO = "x-cf-usuario";

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const limpo = new Headers(req.headers);
  limpo.delete(CABECALHO_USUARIO);
  const seguir = (usuario?: string) => {
    if (usuario) limpo.set(CABECALHO_USUARIO, usuario);
    return NextResponse.next({ request: { headers: limpo } });
  };

  // Login único: em produção a tela /login vira desvio para o Portal (com trava
  // anti-loop de 60s — se voltar sem sessão, mostra o login local).
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  if (path === "/login") {
    const nextParam = req.nextUrl.searchParams.get("next") ?? "/";
    const volta = nextParam.startsWith("/") && !nextParam.startsWith("//") && !nextParam.startsWith("/login") ? nextParam : "/";
    if (await usuarioSso(req.cookies)) return NextResponse.redirect(new URL(volta, req.url));
    // Só desvia quando o login único está configurado (envs do Supabase).
    if (process.env.SUPABASE_URL && ehDominioCasaForte(host) && !req.cookies.get("cf_sso_ida")) {
      const res = NextResponse.redirect(urlLoginUnico(`https://${host}${volta}`));
      res.cookies.set("cf_sso_ida", "1", { maxAge: 60, path: "/", httpOnly: true, secure: true, sameSite: "lax" });
      return res;
    }
  }

  // Rotas com autenticação própria (Bearer/token) e arquivos públicos.
  if (
    path.startsWith("/api/webhooks/") || path === "/api/health" || path.startsWith("/api/test/") || path.startsWith("/api/internal/") ||
    path.startsWith("/corretor/") || path.startsWith("/api/corretor/") ||
    path.startsWith("/marca/") || path === "/icon.png" || path === "/apple-icon.png" ||
    path === "/login" || path === "/api/login" || path === "/api/logout"
  ) return seguir();
  // Casa Forte Brain: Bearer nas rotas do painel (a rota valida o token).
  if (path.startsWith("/api/painel/") && req.headers.get("authorization")?.startsWith("Bearer ")) return seguir();
  // Sem nenhum usuário configurado o painel NÃO abre (nunca fica público).

  const usuario =
    (await usuarioDaSessao(req.cookies.get(SESSAO_COOKIE)?.value)) ??
    (await usuarioSso(req.cookies)) ??
    usuarioDoHeader(req.headers.get("authorization"));
  if (usuario) return seguir(usuario);
  if (!usuariosConfigurados().size && !process.env.SUPABASE_URL) return new NextResponse("Painel sem usuários configurados (DASHBOARD_USERS ou login único).", { status: 503 });

  if (path.startsWith("/api/")) return NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
