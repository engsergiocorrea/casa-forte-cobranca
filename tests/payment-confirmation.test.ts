import { describe, expect, it } from "vitest";
import { normalizeBankMovements } from "../src/lib/sienge/mapper";
import { agruparPorCliente, selecionarRecebimentos } from "../src/lib/payments/selecao";
import { previewConfirmacao } from "../src/lib/collection/messages";
import { addDaysKey, localHour } from "../src/lib/collection/date";

// Fixture fictícia no formato real do bulk-data /bank-movement (08/10/2026).
let seq = 1000;
const mov = (o: Partial<Record<string, any>>) => ({
  bankMovementId: seq++, billId: 10, installmentId: 1, bankMovementAmount: 100,
  documentIdentificationId: "CT  ", documentIdentificationNumber: "UMAR-01",
  bankMovementOriginId: "CR", bankMovementHistoricId: 14, bankMovementHistoricName: "Recebimento",
  bankMovementOperationId: 1, bankMovementOperationName: "Recebimento", bankMovementOperationType: "E",
  bankMovementReconcile: "N", bankMovementDate: "2026-10-07", billDate: "2026-10-05",
  clientId: 1, clientName: "Fulana de Tal", ...o,
});
const sel = (rows: any[], corte = "2026-10-07") => selecionarRecebimentos(normalizeBankMovements({ data: rows }), corte);

describe("confirmação de pagamento — seleção", () => {
  it("recebimento simples entra", () => {
    const { recebimentos } = sel([mov({})]);
    expect(recebimentos).toHaveLength(1);
    expect(recebimentos[0]).toMatchObject({ billId: 10, installmentId: 1, clientId: 1, valor: 100, paidDate: "2026-10-07" });
  });
  it("antes da data de corte nunca entra (backlog)", () => {
    expect(sel([mov({ bankMovementDate: "2026-10-06" })]).recebimentos).toHaveLength(0);
  });
  it("soma acréscimo e desconta desconto concedido", () => {
    const { recebimentos } = sel([
      mov({ bankMovementAmount: 1000 }),
      mov({ bankMovementAmount: 50, bankMovementHistoricId: 19, bankMovementHistoricName: "Recebimento acréscimo" }),
      mov({ bankMovementAmount: 10, bankMovementHistoricId: 20, bankMovementOperationId: 2, bankMovementOperationType: "S" }),
    ]);
    expect(recebimentos).toHaveLength(1);
    expect(recebimentos[0].valor).toBe(1040);
    expect(recebimentos[0].movementIds).toHaveLength(3);
  });
  it("só acréscimo, sem recebimento principal, não confirma", () => {
    const r = sel([mov({ bankMovementHistoricId: 19 })]);
    expect(r.recebimentos).toHaveLength(0);
    expect(r.descartados[0].motivo).toBe("SEM_RECEBIMENTO_PRINCIPAL");
  });
  it("código de movimento desconhecido descarta a parcela inteira", () => {
    const r = sel([mov({}), mov({ bankMovementHistoricId: 99, bankMovementOperationType: "S" })]);
    expect(r.recebimentos).toHaveLength(0);
    expect(r.descartados[0].motivo).toBe("MOVIMENTO_NAO_RECONHECIDO");
  });
  it("movimentos fora do Contas a Receber (transferência etc.) são ignorados", () => {
    expect(sel([mov({ bankMovementOriginId: "TR" })]).recebimentos).toHaveLength(0);
  });
  it("sem título/parcela/cliente não confirma", () => {
    expect(sel([mov({ billId: null })]).descartados[0].motivo).toBe("SEM_TITULO_OU_CLIENTE");
  });
  it("mesma parcela paga em dois movimentos vira UMA confirmação", () => {
    const { recebimentos } = sel([mov({ bankMovementDate: "2026-10-07" }), mov({ bankMovementDate: "2026-10-08" })]);
    expect(recebimentos).toHaveLength(1);
    expect(recebimentos[0].paidDate).toBe("2026-10-08");
  });
  it("várias parcelas do mesmo cliente agrupam numa mensagem", () => {
    const { recebimentos } = sel([mov({ installmentId: 12 }), mov({ installmentId: 13 }), mov({ billId: 20, clientId: 2 })]);
    const g = agruparPorCliente(recebimentos);
    expect(g.get(1)).toHaveLength(2);
    expect(g.get(2)).toHaveLength(1);
  });
});

describe("confirmação de pagamento — mensagem e datas", () => {
  it("mensagem lista as parcelas e usa singular/plural", () => {
    const um = previewConfirmacao("Fulana", [{ imovel: "Umá — R-01", vencimento: "05/10/2026", valor: "R$ 100,00", pagoEm: "07/10/2026" }]);
    expect(um).toContain("do seu pagamento");
    expect(um).toContain("R$ 100,00");
    expect(um).toContain("pago em 07/10/2026");
    const dois = previewConfirmacao("Fulana", [{ imovel: "A", vencimento: "x", valor: "1", pagoEm: "y" }, { imovel: "B", vencimento: "x", valor: "2", pagoEm: "y" }]);
    expect(dois).toContain("dos seus pagamentos");
  });
  it("helpers de data", () => {
    expect(addDaysKey("2026-10-01", -3)).toBe("2026-09-28");
    expect(localHour(new Date("2026-10-08T17:30:00Z"), "America/Maceio")).toBe(14);
  });
});
