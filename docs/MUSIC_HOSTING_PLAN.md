# Music Hosting — A Music Tab on the Dashboard

**Status:** v1 scope locked (2026-05-23)
**Date:** 2026-05-23
**Author:** dashboard team

## What the curator wants

> "Can we host our music with our images? They take up a lot of space in the project file."

Plus the follow-on ask:

> "I wouldn't mind having a music tab in our dashboard to upload and control the tracks."

And the v1 scope after a quick back-and-forth:

> "For V1 it will be global. The basic functionality I want is to switch between our live stream audio and our actual music. Even that I can do manually if it messes with scene triggers too much. Just like 10–12 MP3s."

In plain English: get the audio files out of the repo, park them next to the images on Vercel Blob, and give the curator a dashboard tab where they (a) upload a small library of MP3s and (b) flip one global switch between **off**, **a chosen track from the library**, and **a live stream URL**. No per-area triggers, no crossfade logic, no positional audio.

This is **tractable**: the image-upload primitive at [app/api/pieces/upload/route.ts](../app/api/pieces/upload/route.ts) is generic enough that an audio variant is a near-copy. The remaining work is one new schema entity, one new field on the manifest, one upload route, and one dashboard page.

---

## Why this is cheap on the infra side

Vercel Blob doesn't care what file type you `put()`. The image upload route is just:

```ts
const blob = await put(path, file, {
  access: "public",
  contentType: file.type,
  allowOverwrite: true,
});
```

