import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { sienge } from "../sienge/client";
import { normalizeCustomerPhones, normalizeIncomeInstallments, normalizeInstallmentsList, normalizePaymentSlip, type NormalizedInstallmentRow } from "../sienge/mapper";
import { localDateKey } from "../collection/date";
import { canSendTo } from "../safety";
import { canalAtual, type CanalWhatsApp, type ItemParcela, type MensagemPadrao, type ModeloMensagem } from "../canal";
import { renderTexto } from "../canal/modelos";
import { agruparPorClienteTipo, janelaRegua, planejarRegua, type ItemPlano, type TipoRegua } from "./planejar";
import { aplicarPausas } from "./pausas";

// Executor da régua v2: 1 chamada bulk (income por vencimento) → plano →
// revalidação no Sienge (saldo > 0) → boleto/telefone → reivindica no outbox
// (Comunicacao, dedupeKey UNIQUE) → travas → canal. Ver
// docs/ARQUITETURA-COMUNICACAO.md §4.3. Com REGUA_DRY_RUN=true registra o
// texto que SAIRIA (status DRY_RUN) e não envia.

// Podem ser retomadas numa execução seguinte. ERRO só até MAX_TENTATIVAS.
// ENVIANDO/INCERTA/ENVIADA/ENTREGUE/LIDA/CANCELADA/IGNORADA bloqueiam para sempre.
const RETENTAVEIS = ["PLANEJADA", "DRY_RUN", "BLOQUEADA", "SEM_TELEFONE", "SEM_WHATSAPP", "ERRO"];
const MAX_TENTATIVAS = 5;
const podeRetomar = (x: { status: string; tentativas: number }) =>
  RETENTAVEIS.includes(x.status) && !(x.status === "ERRO" && x.tentativas >= MAX_TENTATIVAS);

const MODELO: Record<TipoRegua, ModeloMensagem> = { BOLETO: "boleto_mes", LEMBRETE_D0: "lembrete_vencimento", COBRANCA: "cobranca_atraso" };

const fmtBRL = (n: number) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brData = (ymd: string) => ymd.split("-").reverse().join("/");
const primeiroNome = (nome: string) => {
  const p = (nome || "cliente").trim().split(/\s+/)[0];
  return p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1).toLocaleLowerCase("pt-BR");
};
const mascarar = (s: string) => s.replace(/\d(?=\d{3})/g, "•");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ResumoRegua = {
  janela: { inicio: string; fim: string } | null;
  parcelasLidas: number;
  planejadas: Record<TipoRegua, number>;
  jaTratadas: number;
  mensagens: number;
  porStatus: Record<string, number>;
  pulados: { billId: number; installmentId: number; tipo: TipoRegua; motivo: string }[];
  previews?: any[];
  modoTeste: boolean;
  skipped?: string;
};

type Opcoes = { now?: Date; preview?: boolean; tipos?: TipoRegua[]; canal?: CanalWhatsApp };

