import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { iguais } from "@/lib/painel/usuarios";
import { criarDeContratos, importarDoSienge, verificarELiberar } from "@/lib/comissoes/servico";

// Comissões de corretores — rota interna.
//   Bearer CONTRATOS_API_KEY, corpo do contrato assinado → cria a comissão
//     (chamada pelo sistema Contratos quando todos assinam; idempotente).
//   Bearer CRON_SECRET, ?acao=liberar[&preview=1] → lê o sinal no Sienge e libera.
//   Bearer CRON_SECRET, ?acao=importar → traz as vendas do Sienge (sem dados).
export const dynamic = "force-dynamic";

const Contrato = z.object({
  contratosId: z.string().min(1).max(80),
  corretorNome: z.string().max(200).nullish(),
  corretorCreci: z.string().max(40).nullish(),
  corretorDocumento: z.string().max(40).nullish(),
  corretagemValor: z.union([z.string().max(40), z.number()]).nullish(),
  valorVenda: z.union([z.string().max(40), z.number()]).nullish(),
  empreendimento: z.string().max(200).nullish(),
  unidade: z.string().max(120).nullish(),
  clienteNome: z.string().max(300).nullish(),
});

export async function POST(req: NextRequest) {
  const e = env();
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const acao = req.nextUrl.searchParams.get("acao");

  if (acao) {
    if (!token || !iguais(token, e.CRON_SECRET)) return new NextResponse("unauthorized", { status: 401 });
    if (acao === "liberar") return NextResponse.json(await verificarELiberar({ preview: req.nextUrl.searchParams.get("preview") === "1", solicitadoPor: "cron" }));
    if (acao === "importar") return NextResponse.json(await importarDoSienge());
    return NextResponse.json({ erro: "acao inválida" }, { status: 400 });
  }

  if (e.CONTRATOS_API_KEY.length < 16 || !token || !iguais(token, e.CONTRATOS_API_KEY)) return new NextResponse("unauthorized", { status: 401 });
  const p = Contrato.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ erro: "corpo inválido", detalhe: p.error.issues.slice(0, 3) }, { status: 400 });
  const { comissao, criada } = await criarDeContratos(p.data);
  return NextResponse.json({ ok: true, criada, comissaoId: comissao.id, status: comissao.status });
}
