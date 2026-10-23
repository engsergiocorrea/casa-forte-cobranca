import { NextRequest, NextResponse } from "next/server";

// O painel usa o Basic Auth do site (middleware). Aqui: (1) nunca funcionar
// sem senha configurada; (2) descobrir QUEM está usando, para a auditoria.
export function usuarioPainel(req: NextRequest): { usuario: string } | { erro: NextResponse } {
  const user = process.env.DASHBOARD_BASIC_USER, pass = process.env.DASHBOARD_BASIC_PASS;
  if (!user || !pass) return { erro: NextResponse.json({ erro: "Painel sem senha: defina DASHBOARD_BASIC_USER e DASHBOARD_BASIC_PASS no Railway." }, { status: 403 }) };
  const h = req.headers.get("authorization") ?? "";
  let u = "";
  try { if (h.startsWith("Basic ")) u = atob(h.slice(6)).split(":")[0]; } catch { /* ignora */ }
  return { usuario: u || "painel" };
}
