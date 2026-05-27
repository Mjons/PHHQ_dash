# Music — Scene-Side Integration Handoff

**Status:** ready for scene team
**Date:** 2026-05-23
**Author:** dashboard team

You're a fresh agent on the **scene** repo, picking up music playback. The dashboard already ships venue audio in the manifest; the scene currently ignores it. This doc is everything you need to make the venue actually play sound.

---

## Repo paths

- **Scene repo (where you work):** `c:\Users\unrea\AppData\Roaming\creator-hub\Scenes\Panel Haus Party`
- **Dashboard repo (read-only reference):** `C:\Users\unrea\projects_claudecode\phhq_build`

See sibling doc [`SCENE_INTEGRATION.md`](SCENE_INTEGRATION.md) for the broader scene contract — schema sync rules, manifest fetcher, baked fallback. This doc adds the audio layer on top.

---

## What already exists on the dashboard side

1. **`Track` schema** in [`schema/manifest.ts`](../schema/manifest.ts) — id, src (Blob URL), title, artist, durationSec, mime (`audio/mpeg | audio/mp4 | audio/ogg`), gainDb, tags.
2. **`NowPlaying` discriminated union** — exactly one of:
   - `{ kind: "off" }`
   - `{ kind: "track", trackId: string, loop: boolean }`
   - `{ kind: "playlist", loop: boolean, playlistId?: string }`
   - `{ kind: "stream", streamUrl: string }`
3. **`Manifest.tracks`** — `Record<string, Track>` keyed by id.
4. **`Manifest.playlists`** — `Record<string, Playlist>` keyed by id. Each playlist has `{ id, name, description?, trackIds: string[] }` — an ordered list of track IDs.
5. **`Manifest.nowPlaying`** — the current mode. Defaults to `{ kind: "off" }`.
6. **Curator UI** at `/music` in the dashboard — uploads tracks to Vercel Blob, builds named playlists, edits the `nowPlaying` field.

The dashboard's contract: **whatever the curator picks in the Music tab, the scene plays venue-wide.** No per-area triggers, no positional audio, no in-scene volume falloff. v1 is global.

---

## The contract you must not break

1. **`nowPlaying.kind` is the single source of truth.** Read it once per manifest poll and branch. Don't invent precedence rules between `track` and `playlist`.
2. **One `AudioStream` entity at a time.** When `nowPlaying` changes, swap with a short hard-coded crossfade (~1s). Don't keep stale streams alive in the entity tree.
3. **Looping lives on `NowPlaying`, never on `Track`.** A track plays as long as the curator's chosen mode says it should — the track itself doesn't carry a loop preference.
4. **Live streams never loop.** Even if `nowPlaying.kind === "stream"` shows up next to a stale `loop: true` from a stream provider, ignore — streams are inherently continuous.
5. **Baked fallback defaults to silence.** If manifest fetch fails, the scene runs without audio rather than playing a baked-in song. See [`SCENE_INTEGRATION.md`](SCENE_INTEGRATION.md) for the baked-manifest pattern; the music side just means `nowPlaying: { kind: "off" }` in the baked JSON.

---

## Task 1 — Re-copy the schema (5 min)

Source: `C:\Users\unrea\projects_claudecode\phhq_build\schema\manifest.ts`
Destination: `src/scene/art/schema.ts`

This is the same file you already copied for art. Re-copy it verbatim and bump the source-commit hash in the header comment. The new exports you need are:

```ts
(Track, TrackMime, NowPlaying);
(TrackT, TrackMimeT, NowPlayingT);
```

These sit alongside the existing `Piece`, `Anchor`, `Manifest` exports.

Verify: `npx tsc --noEmit` should be clean and `Manifest.parse(...)` should now accept manifests with `tracks` and `nowPlaying` fields. (Old baked manifests still parse — both fields have schema defaults.)

---

## Task 2 — Build the venue audio system (30–60 min)

Create `src/scene/audio/venue-audio.ts`.

### 2a. Pick the right primitive

Decentraland SDK7 has two relevant components:

- **`AudioSource`** — for short SFX, baked into the scene's bundled assets. Doesn't stream from a URL. **Don't use** for music.
- **`AudioStream`** — for URL-sourced audio. Buffers and streams; works with both Vercel Blob MP3s and live-stream endpoints (Icecast/Shoutcast/HLS). **Use this.**

Attach one `AudioStream` to a stationary entity at the venue's centroid (somewhere visible from every floor — e.g., the atrium midpoint at parcel `[48, 32]` y≈25). Global music doesn't care about position, but the component still needs a host entity.

### 2b. The mode switch

