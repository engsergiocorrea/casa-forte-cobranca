import { Prisma } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { canSendTo, toBrazilE164 } from "../safety";
import { evolutionSendText } from "../whatsapp/evolution";

// Avisos de comissão por WhatsApp. Passam pelo outbox Comunicacao (uma linha
// por aviso, dedupeKey UNIQUE, reivindicada ANTES do envio) e pelas travas:
//   COMISSAO_DRY_RUN (padrão true) → só registra o texto (status DRY_RUN);
//   OUTBOUND_MESSAGING_ENABLED / WHATSAPP_DRY_RUN → travas-mestras;
//   corretor (externo) → também allowlist/produção (canSendTo);
//   diretoria (REPORT_RECIPIENTS) → só as travas-mestras, como o relatório.

export type TipoAviso = "COMISSAO_LIBERADA" | "COMISSAO_PAGAR" | "COMISSAO_NF" | "COMISSAO_PAGA" | "COMISSAO_LINK";

export const fmtBRL = (n: unknown) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const primeiro = (n?: string | null) => { const p = String(n ?? "").trim().split(/\s+/)[0] || "corretor"; return p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1).toLocaleLowerCase("pt-BR"); };
export const linkCorretor = (token: string) => `${env().APP_URL.replace(/\/$/, "")}/corretor/${token}`;
export const destinatariosDiretoria = () => env().REPORT_RECIPIENTS.split(",").map((x) => x.trim()).filter(Boolean);
const mascara = (s: string) => s.replace(/\d(?=\d{3})/g, "•");

type ComissaoTexto = { contratoNumero?: string | null; unidade?: string | null; empreendimento?: string | null; clienteNome?: string | null; valor?: unknown; nfNumero?: string | null; nfEnviadaEm?: Date | null };
type CorretorTexto = { nome: string; creci?: string | null; pixTipo?: string | null; pixChave?: string | null; banco?: string | null; token: string };
const venda = (c: ComissaoTexto) => [c.unidade, c.empreendimento].filter(Boolean).join(" – ") || c.contratoNumero || "venda";

export const textos = {
  liberada: (c: ComissaoTexto, k: CorretorTexto) =>
    `Olá, ${primeiro(k.nome)}! 🎉\n\nSua comissão da venda *${venda(c)}* foi liberada: *${fmtBRL(c.valor)}*.\n\nPara receber, confira seus dados (PIX) e envie sua nota fiscal ou RPA por este link:\n${linkCorretor(k.token)}\n\nCasa Forte`,
  pagar: (c: ComissaoTexto, k: CorretorTexto) =>
    `💰 *Comissão a pagar*\n\nCorretor: ${k.nome}${k.creci ? ` (CRECI ${k.creci})` : ""}\nVenda: ${venda(c)}${c.contratoNumero ? ` · ${c.contratoNumero}` : ""}\nCliente: ${c.clienteNome ?? "—"}\nValor: *${fmtBRL(c.valor)}*\nPIX: ${k.pixChave ? `${k.pixTipo ?? ""} ${k.pixChave}`.trim() : "ainda não informado pelo corretor"}\nNF/RPA: ${c.nfEnviadaEm ? `recebida${c.nfNumero ? ` (nº ${c.nfNumero})` : ""}` : "aguardando o corretor"}\n\nPainel → Comissões: ${env().APP_URL.replace(/\/$/, "")}/?aba=comissoes`,
  nf: (c: ComissaoTexto, k: CorretorTexto) =>
    `🧾 *NF/RPA recebida*\n\n${k.nome} enviou a nota${c.nfNumero ? ` nº ${c.nfNumero}` : ""} da comissão de *${fmtBRL(c.valor)}* (${venda(c)}). Já pode pagar.\nPIX: ${k.pixChave ? `${k.pixTipo ?? ""} ${k.pixChave}`.trim() : "não informado"}\n\nPainel → Comissões: ${env().APP_URL.replace(/\/$/, "")}/?aba=comissoes`,
  paga: (c: ComissaoTexto, k: CorretorTexto) =>
    `Olá, ${primeiro(k.nome)}! ✅\n\nPagamos sua comissão da venda *${venda(c)}*: *${fmtBRL(c.valor)}*.\nO comprovante fica disponível no seu link:\n${linkCorretor(k.token)}\n\nObrigado pela parceria!\nCasa Forte`,
  link: (k: CorretorTexto) =>
    `Olá, ${primeiro(k.nome)}! 👋\n\nEste é o seu link de comissões da Casa Forte. Por ele você confere suas vendas, cadastra seu PIX e envia notas fiscais:\n${linkCorretor(k.token)}\n\nGuarde este link — ele é só seu.`,
};

export type ResultadoAviso = { destino: string; status: string; motivo?: string };

export async function enviarAviso(p: {
  tipo: TipoAviso; comissaoId?: string | null; destino: string; texto: string; interno: boolean;
  solicitadoPor: string; chave: string; contrato?: string | null; valor?: unknown;
}): Promise<ResultadoAviso> {
  const e = env();
  const destino = toBrazilE164(p.destino);
  const r = (status: string, motivo?: string): ResultadoAviso => ({ destino: mascara(destino || p.destino), status, motivo });
  if (!destino) return r("SEM_TELEFONE");
  const dedupeKey = `comissao:${p.chave}:${p.tipo}:${destino}`;
  try {
    await db.comunicacao.create({ data: {
      tipo: p.tipo, dedupeKey, destino, status: "ENVIANDO", tentativas: 1, conteudo: p.texto, solicitadoPor: p.solicitadoPor,
      contrato: p.contrato ?? null, valor: p.valor == null ? null : new Prisma.Decimal(Number(p.valor) || 0),
    } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return r("JA_ENVIADO");
    throw err;
  }
  const marcar = (status: string, extra: Prisma.ComunicacaoUpdateInput = {}) => db.comunicacao.update({ where: { dedupeKey }, data: { status, ...extra } });
  if (e.COMISSAO_DRY_RUN) { await marcar("DRY_RUN", { motivo: "COMISSAO_DRY_RUN" }); return r("DRY_RUN", "modo teste das comissões"); }
  if (p.interno) {
    const bloqueio = !e.OUTBOUND_MESSAGING_ENABLED ? "MASTER_SWITCH_OFF" : e.WHATSAPP_DRY_RUN ? "DRY_RUN" : null;
    if (bloqueio) { await marcar("BLOQUEADA", { motivo: bloqueio }); return r("BLOQUEADA", bloqueio); }
  } else {
    const gate = canSendTo(destino, {
      appMode: e.APP_MODE, outboundEnabled: e.OUTBOUND_MESSAGING_ENABLED, dryRun: e.WHATSAPP_DRY_RUN,
      allowAllProduction: e.WHATSAPP_ALLOW_ALL_PRODUCTION, allowlist: e.WHATSAPP_ALLOWLIST.split(",").map((x) => x.trim()).filter(Boolean),
    });
    if (!gate.allowed) { await marcar("BLOQUEADA", { motivo: gate.reason }); return r("BLOQUEADA", gate.reason); }
  }
  const res = await evolutionSendText({ to: destino, text: p.texto });
  if (res.success) { await marcar("ENVIADA", { canal: "evolution", providerMessageId: res.messageId, enviadaEm: new Date() }); return r("ENVIADA"); }
  const incerto = String(res.error ?? "").startsWith("Conexão Evolution");
  await marcar(incerto ? "INCERTA" : "ERRO", { canal: "evolution", detalhe: String(res.error ?? "").slice(0, 400) });
  return r(incerto ? "INCERTA" : "ERRO", String(res.error ?? "").slice(0, 160));
}
