import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runConfirmacoesPagamento } from "@/lib/payments/confirmacao";

// Gatilho da confirmação de pagamento. Autenticado por Bearer CRON_SECRET.
//   POST                → executa (respeita PAYMENT_CONFIRMATION_ENABLED, horário e travas de envio)
//   POST ?preview=1     → só mostra quem receberia e a mensagem (não grava, não envia)
//   POST ?force=1       → ignora o horário mínimo (mantém todas as outras travas)
// Cada chamada consome 1 das 20 requisições/dia do bulk-data do Sienge.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${env().CRON_SECRET}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const q = req.nextUrl.searchParams;
  return NextResponse.json(await runConfirmacoesPagamento({ preview: q.get("preview") === "1", force: q.get("force") === "1" }));
}
