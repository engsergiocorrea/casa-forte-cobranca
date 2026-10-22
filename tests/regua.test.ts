import { describe, expect, it, vi } from "vitest";
import { agruparPorClienteTipo, janelaRegua, planejarRegua } from "../src/lib/regua/planejar";
import { normalizeIncomeInstallments } from "../src/lib/sienge/mapper";
import { renderTexto } from "../src/lib/canal/modelos";
import { criarCanalEvolution } from "../src/lib/canal/evolution";

const cfg = { diasAntes: 10, etapasCobranca: [1, 7, 15], tolerancia: 3 };
const HOJE = "2026-10-21";
let inst = 1;
// Linha no formato real do bulk-data /income (dados fictícios).
const row = (o: Record<string, any> = {}) => ({
  billId: 42, installmentId: inst++, clientId: 42, clientName: "FULANO DE TAL", documentIdentificationId: "CT  ",
  documentNumber: "UMAL-207", mainUnit: "L - 207", installmentNumber: "3/60", paymentTerm: { id: "PM" },
  receiptsCategories: [{ costCenterId: 2, costCenterName: "UMÁ MILAGRES" }], dueDate: "2026-10-31",
  balanceAmount: 5365.16, receipts: [], ...o,
});
const plano = (rows: any[]) => planejarRegua(normalizeIncomeInstallments({ data: rows }), HOJE, cfg);

describe("régua v2 — planejador", () => {
  it("D-10..D-1 → BOLETO; D0 → LEMBRETE; fora da janela → nada", () => {
    expect(plano([row({ dueDate: "2026-10-31" })])[0]).toMatchObject({ tipo: "BOLETO", etapa: "D-10", diasAteVencimento: 10 });
    expect(plano([row({ dueDate: "2026-10-22" })])[0]).toMatchObject({ tipo: "BOLETO", diasAteVencimento: 1 });
    expect(plano([row({ dueDate: "2026-10-21" })])[0]).toMatchObject({ tipo: "LEMBRETE_D0", etapa: "D0" });
    expect(plano([row({ dueDate: "2026-11-01" })])).toHaveLength(0); // D-11
  });
  it("parcela paga (saldo 0) nunca entra", () => {
    expect(plano([row({ balanceAmount: 0 })])).toHaveLength(0);
  });
  it("cobrança na maior etapa ≤ atraso, dentro da tolerância", () => {
    expect(plano([row({ dueDate: "2026-10-20" })])[0]).toMatchObject({ tipo: "COBRANCA", etapa: "D+1" });   // 1 dia
    expect(plano([row({ dueDate: "2026-10-17" })])[0]).toMatchObject({ tipo: "COBRANCA", etapa: "D+1" });   // 4 dias: D+1 + 3 de tolerância
    expect(plano([row({ dueDate: "2026-10-16" })])).toHaveLength(0);                                      // 5 dias: nenhuma etapa
    expect(plano([row({ dueDate: "2026-10-14" })])[0]).toMatchObject({ etapa: "D+7" });                    // 7 dias
    expect(plano([row({ dueDate: "2026-10-06" })])[0]).toMatchObject({ etapa: "D+15" });                   // 15 dias
  });
  it("dívida antiga não dispara cobrança no dia em que a régua liga", () => {
    expect(plano([row({ dueDate: "2026-09-01" })])).toHaveLength(0);
  });
  it("chaves únicas por parcela/vencimento/etapa e independentes da configuração", () => {
    const [b] = plano([row({ billId: 42, installmentId: 4, dueDate: "2026-10-26" })]);
    expect(b.dedupeKey).toBe("boleto:42:4:2026-10-26");
    const [c] = plano([row({ billId: 42, installmentId: 4, dueDate: "2026-10-14" })]);
    expect(c.dedupeKey).toBe("cobranca:42:4:2026-10-14:D+7");
  });
  it("monta imóvel e contrato a partir do Sienge", () => {
    expect(plano([row()])[0]).toMatchObject({ contrato: "UMAL-207", imovel: "UMÁ MILAGRES — L - 207", parcela: "3/60" });
  });
  it("agrupa por cliente e tipo (mensal + semestral = 1 mensagem)", () => {
    const g = agruparPorClienteTipo(plano([row({ clientId: 1 }), row({ clientId: 1 }), row({ clientId: 2 }), row({ clientId: 1, dueDate: "2026-10-20" })]));
    expect(g.map((x) => `${x[0].clientId}:${x[0].tipo}:${x.length}`).sort()).toEqual(["1:BOLETO:2", "1:COBRANCA:1", "2:BOLETO:1"]);
  });
  it("janela da consulta ao Sienge: hoje−(15+3) até hoje+10", () => {
    expect(janelaRegua(HOJE, cfg)).toEqual({ inicio: "2026-10-03", fim: "2026-10-31" });
  });
});

