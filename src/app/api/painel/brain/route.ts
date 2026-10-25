import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { usuarioPainel } from "@/lib/painel/auth";

// Aba Brain do painel → Casa Forte Brain (casaforte-ia, POST /web/chat).
// A pessoa logada no painel é identificada no Brain pelo celular cadastrado
// em BRAIN_USUARIOS; lá valem as permissões e a confirmação ("Confirmo") dela.
//   GET  → { configurado, liberado, usuario }   (a página decide o que mostrar)
//   POST { mensagem } → { resposta }
export const dynamic = "force-dynamic";

function celularDo(usuario: string): string | null {
  for (const item of env().BRAIN_USUARIOS.split(",")) {
    const [u, tel] = item.split(":").map((x) => x?.trim() ?? "");
    if (u && tel && u.toLowerCase() === usuario) return tel.replace(/\D/g, "");
  }
  return null;
}
const configurado = () => Boolean(env().BRAIN_URL && env().BRAIN_WEB_TOKEN);

export async function GET(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  return NextResponse.json({ configurado: configurado(), liberado: Boolean(celularDo(a.usuario)), usuario: a.usuario });
}

export async function POST(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  if (!configurado()) return NextResponse.json({ erro: "O Brain ainda não está ligado (BRAIN_URL / BRAIN_WEB_TOKEN)." }, { status: 503 });
  const phone = celularDo(a.usuario);
  if (!phone) return NextResponse.json({ erro: `O usuário "${a.usuario}" não está liberado no Brain (BRAIN_USUARIOS).` }, { status: 403 });
  const b: any = await req.json().catch(() => ({}));
  const message = String(b?.mensagem ?? "").trim().slice(0, 2000);
  if (!message) return NextResponse.json({ erro: "Mensagem vazia." }, { status: 400 });
  try {
    const r = await fetch(`${env().BRAIN_URL.replace(/\/$/, "")}/web/chat`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(150_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env().BRAIN_WEB_TOKEN}` },
      body: JSON.stringify({ phone, message }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return NextResponse.json({ erro: r.status === 401 ? "O Brain recusou o token (BRAIN_WEB_TOKEN)." : `O Brain respondeu com erro ${r.status}.` }, { status: 502 });
    return NextResponse.json({ resposta: j?.reply ?? "O Brain não respondeu." });
  } catch (err) {
    const tempo = (err as Error)?.name === "TimeoutError";
    return NextResponse.json({ erro: tempo ? "O Brain demorou demais para responder. Tente de novo." : "Não foi possível falar com o Brain." }, { status: 504 });
  }
}
