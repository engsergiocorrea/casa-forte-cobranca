import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runReguaFromSienge } from "@/lib/collection/regua";

// Gatilho da régua automática (D-10/D0/D+1). Autenticado por Bearer CRON_SECRET.
// Pode ser chamado por um Railway Cron (recomendado) ou por um cron HTTP externo.
// Idempotente: rodar mais de uma vez no dia não duplica envios (dedupe).
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${env().CRON_SECRET}`) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  return NextResponse.json(await runReguaFromSienge(new Date()));
}
