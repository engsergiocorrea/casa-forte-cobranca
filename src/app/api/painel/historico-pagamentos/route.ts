import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { historicoDoTitulo, sincronizarHistorico } from "@/lib/painel/historico";

// Histórico de pagamentos de um título (da nossa base, sem ir ao Sienge).
//   GET  ?billId=47 → { sincronizadoEm, resumo, pagamentos[] }
//   POST { billId } → atualiza do Sienge (1 das 20 chamadas bulk do dia) e devolve
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req, { brain: true }); if ("erro" in a) return a.erro;
  const billId = Number(req.nextUrl.searchParams.get("billId"));
  if (!billId) return NextResponse.json({ erro: "billId" }, { status: 400 });
  return NextResponse.json(await historicoDoTitulo(billId));
}
export async function POST(req: NextRequest) {
  const a = usuarioPainel(req); if ("erro" in a) return a.erro;
  const b: any = await req.json().catch(() => ({}));
  const billId = Number(b?.billId);
  if (!billId) return NextResponse.json({ erro: "billId" }, { status: 400 });
  try { await sincronizarHistorico([billId]); }
  catch { return NextResponse.json({ erro: "Não foi possível consultar o Sienge agora (limite diário ou Sienge fora do ar)." }, { status: 502 }); }
  return NextResponse.json(await historicoDoTitulo(billId));
}
