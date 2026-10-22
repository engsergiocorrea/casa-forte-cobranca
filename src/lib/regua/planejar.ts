import type { NormalizedIncomeInstallment } from "../sienge/mapper";
import { diffDias } from "../collection/date";

// Planejador PURO da régua v2 (sem I/O): dado o que o Sienge diz das parcelas
// com vencimento na janela, decide o que cada uma deve receber HOJE.
//  - vence em 1..BOLETO_DIAS_ANTES dias → BOLETO (D-10; se o boleto ainda não
//    existir no Sienge, o executor deixa PLANEJADA e tenta no dia seguinte);
//  - vence hoje → LEMBRETE_D0 (leva o boleto junto, cobrindo quem não recebeu
//    o do D-10 porque o INCC-DI atrasou);
//  - venceu há N dias → COBRANCA na maior etapa ≤ N (D+1, D+7, D+15), só se
//    N − etapa ≤ tolerância. A tolerância cobre um dia de job perdido sem
//    disparar cobrança de dívidas antigas no primeiro dia em que a régua liga.
// A chave (dedupeKey) é única por parcela+vencimento+etapa: cada etapa sai no
// máximo uma vez. Ver docs/ARQUITETURA-COMUNICACAO.md §4.3.

export type TipoRegua = "BOLETO" | "LEMBRETE_D0" | "COBRANCA";

export type ItemPlano = {
  tipo: TipoRegua;
  etapa: string;          // D-10 | D0 | D+1 | D+7 | D+15
  dedupeKey: string;
  billId: number;
  installmentId: number;
  vencimento: string;     // yyyy-mm-dd
  diasAteVencimento: number; // negativo = atraso
  clientId: number;
  clientName: string;
  contrato: string;       // "UMAR-211"
  parcela: string;        // "4/60"
  imovel: string;         // "UMÁ MILAGRES — R - 211"
  saldo: number;          // do bulk (revalidado no envio)
};

export type ConfigRegua = { diasAntes: number; etapasCobranca: number[]; tolerancia: number };

export function janelaRegua(hoje: string, cfg: ConfigRegua): { inicio: string; fim: string; } {
  const maxAtraso = Math.max(0, ...cfg.etapasCobranca) + cfg.tolerancia;
  const d = (n: number) => new Date(Date.parse(`${hoje}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  return { inicio: d(-maxAtraso), fim: d(cfg.diasAntes) };
}

const contratoDe = (documento: string) => documento.split("/").pop()!.trim();
const empreendimentoDe = (centroCusto: string) => centroCusto.replace(/^\s*\d+\s*-\s*/, "").trim();

export function planejarRegua(parcelas: NormalizedIncomeInstallment[], hoje: string, cfg: ConfigRegua): ItemPlano[] {
  const etapas = [...new Set(cfg.etapasCobranca)].filter((n) => n > 0).sort((a, b) => a - b);
  const out: ItemPlano[] = [];
  for (const p of parcelas) {
    if (!(p.saldo > 0) || !p.clientId || !p.billId || !p.installmentId || !p.vencimento) continue;
    const d = diffDias(hoje, p.vencimento);
    const base = {
      billId: p.billId, installmentId: p.installmentId, vencimento: p.vencimento, diasAteVencimento: d,
      clientId: p.clientId, clientName: p.clientName, contrato: contratoDe(p.documento), parcela: p.parcela,
      imovel: [empreendimentoDe(p.centroCusto), p.unidade].filter(Boolean).join(" — ") || contratoDe(p.documento),
      saldo: p.saldo,
    };
    // boleto:42:4:2026-11-26 · lembrete:42:4:2026-11-26 · cobranca:42:4:2026-11-26:D+7
    const chave = (prefixo: string, etapa?: string) => [prefixo, p.billId, p.installmentId, p.vencimento, etapa].filter(Boolean).join(":");
    if (d >= 1 && d <= cfg.diasAntes) {
      out.push({ ...base, tipo: "BOLETO", etapa: `D-${cfg.diasAntes}`, dedupeKey: chave("boleto") });
    } else if (d === 0) {
      out.push({ ...base, tipo: "LEMBRETE_D0", etapa: "D0", dedupeKey: chave("lembrete") });
    } else if (d < 0) {
      const atraso = -d;
      const etapa = etapas.filter((e) => e <= atraso).at(-1);
      if (etapa != null && atraso - etapa <= cfg.tolerancia) {
        out.push({ ...base, tipo: "COBRANCA", etapa: `D+${etapa}`, dedupeKey: chave("cobranca", `D+${etapa}`) });
      }
    }
  }
  return out.sort((a, b) => a.clientId - b.clientId || a.vencimento.localeCompare(b.vencimento) || a.installmentId - b.installmentId);
}

// Agrupa por cliente e tipo: uma mensagem por cliente por tipo, com todas as
// parcelas daquele dia (ex.: mensal + semestral).
export function agruparPorClienteTipo(itens: ItemPlano[]): ItemPlano[][] {
  const m = new Map<string, ItemPlano[]>();
  for (const i of itens) {
    const k = `${i.clientId}:${i.tipo}`;
    m.set(k, [...(m.get(k) ?? []), i]);
  }
  return [...m.values()];
}