```ts
import {
  engine,
  Transform,
  AudioStream,
  AudioStreamComponent,
} from "@dcl/sdk/ecs";
import { Vector3 } from "@dcl/sdk/math";
import type { ManifestT, NowPlayingT, TrackT } from "../art/schema";

let host = engine.addEntity();
Transform.create(host, {
  position: Vector3.create(48 + 8, 25, 32 + 8), // atrium centroid
});

// Gain helper — dB → linear volume in [0, 1].
function gainToVolume(gainDb: number, base = 0.7): number {
  const v = base * Math.pow(10, gainDb / 20);
  return Math.max(0, Math.min(1, v));
}

// Resolve the active playlist's tracks in order.
//
// `nowPlaying.playlistId` is the foreign key into `m.playlists`. When absent
// (legacy clients, default state), fall back to "all tracks alphabetical" —
// the original v1 behavior. When present, use the named playlist's
// `trackIds` array in exactly that order; skip any IDs that no longer
// resolve (dashboard prunes these, but be defensive).
function playlistOrder(m: ManifestT, playlistId: string | undefined): TrackT[] {
  if (playlistId) {
    const pl = m.playlists?.[playlistId];
    if (pl) {
      return pl.trackIds
        .map((id) => m.tracks?.[id])
        .filter((t): t is TrackT => !!t);
    }
    // Unknown playlistId — degrade to silence rather than playing a
    // different playlist the curator didn't pick.
    return [];
  }
  return Object.values(m.tracks ?? {}).sort((a, b) =>
    a.title.localeCompare(b.title),
  );
}

let playlistIndex = 0;

export function applyNowPlaying(m: ManifestT) {
  const np = m.nowPlaying;
  // Tear down first — we always recreate. Cheap, avoids leaked listeners.
  if (AudioStream.has(host)) AudioStream.deleteFrom(host);

  if (np.kind === "off") return;

  if (np.kind === "stream") {
    AudioStream.create(host, {
      url: np.streamUrl,
      playing: true,
      volume: 0.7,
    });
    return;
  }

  if (np.kind === "track") {
    const t = m.tracks[np.trackId];
    if (!t) return; // dangling FK — dashboard refuses to save this, but be safe
    AudioStream.create(host, {
      url: t.src,
      playing: true,
      loop: np.loop,
      volume: gainToVolume(t.gainDb),
    });
    return;
  }

  if (np.kind === "playlist") {
    const order = playlistOrder(m, np.playlistId);
    if (order.length === 0) return;
    playlistIndex = playlistIndex % order.length;
    startPlaylistTrack(order, np.loop);
  }
}

function startPlaylistTrack(order: TrackT[], loop: boolean) {
  const t = order[playlistIndex];
  AudioStream.create(host, {
    url: t.src,
    playing: true,
    loop: false, // per-track loop is always false; advancement is manual
    volume: gainToVolume(t.gainDb),
  });
  // Schedule the advance. AudioStream doesn't expose an `ended` event in
  // SDK7, so use the track's durationSec (recorded by the dashboard at
  // upload time). Fall back to a generous timeout if duration is missing.
  const ms = (t.durationSec ?? 600) * 1000;
  setTimeout(() => advancePlaylist(order, loop), ms);
}

function advancePlaylist(order: TrackT[], loop: boolean) {
  if (!AudioStream.has(host)) return; // mode changed under us
  playlistIndex++;
  if (playlistIndex >= order.length) {
    if (!loop) {
      AudioStream.deleteFrom(host);
      return;
    }
    playlistIndex = 0;
  }
  AudioStream.deleteFrom(host);
  startPlaylistTrack(order, loop);
}
```

**Watch-outs:**

