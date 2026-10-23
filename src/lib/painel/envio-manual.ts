import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { sienge } from "../sienge/client";
import { normalizeCustomerPhones, normalizeInstallmentsList, normalizePaymentSlip } from "../sienge/mapper";
import { localDateKey } from "../collection/date";
import { canalAtual, type CanalWhatsApp, type ItemParcela, type MensagemPadrao, type ModeloMensagem } from "../canal";
import { renderTexto } from "../canal/modelos";
import { cacheDe, garantirCache } from "./parcelas";
import { contratosDoCliente } from "./sienge-cache";

// Envio MANUAL pelo painel (o financeiro comanda): boleto, lembrete ou cobrança
// de parcelas escolhidas. Mesmas garantias da régua — revalida no Sienge
// (saldo > 0 e boleto ativo), registra em Comunicacao antes de enviar, no
// máximo 1x por parcela/tipo/dia — mas sem allowlist nem REGUA_DRY_RUN: quem
// confirma é a pessoa, depois de ver a prévia. Respeita as travas-mestras.

export type TipoManual = "BOLETO" | "LEMBRETE_D0" | "COBRANCA";
const MODELO: Record<TipoManual, ModeloMensagem> = { BOLETO: "boleto_mes", LEMBRETE_D0: "lembrete_vencimento", COBRANCA: "cobranca_atraso" };

export type PedidoManual = { tipo: TipoManual; customerId: number; itens: { billId: number; installmentId: number }[] };
type Pronto = { billId: number; installmentId: number; parcela: ItemParcela; saldo: number; vencimento: string; contrato: string };

const fmtBRL = (n: number) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const br = (ymd: string) => ymd.split("-").reverse().join("/");
const primeiroNome = (n: string) => { const p = (n || "cliente").trim().split(/\s+/)[0]; return p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1).toLocaleLowerCase("pt-BR"); };
const empreendimentoDe = (cc: string) => cc.replace(/^\s*\d+\s*-\s*/, "").trim();

export async function prepararEnvioManual(p: PedidoManual) {
  const avisos: string[] = [];
  const bloqueados: { billId: number; installmentId: number; motivo: string }[] = [];
  const billIds = [...new Set(p.itens.map((i) => i.billId))];
  try { if ((await garantirCache(billIds)).consultouSienge) avisos.push("Números das parcelas buscados no Sienge (1 consulta)."); } catch { avisos.push("Não foi possível buscar o nº das parcelas no Sienge; será usado o vencimento."); }
  const cache = await cacheDe(billIds);
  const contratos = await contratosDoCliente(p.customerId).catch(() => []);
  const contratoDoBill = new Map(contratos.map((c) => [c.billId, c]));

  const prontos: Pronto[] = [];
  const parcelasPorBill = new Map<number, ReturnType<typeof normalizeInstallmentsList>>();
  for (const it of p.itens) {
    if (!parcelasPorBill.has(it.billId)) parcelasPorBill.set(it.billId, normalizeInstallmentsList(await sienge.getInstallments(it.billId)));
    const atual = parcelasPorBill.get(it.billId)!.find((x) => x.installmentId === it.installmentId);
    if (!atual) { bloqueados.push({ ...it, motivo: "Parcela não encontrada no Sienge" }); continue; }
    if (!(atual.balanceDue > 0)) { bloqueados.push({ ...it, motivo: "Parcela já paga" }); continue; }
    let boleto = { url: null as string | null, linhaDigitavel: null as string | null };
    if (atual.generatedBoleto) { try { boleto = normalizePaymentSlip(await sienge.getPaymentSlip(it.billId, it.installmentId)); } catch { /* sem boleto */ } }
    if (!atual.generatedBoleto || (!boleto.url && !boleto.linhaDigitavel)) { bloqueados.push({ ...it, motivo: "Sem boleto ativo no Sienge (gerar ou reativar o boleto)" }); continue; }
    const c = cache.get(`${it.billId}/${it.installmentId}`);
    const k = contratoDoBill.get(it.billId);
    const venc = atual.dueDate.toISOString().slice(0, 10);
    const imovel = c ? [empreendimentoDe(c.centroCusto), c.unidade].filter(Boolean).join(" — ") : [k?.empreendimento, k?.unidades.join(", ")].filter(Boolean).join(" — ");
    prontos.push({
      billId: it.billId, installmentId: it.installmentId, saldo: atual.balanceDue, vencimento: venc,
      contrato: c ? c.documento.split("/").pop()!.trim() : (k?.numero ?? String(it.billId)),
      parcela: { parcela: c?.parcela ?? `vencimento ${br(venc)}`, imovel: imovel || (k?.numero ?? ""), vencimento: br(venc), valor: fmtBRL(atual.balanceDue), boletoUrl: boleto.url, linhaDigitavel: boleto.linhaDigitavel },
    });
  }

  let telefone = "", nome = "";
  try {
    const cli = await sienge.getCustomer(p.customerId);
    telefone = normalizeCustomerPhones(cli)[0]?.numero ?? "";
    nome = String(cli?.name ?? "");
  } catch { /* sem cadastro */ }
  if (!telefone) avisos.push("Cliente sem celular válido no Sienge — não é possível enviar.");

  const pausa = await db.pausaRegua.findFirst({ where: { removidaEm: null, OR: [{ customerId: p.customerId }, { billId: { in: billIds } }] } });
  if (pausa) avisos.push(`Cliente em PAUSA da régua (${pausa.motivo}). O envio manual é permitido, mas confira se é isso mesmo.`);

  const msg: MensagemPadrao = { modelo: MODELO[p.tipo], nome: primeiroNome(nome), itens: prontos.map((x) => x.parcela) };
  return { tipo: p.tipo, customerId: p.customerId, nome, telefone, prontos, bloqueados, avisos, mensagem: prontos.length ? renderTexto(msg) : null, msg };
}

