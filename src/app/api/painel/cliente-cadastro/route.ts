import { NextRequest, NextResponse } from "next/server";
import { usuarioPainel } from "@/lib/painel/auth";
import { cadastroCliente } from "@/lib/painel/cadastro";

// Dados cadastrais do cliente no Sienge (CPF, RG, telefones, endereços, e-mail,
// filiação, cônjuge…). Dado pessoal: só usuários do painel e o Brain (com
// permissão própria lá). Registra quem consultou no log do servidor.
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const a = usuarioPainel(req, { brain: true }); if ("erro" in a) return a.erro;
  const customerId = Number(req.nextUrl.searchParams.get("customerId"));
  if (!customerId) return NextResponse.json({ erro: "customerId" }, { status: 400 });
  console.log(JSON.stringify({ evento: "cadastro_cliente_consultado", customerId, por: a.usuario, em: new Date().toISOString() }));
  try { return NextResponse.json(await cadastroCliente(customerId)); }
  catch (err) { return NextResponse.json({ erro: (err as Error).message.slice(0, 200) }, { status: 404 }); }
}
