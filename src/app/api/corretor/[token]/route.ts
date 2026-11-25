import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { avisarNfRecebida, digitos, telefoneE164 } from "@/lib/comissoes/servico";
import { tomadorDe } from "@/lib/comissoes/tomador";

// Link público do corretor (/corretor/<token>). O token (aleatório, 32 chars)
// é a autenticação: só dá acesso às comissões DESTE corretor.
//   GET                 → dados + comissões
//   GET ?arquivo=<id>   → baixa NF/comprovante de uma comissão dele
//   POST {acao:"dados"} → salva CPF/CNPJ, CRECI, PIX, banco, e-mail
//   POST {acao:"nf"}    → envia NF/RPA (nº e/ou arquivo PDF/JPG/PNG até 8 MB)
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ token: string }> };

const MAX = 8 * 1024 * 1024;
const MIMES = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"];
const txt = (v: unknown, max = 200) => { const s = String(v ?? "").trim().slice(0, max); return s || null; };
const STATUS: Record<string, string> = { PENDENTE_DADOS: "Em cadastro", A_LIBERAR: "Aguardando o sinal do cliente", DISPONIVEL: "Liberada — envie a NF/RPA", PAGA: "Paga", CANCELADA: "Cancelada" };

async function corretorDo(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  return db.corretor.findFirst({ where: { token, ativo: true } });
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const k = await corretorDo((await ctx.params).token);
  if (!k) return NextResponse.json({ erro: "Link inválido ou desativado." }, { status: 404 });
  const arq = req.nextUrl.searchParams.get("arquivo");
  if (arq) {
    const a = await db.comissaoArquivo.findFirst({ where: { id: arq, comissao: { corretorId: k.id } } });
    if (!a) return new NextResponse("não encontrado", { status: 404 });
    return new NextResponse(Buffer.from(a.dados), { headers: { "Content-Type": a.mime, "Content-Disposition": `inline; filename="${encodeURIComponent(a.nome)}"`, "Cache-Control": "private, no-store" } });
  }
  const cs = await db.comissao.findMany({ where: { corretorId: k.id, status: { not: "PENDENTE_DADOS" } }, orderBy: { criadaEm: "desc" }, include: { arquivos: { select: { id: true, tipo: true, nome: true } } } });
  return NextResponse.json({
    corretor: { nome: k.nome, creci: k.creci, documento: k.documento, email: k.email, telefone: k.telefone, pixTipo: k.pixTipo, pixChave: k.pixChave, banco: k.banco },
    comissoes: cs.map((c) => {
      const t = tomadorDe(c.empreendimento);
      const venda = [c.unidade, c.empreendimento].filter(Boolean).join(" – ");
      return {
        id: c.id, status: c.status, statusTexto: STATUS[c.status] ?? c.status, venda, contrato: c.contratoNumero, cliente: c.clienteNome,
        valor: c.valor == null ? null : Number(c.valor), liberadaEm: c.liberadaEm, pagaEm: c.pagaEm, nfNumero: c.nfNumero, nfEnviadaEm: c.nfEnviadaEm,
        tomador: t, descricaoNf: `Comissão de corretagem referente à venda da unidade ${c.unidade ?? ""}${c.empreendimento ? ` do empreendimento ${c.empreendimento}` : ""}${c.contratoNumero ? `, contrato ${c.contratoNumero}` : ""}${c.clienteNome ? `, cliente ${c.clienteNome}` : ""}.`.replace(/\s+/g, " "),
        arquivos: c.arquivos,
      };
    }),
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const k = await corretorDo((await ctx.params).token);
  if (!k) return NextResponse.json({ erro: "Link inválido ou desativado." }, { status: 404 });
  const b: any = await req.json().catch(() => ({}));
  if (b.acao === "dados") {
    const doc = digitos(b.documento);
    if (doc && doc.length !== 11 && doc.length !== 14) return NextResponse.json({ erro: "CPF deve ter 11 dígitos e CNPJ 14." }, { status: 400 });
    await db.corretor.update({ where: { id: k.id }, data: {
      documento: doc || null, creci: txt(b.creci, 40), email: txt(b.email, 120), pixTipo: txt(b.pixTipo, 20), pixChave: txt(b.pixChave, 140), banco: txt(b.banco, 200),
      telefone: telefoneE164(b.telefone) ?? k.telefone, dadosAtualizadosEm: new Date(),
    } });
    return NextResponse.json({ ok: true });
  }
  if (b.acao === "nf") {
    const c = await db.comissao.findFirst({ where: { id: String(b.comissaoId), corretorId: k.id, status: { in: ["A_LIBERAR", "DISPONIVEL"] } } });
    if (!c) return NextResponse.json({ erro: "Comissão não encontrada ou já paga." }, { status: 404 });
    const numero = txt(b.nfNumero, 60);
    let arquivo: { nome: string; mime: string; dados: Buffer } | null = null;
    if (b.arquivo?.base64) {
      const dados = Buffer.from(String(b.arquivo.base64), "base64");
      const mime = String(b.arquivo.mime ?? "");
      if (dados.length > MAX) return NextResponse.json({ erro: "Arquivo maior que 8 MB." }, { status: 400 });
      if (!MIMES.includes(mime)) return NextResponse.json({ erro: "Envie PDF ou foto (JPG/PNG)." }, { status: 400 });
      arquivo = { nome: String(b.arquivo.nome ?? "nota").slice(0, 120), mime, dados };
    }
    if (!numero && !arquivo) return NextResponse.json({ erro: "Informe o número da nota ou anexe o arquivo." }, { status: 400 });
    if (arquivo) await db.comissaoArquivo.create({ data: { comissaoId: c.id, tipo: "NF", nome: arquivo.nome, mime: arquivo.mime, tamanho: arquivo.dados.length, dados: new Uint8Array(arquivo.dados), enviadoPor: "corretor" } });
    await db.comissao.update({ where: { id: c.id }, data: { nfNumero: numero ?? c.nfNumero, nfEnviadaEm: new Date() } });
    await avisarNfRecebida(c.id).catch(() => null);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ erro: "Ação inválida." }, { status: 400 });
}
