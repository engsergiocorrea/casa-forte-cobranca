import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { sienge } from "../sienge/client";
import { normalizeBankMovements, normalizeCustomerPhones, normalizeInstallmentsList, type NormalizedInstallmentRow } from "../sienge/mapper";
import { addDaysKey, localDateKey, localHour } from "../collection/date";
import { previewConfirmacao, type ItemConfirmacao } from "../collection/messages";
import { canSendTo } from "../safety";
import { enviarConfirmacao } from "./envio";
import { gerarComprovantePdf, nomeArquivoComprovante } from "./comprovante";
import { agruparPorCliente, selecionarRecebimentos, type Descartado, type Recebimento } from "./selecao";

// Régua de CONFIRMAÇÃO DE PAGAMENTO — roda à tarde (o financeiro dá a baixa do
// retorno bancário no Sienge até ~12h). Fluxo:
//   bank-movement (1 chamada bulk-data/execução; limite 20/dia)
//   → selecionarRecebimentos (só dinheiro que entrou: Recebimento CR)
//   → revalida parcela no Sienge (saldo = 0) e o cliente do título
//   → reivindica a parcela em PaymentConfirmation (UNIQUE bill+parcela)
//   → canSendTo (master switch + dry-run + allowlist, como a régua automática)
//   → Evolution (uma mensagem por cliente).
// Garantias: nunca confirma movimento anterior a PAYMENT_CONFIRMATION_START_DATE;
// cada parcela é confirmada no máximo uma vez; timeout no envio vira UNCERTAIN
// (não reenvia sozinho — pode ter chegado).

const RETENTAVEIS = ["DRY_RUN", "BLOCKED", "NO_PHONE", "ERROR"];
const MAX_TENTATIVAS = 5;

