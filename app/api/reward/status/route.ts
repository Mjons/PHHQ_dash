import { NextResponse } from "next/server";
import { getStatus } from "@/lib/rewards";
import { DCL_CORS_HEADERS, signerFromAuthChain } from "@/lib/dcl-identity";

// Read-back the scene polls (signedFetch) until the prize is claimed. Wallet is
// derived from the auth-chain header, so it returns THIS player's code + claim
// state only.
//
// Query: ?quest=the-commute. Response: { code: string | null, redeemed: boolean }.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const wallet = signerFromAuthChain(req);
  const quest = new URL(req.url).searchParams.get("quest") || "the-commute";

  const status = wallet
    ? await getStatus(wallet, quest)
    : { code: null, redeemed: false };

  return NextResponse.json(status, {
    headers: {
      // Per-wallet — never cache at a shared edge.
      "cache-control": "private, no-store",
      ...DCL_CORS_HEADERS,
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: DCL_CORS_HEADERS });
}