- **`setTimeout` is the only way to advance the playlist in SDK7** since `AudioStream` has no ended event. This is the single most fragile bit — if the curator uploads a track with no `durationSec` (rare, but possible if the browser couldn't probe it), the fallback timeout (10 min) takes over. Better than silence-forever, worse than a real end-of-track signal. If SDK7 adds an event hook in a future version, replace this.
- **Manifest re-fetches must cancel pending timeouts.** Wrap `setTimeout` returns in a module-level `currentTimer` and clear it at the top of `applyNowPlaying`. (Left out of the snippet above for brevity — add it.)
- **Crossfade.** The skeleton above does an instant cut. For the ~1s crossfade the contract promises, add a second short-lived host entity, ramp its volume up while ramping the old one down, then delete the old. Optional polish; ship without it first.

---

## Task 3 — Wire it into the main loop (5 min)

In your existing manifest-poll loop (the one that re-renders art when the manifest changes), call `applyNowPlaying(manifest)` after the art render.

Important: **only call it when the relevant fields actually change.** Otherwise every poll tears down and rebuilds the AudioStream — the curator hears stutter every few seconds.

```ts
let lastNowPlayingHash = "";

function onManifestRefresh(m: ManifestT) {
  renderArt(m); // existing
  const npHash =
    JSON.stringify(m.nowPlaying) +
    ":" +
    Object.keys(m.tracks ?? {})
      .sort()
      .join(",") +
    ":" +
    // Include the active playlist's track order so reordering or
    // adding/removing tracks in the currently-playing playlist forces a
    // recompute. Other playlists are ignored — editing an inactive playlist
    // shouldn't restart playback.
    (m.nowPlaying.kind === "playlist" && m.nowPlaying.playlistId
      ? (m.playlists?.[m.nowPlaying.playlistId]?.trackIds ?? []).join(",")
      : "");
  if (npHash !== lastNowPlayingHash) {
    applyNowPlaying(m);
    lastNowPlayingHash = npHash;
  }
}
```

The hash includes the track-keys list so adding/removing tracks during playlist mode forces a recompute. The active playlist's `trackIds` are also folded in so curator edits to the live playlist (reorder, add, remove) reach the scene; edits to other playlists do not.

---

## Task 4 — Baked fallback (2 min)

When you regenerate `src/scene/art/manifest.baked.json`, the new schema fields will appear with their defaults (`tracks: {}`, `nowPlaying: { kind: "off" }`). The baked fallback should _always_ be silent — never bake a real track URL into the scene, because:

1. The Blob URL might be revoked.
2. Visitors who experience a fetch failure should get the venue without surprise audio.

Confirm the bake script in the scene's `package.json` passes through the live `nowPlaying` to the baked file. If the live manifest has `nowPlaying: { kind: "playlist", loop: true }` at bake time, that's fine to bake — the baked file shows what the venue normally plays. But if Blob is down at runtime, the scene still tries the URLs and they'll silently fail; an audible silence is the worst case, which matches the contract.

---

## Task 5 — Verification checklist

Run through these once the implementation is in:

- [ ] Curator picks **Off** → scene goes silent within one manifest poll cycle (~10s).
- [ ] Curator picks **Single track** without loop → track plays once and stops.
- [ ] Curator picks **Single track** with loop → track loops indefinitely.
- [ ] Curator picks **Playlist** with no `playlistId` (legacy / "All tracks") and loop → all tracks play in title-sorted order, restart at track 1 after the last.
- [ ] Curator picks **Playlist** with no `playlistId` and no loop → all tracks play in order, silence after the last.
- [ ] Curator picks a **named playlist** → tracks play in the curator-defined order (NOT alphabetical).
- [ ] Curator reorders tracks inside the currently-playing named playlist → scene picks up the new order on the next manifest poll without tearing down mid-track.
- [ ] Curator switches between two named playlists → playhead resets to track 1 of the new playlist (server-side `playbackStartedAt` bumps when the playlist signature changes).
- [ ] Curator picks a playlist whose `playlistId` no longer exists (race condition with deletion) → scene goes silent rather than playing the wrong set.
- [ ] Curator picks **Live stream** + valid URL → scene plays the stream.
- [ ] Curator changes mode mid-playback → no overlap between old and new audio for more than ~1s.
- [ ] Curator deletes a track that's currently nowPlaying (dashboard refuses this, but if it somehow lands) → scene handles the dangling FK without crashing.
- [ ] Manifest fetch fails → scene starts silent, no audio errors in the console.

---

## What you are **NOT** building (v1 scope, explicit)

- **No per-area triggers.** All audio is venue-global. If a v2 ask arrives, the schema gains a `TrackPlacement[]` field; `nowPlaying` becomes the fallback when no placement matches.
- **No positional audio.** Single `AudioStream` at the venue centroid, full volume everywhere.
- **No fade curves.** Hard-coded ~1s crossfade in code; not curator-tunable.
- **No anchor coupling.** Tracks don't bind to specific artworks.
- **No DJ-set length tracks.** The upload route caps at 20 MB. If someone wants longer, the dashboard's MUSIC_HOSTING_PLAN.md has notes on switching to client-direct upload.

If any of these become real asks, they all layer cleanly on top of the current schema. None of them break existing behavior.

---

## Quick reference — manifest shape

```jsonc
{
  "version": 42,
  "updatedAt": "2026-05-23T14:00:00.000Z",
  "pieces": {
    /* existing */
  },
  "anchors": [
    /* existing */
  ],
  "series": [
    /* existing */
  ],
  "bookAnchors": [
    /* existing */
  ],
  "tracks": {
    "ambient-01": {
      "id": "ambient-01",
      "src": "https://...blob.vercel-storage.com/tracks/ambient-01.mp3",
      "title": "Ambient 01",
      "artist": "Studio X",
      "durationSec": 247,
      "mime": "audio/mpeg",
      "gainDb": 0,
    },
    "hype-01": {
      "id": "hype-01",
      "src": "https://...blob.vercel-storage.com/tracks/hype-01.mp3",
      "title": "Hype 01",
      "durationSec": 200,
      "mime": "audio/mpeg",
      "gainDb": 0,
    },
  },
  "playlists": {
    "opening-set": {
      "id": "opening-set",
      "name": "Opening Set",
      "trackIds": ["ambient-01", "hype-01"],
    },
  },
  "nowPlaying": {
    "kind": "playlist",
    "loop": true,
    "playlistId": "opening-set",
  },
}
```
