import { NextResponse } from "next/server";
import { addEntry, isSolanaAddress } from "@/lib/raffle";

// Public write — a player pastes their Solana payout address to enter the
// DUMPSTR raffle. Trust-on-write: the only stake is a raffle slot. We dedupe
// on the SOL address, so re-submitting is harmless. Allowlisted in proxy.ts.
//
// Body: { solWallet: string, ethWallet?: string }

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { solWallet?: unknown; ethWallet?: unknown } = {};
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

  const eth =
    typeof body.ethWallet === "string" && body.ethWallet.trim()
      ? body.ethWallet.trim()
      : null;

  const isNew = await addEntry(sol, eth);
  return NextResponse.json(
    { ok: true, isNew },
    { headers: { "cache-control": "private, no-store" } },
  );
}
