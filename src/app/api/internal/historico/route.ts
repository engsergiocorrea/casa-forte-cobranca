import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sincronizarHistorico } from "@/lib/painel/historico";

// Sincroniza o histórico de pagamentos com o Sienge. Bearer CRON_SECRET.
//   POST            → todos os contratos (1 chamada bulk por lote de 40 títulos)
//   POST ?billId=47 → só um título
// Conta no limite de 20 chamadas/dia do bulk-data.
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${env().CRON_SECRET}`) return new NextResponse("unauthorized", { status: 401 });
  const billId = Number(req.nextUrl.searchParams.get("billId")) || undefined;
  return NextResponse.json(await sincronizarHistorico(billId ? [billId] : undefined));
}
