import { describe, expect, it } from "vitest";
import { chaveUnidade, mesmoEmpreendimento, situacaoSinal } from "../src/lib/comissoes/sinal";
import { valorBR } from "../src/lib/comissoes/servico";

describe("situacaoSinal (regra: comissão libera com o sinal quitado)", () => {
  it("libera quando todas as condições SI estão pagas (SANTORINI-008: 3 sinais)", () => {
    const s = situacaoSinal({ paymentConditions: [
      { conditionTypeId: "SI", totalValue: 5000, amountPaid: 5000, outstandingBalance: 0, statusSituacao: "PAGO" },
      { conditionTypeId: "SI", totalValue: 15000, amountPaid: 15000, outstandingBalance: 0, statusSituacao: "PAGO" },
      { conditionTypeId: "PM", totalValue: 300000, amountPaid: 30988.99, outstandingBalance: 270000, statusSituacao: "PARCIALMENTE_PAGA" },
    ] });
    expect(s).toEqual({ temSinal: true, quitado: true, total: 20000, pago: 20000 });
  });
  it("não libera com sinal parcialmente pago", () => {
    const s = situacaoSinal({ paymentConditions: [
      { conditionTypeId: "SI", totalValue: 100000, amountPaid: 50000, outstandingBalance: 50000, statusSituacao: "PARCIALMENTE_PAGA" },
    ] });
    expect(s.quitado).toBe(false);
    expect(s.pago).toBe(50000);
  });
  it("não libera se uma das parcelas do sinal está em aberto", () => {
    expect(situacaoSinal({ paymentConditions: [
      { conditionTypeId: "SI", totalValue: 10, amountPaid: 10, statusSituacao: "PAGO" },
      { conditionTypeId: "SI", totalValue: 10, amountPaid: 0, outstandingBalance: 10, statusSituacao: "EM_ABERTO" },
    ] }).quitado).toBe(false);
  });
  it("sem condição SI → não libera sozinho", () => {
    expect(situacaoSinal({ paymentConditions: [{ conditionTypeId: "PM", totalValue: 1, amountPaid: 1, statusSituacao: "PAGO" }] })).toMatchObject({ temSinal: false, quitado: false });
    expect(situacaoSinal(null)).toMatchObject({ temSinal: false, quitado: false });
  });
  it("saldo zero sem nada pago não conta como quitado", () => {
    expect(situacaoSinal({ paymentConditions: [{ conditionTypeId: "SI", totalValue: 10, amountPaid: 0, outstandingBalance: 0 }] }).quitado).toBe(false);
  });
});

describe("casamento Contratos ↔ Sienge", () => {
  it("unidade", () => {
    expect(chaveUnidade("CASA 108")).toBe(chaveUnidade("CASA108"));
    expect(chaveUnidade("CASA 008")).toBe(chaveUnidade("Casa 8"));
    expect(chaveUnidade("CASA 108")).not.toBe(chaveUnidade("CASA 18"));
  });
  it("empreendimento", () => {
    expect(mesmoEmpreendimento("Casas Santorini", "SANTORINI")).toBe(true);
    expect(mesmoEmpreendimento("UMÁ Milagres", "UMÁ MILAGRES")).toBe(true);
    expect(mesmoEmpreendimento("Casas Santorini", "UMÁ MILAGRES")).toBe(false);
  });
  it("valor em reais", () => {
    expect(valorBR("44.400,00")).toBe(44400);
    expect(valorBR("R$ 1.234,56")).toBe(1234.56);
    expect(valorBR(5000)).toBe(5000);
    expect(valorBR("")).toBeNull();
  });
});
