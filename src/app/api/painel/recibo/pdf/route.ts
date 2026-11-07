import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { reciboPdf } from "@/lib/painel/recibo";

// Recibo (comprovante de pagamento, modelo Sienge) em PDF.
//   GET ?itens=47:3,47:4   (billId:installmentId, separados por vírgula)
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  const itens = (req.nextUrl.searchParams.get("itens") ?? "").split(",").map((x) => x.split(":").map(Number)).filter(([b, i]) => b > 0 && i > 0).slice(0, 24).map(([billId, installmentId]) => ({ billId, installmentId }));
  if (!itens.length) return NextResponse.json({ erro: "itens=billId:installmentId" }, { status: 400 });
  const r = await reciboPdf(itens);
  if (!r.pdf) return NextResponse.json({ erro: r.faltando.map((f) => f.motivo).join("; ") || "Sem pagamento registrado." }, { status: 404 });
  return new NextResponse(Buffer.from(r.pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${r.nomeArquivo}"`, "Cache-Control": "no-store" } });
}