describe("régua v2 — textos", () => {
  const item = { parcela: "3/60", imovel: "UMÁ MILAGRES — L - 207", vencimento: "26/10/2026", valor: "R$ 5.365,16", boletoUrl: "https://x/b.pdf", linhaDigitavel: "2379..." };
  it("boleto: singular/plural, senha e rodapé", () => {
    const t = renderTexto({ modelo: "boleto_mes", nome: "Fulano", itens: [item] });
    expect(t).toContain("Boleto disponível");
    expect(t).toContain("Parcela 3/60");
    expect(t).toContain("5 primeiros dígitos");
    expect(t).toContain("#aquiécasaforte");
    expect(renderTexto({ modelo: "boleto_mes", nome: "F", itens: [item, item] })).toContain("Boletos disponíveis");
  });
  it("lembrete e cobrança com aviso de desconsiderar", () => {
    expect(renderTexto({ modelo: "lembrete_vencimento", nome: "F", itens: [item] })).toContain("vence hoje");
    const c = renderTexto({ modelo: "cobranca_atraso", nome: "F", itens: [item] });
    expect(c).toContain("Parcela em aberto");
    expect(c).toContain("Vencida em: 26/10/2026");
    expect(c).toContain("desconsidere");
  });
  it("sem boleto não fala de senha", () => {
    expect(renderTexto({ modelo: "cobranca_atraso", nome: "F", itens: [{ ...item, boletoUrl: null, linhaDigitavel: null }] })).not.toContain("senha");
  });
});

describe("régua v2 — canal Evolution", () => {
  const ok = { success: true, messageId: "m1" };
  const deps = () => ({ sendText: vi.fn().mockResolvedValue(ok), sendDocument: vi.fn().mockResolvedValue(ok), numberExists: vi.fn().mockResolvedValue(true) });
  const msg = { modelo: "boleto_mes" as const, nome: "F", itens: [{ parcela: "1/60", imovel: "X", vencimento: "01/11/2026", valor: "R$ 1,00" }] };
  it("sem anexo → texto", async () => {
    const d = deps();
    const r = await criarCanalEvolution(d).enviar(msg, "+5582999999999");
    expect(r).toMatchObject({ sucesso: true, providerMessageId: "m1" });
    expect(d.sendText).toHaveBeenCalledOnce();
    expect(d.sendDocument).not.toHaveBeenCalled();
  });
  it("com anexo → documento com o texto como legenda", async () => {
    const d = deps();
    await criarCanalEvolution(d).enviar({ ...msg, anexo: { nomeArquivo: "boleto.pdf", url: "https://x/b.pdf" } }, "+5582999999999");
    expect(d.sendDocument).toHaveBeenCalledWith(expect.objectContaining({ mediaUrl: "https://x/b.pdf", fileName: "boleto.pdf" }));
    expect(d.sendText).not.toHaveBeenCalled();
  });
  it("timeout/conexão → incerto (nunca reenviar sozinho)", async () => {
    const d = deps(); d.sendText.mockResolvedValue({ success: false, messageId: null, error: "Conexão Evolution: timeout" });
    expect(await criarCanalEvolution(d).enviar(msg, "+5582999999999")).toMatchObject({ sucesso: false, incerto: true });
  });
});
