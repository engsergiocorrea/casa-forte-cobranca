import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { criarPausa, listarPausas, removerPausa } from "@/lib/regua/pausas-db";

// Exceções da régua v2 (PausaRegua). Bearer CRON_SECRET. (O painel usa a
// mesma lógica em /api/painel/pausas.)
//   GET                → pausas ativas
//   POST {contrato, escopo?, tipos?, ate?, motivo}
//        escopo "cliente" (padrão) = todas as parcelas do cliente desse contrato;
//        escopo "contrato" = só o título desse contrato.
//   DELETE ?id=...     → remove (lógico)
export const dynamic = "force-dynamic";
const autorizado = (req: NextRequest) => req.headers.get("authorization") === `Bearer ${env().CRON_SECRET}`;

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return new NextResponse("unauthorized", { status: 401 });
  return NextResponse.json(await listarPausas());
}
export async function POST(req: NextRequest) {
  if (!autorizado(req)) return new NextResponse("unauthorized", { status: 401 });
  const r = await criarPausa(await req.json().catch(() => ({})));
  return r.ok ? NextResponse.json(r) : NextResponse.json({ erro: r.erro }, { status: r.status });
}
export async function DELETE(req: NextRequest) {
  if (!autorizado(req)) return new NextResponse("unauthorized", { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ erro: "Informe ?id=" }, { status: 400 });
  return NextResponse.json({ ok: await removerPausa(id) });
}
