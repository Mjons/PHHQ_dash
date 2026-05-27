import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { redis, MANIFEST_KEY } from "@/lib/redis";
import { Manifest, type ManifestT, type NowPlayingT } from "@/schema/manifest";
import { SEED_MANIFEST } from "@/lib/seed";

// Identity of the playback "session" — when this changes, the playhead resets.
// Loop toggles, gain edits, and tracks-map mutations are deliberately NOT
// part of the signature: the curator should be able to toggle loop on a
// rolling playlist without restarting it from track 1. Playlist contents
// changing is implicit in `tracks` — clients re-derive on each manifest poll.
// Switching between named playlists DOES bump the signature so the new
// playlist starts from its first track instead of the previous offset.
function modeSignature(np: NowPlayingT): string {
  switch (np.kind) {
    case "off":
      return "off";
    case "track":
      return `track:${np.trackId}`;
    case "playlist":
      return `playlist:${np.playlistId ?? "__all__"}`;
    case "stream":
      return `stream:${np.streamUrl}`;
  }
}

export const dynamic = "force-dynamic";

async function readManifest(): Promise<ManifestT> {
  const raw = await redis.get<unknown>(MANIFEST_KEY);
  if (!raw) return SEED_MANIFEST;
  // Parse through the schema so optional fields with .default() (tracks,
  // nowPlaying, series, bookAnchors) are filled in for manifests written
  // before those fields existed. Otherwise consumers crash on `undefined`.
  return Manifest.parse(raw);
}

// Public read — the scene fetches this on load.
export async function GET() {
  const m = await readManifest();
  return NextResponse.json(m, {
    headers: {
      "cache-control": "public, max-age=10, stale-while-revalidate=60",
      "access-control-allow-origin": "*",
    },
  });
}

// Authenticated write — curator only.
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

  const parsed = Manifest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues.slice(0, 10) },
      { status: 422 },
    );
  }

  const existing = await readManifest();
  // Refresh playbackStartedAt only when the curator picks a new track,
  // playlist mode, stream URL, or flips to/from off. Carry it over for
  // everything else (gain edits, loop toggles, adding tracks to the library
  // while a playlist plays, etc.) so the playhead doesn't restart from zero
  // every time the curator clicks something tangential.
  const sigChanged =
    modeSignature(parsed.data.nowPlaying) !==
    modeSignature(existing.nowPlaying);
  const playbackStartedAt = sigChanged
    ? new Date().toISOString()
    : existing.playbackStartedAt;

  const next: ManifestT = {
    ...parsed.data,
    version: existing.version + 1,
    updatedAt: new Date().toISOString(),
    playbackStartedAt,
  };

  await redis.set(MANIFEST_KEY, next);
  return NextResponse.json(next);
}
