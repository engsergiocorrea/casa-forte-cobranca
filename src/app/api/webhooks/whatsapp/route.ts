import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { extractStatuses, verifyMetaSignature } from "@/lib/whatsapp/webhook";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === env().WHATSAPP_VERIFY_TOKEN) return new NextResponse(q.get("hub.challenge") || "", { status: 200 });
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), env().WHATSAPP_APP_SECRET)) return new NextResponse("bad signature", { status: 401 });
  const payload = JSON.parse(raw);
  for (const s of extractStatuses(payload)) {
    const msg = await db.message.findUnique({ where: { externalMessageId: s.id } });
    await db.messageEvent.create({ data: { messageId: msg?.id, externalMessageId: s.id, status: s.status, payload: s.payload, occurredAt: s.timestamp } });
    if (msg) {
      const map: any = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };
      if (map[s.status]) await db.message.update({ where: { id: msg.id }, data: { status: map[s.status] } });
    }
  }
  return NextResponse.json({ ok: true });
}
