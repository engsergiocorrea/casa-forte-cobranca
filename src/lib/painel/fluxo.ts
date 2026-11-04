import { db } from "../db";
import { env } from "../env";
import { sienge } from "../sienge/client";
import { normalizeInstallmentsList } from "../sienge/mapper";
import { localDateKey } from "../collection/date";
import { cacheDe, corrigirPeloCache } from "./parcelas";
import { contratos } from "./sienge-cache";

// Previsão de fluxo de caixa (ENTRADAS: contas a receber dos contratos de venda).
//  - A receber: saldo de cada parcela em aberto lido AO VIVO no Sienge (REST,
//    sem limite diário), com a correção monetária de hoje (fator do bulk,
//    ParcelaCache) = o valor do boleto. Correções futuras (INCC) não entram.
//  - Recebido: pagamentos reais (PagamentoHistorico), atualizados todo dia.
//  - Vencido: parcelas em aberto com vencimento antes de hoje (fica à parte,
//    não entra nos meses futuros).
// Cache curto em memória: a aba não refaz 42 consultas a cada clique.

// Por obra (empreendimento do contrato no Sienge): cada mês traz o a receber e o
// recebido de cada obra; a tela e o relatório filtram/separam por ela.
export type MesFluxo = { mes: string; recebido: number; aReceber: number; parcelasAReceber: number; parcelasRecebidas: number; porEmpreendimento: Record<string, number>; recebidoPorEmpreendimento: Record<string, number> };
export type Fluxo = {
  geradoEm: string; hoje: string; historicoAtualizadoEm: string | null; titulos: number; falhas: number;
  totais: { aReceber: number; vencido: number; parcelasVencidas: number; proximos3: number; proximos12: number; recebido6: number; aReceberSemCorrecao: number };
  vencidoPorEmpreendimento: Record<string, number>;
  meses: MesFluxo[];
  empreendimentos: { nome: string; vencido: number; parcelasVencidas: number; proximos3: number; proximos12: number; total: number; recebido6: number }[];
};

