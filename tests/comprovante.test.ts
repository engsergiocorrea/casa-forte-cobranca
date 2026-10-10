import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { gerarComprovantePdf, nomeArquivoComprovante, nomeProprio } from "../src/lib/payments/comprovante";
import { enviarConfirmacao } from "../src/lib/payments/envio";

const parcela = (o: Partial<Record<string, any>> = {}) => ({
  imovel: "UMÁ MILAGRES — R - 05", contrato: "UMAR-05", parcela: 12,
  vencimento: "10/10/2026", pagoEm: "08/10/2026", valor: 2892.72, ...o,
});
const opts = { emitidoEm: new Date("2026-10-08T21:00:00Z"), timeZone: "America/Maceio" };
const isPdf = (b: Uint8Array) => Buffer.from(b.slice(0, 5)).toString("latin1") === "%PDF-";

describe("comprovante — PDF", () => {
  it("gera PDF válido para 1 parcela", async () => {
    const b = await gerarComprovantePdf({ clienteNome: "FULANA DE TAL", parcelas: [parcela()] }, opts);
    expect(isPdf(b)).toBe(true);
    const doc = await PDFDocument.load(b);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Comprovante de pagamento");
  });
  it("gera PDF válido para 2 parcelas (com total)", async () => {
    const b = await gerarComprovantePdf({ clienteNome: "FULANO", parcelas: [parcela(), parcela({ parcela: 13, valor: 10413.82 })] }, { ...opts, legalLine: "Casa Forte — linha jurídica de teste" });
    expect(isPdf(b)).toBe(true);
    expect((await PDFDocument.load(b)).getPageCount()).toBe(1);
  });
  it("não quebra com emoji ou caractere fora do WinAnsi", async () => {
    const b = await gerarComprovantePdf({ clienteNome: "ANA 😀", parcelas: [parcela({ imovel: "Casa ✅ Santorini" })] }, opts);
    expect(isPdf(b)).toBe(true);
  });
  it("muitas parcelas quebram página sem erro", async () => {
    const ps = Array.from({ length: 40 }, (_, i) => parcela({ parcela: i + 1 }));
    const doc = await PDFDocument.load(await gerarComprovantePdf({ clienteNome: "X", parcelas: ps }, opts));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
  it("recusa comprovante sem parcelas", async () => {
    await expect(gerarComprovantePdf({ clienteNome: "X", parcelas: [] }, opts)).rejects.toThrow();
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
