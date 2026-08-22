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

// Extrai um "count" de forma defensiva, SEM assumir o schema do Sienge
// (o mapper só será cristalizado com respostas reais — ver mapper.ts).
export function extractCount(json: any): number | null {
  if (Array.isArray(json)) return json.length;
  if (typeof json?.resultSetMetadata?.count === "number") return json.resultSetMetadata.count;
  if (Array.isArray(json?.results)) return json.results.length;
  if (Array.isArray(json?.data)) return json.data.length;
  return null;
}

// Ping READ-ONLY para diagnóstico de conectividade/autenticação com o Sienge.
// Faz um GET e devolve SOMENTE { httpStatus, ok, count } — nunca o corpo bruto,
// credenciais ou o header Authorization. Não lança em erro HTTP (para a rota de
// diagnóstico poder mapear 401/403). Não executa POST/PUT/PATCH/DELETE.
export async function siengePing(path: string): Promise<{ httpStatus: number; ok: boolean; count: number | null }> {
  const r = await fetch(`${baseUrl()}${path}`, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: authHeader() },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  let count: number | null = null;
  if (r.ok) {
    try { count = extractCount(await r.json()); } catch { /* corpo não-JSON: ignora */ }
  }
  return { httpStatus: r.status, ok: r.ok, count };
}
