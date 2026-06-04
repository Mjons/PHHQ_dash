# Map — Skywalk Geometry Refresh + Elevator Shaft as a Curatable Area

**Status:** pre-design
**Date:** 2026-05-26
**Author:** dashboard team

## What the curator wants

> "The skywalk in the scene moved, and the dashboard map still shows the old one. Also: the elevator shaft is a real wall surface in-world — I want anchors on its cabin and on the door at each floor."

Two related map-data fixes:

1. **Skywalk geometry has shifted in the scene.** `FLOORS.skywalk.pathways` in [app/map/floor-data.ts:182-193](../app/map/floor-data.ts#L182-L193) — and the F1 hint drawn from those rects in [app/map/map-view.tsx:1001-1019](../app/map/map-view.tsx#L1001-L1019) — no longer match the live scene. Curators are placing skywalk anchors that look wrong on the dashboard plan.
2. **The elevator shaft has no representation in the dashboard.** `AreaT` ([schema/manifest.ts](../schema/manifest.ts)) has `atrium`, `f1`–`f5`, `vt2`–`vt6`, `skywalk` — no elevator. Curators have no place to put anchors on the cabin walls, and no way to tell on the floor plan where the door anchors for each floor live.

The two tasks share one file (`floor-data.ts`), one SVG renderer (`map-view.tsx`), and one mental model (vertical shafts cutting through floors), so they're worth doing together.

---

## Decision 1: Skywalk geometry

Just a data refresh — no architectural change. Replace the two pathway rects in `FLOORS.skywalk.pathways` with the current scene values. We do **not** have those values committed anywhere in the repo today; we'll pull them at implementation time from one of:

- the scene source (authoritative — whatever produced the new geometry)
- a fresh in-scene capture that walks the skywalk corners
- the curator's direct measurement

The existing structure (`{ x, z, width, height, label }[]`) is fine; both arms still rectangles. If the new skywalk has a kink, an angled span, or a third arm, we'll need to either:

- (a) add more rects to the array (still axis-aligned, simplest), or
- (b) widen `Floor.pathways` to support polylines (`points: [number, number][]`). Costs a renderer change. Defer until we actually have non-rectangular pathways.

The F1 hint render in [map-view.tsx:1001-1029](../app/map/map-view.tsx#L1001-L1029) reads the same `skywalkPathways` array and label text, so it'll auto-pick-up the new geometry. No second edit needed there.

---

## Decision 2: Elevator shaft — shaft area + per-floor doors

The user picked "both" in the design Q: cabin-interior anchors live on a new `elevator` area; door anchors stay on their host floor. This matches how the atrium already works — the atrium is its own area for hero-wall anchors, but the floors around it (F2 balcony, F3 wrap, F4 stage) keep their own anchors.

### 2a. New area: `elevator`

Schema change in [schema/manifest.ts](../schema/manifest.ts):

```diff
- export const Area = z.enum(["atrium","f1","f2","f3","f4","f5","vt2","vt3","vt4","vt5","vt6","skywalk"]);
+ export const Area = z.enum(["atrium","f1","f2","f3","f4","f5","vt2","vt3","vt4","vt5","vt6","skywalk","elevator"]);
```

Plus `AREA_LABEL["elevator"]` and `AREA_ORDER` placement. Where it sits in the order matters for the floor-button strip ([map-view.tsx:822-854](../app/map/map-view.tsx#L822-L854)) — put it next to `atrium` since both are vertical shafts, not floors.

Floor entry in [app/map/floor-data.ts](../app/map/floor-data.ts):

```ts
elevator: {
  label: "Elevator",
  sub: "vertical shaft, F1 → F5",
  heightM: /* total shaft height — F1 base to F5 top, pull from FLOOR_BASE */,
  parcels: [/* TODO: the shaft footprint — likely a single sub-parcel, e.g. [56, 32] if 16×16 is too coarse */],
  description: "<strong>Not a floor — a vertical SHAFT.</strong> The elevator cabin's interior walls (north/east/south/west) are anchorable surfaces. Each main-building floor (F1–F5) also has door anchors on its own floor — see those areas for door placements.",
},
```

Open question: **the elevator footprint is almost certainly smaller than a 16m parcel.** Today every parcel is 16×16 and `isInArea()` ([floor-data.ts:203-218](../app/map/floor-data.ts#L203-L218)) reads parcels as full tiles. Two ways to handle it:

- **Option A — fudge with a full parcel.** Use whichever 16×16 parcel the shaft sits inside as the elevator's `parcels`. Curator sees a 16m square on the floor plan that's larger than the real shaft. Cheap. Same coarse-resolution trade-off the atrium already lives with — atrium is 16×16 too, even though the void is smaller.
- **Option B — sub-parcel rects.** Add a new `Floor.footprint?: Rect[]` field to override parcel-based bounds when a more precise shape is needed. `isInArea` checks `footprint` first, falls back to parcels. Real shaft size shown on map. More plumbing.

**Recommend A.** The atrium precedent already accepts this coarseness, the cabin has only four short walls (N/E/S/W), and anchor X/Z within the parcel still ends up at the right wall via `facing`. Revisit if curators report confusion.

### 2b. Per-floor door anchors

These stay on `f1`–`f5` and need no schema change. The convention is purely organizational:

- IDs: `f2-elevator-door`, `f3-elevator-door`, etc. Door anchors get `facing` pointing _outward_ from the shaft into the floor.
- Tags: each door anchor gets a `"elevator"` tag so the tag filter in the Anchors view groups them across floors.

No code change needed for this — it's a curator convention enforced by the capture tool, not by the schema.

### 2c. Skyline / floor-plan SVG update

This is what the user meant by "update the skyline." The elevator shaft should be **drawn on every floor it passes through**, the same way the atrium void is drawn on F3 ([map-view.tsx:908-933](../app/map/map-view.tsx#L908-L933)).

Cleanest mechanism: generalize `atriumHole`. Today `Floor.atriumHole?: [number, number]` carries one parcel coord and the renderer draws a dashed orange rect with the "ATRIUM VOID" label. We extend that to a list of shafts that pass through:

```ts
type Shaft = {
  parcel: [number, number];   // 16×16 origin
  label: string;              // "ATRIUM VOID" | "ELEVATOR"
  cutsThrough: boolean;       // true = floor has a hole here (atrium F3); false = shaft is solid wall on this floor (elevator everywhere)
};

type Floor = {
  ...
  shafts?: Shaft[];           // replaces atriumHole; old field kept as a getter for compatibility during migration
};
```

Renderer behavior:

- `cutsThrough: true` → existing dashed-outline-with-void-label treatment (used by F3 atriumHole today)
- `cutsThrough: false` → solid faint outline + small label, indicating "the elevator passes through here but the floor is intact." Anchors on this floor's elevator door sit _just outside_ this rect.

Migration is mechanical: replace `atriumHole: [48, 32]` on `f3` with `shafts: [{ parcel: [48,32], label: "ATRIUM VOID", cutsThrough: true }]`. Add `shafts: [{ parcel: <elevator-parcel>, label: "ELEVATOR", cutsThrough: false }]` to every floor the elevator serves (F1–F5).

This is "update the skyline" in the user's words — the dashboard floor plans gain a second permanent annotation alongside the atrium void.

---

## Files touched

| File                                                                                    | What changes                                                                                                                              |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [app/map/floor-data.ts](../app/map/floor-data.ts)                                       | New skywalk pathway rects · new `elevator` Floor entry · `shafts[]` field replacing `atriumHole` · F1–F5 get an elevator shaft annotation |
| [schema/manifest.ts](../schema/manifest.ts)                                             | `Area` enum adds `"elevator"` · `AREA_LABEL` + `AREA_ORDER` add the entry                                                                 |
| [app/map/map-view.tsx](../app/map/map-view.tsx)                                         | Renderer reads `floor.shafts[]` instead of `atriumHole` · floor-button strip auto-includes the new area                                   |
| [lib/scene-integration.ts](../lib/scene-integration.ts) _(or wherever `FLOOR_Y` lives)_ | `FLOOR_Y["elevator"]` baseline for cabin anchor Y                                                                                         |
| `docs/archive/SCENE_INTEGRATION.md`                                                     | Document the elevator area + door anchor convention                                                                                       |

No data migration on the live manifest: existing anchors all have valid areas, the new `elevator` value is only used by new anchors.

---

## What I need from the user before coding

1. **New skywalk geometry.** Either: (a) the exact pathway rects, (b) a fresh capture JSON of two corners per arm so I can derive them, or (c) the scene file/region to read from.
2. **Elevator parcel + heights.** Which 16×16 parcel does the shaft sit in? Which floors does it serve (F1–F5? F1–F4?)? What's the cabin's interior Y range?
3. **Sanity check on Decision 2c.** Are we OK replacing `atriumHole` with `shafts[]`, or should the elevator be its own renderer code path and leave `atriumHole` alone? I lean toward unification — one annotation system is cleaner — but the rename touches every floor entry.

---

## Out of scope

- Polyline / non-rectangular skywalk pathways (defer until we actually have one)
- Sub-parcel `footprint` precision for shafts (defer until coarseness becomes a usability problem)
- A separate "elevation view" / building silhouette beside the floor plan (different feature; the user clarified "skyline" meant the floor-plan SVG itself)
- Auto-generating elevator-door anchor IDs from the capture tool (curator-side convention for now)
