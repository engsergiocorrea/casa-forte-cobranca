import { db } from "../db";
import { whatsappQueue } from "../queue";
import { daysFromDue } from "./date";
import { env } from "../env";

export async function scheduleCollectionRun(now = new Date()) {
  const rules = await db.collectionRule.findMany({ where: { enabled: true } });
  const installments = await db.installment.findMany({
    where: { status: "OPEN", dueDate: { gte: new Date(now.getTime() - 40*86400000), lte: new Date(now.getTime() + 10*86400000) } },
    include: { customer: { include: { phones: true, pauses: true } }, pauses: true }
  });
  let created = 0;
  for (const inst of installments) {
    if (inst.partialPaymentDetected) continue;
    const activePause = inst.pauses.some(p => p.until > now) || inst.customer.pauses.some(p => p.until > now);
    if (activePause) continue;
    const phone = inst.customer.phones.find(p => p.active && p.whatsappOptIn && p.preferred) || inst.customer.phones.find(p => p.active && p.whatsappOptIn);
    if (!phone) continue;
    const offset = daysFromDue(now, inst.dueDate, env().TIMEZONE);
    for (const rule of rules.filter(r => r.dayOffset === offset)) {
      const dedupeKey = `${inst.id}:${rule.id}:${inst.dueDate.toISOString().slice(0,10)}`;
      const msg = await db.message.upsert({
        where: { dedupeKey }, update: {},
        create: {
          customerId: inst.customerId, installmentId: inst.id, ruleId: rule.id, phone: phone.numberE164,
          templateName: rule.templateName, languageCode: rule.languageCode, scheduledAt: now, dedupeKey,
          payload: { customerName: inst.customer.name, amount: inst.currentAmount?.toString() || inst.originalAmount.toString(), dueDate: inst.dueDate.toISOString() }
        }
      });
      if (msg.status === "SCHEDULED") {
        await whatsappQueue.add("send-template", { messageId: msg.id }, { jobId: msg.id, attempts: 5, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 1000 });
        await db.message.update({ where: { id: msg.id }, data: { status: "QUEUED" } });
        created++;
      }
    }
  }
  return { created, installments: installments.length, rules: rules.length };
}