export async function enviarManual(p: PedidoManual, usuario: string, canal: CanalWhatsApp = canalAtual()) {
  const e = env();
  const prep = await prepararEnvioManual(p);
  const resultado = { ...prep, enviado: false, status: "", detalhe: "" as string | null, ignorados: [] as { billId: number; installmentId: number; motivo: string }[] };
  if (!prep.prontos.length) return { ...resultado, status: "NADA_A_ENVIAR" };
  if (!prep.telefone) return { ...resultado, status: "SEM_TELEFONE" };

  const hoje = localDateKey(new Date(), e.TIMEZONE);
  const meus: Pronto[] = [];
  for (const x of prep.prontos) {
    const dedupeKey = `manual:${p.tipo}:${x.billId}:${x.installmentId}:${hoje}`;
    const base = {
      tipo: p.tipo, etapa: "MANUAL", billId: x.billId, installmentId: x.installmentId, dueDate: new Date(`${x.vencimento}T12:00:00Z`),
      customerId: p.customerId, clienteNome: prep.nome, contrato: x.contrato, parcela: x.parcela.parcela, valor: x.saldo,
      destino: prep.telefone, status: "ENVIANDO", solicitadoPor: `painel:${usuario}`,
    };
    try { await db.comunicacao.create({ data: { ...base, dedupeKey, tentativas: 1 } }); meus.push(x); }
    catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      const u = await db.comunicacao.updateMany({ where: { dedupeKey, status: { in: ["ERRO", "SEM_WHATSAPP", "BLOQUEADA", "DRY_RUN"] } }, data: { ...base, tentativas: { increment: 1 } } });
      if (u.count === 1) meus.push(x); else resultado.ignorados.push({ billId: x.billId, installmentId: x.installmentId, motivo: "Já enviado hoje por este painel" });
    }
  }
  if (!meus.length) return { ...resultado, status: "JA_ENVIADO_HOJE" };

  const msg: MensagemPadrao = { ...prep.msg, itens: meus.map((x) => x.parcela) };
  const texto = renderTexto(msg);
  const where = { dedupeKey: { in: meus.map((x) => `manual:${p.tipo}:${x.billId}:${x.installmentId}:${hoje}`) } };
  const marcar = (status: string, data: Prisma.ComunicacaoUpdateManyMutationInput = {}) => db.comunicacao.updateMany({ where, data: { status, conteudo: texto, ...data } });

  const bloqueio = !e.OUTBOUND_MESSAGING_ENABLED ? "MASTER_SWITCH_OFF" : e.WHATSAPP_DRY_RUN ? "WHATSAPP_DRY_RUN" : null;
  if (bloqueio) { await marcar("BLOQUEADA", { motivo: bloqueio }); return { ...resultado, mensagem: texto, status: "BLOQUEADA", detalhe: bloqueio }; }
  if (await canal.numeroTemWhatsApp(prep.telefone) === false) {
    await marcar("SEM_WHATSAPP", { motivo: "NUMERO_SEM_WHATSAPP" });
    return { ...resultado, mensagem: texto, status: "SEM_WHATSAPP", detalhe: "O celular do cadastro não tem WhatsApp — conferir no Sienge" };
  }
  const r = await canal.enviar(msg, prep.telefone);
  if (r.sucesso) { await marcar("ENVIADA", { canal: canal.nome, providerMessageId: r.providerMessageId, enviadaEm: new Date(), motivo: null, detalhe: null }); return { ...resultado, mensagem: texto, enviado: true, status: "ENVIADA", detalhe: null }; }
  await marcar(r.incerto ? "INCERTA" : "ERRO", { canal: canal.nome, detalhe: String(r.erro ?? "").slice(0, 400) });
  return { ...resultado, mensagem: texto, status: r.incerto ? "INCERTA" : "ERRO", detalhe: String(r.erro ?? "").slice(0, 200) };
}
