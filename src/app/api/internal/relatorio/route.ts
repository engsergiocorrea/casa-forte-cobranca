import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { localDateKey } from "@/lib/collection/date";
import { coletarRelatorio, enviarRelatorioDia } from "@/lib/relatorio/enviar";
import { gerarRelatorioPdf } from "@/lib/relatorio/pdf";

// Relatório do dia. Bearer CRON_SECRET. Não consulta o Sienge (só o banco).
//   GET  ?data=yyyy-mm-dd            → baixa o PDF (para conferir) — não envia
//   POST ?data=yyyy-mm-dd&enviar=1   → envia AGORA para REPORT_RECIPIENTS (teste/manual)
export const dynamic = "force-dynamic";

const autorizado = (req: NextRequest) => req.headers.get("authorization") === `Bearer ${env().CRON_SECRET}`;
const dataDe = (req: NextRequest) => {
  const d = req.nextUrl.searchParams.get("data");
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : localDateKey(new Date(), env().TIMEZONE);
};

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return new NextResponse("unauthorized", { status: 401 });
  const data = dataDe(req);
  const pdf = await gerarRelatorioPdf(await coletarRelatorio(data), new Date(), env().TIMEZONE);
  return new NextResponse(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="relatorio-casa-forte-${data}.pdf"` } });
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return new NextResponse("unauthorized", { status: 401 });
  if (req.nextUrl.searchParams.get("enviar") !== "1") return NextResponse.json({ erro: "Use ?enviar=1 para confirmar o envio." }, { status: 400 });
  return NextResponse.json(await enviarRelatorioDia(dataDe(req), "manual"));
}
