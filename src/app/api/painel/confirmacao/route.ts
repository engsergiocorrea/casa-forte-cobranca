import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { confirmacaoManual } from "@/lib/painel/recibo";

// Confirmação de pagamento sob demanda (texto + recibo em PDF ao cliente).
// Sempre em 2 passos: { acao: "previa" } e depois { acao: "enviar" }.
// Já enviada antes → só com { reenviar: true }.
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const a = usuarioPainel(req, { brain: true }); if ("erro" in a) return a.erro;
  const b: any = await req.json().catch(() => ({}));
  const customerId = Number(b?.customerId);
  const itens = (Array.isArray(b?.itens) ? b.itens : []).map((i: any) => ({ billId: Number(i?.billId), installmentId: Number(i?.installmentId) })).filter((i: any) => i.billId && i.installmentId).slice(0, 12);
  if (!customerId || !itens.length) return NextResponse.json({ erro: "Informe customerId e itens." }, { status: 400 });
  return NextResponse.json(await confirmacaoManual({ customerId, itens, acao: b?.acao === "enviar" ? "enviar" : "previa", reenviar: b?.reenviar === true, usuario: a.usuario.startsWith("brain:") ? a.usuario : `painel:${a.usuario}` }));
}
