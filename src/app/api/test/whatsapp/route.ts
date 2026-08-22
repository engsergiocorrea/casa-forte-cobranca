import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sendWhatsAppTemplate } from "@/lib/whatsapp/client";
export async function POST(req: NextRequest) {
  if (env().APP_MODE !== "staging") return new NextResponse("only staging", { status: 403 });
  if (req.headers.get("authorization") !== `Bearer ${env().CRON_SECRET}`) return new NextResponse("unauthorized", { status: 401 });
  const body = await req.json();
  const result = await sendWhatsAppTemplate({ to: body.to, templateName: body.templateName || "hello_world", languageCode: body.languageCode || "en_US", bodyParameters: body.bodyParameters || [] });
  return NextResponse.json(result);
}
