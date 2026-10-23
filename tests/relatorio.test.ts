import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { acaoSugerida, deveEnviarAutomatico, legendaRelatorio, montarRelatorio } from "../src/lib/relatorio/dados";
import { gerarRelatorioPdf } from "../src/lib/relatorio/pdf";

const com = (o: Record<string, any> = {}) => ({ tipo: "BOLETO", etapa: "D-10", status: "ENVIADA", motivo: null, clienteNome: "FULANO DE TAL", contrato: "UMAR-01", parcela: "3/60", vencimento: "2026-11-02", valor: 4193, ...o });
const conf = (o: Record<string, any> = {}) => ({ contrato: "UMAL-207", status: "SENT", motivo: null, detail: null, valor: 5412.45, pagoEm: "2026-10-18", ...o });

describe("relatório do dia — dados", () => {
  it("separa enviadas, falhas, aguardando boleto e teste", () => {
    const d = montarRelatorio("2026-10-23", [
      com(), com({ tipo: "COBRANCA", etapa: "D+1" }), com({ status: "SEM_WHATSAPP" }), com({ status: "PLANEJADA", motivo: "BOLETO_AINDA_NAO_GERADO" }), com({ status: "DRY_RUN" }),
    ], [conf(), conf({ status: "NO_PHONE" })], [{ cliente: "KALIL", contrato: "SANTORINI-008", tipos: "TODOS", ate: null, motivo: "negociação" }]);
    expect(d.resumo).toEqual({ boletos: 1, lembretes: 0, cobrancas: 1, confirmacoes: 1, falhas: 2, emTeste: 1, aguardandoBoleto: 1, pausas: 1 });
    expect(d.falhas[0].acao).toContain("DDI");
    expect(d.confirmacoes.falhas[0].acao).toContain("Cadastrar o celular");
  });
  it("automático só com boleto enviado ou falha", () => {
    expect(deveEnviarAutomatico(montarRelatorio("2026-10-23", [com({ tipo: "COBRANCA" })], [], []))).toBe(false);
    expect(deveEnviarAutomatico(montarRelatorio("2026-10-23", [com()], [], []))).toBe(true);
    expect(deveEnviarAutomatico(montarRelatorio("2026-10-23", [], [conf({ status: "ERROR" })], []))).toBe(true);
  });
  it("ações sugeridas", () => {
    expect(acaoSugerida("PLANEJADA", "SEM_BOLETO_ATIVO")).toContain("não é cobrado automaticamente");
    expect(acaoSugerida("INCERTA")).toContain("não é reenviada");
  });
  it("legenda", () => {
    const l = legendaRelatorio(montarRelatorio("2026-10-23", [com()], [], []));
    expect(l).toContain("Relatório do dia 23/10/2026");
    expect(l).toContain("Boletos enviados: 1");
    expect(l).toContain("Nenhuma falha");
  });
});

describe("relatório do dia — PDF", () => {
  it("gera PDF válido e quebra página com muitas linhas", async () => {
    const muitas = Array.from({ length: 80 }, (_, i) => com({ contrato: `UMAR-${i}` }));
    const b = await gerarRelatorioPdf(montarRelatorio("2026-10-23", muitas, [conf()], []), new Date("2026-10-23T21:00:00Z"));
    expect(Buffer.from(b.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    expect((await PDFDocument.load(b)).getPageCount()).toBeGreaterThan(1);
  });
});
