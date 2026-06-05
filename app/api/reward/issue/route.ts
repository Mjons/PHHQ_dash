import { NextResponse } from "next/server";
import { issueCode } from "@/lib/rewards";
import { DCL_CORS_HEADERS, signerFromAuthChain } from "@/lib/dcl-identity";

// Mint (or return the existing) per-player prize code. Called by the scene via
// signedFetch when Q6's witness cinematic finishes. The wallet is derived from
// the auth-chain header — NEVER the body — so a player only mints their own.
// Idempotent: repeat calls return the same code.
//
// Body: { quest?: string } (defaults to "the-commute"). Response: { code }.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const wallet = signerFromAuthChain(req);
  if (!wallet) {
    return NextResponse.json(
      { error: "unauthenticated" },
      { status: 401, headers: DCL_CORS_HEADERS },
    );
  }

  let body: { quest?: string } = {};
  try {
    body = (await req.json()) as { quest?: string };
  } catch {
    // Empty / non-JSON body is fine — fall back to the default quest.
  }
  const quest =
    typeof body.quest === "string" && body.quest.length > 0
      ? body.quest.slice(0, 64)
      : "the-commute";

  const code = await issueCode(wallet, quest);

  return NextResponse.json(
    { code },
    {
      headers: {
        // Per-wallet — never cache at a shared edge.
        "cache-control": "private, no-store",
        ...DCL_CORS_HEADERS,
      },
    },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: DCL_CORS_HEADERS });
}
