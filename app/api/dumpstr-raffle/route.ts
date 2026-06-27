import { NextResponse } from "next/server";
import { addEntry, isSolanaAddress, isLikelyXPostUrl } from "@/lib/raffle";

// Public write — a player enters the DUMPSTR raffle by dropping their Solana
// payout address plus the link to their X post (meme tagging @panelhaus +
// #smudgethesponge). Trust-on-write: the only stake is a raffle slot, and the
// operator verifies the post before drawing. We dedupe on the SOL address, so
// re-submitting is harmless. Allowlisted in proxy.ts.
//
// Body: { solWallet: string, postUrl: string, ethWallet?: string }

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { solWallet?: unknown; postUrl?: unknown; ethWallet?: unknown } =
    {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const sol = typeof body.solWallet === "string" ? body.solWallet.trim() : "";
  if (!isSolanaAddress(sol)) {
    return NextResponse.json(
      {
        error:
          "That doesn't look like a Solana address. Paste your SOL wallet (not an ETH 0x… address).",
      },
      { status: 400 },
    );
  }

  const post = typeof body.postUrl === "string" ? body.postUrl.trim() : "";
  if (!isLikelyXPostUrl(post)) {
    return NextResponse.json(
      {
        error:
          "Paste the link to your X post (e.g. https://x.com/you/status/…) tagging @panelhaus + #smudgethesponge.",
      },
      { status: 400 },
    );
  }

  const eth =
    typeof body.ethWallet === "string" && body.ethWallet.trim()
      ? body.ethWallet.trim()
      : null;

  const isNew = await addEntry(sol, post, eth);
  return NextResponse.json(
    { ok: true, isNew },
    { headers: { "cache-control": "private, no-store" } },
  );
}
