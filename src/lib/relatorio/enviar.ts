import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { evolutionSendDocument } from "../whatsapp/evolution";
import { deveEnviarAutomatico, legendaRelatorio, montarRelatorio, type DadosRelatorio } from "./dados";
import { gerarRelatorioPdf } from "./pdf";

// Relatório do dia: lê o banco, monta o PDF e manda para REPORT_RECIPIENTS
// (Sergio e Bruna) por WhatsApp. Cada envio fica registrado em Comunicacao
// (tipo RELATORIO_DIA). Automático: 1x por dia e destinatário (dedupe), só se
// houve boleto enviado ou falha. Manual (teste): sempre envia, chave própria.

const TZ_OFFSET = "-03:00"; // America/Maceio, sem horário de verão

export async function coletarRelatorio(data: string): Promise<DadosRelatorio> {
  const ini = new Date(`${data}T00:00:00${TZ_OFFSET}`), fim = new Date(ini.getTime() + 86400000);
  const [coms, confs, pausas] = await Promise.all([
    db.comunicacao.findMany({ where: { atualizadaEm: { gte: ini, lt: fim }, tipo: { in: ["BOLETO", "LEMBRETE_D0", "COBRANCA"] } }, orderBy: [{ clienteNome: "asc" }] }),
    db.paymentConfirmation.findMany({ where: { updatedAt: { gte: ini, lt: fim } } }),
    db.pausaRegua.findMany({ where: { removidaEm: null } }),
  ]);
  return montarRelatorio(
    data,
    coms.map((c) => ({ tipo: c.tipo, etapa: c.etapa, status: c.status, motivo: c.motivo, clienteNome: c.clienteNome, contrato: c.contrato, parcela: c.parcela, vencimento: c.dueDate?.toISOString().slice(0, 10) ?? null, valor: c.valor != null ? Number(c.valor) : null })),
    confs.map((c) => ({ contrato: c.contrato, status: c.status, motivo: c.motivo, detail: c.detail, valor: Number(c.valor), pagoEm: c.paidDate.toISOString().slice(0, 10) })),
    pausas.map((p) => ({ cliente: p.clienteNome, contrato: p.contrato, tipos: p.tipos, ate: p.ate?.toISOString().slice(0, 10) ?? null, motivo: p.motivo })),
  );
}

export function destinatariosRelatorio(): string[] {
  return env().REPORT_RECIPIENTS.split(",").map((x) => x.trim()).filter(Boolean);
}

export type ResultadoRelatorio = { data: string; enviado: boolean; motivo?: string; destinatarios: { destino: string; status: string; detalhe?: string }[]; resumo: DadosRelatorio["resumo"] };

export async function enviarRelatorioDia(data: string, modo: "auto" | "manual", solicitadoPor = modo === "auto" ? "cron" : "manual", opts: { apenasPendentes?: boolean } = {}): Promise<ResultadoRelatorio> {
  const e = env();
  const d = await coletarRelatorio(data);
  const base: ResultadoRelatorio = { data, enviado: false, destinatarios: [], resumo: d.resumo };
  const dest = destinatariosRelatorio();
  if (!dest.length) return { ...base, motivo: "REPORT_RECIPIENTS vazio" };
  if (modo === "auto" && !deveEnviarAutomatico(d)) return { ...base, motivo: "Sem boleto enviado nem falha hoje" };

  const pdf = Buffer.from(await gerarRelatorioPdf(d, new Date(), e.TIMEZONE)).toString("base64");
  const legenda = legendaRelatorio(d);
  const mascara = (s: string) => s.replace(/\d(?=\d{3})/g, "•");

  for (const destino of dest) {
    // Reenvio manual só para quem ainda não recebeu o relatório desse dia.
    if (opts.apenasPendentes) {
      const ja = await db.comunicacao.findFirst({ where: { tipo: "RELATORIO_DIA", destino, status: "ENVIADA", dedupeKey: { startsWith: `relatorio:${data}:` } } });
      if (ja) { base.destinatarios.push({ destino: mascara(destino), status: "JA_RECEBEU" }); continue; }
    }
    const dedupeKey = modo === "auto" ? `relatorio:${data}:${destino}` : `relatorio:${data}:${destino}:manual:${Date.now()}`;
    try {
      await db.comunicacao.create({ data: { tipo: "RELATORIO_DIA", dedupeKey, destino, status: "ENVIANDO", tentativas: 1, conteudo: legenda, solicitadoPor } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") { base.destinatarios.push({ destino: mascara(destino), status: "JA_ENVIADO_HOJE" }); continue; }
      throw err;
    }
    const marcar = (status: string, extra: Prisma.ComunicacaoUpdateInput = {}) => db.comunicacao.update({ where: { dedupeKey }, data: { status, ...extra } });
    // Destinatários internos configurados pelo admin (REPORT_RECIPIENTS): não
    // passam pela allowlist de clientes — só pelas travas-mestras.
    const bloqueio = !e.OUTBOUND_MESSAGING_ENABLED ? "MASTER_SWITCH_OFF" : e.WHATSAPP_DRY_RUN ? "DRY_RUN" : null;
    if (bloqueio) { await marcar("BLOQUEADA", { motivo: bloqueio }); base.destinatarios.push({ destino: mascara(destino), status: "BLOQUEADA", detalhe: bloqueio }); continue; }
    const r = await evolutionSendDocument({ to: destino, mediaUrl: pdf, fileName: `relatorio-casa-forte-${data}.pdf`, caption: legenda });
    if (r.success) { await marcar("ENVIADA", { canal: "evolution", providerMessageId: r.messageId, enviadaEm: new Date() }); base.enviado = true; base.destinatarios.push({ destino: mascara(destino), status: "ENVIADA" }); }
    else {
      const incerto = String(r.error ?? "").startsWith("Conexão Evolution");
      await marcar(incerto ? "INCERTA" : "ERRO", { canal: "evolution", detalhe: String(r.error ?? "").slice(0, 400) });
      base.destinatarios.push({ destino: mascara(destino), status: incerto ? "INCERTA" : "ERRO", detalhe: String(r.error ?? "").slice(0, 200) });
    }
  }
  return base;
}
