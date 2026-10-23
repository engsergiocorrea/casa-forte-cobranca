import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { criarPausa, listarPausas, removerPausa } from "@/lib/regua/pausas-db";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  return NextResponse.json(await listarPausas());
}
export async function POST(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  const b: any = await req.json().catch(() => ({}));
  const r = await criarPausa({ ...b, criadoPor: `painel:${a.usuario}` });
  return r.ok ? NextResponse.json(r) : NextResponse.json({ erro: r.erro }, { status: r.status });
}
export async function DELETE(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ erro: "id" }, { status: 400 });
  return NextResponse.json({ ok: await removerPausa(id) });
}
