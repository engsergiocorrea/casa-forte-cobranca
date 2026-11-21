import { NextRequest, NextResponse } from "next/server";
import { usuarioDoHeader, usuariosConfigurados } from "./lib/painel/usuarios";
import { SESSAO_COOKIE, usuarioDaSessao } from "./lib/painel/sessao";

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

  // Rotas com autenticação própria (Bearer/token) e arquivos públicos.
  if (
    path.startsWith("/api/webhooks/") || path === "/api/health" || path.startsWith("/api/test/") || path.startsWith("/api/internal/") ||
    path.startsWith("/marca/") || path === "/icon.png" || path === "/apple-icon.png" ||
    path === "/login" || path === "/api/login" || path === "/api/logout"
  ) return seguir();
  // Casa Forte Brain: Bearer nas rotas do painel (a rota valida o token).
  if (path.startsWith("/api/painel/") && req.headers.get("authorization")?.startsWith("Bearer ")) return seguir();
  // Sem nenhum usuário configurado o painel NÃO abre (nunca fica público).
  if (!usuariosConfigurados().size) return new NextResponse("Painel sem usuários configurados (DASHBOARD_USERS).", { status: 503 });

  const usuario = (await usuarioDaSessao(req.cookies.get(SESSAO_COOKIE)?.value)) ?? usuarioDoHeader(req.headers.get("authorization"));
  if (usuario) return seguir(usuario);

  if (path.startsWith("/api/")) return NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
