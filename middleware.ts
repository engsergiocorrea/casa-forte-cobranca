import { NextRequest, NextResponse } from "next/server";
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path.startsWith("/api/webhooks/") || path === "/api/health") return NextResponse.next();
  const user = process.env.DASHBOARD_BASIC_USER;
  const pass = process.env.DASHBOARD_BASIC_PASS;
  if (!user || !pass) return NextResponse.next();
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    const [u,p] = atob(auth.slice(6)).split(":");
    if (u === user && p === pass) return NextResponse.next();
  }
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Casa Forte"' } });
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
