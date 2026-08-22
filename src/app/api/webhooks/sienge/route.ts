import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { siengeQueue } from "@/lib/queue";

export async function POST(req: NextRequest) {
  // Sienge docs expose event/id/tenant headers but do not document a webhook signature here.
  // We therefore register the URL with a long random query token and also validate tenant/user-agent.
  if (req.nextUrl.searchParams.get("token") !== env().SIENGE_WEBHOOK_TOKEN) return new NextResponse("unauthorized", { status: 401 });
  const eventName = req.headers.get("x-sienge-event") || "UNKNOWN";
  const externalId = req.headers.get("x-sienge-id") || crypto.randomUUID();
  const tenant = req.headers.get("x-sienge-tenant");
  const agent = req.headers.get("user-agent") || "";
  if (tenant && tenant !== env().SIENGE_SUBDOMAIN) return new NextResponse("wrong tenant", { status: 403 });
  if (agent && !agent.includes("sienge-hooks")) console.warn("Unexpected Sienge webhook user-agent", agent);
  const payload = await req.json();
  const record = await db.integrationEvent.upsert({
    where: { source_externalId: { source: "SIENGE", externalId } },
    update: {},
    create: { source: "SIENGE", externalId, eventName, tenant, payload, headers: Object.fromEntries(req.headers.entries()) }
  });
  await siengeQueue.add("process", { eventId: record.id }, { jobId: `sienge:${externalId}`, attempts: 5, backoff: { type: "exponential", delay: 10_000 } });
  return NextResponse.json({ received: true }, { status: 202 });
}
