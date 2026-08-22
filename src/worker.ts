import { Worker } from "bullmq";
import { db } from "./lib/db";
import { getRedis } from "./lib/redis";
import { syncInstallment } from "./lib/sienge/sync";
import { sienge } from "./lib/sienge/client";
import { sendWhatsAppTemplate } from "./lib/whatsapp/client";

const conn = getRedis();

new Worker("sienge-events", async job => {
  const event = await db.integrationEvent.findUniqueOrThrow({ where: { id: job.data.eventId } });
  if (event.status === "PROCESSED") return;
  await db.integrationEvent.update({ where: { id: event.id }, data: { status: "PROCESSING" } });
  try {
    const p: any = event.payload;
    if (["RECEIVABLE_INSTALLMENT_CREATED","RECEIVABLE_INSTALLMENT_UPDATED","RECEIPT_PROCESSED"].includes(event.eventName)) {
      await syncInstallment(Number(p.receivableBillId ?? p.billId), Number(p.installmentId));
    } else if (event.eventName === "PAYMENT_SLIP_REGISTERED" || event.eventName === "BOOK_COLLECTION_CONFIRMED") {
      await db.installment.updateMany({
        where: { siengeReceivableBillId: Number(p.receivableBillId), siengeInstallmentId: Number(p.installmentId) },
        data: { paymentSlipStatus: event.eventName === "BOOK_COLLECTION_CONFIRMED" ? "CONFIRMED" : p.status === "CONFIRMED" ? "CONFIRMED" : p.status === "REJECTED" ? "REJECTED" : "UNKNOWN" }
      });
    }
    await db.integrationEvent.update({ where: { id: event.id }, data: { status: "PROCESSED", processedAt: new Date() } });
  } catch (err: any) {
    await db.integrationEvent.update({ where: { id: event.id }, data: { status: "FAILED", lastError: String(err?.message || err).slice(0,2000) } });
    throw err;
  }
}, { connection: conn, concurrency: 5 });

new Worker("whatsapp-outbound", async job => {
  const message = await db.message.findUniqueOrThrow({ where: { id: job.data.messageId }, include: { installment: true, customer: true } });
  if (["SENT","DELIVERED","READ","CANCELED"].includes(message.status)) return;
  if (!message.installment || message.installment.status !== "OPEN" || message.installment.partialPaymentDetected) {
    await db.message.update({ where: { id: message.id }, data: { status: "CANCELED", lastError: "Parcela não elegível no momento do envio" } });
    return;
  }
  // Just-in-time revalidation: never trust only the cached financial state for a collection message.
  await syncInstallment(message.installment.siengeReceivableBillId, message.installment.siengeInstallmentId);
  const fresh = await db.installment.findUniqueOrThrow({ where: { id: message.installment.id } });
  if (fresh.status !== "OPEN" || fresh.partialPaymentDetected) {
    await db.message.update({ where: { id: message.id }, data: { status: "CANCELED", lastError: "Revalidação Sienge bloqueou envio" } });
    return;
  }
  const boleto = await sienge.getPaymentSlip(fresh.siengeReceivableBillId, fresh.siengeInstallmentId); // failure = do not send; BullMQ will retry
  const p: any = message.payload || {};
  const result = await sendWhatsAppTemplate({
    to: message.phone, templateName: message.templateName, languageCode: message.languageCode,
    bodyParameters: [message.customer.name, String(p.amount || fresh.currentAmount || fresh.originalAmount), new Date(fresh.dueDate).toLocaleDateString("pt-BR", { timeZone: "America/Maceio" })]
  });
  await db.message.update({
    where: { id: message.id },
    data: { externalMessageId: result.id, status: result.dryRun ? "DRY_RUN" : "SENT", sentAt: new Date(), payload: { ...(p as object), boletoAvailable: Boolean(boleto) } }
  });
}, { connection: conn, concurrency: 3, limiter: { max: 20, duration: 1000 } });

console.log("Casa Forte worker iniciado.");
