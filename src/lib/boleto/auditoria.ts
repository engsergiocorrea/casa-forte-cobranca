import { db } from "../db";
import { valorDaLinha, vencimentoDaLinha } from "./linha";

// Confere as mensagens JÁ ENVIADAS: em cada parcela do texto, o valor escrito
// ("💰 R$ …") tem de ser o valor gravado na linha digitável do boleto enviado.
// Só leitura (não envia nem altera nada).

export type ParcelaMensagem = { parcela: string; valorTexto: number | null; vencimentoTexto: string | null; linha: string | null };

const brl = (s: string) => Number(s.replace(/[^\d,]/g, "").replace(",", ".")) || null;
const ymd = (br: string) => { const m = br.match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

export function parcelasDoTexto(texto: string): ParcelaMensagem[] {
  const out: ParcelaMensagem[] = [];
  let atual: ParcelaMensagem | null = null;
  for (const l of texto.split("\n").map((x) => x.trim())) {
    const p = l.match(/^📄 Parcela (.+)$/);
    if (p) { atual = { parcela: p[1], valorTexto: null, vencimentoTexto: null, linha: null }; out.push(atual); continue; }
    if (!atual) continue;
    if (l.startsWith("💰")) atual.valorTexto = brl(l);
    else if (l.startsWith("📅")) atual.vencimentoTexto = ymd(l);
    else if (l.startsWith("🔢")) atual.linha = l.replace(/^.*?:/, "").trim();
  }
  return out;
}

export async function auditarValores(desde?: Date) {
  const coms = await db.comunicacao.findMany({
    where: { status: { in: ["ENVIADA", "ENTREGUE", "LIDA"] }, conteudo: { not: null }, ...(desde ? { enviadaEm: { gte: desde } } : {}) },
    orderBy: { enviadaEm: "desc" },
  });
  const vistos = new Set<string>(); // várias linhas de Comunicacao podem ter o mesmo texto (1 mensagem, várias parcelas)
  let mensagens = 0, parcelas = 0, semLinha = 0;
  const divergentes: any[] = [];
  for (const c of coms) {
    const chave = `${c.destino}|${c.enviadaEm?.toISOString()}|${c.conteudo?.length}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave); mensagens++;
    for (const p of parcelasDoTexto(c.conteudo ?? "")) {
      parcelas++;
      const vBoleto = valorDaLinha(p.linha);
      if (vBoleto == null) { semLinha++; continue; }
      const dVenc = vencimentoDaLinha(p.linha);
      const valorErrado = p.valorTexto == null || Math.abs(vBoleto - p.valorTexto) >= 0.01;
      if (valorErrado) divergentes.push({
        enviadaEm: c.enviadaEm, tipo: c.tipo, cliente: c.clienteNome, contrato: c.contrato, parcela: p.parcela,
        valorNaMensagem: p.valorTexto, valorNoBoleto: vBoleto, diferenca: p.valorTexto == null ? null : Math.round((vBoleto - p.valorTexto) * 100) / 100,
        vencimentoNaMensagem: p.vencimentoTexto, vencimentoNoBoleto: dVenc,
      });
    }
  }
  return { mensagens, parcelas, conferidas: parcelas - semLinha, semLinhaDigitavel: semLinha, divergentes: divergentes.length, itens: divergentes };
}
