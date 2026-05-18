# Scene-Side Manifest Integration — Handoff

You're a fresh agent picking this up. This doc is everything you need to wire the **scene** (a Decentraland SDK7 project) to consume the **dashboard's** JSON manifest, render art on the walls, and stay resilient if the manifest fetch fails.

The dashboard exists, the schema exists, the frame primitives exist. You're building the layer in between.

---

## Repo paths

- **Scene repo (where you work):** `c:\Users\unrea\AppData\Roaming\creator-hub\Scenes\Panel Haus Party`
- **Dashboard repo (read-only reference):** `C:\Users\unrea\projects_claudecode\phhq_build`
- **GitHub remote of dashboard:** `https://github.com/Mjons/PHHQ_dash.git` (will deploy on Vercel)

You should already be in the scene repo. The dashboard repo has the source-of-truth schema and the reference docs — you'll read from it but not modify it.

---

## What already exists in the scene

1. **Frame primitives** at [`src/scene/art/frames.ts`](src/scene/art/frames.ts) — six functions `frameInk`, `frameGold`, `frameLightbox`, `frameFrameless`, `framePlinth`, `frameHangingBanner` plus a `FRAMES` map indexed by `'A' | 'B' | … | 'F'`. Each takes `{ centerPos, width, height, facing, textureSrc }`. **Don't touch this file** — it's the contract endpoint on the scene side.

2. **In-scene anchor capture tool** at `src/scene/dev/anchor-capture.ts` and `src/scene/dev/capture-overlay.tsx`. Lets the curator walk through the venue and mark anchor positions, exporting JSON for the dashboard `/import` page. Wallet-gated to one curator. Already works; **don't modify** unless you need to fix something specific.

3. **Floor constants** at [`src/scene/constants.ts`](src/scene/constants.ts) — `FLOOR_BASE = { F1: 0, F2: 12, F3: 22, F4: 31, F5: 47, F6: 60 }`. The Y baseline for each main-building floor.

## What's missing (your work)

