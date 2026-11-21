import { NextRequest, NextResponse } from "next/server";
import { SESSAO_COOKIE } from "@/lib/painel/sessao";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  res.cookies.set(SESSAO_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
