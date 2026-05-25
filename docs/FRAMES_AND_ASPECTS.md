# Frames & Aspect Ratios — Curator's Guide

How the **shape** of an anchor (aspect ratio) and the **style** of its frame (A–F) combine to produce what hangs on the wall. Companion to [DASHBOARD_HANDOFF.md](DASHBOARD_HANDOFF.md) and [ANCHOR_CAPTURE_PLAN.md](ANCHOR_CAPTURE_PLAN.md).

## TL;DR — two orthogonal axes

| Axis             | What it controls                      | Picked when                                | Stored on anchor as                   |
| ---------------- | ------------------------------------- | ------------------------------------------ | ------------------------------------- |
| **Aspect ratio** | the bounding box the piece fits into  | at capture (cycle key `3`) or in dashboard | `maxWidth`, `maxHeight` (meters)      |
| **Frame style**  | the visual treatment around the piece | at capture (cycle key `4`) or in dashboard | `allowedFrames` (array of `'A'..'F'`) |

Any frame can wrap any aspect — they're independent. A "Gold" frame can be a square, a portrait, a banner. A "Lightbox" can be wide, tall, or 1:1. The curator picks both.

---

## Aspect ratios

Six presets defined in [`src/scene/dev/anchor-capture.ts`](../../../creator-hub/Scenes/Panel%20Haus%20Party/src/scene/dev/anchor-capture.ts) in the scene repo:

| Cycle label | Shape             | `maxW × maxH` (m) | When to pick                                            |
| ----------- | ----------------- | ----------------- | ------------------------------------------------------- |
| `1:1`       | Square            | 3 × 3             | hero pieces, balanced compositions, default for unknown |
| `2:3`       | Portrait          | 2 × 3             | comic covers, single-figure works, gallery columns      |
| `3:2`       | Landscape         | 3 × 2             | wide compositions, panoramas, photo prints              |
| `16:9`      | Widescreen        | 3.6 × 2           | film stills, screenshots, video-aspect art              |
| `4:1 ↔`     | Horizontal banner | 4 × 1             | wall-spanning headers, story strips                     |
| `1:4 ↕`     | Vertical banner   | 1 × 4             | tall scrolls, column accents, hanging banners           |

**Pieces letterbox into the box.** A piece declares its own `aspect` (width/height ratio) on the dashboard's piece registry. The render function fits the piece into `maxWidth × maxHeight` without distortion — if the piece is portrait and the box is landscape, the piece will be smaller than the full box (with empty box edges on left/right).

So **the anchor's shape doesn't have to match the piece**, but ideally it does for visual fill.

---

## Frame styles

Six styles defined in [`src/scene/art/frames.ts`](../../../creator-hub/Scenes/Panel%20Haus%20Party/src/scene/art/frames.ts) in the scene repo. Each one is a function `frameX({ centerPos, width, height, facing, textureSrc })` that spawns the geometry.

### A — Ink (`frameInk`)

- **Default** — ~95% of pieces should be Ink
- 8 cm black border, 4 cm depth
- No emission, no shine — just a clean ink-black frame
- **Pick for**: any normal gallery wall, any "this is just art" situation

### B — Gold (`frameGold`)

- **Hero only** — when you want the piece to read as Important
- 16 cm ornate gold outer + 4 cm ink bevel inside + 6 cm depth
- Mildly emissive (gold glow), metallic finish
- **Pick for**: atrium hero pieces, Hall of Fame signatures, top-floor prestige slots
- ⚠️ Visual impact diminishes if more than a few exist per scene — keep rare

### C — Lightbox (`frameLightbox`)

- **Emissive** — 30 cm cream halo bleeds outward past the frame edge
- Ink-black frame inside the halo, cream-light glow
- The piece _itself_ is rendered with emission, so it glows
- **Pick for**: F4 stage walls (reads with show lighting), atrium hero pieces (visible across floors), anything you want to "pulse" in low light
- ⚠️ Don't cluster — they compete with each other visually

