import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { usuarioPainel } from "@/lib/painel/auth";
import { digitos, enviarLink, novoToken, telefoneE164 } from "@/lib/comissoes/servico";

// Cadastro de corretores (painel). O próprio corretor completa o resto pelo link.
export const dynamic = "force-dynamic";
const txt = (v: unknown, max = 200) => { const s = String(v ?? "").trim().slice(0, max); return s || null; };

export async function POST(req: NextRequest) {
  const u = usuarioPainel(req);
  if ("erro" in u) return u.erro;
  const b: any = await req.json().catch(() => ({}));
  try {
    if (b.acao === "enviar_link") return NextResponse.json({ ok: true, aviso: await enviarLink(String(b.id), `painel:${u.usuario}`) });
    if (b.acao === "novo_link") { await db.corretor.update({ where: { id: String(b.id) }, data: { token: novoToken() } }); return NextResponse.json({ ok: true }); }
    if (b.acao === "desativar") { await db.corretor.update({ where: { id: String(b.id) }, data: { ativo: false } }); return NextResponse.json({ ok: true }); }
    const nome = txt(b.nome);
    if (!nome) return NextResponse.json({ erro: "Informe o nome do corretor." }, { status: 400 });
    const data = { nome, creci: txt(b.creci, 40), documento: digitos(b.documento) || null, telefone: telefoneE164(b.telefone), email: txt(b.email, 120), pixTipo: txt(b.pixTipo, 20), pixChave: txt(b.pixChave, 140), banco: txt(b.banco, 200) };
    const k = b.id ? await db.corretor.update({ where: { id: String(b.id) }, data }) : await db.corretor.create({ data: { ...data, token: novoToken() } });
    return NextResponse.json({ ok: true, id: k.id });
  } catch (err: any) {
    return NextResponse.json({ erro: String(err?.message ?? err).slice(0, 300) }, { status: 400 });
  }
}
