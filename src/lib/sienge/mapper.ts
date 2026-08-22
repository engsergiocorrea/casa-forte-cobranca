// IMPORTANT: Sienge responses vary by resource/version. This mapper is intentionally defensive.
// During first integration test, save a redacted real payload and tighten these mappings with Claude.
function first<T = any>(...values: T[]): T | undefined { return values.find(v => v !== undefined && v !== null); }
function arr(v: any): any[] { return Array.isArray(v) ? v : v?.results || v?.data || []; }
function parseSiengeDate(v: any) {
  const s = String(v || "");
  // Date-only fields represent a business date. Noon UTC prevents Brazil timezone from shifting it to the previous day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00Z`);
  return new Date(s);
}

export type NormalizedInstallment = {
  billId: number; installmentId: number; customerId: number; customerName: string;
  dueDate: Date; originalAmount: number; currentAmount?: number;
  status: "OPEN" | "PAID" | "CANCELED" | "PARTIAL" | "UNKNOWN";
  partial: boolean;
};

export function normalizeReceivableBill(payload: any, wantedInstallmentId: number): NormalizedInstallment {
  const root = Array.isArray(payload) ? payload[0] : payload;
  const installments = arr(first(root?.installments, root?.receivableInstallments, root?.parcels));
  const inst = installments.find((x: any) => Number(first(x.installmentId, x.id, x.number)) === wantedInstallmentId) ?? installments[0] ?? root;
  const billId = Number(first(root?.receivableBillId, root?.id, root?.billId));
  const customer = first(root?.customer, inst?.customer) as any;
  const customerId = Number(first(root?.customerId, customer?.id, customer?.customerId, inst?.customerId));
  const customerName = String(first(customer?.name, root?.customerName, inst?.customerName, `Cliente ${customerId}`));
  const dueRaw = first(inst?.dueDate, inst?.dateDue, inst?.expirationDate, root?.dueDate);
  const originalAmount = Number(first(inst?.originalAmount, inst?.amount, inst?.value, root?.amount, 0));
  const currentAmount = Number(first(inst?.currentAmount, inst?.balance, inst?.valueBalance, originalAmount));
  const statusRaw = String(first(inst?.status, inst?.situation, root?.situation, "UNKNOWN")).toUpperCase();
  const paid = /PAID|PAGO|RECEBIDO|QUITADO/.test(statusRaw) || currentAmount === 0;
  const canceled = /CANCEL/.test(statusRaw);
  const partial = /PARTIAL|PARCIAL/.test(statusRaw) || (!paid && currentAmount > 0 && currentAmount < originalAmount);
  return {
    billId,
    installmentId: wantedInstallmentId,
    customerId,
    customerName,
    dueDate: parseSiengeDate(dueRaw),
    originalAmount,
    currentAmount,
    status: paid ? "PAID" : canceled ? "CANCELED" : partial ? "PARTIAL" : /OPEN|ABERTO|PENDENTE/.test(statusRaw) ? "OPEN" : "UNKNOWN",
    partial
  };
}