let cache: { em: number; chave: string; dados: Fluxo } | null = null;
const TTL = 5 * 60 * 1000;
const mesDe = (ymd: string) => ymd.slice(0, 7);
const somaMes = (ym: string, n: number) => { const [a, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(a, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function calcularFluxo(opts: { mesesAtras?: number; mesesFrente?: number; forcar?: boolean } = {}): Promise<Fluxo> {
  const atras = opts.mesesAtras ?? 6, frente = opts.mesesFrente ?? 12;
  const chave = `${atras}/${frente}`;
  if (!opts.forcar && cache && cache.chave === chave && Date.now() - cache.em < TTL) return cache.dados;

  const hoje = localDateKey(new Date(), env().TIMEZONE);
  const mesAtual = mesDe(hoje);
  const meses: MesFluxo[] = [];
  for (let i = -atras; i <= frente; i++) meses.push({ mes: somaMes(mesAtual, i), recebido: 0, aReceber: 0, parcelasAReceber: 0, parcelasRecebidas: 0, porEmpreendimento: {}, recebidoPorEmpreendimento: {} });
  const porMes = new Map(meses.map((m) => [m.mes, m]));
  const fim3 = somaMes(mesAtual, 2), fim12 = somaMes(mesAtual, 11);

  const cs = (await contratos()).filter((c) => c.billId && !/cancel|distrat/i.test(c.situacao));
  const empDe = new Map(cs.map((c) => [c.billId!, c.empreendimento || "Sem empreendimento"]));
  const billIds = cs.map((c) => c.billId!) as number[];
  const parcelasCache = await cacheDe(billIds);

  const totais = { aReceber: 0, vencido: 0, parcelasVencidas: 0, proximos3: 0, proximos12: 0, recebido6: 0, aReceberSemCorrecao: 0 };
  const vencidoPorEmp: Record<string, number> = {};
  const emp = new Map<string, Fluxo["empreendimentos"][number]>();
  const empItem = (n: string) => emp.get(n) ?? (emp.set(n, { nome: n, vencido: 0, parcelasVencidas: 0, proximos3: 0, proximos12: 0, total: 0, recebido6: 0 }), emp.get(n)!);
  let falhas = 0;

  // A receber: Sienge ao vivo (em lotes, para não sobrecarregar a API).
  for (let i = 0; i < billIds.length; i += 6) {
    await Promise.all(billIds.slice(i, i + 6).map(async (b) => {
      let ps; try { ps = normalizeInstallmentsList(await sienge.getInstallments(b)); } catch { falhas++; return; }
      const nome = empDe.get(b)!;
      for (const p of ps) {
        if (!(p.balanceDue > 0)) continue;
        const venc = p.dueDate.toISOString().slice(0, 10);
        const valor = corrigirPeloCache(p.balanceDue, parcelasCache.get(`${b}/${p.installmentId}`));
        const e = empItem(nome);
        totais.aReceber += valor; totais.aReceberSemCorrecao += p.balanceDue; e.total += valor;
        if (venc < hoje) { totais.vencido += valor; totais.parcelasVencidas++; e.vencido += valor; e.parcelasVencidas++; vencidoPorEmp[nome] = (vencidoPorEmp[nome] ?? 0) + valor; continue; }
        const m = mesDe(venc);
        if (m <= fim3) { totais.proximos3 += valor; e.proximos3 += valor; }
        if (m <= fim12) { totais.proximos12 += valor; e.proximos12 += valor; }
        const linha = porMes.get(m);
        if (linha) { linha.aReceber += valor; linha.parcelasAReceber++; linha.porEmpreendimento[nome] = (linha.porEmpreendimento[nome] ?? 0) + valor; }
      }
    }));
  }

  // Recebido: pagamentos reais registrados (histórico do Sienge).
  const inicio = `${meses[0].mes}-01`;
  const pagos = await db.pagamentoHistorico.findMany({ where: { real: true, pagoEm: { gte: inicio }, billId: { in: billIds } } });
  const seisAtras = somaMes(mesAtual, -5);
  for (const p of pagos) {
    const m = porMes.get(mesDe(p.pagoEm)); if (!m) continue;
    const v = Number(p.liquido), nome = empDe.get(p.billId) ?? "Sem empreendimento";
    m.recebido += v; m.parcelasRecebidas++;
    m.recebidoPorEmpreendimento[nome] = (m.recebidoPorEmpreendimento[nome] ?? 0) + v;
    if (m.mes >= seisAtras && m.mes <= mesAtual) { totais.recebido6 += v; empItem(nome).recebido6 += v; }
  }
  const syncs = await db.historicoSync.findMany({ where: { billId: { in: billIds } }, orderBy: { sincronizadoEm: "asc" }, take: 1 });

  const dados: Fluxo = {
    geradoEm: new Date().toISOString(), hoje, historicoAtualizadoEm: syncs[0]?.sincronizadoEm.toISOString() ?? null, titulos: billIds.length, falhas,
    totais: Object.fromEntries(Object.entries(totais).map(([k, v]) => [k, k === "parcelasVencidas" ? v : r2(v)])) as Fluxo["totais"],
    vencidoPorEmpreendimento: Object.fromEntries(Object.entries(vencidoPorEmp).map(([k, v]) => [k, r2(v)])),
    meses: meses.map((m) => ({ ...m, recebido: r2(m.recebido), aReceber: r2(m.aReceber), porEmpreendimento: Object.fromEntries(Object.entries(m.porEmpreendimento).map(([k, v]) => [k, r2(v)])), recebidoPorEmpreendimento: Object.fromEntries(Object.entries(m.recebidoPorEmpreendimento).map(([k, v]) => [k, r2(v)])) })),
    empreendimentos: [...emp.values()].map((e) => ({ ...e, vencido: r2(e.vencido), proximos3: r2(e.proximos3), proximos12: r2(e.proximos12), total: r2(e.total), recebido6: r2(e.recebido6) })).sort((a, b) => b.total - a.total),
  };
  cache = { em: Date.now(), chave, dados };
  return dados;
}

// Visão de uma obra (ou de todas): meses e totais só dela.
export function fluxoDaObra(f: Fluxo, obra: string | null) {
  if (!obra) return { meses: f.meses.map((m) => ({ mes: m.mes, recebido: m.recebido, aReceber: m.aReceber })), totais: f.totais };
  const e = f.empreendimentos.find((x) => x.nome === obra);
  return {
    meses: f.meses.map((m) => ({ mes: m.mes, recebido: m.recebidoPorEmpreendimento[obra] ?? 0, aReceber: m.porEmpreendimento[obra] ?? 0 })),
    totais: { aReceber: e?.total ?? 0, vencido: e?.vencido ?? 0, parcelasVencidas: e?.parcelasVencidas ?? 0, proximos3: e?.proximos3 ?? 0, proximos12: e?.proximos12 ?? 0, recebido6: e?.recebido6 ?? 0, aReceberSemCorrecao: 0 },
  };
}
