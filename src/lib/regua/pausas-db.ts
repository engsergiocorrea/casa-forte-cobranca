import { db } from "../db";
import { contratos } from "../painel/sienge-cache";

// Criação/listagem/remoção de pausas (PausaRegua) — usado pela rota interna
// (/api/internal/regua/pausas) e pelo painel. Ver pausas.ts para a regra.

const TIPOS_OK = ["TODOS", "BOLETO", "LEMBRETE_D0", "COBRANCA"];

export type NovaPausa = { contrato?: string; escopo?: "cliente" | "contrato"; customerId?: number; billId?: number; tipos?: string; ate?: string | null; motivo: string; criadoPor?: string };

export async function listarPausas() {
  const rows = await db.pausaRegua.findMany({ where: { removidaEm: null }, orderBy: { criadaEm: "desc" } });
  return rows.map((r) => ({ id: r.id, contrato: r.contrato, cliente: r.clienteNome, customerId: r.customerId, billId: r.billId, tipos: r.tipos, ate: r.ate?.toISOString().slice(0, 10) ?? null, motivo: r.motivo, criadoPor: r.criadoPor, criadaEm: r.criadaEm }));
}

export async function criarPausa(b: NovaPausa): Promise<{ ok: true; [k: string]: any } | { ok: false; erro: string; status: number }> {
  const motivo = String(b?.motivo ?? "").trim();
  if (!motivo) return { ok: false, erro: "Informe o motivo.", status: 400 };
  const tipos = String(b?.tipos ?? "TODOS").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  if (!tipos.length || tipos.some((t) => !TIPOS_OK.includes(t))) return { ok: false, erro: `tipos deve ser ${TIPOS_OK.join(" | ")}`, status: 400 };
  const ate = b?.ate ? String(b.ate) : null;
  if (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return { ok: false, erro: "ate deve ser yyyy-mm-dd", status: 400 };

  let customerId: number | null = Number(b?.customerId) || null, billId: number | null = Number(b?.billId) || null;
  let contrato: string | null = null, clienteNome: string | null = null;
  if (b?.contrato) {
    const alvo = String(b.contrato).trim().toUpperCase();
    const c = (await contratos()).find((x) => x.numero.toUpperCase() === alvo);
    if (!c) return { ok: false, erro: `Contrato ${b.contrato} não encontrado no Sienge.`, status: 404 };
    contrato = c.numero; clienteNome = c.clientes[0]?.nome ?? null;
    if ((b?.escopo ?? "cliente") === "contrato") { billId = c.billId; customerId = null; } else { customerId = c.clientes[0]?.id ?? null; billId = null; }
  } else if (customerId) {
    const c = (await contratos()).find((x) => x.clientes[0]?.id === customerId);
    clienteNome = c?.clientes[0]?.nome ?? null; contrato = c?.numero ?? null;
  }
  if (!customerId && !billId) return { ok: false, erro: "Informe contrato (ou customerId/billId).", status: 400 };

  const p = await db.pausaRegua.create({ data: { customerId, billId, contrato, clienteNome, tipos: tipos.join(","), ate: ate ? new Date(`${ate}T12:00:00Z`) : null, motivo, criadoPor: String(b?.criadoPor ?? "manual") } });
  return { ok: true, id: p.id, escopo: customerId ? "cliente" : "contrato", contrato, cliente: clienteNome, customerId, billId, tipos: p.tipos, ate };
}

export async function removerPausa(id: string) {
  const u = await db.pausaRegua.updateMany({ where: { id, removidaEm: null }, data: { removidaEm: new Date() } });
  return u.count === 1;
}
