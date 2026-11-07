import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { sienge } from "../sienge/client";
import { normalizeCustomerPhones, normalizeInstallmentsList } from "../sienge/mapper";
import { previewConfirmacao } from "../collection/messages";
import { canSendTo } from "../safety";
import { evolutionNumberExists } from "../whatsapp/evolution";
import { enviarConfirmacao } from "../payments/envio";
import { empresaDe, gerarComprovantePdf, nomeArquivoComprovante, type ParcelaRecibo } from "../payments/comprovante";
import { contratos } from "./sienge-cache";

// Recibo (comprovante de pagamento em PDF, modelo Sienge) e confirmação de
// pagamento SOB DEMANDA (painel/Brain). Dados do recibo vêm da nossa base
// (ParcelaCache + PagamentoHistorico, sincronizados com o Sienge todo dia) —
// não gasta consulta bulk. A quitação é revalidada no Sienge (REST) antes de
// enviar ao cliente.

export type ItemRef = { billId: number; installmentId: number };
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const br = (ymd: string) => ymd.split("-").reverse().join("/");

// Monta os dados do recibo das parcelas pedidas (só pagamentos reais).
export async function dadosRecibo(itens: ItemRef[]) {
  const parcelas: (ParcelaRecibo & { billId: number; installmentId: number; contrato: string })[] = [];
  const faltando: { billId: number; installmentId: number; motivo: string }[] = [];
  let empresa = empresaDe(null, ""), clienteNome = "", clientId: number | null = null;
  for (const it of itens) {
    const [c, baixas] = await Promise.all([
      db.parcelaCache.findUnique({ where: { billId_installmentId: it } }),
      db.pagamentoHistorico.findMany({ where: { ...it, real: true }, orderBy: [{ pagoEm: "desc" }, { seq: "desc" }] }),
    ]);
    if (!c) { faltando.push({ ...it, motivo: "Parcela ainda não sincronizada com o Sienge" }); continue; }
    const b = baixas[0];
    if (!b) { faltando.push({ ...it, motivo: "Nenhum pagamento registrado para esta parcela" }); continue; }
    empresa = empresaDe(c.companyId, c.companyName); clienteNome ||= c.clientName; clientId ??= c.clientId;
    parcelas.push({
      billId: it.billId, installmentId: it.installmentId, contrato: c.documento.split("/").pop()!.trim(),
      titulo: it.billId, parcela: c.parcela, tipoParc: c.tipoParc, unidade: c.unidade, documento: c.documento, centroCusto: c.centroCusto,
      vencimento: br(c.vencimento), valor: Number(b.bruto), seguro: Number(b.seguro), desconto: Number(b.desconto),
      acrescimos: Number(b.juros) + Number(b.multa), liquido: Number(b.liquido), pagoEm: b.pagoEm,
    });
  }
  return { empresa, clienteNome, clientId, parcelas, faltando };
}

export async function reciboPdf(itens: ItemRef[]) {
  const d = await dadosRecibo(itens);
  if (!d.parcelas.length) return { pdf: null, nomeArquivo: null, ...d };
  const pdf = await gerarComprovantePdf({ empresa: d.empresa, clienteNome: d.clienteNome, parcelas: d.parcelas }, { emitidoEm: new Date(), timeZone: env().TIMEZONE, legalLine: env().COMPANY_LEGAL_LINE });
  const ultimo = br(d.parcelas.map((p) => p.pagoEm).sort().at(-1)!);
  return { pdf, nomeArquivo: nomeArquivoComprovante(d.parcelas[0].contrato, ultimo), ...d };
}

