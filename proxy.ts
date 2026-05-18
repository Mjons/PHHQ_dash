import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Auth gate:
//  - GET /api/manifest is public (the scene needs to fetch it without auth)
//  - /api/auth/* is the NextAuth handlers, must stay public
//  - /login is the login page
//  - Everything else (write APIs + dashboard UI) requires a session
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthRoute = pathname.startsWith("/api/auth");
  const isLogin = pathname === "/login";
  const isPublicManifestRead =
    req.method === "GET" && pathname === "/api/manifest";

  if (isAuthRoute || isLogin || isPublicManifestRead) {
    return NextResponse.next();
  }
  if (!req.auth) {
    if (pathname.startsWith("/api/")) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  // Match everything except Next internals, static files, and favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
