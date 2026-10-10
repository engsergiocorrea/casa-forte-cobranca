import { describe, expect, it } from "vitest";
import { mapPessoaToSienge, extrairPessoasDaProposta, toIsoDate, splitPhoneBR } from "../src/lib/sienge/customer-map";
import { normalizeCustomerPhones } from "../src/lib/sienge/mapper";

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
  it("inclui gênero e correspondência quando configurados", () => {
    const out = mapPessoaToSienge({ nome: "X", cpf: "1" }, { typeId: "7", personType: "PF", sex: "N", mailing: "R" });
    expect(out.naturalPersonData.sex).toBe("N");
    expect(out.naturalPersonData.mailingAddress).toBe("R");
  });
  it("omite gênero/correspondência quando não configurados (dry-run)", () => {
    const out = mapPessoaToSienge({ nome: "X", cpf: "1" }, cfg);
    expect("sex" in out.naturalPersonData).toBe(false);
    expect("mailingAddress" in out.naturalPersonData).toBe(false);
  });
  it("inclui subtypeIds quando o subtipo é configurado", () => {
    const out = mapPessoaToSienge({ nome: "X", cpf: "1" }, { typeId: "1", personType: "F", subtypeId: "1" });
    expect(out.typeId).toBe(1);
    expect(out.subtypeIds).toEqual([1]);
    expect(out.foreigner).toBe("N");
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
  it("telefone estrangeiro usa o código do país (idd) do cadastro", () => {
    const pt = normalizeCustomerPhones({ phones: [{ type: "Celular", number: "912345689", main: true, idd: "+351", ddd: "null", whatsapp: true }] });
    expect(pt[0]?.numero).toBe("+351912345689");
    const br = normalizeCustomerPhones({ phones: [{ type: "Celular", number: "(11)91234-5612", main: true, idd: "+55", ddd: "null" }] });
    expect(br[0]?.numero).toBe("+5511912345612");
    // Argentina: celular precisa do 9 depois do 54 (cadastro vem sem)
    const ar = normalizeCustomerPhones({ phones: [{ type: "Celular", number: "2223421234", idd: "+54", ddd: null, whatsapp: true }] });
    expect(ar[0]?.numero).toBe("+5492223421234");
    const arOk = normalizeCustomerPhones({ phones: [{ number: "9 2223 42-1234", idd: "+54" }] });
    expect(arOk[0]?.numero).toBe("+5492223421234");
    // número estrangeiro dividido entre DDD e Telefone (campo corta em 10 dígitos)
    const arSplit = normalizeCustomerPhones({ phones: [{ number: "223421234", ddd: "92", idd: "+54" }] });
    expect(arSplit[0]?.numero).toBe("+5492223421234");
    // Brasil: DDD separado é usado; DDD repetido no número não duplica
    expect(normalizeCustomerPhones({ phones: [{ number: "91234-5612", ddd: "82", idd: "+55" }] })[0]?.numero).toBe("+5582912345612");
    expect(normalizeCustomerPhones({ phones: [{ number: "(82) 91234-5612", ddd: "82", idd: "+55" }] })[0]?.numero).toBe("+5582912345612");
  });
});
