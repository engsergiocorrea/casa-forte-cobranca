// IMPORTANT: Sienge responses vary by resource/version. This mapper is intentionally defensive.
// During first integration test, save a redacted real payload and tighten these mappings with Claude.
import { toBrazilE164 } from "../safety";
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

// Parcela vinda de GET /accounts-receivable/receivable-bills/{billId}/installments
// (schema real capturado em 23/08/2026):
//   { receivableBillId, installmentId, carrierId, conditionTypeId, dueDate,
//     balanceDue, generatedBoleto }
// Regra: `balanceDue` é o SALDO oficial do Sienge — não recalcular. Cobrança só
// quando saldo > 0. `generatedBoleto` indica se o boleto já foi emitido.
export type NormalizedInstallmentRow = {
  billId: number;
  installmentId: number;
  dueDate: Date;
  balanceDue: number;
  generatedBoleto: boolean;
  paid: boolean;
  carrierId?: number;
  conditionTypeId?: string;
};

export function normalizeInstallmentRow(x: any): NormalizedInstallmentRow {
  const balanceDue = Number(first(x?.balanceDue, x?.balance, 0));
  return {
    billId: Number(first(x?.receivableBillId, x?.billId)),
    installmentId: Number(first(x?.installmentId, x?.id, x?.number)),
    dueDate: parseSiengeDate(first(x?.dueDate, x?.dateDue, x?.expirationDate)),
    balanceDue,
    generatedBoleto: Boolean(first(x?.generatedBoleto, x?.boletoGenerated, false)),
    paid: balanceDue === 0,
    carrierId: x?.carrierId != null ? Number(x.carrierId) : undefined,
    conditionTypeId: x?.conditionTypeId != null ? String(x.conditionTypeId) : undefined,
  };
}

// Boleto vindo de GET /payment-slip-notification?billReceivableId=..&installmentId=..
// (schema real 23/08/2026): results[] = { urlReport, digitableNumber, parameter1207 }.
export type NormalizedBoleto = { url: string | null; linhaDigitavel: string | null };
export function normalizePaymentSlip(payload: any): NormalizedBoleto {
  const rows = Array.isArray(payload) ? payload : (payload?.results ?? payload?.data ?? []);
  const it = (Array.isArray(rows) ? rows[0] : rows) ?? {};
  const url = first(it?.urlReport, it?.url, it?.reportUrl);
  const linha = first(it?.digitableNumber, it?.digitableLine, it?.barCode);
  return { url: url ? String(url) : null, linhaDigitavel: linha ? String(linha) : null };
}

// Telefones do cadastro do cliente no Sienge (GET /customers/{id}).
// Estrutura varia por versão — extração defensiva. Devolve em E.164 BR para o
// envio (o número precisa estar na WHATSAPP_ALLOWLIST para sair de verdade).
export type CustomerPhone = { numero: string; tipo: string | null; principal: boolean };
export function normalizeCustomerPhones(customer: any): CustomerPhone[] {
  const root = Array.isArray(customer) ? customer[0] : customer;
  const list = arr(first(root?.phones, root?.phoneNumbers, root?.contacts, root?.telephones));
  const out: CustomerPhone[] = [];
  const push = (raw: any, tipo: any, principal: any) => {
    const e164 = toBrazilE164(String(raw ?? ""));
    if (e164 && e164.replace(/\D/g, "").length >= 12 && !out.some(o => o.numero === e164)) {
      out.push({ numero: e164, tipo: tipo != null ? String(tipo) : null, principal: !!principal });
    }
  };
  for (const p of (Array.isArray(list) ? list : [])) {
    const raw = first(
      p?.number, p?.phoneNumber, p?.fullNumber, p?.phone,
      (p?.ddd ?? p?.areaCode) ? `${p?.ddd ?? p?.areaCode}${p?.number ?? p?.phoneNumber ?? ""}` : undefined,
    );
    push(raw, first(p?.type, p?.description, p?.kind), first(p?.main, p?.principal, false));
  }
  // Campos soltos no topo do cadastro (algumas versões do Sienge).
  for (const key of ["cellPhone", "cellphone", "mobilePhone", "mobile", "phone", "telephone"]) {
    if (root?.[key]) push(root[key], key, false);
  }
  return out;
}

export function normalizeInstallmentsList(payload: any): NormalizedInstallmentRow[] {
  const rows = Array.isArray(payload) ? payload : (payload?.results ?? payload?.data ?? payload?.installments ?? []);
  return (rows as any[]).map(normalizeInstallmentRow).filter(r => Number.isFinite(r.installmentId));
}

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
