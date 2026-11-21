import { NextRequest, NextResponse } from "next/server";
import { SESSAO_COOKIE } from "@/lib/painel/sessao";
import { SSO_COOKIE, SSO_DOMINIO, ehDominioCasaForte, sairSso } from "@/lib/painel/sso";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  await sairSso(req.cookies);
  const res = NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  res.cookies.set(SESSAO_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  // Apaga a sessão compartilhada (todos os sistemas Casa Forte).
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (ehDominioCasaForte(host)) {
    for (const c of req.cookies.getAll()) {
      if (c.name === SSO_COOKIE || /^cf-sso\.\d+$/.test(c.name)) res.cookies.set(c.name, "", { domain: SSO_DOMINIO, path: "/", maxAge: 0, secure: true, sameSite: "lax" });
    }
  }
  return res;
}
