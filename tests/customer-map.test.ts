import { describe, expect, it } from "vitest";
import { mapPessoaToSienge, extrairPessoasDaProposta, toIsoDate, splitPhoneBR } from "../src/lib/sienge/customer-map";

describe("datas e telefone", () => {
  it("toIsoDate aceita dd/mm/aaaa e aaaa-mm-dd", () => {
    expect(toIsoDate("10/09/1990")).toBe("1990-09-10");
    expect(toIsoDate("1990-09-10")).toBe("1990-09-10");
    expect(toIsoDate("")).toBeUndefined();
  });
  it("splitPhoneBR remove DDI e separa ddd/número", () => {
    expect(splitPhoneBR("(82) 99999-9999")).toEqual({ ddd: "82", number: "999999999" });
    expect(splitPhoneBR("5582999999999")).toEqual({ ddd: "82", number: "999999999" });
    expect(splitPhoneBR("123")).toBeUndefined();
  });
});

describe("mapPessoaToSienge", () => {
  const cfg = { typeId: "7", personType: "PF" };
  it("monta naturalPersonData e phones, sem campos vazios", () => {
    const out = mapPessoaToSienge({ nome: "Bruna Moter", cpf: "123.456.789-00", email: "b@x.com", nascimento: "10/09/1990", telefone: "(82) 98888-7777", rg: "12345" }, cfg);
    expect(out.personType).toBe("PF");
    expect(out.typeId).toBe(7);
    expect(out.naturalPersonData.name).toBe("Bruna Moter");
    expect(out.naturalPersonData.cpf).toBe("12345678900");
    expect(out.naturalPersonData.birthDate).toBe("1990-09-10");
    expect(out.phones[0]).toEqual({ ddd: "82", number: "988887777", main: true });
    expect("civilStatus" in out.naturalPersonData).toBe(false);
  });
  it("cônjuge entra embutido como spouse", () => {
    const out = mapPessoaToSienge({ nome: "João", cpf: "111", conjuge: { nome: "Maria", cpf: "222" } }, cfg);
    expect(out.naturalPersonData.spouse.name).toBe("Maria");
    expect(out.naturalPersonData.spouse.cpf).toBe("222");
  });
  it("sem cônjuge não cria spouse", () => {
    const out = mapPessoaToSienge({ nome: "Solo", cpf: "333" }, cfg);
    expect("spouse" in out.naturalPersonData).toBe(false);
  });
});

describe("extrairPessoasDaProposta", () => {
  it("pega compradores + proprietários e dedup por CPF; cônjuge embutido no principal", () => {
    const proposta = {
      comprador_principal: { nome: "Ana", cpf: "1" },
      conjuge: { nome: "Beto", cpf: "2" },
      comprador_adicional: { nome: "Carlos", cpf: "3" },
      proprietarios: [{ nome: "Ana", cpf: "1" }, { nome: "Dora", cpf: "4" }],
    };
    const pessoas = extrairPessoasDaProposta(proposta);
    const cpfs = pessoas.map((x) => String(x.pessoa.cpf));
    expect(cpfs).toEqual(["1", "3", "4"]); // Ana (1) não duplica; Beto é cônjuge embutido
    const ana = pessoas.find((x) => x.pessoa.cpf === "1")!;
    expect(ana.pessoa.conjuge?.nome).toBe("Beto");
  });
});
