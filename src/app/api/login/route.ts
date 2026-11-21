import { NextRequest, NextResponse } from "next/server";
import { iguais, usuariosConfigurados } from "@/lib/painel/usuarios";
import { SESSAO_COOKIE, criarSessao } from "@/lib/painel/sessao";

// Login do painel (tela /login). Mesmos usuários de DASHBOARD_USERS.
// Erro sempre genérico; tentativas limitadas por IP (5 por minuto).
export const dynamic = "force-dynamic";
const tentativas = new Map<string, number[]>();

export async function POST(req: NextRequest) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  const agora = Date.now();
  const recentes = (tentativas.get(ip) ?? []).filter((t) => agora - t < 60_000);
  if (recentes.length >= 5) return NextResponse.json({ erro: "Muitas tentativas. Aguarde um minuto." }, { status: 429 });

  const b: any = await req.json().catch(() => ({}));
  const usuario = String(b?.usuario ?? "").trim().toLowerCase();
  const senha = String(b?.senha ?? "");
  const certa = usuariosConfigurados().get(usuario);
  if (!usuario || certa == null || !iguais(senha, certa)) {
    tentativas.set(ip, [...recentes, agora]);
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.json({ erro: "Usuário ou senha incorretos." }, { status: 401 });
  }
  tentativas.delete(ip);
  const s = await criarSessao(usuario, Boolean(b?.lembrar));
  if (!s) return NextResponse.json({ erro: "Login indisponível: falta SESSION_SECRET no servidor." }, { status: 503 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSAO_COOKIE, s.valor, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: s.maxAge });
  return res;
}
