# Scene Contract — `Piece.poster` for Video Sources

**Status:** shipped (dashboard side)
**Date:** 2026-05-25
**Audience:** scene-repo maintainers

## What changed

`Piece` gained an optional field:

```ts
poster: httpUrl.optional();
```

Defined in [schema/manifest.ts](../schema/manifest.ts) alongside `src`. The scene
should treat it as the **still texture** to display when `src` is a format the
in-scene texture loader can't decode (today: `.mp4` / `.webm` / `.mov`; in
practice: any time the curator points `src` at a video file or an objkt
`artifact` URL backed by a non-image).

## Why

The dashboard now accepts video pieces (SuperRare signed `.mp4` URLs,
objkt animated artifact URLs) because the curator's residency artists are
shipping animated work. The dashboard preview plays the video directly. The
scene cannot — DCL's texture loader rejects mp4 with a load error and the
frame stays blank or errors out.

`poster` is the bridge: the dashboard preview keeps using `src` (so the
curator sees the motion in the AnchorCard and PiecePicker), and the scene
uses `poster ?? src` (so the wall gets a valid still). Click-through to the
marketplace (via `Piece.link`, see [docs/ANCHOR_LINKS_PLAN.md](ANCHOR_LINKS_PLAN.md))
takes visitors to where the animation actually plays.

## Required scene-side change

In whatever module loads the piece texture (the dashboard side calls it
`textureSrc` per [docs/ART_PIPELINE_PLAN.md:197](ART_PIPELINE_PLAN.md#L197)),
prefer `poster`:

```ts
const textureSrc = piece.poster ?? piece.src;
```

That's the whole contract. No new component, no new mesh — just one line.

### Concrete diff for the scene repo

Two files to update. File paths are best-guess from the SYNC comment in
[schema/manifest.ts](../schema/manifest.ts) — adjust to your actual layout.

**1. Schema sync — `src/scene/art/schema.ts` (or wherever the scene's Piece
schema lives):**

```diff
 export const Piece = z.object({
   id: z.string().min(1),
   src: httpUrl,
+  // Still poster used when `src` is a format the DCL texture loader can't
+  // decode (today: video files). Scene reads `poster ?? src`.
+  poster: httpUrl.optional(),
   aspect: z.number().positive(),
   preferredFrame: FrameKind,
   artist: z.string().optional(),
   title: z.string().optional(),
   link: httpUrl.optional(),
   tags: z.array(z.string()).optional(),
   batch: z.string().optional(),
 });
```

(Update the commit-hash header comment too, per the SYNC convention.)

**2. Renderer — wherever the per-piece render call lives.** Based on the
shape shown in [docs/ART_PIPELINE_PLAN.md:188-198](ART_PIPELINE_PLAN.md#L188-L198),
the change is one line inside the `FRAMES[frameKind]({ ... })` call:

```diff
 FRAMES[frameKind]({
   centerPos: Vector3.create(
     anchor.centerPos.x,
     anchor.centerPos.y,
     anchor.centerPos.z,
   ),
   width,
   height,
   facing: anchor.facing,
-  textureSrc: piece.src,
+  textureSrc: piece.poster ?? piece.src,
 });
```

That's it. No `VideoPlayer` import, no new component, no extra fetch.

### How to verify

After deploying, walk into VT4 and look at any of:

- Body Mapping (`vt4-body-mapping`)
- Voluptechne (`vt4-voluptechne-video`)
- Proof of Palm (`vt4-proof-of-palm`)
- Body Mapping II (`vt4-body-mapping-ii`)

Each should now show a still image on the frame instead of failing to load.
If one fails, check that the manifest at `/api/manifest` actually has
`pieces[<id>].poster` set — if missing, the curator hasn't run the
[scripts/sync-voluptechne-posters.js](../scripts/sync-voluptechne-posters.js)
sync yet.

## Curator workflow (already wired)

The dashboard now:

1. Exposes `poster` in the batch-upload "More options" panel
   ([app/pieces/pieces-view.tsx](../app/pieces/pieces-view.tsx))
2. Shows a `Poster` row on the AnchorCard for video pieces
   ([app/anchors-view.tsx](../app/anchors-view.tsx)) — inline editable like
   the link row, with the same `httpUrl` validation
3. Renders the row label in coral with a "⚠" when a video piece has no
   poster set, so the curator notices before placing it in-scene

If the curator places a video piece with no `poster`, the scene will fall
back to `src` and fail the same way it does today — the dashboard warning is
the only enforcement.

## What this does NOT do

- **Does not enable real video playback in the scene.** Frames stay static.
  Video playback in DCL needs `VideoPlayer` + `videoTexture` and a per-floor
  performance budget (multiple concurrent videos on one floor can choke
  lower-end clients). That's a separate workstream — see
  [docs/ART_PIPELINE_PLAN.md:330](ART_PIPELINE_PLAN.md#L330) for the original
  deferral note.
- **Does not auto-extract a poster from the video URL.** Curator pastes one.
  For SuperRare we don't have a clean poster-URL trick (the `.mp4` URLs are
  HMAC-signed; you can't just swap the extension). For objkt, the token
  metadata exposes a `displayUri` / `thumbnailUri` that's a reliable poster
  source, but fetching it is curator-side for now.

## Versioning

The field is **additive and optional** — no breaking change. Pre-existing
manifests parse and render unchanged. Scene clients on the old contract will
continue to use `src` and break on video pieces the same way they do today
(no regression, no improvement). After the scene-repo update lands, the same
manifests start rendering correctly for video pieces with posters set.

## Files touched

- [schema/manifest.ts](../schema/manifest.ts) — `Piece.poster: httpUrl.optional()`
- [app/pieces/pieces-view.tsx](../app/pieces/pieces-view.tsx) — batch-upload form
- [app/anchors-view.tsx](../app/anchors-view.tsx) — AnchorCard inline editor
- (none in scene repo yet — that's this doc's call to action)
