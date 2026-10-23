import { NextRequest, NextResponse } from "next/server";
import { usuarioDoHeader, usuariosConfigurados } from "./lib/painel/usuarios";
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // Rotas com autenticação própria (Bearer/token) — não passam pelo Basic Auth
  // do painel para não haver conflito no header Authorization.
  if (
    path.startsWith("/api/webhooks/") ||
    path === "/api/health" ||
    path.startsWith("/api/test/") ||
    path.startsWith("/api/internal/") ||
    // Marca e ícones do app (públicos, sem dados) — o iPhone busca o ícone
    // da "Tela de Início" sem enviar a senha.
    path.startsWith("/marca/") || path === "/icon.png" || path === "/apple-icon.png"
  ) return NextResponse.next();
  // Sem nenhum usuário configurado o painel NÃO abre (nunca fica público).
  if (!usuariosConfigurados().size) return new NextResponse("Painel sem usuários configurados (DASHBOARD_USERS).", { status: 503 });
  if (usuarioDoHeader(req.headers.get("authorization"))) return NextResponse.next();
  return new NextResponse("Acesso restrito", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Casa Forte - Financeiro", charset="UTF-8"' } });
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