const fmtBRL = (n: number) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brDate = (ymd: string) => ymd.split("-").reverse().join("/");
const fmtData = (d: Date) => (isNaN(+d) ? "" : d.toLocaleDateString("pt-BR", { timeZone: "UTC" }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ConfirmacaoSummary = {
  janela: { inicio: string; fim: string } | null;
  movimentos: number; recebimentos: number; jaConfirmados: number;
  clientes: number; enviados: number; dryRun: number; bloqueados: number; semTelefone: number; erros: number; incertos: number;
  pulados: { billId: number | null; installmentId: number | null; motivo: string }[];
  previews?: any[];
  skipped?: string;
};

type Item = Recebimento & { imovel: string; vencimento: string };

async function claim(r: Recebimento): Promise<boolean> {
  const base = { clientId: r.clientId, contrato: r.contrato, paidDate: new Date(`${r.paidDate}T12:00:00Z`), valor: r.valor, movementIds: r.movementIds.join(",") };
  try {
    await db.paymentConfirmation.create({ data: { billId: r.billId, installmentId: r.installmentId, ...base, status: "SENDING", attempts: 1 } });
    return true;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    // Já existe: só reassume se o status anterior for retentável (atômico — dois
    // runs simultâneos não conseguem reivindicar a mesma parcela).
    const u = await db.paymentConfirmation.updateMany({
      where: { billId: r.billId, installmentId: r.installmentId, status: { in: RETENTAVEIS }, attempts: { lt: MAX_TENTATIVAS } },
      data: { ...base, status: "SENDING", attempts: { increment: 1 } },
    });
    return u.count === 1;
  }
}

export async function runConfirmacoesPagamento(opts: { now?: Date; preview?: boolean; force?: boolean } = {}): Promise<ConfirmacaoSummary> {
  const now = opts.now ?? new Date();
  const preview = !!opts.preview;
  const e = env();
  const s: ConfirmacaoSummary = { janela: null, movimentos: 0, recebimentos: 0, jaConfirmados: 0, clientes: 0, enviados: 0, dryRun: 0, bloqueados: 0, semTelefone: 0, erros: 0, incertos: 0, pulados: [] };

  if (!preview && !e.PAYMENT_CONFIRMATION_ENABLED) return { ...s, skipped: "PAYMENT_CONFIRMATION_ENABLED=false" };
  if (!preview && !opts.force && localHour(now, e.TIMEZONE) < e.PAYMENT_CONFIRMATION_MIN_HOUR) return { ...s, skipped: "ANTES_DO_HORARIO" };

  const hoje = localDateKey(now, e.TIMEZONE);
  const lookback = addDaysKey(hoje, -e.PAYMENT_CONFIRMATION_LOOKBACK_DAYS);
  const inicio = lookback > e.PAYMENT_CONFIRMATION_START_DATE ? lookback : e.PAYMENT_CONFIRMATION_START_DATE;
  if (inicio > hoje) return { ...s, skipped: "ANTES_DA_DATA_DE_CORTE" };
  s.janela = { inicio, fim: hoje };

  const movs = normalizeBankMovements(await sienge.listBankMovements(inicio, hoje));
  s.movimentos = movs.length;
  const { recebimentos, descartados } = selecionarRecebimentos(movs, e.PAYMENT_CONFIRMATION_START_DATE);
  s.recebimentos = recebimentos.length;
  s.pulados.push(...descartados);

  const existentes = recebimentos.length
    ? await db.paymentConfirmation.findMany({ where: { OR: recebimentos.map((r) => ({ billId: r.billId, installmentId: r.installmentId })) }, select: { billId: true, installmentId: true, status: true, attempts: true } })
    : [];
  const bloqueia = new Set(existentes.filter((x) => !RETENTAVEIS.includes(x.status) || x.attempts >= MAX_TENTATIVAS).map((x) => `${x.billId}/${x.installmentId}`));
  const pendentes = recebimentos.filter((r) => !bloqueia.has(`${r.billId}/${r.installmentId}`));
  s.jaConfirmados = recebimentos.length - pendentes.length;

  const parcelasCache = new Map<number, NormalizedInstallmentRow[]>();
  const tituloCache = new Map<number, any>();
  const previews: any[] = [];

  for (const [clientId, grupo] of agruparPorCliente(pendentes)) {
    // 1) Revalida cada parcela no Sienge: precisa estar QUITADA (saldo 0) e o
    //    título precisa ser do mesmo cliente do movimento.
    const validos: Item[] = [];
    for (const r of grupo) {
      const pular = (motivo: string) => s.pulados.push({ billId: r.billId, installmentId: r.installmentId, motivo } satisfies Descartado);
      try {
        if (!parcelasCache.has(r.billId)) parcelasCache.set(r.billId, normalizeInstallmentsList(await sienge.getInstallments(r.billId)));
        if (!tituloCache.has(r.billId)) tituloCache.set(r.billId, await sienge.getReceivableBill(r.billId));
      } catch { pular("ERRO_SIENGE"); continue; }
      const p = parcelasCache.get(r.billId)!.find((x) => x.installmentId === r.installmentId);
      if (!p) { pular("PARCELA_NAO_ENCONTRADA"); continue; }
      if (p.balanceDue > 0) { pular("SALDO_EM_ABERTO"); continue; } // parcial ou estornado depois
      const t = tituloCache.get(r.billId);
      const tCliente = Number(t?.customerId);
      if (tCliente && tCliente !== clientId) { pular("CLIENTE_DIVERGENTE"); continue; }
      const imovel = [t?.enterpriseName, t?.unityName].map((v) => String(v ?? "").trim()).filter(Boolean).join(" — ") || r.contrato;
      validos.push({ ...r, imovel, vencimento: fmtData(p.dueDate) });
    }
    if (!validos.length) continue;

    // 2) Telefone do cadastro do cliente no Sienge.
    let numero = "";
    try { numero = normalizeCustomerPhones(await sienge.getCustomer(clientId))[0]?.numero ?? ""; } catch { /* sem telefone */ }
    const primeiro = (validos[0].clientName || "cliente").trim().split(/\s+/)[0];
    const nome = primeiro.charAt(0).toLocaleUpperCase("pt-BR") + primeiro.slice(1).toLocaleLowerCase("pt-BR"); // Sienge grava em CAIXA ALTA
    const montar = (its: Item[]) => previewConfirmacao(nome, its.map((i): ItemConfirmacao => ({ imovel: i.imovel, vencimento: i.vencimento, valor: fmtBRL(i.valor), pagoEm: brDate(i.paidDate) })));

    if (preview) {
      previews.push({ clientId, nome, telefone: numero || null, parcelas: validos.map((i) => ({ billId: i.billId, installmentId: i.installmentId, contrato: i.contrato, pagoEm: i.paidDate, valor: i.valor })), mensagem: montar(validos) });
      continue;
    }

    // 3) Reivindica as parcelas (dedupe atômico) — só as reivindicadas entram na mensagem.
    const meus: Item[] = [];
    for (const i of validos) if (await claim(i)) meus.push(i);
    if (!meus.length) continue;
    s.clientes++;
    const where = { OR: meus.map((i) => ({ billId: i.billId, installmentId: i.installmentId })) };
    const marcar = (data: Prisma.PaymentConfirmationUpdateManyMutationInput) => db.paymentConfirmation.updateMany({ where, data: { phone: numero, ...data } });

    if (!numero) { await marcar({ status: "NO_PHONE" }); s.semTelefone++; continue; }
    const gate = canSendTo(numero, {
      appMode: e.APP_MODE, outboundEnabled: e.OUTBOUND_MESSAGING_ENABLED, dryRun: e.WHATSAPP_DRY_RUN,
      allowAllProduction: e.WHATSAPP_ALLOW_ALL_PRODUCTION, allowlist: e.WHATSAPP_ALLOWLIST.split(",").map((x) => x.trim()).filter(Boolean),
    });
    if (!gate.allowed) {
      const dry = gate.reason === "DRY_RUN" || gate.reason === "MASTER_SWITCH_OFF";
      await marcar({ status: dry ? "DRY_RUN" : "BLOCKED", motivo: gate.reason, detail: montar(meus) });
      if (dry) s.dryRun++; else s.bloqueados++;
      continue;
    }

    // Texto sozinho ou, com PAYMENT_CONFIRMATION_PDF_ENABLED, o comprovante em PDF
    // com o texto como legenda (um PDF por mensagem, todas as parcelas do cliente).
    const ultimoPago = brDate(meus.map((i) => i.paidDate).sort().at(-1)!);
    const envio = await enviarConfirmacao({
      to: numero, texto: montar(meus), pdfEnabled: e.PAYMENT_CONFIRMATION_PDF_ENABLED,
      fileName: nomeArquivoComprovante(meus[0].contrato, ultimoPago),
      gerarPdf: () => gerarComprovantePdf(
        { clienteNome: meus[0].clientName, parcelas: meus.map((i) => ({ imovel: i.imovel, contrato: i.contrato, parcela: i.installmentId, vencimento: i.vencimento, pagoEm: brDate(i.paidDate), valor: i.valor })) },
        { emitidoEm: new Date(), timeZone: e.TIMEZONE, legalLine: e.COMPANY_LEGAL_LINE },
      ),
    });
    const r = envio.result;
    const notaPdf = envio.pdfErro ? `PDF_FALHOU (enviado só texto): ${envio.pdfErro}` : null;
    if (r.success) { await marcar({ status: "SENT", messageId: r.messageId, sentAt: new Date(), motivo: null, detail: notaPdf }); s.enviados++; }
    else {
      // Falha de conexão/timeout: a mensagem PODE ter saído → UNCERTAIN (não reenvia sozinho).
      const incerto = String(r.error ?? "").startsWith("Conexão Evolution");
      await marcar({ status: incerto ? "UNCERTAIN" : "ERROR", detail: [notaPdf, String(r.error ?? "")].filter(Boolean).join(" | ").slice(0, 200) });
      if (incerto) s.incertos++; else s.erros++;
    }
    await sleep(1200); // throttle entre envios reais
  }

  if (preview) s.previews = previews;
  return s;
}
