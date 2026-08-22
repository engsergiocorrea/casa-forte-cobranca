import crypto from "node:crypto";

export function verifyMetaSignature(rawBody: string, signature: string | null, appSecret: string) {
  if (!appSecret) return true; // staging convenience; REQUIRE secret before production
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)); } catch { return false; }
}

export function extractStatuses(payload: any) {
  const out: Array<{ id: string; status: string; timestamp: Date; payload: any }> = [];
  for (const entry of payload?.entry || []) for (const change of entry?.changes || []) {
    for (const s of change?.value?.statuses || []) {
      out.push({ id: s.id, status: s.status, timestamp: new Date(Number(s.timestamp) * 1000), payload: s });
    }
  }
  return out;
}
