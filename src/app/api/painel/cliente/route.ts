import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { fichaCliente } from "@/lib/painel/ficha";

// Ficha do cliente (extrato completo dos contratos) — ver lib/painel/ficha.ts.
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req, { brain: true }); if ("erro" in a) return a.erro;
  const customerId = Number(req.nextUrl.searchParams.get("customerId"));
  if (!customerId) return NextResponse.json({ erro: "customerId" }, { status: 400 });
  return NextResponse.json(await fichaCliente(customerId));
}
