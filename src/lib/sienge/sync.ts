import { db } from "../db";
import { sienge } from "./client";
import { normalizeReceivableBill } from "./mapper";

export async function syncInstallment(billId: number, installmentId: number) {
  const raw = await sienge.getReceivableBill(billId);
  const n = normalizeReceivableBill(raw, installmentId);
  if (!n.customerId || Number.isNaN(n.dueDate.getTime())) throw new Error("Sienge mapper: customerId/dueDate ausentes; ajustar mapper com payload real.");
  const customer = await db.customer.upsert({
    where: { siengeId: n.customerId },
    update: { name: n.customerName },
    create: { siengeId: n.customerId, name: n.customerName }
  });
  const installment = await db.installment.upsert({
    where: { siengeReceivableBillId_siengeInstallmentId: { siengeReceivableBillId: billId, siengeInstallmentId: installmentId } },
    update: {
      customerId: customer.id, dueDate: n.dueDate, originalAmount: n.originalAmount,
      currentAmount: n.currentAmount, status: n.status, partialPaymentDetected: n.partial, lastValidatedAt: new Date()
    },
    create: {
      siengeReceivableBillId: billId, siengeInstallmentId: installmentId, customerId: customer.id,
      dueDate: n.dueDate, originalAmount: n.originalAmount, currentAmount: n.currentAmount,
      status: n.status, partialPaymentDetected: n.partial, lastValidatedAt: new Date()
    }
  });
  if (installment.status !== "OPEN" || installment.partialPaymentDetected) {
    await db.message.updateMany({
      where: { installmentId: installment.id, status: { in: ["SCHEDULED", "QUEUED"] } },
      data: { status: "CANCELED", lastError: "Sienge tornou a parcela não elegível" }
    });
  }
  return installment;
}
