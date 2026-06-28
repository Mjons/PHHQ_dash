import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { addEntriesBatch } from "@/lib/raffle";

// Operator-only — bulk-add a batch of SOL addresses to the raffle (collected
// off-platform). Gated by the curator session. Validates + dedupes each.
//
// Body: { text: string, verified?: boolean }
//   text — addresses separated by newlines, commas, or whitespace.
//   verified — mark the batch as operator-vouched (default true).

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  let body: { text?: unknown; verified?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text : "";
  const addresses = text.split(/[\s,]+/).filter(Boolean);
  if (addresses.length === 0) {
    return NextResponse.json(
      { error: "Paste at least one address." },
      { status: 400 },
    );
  }
  const verified = body.verified !== false; // default true

  const result = await addEntriesBatch(addresses, verified);
  return NextResponse.json({ result });
}
