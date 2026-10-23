import { NextResponse } from "next/server";

// Saúde + versão no ar (commit do deploy). Use antes de qualquer envio manual
// para conferir se o deploy novo já está ACTIVE. Sem dados sensíveis.
export const dynamic = "force-dynamic";

export function GET() {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA ?? null;
  return NextResponse.json({
    ok: true,
    service: "casa-forte-cobranca",
    commit: sha ? sha.slice(0, 7) : null,
    mensagem: process.env.RAILWAY_GIT_COMMIT_MESSAGE?.split("\n")[0] ?? null,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
    agora: new Date().toISOString(),
  });
}
