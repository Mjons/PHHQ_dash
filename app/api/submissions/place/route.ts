import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSubmission, isWalletAddress } from "@/lib/submissions";
import { placeSubmission } from "@/lib/submission-placement";

// Curator-only manual placement — the "Place on wall" button on the submissions
// page. Same effect as auto-mode, but triggered by the curator for one
// submission at a time.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const wallet = String(
    (body as { wallet?: unknown } | null)?.wallet ?? "",
  ).trim();
  if (!isWalletAddress(wallet)) {
    return NextResponse.json(
      { error: "`wallet` must be a 0x-prefixed 40-hex address" },
      { status: 400 },
    );
  }

  const sub = await getSubmission(wallet);
  if (!sub || !sub.comicUrl) {
    return NextResponse.json(
      { error: "no submission found for that wallet" },
      { status: 404 },
    );
  }

  const result = await placeSubmission({
    wallet,
    comicUrl: sub.comicUrl,
    dclName: sub.dclName,
  });
  if (!result.placed) {
    return NextResponse.json(
      {
        error:
          "no gallery-wall anchors found — tag the collage anchors with the submission-wall tag (re-import the F1 east-wall capture) first",
      },
      { status: 409 },
    );
  }

  return NextResponse.json(result);
}
