import type { ItemPlano, TipoRegua } from "./planejar";

// Aplica as exceções da régua (tabela PausaRegua) ao plano do dia. PURO.
// Uma pausa casa com o item se for do mesmo cliente (customerId) ou do mesmo
// título (billId), cobrir o tipo (ou TODOS) e estar vigente em `hoje`.

export type Pausa = {
  id: string; customerId: number | null; billId: number | null;
  tipos: string; ate: string | null; // yyyy-mm-dd
  motivo: string;
};

export function pausaCobre(p: Pausa, item: Pick<ItemPlano, "clientId" | "billId" | "tipo">, hoje: string): boolean {
  if (p.ate && p.ate < hoje) return false;
  const alvo = (p.customerId != null && p.customerId === item.clientId) || (p.billId != null && p.billId === item.billId);
  if (!alvo) return false;
  const tipos = p.tipos.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  return tipos.includes("TODOS") || tipos.includes(item.tipo as TipoRegua);
}

export function aplicarPausas(itens: ItemPlano[], pausas: Pausa[], hoje: string) {
  const liberados: ItemPlano[] = [];
  const pausados: { item: ItemPlano; pausa: Pausa }[] = [];
  for (const item of itens) {
    const p = pausas.find((x) => pausaCobre(x, item, hoje));
    if (p) pausados.push({ item, pausa: p }); else liberados.push(item);
  }
  return { liberados, pausados };
}
