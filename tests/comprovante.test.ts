import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { dataPorExtenso, empresaDe, gerarComprovantePdf, montarParcelaRecibo, nomeArquivoComprovante, nomeProprio, valorPorExtenso } from "../src/lib/payments/comprovante";
import { enviarConfirmacao } from "../src/lib/payments/envio";
import { normalizeIncomeInstallments } from "../src/lib/sienge/mapper";

// Parcela no formato real do bulk-data /income/by-bills (12/10/2026), dados fictícios.
const incomeRow = (o: Record<string, any> = {}) => ({
  companyId: 2, companyName: "CONSTRUCOES E EMPREENDIMENTOS CASA FORTE LTDA", clientId: 37, clientName: "FULANO DE TAL",
  billId: 34, installmentId: 6, documentIdentificationId: "CT  ", documentNumber: "UMAR-211", dueDate: "2026-10-12",
  mainUnit: "R - 211", installmentNumber: "4/60", paymentTerm: { id: "PM", descrition: "Parcelas Mensais" },
  receiptsCategories: [{ costCenterId: 2, costCenterName: "UMÁ MILAGRES" }],
  receipts: [{ operationTypeId: 2, operationTypeName: "Recebimento", grossAmount: 4084.72, discountAmount: 0, insuranceAmount: 0,
    interestAmount: 0, fineAmount: 0, netAmount: 4084.72, paymentDate: "2026-10-13", bankMovements: [{ id: 470 }] }],
  ...o,
});
const parcela = (o: Record<string, any> = {}) => ({
  titulo: 34, parcela: "4/60", tipoParc: "PM", unidade: "R - 211", documento: "CT / UMAR-211", centroCusto: "2 - UMÁ MILAGRES",
  vencimento: "12/10/2026", valor: 4084.72, seguro: 0, desconto: 0, acrescimos: 0, liquido: 4084.72, pagoEm: "2026-10-13", ...o,
});
const empresa = empresaDe(2, "CONSTRUCOES E EMPREENDIMENTOS CASA FORTE LTDA");
const opts = { emitidoEm: new Date("2026-10-13T21:00:00Z"), timeZone: "America/Maceio" };
const isPdf = (b: Uint8Array) => Buffer.from(b.slice(0, 5)).toString("latin1") === "%PDF-";

describe("recibo — dados do Sienge", () => {
  it("monta a parcela com o nº do plano (4/60), não o installmentId", () => {
    const [inc] = normalizeIncomeInstallments({ data: [incomeRow()] });
    const p = montarParcelaRecibo(inc, [470]);
    expect(p).toMatchObject({ titulo: 34, parcela: "4/60", tipoParc: "PM", unidade: "R - 211", documento: "CT / UMAR-211",
      centroCusto: "2 - UMÁ MILAGRES", vencimento: "12/10/2026", valor: 4084.72, liquido: 4084.72, pagoEm: "2026-10-13" });
  });
  it("escolhe a baixa que gerou o movimento confirmado", () => {
    const [inc] = normalizeIncomeInstallments({ data: [incomeRow({ receipts: [
      { operationTypeName: "Recebimento", grossAmount: 100, netAmount: 100, paymentDate: "2026-10-01", bankMovements: [{ id: 1 }] },
      { operationTypeName: "Recebimento", grossAmount: 200, netAmount: 210, interestAmount: 6, fineAmount: 4, paymentDate: "2026-10-13", bankMovements: [{ id: 2 }] },
    ] })] });
    expect(montarParcelaRecibo(inc, [1]).liquido).toBe(100);
    const p = montarParcelaRecibo(inc, [2]);
    expect(p.liquido).toBe(210);
    expect(p.acrescimos).toBe(10);
  });
  it("sem baixa ou sem nº da parcela → erro (cai para só texto)", () => {
    const [semBaixa] = normalizeIncomeInstallments({ data: [incomeRow({ receipts: [] })] });
    expect(() => montarParcelaRecibo(semBaixa, [470])).toThrow();
    const [semNumero] = normalizeIncomeInstallments({ data: [incomeRow({ installmentNumber: "" })] });
    expect(() => montarParcelaRecibo(semNumero, [470])).toThrow();
  });
  it("empresa conhecida traz CNPJ e endereço; desconhecida só o nome", () => {
    expect(empresa.cnpj).toBe("37.301.810/0001-98");
    expect(empresaDe(99, "OUTRA SPE")).toEqual({ nome: "OUTRA SPE" });
  });
});

describe("recibo — extenso e data", () => {
  it("valor por extenso igual ao Sienge", () => {
    expect(valorPorExtenso(4200.54)).toBe("quatro mil e duzentos reais e cinquenta e quatro centavos");
    expect(valorPorExtenso(4084.72)).toBe("quatro mil e oitenta e quatro reais e setenta e dois centavos");
    expect(valorPorExtenso(2892.72)).toBe("dois mil oitocentos e noventa e dois reais e setenta e dois centavos");
    expect(valorPorExtenso(1)).toBe("um real");
    expect(valorPorExtenso(0.01)).toBe("um centavo");
    expect(valorPorExtenso(100)).toBe("cem reais");
    expect(valorPorExtenso(1000000)).toBe("um milhão de reais");
    expect(valorPorExtenso(79380)).toBe("setenta e nove mil trezentos e oitenta reais");
    expect(valorPorExtenso(10413.82)).toBe("dez mil quatrocentos e treze reais e oitenta e dois centavos");
  });
  it("data por extenso", () => {
    expect(dataPorExtenso("2026-09-09")).toBe("9 de Setembro de 2026");
    expect(dataPorExtenso("2026-10-13")).toBe("13 de Outubro de 2026");
  });
});

