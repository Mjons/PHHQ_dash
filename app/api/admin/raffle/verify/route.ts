import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { setVerified } from "@/lib/raffle";

// Operator-only — mark an entrant's X post as verified (tags @panelhaus +
// #smudgethesponge confirmed) or un-verify it. Gated by the curator session.
//
// Body: { solWallet: string, verified: boolean }

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  let body: { solWallet?: unknown; verified?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const sol = typeof body.solWallet === "string" ? body.solWallet.trim() : "";
  if (!sol) {
    return NextResponse.json({ error: "Missing solWallet." }, { status: 400 });
  }
  const verified = body.verified === true;

  await setVerified(sol, verified);
  return NextResponse.json({ ok: true, solWallet: sol, verified });
}
