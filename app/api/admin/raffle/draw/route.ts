import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { drawWinners } from "@/lib/raffle";

// Operator-only — draw N winners from the DUMPSTR raffle pool. Gated by the
// curator session (proxy.ts gates /api/admin/*; we re-check here in Node).
// The draw is seeded and recorded so it can be reproduced/verified later.
//
// Body: { n?: number, verifiedOnly?: boolean }
//   n defaults to 1 — we just need one address for Henry.
//   verifiedOnly limits the pool to entrants whose post the operator confirmed.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  let body: { n?: unknown; verifiedOnly?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // Empty body is fine — default to a single winner from all entrants.
  }
  const n =
    typeof body.n === "number" && Number.isFinite(body.n)
      ? Math.floor(body.n)
      : 1;
  const verifiedOnly = body.verifiedOnly === true;

  const draw = await drawWinners(n, verifiedOnly);
  if (draw.entrantCount === 0) {
    return NextResponse.json(
      {
        error: verifiedOnly
          ? "No verified entrants yet — nothing to draw."
          : "No entrants yet — nothing to draw.",
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ draw });
}
