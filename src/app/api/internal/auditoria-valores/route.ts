import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { auditarValores } from "@/lib/boleto/auditoria";

// Confere se o valor escrito nas mensagens enviadas é o mesmo do boleto
// (valor gravado na linha digitável). Só leitura. Bearer CRON_SECRET.
//   GET               → todas as mensagens enviadas
//   GET ?desde=2026-10-01
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${env().CRON_SECRET}`) return new NextResponse("unauthorized", { status: 401 });
  const d = req.nextUrl.searchParams.get("desde");
  return NextResponse.json(await auditarValores(d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`) : undefined));
}
