import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { scheduleCollectionRun } from "@/lib/collection/scheduler";
export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${env().CRON_SECRET}`) return new NextResponse("unauthorized", { status: 401 });
  return NextResponse.json(await scheduleCollectionRun());
}
