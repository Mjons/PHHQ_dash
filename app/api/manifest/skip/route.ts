// POST /api/manifest/skip — DJ-booth "next track" / "previous track" handler.
//
// The scene's DJ booth and wall controls call this when the curator-selected
// music is rolling. The server is the source of truth for cross-session sync
// (`playbackStartedAt`), so the scene can't just locally fast-forward — it
// needs to ask the dashboard to rewrite the timestamp. We compute the new
// `playbackStartedAt` so that "now" aligns with the start of the requested
// adjacent track in the title-sorted playlist, then write it back to Redis.
//
// Returns the updated manifest so the caller can apply it immediately without
// waiting for its 10s manifest poll cycle — the clicker hears the swap with
// only the network round-trip's latency. Other visitors pick up the change
// on their next normal poll.
//
// v1 is unauthenticated. Worst-case griefing is "someone in the venue keeps
// pressing next" which is mildly annoying, not destructive. If we later need
// avatar-level permission, the path is signedFetch signature verification +
// an allowlist of DJ-empowered wallets — see DASHBOARD_HANDOFF.md (TODO).

import { NextResponse } from "next/server";
import { redis, MANIFEST_KEY } from "@/lib/redis";
import { Manifest, type ManifestT, type TrackT } from "@/schema/manifest";
import { SEED_MANIFEST } from "@/lib/seed";

export const dynamic = "force-dynamic";

// Match venue-audio.ts — when a track has no recorded duration (rare, only if
// the dashboard couldn't probe the upload), assume 10 min so the math doesn't
// divide-by-zero. Server and scene agree on this constant.
const FALLBACK_DURATION_SEC = 600;

async function readManifest(): Promise<ManifestT> {
  const raw = await redis.get<unknown>(MANIFEST_KEY);
  if (!raw) return SEED_MANIFEST;
  return Manifest.parse(raw);
}

function playlistOrder(m: ManifestT): TrackT[] {
  const arr: TrackT[] = [];
  for (const k in m.tracks) arr.push(m.tracks[k]);
  arr.sort((a, b) => a.title.localeCompare(b.title));
  return arr;
}

function durationOf(t: TrackT): number {
  return t.durationSec ?? FALLBACK_DURATION_SEC;
}

type Body = { direction: "next" | "prev" };

function parseBody(raw: unknown): Body | null {
  if (typeof raw !== "object" || raw === null) return null;
  const dir = (raw as { direction?: unknown }).direction;
  if (dir === "next" || dir === "prev") return { direction: dir };
  return null;
}

export async function POST(req: Request) {
  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }
  const body = parseBody(bodyRaw);
  if (!body) {
    return NextResponse.json(
      { error: 'Body must be {"direction":"next"|"prev"}' },
      { status: 400 },
    );
  }

  const m = await readManifest();
  const np = m.nowPlaying;
  if (np.kind !== "playlist") {
    return NextResponse.json(
      {
        error: `Skip is only valid in playlist mode (current: ${np.kind})`,
      },
      { status: 409 },
    );
  }

  const order = playlistOrder(m);
  if (order.length === 0) {
    return NextResponse.json({ error: "Playlist is empty" }, { status: 409 });
  }

  // Current cursor — same math the scene uses, so client and server agree on
  // which track is "current right now."
  const startedMs = Date.parse(m.playbackStartedAt);
  const nowMs = Date.now();
  const elapsedSec = Number.isFinite(startedMs)
    ? Math.max(0, (nowMs - startedMs) / 1000)
    : 0;
  const cycleSec = order.reduce((s, t) => s + durationOf(t), 0);

  let into: number;
  if (np.loop) {
    into = cycleSec > 0 ? elapsedSec % cycleSec : 0;
  } else if (elapsedSec >= cycleSec) {
    // Playlist already exhausted; treat "current index" as the last track so
    // skip-back lands on the previous one and skip-forward stays exhausted.
    into = cycleSec - 0.0001;
  } else {
    into = elapsedSec;
  }

  let currentIndex = 0;
  let acc = 0;
  for (let i = 0; i < order.length; i++) {
    const d = durationOf(order[i]);
    if (into < acc + d) {
      currentIndex = i;
      break;
    }
    acc += d;
  }

  // Compute new index.
  let newIndex =
    body.direction === "next" ? currentIndex + 1 : currentIndex - 1;
  if (np.loop) {
    newIndex = ((newIndex % order.length) + order.length) % order.length;
  } else if (newIndex < 0 || newIndex >= order.length) {
    return NextResponse.json(
      {
        error: `Cannot skip ${body.direction} past edge of non-looping playlist`,
      },
      { status: 409 },
    );
  }

  // Sum durations of all tracks strictly before newIndex. New startedAt =
  // now - prefix*1000 puts elapsed at exactly `prefix`, so the cursor lands
  // at the start of order[newIndex] with offset 0.
  let prefixSec = 0;
  for (let i = 0; i < newIndex; i++) prefixSec += durationOf(order[i]);
  const newStartedAt = new Date(nowMs - prefixSec * 1000).toISOString();

  const next: ManifestT = {
    ...m,
    version: m.version + 1,
    updatedAt: new Date().toISOString(),
    playbackStartedAt: newStartedAt,
  };

  await redis.set(MANIFEST_KEY, next);
  return NextResponse.json(next);
}
