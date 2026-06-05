import { NextResponse } from "next/server";
import { redeemCode } from "@/lib/rewards";

// Claim a prize code. Called by the /submit page (same-origin browser fetch)
// when a player opens it with ?code=. By code alone — the code is the secret,
// one-time use. The scene's status poll then sees redeemed:true and completes
// Q6 (+ fires the confetti cascade).
//
// Body: { code }. Response: { ok, quest } | { ok:false, reason }.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { code?: string } = {};
  try {
    body = (await req.json()) as { code?: string };
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }

  const code =
    typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) {
    return NextResponse.json({ error: "`code` is required" }, { status: 400 });
  }

  const result = await redeemCode(code);
  if (!result.ok) {
    const status = result.reason === "not-found" ? 404 : 409;
    return NextResponse.json({ ok: false, reason: result.reason }, { status });
  }

  return NextResponse.json({ ok: true, quest: result.quest });
}
