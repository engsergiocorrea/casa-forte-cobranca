import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { executarAlteracao, previaAlteracao, type Pedido } from "@/lib/painel/sienge-escrita";

// Alterações no Sienge (painel/Brain). { acao: "previa" | "executar", ...pedido }.
// Ver lib/painel/sienge-escrita.ts (trava SIENGE_WRITE_DRY_RUN + registro).
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const OPS = ["TELEFONES", "ENDERECO", "BOLETO_EMAIL", "VENCIMENTO"];
export async function POST(req: NextRequest) {
  const a = usuarioPainel(req, { brain: true }); if ("erro" in a) return a.erro;
  const b: any = await req.json().catch(() => ({}));
  if (!OPS.includes(b?.operacao)) return NextResponse.json({ erro: `operacao: ${OPS.join(", ")}` }, { status: 400 });
  const usuario = a.usuario.startsWith("brain:") ? a.usuario : `painel:${a.usuario}`;
  try {
    if (b.acao === "executar") return NextResponse.json(await executarAlteracao(b as Pedido, usuario));
    return NextResponse.json(await previaAlteracao(b as Pedido));
  } catch (err) {
    return NextResponse.json({ erro: String((err as Error)?.message ?? err).slice(0, 300) }, { status: 400 });
  }
}
