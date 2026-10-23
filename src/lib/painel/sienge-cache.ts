import { sienge } from "../sienge/client";

// Contratos do Sienge (REST, sem limite diário) com cache curto em memória —
// a busca do painel não precisa ir ao Sienge a cada tecla.

export type ContratoResumo = {
  numero: string; empreendimento: string; unidades: string[]; situacao: string;
  billId: number | null; clientes: { id: number; nome: string }[];
};

let cache: { em: number; dados: ContratoResumo[] } | null = null;
const TTL = 5 * 60 * 1000;

export async function contratos(forcar = false): Promise<ContratoResumo[]> {
  if (!forcar && cache && Date.now() - cache.em < TTL) return cache.dados;
  const todos: any[] = [];
  for (let off = 0; off < 2000; off += 200) {
    const raw = await sienge.listSalesContracts(200, off);
    const page = (Array.isArray(raw) ? raw : (raw?.results ?? raw?.data ?? [])) as any[];
    todos.push(...page);
    if (page.length < 200) break;
  }
  const dados = todos.map((c): ContratoResumo => ({
    numero: String(c?.number ?? "").trim(),
    empreendimento: String(c?.enterpriseName ?? "").trim(),
    unidades: (Array.isArray(c?.salesContractUnits) ? c.salesContractUnits : []).map((u: any) => String(u?.name ?? "").trim()).filter(Boolean),
    situacao: String(c?.situation ?? ""),
    billId: Number(c?.receivableBillId) || null,
    clientes: (Array.isArray(c?.salesContractCustomers) ? c.salesContractCustomers : [])
      .map((x: any) => ({ id: Number(x?.id ?? x?.customerId), nome: String(x?.name ?? "").trim() })).filter((x: any) => x.id),
  }));
  cache = { em: Date.now(), dados };
  return dados;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Busca por nome do cliente, nº do contrato ou unidade. Agrupa por cliente.
export async function buscarClientes(q: string) {
  const termo = norm(q.trim());
  if (termo.length < 2) return [];
  const porCliente = new Map<number, { customerId: number; nome: string; contratos: ContratoResumo[] }>();
  for (const c of await contratos()) {
    const casa = norm(c.numero).includes(termo) || c.unidades.some((u) => norm(u).includes(termo)) || c.clientes.some((x) => norm(x.nome).includes(termo));
    if (!casa) continue;
    for (const cli of c.clientes.slice(0, 1)) { // titular
      const g = porCliente.get(cli.id) ?? { customerId: cli.id, nome: cli.nome, contratos: [] };
      g.contratos.push(c);
      porCliente.set(cli.id, g);
    }
  }
  return [...porCliente.values()].sort((a, b) => a.nome.localeCompare(b.nome)).slice(0, 30);
}

export async function contratosDoCliente(customerId: number) {
  return (await contratos()).filter((c) => c.clientes[0]?.id === customerId);
}
