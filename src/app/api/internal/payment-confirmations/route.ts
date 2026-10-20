import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { runConfirmacoesPagamento } from "@/lib/payments/confirmacao";

// Gatilho da confirmação de pagamento. Autenticado por Bearer CRON_SECRET.
//   POST                → executa (respeita PAYMENT_CONFIRMATION_ENABLED, horário e travas de envio)
//   POST ?preview=1     → só mostra quem receberia e a mensagem (não grava, não envia)
//   POST ?force=1       → ignora o horário mínimo (mantém todas as outras travas)
//   GET  ?billId=33     → SÓ LEITURA: registros de envio (status, motivo, erro,
//                         tentativas) — diagnóstico; sem billId, os 30 últimos.
//                         Não chama o Sienge nem a Evolution. Telefone mascarado.
// Cada POST consome 1–2 das 20 requisições/dia do bulk-data do Sienge.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${env().CRON_SECRET}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const q = req.nextUrl.searchParams;
  return NextResponse.json(await runConfirmacoesPagamento({ preview: q.get("preview") === "1", force: q.get("force") === "1" }));
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${env().CRON_SECRET}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  const billId = Number(req.nextUrl.searchParams.get("billId")) || undefined;
  const rows = await db.paymentConfirmation.findMany({
    where: billId ? { billId } : undefined,
    orderBy: { updatedAt: "desc" },
    take: 30,
  });
  return NextResponse.json(rows.map((r) => ({
    billId: r.billId, installmentId: r.installmentId, contrato: r.contrato, status: r.status,
    motivo: r.motivo, detail: r.detail?.replace(/\d{4,}(?=\d{3})/g, (m) => "•".repeat(m.length)) ?? null, attempts: r.attempts, phone: r.phone.replace(/\d(?=\d{3})/g, "•"),
    paidDate: r.paidDate.toISOString().slice(0, 10), valor: Number(r.valor), sentAt: r.sentAt, updatedAt: r.updatedAt,
  })));
}
