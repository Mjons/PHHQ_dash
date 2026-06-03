import { NextResponse } from "next/server";
import { hasSubmitted } from "@/lib/submissions";

// Creator Quest Q5 "Make Your Mark" — read-back endpoint the scene polls every
// ~15s via DCL `signedFetch` until the quest reads complete. See the
// CREATOR_QUEST contract doc.
//
// Response shape (field name must match QuestStatus.makeYourMark scene-side):
//   { "makeYourMark": boolean }
//
// Identity — IMPORTANT: the wallet is derived from the request, NEVER from a
// query param or body. `signedFetch` attaches the Decentraland auth-chain as
// `x-identity-auth-chain-N` headers; the first link (index 0) is the SIGNER,
// whose `payload` is the player's wallet address.
//
// We do NOT cryptographically verify the auth-chain signature. The contract
// calls the read "airtight via signed headers", but the only stake here is a
// low-value wearable, so we take the lowest-friction path (no @dcl/crypto
// dependency) and trust the SIGNER payload. A forged header could only read
// whether some wallet submitted a comic — a boolean that leaks nothing
// sensitive, and the write side is already trust-on-write. If the Resident
// badge ever gates real value, upgrade HERE: add `@dcl/crypto` and call
// `Authenticator.validateSignature` over the full auth-chain + timestamp before
// trusting `signer`.

export const dynamic = "force-dynamic";

// signedFetch sends custom x-identity-* headers, which are not CORS-safelisted,
// so the DCL runtime issues a preflight. Answer it (and echo the request's
// allowed headers) so the actual GET goes through.
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers":
    "x-identity-auth-chain-0, x-identity-auth-chain-1, x-identity-auth-chain-2, x-identity-timestamp, x-identity-metadata, content-type",
  "access-control-max-age": "86400",
};

// Extract the signer wallet from the DCL auth-chain header. Returns null when
// the header is absent or unparseable — the scene simply keeps polling, which
// is the correct degrade for a player who hasn't authed yet.
function signerFromAuthChain(req: Request): string | null {
  const raw = req.headers.get("x-identity-auth-chain-0");
  if (!raw) return null;
  try {
    const link = JSON.parse(raw);
    const payload = link?.payload;
    if (typeof payload === "string" && /^0x[0-9a-fA-F]{40}$/.test(payload)) {
      return payload;
    }
  } catch {
    // Malformed header — treat as unauthenticated.
  }
  return null;
}

export async function GET(req: Request) {
  const wallet = signerFromAuthChain(req);
  const makeYourMark = wallet ? await hasSubmitted(wallet) : false;

  return NextResponse.json(
    { makeYourMark },
    {
      headers: {
        // CRITICAL: this response is PER-WALLET. It must never be cached at a
        // shared edge/CDN, or one player's status would leak to another. Unlike
        // /api/manifest (shared body, max-age=10), this is private + no-store.
        "cache-control": "private, no-store",
        ...CORS_HEADERS,
      },
    },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
