import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { setEntryFlag, ENTRY_FLAGS, type EntryFlag } from "@/lib/raffle";

// Operator-only — toggle a flag on an entrant. Gated by the curator session.
//   verified — post confirmed (tags @panelhaus + #smudgethesponge)
//   won      — already won a draw; excluded from future draws
//   team     — team / internal; never eligible
//
// Body: { solWallet: string, flag: "verified" | "won" | "team", value: boolean }

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  let body: { solWallet?: unknown; flag?: unknown; value?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const sol = typeof body.solWallet === "string" ? body.solWallet.trim() : "";
  if (!sol) {
    return NextResponse.json({ error: "Missing solWallet." }, { status: 400 });
  }
  if (!ENTRY_FLAGS.includes(body.flag as EntryFlag)) {
    return NextResponse.json({ error: "Unknown flag." }, { status: 400 });
  }
  const flag = body.flag as EntryFlag;
  const value = body.value === true;

  await setEntryFlag(sol, flag, value);
  return NextResponse.json({ ok: true, solWallet: sol, flag, value });
}
