# Map — Rotating Image Anchors on Their Plane

**Status:** exploration / pre-design
**Date:** 2026-06-02
**Author:** dashboard team
**Scope:** image anchors only (`Anchor` in [schema/manifest.ts:60](../schema/manifest.ts#L60)) — _not_ `BookAnchor` (pedestals are upright and visually round-symmetric, separate question).

## What the curator wants

> "On the dashboard map we need to add the ability to rotate image anchors on whatever plane they are on. Try to make it intuitive."

In plain English: today an anchor's orientation is the 4-way `facing: "N" | "E" | "S" | "W"` enum at [schema/manifest.ts:14](../schema/manifest.ts#L14), cycled via the **↻ N** button at [app/map/map-view.tsx:1841](../app/map/map-view.tsx#L1841). That picks which wall the piece hangs on, but everything is bolted to that wall axis-aligned and level. The curator wants **finer control** — hang a piece as a diamond, tilt a banner 7° to break a perfect line, fan three portraits 15° apart across a wall — without having to model that in the scene by hand.

"On whatever plane they are on" is the load-bearing phrase. An anchor lives on a surface — almost always a vertical wall, sometimes the floor or a balcony banner that reads from below. **Rotation happens around that surface's normal**, not around world Y. That's a single scalar (degrees), not a 3-axis Euler triple, and it keeps the picture flush to the wall — no tipping forward off the surface.

---

## What "rotation" means concretely

For each anchor, we add **one angle** in degrees: the spin of the piece about the surface normal of the wall (or floor) it's mounted on. Zero = current behavior (top of frame points up for walls, points toward `facing` for floor pieces).

This is **not**:

- **Yaw** (which-wall-am-I-on) — `facing` already does that and the curator's word for that is "wall side." Keep it.
- **Pitch** (tilt forward off the wall) — physically you wouldn't, and the scene's wall raycast assumes flush. Out of scope.
- **Full free-yaw on floor pieces** — would let a banner stand at 23° from world-N. The 4-way `facing` covers what curators actually ask for; conflating "spin a portrait into a diamond" with "yaw a freestanding piece" makes both UIs worse.

Single field, single axis, one scalar per anchor. The cheapest thing that solves the request.

---

## Schema change

Add an optional `rotation` to `Anchor` in [schema/manifest.ts:60](../schema/manifest.ts#L60):

```ts
export const Anchor = z.object({
  // ...existing fields...
  // Rotation about the surface normal, degrees, CW positive when looking AT
  // the piece from where a visitor stands. Range [-180, 180]. Absent = 0
  // (top of frame points up — current behavior). Curator-set via the map
  // dashboard's rotation handle.
  rotation: z.number().min(-180).max(180).optional(),
});
```

**Why optional and not `.default(0)`:** every existing anchor in the manifest survives the upgrade with no migration — `undefined` means "do nothing different." The scene reads `rotation ?? 0`. Same pattern we used for `y` at [schema/manifest.ts:68](../schema/manifest.ts#L68).

**Why degrees not radians:** the input is curator-facing. Nobody types `0.2618` for "15°."

**Why `[-180, 180]` not `[0, 360]`:** signed degrees make "tilt 7° clockwise vs counter" read naturally. Easier mental model for nudging.

**Why CW-positive looking AT the piece:** matches what the curator sees on the map — clicking the right side of a rotation handle should make the angle go up. Spelled out in the comment because every codebase that has rotation eventually has this argument.

**Scene contract:** scene-side change is small but real — reading `rotation` on the anchor and applying it as roll on the piece quad. Needs the same SYNC dance as any schema change ([schema/manifest.ts:3-6](../schema/manifest.ts#L3-L6)). Until the scene ships its half, the dashboard can save rotations the scene ignores — no visual effect but no breakage either, which is a safe rollout order.

---

## UI proposals — three to weigh

The whole point of "make it intuitive" is the UI, so this is the rest of the doc. Three candidate primitives, ordered from "most direct" to "most discoverable from existing patterns."

### A. Drag-to-rotate handle on the SVG anchor (recommended)

When an anchor is selected, render a **rotation ring** around its circle on the map SVG — a faint ring with a tick at the top showing the current angle, and a small grabbable dot at the tick. Click-and-drag the dot in a circle, the anchor rotates live. Release to commit.

Concretely, around the selected circle at [app/map/map-view.tsx:1271-1296](../app/map/map-view.tsx#L1271-L1296):

```
        ↑
       ╱
      ●   ← drag dot at radius ~4m, snaps every 15° unless Alt held
     ╱
    ●     ← anchor center (existing circle, r=1.8)
```

- Hold **Shift** while dragging → snap every 5°
- Hold **Alt** → free (no snap)
- Default → snap every 15°
- Double-click the dot → reset to 0°
- The existing facing arrow (the little black line at [app/map/map-view.tsx:1255-1263](../app/map/map-view.tsx#L1255-L1263)) keeps pointing in the `facing` direction; it's "which wall," not "what rotation." The rotation tick on the ring points in the visual top-of-frame direction.

**Why this is the recommended primitive:**

1. **It looks like rotation.** A ring you spin around the object is the universal "this rotates" affordance from Figma / Sketch / Photoshop / Blender / any 3D tool. Curators will recognize it without a tutorial.
2. **The result is visible while you drag.** Numeric inputs hide the answer until you commit; a drag handle shows you the diamond at 45° in real time.
3. **It fits the existing SVG.** The map is already an SVG with anchor circles you click and drag-to-place isn't far from this. No new component type.
4. **It composes with multi-select** (see §"Multi-select" below).

**Costs:**

- More SVG event wiring than B or C. The drag math is straightforward — `atan2(dy, dx)` of the cursor relative to the anchor center — but you do need pointer capture so the user can drag outside the ring without losing the rotation.
- Hit-testing the ring near existing anchors needs care; an unselected anchor 4m away mustn't intercept the drag.

### B. Numeric input + ±15° buttons in the detail card

In the right-hand selected-anchor card, under the existing **Position · facing** block at [app/map/map-view.tsx:1727](../app/map/map-view.tsx#L1727), add a **Rotation** row with the same shape as the x/y/z nudge rows:

```
rotation   [−][  0.0°  ][+]   ↻ 0°
                              ↺ snap to 0/45/90
```

- `[−]` / `[+]` step 15° (Shift = 90°, Alt = 1°), mirroring the position nudge convention at [app/map/map-view.tsx:1730-1750](../app/map/map-view.tsx#L1730-L1750).
- The numeric field accepts free entry; blur to commit (matches the W/H field at [app/map/map-view.tsx:1876-1898](../app/map/map-view.tsx#L1876-L1898)).
- A small **↺ snap** chip cycles 0 → 15 → 30 → 45 → 90 → 0.

**Why this is worth considering instead of A:**

- Zero new interaction model — everything is keyboard / button, same as the rest of the card.
- Keyboard accessible by default.
- Survives a 200px-wide column trivially.

**Why it's worse than A:**

- Curators don't think "+15°," they think "tilt it a bit." Numeric entry is the language of CAD, not gallery hanging.
- No live preview on the canvas while you scrub — you guess, click, look, repeat.

### C. Rotation in keyboard nudge mode (additive to A or B, not a primary)

The existing keyboard nudge at [app/map/map-view.tsx:139-163](../app/map/map-view.tsx#L139-L163) maps arrows to x/z and PageUp/PageDown to y. We can add **`[` / `]`** (or `,` / `.`) for "rotate -15° / +15°" with the same modifier convention (Shift = 5×, Alt = 1°).

This isn't a standalone option — it's the keyboard half of A. Curators who land on an anchor's detail card by clicking and then want to nudge angles without grabbing the mouse get a path that matches the rest of the surface.

---

## How the three options fit together

The shipping plan is **A + B + C as one feature**, not "pick one":

- **A** is the canvas-side primary affordance — what a curator reaches for when they want to see the rotation while choosing it.
- **B** is the precision fallback — "I need exactly 7°" or "I want to type 90° because I know the answer." Lives in the detail card next to the rest of the numeric fields.
- **C** is the keyboard hotkey that mirrors A's effect for accessibility + speed.

All three write the same `rotation` field. The detail card numeric input updates while you drag the ring; the ring follows when you type into the input. Same data, three editors, no modes.

---

## Where on the screen everything lives

```
┌──────────────────────────────────────┬───────────────────────────┐
│                                      │  Selected anchor          │
│   [floor map SVG]                    │  f2-12                    │
│                                      │                           │
│        ●—↑      ← ring + tick        │  [preview thumb]          │
│       /  \     when this one is sel  │                           │
│      ●    ●    ← drag dot            │  Position · facing        │
│       \  /                           │   x [−] 32.50 [+]         │
│        ●                             │   z [−] 16.00 [+]         │
│                                      │   y [−] 1.20  [+] auto    │
│                                      │   ↻ S   (facing button)   │
│                                      │                           │
│                                      │  Rotation     ← NEW       │
│                                      │   [−] 0.0° [+]  ↺ snap    │
│                                      │                           │
│                                      │  Size  [presets]          │
│                                      │   W ...  H ...            │
└──────────────────────────────────────┴───────────────────────────┘
```

The rotation row sits **after** Position·facing and **before** Size, because "where + which way" is one mental group ("placement") and rotation belongs at the end of that group rather than at the start of sizing.

---

## Edge cases worth deciding now

### Width / height when rotated

`Anchor.maxWidth` / `maxHeight` ([schema/manifest.ts:70-71](../schema/manifest.ts#L70-L71)) are in piece-local axes — width = "along the piece's horizontal," height = "along the piece's vertical." Rotation rotates the piece, _it does not redefine which dimension is which_. A 4m × 1m banner rotated 90° is still `maxWidth: 4, maxHeight: 1` — just hanging vertically.

This matters because the aspect presets at [app/map/floor-data.ts:244-255](../app/map/floor-data.ts#L244-L255) keep their meaning: "1:4 ↕" stays a tall sliver whether the curator rotates it or not. Curators don't have to mentally swap W/H when they rotate.

### Selection visuals when an anchor is rotated

The current selected-circle outline at [app/map/map-view.tsx:1271-1296](../app/map/map-view.tsx#L1271-L1296) is round, so rotation has no visual on the dot itself. The **rotation ring** is the indicator. For unselected anchors, draw a tiny tick mark on the existing facing arrow's far end pointing in the rotation direction — so you can see at a glance "that one's tilted" without having to click into it. If `rotation === 0` or undefined, no tick — keeps the unrotated map clean.

### Multi-select bulk rotate

The existing multi-select pattern at [app/map/map-view.tsx:2346-2348](../app/map/map-view.tsx#L2346-L2348) supports bulk patches (facing, frame, size). Add bulk rotation:

- **Same delta to each** — "rotate every selected anchor by +15°." Simplest. Doesn't fan them around a common center.
- **Same absolute value** — "set them all to 45°." Useful when you want a row of matching diamonds.
- **Fan around group centroid** — "spread these 5 evenly from -30° to +30°." Stunt feature; ship later if asked.

V1: same-delta and same-absolute, both via the existing multi-select card pattern at [app/map/map-view.tsx:2514](../app/map/map-view.tsx#L2514) ("Set facing for all" — copy/paste with `rotation`). Skip the fan for v1.

### Floor pieces (banners viewed from below) vs wall pieces

The schema doesn't distinguish — an anchor with `facing: "N"` on F3's balcony could be a banner hanging over the atrium edge, or a wall piece, depending on placement. The scene side decides which surface to project onto based on (x, z) and `facing`.

The rotation field is **agnostic** to that decision. Whatever surface the scene picks, rotation spins the piece about _that_ surface's normal. This means the dashboard UI doesn't have to know "is this a banner or a wall" — the ring drag means the same thing either way, and the scene applies it correctly.

### Conflict with the row-fill / patterns work

Row fill at [lib/row-fill.ts](../lib/row-fill.ts) and the patterns plan at [docs/archive/ANCHOR_PATTERNS_PLAN.md](./archive/ANCHOR_PATTERNS_PLAN.md) generate multiple anchors from one seed. **All generated anchors inherit the seed's rotation.** Single field; trivial to propagate; matches what curators expect ("the seed says diamond; the row is diamonds"). Document and move on.

### Cloning

`cloneAnchor` at [lib/row-fill.ts](../lib/row-fill.ts) and the duplicate path at [app/map/map-view.tsx:516](../app/map/map-view.tsx#L516) need to copy `rotation` through. One-line each.

### Capture import

The in-scene anchor capture tool at [schema/manifest.ts:267](../schema/manifest.ts#L267) re-imports anchors from the scene. Once the scene supports `rotation`, captured anchors include it; before then, they don't (and that's fine — `undefined` = 0). The Zod schema does the right thing.

---

## What ships in v1

1. **Schema:** add optional `rotation` to `Anchor`. SYNC to scene repo.
2. **Map SVG (Option A):** rotation ring + drag dot for the selected anchor. 15° snap default; Shift = 5°; Alt = free; double-click = reset.
3. **Detail card (Option B):** numeric rotation row with ± buttons and snap chip, next to Position·facing.
4. **Keyboard (Option C):** `[` / `]` rotate -15° / +15°, Shift/Alt modifiers same as position nudge.
5. **Multi-select bulk:** same-delta and same-absolute rotation in the multi-anchor card.
6. **Visuals on unrotated map:** small tick on the facing arrow's tip when `rotation !== 0` and the anchor isn't selected.
7. **Clone/duplicate/row-fill:** propagate `rotation`.

What's **not** in v1:

- Fan-around-centroid for multi-select (stunt).
- Free yaw on floor pieces (already covered by `facing`).
- Rotation animation in the scene (out of scope; static angle only).
- A separate "rotation" entry in the bulk nudge keyboard handler — `[`/`]` work in single-select; bulk rotation is via the multi card.

---

## Decisions (resolved 2026-06-02)

1. **Units at the API layer: degrees.** Schema stores degrees (curator-friendly); the scene converts to radians on read. Mirrors how `heightM` is meters not centimeters — the wire format reads like the dashboard input, not like the consumer's math.
2. **Ring radius: fixed in SVG units.** Every rotation ring is the same size on screen regardless of the piece's `maxWidth`. Radius ~4 SVG units, same scale as the existing facing arrow length at [app/map/map-view.tsx:64](../app/map/map-view.tsx#L64). Predictable hit target across a wall of mixed-size anchors.
3. **No "snap to neighbors" smart angle.** Curator drives the rotation; the dashboard doesn't propose alignments. Reconsider only if curators ask after v1.
4. **Tag-filter: no interaction.** The ring attaches only to the selected anchor; tag-filtered-out anchors don't grow rings even if you Shift-click through them. Filters affect _visibility_, not _interaction primitives_.

---

## Why not just expand `facing` to 8-way (N/NE/E/SE/...)?

Considered and rejected:

- **8 directions don't cover 7°.** Curators want fine control, not coarse-finer-coarse.
- **Mixes two concepts** — `facing` is "which wall side," rotation is "spin in plane." A diagonal facing would imply the piece is mounted on a diagonal wall, which doesn't exist in the building's geometry ([app/map/floor-data.ts](./../app/map/floor-data.ts) — every parcel is axis-aligned).
- **Breaks the scene's wall-snap logic** — `facing` currently picks one of four wall normals; turning it into an angle would force the scene to either round-trip to the nearest wall or invent diagonal walls. Both worse than adding one new scalar.

Keep `facing` as the wall picker. Add `rotation` as the in-plane spin. They're orthogonal in the math and orthogonal in the UI.
