import { env } from "../env";

function baseUrl() {
  return `https://api.sienge.com.br/${encodeURIComponent(env().SIENGE_SUBDOMAIN)}/public/api/v1`;
}

function authHeader() {
  return `Basic ${Buffer.from(`${env().SIENGE_USERNAME}:${env().SIENGE_PASSWORD}`).toString("base64")}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { Accept: "application/json", Authorization: authHeader(), ...(init?.headers || {}) },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store"
  });
  if (!r.ok) throw new Error(`Sienge ${r.status} ${path}: ${(await r.text()).slice(0, 500)}`);
  const contentType = r.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return await r.json() as T;
  return await r.text() as T;
}

export const sienge = {
  getCustomer: (id: number) => request<any>(`/customers/${id}`),
  getSalesContract: (id: number) => request<any>(`/sales-contracts/${id}`),
  getUnit: (id: number) => request<any>(`/units/${id}`),
  getReceivableBill: (billId: number) => request<any>(`/accounts-receivable/receivable-bills/${billId}`),
  getPaymentSlip: (billId: number, installmentId: number) => request<any>(`/payment-slip-notification?billReceivableId=${billId}&installmentId=${installmentId}`),
};
