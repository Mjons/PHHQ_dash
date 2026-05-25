# Row Fill — V1 prototype

**Status:** ready to build (~1 day)
**Date:** 2026-05-18
**Supersedes for v1:** the catalog described in [ANCHOR_PATTERNS_PLAN.md](./ANCHOR_PATTERNS_PLAN.md). That doc stays as the bigger picture; this is the smallest slice we actually ship.

## The pitch

Take an anchor that already exists. Click "Fill row." The dashboard clones it along its wall — same size, same facing, same frame, same tags — until the wall runs out. Spacing defaults to **0.5 m** between piece edges; an input lets the curator override.

That's the entire feature. One button, one number, N anchors.

## Why this and only this

The exploration doc spec'd a 5-pattern catalog with a picker UI, ghost preview, pattern grouping, optional shelf field, etc. Most of that is dev cost defending against use cases we haven't observed. Ship one pattern, hardcode the parameters off the seed anchor, see if the curator actually uses it. If "Fill row" gets pressed three times in a month, build the rest. If not, the whole thing rips out in one file.

The seed anchor _is_ the config — no separate "pick aspect / pick frame / pick count" step. Curator already did that work when they placed the first anchor.

## User flow

1. Curator creates anchor as today via "+ Add anchor" or Anchors tab. Sets facing, size, frame.
2. Selects the anchor on the Map view; the DetailCard at [app/map/map-view.tsx:940](../app/map/map-view.tsx#L940) renders.
3. New section in DetailCard: **Fill wall**, with a 0.5 m gap input and a "Fill row →" button.
4. Click → ghost previews render on the map at the computed positions.
5. "Place N anchors" confirms; one POST `/api/manifest` saves seed + clones.
6. Toast: `Filled wall · 5 anchors · v124`. Undo toast extends to 6 s (vs the current 2.2 s) to give time on a multi-anchor commit.

No new placement mode. No pattern picker. The detail card just gains one section.

## Math

```ts
// lib/row-fill.ts
import type { AnchorT, FacingT } from "@/schema/manifest";
import type { Floor } from "@/app/map/floor-data";

export function rowFillPositions(
  seed: AnchorT,
  gapM: number,
  floor: Floor,
): Array<{ x: number; z: number }> {
  const horizontalWall = seed.facing === "N" || seed.facing === "S";
  const axisVal = horizontalWall ? seed.x : seed.z;
  const pieceSize = horizontalWall ? seed.maxWidth : seed.maxHeight;
  const step = pieceSize + gapM;
  const half = pieceSize / 2;

  const wall = traceWall(seed, floor); // { min, max } in meters along axis

  const out: Array<{ x: number; z: number }> = [{ x: seed.x, z: seed.z }];
  // March outward in both directions from the seed; keep positions whose
  // full footprint fits inside the wall extents.
  for (let p = axisVal + step; p + half <= wall.max; p += step) {
    out.push(horizontalWall ? { x: p, z: seed.z } : { x: seed.x, z: p });
  }
  for (let p = axisVal - step; p - half >= wall.min; p -= step) {
    out.push(horizontalWall ? { x: p, z: seed.z } : { x: seed.x, z: p });
  }
  return out;
}
```

`traceWall(seed, floor)`: snap the seed's perpendicular coord (z for an N/S-facing piece, x for E/W) to the nearest 16 m parcel grid line, then take the contiguous run of `floor.parcels` that includes that coord and return its axis extent (`min`, `max`, in meters). One-screen function — see implementation notes below.

## Anchor cloning

Each clone inherits everything from the seed **except**:

| Field           | Clone value                                      |
| --------------- | ------------------------------------------------ |
| `id`            | `<seed.id>-2`, `-3`, … skipping already-taken    |
| `x` / `z`       | from `rowFillPositions`                          |
| `pieceId`       | `null` — always empty, never duplicate the piece |
| `note`          | cleared                                          |
| `tags`          | copied (so tag-filter finds them as a set)       |
| everything else | copied verbatim                                  |

Decision: **never copy `pieceId`.** A row of identical images is rare and easy to set up manually (assign one piece, then duplicate). Cloning an empty row matches the common case (six anchors for six different pieces) and avoids the "why did my mural appear six times?" footgun.

## Wall tracer — V1 scope and known gaps

V1 traces only `floor.parcels`. The algorithm:

1. Determine axis from `seed.facing` (`N`/`S` → walk along x; `E`/`W` → walk along z).
2. Snap the perpendicular coord to the nearest 16 m grid line.
3. Collect every parcel from `floor.parcels` whose corner sits on that grid line.
4. Return `{ min, max }` from the contiguous run that contains the seed.

**Knowingly does NOT handle:**

- **F3 atrium void interior walls.** The void is a hole punched in `floor.parcels` ([app/map/floor-data.ts:106](../app/map/floor-data.ts#L106)); the tracer will happily span across it. Workaround: the curator hand-deletes any clones that landed inside the void.
- **F5 bridge.** Bridges are separate `Rect`s ([app/map/floor-data.ts:131](../app/map/floor-data.ts#L131)), not `parcels`. Seeding on the bridge → no wall, no clones.
- **Skywalk arms.** Same as bridge — pathways aren't parcels.

These are listed in the doc so the curator and the next implementer both know. They're not silently broken — they're deliberately deferred until "Fill row" earns the right to graduate to the bigger wall model.

## File touchpoints

- **New:** [lib/row-fill.ts](../lib/row-fill.ts) — `traceWall()`, `rowFillPositions()`, `cloneAnchor()`. Pure, unit-testable.
- **Modified:** [app/map/map-view.tsx](../app/map/map-view.tsx) — `DetailCard` gains a "Fill wall" `FieldGroup`; map render loop gains a ghost-preview array for the proposed clones (visually identical to the existing draft-ghost at lines 739-790).
- **No schema changes.** No API changes. No scene changes.

## Default gap — why 0.5 m

Gallery-standard frame spacing is 15-30 cm. The venue here is bigger than a gallery; pieces are 2-3 m wide, walls are 16-64 m. 0.5 m reads as "intentional gap, frames don't touch" at that scale without looking sparse. Cheap to tune later — it's just a `<input defaultValue="0.5">`.

## Estimate

- `lib/row-fill.ts` + 3 unit tests (single-parcel wall, multi-parcel wall, atrium-edge case): **2 hours**
- DetailCard "Fill wall" UI + ghost preview render: **3 hours**
- Multi-anchor save + 6 s undo toast: **1 hour**
- Manual QA on F1 / F2 / F3 / Skywalk: **1 hour**

**Total: ~7 hours.** Plan for 1 day with buffer.

## Out of scope (deliberate)

- Other patterns (triptych, mirror pair, grid, frieze) — covered in [ANCHOR_PATTERNS_PLAN.md](./ANCHOR_PATTERNS_PLAN.md), ship only if row-fill is used.
- Overlap-disambiguation viz on the map — orthogonal, can ship independently and probably should.
- Bridge / pathway / atrium-void wall handling — until row-fill proves valuable, the wall model stays simple.
- `Anchor.shelf` / vertical stacking — V1 produces single-row hangs only.
- "Select all in row → delete as a group" — undo toast covers immediate regret; deferred until asked.