describe("recibo — PDF", () => {
  it("gera PDF válido, 1 página por parcela", async () => {
    const um = await gerarComprovantePdf({ empresa, clienteNome: "FULANO DE TAL", parcelas: [parcela()] }, opts);
    expect(isPdf(um)).toBe(true);
    const doc = await PDFDocument.load(um);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Recibo de pagamento");
    const dois = await gerarComprovantePdf({ empresa, clienteNome: "FULANO", parcelas: [parcela(), parcela({ parcela: "5/60", acrescimos: 12.3 })] }, { ...opts, legalLine: "linha de teste" });
    expect((await PDFDocument.load(dois)).getPageCount()).toBe(2);
  });
  it("não quebra com emoji ou caractere fora do WinAnsi", async () => {
    expect(isPdf(await gerarComprovantePdf({ empresa: { nome: "X ✅" }, clienteNome: "ANA 😀", parcelas: [parcela({ unidade: "Casa ✅" })] }, opts))).toBe(true);
  });
  it("recusa recibo sem parcelas", async () => {
    await expect(gerarComprovantePdf({ empresa, clienteNome: "X", parcelas: [] }, opts)).rejects.toThrow();
  });
});

describe("comprovante — nome e arquivo", () => {
  it("nome próprio com partículas minúsculas", () => {
    expect(nomeProprio("MARIA DA SILVA DOS SANTOS E SOUZA")).toBe("Maria da Silva dos Santos e Souza");
    expect(nomeProprio("JOÃO DE ÁVILA D'ÁVILA")).toBe("João de Ávila D'Ávila");
    expect(nomeProprio("  ANA-CLARA   DO  NASCIMENTO ")).toBe("Ana-Clara do Nascimento");
    expect(nomeProprio("DA SILVA")).toBe("Da Silva"); // partícula no início fica maiúscula
  });
  it("nome do arquivo", () => {
    expect(nomeArquivoComprovante("UMAR-05", "08/10/2026")).toBe("comprovante-pagamento-UMAR-05-08-10-2026.pdf");
    expect(nomeArquivoComprovante("SANTORINI 102/A", "01/10/2026")).toBe("comprovante-pagamento-SANTORINI-102-A-01-10-2026.pdf");
  });
});

describe("confirmação — envio texto × PDF", () => {
  const ok = { success: true, messageId: "m1" };
  const base = { to: "+5582999999999", texto: "msg", fileName: "c.pdf" };
  const deps = () => ({ sendText: vi.fn().mockResolvedValue(ok), sendDocument: vi.fn().mockResolvedValue(ok) });

  it("flag false → só sendText", async () => {
    const d = deps(); const gerarPdf = vi.fn();
    const r = await enviarConfirmacao({ ...base, pdfEnabled: false, gerarPdf }, d);
    expect(r.via).toBe("text");
    expect(d.sendText).toHaveBeenCalledWith({ to: base.to, text: "msg" });
    expect(d.sendDocument).not.toHaveBeenCalled();
    expect(gerarPdf).not.toHaveBeenCalled();
  });
  it("flag true → sendDocument com base64, legenda e nome do arquivo", async () => {
    const d = deps();
    const r = await enviarConfirmacao({ ...base, pdfEnabled: true, gerarPdf: async () => new Uint8Array([37, 80, 68, 70]) }, d);
    expect(r.via).toBe("document");
    expect(d.sendText).not.toHaveBeenCalled();
    expect(d.sendDocument).toHaveBeenCalledWith({ to: base.to, mediaUrl: Buffer.from("%PDF").toString("base64"), fileName: "c.pdf", caption: "msg" });
  });
  it("falha na GERAÇÃO → cai para sendText e informa o erro", async () => {
    const d = deps();
    const r = await enviarConfirmacao({ ...base, pdfEnabled: true, gerarPdf: async () => { throw new Error("boom"); } }, d);
    expect(r.via).toBe("text");
    expect(r.pdfErro).toContain("boom");
    expect(d.sendText).toHaveBeenCalledTimes(1);
    expect(d.sendDocument).not.toHaveBeenCalled();
  });
  it("falha no ENVIO do documento → NÃO chama sendText", async () => {
    const d = deps();
    d.sendDocument.mockResolvedValue({ success: false, messageId: null, error: "Conexão Evolution: timeout" });
    const r = await enviarConfirmacao({ ...base, pdfEnabled: true, gerarPdf: async () => new Uint8Array([1]) }, d);
    expect(r.result.success).toBe(false);
    expect(r.via).toBe("document");
    expect(d.sendText).not.toHaveBeenCalled();
  });
});