### D — Frameless (`frameFrameless`)

- **No border** — alpha-keyed plane, the piece floats on the wall
- Requires the piece's image to have a **transparent background** (PNG with alpha)
- Cutout silhouette / freeform shape
- **Pick for**: F5 Pavilion's secret piece (canonical), playful breaks from the grid, brand stickers
- ⚠️ Source images with white backgrounds will look terrible — the curator must verify alpha

### E — Plinth (`framePlinth`)

- **Freestanding** — has a black plinth column rising from the floor with a gold cap, then a thin double-sided art board on top
- Both sides of the board show the texture (intentional)
- **Anchor must be in open space**, not against a wall — both faces are viewable
- **Pick for**: VT lobby (canonical), atrium-floor pieces, any "centerpiece" placement

### F — Hanging Banner (`frameHangingBanner`)

- **Top-bracketed, dangles** — ink-black bracket bar with gold cap above, banner hangs beneath
- The banner is a slim ~1.5 cm thick rectangle, slightly tilted toward the viewer
- **Assumes vertical headroom above the anchor**
- **Pick for**: F3 balcony banners (over the atrium void, canonical), skywalk overhead spans, anything that hangs from a ceiling/structure

---

## How the curator picks

### At capture time (in-scene, the anchor-capture overlay)

Cycle aspect with `3`, cycle frame with `4` (`1` marks, `2` undoes). The live status box shows the current pick:

```
→ F2 · face S · SNAP ◉
x=40  y=14  z=18
16:9 · C-Lightbox        ← current aspect + frame
```

When `MARK` fires, the active values write into the anchor as:

- `maxWidth = aspect.w`
- `maxHeight = aspect.h`
- `allowedFrames = [frame.kind]` (single-element array)

**Defaults** at capture: `1:1` aspect + `A` Ink frame. The curator changes them per-anchor if they have a clear sense of the wall.

### In the dashboard (after import)

The anchor card on the Anchors view should expose:

- **Aspect** — read/edit field for `maxWidth × maxHeight`, with the 6 aspect presets as quick-pick buttons (clicking a preset writes the corresponding `w × h`).
- **Allowed frames** — multi-select of `A`–`F`. Default after capture is the single frame chosen in-scene. The curator can expand the list (e.g. `['A', 'B']` to allow either Ink or Gold) to give the renderer flexibility based on the piece's `preferredFrame`.

### Frame selection at render time (scene side)

When the scene loads the manifest, for each anchor it picks one frame via:

```ts
function chooseFrame(anchor, piece) {
  if (!anchor.allowedFrames) return piece.preferredFrame;
  return anchor.allowedFrames.includes(piece.preferredFrame)
    ? piece.preferredFrame
    : anchor.allowedFrames[0];
}
```

So `allowedFrames` is a **constraint**, not a hard pick. The piece's own `preferredFrame` wins if the anchor permits it; otherwise the anchor falls back to the first allowed.

This is why letting curators broaden `allowedFrames` in the dashboard matters — a `[A, B]` anchor accepts both ink and gold pieces gracefully.

---

## Recipes (common combinations)

| Where                | Aspect             | Frame         | Why                                                   |
| -------------------- | ------------------ | ------------- | ----------------------------------------------------- |
| Atrium hero          | `1:1` or `16:9`    | `C` Lightbox  | reads from all surrounding floors, glow draws the eye |
| F2 main gallery      | `2:3` or `3:2`     | `A` Ink       | clean rotating-show pieces                            |
| F2 gallery hero      | `1:1`              | `B` Gold      | one or two golds per show to anchor the wall          |
| F3 balcony           | `1:4 ↕` or `4:1 ↔` | `F` Banner    | dangle into the atrium void                           |
| F4 stage flanks      | `16:9`             | `C` Lightbox  | emissive competes with show lighting                  |
| F5 Pavilion (Secret) | `2:3`              | `D` Frameless | cutout silhouette as the "you found it" reward        |
| VT lobby plinth      | `1:1` or `2:3`     | `E` Plinth    | freestanding entry piece                              |
| VT residency walls   | `2:3` or `3:2`     | `A` Ink       | uniform across residency floors                       |
| VT F5 Hall of Fame   | `1:1`              | `B` Gold      | hero treatment for past-residents                     |
| VT F6 prestige       | `2:3`              | `B` Gold      | top-floor signature piece                             |
| Skywalk arm          | `4:1 ↔`            | `F` Banner    | long horizontal read while traversing                 |

