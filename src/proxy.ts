import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only: no session cookie → send to login.
 * Real checks (valid session, permissions) happen on the server in every page and action.
 */
// The WhatsApp webhook is called by Meta (no cookie); it checks its own signature. Health is for uptime monitors.
const PUBLIC_PATHS = ["/login", "/api/whatsapp", "/api/health"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Parent portal: its own cookie and sign-in page; staff cookies don't apply.
  if (pathname === "/parent" || pathname.startsWith("/parent/")) {
    if (pathname === "/parent/login" || request.cookies.has("mei_parent")) return NextResponse.next();
    return NextResponse.redirect(new URL("/parent/login", request.url));
  }
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (request.cookies.has("mei_session")) return NextResponse.next();
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webp)$).*)"],
};