export async function runRegua(opts: Opcoes = {}): Promise<ResumoRegua> {
  const e = env();
  const now = opts.now ?? new Date();
  const preview = !!opts.preview;
  const ligados: TipoRegua[] = (opts.tipos ?? (["BOLETO", "LEMBRETE_D0", "COBRANCA"] as TipoRegua[]))
    .filter((t) => preview || (t === "BOLETO" ? e.BOLETO_ENABLED : t === "LEMBRETE_D0" ? e.LEMBRETE_ENABLED : e.COBRANCA_ENABLED));
  const s: ResumoRegua = {
    janela: null, parcelasLidas: 0, planejadas: { BOLETO: 0, LEMBRETE_D0: 0, COBRANCA: 0 }, jaTratadas: 0,
    mensagens: 0, porStatus: {}, pulados: [], modoTeste: e.REGUA_DRY_RUN,
  };
  if (!ligados.length) return { ...s, skipped: "NENHUM_TIPO_LIGADO (BOLETO_ENABLED/LEMBRETE_ENABLED/COBRANCA_ENABLED)" };

  // 1) Sienge: 1 chamada bulk com as parcelas que vencem na janela.
  const cfg = { diasAntes: e.BOLETO_DIAS_ANTES, etapasCobranca: e.COBRANCA_ETAPAS, tolerancia: e.COBRANCA_TOLERANCIA_DIAS };
  const hoje = localDateKey(now, e.TIMEZONE);
  s.janela = janelaRegua(hoje, cfg);
  const parcelas = normalizeIncomeInstallments(await sienge.listIncomeByDueDate(s.janela.inicio, s.janela.fim));
  s.parcelasLidas = parcelas.length;

  // 2) Plano do dia (só tipos ligados), menos quem está em pausa (PausaRegua).
  const bruto = planejarRegua(parcelas, hoje, cfg).filter((i) => ligados.includes(i.tipo));
  for (const i of bruto) s.planejadas[i.tipo]++;
  const pausasAtivas = (await db.pausaRegua.findMany({ where: { removidaEm: null } })).map((p) => ({
    id: p.id, customerId: p.customerId, billId: p.billId, tipos: p.tipos, motivo: p.motivo,
    ate: p.ate ? p.ate.toISOString().slice(0, 10) : null,
  }));
  const { liberados: plano, pausados } = aplicarPausas(bruto, pausasAtivas, hoje);
  for (const { item, pausa } of pausados) s.pulados.push({ billId: item.billId, installmentId: item.installmentId, tipo: item.tipo, motivo: `PAUSA: ${pausa.motivo}` });

  // 3) Tira o que já foi tratado (enviado, incerto, cancelado...).
  const existentes = plano.length
    ? await db.comunicacao.findMany({ where: { dedupeKey: { in: plano.map((i) => i.dedupeKey) } }, select: { dedupeKey: true, status: true, tentativas: true } })
    : [];
  const bloqueadas = new Set(existentes.filter((x) => !podeRetomar(x)).map((x) => x.dedupeKey));
  const pendentes = plano.filter((i) => !bloqueadas.has(i.dedupeKey));
  s.jaTratadas = plano.length - pendentes.length;

  const canal = opts.canal ?? (preview ? null : canalAtual());
  const parcelasCache = new Map<number, NormalizedInstallmentRow[]>();
  const foneCache = new Map<number, string>();
  const previews: any[] = [];
  const conta = (st: string) => { s.porStatus[st] = (s.porStatus[st] ?? 0) + 1; };

  for (const grupo of agruparPorClienteTipo(pendentes)) {
    const { tipo, clientId, clientName } = grupo[0];

    // 4) Revalida cada parcela no Sienge (saldo > 0) e busca o boleto.
    const prontos: { item: ItemPlano; parcela: ItemParcela; saldo: number }[] = [];
    const aguardandoBoleto: ItemPlano[] = [];
    for (const it of grupo) {
      const pular = (motivo: string) => s.pulados.push({ billId: it.billId, installmentId: it.installmentId, tipo, motivo });
      try {
        if (!parcelasCache.has(it.billId)) parcelasCache.set(it.billId, normalizeInstallmentsList(await sienge.getInstallments(it.billId)));
      } catch { pular("ERRO_SIENGE"); continue; }
      const atual = parcelasCache.get(it.billId)!.find((x) => x.installmentId === it.installmentId);
      if (!atual) { pular("PARCELA_NAO_ENCONTRADA"); continue; }
      if (!(atual.balanceDue > 0)) { pular("JA_PAGA"); continue; }
      // Regra (23/10/2026): só sai mensagem de parcela com boleto GERADO e em
      // aberto no Sienge — vale para boleto, lembrete e cobrança. Boleto
      // cancelado (ex.: cliente em negociação deve procurar a Casa Forte) ou
      // ainda não gerado (INCC-DI) = não envia; fica PLANEJADA com o motivo.
      let boleto = { url: null as string | null, linhaDigitavel: null as string | null };
      if (atual.generatedBoleto) {
        try { boleto = normalizePaymentSlip(await sienge.getPaymentSlip(it.billId, it.installmentId)); } catch { /* sem boleto */ }
      }
      if (!atual.generatedBoleto || (!boleto.url && !boleto.linhaDigitavel)) { aguardandoBoleto.push(it); continue; }
      prontos.push({
        item: it, saldo: atual.balanceDue,
        parcela: { parcela: it.parcela, imovel: it.imovel, vencimento: brData(it.vencimento), valor: fmtBRL(atual.balanceDue), boletoUrl: boleto.url, linhaDigitavel: boleto.linhaDigitavel },
      });
    }

    // Sem boleto gerado/ativo: fica PLANEJADA e é reavaliada na próxima execução.
    for (const it of aguardandoBoleto) {
      const motivo = tipo === "BOLETO" ? "BOLETO_AINDA_NAO_GERADO" : "SEM_BOLETO_ATIVO";
      s.pulados.push({ billId: it.billId, installmentId: it.installmentId, tipo, motivo });
      if (!preview) await registrar(it, { status: "PLANEJADA", motivo }, false);
    }
    if (!prontos.length) continue;

    // 5) Telefone do cadastro do cliente.
    if (!foneCache.has(clientId)) {
      let n = "";
      try { n = normalizeCustomerPhones(await sienge.getCustomer(clientId))[0]?.numero ?? ""; } catch { /* sem telefone */ }
      foneCache.set(clientId, n);
    }
    const numero = foneCache.get(clientId)!;
    const msg: MensagemPadrao = {
      modelo: MODELO[tipo], nome: primeiroNome(clientName), itens: prontos.map((p) => p.parcela),
      diasAtraso: tipo === "COBRANCA" ? -Math.min(...prontos.map((p) => p.item.diasAteVencimento)) : undefined,
    };
    const texto = renderTexto(msg);
    s.mensagens++;

    if (preview) {
      previews.push({ tipo, clienteId: clientId, nome: msg.nome, telefone: numero ? mascarar(numero) : null,
        parcelas: prontos.map((p) => ({ contrato: p.item.contrato, parcela: p.item.parcela, etapa: p.item.etapa, vencimento: p.item.vencimento, saldo: p.saldo })),
        mensagem: texto });
      continue;
    }

    // 6) Reivindica (dedupe atômico) — só as reivindicadas entram na mensagem.
    const meus: typeof prontos = [];
    for (const p of prontos) if (await registrar(p.item, { status: "ENVIANDO", destino: numero, conteudo: texto, valor: p.saldo }, true)) meus.push(p);
    if (!meus.length) continue;
    const msgFinal: MensagemPadrao = { ...msg, itens: meus.map((p) => p.parcela) };
    const textoFinal = renderTexto(msgFinal);
    const where = { dedupeKey: { in: meus.map((p) => p.item.dedupeKey) } };
    const marcar = async (status: string, data: Prisma.ComunicacaoUpdateManyMutationInput = {}) => {
      await db.comunicacao.updateMany({ where, data: { status, destino: numero, conteudo: textoFinal, ...data } });
      conta(status);
    };

    // 7) Travas.
    if (!numero) { await marcar("SEM_TELEFONE", { motivo: "SEM_TELEFONE_NO_SIENGE" }); continue; }
    if (e.REGUA_DRY_RUN) { await marcar("DRY_RUN", { motivo: "REGUA_DRY_RUN" }); continue; }
    const gate = canSendTo(numero, {
      appMode: e.APP_MODE, outboundEnabled: e.OUTBOUND_MESSAGING_ENABLED, dryRun: e.WHATSAPP_DRY_RUN,
      allowAllProduction: e.WHATSAPP_ALLOW_ALL_PRODUCTION, allowlist: e.WHATSAPP_ALLOWLIST.split(",").map((x) => x.trim()).filter(Boolean),
    });
    if (!gate.allowed) {
      await marcar(gate.reason === "DRY_RUN" || gate.reason === "MASTER_SWITCH_OFF" ? "DRY_RUN" : "BLOQUEADA", { motivo: gate.reason });
      continue;
    }
    if (await canal!.numeroTemWhatsApp(numero) === false) {
      await marcar("SEM_WHATSAPP", { motivo: "NUMERO_SEM_WHATSAPP", detalhe: `Número ${mascarar(numero)} não tem WhatsApp — conferir cadastro no Sienge` });
      continue;
    }

    // 8) Envio.
    const r = await canal!.enviar(msgFinal, numero);
    if (r.sucesso) await marcar("ENVIADA", { canal: canal!.nome, providerMessageId: r.providerMessageId, enviadaEm: new Date(), motivo: null, detalhe: null });
    else await marcar(r.incerto ? "INCERTA" : "ERRO", { canal: canal!.nome, detalhe: String(r.erro ?? "").slice(0, 400) });
    await sleep(1200); // throttle entre envios reais
  }

  if (preview) s.previews = previews;
  return s;
}

