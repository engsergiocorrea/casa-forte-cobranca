import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { enviarManual, prepararEnvioManual, type TipoManual } from "@/lib/painel/envio-manual";

// Envio manual pelo painel. Sempre em 2 passos: { acao: "previa" } mostra o
// texto exato e o telefone; { acao: "enviar" } envia (o último comando é da pessoa).
export const dynamic = "force-dynamic";
const TIPOS: TipoManual[] = ["BOLETO", "LEMBRETE_D0", "COBRANCA"];
export async function POST(req: NextRequest) {
  const a = usuarioPainel(req, { brain: true }); if ("erro" in a) return a.erro;
  const b: any = await req.json().catch(() => ({}));
  const tipo = String(b?.tipo ?? "") as TipoManual;
  const customerId = Number(b?.customerId);
  const itens = (Array.isArray(b?.itens) ? b.itens : []).map((i: any) => ({ billId: Number(i?.billId), installmentId: Number(i?.installmentId) })).filter((i: any) => i.billId && i.installmentId);
  if (!TIPOS.includes(tipo) || !customerId || !itens.length) return NextResponse.json({ erro: "Informe tipo, customerId e itens." }, { status: 400 });
  const pedido = { tipo, customerId, itens };
  if (b?.acao === "enviar") {
    const r = await enviarManual(pedido, a.usuario);
    const { msg, ...resto } = r;
    return NextResponse.json(resto);
  }
  const { msg, ...prev } = await prepararEnvioManual(pedido);
  return NextResponse.json(prev);
}
