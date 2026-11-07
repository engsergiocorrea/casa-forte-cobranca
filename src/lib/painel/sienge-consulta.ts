import { sienge } from "../sienge/client";
import { contratos } from "./sienge-cache";

// Consultas de LEITURA ao Sienge (REST, sem limite diário) para o painel e o
// Brain. Só recursos liberados ao usuário da API (testado em 07/11/2026):
// obras, unidades, contas bancárias, centros de custo. Contas a pagar,
// credores, pedidos de compra e empresas respondem 403 (sem permissão).

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Códigos de estoque comercial do Sienge; os não listados saem como "código X".
const ESTOQUE: Record<string, string> = { D: "Disponível", V: "Vendida", R: "Reservada", L: "Locada" };

// O Sienge às vezes demora 10–30 s na 1ª leitura: cache de 10 min por recurso.
const memo = new Map<string, { em: number; dados: any[] }>();
async function todos(recurso: Parameters<typeof sienge.listar>[0]) {
  const c = memo.get(recurso);
  if (c && Date.now() - c.em < 10 * 60 * 1000) return c.dados;
  const out: any[] = [];
  for (let off = 0; off < 5000; off += 200) {
    const raw = await sienge.listar(recurso, 200, off);
    const page = (Array.isArray(raw) ? raw : (raw?.results ?? [])) as any[];
    out.push(...page);
    if (page.length < 200) break;
  }
  memo.set(recurso, { em: Date.now(), dados: out });
  return out;
}

export async function consultaSienge(recurso: string, f: { obra?: string; situacao?: string } = {}) {
  if (recurso === "obras") {
    const [obras, cs] = await Promise.all([todos("enterprises"), contratos()]);
    return obras.map((o) => ({
      id: o.id, nome: String(o.name ?? "").trim(), nomeComercial: String(o.commercialName ?? "").trim(), cnpj: o.cnpj ?? null,
      empresa: String(o.companyName ?? "").trim(), endereco: String(o.adress ?? "").trim(), tipo: String(o.buildingTypeDescription ?? "").trim(),
      contratosDeVenda: cs.filter((c) => norm(c.empreendimento) === norm(String(o.name ?? ""))).length,
    }));
  }
  if (recurso === "unidades") {
    const [us, obras] = await Promise.all([todos("units"), todos("enterprises")]);
    const nomeObra = new Map(obras.map((o) => [o.id, String(o.name ?? "").trim()]));
    let lista = us.map((u) => ({
      obra: nomeObra.get(u.enterpriseId) ?? String(u.enterpriseId), unidade: String(u.name ?? "").trim(), tipo: String(u.propertyType ?? "").trim(),
      situacao: ESTOQUE[String(u.commercialStock)] ?? `código ${u.commercialStock ?? "?"}`, contrato: String(u.contractNumber ?? "").trim() || null,
      areaPrivativa: u.privateArea ?? null, pavimento: String(u.floor ?? "").trim() || null, entregaPrevista: u.scheduledDeliveryDate ?? null,
    }));
    if (f.obra) lista = lista.filter((u) => norm(u.obra).includes(norm(f.obra!)));
    if (f.situacao) lista = lista.filter((u) => norm(u.situacao).startsWith(norm(f.situacao!)));
    const porSituacao: Record<string, number> = {};
    for (const u of lista) porSituacao[u.situacao] = (porSituacao[u.situacao] ?? 0) + 1;
    return { total: lista.length, porSituacao, unidades: lista.slice(0, 200) };
  }
  if (recurso === "contas-bancarias") {
    return (await todos("checking-accounts")).map((c) => ({
      banco: String(c.bankName ?? "").trim(), agencia: c.agencyNumber, conta: c.accountNumber, nome: String(c.accountName ?? "").trim(),
      tipo: c.accountType?.description ?? c.accountType?.name ?? null, empresa: String(c.companyName ?? "").trim(), situacao: c.accountStatus,
    }));
  }
  if (recurso === "centros-de-custo") {
    return (await todos("cost-centers")).map((c) => ({ id: c.id, nome: String(c.name ?? c.description ?? "").trim() }));
  }
  throw new Error("Recurso não liberado. Use: obras, unidades, contas-bancarias, centros-de-custo.");
}