1. The schema (copy from dashboard repo, verbatim).
2. A floor-Y lookup that covers all `Area` values (the dashboard's areas include `vt2..vt6`, `atrium`, `skywalk` — the scene's constants don't map these yet).
3. A manifest fetcher that pulls from a Vercel URL, validates with Zod, falls back to a baked JSON on any failure.
4. A baked JSON snapshot (`manifest.baked.json`) for the fallback.
5. The renderer (`buildArtwork`) that walks anchors and calls the right frame primitives at the right positions.
6. One `main()` hook in `src/index.ts`.
7. A bake-script in `package.json` so the baked fallback stays fresh on deploys.

---

## The contract you must not break

Source: [`DASHBOARD_HANDOFF.md`](DASHBOARD_HANDOFF.md) in the dashboard repo. The four load-bearing promises:

1. **Manifest URL** — read from `MANIFEST_URL` env var, default to the dashboard's `/api/manifest` URL. GET is public, no auth needed.
2. **Schema** — copied verbatim from `phhq_build/schema/manifest.ts` with a header comment recording the source commit hash. **Edit it in the dashboard, then re-copy here.** Never edit the scene's copy in place.
3. **Coord system** — `anchor.x` and `anchor.z` in the manifest are **scene-local meters, identical** to the values passed to `FRAMES[k]({ centerPos: Vector3.create(anchor.x, …, anchor.z), … })`. No translation, no rotation. `anchor.facing` is `'N'|'E'|'S'|'W'`, identical to the `Facing` type in `frames.ts`.
4. **Baked fallback** — `src/scene/art/manifest.baked.json` is shipped with the scene. On any fetch failure or validation error, the scene loads this instead. **The scene never spawns empty.**

---

## Task 1 — Copy the schema (5 min)

Source: `C:\Users\unrea\projects_claudecode\phhq_build\schema\manifest.ts`
Destination: `src/scene/art/schema.ts`

Copy the file **verbatim**, then prepend this header comment (replace `<hash>` with the dashboard repo's current `git rev-parse --short HEAD`):

```ts
// SYNC: copied from panelhaus-dashboard/schema/manifest.ts @ <hash>
// Do not edit in-place — change in the dashboard repo, then re-copy here.
```

Verify the file imports `zod` and exports `Manifest`, `Anchor`, `Piece`, `FrameKind`, `Facing`, `Area`, plus the matching `*T` type aliases.

---

## Task 2 — Floor-Y map (10 min)

Create `src/scene/art/floor-y.ts`:

```ts
import { FLOOR_BASE } from '../constants'
import type { AreaT } from './schema'

// Y baseline (in meters) for each curatable area. The scene already exposes
// FLOOR_BASE for the main building; this fills in VT levels, atrium, skywalk.
//
// VT internal levels match the main-building floor bases (the elevator at
// ui.tsx:43–50 teleports to these exact Y values).
//
// Atrium hero pieces hang on the void walls between F2 and F4; pick a midpoint.
// Skywalk hangs overhead between F4 and F5.
export const FLOOR_Y: Record<AreaT, number> = {
  f1: FLOOR_BASE.F1,
  f2: FLOOR_BASE.F2,
  f3: FLOOR_BASE.F3,
  f4: FLOOR_BASE.F4,
  f5: FLOOR_BASE.F5,
  vt2: FLOOR_BASE.F2,
  vt3: FLOOR_BASE.F3,
  vt4: FLOOR_BASE.F4,
  vt5: FLOOR_BASE.F5,
  vt6: FLOOR_BASE.F6,
  atrium: FLOOR_BASE.F2 + 5, // mid-void hero height
  skywalk: FLOOR_BASE.F4 + 4 // overhead, ~35m up
}

// How high above the floor base the anchor's CENTER sits.
// The frame primitives interpret centerPos.y as the middle of the art, so this
// is roughly head-height plus a typical "above eye line" offset.
export const WALL_MID_HEIGHT = 4
```

Test: `npx tsc --noEmit` should be clean.

**Known limitation** — the manifest schema doesn't currently include a `y` field per anchor, so all pieces on a given floor sit at the same Y. The in-scene capture tool does record the actual camera Y but strips it on export per the current contract. If/when the curator complains "this piece needs to be higher up", we add an optional `y?: number` to the schema and have the renderer prefer it when present. Not your problem for v1.

---

## Task 3 — Manifest fetcher (15 min)

Create `src/scene/art/manifest.ts`:

```ts
import { signedFetch } from '~system/SignedFetch'
import { Manifest, type ManifestT } from './schema'
import BAKED from './manifest.baked.json'

const MANIFEST_URL =
  // Override at deploy time via env. The Decentraland CLI doesn't expose
  // process.env at scene runtime, so the URL is baked into the bundle here.
  // To change it, edit this file before `dcl deploy`.
  'https://phhq-dash.vercel.app/api/manifest'

const FETCH_TIMEOUT_MS = 5000

export async function loadManifest(): Promise<ManifestT> {
  try {
    const res = await Promise.race([
      signedFetch({ url: MANIFEST_URL, init: { method: 'GET' } }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('manifest fetch timeout')), FETCH_TIMEOUT_MS)
      )
    ])
    if (!res.body) throw new Error('empty manifest body')
    const parsed = Manifest.safeParse(JSON.parse(res.body))
    if (!parsed.success) {
      console.log('[art] manifest validation failed', parsed.error.issues.slice(0, 3))
      return BAKED as ManifestT
    }
    console.log(`[art] manifest v${parsed.data.version} loaded`)
    return parsed.data
  } catch (e) {
    console.log('[art] manifest fetch failed, using baked fallback', e)
    return BAKED as ManifestT
  }
}
```

**Important** — the existing scene uses `console.log` and `console.error` only; **don't use `console.warn`** (it'll fail typecheck — DCL's console doesn't expose it).

You may need to install `zod` if it's not already a scene dependency. Check `package.json` first. If missing: `npm install zod`.

---

## Task 4 — Baked fallback (2 min)

Create `src/scene/art/manifest.baked.json` with an empty seed:

```json
{
  "version": 0,
  "updatedAt": "1970-01-01T00:00:00.000Z",
  "pieces": {},
  "anchors": []
}
```

This is the file the bake script overwrites pre-deploy. Empty seed means a fresh build with no live manifest spawns zero pieces — no crashes, just a bare scene.

You may need to enable JSON imports in `tsconfig.json`. Check if `"resolveJsonModule": true` is set; add it if missing.

---

## Task 5 — The renderer (30 min)

Create `src/scene/art/build.ts`:

```ts
import { Vector3 } from '@dcl/sdk/math'
import { FRAMES } from './frames'
import { FLOOR_Y, WALL_MID_HEIGHT } from './floor-y'
import type { AnchorT, FrameKindT, ManifestT, PieceT } from './schema'

// Pick which frame style to use for this (anchor, piece) pair.
// - If anchor.allowedFrames is missing/empty: use piece.preferredFrame.
// - If anchor allows piece.preferredFrame: use it (piece's choice wins).
// - Else: fall back to the first allowed frame on the anchor.
function chooseFrame(anchor: AnchorT, piece: PieceT): FrameKindT {
  const allowed = anchor.allowedFrames
  if (!allowed || allowed.length === 0) return piece.preferredFrame
  return allowed.includes(piece.preferredFrame) ? piece.preferredFrame : allowed[0]
}

// Letterbox a piece into the anchor's bounding box. Pieces declare their own
// width/height aspect ratio; the anchor declares the max box. Fit-inside math.
function fit(aspect: number, maxW: number, maxH: number): { width: number; height: number } {
  const anchorAspect = maxW / maxH
  if (aspect > anchorAspect) {
    return { width: maxW, height: maxW / aspect }
  }
  return { width: maxH * aspect, height: maxH }
}

export function buildArtwork(manifest: ManifestT): void {
  let spawned = 0
  let skipped = 0
  for (const anchor of manifest.anchors) {
    if (!anchor.pieceId) {
      skipped++
      continue
    }
    const piece = manifest.pieces[anchor.pieceId]
    if (!piece) {
      console.log(`[art] anchor ${anchor.id} references missing piece "${anchor.pieceId}"`)
      skipped++
      continue
    }
    const floorY = FLOOR_Y[anchor.area]
    if (floorY === undefined) {
      console.log(`[art] anchor ${anchor.id} has unknown area "${anchor.area}"`)
      skipped++
      continue
    }
    const kind = chooseFrame(anchor, piece)
    const { width, height } = fit(piece.aspect, anchor.maxWidth, anchor.maxHeight)

    FRAMES[kind]({
      centerPos: Vector3.create(anchor.x, floorY + WALL_MID_HEIGHT, anchor.z),
      width,
      height,
      facing: anchor.facing,
      textureSrc: piece.src
    })
    spawned++
  }
  console.log(`[art] spawned ${spawned} pieces, skipped ${skipped}`)
}
```

**Notes:**

- `FRAMES[kind]` is the existing map in `src/scene/art/frames.ts`. Don't touch that file.
- `floorY + WALL_MID_HEIGHT` is the center of the art on the wall. For a 3m-tall anchor on F2 (base 12, mid-height 4), the art's center is at Y=16 and spans 14.5 to 17.5.
- Skipping with a log line, never throwing — the scene never crashes on bad data.

---

## Task 6 — Wire into `src/index.ts` (2 min)

The scene's `main()` is at [`src/index.ts:45`](src/index.ts#L45). Add two new imports and one line at the end of the function:

```ts
// at the top, with the other imports:
import { loadManifest } from './scene/art/manifest'
import { buildArtwork } from './scene/art/build'

// at the end of main():
export function main() {
  // ... all the existing build* calls ...
  buildPavilionHelicopter()

  // NEW: fetch manifest + spawn art. async, but the scene continues to render
  // while this resolves. If fetch fails, baked fallback fires synchronously.
  void loadManifest().then(buildArtwork)
}
```

Don't `await` — `main()` is sync. Fire-and-forget; the manifest fetch happens in parallel with everything else booting up, and pieces appear when it resolves (typically 200-500ms after scene load).

---

## Task 7 — Bake script (5 min)

Add a `prebuild` script to `package.json`:

```json
{
  "scripts": {
    "prebuild": "curl -sf https://phhq-dash.vercel.app/api/manifest -o src/scene/art/manifest.baked.json || echo 'manifest fetch failed; keeping existing baked'",
    "build": "..."
  }
}
```

What `-sf` does: silent + fail-fast (no progress noise, non-zero exit on HTTP errors). The `||` fallback prevents a deploy from breaking if Vercel's down — the existing baked JSON stays in place.

If `curl` isn't available cross-platform (Windows shells vary), replace with a tiny node script:

```js
// scripts/bake-manifest.js
const fs = require('fs')
const https = require('https')
const URL = 'https://phhq-dash.vercel.app/api/manifest'
const OUT = 'src/scene/art/manifest.baked.json'
https.get(URL, (res) => {
  if (res.statusCode !== 200) {
    console.log(`[bake] HTTP ${res.statusCode}; keeping existing baked`)
    return
  }
  const file = fs.createWriteStream(OUT)
  res.pipe(file)
  file.on('finish', () => console.log(`[bake] manifest snapshotted to ${OUT}`))
}).on('error', (e) => console.log(`[bake] failed: ${e.message}; keeping existing baked`))
```

Then `"prebuild": "node scripts/bake-manifest.js"`.

---

## Acceptance criteria

After all 7 tasks:

1. `npx tsc --noEmit` is clean — no type errors.
2. `npm run start` boots the scene. Console shows either `[art] manifest v<N> loaded` (live fetch worked) or `[art] manifest fetch failed, using baked fallback` (expected if Vercel isn't deployed yet or env wasn't configured).
3. With the empty baked manifest, the scene renders normally — no art on walls, no errors. The frame primitives don't fire because there are no anchors with pieces.
4. **Smoke test the renderer**: hand-edit `manifest.baked.json` to include one test anchor + piece (sample below), rebuild, walk to the location, see a real frame appear on the wall. This verifies the end-to-end pipeline before the dashboard is live.

Sample for the baked smoke test (put real values that match a wall you can walk to):

```json
{
  "version": 1,
  "updatedAt": "2026-05-18T12:00:00.000Z",
  "pieces": {
    "test-piece": {
      "id": "test-piece",
      "src": "assets/logos/panelhaus-logo-primary.png",
      "aspect": 1,
      "preferredFrame": "A",
      "title": "Test"
    }
  },
  "anchors": [
    {
      "id": "f1-test-1",
      "area": "f1",
      "x": 16.25,
      "z": 24.5,
      "facing": "E",
      "maxWidth": 2,
      "maxHeight": 3,
      "allowedFrames": ["A"],
      "pieceId": "test-piece",
      "note": "smoke test"
    }
  ]
}
```

Those coordinates come from a real capture in `phhq_build/captures/2026-05-18_capture-01.json`. Walk to F1 east wall around z=24.5 — you should see a 2×3 ink-framed logo.

---

## What NOT to do

- ❌ Don't modify `src/scene/art/frames.ts` — it's the stable contract endpoint.
- ❌ Don't modify the in-scene capture tool (`src/scene/dev/`) unless something specific breaks.
- ❌ Don't change schema field names or add fields not in `phhq_build/schema/manifest.ts`. If the schema needs to change, edit it in the dashboard repo first, then re-copy here.
- ❌ Don't `await` the manifest fetch in `main()` — scene boot is sync.
- ❌ Don't use `console.warn` — DCL's console only exposes `log` and `error`.
- ❌ Don't push to git or run `dcl deploy`. The user does that.

---

## Reference docs (read in this order if you need context)

All in `C:\Users\unrea\projects_claudecode\phhq_build\docs\`:

1. **[DASHBOARD_HANDOFF.md](DASHBOARD_HANDOFF.md)** — the contract. The four promises both repos hold to. Read this first if anything in the schema or coord-system feels ambiguous.
2. **[FRAMES_AND_ASPECTS.md](FRAMES_AND_ASPECTS.md)** — what each frame style does, how aspect ratios interact, the `chooseFrame` logic in prose. Useful for understanding the renderer.
3. **[ART_PIPELINE_PLAN.md](ART_PIPELINE_PLAN.md)** — the original design doc. Older than the others; some details (e.g. anchor ID scheme) have evolved. Use for backstory, not as ground truth.
4. **[ANCHOR_CAPTURE_PLAN.md](ANCHOR_CAPTURE_PLAN.md)** — explains how anchors get into the manifest in the first place. The capture tool is already built; this doc is for context on the data source.
5. **[DASHBOARD_PLAN.md](DASHBOARD_PLAN.md)** — overall dashboard scope. Probably not relevant to your scene-side work unless you need to understand what's live.

In the scene repo:

- [`src/scene/art/frames.ts`](src/scene/art/frames.ts) — the frame primitives. **Read this.** Pay attention to the `FrameSpec` interface (lines 13-21) and the `FRAMES` map (lines 326-333). Your `buildArtwork` calls into this.
- [`src/scene/constants.ts`](src/scene/constants.ts) — floor heights, palette, scene bounds.
- [`src/index.ts`](src/index.ts) — where `main()` lives and where you hook in.

---

## Estimated total time

About 90 minutes for an unfamiliar agent, 45 for someone who knows DCL SDK7. The actual coding is small (7 files, ~150 lines total); most of the time is reading the schema and verifying the smoke test.

Once it's all wired and the smoke test passes, the round-trip is complete: dashboard writes → manifest URL → scene fetches → wall renders.
