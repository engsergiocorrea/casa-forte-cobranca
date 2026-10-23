import { NextRequest, NextResponse } from "next/server";
import { usuarioDoHeader, usuariosConfigurados } from "./usuarios";

// O painel usa o Basic Auth do site (middleware), com um login por pessoa
// (DASHBOARD_USERS). Aqui: (1) nunca funcionar sem usuários configurados;
// (2) descobrir QUEM está usando, para a auditoria (painel:<usuário>).
export function usuarioPainel(req: NextRequest): { usuario: string } | { erro: NextResponse } {
  if (!usuariosConfigurados().size) return { erro: NextResponse.json({ erro: "Painel sem usuários: defina DASHBOARD_USERS no Railway." }, { status: 403 }) };
  const u = usuarioDoHeader(req.headers.get("authorization"));
  if (!u) return { erro: NextResponse.json({ erro: "Não autenticado." }, { status: 401 }) };
  return { usuario: u };
}
