import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { buscarClientes } from "@/lib/painel/sienge-cache";
import { buscarPorDocumento } from "@/lib/painel/cadastro";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req, { brain: true }); if ("erro" in a) return a.erro;
  const q = req.nextUrl.searchParams.get("q") ?? "";
  // CPF/CNPJ (11 ou 14 dígitos): busca direto no cadastro do Sienge.
  const porDocumento = await buscarPorDocumento(q);
  return NextResponse.json(porDocumento ?? await buscarClientes(q));
}