These are _defaults_, not laws. Break them when the wall or piece calls for it.

---

## Mixing ratios across the venue

A scene with 100% Ink + 100% square feels uniform and dead. A scene with everything Gold-Lightbox-Banner feels chaotic and exhausting. The sweet spot is roughly:

| Bucket                                                | % of anchors | Purpose                                                 |
| ----------------------------------------------------- | ------------ | ------------------------------------------------------- |
| Workhorse — `A` Ink + `1:1`/`2:3`/`3:2`               | ~60%         | safe rotating gallery, doesn't fight the venue          |
| Intentional variation — landscape, portrait, lightbox | ~25%         | breaks the grid, follows the wall's shape               |
| Hero — `B` Gold / `F` Banner / `E` Plinth             | ~15%         | signature pieces, attention anchors, structural moments |

Aim for these as a starting distribution. Tune by walking the venue and asking "does this wall feel boring or busy?"

---

## Hard constraints (not stylistic — these break things)

1. **`E` Plinth requires open floor space**, not a wall. The capture tool can't detect this — the curator must place plinth anchors only on lobby floors, atrium floors, or other open surfaces.
2. **`D` Frameless requires alpha-channel images.** A piece with a JPG (no alpha) will look like a white box. Verify the piece's `src` is a PNG with transparency before assigning to a Frameless anchor.
3. **`F` Banner needs vertical headroom.** Hanging banners need ~`maxHeight + 0.2m` of ceiling space above the anchor's top edge. Capture in spaces that have it (balconies, ceilings, skywalk).
4. **`C` Lightbox is bright.** Multiple lightboxes within 4–5 meters of each other will visually compete. Cluster sparingly.

---

## Anchor card UI (proposed for the dashboard)

What the curator should see on each anchor card in the Anchors view:

```
┌──────────────────────────────────────────────────────────────┐
│ [thumb]  f2-north-01           area: F2          face: S    │
│ [thumb]  "stair-top eye line"                                │
│                                                              │
│          Aspect:  [1:1] [2:3] [3:2] [16:9] [4:1] [1:4]      │
│                   ──── ▢▢▢▢ ──── ──── ──── ────              │
│                   currently: 3 × 3 m                         │
│                                                              │
│          Frames:  [✓ A Ink] [B Gold] [C Lightbox]            │
│                   [D Frameless] [E Plinth] [F Banner]        │
│                                                              │
│          Piece:   [ Smoke Signal — Jane Doe         ▾ ]      │
│                                                              │
│          [ Save ]                                            │
└──────────────────────────────────────────────────────────────┘
```

Aspect presets as quick-pick buttons (clicking writes both w and h); frames as a multi-select (default is the single frame from capture, but the curator can broaden).

---

## What this doc doesn't cover

- **Piece metadata** (artist, title, link, aspect, preferredFrame) — see [ART_PIPELINE_PLAN.md](ART_PIPELINE_PLAN.md) section "Piece registry"
- **How the scene actually renders frames** — read [`src/scene/art/frames.ts`](../../../creator-hub/Scenes/Panel%20Haus%20Party/src/scene/art/frames.ts) in the scene repo
- **Capture tool internals** — see [ANCHOR_CAPTURE_PLAN.md](ANCHOR_CAPTURE_PLAN.md)
- **Schema contract** — see [DASHBOARD_HANDOFF.md](DASHBOARD_HANDOFF.md)
