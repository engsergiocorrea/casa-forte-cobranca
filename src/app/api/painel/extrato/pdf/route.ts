import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { fichaCliente } from "@/lib/painel/ficha";
import { gerarExtratoPdf } from "@/lib/painel/extrato-pdf";

// Extrato do cliente em PDF (todas as parcelas de todos os contratos).
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  const customerId = Number(req.nextUrl.searchParams.get("customerId"));
  if (!customerId) return NextResponse.json({ erro: "customerId" }, { status: 400 });
  const f = await fichaCliente(customerId);
  const nome = f.nome.split(/\s+/).slice(0, 2).join(" ").replace(/[^\p{L}\p{N} ]/gu, "");
  return new NextResponse(Buffer.from(await gerarExtratoPdf(f)), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Extrato ${nome}.pdf"`, "Cache-Control": "no-store" } });
}
