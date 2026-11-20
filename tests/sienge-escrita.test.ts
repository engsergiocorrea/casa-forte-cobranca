import { describe, expect, it, vi } from "vitest";

const env = { SIENGE_WRITE_DRY_RUN: true, TIMEZONE: "America/Maceio" };
vi.mock("../src/lib/env", () => ({ env: () => env }));
const criar = vi.fn().mockResolvedValue({});
vi.mock("../src/lib/db", () => ({ db: { alteracaoSienge: { create: (x: any) => criar(x) }, parcelaCache: { findUnique: async () => null }, pagamentoHistorico: { count: async () => 0 } } }));
const atualizarTelefones = vi.fn().mockResolvedValue({ status: 204 });
vi.mock("../src/lib/sienge/client", () => ({ sienge: { atualizarTelefones: (...a: any[]) => atualizarTelefones(...a), getInstallments: async () => ({ results: [] }) } }));
vi.mock("../src/lib/painel/cadastro", () => ({ cadastroCliente: async () => ({ nome: "FREDERICO", telefones: [{ numero: "(82) 99999-0821", tipo: "CE", principal: true, whatsapp: true }], enderecos: [], email: null }) }));
const { previaAlteracao, executarAlteracao } = await import("../src/lib/painel/sienge-escrita");

const pedido = { operacao: "TELEFONES" as const, customerId: 34, telefones: [{ numero: "5582988887777", principal: true, whatsapp: true }] };

describe("escrita no Sienge", () => {
  it("prévia mostra antes → depois, com DDD+número no formato do Sienge", async () => {
    const p = await previaAlteracao(pedido);
    expect(p.ok).toBe(true);
    expect(p.antes).toEqual(["(82) 99999-0821 · CE · principal · WhatsApp"]);
    expect(p.depois).toEqual(["(82) 988887777 · Celular · principal · WhatsApp"]);
  });
  it("modo teste: registra e NÃO altera o Sienge", async () => {
    const r = await executarAlteracao(pedido, "brain:sergio");
    expect(r).toMatchObject({ executado: false, status: "MODO_TESTE" });
    expect(atualizarTelefones).not.toHaveBeenCalled();
    expect(criar.mock.calls.at(-1)[0].data).toMatchObject({ operacao: "TELEFONES", status: "DRY_RUN", solicitadoPor: "brain:sergio" });
  });
  it("liberado: envia todos os telefones no payload oficial", async () => {
    env.SIENGE_WRITE_DRY_RUN = false;
    const r = await executarAlteracao(pedido, "painel:bruna");
    expect(r).toMatchObject({ executado: true, status: "OK" });
    expect(atualizarTelefones).toHaveBeenCalledWith(34, [{ number: "82988887777", main: true, type: "CE", note: "", idd: "+55", whatsapp: true }]);
    env.SIENGE_WRITE_DRY_RUN = true;
  });
  it("recusa telefone inválido e mais de um principal", async () => {
    await expect(previaAlteracao({ ...pedido, telefones: [{ numero: "123" }] })).rejects.toThrow(/inválido/);
    await expect(previaAlteracao({ ...pedido, telefones: [{ numero: "82988887777", principal: true }, { numero: "82977776666", principal: true }] })).rejects.toThrow(/exatamente um/);
  });
});
