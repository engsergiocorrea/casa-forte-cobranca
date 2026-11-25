import crypto from "node:crypto";
import { Prisma, type Comissao, type Corretor } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { sienge } from "../sienge/client";
import { contratos as contratosSienge, type ContratoResumo } from "../painel/sienge-cache";
import { toBrazilE164 } from "../safety";
import { chaveUnidade, mesmoEmpreendimento, situacaoSinal } from "./sinal";
import { destinatariosDiretoria, enviarAviso, textos, type ResultadoAviso } from "./avisos";

export const novoToken = () => crypto.randomBytes(24).toString("base64url");
export const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const dec = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : new Prisma.Decimal(Number(v)));

// Valor monetário vindo do Contratos ("44.400,00") ou número.
export function valorBR(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/[^\d,.-]/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Casa o corretor pelo documento, depois CRECI, depois nome exato; senão cria.
export async function acharOuCriarCorretor(d: { nome?: string | null; creci?: string | null; documento?: string | null }): Promise<Corretor | null> {
  const nome = String(d.nome ?? "").trim().replace(/\s*\/.*$/, "").trim(); // "Fulano / Imobiliária X" → "Fulano"
  const doc = digitos(d.documento), creci = digitos(d.creci);
  if (!nome && !doc && !creci) return null;
  const todos = await db.corretor.findMany({ where: { ativo: true } });
  const achado = (doc && todos.find((c) => digitos(c.documento) === doc)) || (creci && todos.find((c) => digitos(c.creci) === creci)) || (nome && todos.find((c) => norm(c.nome) === norm(nome)));
  if (achado) return achado;
  if (!nome) return null;
  return db.corretor.create({ data: { nome, creci: creci || null, documento: doc || null, token: novoToken() } });
}

// Contrato do Sienge da mesma unidade/empreendimento (vendas não canceladas).
export function contratoDaUnidade(lista: ContratoResumo[], empreendimento: string | null | undefined, unidade: string | null | undefined): ContratoResumo | null {
  const u = chaveUnidade(unidade);
  if (!u) return null;
  const cands = lista.filter((c) => !/cancel/i.test(c.situacao) && c.unidades.some((x) => chaveUnidade(x) === u) && (!empreendimento || mesmoEmpreendimento(c.empreendimento, empreendimento)));
  return cands.length === 1 ? cands[0] : null; // ambíguo → não vincula sozinho
}

// Chamado pelo Contratos quando todos assinam (idempotente por contratosId).
export async function criarDeContratos(p: {
  contratosId: string; corretorNome?: string | null; corretorCreci?: string | null; corretorDocumento?: string | null;
  corretagemValor?: unknown; valorVenda?: unknown; empreendimento?: string | null; unidade?: string | null; clienteNome?: string | null;
}) {
  const existente = await db.comissao.findUnique({ where: { contratosId: p.contratosId } });
  if (existente) return { comissao: existente, criada: false };
  const corretor = await acharOuCriarCorretor({ nome: p.corretorNome, creci: p.corretorCreci, documento: p.corretorDocumento });
  const comissao = await db.comissao.create({ data: {
    contratosId: p.contratosId, origem: "CONTRATOS", status: "A_LIBERAR",
    corretorId: corretor?.id ?? null, corretorNome: p.corretorNome?.trim() || null,
    valor: dec(valorBR(p.corretagemValor)), valorVenda: dec(valorBR(p.valorVenda)),
    empreendimento: p.empreendimento ?? null, unidade: p.unidade ?? null, clienteNome: p.clienteNome ?? null,
  } });
  await tentarVincular(comissao).catch(() => null);
  return { comissao, criada: true };
}

// Liga a comissão ao contrato do Sienge pela unidade (só se não houver outra
// comissão já ligada a ele — senão o importado e o do Contratos se fundem).
export async function tentarVincular(c: Comissao, lista?: ContratoResumo[]): Promise<boolean> {
  if (c.siengeContractId) return true;
  const k = contratoDaUnidade(lista ?? await contratosSienge(), c.empreendimento, c.unidade);
  if (!k?.id) return false;
  const outra = await db.comissao.findUnique({ where: { siengeContractId: k.id } });
  if (outra && outra.id !== c.id) {
    // Importada antes (sem dados) + nova do Contratos → mantém a do Contratos.
    if (outra.status === "PENDENTE_DADOS" && outra.origem === "SIENGE_IMPORT") await db.comissao.delete({ where: { id: outra.id } });
    else return false;
  }
  await db.comissao.update({ where: { id: c.id }, data: { siengeContractId: k.id, contratoNumero: k.numero, empreendimento: c.empreendimento ?? k.empreendimento, valorVenda: c.valorVenda ?? dec(k.valor), clienteNome: c.clienteNome ?? (k.clientes.map((x) => x.nome).join(" e ") || null) } });
  return true;
}

// Vendas já no Sienge. Histórico (contrato até COMISSAO_HISTORICO_ATE): entra
// como PAGA, sem mensagem nenhuma — todas já foram pagas (algumas sem baixa no
// Sienge). Posteriores sem comissão: PENDENTE_DADOS (o financeiro completa).
// Idempotente (siengeContractId único).
// Comissões já lançadas no Sienge, agrupadas por nº do contrato:
// corretores (nome → soma das parcelas) e total.
export async function comissoesDoSienge(): Promise<Map<string, { total: number; corretores: Map<string, number> }>> {
  const out = new Map<string, { total: number; corretores: Map<string, number> }>();
  for (let off = 0; off < 5000; off += 200) {
    const raw = await sienge.listCommissions(200, off);
    const page = (Array.isArray(raw) ? raw : (raw?.results ?? [])) as any[];
    for (const x of page) {
      const num = String(x?.salesContractNumber ?? "").trim().toUpperCase();
      if (!num || String(x?.installmentStatus ?? "").toUpperCase() === "CANCELED") continue;
      const g = out.get(num) ?? { total: 0, corretores: new Map<string, number>() };
      const v = Number(x?.value) || 0;
      const nome = String(x?.brokerName ?? "").trim() || "Corretor";
      g.total += v; g.corretores.set(nome, (g.corretores.get(nome) ?? 0) + v);
      out.set(num, g);
    }
    if (page.length < 200) break;
  }
  return out;
}

export async function importarDoSienge() {
  const lista = await contratosSienge(true);
  const corte = env().COMISSAO_HISTORICO_ATE;
  const doSienge = await comissoesDoSienge().catch(() => new Map<string, { total: number; corretores: Map<string, number> }>());
  let criadas = 0, historico = 0, vinculadas = 0, jaExistiam = 0, canceladas = 0;
  for (const c of await db.comissao.findMany({ where: { siengeContractId: null } })) if (await tentarVincular(c, lista)) vinculadas++;
  for (const k of lista) {
    if (!k.id) continue;
    if (/cancel/i.test(k.situacao)) { canceladas++; continue; }
    if (await db.comissao.findUnique({ where: { siengeContractId: k.id } })) { jaExistiam++; continue; }
    const antiga = !!k.data && k.data <= corte;
    const sc = doSienge.get(k.numero.toUpperCase());
    const nomes = sc ? [...sc.corretores.keys()] : [];
    const corretor = nomes.length ? await acharOuCriarCorretor({ nome: nomes[0] }) : null;
    for (const n of nomes.slice(1)) await acharOuCriarCorretor({ nome: n });
    const detalhe = sc ? ` Comissão no Sienge: ${[...sc.corretores].map(([n, v]) => `${n} ${v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`).join(" + ")}.` : "";
    await db.comissao.create({ data: {
      corretorId: corretor?.id ?? null, corretorNome: nomes.join(" + ") || null, valor: sc ? dec(Math.round(sc.total * 100) / 100) : null,
      siengeContractId: k.id, contratoNumero: k.numero, empreendimento: k.empreendimento, unidade: k.unidades.join(", ") || null,
      clienteNome: k.clientes.map((x) => x.nome).join(" e ") || null, valorVenda: dec(k.valor), origem: "SIENGE_IMPORT",
      ...(antiga
        ? { status: "PAGA", pagaPor: "histórico (antes do sistema)", observacao: `Venda de ${(k.data ?? "").split("-").reverse().join("/")} — comissão já paga antes do controle pelo sistema.${detalhe}` }
        : { status: "PENDENTE_DADOS" }),
    } });
    if (antiga) historico++; else criadas++;
  }
  return { contratosNoSienge: lista.length, historico, criadas, vinculadas, jaExistiam, canceladas };
}

type Liberacao = { id: string; venda: string; resultado: string; sinal?: string; avisos?: ResultadoAviso[] };

// Lê o sinal no Sienge das comissões A_LIBERAR e libera as quitadas.
// preview=true: só diz o que aconteceria (não grava, não avisa).
export async function verificarELiberar(opts: { preview?: boolean; solicitadoPor?: string; ids?: string[] } = {}) {
  const solicitadoPor = opts.solicitadoPor ?? "cron";
  const pendentes = await db.comissao.findMany({ where: { status: "A_LIBERAR", ...(opts.ids ? { id: { in: opts.ids } } : {}) }, include: { corretor: true } });
  const out: Liberacao[] = [];
  let lista: ContratoResumo[] | undefined;
  for (const c of pendentes) {
    const venda = [c.unidade, c.empreendimento].filter(Boolean).join(" – ") || c.contratoNumero || c.id;
    if (!c.siengeContractId) {
      lista ??= await contratosSienge().catch(() => []);
      if (opts.preview || !(await tentarVincular(c, lista))) { out.push({ id: c.id, venda, resultado: "Ainda não está no Sienge (ou unidade ambígua) — vincular manualmente se já estiver." }); continue; }
      const atual = await db.comissao.findUnique({ where: { id: c.id } });
      if (!atual?.siengeContractId) continue;
      c.siengeContractId = atual.siengeContractId;
    }
    let s;
    try { s = situacaoSinal(await sienge.getSalesContract(c.siengeContractId)); }
    catch (e: any) { out.push({ id: c.id, venda, resultado: `Erro ao ler o Sienge: ${String(e?.message ?? e).slice(0, 120)}` }); continue; }
    const sinal = `sinal ${s.pago.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} de ${s.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`;
    if (!opts.preview) await db.comissao.update({ where: { id: c.id }, data: { sinalTotal: s.total, sinalPago: s.pago, verificadoEm: new Date() } });
    if (!s.temSinal) { out.push({ id: c.id, venda, sinal, resultado: "Contrato sem condição de SINAL no Sienge — liberar manualmente." }); continue; }
    if (!s.quitado) { out.push({ id: c.id, venda, sinal, resultado: "Sinal ainda não quitado." }); continue; }
    if (!c.corretor || c.valor == null) { out.push({ id: c.id, venda, sinal, resultado: "Sinal pago, mas falta corretor ou valor da comissão no cadastro." }); continue; }
    if (opts.preview) { out.push({ id: c.id, venda, sinal, resultado: "SERIA LIBERADA agora (corretor e diretoria avisados)." }); continue; }
    // Reivindica a transição (dois runs nunca liberam/avisam a mesma).
    const r = await db.comissao.updateMany({ where: { id: c.id, status: "A_LIBERAR" }, data: { status: "DISPONIVEL", liberadaEm: new Date() } });
    if (!r.count) continue;
    out.push({ id: c.id, venda, sinal, resultado: "LIBERADA", avisos: await avisarLiberacao(c.id, solicitadoPor) });
  }
  return { verificadas: pendentes.length, resultados: out };
}

export async function carregar(id: string) {
  return db.comissao.findUnique({ where: { id }, include: { corretor: true } });
}

export async function avisarLiberacao(id: string, solicitadoPor: string): Promise<ResultadoAviso[]> {
  const c = await carregar(id);
  if (!c?.corretor) return [];
  const k = c.corretor;
  const avisos: ResultadoAviso[] = [];
  avisos.push(k.telefone
    ? await enviarAviso({ tipo: "COMISSAO_LIBERADA", chave: c.id, comissaoId: c.id, destino: k.telefone, texto: textos.liberada(c, k), interno: false, solicitadoPor, contrato: c.contratoNumero, valor: c.valor })
    : { destino: "—", status: "SEM_TELEFONE", motivo: "Corretor sem telefone no cadastro" });
  for (const d of destinatariosDiretoria()) avisos.push(await enviarAviso({ tipo: "COMISSAO_PAGAR", chave: c.id, comissaoId: c.id, destino: d, texto: textos.pagar(c, k), interno: true, solicitadoPor, contrato: c.contratoNumero, valor: c.valor }));
  return avisos;
}

export async function avisarNfRecebida(id: string): Promise<ResultadoAviso[]> {
  const c = await carregar(id);
  if (!c?.corretor || c.status !== "DISPONIVEL") return [];
  const out: ResultadoAviso[] = [];
  for (const d of destinatariosDiretoria()) out.push(await enviarAviso({ tipo: "COMISSAO_NF", chave: `${c.id}:${c.nfEnviadaEm?.getTime() ?? 0}`, comissaoId: c.id, destino: d, texto: textos.nf(c, c.corretor), interno: true, solicitadoPor: "corretor", contrato: c.contratoNumero, valor: c.valor }));
  return out;
}

export async function marcarPaga(id: string, usuario: string, comprovante?: { nome: string; mime: string; dados: Buffer } | null) {
  const r = await db.comissao.updateMany({ where: { id, status: { in: ["DISPONIVEL", "A_LIBERAR"] } }, data: { status: "PAGA", pagaEm: new Date(), pagaPor: usuario } });
  if (!r.count) throw new Error("Só comissões disponíveis (ou a liberar) podem ser marcadas como pagas.");
  if (comprovante) await db.comissaoArquivo.create({ data: { comissaoId: id, tipo: "COMPROVANTE", nome: comprovante.nome, mime: comprovante.mime, tamanho: comprovante.dados.length, dados: new Uint8Array(comprovante.dados), enviadoPor: usuario } });
  const c = await carregar(id);
  if (!c?.corretor?.telefone) return [{ destino: "—", status: "SEM_TELEFONE" }];
  return [await enviarAviso({ tipo: "COMISSAO_PAGA", chave: c.id, comissaoId: c.id, destino: c.corretor.telefone, texto: textos.paga(c, c.corretor), interno: false, solicitadoPor: usuario, contrato: c.contratoNumero, valor: c.valor })];
}

export async function enviarLink(corretorId: string, usuario: string) {
  const k = await db.corretor.findUnique({ where: { id: corretorId } });
  if (!k) throw new Error("Corretor não encontrado.");
  if (!k.telefone) throw new Error("Cadastre o telefone do corretor antes.");
  return enviarAviso({ tipo: "COMISSAO_LINK", chave: `${k.id}:${Date.now()}`, destino: k.telefone, texto: textos.link(k), interno: false, solicitadoPor: usuario });
}

export const telefoneE164 = (t: unknown) => { const d = digitos(t); return d ? toBrazilE164(d) : null; };
