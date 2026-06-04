import { redis, MANIFEST_KEY } from "@/lib/redis";
import { Manifest, type ManifestT, type PieceT } from "@/schema/manifest";
import { SEED_MANIFEST } from "@/lib/seed";
import { aspectFromBytes } from "@/lib/image-size";
import {
  submissionPieceId,
  SUBMISSION_WALL_TAG,
  pushWallPlacement,
  popOldestWallPlacement,
} from "@/lib/submissions";

// Places a Q5 comic submission onto the gallery wall (anchors tagged
// SUBMISSION_WALL_TAG) and writes the manifest. Used by two callers:
//   - POST /api/quest/submit, when auto-mode is on (anonymous, fires on upload)
//   - POST /api/submissions/place, when the curator clicks "Place on wall"
//
// Both bypass the curator-gated /api/manifest POST on purpose: this is a bounded
// system action — it only ever writes a `submission`-tagged Piece into a
// pre-designated tagged anchor. It does its own read-modify-write of the Redis
// manifest, version-bumping like the manifest route does.
//
// Concurrency note: two simultaneous submissions race on the manifest
// read-modify-write and the later write wins. Acceptable at event volume; revisit
// with an Upstash lock if submissions ever arrive faster than ~1/s.

async function readManifest(): Promise<ManifestT> {
  const raw = await redis.get<unknown>(MANIFEST_KEY);
  return raw ? Manifest.parse(raw) : SEED_MANIFEST;
}

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Aspect from the caller's hint (the submit route already has the bytes), else
// fetch the blob and parse its header, else square.
async function resolveAspect(comicUrl: string, hint?: number): Promise<number> {
  if (hint && Number.isFinite(hint) && hint > 0) return Number(hint.toFixed(4));
  try {
    const res = await fetch(comicUrl);
    if (res.ok) {
      const a = aspectFromBytes(new Uint8Array(await res.arrayBuffer()));
      if (a) return a;
    }
  } catch {
    // fall through to square
  }
  return 1;
}

export type PlacementResult =
  | { placed: true; anchorId: string; evictedPieceId: string | null }
  | { placed: false; reason: "no-wall" };

export async function placeSubmission(args: {
  wallet: string;
  comicUrl: string;
  dclName?: string;
  aspect?: number;
}): Promise<PlacementResult> {
  const { wallet, comicUrl } = args;
  const dclName = args.dclName?.trim() || "";
  const pieceId = submissionPieceId(wallet);
  const aspect = await resolveAspect(comicUrl, args.aspect);

  const manifest = await readManifest();
  // References into manifest.anchors — mutating these mutates the manifest.
  const wallAnchors = manifest.anchors.filter((a) =>
    a.tags?.includes(SUBMISSION_WALL_TAG),
  );
  if (wallAnchors.length === 0) return { placed: false, reason: "no-wall" };

  const piece: PieceT = {
    id: pieceId,
    src: comicUrl,
    aspect,
    preferredFrame: "A", // anchor.allowedFrames (e.g. ["D"]) still constrains it
    title: dclName || `Resident ${shorten(wallet)}`,
    tags: ["resident-submission", SUBMISSION_WALL_TAG],
    batch: "submissions",
    ...(dclName ? { artist: dclName } : {}),
  };

  let evictedPieceId: string | null = null;
  let slot = wallAnchors.find((a) => a.pieceId === pieceId); // re-submission → same slot

  if (!slot) slot = wallAnchors.find((a) => a.pieceId === null); // next empty slot

  if (!slot) {
    // Wall full → FIFO: evict the oldest tracked placement still on the wall.
    let oldest = await popOldestWallPlacement();
    while (oldest && !wallAnchors.some((a) => a.pieceId === oldest)) {
      oldest = await popOldestWallPlacement(); // skip stale ids no longer placed
    }
    if (oldest) {
      slot = wallAnchors.find((a) => a.pieceId === oldest)!;
      delete manifest.pieces[oldest];
      evictedPieceId = oldest;
    } else {
      // Nothing tracked (e.g. wall pre-filled by a capture import before this
      // feature existed). Evict the first occupied anchor so the creator still
      // lands on the wall; subsequent rotations are proper FIFO once tracked.
      slot = wallAnchors[0];
      if (slot.pieceId) {
        delete manifest.pieces[slot.pieceId];
        evictedPieceId = slot.pieceId;
      }
    }
  }

  slot.pieceId = pieceId;
  manifest.pieces[pieceId] = piece;

  await redis.set(MANIFEST_KEY, {
    ...manifest,
    version: manifest.version + 1,
    updatedAt: new Date().toISOString(),
  });

  await pushWallPlacement(pieceId);
  return { placed: true, anchorId: slot.id, evictedPieceId };
}
