import { sienge } from "../sienge/client";
import { contratosDoCliente } from "./sienge-cache";

// Dados cadastrais do cliente no Sienge (GET /customers/{id}), normalizados
// para o painel e o Brain. Dado pessoal (LGPD): só para usuários internos
// autorizados; cada consulta do Brain fica na auditoria dele.

const txt = (v: unknown) => { const s = String(v ?? "").trim(); return s || null; };
const soDig = (v: unknown) => String(v ?? "").replace(/\D/g, "");
export function formatarDocumento(v: unknown): string | null {
  const d = soDig(v);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return txt(v);
}
const data = (v: unknown) => { const s = txt(v); return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split("-").reverse().join("/") : s; };
const SEXO: Record<string, string> = { M: "Masculino", F: "Feminino" };
const PESSOA: Record<string, string> = { F: "Física", J: "Jurídica", FISICA: "Física", JURIDICA: "Jurídica" };

function telefone(p: any) {
  const idd = soDig(p?.idd) || "55", ddd = soDig(p?.ddd), num = soDig(p?.number);
  const local = ddd ? `(${ddd}) ${num}` : num;
  return { numero: idd === "55" ? local : `+${idd} ${local}`, tipo: txt(p?.type), principal: Boolean(p?.main), whatsapp: Boolean(p?.whatsapp), observacao: txt(p?.note) };
}
function endereco(a: any) {
  const linha = [txt(a?.streetName), txt(a?.number)].filter(Boolean).join(", ");
  return {
    tipo: txt(a?.type), logradouro: linha || null, complemento: txt(a?.complement), bairro: txt(a?.neighborhood),
    cidade: txt(a?.city?.name ?? a?.city ?? a?.cityName), uf: txt(a?.state), cep: soDig(a?.zipCode).replace(/^(\d{5})(\d{3})$/, "$1-$2") || null,
    correspondencia: Boolean(a?.mail),
  };
}
function conjuge(s: any) {
  if (!s || typeof s !== "object") return null;
  return { nome: txt(s.name), cpf: formatarDocumento(s.cpf), rg: txt(s.numberIdentityCard), nascimento: data(s.birthDate), profissao: txt(s.profession), email: txt(s.email) };
}

export async function cadastroCliente(customerId: number) {
  const [c, contratos] = await Promise.all([sienge.getCustomer(customerId), contratosDoCliente(customerId).catch(() => [])]);
  if (!c?.id) throw new Error("Cliente não encontrado no Sienge.");
  return {
    id: c.id,
    nome: txt(c.name), nomeSocial: txt(c.socialName), tipoPessoa: PESSOA[String(c.personType ?? "").toUpperCase()] ?? txt(c.personType),
    cpfCnpj: formatarDocumento(c.cpf ?? c.cnpj), rg: txt(c.numberIdentityCard), rgOrgao: txt(c.issuingBody), rgEmissao: data(c.issueDateIdentityCard),
    estrangeiro: String(c.foreigner ?? "").toUpperCase() === "S" || c.foreigner === true, documentoInternacional: txt(c.internationalId),
    nascimento: data(c.birthDate), naturalidade: txt(c.birthPlace), nacionalidade: txt(c.nationality), sexo: SEXO[String(c.sex ?? "").toUpperCase()] ?? txt(c.sex),
    estadoCivil: txt(c.civilStatus?.description ?? c.civilStatus?.name ?? c.civilStatus), regimeBens: txt(c.matrimonialRegime), dataCasamento: data(c.marriageDate),
    profissao: txt(c.profession?.description ?? c.profession?.name ?? c.profession), pai: txt(c.fatherName), mae: txt(c.motherName),
    email: txt(c.email), telefones: (Array.isArray(c.phones) ? c.phones : []).map(telefone),
    enderecos: (Array.isArray(c.addresses) ? c.addresses : []).map(endereco),
    conjuge: conjuge(c.spouse),
    procuradores: Array.isArray(c.procurators) ? c.procurators.length : 0,
    contratos: contratos.map((k) => ({ numero: k.numero, empreendimento: k.empreendimento, unidades: k.unidades, situacao: k.situacao })),
    criadoEm: data(c.createdAt), atualizadoEm: data(c.modifiedAt),
  };
}
export type CadastroCliente = Awaited<ReturnType<typeof cadastroCliente>>;

// Busca por CPF/CNPJ (11 ou 14 dígitos) direto no Sienge.
export async function buscarPorDocumento(q: string) {
  const d = soDig(q);
  if (d.length !== 11 && d.length !== 14) return null;
  const c = await sienge.searchCustomerByCpf(d).catch(() => null);
  if (!c?.id) return [];
  const contratos = await contratosDoCliente(Number(c.id)).catch(() => []);
  return [{ customerId: Number(c.id), nome: String(c.name ?? "").trim(), contratos }];
}
