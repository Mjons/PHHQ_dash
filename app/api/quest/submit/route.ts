import { NextResponse } from "next/server";
import { put, del } from "@vercel/blob";
import { auth } from "@/auth";
import {
  deleteSubmission,
  isWalletAddress,
  recordSubmission,
} from "@/lib/submissions";

// Creator Quest Q5 "Make Your Mark" — the WRITE. Called by the /submit page
// when a player uploads their comic. Mirrors app/api/pieces/upload but is
// deliberately ANONYMOUS: players are not curators, so there's no auth() gate.
// This is trust-on-write per the contract — the only stake is an unearned
// wearable, and the wallet is supplied by the player (from the ?wallet= query
// the scene opened the page with).

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart form" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  const wallet = String(form.get("wallet") || "").trim();
  const dclName = String(form.get("dclName") || "")
    .trim()
    .slice(0, 120);

  if (!isWalletAddress(wallet)) {
    return NextResponse.json(
      { error: "`wallet` must be a 0x-prefixed 40-hex address" },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "`file` field is required" },
      { status: 400 },
    );
  }
  const ext = EXT[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: `unsupported image type: ${file.type || "unknown"}` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `file too large (${(file.size / 1024 / 1024).toFixed(1)}MB > 8MB)`,
      },
      { status: 400 },
    );
  }

  // One blob per wallet — a re-submission overwrites in place. The URL is
  // stable, so the review page never accumulates orphans for a given player.
  // 1-year cache is fine: the curator reviews via a fresh URL each upload only
  // if the slug changed, but here we want overwrite semantics, so the cache
  // window just bounds repeat-view egress on an essentially immutable image.
  const path = `submissions/${wallet.toLowerCase()}.${ext}`;
  const blob = await put(path, file, {
    access: "public",
    contentType: file.type,
    allowOverwrite: true,
    cacheControlMaxAge: 31536000,
  });

  await recordSubmission({ wallet, comicUrl: blob.url, dclName });

  return NextResponse.json({ ok: true, url: blob.url });
}

// CURATOR-ONLY: remove a submission so the scene's poll reads makeYourMark:false
// again and the player has to redo Q5 (useful for testing). Unlike POST, this is
// NOT in the proxy.ts public allowlist (only POST /api/quest/submit is), so the
// edge gate already requires a session; we re-check here as defense in depth.
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const wallet = new URL(req.url).searchParams.get("wallet")?.trim() ?? "";
  if (!isWalletAddress(wallet)) {
    return NextResponse.json(
      { error: "`wallet` query param must be a 0x-prefixed 40-hex address" },
      { status: 400 },
    );
  }

  const comicUrl = await deleteSubmission(wallet);
  // Best-effort blob cleanup — don't fail the request if the blob is already
  // gone. The Redis state is what the scene reads, so that's the source of truth.
  if (comicUrl) {
    try {
      await del(comicUrl);
    } catch {
      // Orphaned blob will be caught by the /admin/blob-orphans tool.
    }
  }

  return NextResponse.json({ ok: true, deleted: wallet });
}
