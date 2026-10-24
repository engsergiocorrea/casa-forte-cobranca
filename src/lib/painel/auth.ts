import { NextRequest, NextResponse } from "next/server";
import { env } from "../env";
import { iguais, usuarioDoHeader, usuariosConfigurados } from "./usuarios";

// O painel usa o Basic Auth do site (middleware), com um login por pessoa
// (DASHBOARD_USERS). Aqui: (1) nunca funcionar sem usuários configurados;
// (2) descobrir QUEM está usando, para a auditoria (painel:<usuário>).
// Rotas marcadas com { brain: true } também aceitam o Casa Forte Brain:
// "Authorization: Bearer <BRAIN_API_TOKEN>" + "X-Brain-Ator: <pessoa>" →
// usuário "brain:<pessoa>". As demais rotas recusam o token do Brain.
export function usuarioPainel(req: NextRequest, opts: { brain?: boolean } = {}): { usuario: string } | { erro: NextResponse } {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = env().BRAIN_API_TOKEN;
    if (!opts.brain || token.length < 16 || !iguais(auth.slice(7), token)) return { erro: NextResponse.json({ erro: "Não autorizado." }, { status: 401 }) };
    const ator = (req.headers.get("x-brain-ator") ?? "").toLowerCase().normalize("NFD").replace(/[^a-z0-9._-]/g, "").slice(0, 40);
    return { usuario: `brain:${ator || "desconhecido"}` };
  }
  if (!usuariosConfigurados().size) return { erro: NextResponse.json({ erro: "Painel sem usuários: defina DASHBOARD_USERS no Railway." }, { status: 403 }) };
  const u = usuarioDoHeader(auth);
  if (!u) return { erro: NextResponse.json({ erro: "Não autenticado." }, { status: 401 }) };
  return { usuario: u };
}
