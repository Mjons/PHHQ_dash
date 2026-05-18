import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { redis, MANIFEST_KEY } from "@/lib/redis";
import { CaptureImport, type ManifestT } from "@/schema/manifest";
import { SEED_MANIFEST } from "@/lib/seed";

export const dynamic = "force-dynamic";

// Accepts capture JSON from the in-scene anchor capture tool, merges into the live manifest.
// New IDs are added; existing IDs have their POSITION/AREA/FACING/SIZE updated,
// but curator-set fields (pieceId, note, allowedFrames) are preserved.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const parsed = CaptureImport.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues.slice(0, 10) },
      { status: 422 },
    );
  }

  const existing = (await redis.get<ManifestT>(MANIFEST_KEY)) ?? SEED_MANIFEST;
  const byId = new Map(existing.anchors.map((a) => [a.id, a]));
  let added = 0;
  let updated = 0;

  for (const incoming of parsed.data.anchors) {
    const cur = byId.get(incoming.id);
    if (cur) {
      byId.set(incoming.id, {
        ...incoming,
        pieceId: cur.pieceId,
        note: cur.note || incoming.note,
        allowedFrames: cur.allowedFrames || incoming.allowedFrames,
      });
      updated++;
    } else {
      byId.set(incoming.id, incoming);
      added++;
    }
  }

  const next: ManifestT = {
    ...existing,
    version: existing.version + 1,
    updatedAt: new Date().toISOString(),
    anchors: Array.from(byId.values()),
  };
  await redis.set(MANIFEST_KEY, next);

  return NextResponse.json({
    ok: true,
    added,
    updated,
    total: next.anchors.length,
    version: next.version,
  });
}
