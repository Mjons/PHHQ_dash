import { NextResponse } from "next/server";
import { readAllTipState } from "@/lib/tips";

// Public read — the scene polls this on its own cadence (~15s) to learn
// which VT floors are currently in "gold override" state and to display
// running tip totals on the in-scene pedestal overlays.
//
// Kept SEPARATE from /api/manifest deliberately. See VAULT_TIPPING_PLAN.md
// §"Storage split" for why tip mutations don't bump manifest version.

export const dynamic = "force-dynamic";

export async function GET() {
  const tips = await readAllTipState();
  return NextResponse.json(
    { tips },
    {
      headers: {
        // Short cache: tip state is mutated by webhooks at on-chain cadence,
        // so a 15s lag between tx confirmation and visible state is fine.
        "cache-control": "public, max-age=15, stale-while-revalidate=30",
        "access-control-allow-origin": "*",
      },
    },
  );
}
