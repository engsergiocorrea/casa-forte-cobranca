import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { usuarioPainel } from "@/lib/painel/auth";
import { avisarLiberacao, importarDoSienge, importarHistorico, marcarPaga, valorBR, verificarELiberar } from "@/lib/comissoes/servico";
import { destinatariosDiretoria, linkCorretor } from "@/lib/comissoes/avisos";
import { contratos as contratosSienge } from "@/lib/painel/sienge-cache";

// Painel → Comissões. GET lista; POST { acao } executa.
export const dynamic = "force-dynamic";

const MAX_ARQUIVO = 8 * 1024 * 1024;
const num = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));

export async function GET(req: NextRequest) {
  const u = usuarioPainel(req, { brain: true });
  if ("erro" in u) return u.erro;
  const [comissoes, corretores] = await Promise.all([
    db.comissao.findMany({ orderBy: [{ atualizadaEm: "desc" }], include: { corretor: true, arquivos: { select: { id: true, tipo: true, nome: true, criadoEm: true } } } }),
    db.corretor.findMany({ where: { ativo: true }, orderBy: { nome: "asc" } }),
  ]);
  return NextResponse.json({
    config: { modoTeste: env().COMISSAO_DRY_RUN, diretoria: destinatariosDiretoria().length },
    comissoes: comissoes.map((c) => ({
      id: c.id, status: c.status, origem: c.origem, contratoNumero: c.contratoNumero, empreendimento: c.empreendimento, unidade: c.unidade,
      clienteNome: c.clienteNome, valorVenda: num(c.valorVenda), valor: num(c.valor), corretorId: c.corretorId, corretorNome: c.corretor?.nome ?? c.corretorNome,
      siengeContractId: c.siengeContractId, sinalTotal: num(c.sinalTotal), sinalPago: num(c.sinalPago), verificadoEm: c.verificadoEm,
      liberadaEm: c.liberadaEm, pagaEm: c.pagaEm, pagaPor: c.pagaPor, nfNumero: c.nfNumero, nfEnviadaEm: c.nfEnviadaEm, observacao: c.observacao,
      arquivos: c.arquivos, criadaEm: c.criadaEm,
    })),
    corretores: corretores.map((k) => ({
      id: k.id, nome: k.nome, creci: k.creci, documento: k.documento, telefone: k.telefone, email: k.email, pixTipo: k.pixTipo, pixChave: k.pixChave, banco: k.banco,
      link: linkCorretor(k.token), dadosAtualizadosEm: k.dadosAtualizadosEm,
    })),
  });
}

export async function POST(req: NextRequest) {
  const u = usuarioPainel(req);
  if ("erro" in u) return u.erro;
  const b: any = await req.json().catch(() => ({}));
  const usuario = `painel:${u.usuario}`;
  try {
    switch (b.acao) {
      case "importar": return NextResponse.json(await importarDoSienge());
      case "importar_historico": {
        if (!Array.isArray(b.itens) || !b.itens.length || b.itens.length > 500) return NextResponse.json({ erro: "Arquivo sem vendas (ou com mais de 500)." }, { status: 400 });
        return NextResponse.json(await importarHistorico(b.itens, usuario));
      }
      case "verificar": return NextResponse.json(await verificarELiberar({ preview: !!b.previa, solicitadoPor: usuario }));
      case "salvar": {
        // Completar/editar: corretor, valor, observação e (opcional) o contrato do Sienge.
        // situacao: "acompanhar" → A_LIBERAR (libera no sinal); "ja_paga" → PAGA sem avisar ninguém.
        const c = await db.comissao.findUnique({ where: { id: String(b.id) } });
        if (!c) return NextResponse.json({ erro: "Comissão não encontrada." }, { status: 404 });
        const data: Prisma.ComissaoUpdateInput = {};
        if (b.corretorId !== undefined) data.corretor = b.corretorId ? { connect: { id: String(b.corretorId) } } : { disconnect: true };
        if (b.valor !== undefined) { const v = valorBR(b.valor); data.valor = v == null ? null : new Prisma.Decimal(v); }
        if (b.observacao !== undefined) data.observacao = String(b.observacao).slice(0, 500) || null;
        if (b.contratoNumero) {
          const k = (await contratosSienge(true)).find((x) => x.numero.toUpperCase() === String(b.contratoNumero).trim().toUpperCase());
          if (!k) return NextResponse.json({ erro: `Contrato ${b.contratoNumero} não encontrado no Sienge.` }, { status: 400 });
          const outra = await db.comissao.findUnique({ where: { siengeContractId: k.id } });
          if (outra && outra.id !== c.id) {
            if (outra.status === "PENDENTE_DADOS") await db.comissao.delete({ where: { id: outra.id } });
            else return NextResponse.json({ erro: `O contrato ${k.numero} já tem outra comissão.` }, { status: 409 });
          }
          Object.assign(data, { siengeContractId: k.id, contratoNumero: k.numero, empreendimento: c.empreendimento ?? k.empreendimento, unidade: c.unidade ?? (k.unidades.join(", ") || null) });
        }
        if (b.situacao === "acompanhar" && ["PENDENTE_DADOS", "CANCELADA"].includes(c.status)) data.status = "A_LIBERAR";
        if (b.situacao === "ja_paga" && c.status !== "PAGA") Object.assign(data, { status: "PAGA", pagaEm: new Date(), pagaPor: `${usuario} (registro de venda antiga)` });
        await db.comissao.update({ where: { id: c.id }, data });
        return NextResponse.json({ ok: true });
      }
      case "nova": {
        const v = valorBR(b.valor);
        const c = await db.comissao.create({ data: { origem: "MANUAL", status: "A_LIBERAR", corretorId: b.corretorId || null, valor: v == null ? null : new Prisma.Decimal(v), empreendimento: b.empreendimento || null, unidade: b.unidade || null, clienteNome: b.clienteNome || null, observacao: b.observacao || null } });
        return NextResponse.json({ ok: true, id: c.id });
      }
      case "liberar_manual": {
        // Sem condição de sinal no Sienge (ou acordo diferente): libera à mão e avisa.
        const r = await db.comissao.updateMany({ where: { id: String(b.id), status: "A_LIBERAR", corretorId: { not: null }, valor: { not: null } }, data: { status: "DISPONIVEL", liberadaEm: new Date() } });
        if (!r.count) return NextResponse.json({ erro: "Precisa estar 'a liberar' e ter corretor e valor." }, { status: 400 });
        return NextResponse.json({ ok: true, avisos: await avisarLiberacao(String(b.id), usuario) });
      }
      case "pagar": {
        let comprovante = null;
        if (b.comprovante?.base64) {
          const dados = Buffer.from(String(b.comprovante.base64), "base64");
          if (dados.length > MAX_ARQUIVO) return NextResponse.json({ erro: "Comprovante maior que 8 MB." }, { status: 400 });
          comprovante = { nome: String(b.comprovante.nome ?? "comprovante").slice(0, 120), mime: String(b.comprovante.mime ?? "application/octet-stream").slice(0, 80), dados };
        }
        return NextResponse.json({ ok: true, avisos: await marcarPaga(String(b.id), usuario, comprovante) });
      }
      case "cancelar": {
        await db.comissao.updateMany({ where: { id: String(b.id), status: { not: "PAGA" } }, data: { status: "CANCELADA", observacao: b.motivo ? String(b.motivo).slice(0, 500) : undefined } });
        return NextResponse.json({ ok: true });
      }
      default: return NextResponse.json({ erro: "Ação inválida." }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ erro: String(err?.message ?? err).slice(0, 300) }, { status: 400 });
  }
}