// Prévia / envio da confirmação de pagamento ao cliente (texto + recibo em PDF).
// Uma confirmação por parcela (PaymentConfirmation): já enviada → só com reenviar.
export async function confirmacaoManual(p: { customerId: number; itens: ItemRef[]; acao: "previa" | "enviar"; reenviar?: boolean; usuario: string }) {
  const e = env();
  const avisos: string[] = [];
  const bloqueados: { billId: number; installmentId: number; motivo: string }[] = [];
  const ok: ItemRef[] = [];
  for (const it of p.itens) {
    let ps; try { ps = normalizeInstallmentsList(await sienge.getInstallments(it.billId)); } catch { bloqueados.push({ ...it, motivo: "Não foi possível consultar o Sienge" }); continue; }
    const atual = ps.find((x) => x.installmentId === it.installmentId);
    if (!atual) { bloqueados.push({ ...it, motivo: "Parcela não encontrada no Sienge" }); continue; }
    if (atual.balanceDue > 0) { bloqueados.push({ ...it, motivo: "Parcela ainda em aberto no Sienge (sem quitação)" }); continue; }
    const ja = await db.paymentConfirmation.findUnique({ where: { billId_installmentId: it } });
    if (ja?.status === "SENT" && !p.reenviar) { bloqueados.push({ ...it, motivo: `Confirmação já enviada em ${ja.sentAt ? br(ja.sentAt.toISOString().slice(0, 10)) : "data anterior"} (peça "reenviar" se quiser mandar de novo)` }); continue; }
    if (ja?.status === "SENT") avisos.push(`Parcela ${it.billId}/${it.installmentId}: o cliente já recebeu esta confirmação — será REENVIADA.`);
    ok.push(it);
  }
  const d = await dadosRecibo(ok);
  for (const f of d.faltando) bloqueados.push(f);
  const prontas = d.parcelas;
  if (d.clientId && d.clientId !== p.customerId) return { erro: "As parcelas não são deste cliente." };

  let telefone = "", nome = d.clienteNome;
  try { const cli = await sienge.getCustomer(p.customerId); telefone = normalizeCustomerPhones(cli)[0]?.numero ?? ""; nome = cli?.name ?? nome; } catch { /* sem cadastro */ }
  if (!telefone) avisos.push("Cliente sem celular válido no Sienge — não é possível enviar.");
  const primeiro = (nome || "cliente").trim().split(/\s+/)[0];
  const nomeMsg = primeiro.charAt(0).toLocaleUpperCase("pt-BR") + primeiro.slice(1).toLocaleLowerCase("pt-BR");
  const k = new Map((await contratos()).map((c) => [c.billId, c]));
  const imovelDe = (billId: number) => { const c = k.get(billId); return [c?.empreendimento, c?.unidades.join(", ")].filter(Boolean).join(" — ") || c?.numero || ""; };
  const texto = prontas.length ? previewConfirmacao(nomeMsg, prontas.map((x) => ({ imovel: imovelDe(x.billId), vencimento: x.vencimento, valor: brl(x.liquido), pagoEm: br(x.pagoEm) }))) : null;
  const base = { nome, telefone, prontas: prontas.map((x) => ({ billId: x.billId, installmentId: x.installmentId, contrato: x.contrato, parcela: x.parcela, valor: x.liquido, pagoEm: x.pagoEm })), bloqueados, avisos, mensagem: texto };
  if (p.acao === "previa" || !prontas.length || !telefone || !texto) return { ...base, enviado: false, status: p.acao === "previa" ? "PREVIA" : "NADA_A_ENVIAR" };

  // Travas-mestras (as mesmas da confirmação automática).
  const gate = canSendTo(telefone, {
    appMode: e.APP_MODE, outboundEnabled: e.OUTBOUND_MESSAGING_ENABLED, dryRun: e.WHATSAPP_DRY_RUN,
    allowAllProduction: e.WHATSAPP_ALLOW_ALL_PRODUCTION, allowlist: e.WHATSAPP_ALLOWLIST.split(",").map((x) => x.trim()).filter(Boolean),
  });
  if (!gate.allowed) return { ...base, enviado: false, status: "BLOQUEADA", detalhe: gate.reason };
  if (await evolutionNumberExists(telefone) === false) return { ...base, enviado: false, status: "SEM_WHATSAPP", detalhe: "O celular do cadastro não tem WhatsApp" };

  // Registra ANTES de enviar (SENDING) — evita duplicar se dois pedidos chegarem juntos.
  for (const x of prontas) {
    const data = { clientId: p.customerId, contrato: x.contrato, paidDate: new Date(`${x.pagoEm}T12:00:00Z`), valor: new Prisma.Decimal(x.liquido), movementIds: "", phone: telefone, status: "SENDING", motivo: `MANUAL ${p.usuario}` };
    await db.paymentConfirmation.upsert({ where: { billId_installmentId: { billId: x.billId, installmentId: x.installmentId } }, create: { billId: x.billId, installmentId: x.installmentId, ...data, attempts: 1 }, update: { ...data, attempts: { increment: 1 } } });
  }
  const recibo = await reciboPdf(prontas);
  const envio = await enviarConfirmacao({ to: telefone, texto, pdfEnabled: true, fileName: recibo.nomeArquivo ?? "Comprovante Casa Forte.pdf", gerarPdf: async () => { if (!recibo.pdf) throw new Error("sem recibo"); return recibo.pdf; } });
  const where = { OR: prontas.map((x) => ({ billId: x.billId, installmentId: x.installmentId })) };
  const r = envio.result;
  if (r.success) await db.paymentConfirmation.updateMany({ where, data: { status: "SENT", messageId: r.messageId, sentAt: new Date(), detail: envio.pdfErro ? `PDF_FALHOU: ${envio.pdfErro}` : null } });
  else await db.paymentConfirmation.updateMany({ where, data: { status: String(r.error ?? "").startsWith("Conexão Evolution") ? "UNCERTAIN" : "ERROR", detail: String(r.error ?? "").slice(0, 400) } });
  return { ...base, enviado: r.success, status: r.success ? "ENVIADA" : "ERRO", detalhe: r.success ? null : String(r.error ?? "").slice(0, 200) };
}
