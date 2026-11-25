import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { usuarioPainel } from "@/lib/painel/auth";

// Download da NF/RPA ou do comprovante (painel).
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const u = usuarioPainel(req);
  if ("erro" in u) return u.erro;
  const a = await db.comissaoArquivo.findUnique({ where: { id: String(req.nextUrl.searchParams.get("id")) } });
  if (!a) return new NextResponse("não encontrado", { status: 404 });
  return new NextResponse(Buffer.from(a.dados), { headers: { "Content-Type": a.mime, "Content-Disposition": `inline; filename="${encodeURIComponent(a.nome)}"`, "Cache-Control": "private, no-store" } });
}
