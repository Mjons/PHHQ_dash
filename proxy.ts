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
//  - POST /api/manifest/skip is anonymous (the scene's DJ booth posts to it
//    to advance the playlist; v1 trusts any visitor — see route.ts comment).
//  - GET /api/tips is anonymous (the scene + tip page poll it without auth).
//  - GET /api/qr/* serves PNG QR codes used by the scene and tip page.
//  - POST /api/tips/webhook is the Alchemy callback (verified by signature,
//    not by session cookie — see app/api/tips/webhook/route.ts).
//  - /tip/* is the public mobile tip page (visitors arrive without auth).
//  - GET /api/quest-status is the Creator Quest read-back the DCL scene polls
//    via signedFetch (identity from the auth-chain header, not a session); its
//    OPTIONS preflight must also pass.
//  - POST /api/quest/submit is the anonymous comic-upload write (trust-on-write
//    per the Creator Quest contract — the only stake is an unearned wearable).
//  - /submit is the public Creator Quest submission page (players arrive without auth).
//  - /admin/submissions is the public Creator Quest gallery — deliberately the
//    one /admin path that is NOT password-gated.
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
  const isPublicMusicSkip =
    req.method === "POST" && pathname === "/api/manifest/skip";
  const isPublicTipsRead = req.method === "GET" && pathname === "/api/tips";
  const isPublicQr = req.method === "GET" && pathname.startsWith("/api/qr/");
  const isPublicTipPage = pathname.startsWith("/tip/");
  const isTipWebhook =
    req.method === "POST" && pathname === "/api/tips/webhook";
  const isQuestStatusRead =
    (req.method === "GET" || req.method === "OPTIONS") &&
    pathname === "/api/quest-status";
  const isQuestSubmit =
    req.method === "POST" && pathname === "/api/quest/submit";
  // Q6 "The Commute" prize codes. issue/status are signedFetch endpoints the
  // scene calls (identity from the auth-chain header, not a session) — OPTIONS
  // preflight must pass too. redeem is the same-origin POST from the /submit page.
  const isRewardIssue =
    (req.method === "POST" || req.method === "OPTIONS") &&
    pathname === "/api/reward/issue";
  const isRewardStatus =
    (req.method === "GET" || req.method === "OPTIONS") &&
    pathname === "/api/reward/status";
  const isRewardRedeem =
    (req.method === "POST" || req.method === "OPTIONS") &&
    pathname === "/api/reward/redeem";
  const isSubmitPage = pathname === "/submit";
  // The Creator Quest submissions gallery is intentionally PUBLIC (no curator
  // password), unlike the rest of /admin. It exposes submitter wallets, DCL
  // names, and comic images by design.
  const isSubmissionsPage = pathname === "/admin/submissions";

  if (
    isAuthRoute ||
    isLogin ||
    isPublicManifestRead ||
    isPublicMusicSkip ||
    isPublicTipsRead ||
    isPublicQr ||
    isPublicTipPage ||
    isTipWebhook ||
    isQuestStatusRead ||
    isQuestSubmit ||
    isRewardIssue ||
    isRewardStatus ||
    isRewardRedeem ||
    isSubmitPage ||
    isSubmissionsPage
  ) {
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