at [app/api/pieces/upload/route.ts:79-83](../app/api/pieces/upload/route.ts#L79-L83). Swap `image/*` for `audio/*` in the MIME allow-list, bump the 8 MB cap, change the path prefix from `pieces/` to `tracks/`, and the same code uploads music.

The schema-side `httpUrl` validator at [schema/manifest.ts:11](../schema/manifest.ts#L11) is already content-agnostic — `^https?://.+/` matches Blob URLs regardless of what's at the end of them.

So the question isn't "can Blob host music" (yes) — it's "what's the entity shape, what's the dashboard UX, and how does the scene know when to play a track."

---

## Sizing — bump from 8 MB to 20 MB

The image route caps uploads at 8 MB ([app/api/pieces/upload/route.ts:7](../app/api/pieces/upload/route.ts#L7)). That works for compressed JPEGs and PNGs; it's tight for music. Rough numbers:

| Format               | 3-min track | 5-min track |
| -------------------- | ----------- | ----------- |
| MP3 @ 192 kbps       | ~4.3 MB     | ~7.2 MB     |
| MP3 @ 320 kbps       | ~7.2 MB     | ~12 MB      |
| AAC @ 256 kbps (m4a) | ~5.7 MB     | ~9.6 MB     |
| OGG Vorbis q6        | ~3.9 MB     | ~6.5 MB     |

The curator's library is 10–12 MP3s — so we're talking ~50–100 MB of audio total, with individual files in the 4–10 MB range. **Recommendation**: set the music cap at **20 MB**. Plenty of headroom for any single MP3 the curator is realistically going to drop in, well under the size where streaming becomes painful, and a clean round number to remember.

**Watch-out**: Vercel's documented `put()` payload limit through a server route is **4.5 MB on the Hobby plan**, higher on Pro. A 5-minute 192 kbps MP3 already busts that. Before shipping, either confirm we're on Pro/Enterprise (then 20 MB through the route is fine) or switch the route to **client-direct upload** (`handleUploadUrl` / "client uploads" in Vercel parlance) — an extra two-step handshake but the file never passes through our function. Worth deciding which path before writing the route, because the API shape differs.

---

## Cost — comparable to images, not dramatic

Vercel Blob bills storage + egress. Rough envelope (current public pricing, may have drifted):

- **Storage**: ~$0.023/GB-month
- **Egress**: ~$0.05/GB

A v1 library of ~12 tracks at 8 MB average = 0.1 GB → **fractions of a cent per month** storage. Negligible.

Egress depends on whether visitors actually hear a track. If the curator leaves a 4 MB track playing/looping all session, and a visitor stays 10 minutes, the browser will have streamed most of the file (≈4 MB) plus any loops. 1000 visitor-sessions × ~5 MB pulled each = ~5 GB egress = **well under $1/mo**. The live-stream option is even cheaper for us — egress comes from the stream provider, not from Blob.

The cost story: not a budget item, but it is _not free_ the way bundling MP3s in the repo would be. Worth noting in the curator handoff so nobody is surprised.

---

## Schema — introducing `Track`

There is no audio entity in the manifest today. `Piece` ([schema/manifest.ts:30-40](../schema/manifest.ts#L30-L40)) is image-shaped — it carries `aspect`, `preferredFrame` (Ink, Gold, Lightbox, etc.), things that don't apply to audio. Forcing music into `Piece` would mean a soup of `null`-able fields and special-cases in every consumer. Don't.

Instead, mirror the existing pattern (Piece for images, BookSeries for books) with a third entity:

```ts
// schema/manifest.ts — proposed addition
export const Track = z.object({
  id: z.string().min(1), // slug, unique within manifest
  src: httpUrl, // Vercel Blob URL
  title: z.string().min(1),
  artist: z.string().optional(),
  durationSec: z.number().positive().optional(), // computed client-side at upload
  mime: z.enum(["audio/mpeg", "audio/mp4", "audio/ogg"]),
  loop: z.boolean().default(true), // ambient gallery tracks loop by default
  gainDb: z.number().min(-30).max(6).default(0), // per-track volume trim
  tags: z.array(z.string()).optional(),
});

export type TrackT = z.infer<typeof Track>;
```

### Now playing — one global switch

The curator picked **global v1** with one explicit control: flip between off, a track from the library, or a live stream URL. That maps cleanly to a discriminated union on the manifest:

```ts
// schema/manifest.ts — proposed addition
export const NowPlaying = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("off") }),
  z.object({ kind: z.literal("track"), trackId: z.string().min(1) }),
  z.object({ kind: z.literal("stream"), streamUrl: httpUrl }),
]);

export type NowPlayingT = z.infer<typeof NowPlaying>;
```

And two new keys on `Manifest`:

```ts
export const Manifest = z.object({
  // …existing fields…
  tracks: z.record(z.string(), Track).default({}),
  nowPlaying: NowPlaying.default({ kind: "off" }),
});
```

Why a discriminated union and not just two nullable fields? It forces "track vs stream vs off" to be a single decision at write time — you can't accidentally save a manifest that has both a `trackId` and a `streamUrl` set and leave the scene wondering which to play. The scene reads `nowPlaying.kind` once and branches; no precedence rules.

**What we explicitly did NOT add for v1** (and why the schema is the better for it):

- No `TrackPlacement` entity. No per-area triggers. The scene plays whatever `nowPlaying` says, everywhere.
- No fade-in/fade-out fields. The curator said manual switching is acceptable if scene triggers get hairy — so we don't build the triggers. The scene can do a simple ~1-second crossfade when `nowPlaying` changes, hard-coded, no curator control needed.
- No `gainDb` on the live stream — the stream provider sets its own level. The `gainDb` on `Track` is kept because it's cheap and lets the curator trim a loud mp3 without re-encoding.

These are the v2 hooks: when the curator wants per-area triggers, add a `TrackPlacement[]` array alongside `nowPlaying` (the scene checks placements first, falls back to `nowPlaying`). When events arrive, add a temporary `nowPlaying` override scoped to an event window. The schema doesn't have to change to add them.

---

## Upload route — `/api/tracks/upload`

A near-copy of [app/api/pieces/upload/route.ts](../app/api/pieces/upload/route.ts) with three changes:

1. **MIME map** — accept compressed audio only (no WAV/FLAC for v1; 10–12 MP3s don't need it):
   ```ts
   const EXT: Record<string, string> = {
     "audio/mpeg": "mp3",
     "audio/mp4": "m4a",
     "audio/ogg": "ogg",
   };
   ```
2. **Size limit** — `MAX_BYTES = 20 * 1024 * 1024` (or switch to client-direct upload if we're on Hobby's 4.5 MB function-payload limit; see the sizing section above).
3. **Path prefix** — `tracks/${slugRaw}.${ext}`. No batch sub-folder for v1; the library is small enough that a flat directory is fine.

Same auth check ([auth.ts](../auth.ts)), same slug validation regex, same `put()` call. Returns `{ url, pathname, contentType, size, durationSec? }` — `durationSec` ideally derived in the browser before upload (via an off-screen `<audio>` element) and passed in as a form field, since the server route runs in an Edge-ish context and can't decode audio.

The duration probe in the browser is cheap:

```ts
async function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(audio.duration);
    audio.onerror = () => resolve(null);
    audio.src = URL.createObjectURL(file);
  });
}
```

Same shape as the aspect-ratio probe already in [app/pieces/pieces-view.tsx:49-64](../app/pieces/pieces-view.tsx#L49-L64).

---

## Dashboard tab — Music

A new nav entry alongside the existing six at [app/layout.tsx:50-55](../app/layout.tsx#L50-L55):

```tsx
<NavLink href="/">Anchors</NavLink>
<NavLink href="/map">Map</NavLink>
<NavLink href="/pieces">Pieces</NavLink>
<NavLink href="/books">Books</NavLink>
<NavLink href="/music">Music</NavLink>   {/* new */}
<NavLink href="/import">Import</NavLink>
<NavLink href="/admin/blob-orphans">Orphans</NavLink>
```

The view at `app/music/music-view.tsx` has two halves:

**1. Now Playing panel (top of the page).** The control surface the curator actually uses day-to-day. Three radio options:

- **Off** — silence in the venue.
- **Track from library** — a dropdown / picker of every `Track` in `tracks{}`. Showing the chosen track's title + artist + an inline `<audio controls>` preview so the curator can confirm before flipping the switch.
- **Live stream** — a text input for the stream URL (e.g., an Icecast/Shoutcast endpoint or an HLS `.m3u8`). Validate against the same `httpUrl` regex used elsewhere. Inline `<audio>` preview lets the curator test the URL before committing.

Changing the radio writes the whole `Manifest` with the new `nowPlaying` value (same `saveManifest` flow as everything else). The scene picks it up on the next manifest poll — no real-time push needed; the curator's "flip the switch" interaction tolerates a few seconds of latency.

**2. Track library (below).** A list of every `Track` in the manifest. Each row shows:

- Inline `<audio controls>` player (browser handles scrub/play/pause/volume — no custom player needed for v1)
- Title / artist / duration / file size
- Edit title/artist/gain/loop inline (same UX as `AnchorCard` patches in [app/anchors-view.tsx](../app/anchors-view.tsx))
- Delete (mirrors the Orphans flow — removes from `tracks{}` and the Blob; refuses to delete the track currently set as `nowPlaying.trackId` to prevent the scene seeing a dangling FK)

Plus an upload form at the top of the library section: file picker, slug, title, artist, loop checkbox. Single-file upload only for v1 — 10–12 tracks doesn't justify the batch-upload UX. (The batch flow from [docs/BATCH_UPLOAD_PIECES_PLAN.md](BATCH_UPLOAD_PIECES_PLAN.md) is still available as a v2 lift-and-shift if the library grows.)

---

## Scene-side integration — what the scene team gets

The dashboard ships a manifest. The scene consumes it. Mirroring the existing handoff in [docs/SCENE_INTEGRATION.md](SCENE_INTEGRATION.md):

The scene needs:

1. **Track + NowPlaying schema** — copy from `schema/manifest.ts` to the scene repo verbatim.
2. **A single global `AudioStream` entity** that follows `manifest.nowPlaying`:
   - `kind: "off"` → no `AudioStream`, or one with `playing: false`.
   - `kind: "track"` → `AudioStream` pointing at `tracks[trackId].src`, with `loop: tracks[trackId].loop` and volume biased by `gainDb`.
   - `kind: "stream"` → `AudioStream` pointing at `streamUrl`, never looped.
   - On manifest-fetch polls, when `nowPlaying` changes, do a short hard-coded crossfade (~1s) and swap. No curator-tunable fade.
3. **A baked fallback** — same pattern as the manifest baked snapshot. If Blob is unreachable, `nowPlaying` defaults to `{ kind: "off" }` and visitors get silence rather than a broken experience.

Decentraland SDK7's `AudioStream` component is the right primitive for both Blob-hosted MP3s and external live-stream URLs — it handles both transparently.

What the scene **doesn't** need for v1: per-area triggers, parcel bbox watchers, positional audio falloff, fade curves. All deferred until the curator asks for them.

---

## Cleanup — Orphans extension

The existing [app/admin/blob-orphans/blob-orphans-view.tsx](../app/admin/blob-orphans/blob-orphans-view.tsx) finds Blob objects under `pieces/` and `books/` that aren't referenced by the manifest. Extend it to scan `tracks/` too — same diff pattern, just another path prefix. Otherwise deleted-from-dashboard tracks rot in storage forever.

---

## Migration — nothing to migrate (yet)

The repo currently has **no audio files** committed. `public/` only contains SVG icons. So this is greenfield: no rip-out-and-replace, just add the tab.

If the curator has a stash of music files outside the repo that they want loaded in, the batch-upload flow above handles it directly — drop the folder on the Music tab, type a shared artist/batch, done.

---

## Resolved with curator (2026-05-23)

The open questions in the first draft of this doc are now answered:

1. **Per-area or per-anchor placement?** → Neither. v1 is **global**. One `nowPlaying` field on the manifest controls the whole venue.
2. **Crossfade semantics?** → Out of scope. Hard-code a short crossfade on the scene side; no curator control.
3. **Atrium and skywalk?** → Doesn't matter when playback is global.
4. **DJ-set length tracks?** → No. 10–12 MP3s, normal song lengths. **20 MB cap is plenty** (verify the Vercel plan's function-payload limit before locking in).
5. **Loop default?** → Confirmed: `loop: true` by default for ambient gallery tracks.

The **off / track / stream** triad is the load-bearing curator control. Everything else in the dashboard tab is upload plumbing.

---

## What I'd build first

Roughly 2–3 hours of work for the v1 minimum:

1. **Schema** — add `Track`, `NowPlaying`, and the two new keys (`tracks`, `nowPlaying`) to `schema/manifest.ts`. Bump the schema-sync note in the header comment so the scene repo picks it up.
2. **Upload route** — `app/api/tracks/upload/route.ts`, copy-modify of the pieces route (MIME map, 20 MB cap, `tracks/` prefix). Decide route-proxy vs client-direct upload first, based on the Vercel plan.
3. **Dashboard page** — `app/music/page.tsx` + `app/music/music-view.tsx`:
   - Now Playing panel at the top (off / track / stream radio + previews).
   - Upload form.
   - Track library list with inline `<audio controls>` players.
4. **Nav link** — add `<NavLink href="/music">Music</NavLink>` in `app/layout.tsx`, between Books and Import.
5. **Orphans** — extend `app/admin/blob-orphans/blob-orphans-view.tsx` to scan `tracks/` in addition to `pieces/` and `books/`.
6. **Scene handoff doc** — short note in `docs/` (or append to [SCENE_INTEGRATION.md](SCENE_INTEGRATION.md)) explaining the `nowPlaying` contract for the scene team.

Defer until a v2 ask exists:

- Per-area triggers (`TrackPlacement[]`).
- Anchor-coupled placement.
- Event-window overrides.
- Batch upload.
- Custom waveform / scrub UI — `<audio controls>` is enough.

The schema is still the load-bearing decision. The `nowPlaying` discriminated union lets the scene branch cleanly today and stays compatible with placement layers added later — adding `TrackPlacement[]` doesn't break anything that consumes `nowPlaying`.
