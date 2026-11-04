import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { calcularFluxo } from "@/lib/painel/fluxo";
import { sincronizarHistorico } from "@/lib/painel/historico";

// Previsão de fluxo de caixa (aba "Fluxo de caixa").
//   GET  ?atualizar=1 → recalcula agora (saldos ao vivo no Sienge, REST sem limite)
//   POST { acao: "sincronizar" } → atualiza pagamentos e correção de TODOS os
//        contratos no Sienge (2 das 20 consultas bulk do dia) e recalcula
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req, { brain: true }); if ("erro" in a) return a.erro;
  return NextResponse.json(await calcularFluxo({ forcar: req.nextUrl.searchParams.get("atualizar") === "1" }));
}
export async function POST(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  const b: any = await req.json().catch(() => ({}));
  if (b?.acao !== "sincronizar") return NextResponse.json({ erro: "acao" }, { status: 400 });
  try { await sincronizarHistorico(); }
  catch { return NextResponse.json({ erro: "Não foi possível consultar o Sienge agora (limite diário ou Sienge fora do ar)." }, { status: 502 }); }
  return NextResponse.json(await calcularFluxo({ forcar: true }));
}
