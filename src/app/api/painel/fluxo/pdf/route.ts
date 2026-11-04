import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { calcularFluxo } from "@/lib/painel/fluxo";
import { gerarFluxoPdf } from "@/lib/painel/fluxo-pdf";

// Relatório em PDF da previsão de fluxo de caixa (geral + uma seção por obra).
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  const f = await calcularFluxo();
  const bytes = await gerarFluxoPdf(f);
  return new NextResponse(Buffer.from(bytes), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="Fluxo de caixa Casa Forte ${f.hoje}.pdf"`,
    "Cache-Control": "no-store",
  } });
}
