import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optimistic auth gate that runs at Edge.
//
// We deliberately do NOT import `auth` from "@/auth" here — NextAuth v5's full
// config pulls in the Credentials provider, which uses Node-only crypto and
// silently kills the proxy in Edge runtime. Instead we just check for the
// presence of the session cookie. Real verification happens in route handlers
// and server components, where `auth()` runs in Node and can decode the JWT.
//
// Public routes:
//  - GET /api/manifest is anonymous (the scene fetches it without auth).
//  - /api/auth/* are NextAuth's own handlers.
//  - /login renders the sign-in form.
//
// Auth.js cookie names:
//  - Production (HTTPS): `__Secure-authjs.session-token`
//  - Dev (HTTP):         `authjs.session-token`
export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAuthRoute = pathname.startsWith("/api/auth");
  const isLogin = pathname === "/login";
  const isPublicManifestRead =
    req.method === "GET" && pathname === "/api/manifest";

  if (isAuthRoute || isLogin || isPublicManifestRead) {
    return NextResponse.next();
  }

  const hasSession =
    req.cookies.has("__Secure-authjs.session-token") ||
    req.cookies.has("authjs.session-token");

  if (!hasSession) {
    if (pathname.startsWith("/api/")) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
