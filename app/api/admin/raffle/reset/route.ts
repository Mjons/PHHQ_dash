import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resetWon } from "@/lib/raffle";

// Operator-only — clear the `won` flag on every entrant so the full pool is
// eligible to be drawn again. Keeps the entrants (and verified/team flags) and
// the draw audit history. Gated by the curator session.

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const cleared = await resetWon();
  return NextResponse.json({ ok: true, cleared });
}
