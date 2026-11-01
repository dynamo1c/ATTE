import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only: no session cookie → send to login.
 * Real checks (valid session, permissions) happen on the server in every page and action.
 */
// The WhatsApp webhook is called by Meta (no cookie); it checks its own signature.
const PUBLIC_PATHS = ["/login", "/api/whatsapp"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (request.cookies.has("mei_session")) return NextResponse.next();
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webp)$).*)"],
};
