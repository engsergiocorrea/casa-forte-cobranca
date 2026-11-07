import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { consultaSienge } from "@/lib/painel/sienge-consulta";

// Consultas de LEITURA ao Sienge para o painel e o Brain (lista fechada de
// recursos liberados para o usuário da API). Nada é alterado no Sienge.
//   GET ?recurso=obras | unidades[&obra=Santorini&situacao=disponivel] | contas-bancarias | centros-de-custo
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req, { brain: true }); if ("erro" in a) return a.erro;
  const q = req.nextUrl.searchParams;
  try { return NextResponse.json(await consultaSienge(String(q.get("recurso") ?? ""), { obra: q.get("obra") ?? undefined, situacao: q.get("situacao") ?? undefined })); }
  catch (err) { return NextResponse.json({ erro: (err as Error).message.slice(0, 200) }, { status: 400 }); }
}
