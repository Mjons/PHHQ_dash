# Anchor Patterns — Pre-Made Hang Layouts that Fill a Wall

**Status:** exploration / pre-design
**Date:** 2026-05-18
**Author:** dashboard team

## What the curator wants

> "We know the size of a parcel. We know the size of our image. We can extrapolate the size of a full wall. So it would be neat if we had some pre-made patterns which could be applied to any length — once we set the first anchor, it would just fill in all the anchors."

Plus a small UX nit that falls out of it:

> "If 2 anchors are in the same Y position on the dash map, the one above can be a different color, 50% transparent and 50% as large — so we can click them both."

In plain English: today the curator places **one anchor per click** in placement mode ([app/map/map-view.tsx:98](../app/map/map-view.tsx#L98)). For an evenly hung 4-up frieze along F2's south wall, that's four clicks, four times typing dimensions, four times picking facing. The geometry that decides "evenly spaced along this 48m wall" is something the dashboard **already knows enough to compute** — the parcel grid lives in [app/map/floor-data.ts](../app/map/floor-data.ts), piece dimensions live in the manifest. We should be doing this for them.

A **pattern** = a parametric arrangement of N anchors (count, pitch, height-row, facing all derived from a single seed click + the wall it landed on). Pick the pattern, click the seed anchor, hit commit — N anchors land in one save.

The second request — overlapping anchor disambiguation — is a real annoyance the patterns make worse (a salon-row pattern will sometimes co-locate two anchors at the same x,z by design, e.g., a tall portrait stacked over a wide landscape). Today both circles draw at the same screen pixel and only one is clickable. Fix: when N anchors share the same (x,z) on the active floor, render the first at full size and stagger the rest at 50% size + 50% alpha in a different color. Both clickable, visually stacked, no schema change required.

This doc covers both — they're small enough to bundle and the second falls out of the first.

---

## Why this is even tractable

Three things line up that make pattern-fill not vaporware:

1. **The grid is fixed and regular.** Every floor in [app/map/floor-data.ts:54](../app/map/floor-data.ts#L54) is described as a list of 16×16m parcel corners. The wall a curator clicks against is always on a parcel edge, and wall length is always a multiple of 16m. No "is this even a wall" ambiguity.

2. **Piece sizes are already first-class.** `Anchor.maxWidth` / `maxHeight` are in meters in [schema/manifest.ts:46-47](../schema/manifest.ts#L46-L47), and the aspect presets at [app/map/floor-data.ts:196](../app/map/floor-data.ts#L196) give us a known palette (1:1 @ 3m, 2:3 @ 2m wide, 3:2 @ 3m wide, 16:9 @ 3.6m, 4:1 banner @ 4m, 1:4 portrait @ 1m wide). A pattern that says "place 4 of the 3:2 preset" knows exactly how much wall they consume.

3. **Facing implies wall orientation, unambiguously.** A piece facing S sits on a wall that runs E↔W; facing E sits on a wall running N↔S ([app/map/map-view.tsx:41](../app/map/map-view.tsx#L41)). Given seed `(x, z, facing)` we know which axis to march along to find adjacent anchors.

Together: seed click → know which wall, know its length, know piece footprint → solve for N positions deterministically.

---

## Pattern catalog (v1 — five worth shipping)

Start with the smallest set that covers ~90% of how the curator actually hangs. Each pattern is a function `(seedAnchor, wallLength, params) → AnchorT[]`.

### 1. Even row

N anchors of identical size, evenly spaced along the seed's wall. Curator picks: aspect preset, N (or "fill"), and whether spacing is "equal gap between pieces" or "equal center-to-center."

- **Equal gap:** gap `g = (L - N·w) / (N + 1)`; centers at `g + w/2 + i·(w + g)`.
- **Equal pitch:** pitch `p = L / N`; centers at `(i + 0.5)·p`.
- **Fill:** N = `floor((L - g_min) / (w + g_min))` where `g_min` is a minimum gap (e.g., 0.5m). Common case — "as many as fit with breathing room."

This single pattern covers ~half the use cases on its own.

### 2. Triptych

Three anchors, centered on the wall, with curator-set inter-piece gap (default 0.3m — frame-touch close). Aspect defaults to 2:3 portrait. Common for hero walls. Mathematically a special case of #1 but worth a dedicated tile because curators think of it as a thing, not a config.

### 3. Mirror pair

Two anchors equidistant from the wall midpoint, with curator-set spread. Bookend a doorway or a feature. Aspect can differ between left and right if curator toggles "asymmetric" (otherwise mirrored).

### 4. Grid

`rows × cols` of identical anchors. Adds a vertical dimension via a `heightOffset` parameter (in meters, from anchor base) per row. Today this _cannot_ be represented in the schema — anchors have no Y — see §"Schema: vertical stacking" below. For v1 the grid pattern emits anchors with **identical (x,z) per column, different array indices**, and the disambiguation viz (next section) makes them clickable. The scene-side height of each row comes from a new optional `Anchor.shelf` field or from convention (insertion order).

### 5. Frieze (tile-along-wall)

Repeat a single piece footprint edge-to-edge along the wall. Curator picks aspect + max count. Different from "even row with N pieces" because the answer is "however many fit." Useful for long Skywalk arm hangs and F5 bridge banners.

### Optional v1.5 patterns

- **Salon cluster** — a hand-curated set of relative offsets (e.g., big center piece + 4 satellite portraits). Defined as a JSON file in `lib/anchor-patterns/`. Curator places origin; the cluster lands relative to it. Different from #1-5 in that it's hand-shaped, not parametric.
- **Stair-step** — series of anchors descending in Y across X. Pure stunt; only ships if asked.

---

## How wall length is derived from a seed click

This is the load-bearing piece of math. Pseudocode:

```ts
// Given a seed anchor (x, z, facing) on a floor:
function wallLengthFromSeed(
  area: AreaT,
  x: number,
  z: number,
  facing: FacingT,
): { start: Point; end: Point; lengthM: number } {
  const parcels = FLOORS[area].parcels;
  const axis = facing === "N" || facing === "S" ? "x" : "z";
  // Walk +axis and -axis from (x,z) while a parcel exists at the
  // current step that hosts this wall edge.
  const positive = walk(parcels, x, z, axis, +1);
  const negative = walk(parcels, x, z, axis, -1);
  return {
    start: negative.lastPoint,
    end: positive.lastPoint,
    lengthM: positive.distance + negative.distance,
  };
}
```

The trick in `walk(...)`: a "wall edge" is the side of a 16×16m parcel facing a direction in which there is **no other parcel** (otherwise it's an internal wall — passable, not hangable). So tracing along a wall = stepping by 16m in the axis direction while

- the current parcel contains the wall edge, AND
- the parcel immediately on the _facing_ side is missing from `floor.parcels`.

That second clause is what makes F2's south wall stop at the building exterior, not bleed into a phantom 9th parcel.

For seed coordinates that don't land exactly on a parcel edge (the curator clicked 0.7m into the interior of a parcel — common in the map UI), snap to the nearest edge in the facing direction before tracing. The `snap()` helper at [app/map/map-view.tsx:39](../app/map/map-view.tsx#L39) already does 0.5m snapping; pattern-fill should additionally snap-to-edge.

This wall-tracing utility goes in a new `lib/anchor-walls.ts` since it'll get reused by the Map view legend and by future "wall stats" UI. Pure function, easy to unit test against `FLOORS`.

### Concrete example — F2 south wall

F2's parcels at z=48 are `[16,48], [32,48], [48,48], [64,48]` — four parcels spanning x=16→80, a 64m run. Facing N (i.e., the piece is on the south wall of the building looking north into the gallery) → axis = x. Trace +x and -x from seed → length 64m. Place a 4-up even row of 2:3 portraits (w=2m each): gap = `(64 - 4·2) / 5 = 11.2m` per gap. Place a 6-up frieze of 16:9 (w=3.6m): gap = `(64 - 6·3.6) / 7 ≈ 6.06m`.

The math is boring on purpose; that's the point.

---

## Schema: vertical stacking (the elephant)

Anchors today have `x`, `z`, no `y`. The curator's mental model for some patterns (salon hang, grid) _does_ include height — a portrait at 1.6m floor-up, another above it at 3.2m floor-up, same (x,z). Two options:

### Option A — keep schema, use array order

Place two anchors at identical (x,z), let the renderer decide vertical placement by:

- A new optional `Anchor.shelf?: number` field (0 = floor, 1 = above, 2 = above that) defaulting to 0 if absent.
- Or pure array order: first one wins eye-level, subsequent ones stack up by a fixed 1.5m offset.

**Pro:** zero scene-side risk if we default to single-shelf. Backwards compatible — every existing anchor implicitly `shelf=0`. Patterns that don't stack (1, 2, 3, 5) never touch this.
**Con:** "shelf 1 = 1.5m above shelf 0" is a magic constant. Could turn into a curator footgun if pieces are tall ("my 3m banner is overlapping the shelf-1 piece"). Mitigation: scene-side renderer validates `shelf_n.y > shelf_{n-1}.y + shelf_{n-1}.maxHeight` and warns.

### Option B — add `Anchor.y`

A proper Y coordinate (meters above floor). Forces explicit thinking; matches what the scene already knows about (frames anchor at this elevation).

**Pro:** unambiguous. Salon hangs become arithmetic.
**Con:** every existing anchor needs a migration to set `y` (or it defaults to some value the renderer chooses — back to magic). And it'd need to be added to the capture tool, the import flow, the AnchorCard UI, the map detail card. Bigger change.

### Recommendation

**Option A with `shelf?: number`.** It's the smallest schema delta (one optional field), most patterns don't use it, and we can promote to Option B if the curator hits the "my banner is the wrong height" wall. The disambiguation viz handles the map-side clarity for free; the scene renderer just needs a `shelfHeights = [1.6, 3.2, 4.8]` lookup table or per-area override.

This is also the minimum change that lets the **overlap-fix** make sense as a useful feature (otherwise we're just making it easier to click coincidentally-identical anchors, which mostly means "I made a mistake").

---

## Overlapping anchor viz — the small UX request

Today in [app/map/map-view.tsx:657-737](../app/map/map-view.tsx#L657-L737), each anchor renders as a `<circle r={1.8}>` at `flipX(a.x), flipZ(a.z)`. Two anchors at the same (x,z) collapse to one pixel and only the top one (last in the array) catches clicks because of SVG z-order.

The fix is local — only the render loop changes:

```ts
// Before the render loop, bucket anchors by their (x,z) key:
const buckets = new Map<string, AnchorT[]>();
for (const a of anchorsOnFloor) {
  const k = `${a.x.toFixed(3)},${a.z.toFixed(3)}`;
  (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(a);
}

// In the render: for each bucket, render the first at full size, then
// each subsequent one offset by a small rotation around the shared
// center, at 50% radius / 50% alpha / different fill.
```

Visual recipe per the curator's spec:

| Stack index | Radius     | Fill                      | Alpha | Offset                                             |
| ----------- | ---------- | ------------------------- | ----- | -------------------------------------------------- |
| 0           | 1.8 (full) | gold/cream/coral as today | 1.0   | 0                                                  |
| 1           | 0.9 (half) | **coral**                 | 0.5   | (cos 0°, sin 0°) · 2.2 m = (2.2, 0) — to the right |
| 2           | 0.9        | **purple/violet**         | 0.5   | (cos 120°, sin 120°) — upper-left                  |
| 3           | 0.9        | **teal**                  | 0.5   | (cos 240°, sin 240°) — lower-left                  |

Each satellite is its own clickable `<circle>` with its own `onClick` that calls `setSelectedId(satellite.id)`. The full-size primary still selects on click. The detail card on the right side reflects whichever the curator picked. The label text shifts to render below the bucket rather than to the right when bucket size > 1, to avoid the label colliding with the satellites.

**Why coral/violet/teal in that order:** stays inside the existing palette referenced at [app/map/map-view.tsx:914-931](../app/map/map-view.tsx#L914-L931); coral already means "selected" so use it last? Actually no — re-order to **not** clash with selected. Suggested: violet → teal → orange-muted, never reusing coral. Trivial detail, settle in review.

**Edge case:** if bucket size > 4, fan more tightly (radius decays) or drop a "+3 more" badge that opens a list popover. Probably never happens — curator-built clusters max out at 3-4.

### Tag-filter interaction

The existing tag filter at [app/map/map-view.tsx:307-309](../app/map/map-view.tsx#L307-L309) dims hidden anchors to opacity 0.12. With buckets, the dim applies per-anchor — if 2 of 3 in a bucket are filtered out, the surviving one renders normally. Fine; no extra work.

---

## UI flow for pattern fill

One new top-bar button on the Map view next to "+ Add anchor" at [app/map/map-view.tsx:321](../app/map/map-view.tsx#L321):

```
[+ Add anchor]  [⊞ Apply pattern]
```

Click "Apply pattern" → side panel replaces the DraftForm with a **PatternForm**:

1. **Pattern picker** (5 tiles): Even row · Triptych · Mirror pair · Grid · Frieze.
2. **Per-pattern params:** aspect preset (radio), count (number), spacing mode (toggle), shelf count (grid only). Sensible defaults so the form opens usable.
3. **Origin click prompt:** "Click your seed point on the map." The map enters a placement mode similar to today's but distinguished by a different ghost color (purple, not coral).
4. **Live preview:** as soon as the seed is placed, the map shows N **draft ghost** circles for the computed anchor positions, sized to scale. Mousing over a draft shows its computed `(x, z, w, h)`.
5. **Commit:** "Place 6 anchors" button. One `POST /api/manifest` with all new anchors appended. Toast says "Placed 6 anchors via Even row · v123."
6. **Undo affordance:** since this is a multi-anchor create, the toast offers an "Undo" that immediately POSTs another manifest with those 6 IDs removed. Lives only in the toast for the 2.2s it's shown (matches existing toast timing at [app/map/map-view.tsx:95](../app/map/map-view.tsx#L95)).

ID assignment for pattern-created anchors: `<area>-<pattern>-<seq>` e.g., `f2-row-1`, `f2-row-2`, … or `f3-triptych-l/c/r`. Uniqueness checked the same way `startCreate()` checks today at [app/map/map-view.tsx:100-103](../app/map/map-view.tsx#L100-L103) — bump suffix until free.

### Pattern preview = ghost anchors

Implement preview by reusing the existing draft circle pattern at [app/map/map-view.tsx:739-790](../app/map/map-view.tsx#L739-L790) but as an array. Each ghost renders with the dashed-coral style and isn't clickable. On commit, ghosts → real anchors → render normally.

---

## Schema changes — minimal

If we go Option A for stacking, append one optional field at [schema/manifest.ts:40](../schema/manifest.ts#L40):

```ts
export const Anchor = z.object({
  // ... existing fields ...
  shelf: z.number().int().nonnegative().optional(), // vertical row, default 0
});
```

Plus an optional `source` tag for bookkeeping (so we know which anchors came from a pattern and can offer "delete entire pattern" later):

```ts
  source: z.object({
    pattern: z.string(),   // "even-row" | "triptych" | ...
    groupId: z.string(),   // shared across the N anchors created together
  }).optional(),
```

`source` is purely metadata — the scene ignores it, the dashboard uses it to draw a faint connector line between pattern siblings on hover and to power "select all in this pattern → delete."

Both are optional so the migration is zero — every existing anchor stays valid. Scene side never sees a behavior change unless it opts into the shelf table.

---

## API surface — none

No new endpoints. Pattern fill is a **pure client-side computation** that produces N anchors and submits them via the existing `POST /api/manifest` at [app/api/manifest/route.ts:27](../app/api/manifest/route.ts#L27). The server doesn't need to know patterns exist. The same Zod validation that catches a bad single-anchor edit will catch a bad pattern.

This is a deliberate choice: it means the wall-length math lives in `lib/anchor-walls.ts` (pure, testable, hot-reloads with the UI) and we don't pay the cost of a server contract for a UI feature.

---

## Risks / open questions

- **Wall ambiguity at corners.** If the curator seeds an anchor at exactly a parcel corner (x=32, z=48 say), there are two walls meeting there. Today we'd guess from `facing` — but if facing is ambiguous (curator hasn't set it yet), the pattern form needs to ask. Mitigation: form requires facing before showing the seed prompt, so by the time they click, we know which wall.
- **Wall length when an anchor sits _between_ parcels.** Today nothing prevents an anchor at z=47.7 instead of z=48. The wall tracer should round to the nearest 16m grid line before tracing, or refuse and show "Move your seed to a parcel edge."
- **Pattern × bridge / pathway.** F5's bridge ([app/map/floor-data.ts:131](../app/map/floor-data.ts#L131)) and the skywalk arms ([app/map/floor-data.ts:187-190](../app/map/floor-data.ts#L187-L190)) aren't `parcels` in the same array — they're separate `Rect`s. The wall tracer should treat their long edges as hangable. Probably means generalizing "wall" away from "parcel edge" to "edge in `floor.parcels ∪ floor.bridges ∪ floor.pathways`." Worth a careful look during implementation; might justify a unified `floor.walls: Wall[]` schema rewrite later (out of scope here).
- **Pieces don't always equal anchor width.** A pattern says "6 anchors at 3.6m" but the piece assigned to anchor 4 is a tall portrait → letterbox bars on a 3.6m anchor. That's fine, the scene's letterbox renderer handles it. But it might surprise the curator who set `maxWidth=3.6` expecting a tile-perfect row. UI nudge: pattern picker shows a footprint preview using the chosen aspect so the curator commits with eyes open.
- **Undo window.** A 2.2s toast undo is too short for a 6-anchor mistake. Bump pattern-fill toasts to 8s and stash the pre-commit manifest in component state so undo is one POST. Worth noting because it's a behavior delta from regular single-anchor undo (which is just "delete this one").
- **Disambiguation when MORE than two anchors stack.** Spec'd above (fan out at 120°/90° as bucket grows), but if patterns start producing 4+ co-located anchors, the rosette gets crowded. Soft cap at 4 visible, "+N more" pill above 4.

---

## Estimate

- `lib/anchor-walls.ts` — wall tracer, pure functions, unit-tested: **half day**.
- `lib/anchor-patterns.ts` — 5 pattern generators, takes seed + wall + params, returns anchors: **half day**.
- Map view: PatternForm panel, ghost-preview render loop, commit flow: **1 day**.
- Overlap-disambiguation viz: bucket-by-(x,z), satellite render, click routing: **half day**.
- Schema `shelf?` + `source?` additions + scene-side shelf table (deferred to scene team, single value lookup): **half day**.

Total **~3 days** for both ideas. Both ship behind nothing — pattern button is just absent until merged, and the overlap viz is harmless when no anchors collide (it's a fast no-op for bucket size 1).

---

## Out of scope (so we don't conflate)

- **Pattern templates for entire floors.** A pattern that places anchors across multiple walls in one go ("hang the whole F2"). The current proposal is single-wall seeded. Multi-wall is one composition layer above and trivial to add once single-wall patterns exist (a "macro" = list of pattern invocations).
- **Pattern-aware piece placement.** Patterns place _anchors_, not pieces. Auto-assigning pieces to a freshly-placed row (e.g., "fill this even-row with the next 6 untagged pieces") is a separate workflow — touches the Pieces tab, not Map.
- **3D preview.** No attempt to show the actual scene-side rendering of the pattern. The map preview is footprint-only; for "what does it look like in scene" the curator opens preview.decentraland.org. If we ever ship an iframe-embedded scene preview that's its own project.
- **Custom user-defined patterns.** Curator-authored cluster shapes (drag a few anchors into a shape, save as "my pattern"). Add post-v1 once the catalog stabilizes — saving an array of relative offsets to Redis is easy, the UI to edit them isn't.
