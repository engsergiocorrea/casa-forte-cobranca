import { describe, expect, it } from "vitest";
import { valorDaLinha, vencimentoDaLinha } from "../src/lib/boleto/linha";
import { parcelasDoTexto } from "../src/lib/boleto/auditoria";

// Linha da parcela de teste (ADM CASA FORTE — TESTE, R$ 10,00, venc. 25/08/2026).
const LINHA = "23793234019000000000132000161003315490000001000";

describe("valor e vencimento gravados na linha digitável", () => {
  it("lê o valor em reais", () => {
    expect(valorDaLinha(LINHA)).toBe(10);
    expect(valorDaLinha("23793.23401 90000.000001 32000.161003 3 15490000419300")).toBe(4193);
  });
  it("lê o vencimento pelo fator (base nova de 22/02/2025)", () => {
    expect(vencimentoDaLinha(LINHA)).toBe("2026-08-25");
  });
  it("linha ausente ou fora do padrão → null", () => {
    expect(valorDaLinha(null)).toBeNull();
    expect(valorDaLinha("123")).toBeNull();
  });
});

describe("conferência das mensagens enviadas", () => {
  it("extrai valor, vencimento e linha de cada parcela do texto", () => {
    const texto = `⚠️ Parcela em aberto\n\n🏠 ADM CASA FORTE — TESTE\n\n📄 Parcela 1/10\n📅 Vencida em: 25/08/2026\n💰 R$ 10,00\n🔢 Linha digitável: ${LINHA}\n🔗 Boleto: https://x`;
    expect(parcelasDoTexto(texto)).toEqual([{ parcela: "1/10", valorTexto: 10, vencimentoTexto: "2026-08-25", linha: LINHA }]);
  });
  it("valor com milhar (R$ 19.546,89)", () => {
    expect(parcelasDoTexto("📄 Parcela 5/10\n💰 R$ 19.546,89")[0].valorTexto).toBe(19546.89);
  });
});

import { corrigir } from "../src/lib/painel/parcelas";
describe("saldo com correção monetária (= valor do boleto)", () => {
  it("aplica o fator corrigido/base do Sienge", () => {
    expect(corrigir(19974.68, 19974.68, 20273.67)).toBe(20273.67); // Tharsila 4/4
    expect(corrigir(4193, 4193, 4255.76)).toBe(4255.76);           // Vitória 3/60
  });
  it("pagamento parcial depois da leitura: corrige o saldo que sobrou", () => {
    expect(corrigir(2000, 4000, 4060)).toBe(2030);
  });
  it("sem fator ou parcela paga", () => {
    expect(corrigir(4193, 0, 0)).toBe(4193);
    expect(corrigir(0, 4193, 4255.76)).toBe(0);
  });
});

import { vi } from "vitest";
describe("recibo: consulta só pela chave da parcela", () => {
  it("itens com campos extras não vão para o where do banco", async () => {
    vi.resetModules();
    const findUnique = vi.fn().mockResolvedValue(null), findMany = vi.fn().mockResolvedValue([]);
    vi.doMock("../src/lib/db", () => ({ db: { parcelaCache: { findUnique }, pagamentoHistorico: { findMany } } }));
    const { dadosRecibo } = await import("../src/lib/painel/recibo");
    await dadosRecibo([{ billId: 31, installmentId: 7, contrato: "UMAL-01", parcela: "6/60" } as any]);
    expect(findUnique).toHaveBeenCalledWith({ where: { billId_installmentId: { billId: 31, installmentId: 7 } } });
    expect(findMany.mock.calls[0][0].where).toEqual({ billId: 31, installmentId: 7, real: true });
  });
});