// Cria a linha da comunicação ou, se já existir, retoma quando o status
// permitir. Com `reivindicar`, a operação é atômica e devolve se ESTA execução
// ficou com a parcela (dois runs simultâneos nunca pegam a mesma).
async function registrar(it: ItemPlano, data: { status: string; motivo?: string; destino?: string; conteudo?: string; valor?: number }, reivindicar: boolean): Promise<boolean> {
  const base = {
    tipo: it.tipo, etapa: it.etapa, billId: it.billId, installmentId: it.installmentId,
    dueDate: new Date(`${it.vencimento}T12:00:00Z`), customerId: it.clientId, clienteNome: it.clientName,
    contrato: it.contrato, parcela: it.parcela, valor: data.valor ?? it.saldo,
    status: data.status, motivo: data.motivo ?? null, destino: data.destino ?? "", conteudo: data.conteudo ?? null,
  };
  try {
    await db.comunicacao.create({ data: { ...base, dedupeKey: it.dedupeKey, tentativas: reivindicar ? 1 : 0 } });
    return true;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    const u = await db.comunicacao.updateMany({
      where: { dedupeKey: it.dedupeKey, OR: [{ status: { in: RETENTAVEIS.filter((x) => x !== "ERRO") } }, { status: "ERRO", tentativas: { lt: MAX_TENTATIVAS } }] },
      data: { ...base, ...(reivindicar ? { tentativas: { increment: 1 } } : {}) },
    });
    return u.count === 1;
  }
}
