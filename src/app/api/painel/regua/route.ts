import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { runRegua } from "@/lib/regua/executar";

// Prévia (não grava/envia) ou execução da régua agora (respeita as travas e o
// REGUA_DRY_RUN). Cada chamada usa 1 das 20 consultas diárias do bulk-data.
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  const b: any = await req.json().catch(() => ({}));
  return NextResponse.json(await runRegua({ preview: b?.acao !== "rodar" }));
}
