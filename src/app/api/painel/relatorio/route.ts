import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { localDateKey } from "@/lib/collection/date";
import { usuarioPainel } from "@/lib/painel/auth";
import { coletarRelatorio, enviarRelatorioDia } from "@/lib/relatorio/enviar";
import { gerarRelatorioPdf } from "@/lib/relatorio/pdf";

export const dynamic = "force-dynamic";
const dataDe = (req: NextRequest) => { const d = req.nextUrl.searchParams.get("data"); return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : localDateKey(new Date(), env().TIMEZONE); };
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  const data = dataDe(req);
  const pdf = await gerarRelatorioPdf(await coletarRelatorio(data), new Date(), env().TIMEZONE);
  return new NextResponse(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="relatorio-casa-forte-${data}.pdf"` } });
}
// Envia para a diretoria; por padrão só para quem ainda não recebeu o do dia.
export async function POST(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  const b: any = await req.json().catch(() => ({}));
  return NextResponse.json(await enviarRelatorioDia(dataDe(req), "manual", `painel:${a.usuario}`, { apenasPendentes: b?.todos !== true }));
}
