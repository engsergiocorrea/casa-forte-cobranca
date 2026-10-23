import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { sienge } from "@/lib/sienge/client";

// Exceções da régua v2 (PausaRegua). Bearer CRON_SECRET.
//   GET                → pausas ativas
//   POST {contrato, escopo?, tipos?, ate?, motivo}
//        escopo "cliente" (padrão) = todas as parcelas do cliente desse contrato;
//        escopo "contrato" = só o título desse contrato.
//        tipos: "TODOS" (padrão) ou "BOLETO,LEMBRETE_D0,COBRANCA"; ate: yyyy-mm-dd (opcional)
//        (também aceita customerId/billId direto, sem contrato)
//   DELETE ?id=...     → remove (lógico)
export const dynamic = "force-dynamic";

const autorizado = (req: NextRequest) => req.headers.get("authorization") === `Bearer ${env().CRON_SECRET}`;
const TIPOS_OK = ["TODOS", "BOLETO", "LEMBRETE_D0", "COBRANCA"];

async function contratoNoSienge(numero: string) {
  const alvo = numero.trim().toUpperCase();
  for (let off = 0; off < 1000; off += 200) {
    const raw = await sienge.listSalesContracts(200, off);
    const page = (Array.isArray(raw) ? raw : (raw?.results ?? raw?.data ?? [])) as any[];
    const c = page.find((x) => String(x?.number ?? "").trim().toUpperCase() === alvo);
    if (c) {
      const cli = (Array.isArray(c?.salesContractCustomers) ? c.salesContractCustomers : [])[0];
      return { billId: Number(c?.receivableBillId) || null, customerId: Number(cli?.id ?? cli?.customerId) || null, clienteNome: cli?.name ?? null, contrato: String(c.number) };
    }
    if (page.length < 200) break;
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return new NextResponse("unauthorized", { status: 401 });
  const rows = await db.pausaRegua.findMany({ where: { removidaEm: null }, orderBy: { criadaEm: "desc" } });
  return NextResponse.json(rows.map((r) => ({ id: r.id, contrato: r.contrato, cliente: r.clienteNome, customerId: r.customerId, billId: r.billId, tipos: r.tipos, ate: r.ate?.toISOString().slice(0, 10) ?? null, motivo: r.motivo, criadoPor: r.criadoPor, criadaEm: r.criadaEm })));
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return new NextResponse("unauthorized", { status: 401 });
  const b: any = await req.json().catch(() => ({}));
  const motivo = String(b?.motivo ?? "").trim();
  if (!motivo) return NextResponse.json({ erro: "Informe o motivo." }, { status: 400 });
  const tipos = String(b?.tipos ?? "TODOS").split(",").map((t: string) => t.trim().toUpperCase()).filter(Boolean);
  if (!tipos.length || tipos.some((t: string) => !TIPOS_OK.includes(t))) return NextResponse.json({ erro: `tipos deve ser ${TIPOS_OK.join(" | ")}` }, { status: 400 });
  const ate = b?.ate ? String(b.ate) : null;
  if (ate && !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return NextResponse.json({ erro: "ate deve ser yyyy-mm-dd" }, { status: 400 });

  let customerId: number | null = Number(b?.customerId) || null, billId: number | null = Number(b?.billId) || null;
  let contrato: string | null = null, clienteNome: string | null = null;
  if (b?.contrato) {
    const c = await contratoNoSienge(String(b.contrato));
    if (!c) return NextResponse.json({ erro: `Contrato ${b.contrato} não encontrado no Sienge.` }, { status: 404 });
    contrato = c.contrato; clienteNome = c.clienteNome;
    if ((b?.escopo ?? "cliente") === "contrato") { billId = c.billId; customerId = null; } else { customerId = c.customerId; billId = null; }
  }
  if (!customerId && !billId) return NextResponse.json({ erro: "Informe contrato (ou customerId/billId)." }, { status: 400 });

  const p = await db.pausaRegua.create({ data: { customerId, billId, contrato, clienteNome, tipos: tipos.join(","), ate: ate ? new Date(`${ate}T12:00:00Z`) : null, motivo, criadoPor: String(b?.criadoPor ?? "manual") } });
  return NextResponse.json({ ok: true, id: p.id, escopo: customerId ? "cliente" : "contrato", contrato, cliente: clienteNome, customerId, billId, tipos: p.tipos, ate });
}

export async function DELETE(req: NextRequest) {
  if (!autorizado(req)) return new NextResponse("unauthorized", { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ erro: "Informe ?id=" }, { status: 400 });
  const u = await db.pausaRegua.updateMany({ where: { id, removidaEm: null }, data: { removidaEm: new Date() } });
  return NextResponse.json({ ok: u.count === 1 });
}
