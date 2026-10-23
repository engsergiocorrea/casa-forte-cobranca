import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { buscarClientes } from "@/lib/painel/sienge-cache";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  return NextResponse.json(await buscarClientes(req.nextUrl.searchParams.get("q") ?? ""));
}
