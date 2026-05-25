# Map Uploader — Run This Dashboard on Your Own Land

**Status:** exploration / pre-design
**Date:** 2026-05-18
**Author:** dashboard team

## What a fork-operator wants

> "I cloned this repo because I want to curate art on **my** Decentraland parcels — not Panel Haus's. But the floor plan is baked into a TypeScript file with 19 parcels at fixed coordinates and a hard-coded `Area` enum that lists `f1, f2, f3, f4, f5, vt2…vt6, skywalk, atrium`. None of those mean anything for my land. How do I make this thing show **my** building?"

Plus the obvious follow-on:

> "I don't want to fork the code. I just want to upload a floor plan, paint my parcels, name my floors, and have the rest of the dashboard light up against that."

In plain English: today the venue geometry is a **compile-time constant**. [app/map/floor-data.ts:6-26](../app/map/floor-data.ts#L6-L26) lists the 19 Panel Haus parcels; [app/map/floor-data.ts:54-194](../app/map/floor-data.ts#L54-L194) hardcodes the 12 named floors with their parcel sets, heights, atrium hole, bridges, and prose descriptions. The `Area` enum at [schema/manifest.ts:15-28](../schema/manifest.ts#L15-L28) is a Zod literal union of those same 12 strings — every anchor in the manifest is validated against it. To run this dashboard on different land today, a forker has to edit two TypeScript files and redeploy. That's a code change, not a configuration.

Everything that's needed to make the dashboard **land-agnostic** — parcel layout, floor names, heights, atrium holes, bridges, descriptions — is data, not logic. It can live in the manifest, be edited in the dashboard, and be exported as JSON the same way [/api/import](../app/api/import/route.ts) accepts anchor captures today. This doc walks how that data move happens, what the upload UX looks like, and which downstream files have to flex from "Panel Haus" to "your land."

---

## Why this is tractable right now

Three things make it cheaper than it looks:

1. **The renderer already takes parcel coordinates as inputs, not constants.** The map SVG at [app/map/map-view.tsx:44-47](../app/map/map-view.tsx#L44-L47) computes parcel positions from the `parcels` array on each floor. Swap the array, the squares move. No layout code is hardcoded to Panel Haus's 96×80 footprint beyond two scalars (`SCENE_W`, `SCENE_D` at [app/map/floor-data.ts:3-4](../app/map/floor-data.ts#L3-L4)), which are themselves derived from the parcel extent and can be recomputed at load time.

2. **The manifest is already the source of truth for everything mutable.** Pieces, anchors, books, and the version counter all live in the JSON document persisted at `panelhaus:manifest:v1` in Upstash. Adding a `floors` field to the manifest is the same shape change as the existing `pieces` and `anchors` fields — a Zod object, validated server-side at [app/api/manifest/route.ts](../app/api/manifest/route.ts), edited in the dashboard, written through `saveManifest()` at [lib/client.ts:9](../lib/client.ts#L9). The plumbing exists.

3. **The `Area` enum is the only schema-level coupling, and it's a single file.** Once `Area` becomes a free-form `string` (or a derived enum populated from the manifest's `floors`), every other piece of code that touches floors — the area chips at the top of [app/map/map-view.tsx](../app/map/map-view.tsx), the grouped anchors list, the area selector in the inspector — already iterates over a runtime collection, not the literal union. The static enum is the dam; once it breaks, the rest flows.

Together: define a `Floor` schema in the manifest, write a map-uploader UI that edits it, drop the static `Area` enum, derive `FLOORS` from `manifest.floors` instead of importing it from `floor-data.ts`. The renderer doesn't care where the parcel list came from.

---

## Three strategies for how the venue gets defined

### A. JSON-in-the-repo (baseline, no UI)

A forker copies `floor-data.ts` to `floor-data.json`, edits the JSON in their text editor, commits, redeploys. The dashboard reads the JSON at startup instead of importing the TS module.

**Pro:** trivial migration — the file already exists in TS form; switching to JSON is a 30-minute conversion plus a loader. Zero UI work. Git history is a clean changelog of every venue tweak.
**Con:** still a code change to update floor names. Doesn't solve the actual user request ("I just want to upload a floor plan"). Means every fork-operator needs to know how to clone, edit, push, and wait for a deploy just to rename a wall. And the `Area` enum still has to be regenerated from the JSON at build time, or the schema is permanently looser than the data.

This is what we have today, dressed up. Useful only as a stepping stone to B.

### B. Manifest-resident floors + dashboard editor (recommended)

Move `FLOORS` and `ALL_PARCELS` into the manifest as a `venue.floors[]` array. Add a **Map Setup** tab that:

- Lets the curator paint parcels onto a grid (click to add, click to remove)
- Names each floor and sets `heightM`, `description`, optional `atriumHole`, `bridges`, `pathways`, `isVault`, `isHallOfFame`
- Persists through the same `saveManifest()` path as everything else

The new map-uploader page is the only place where venue geometry is edited; the rest of the dashboard (Anchors, Pieces, Map view, Import) reads it from `manifest.venue`.

```ts
// schema/manifest.ts
export const Floor = z.object({
  id: z.string().min(1), // was the Area enum literal
  label: z.string().min(1), // "F1 — Ground"
  sub: z.string().optional(), // "entrance + lobby"
  heightM: z.number().positive(),
  parcels: z.array(z.tuple([z.number(), z.number()])),
  atriumHole: z.tuple([z.number(), z.number()]).nullish(),
  bridges: z.array(Rect).optional(),
  pathways: z.array(Rect).optional(),
  isVault: z.boolean().optional(),
  isHallOfFame: z.boolean().optional(),
  description: z.string().optional(),
});

export const Venue = z.object({
  name: z.string().min(1), // "Panel Haus" / "Your Land"
  parcelSize: z.number().positive().default(16),
  floors: z.array(Floor).min(1),
});

export const Manifest = z.object({
  version: z.number(),
  venue: Venue, // NEW
  pieces: z.record(Piece),
  anchors: z.array(Anchor),
  // ... unchanged
});
```

`Anchor.area` becomes `z.string()` and is checked at the application layer ("does this string appear in `venue.floors[].id`?") rather than at the Zod layer. Looser schema, but the validation moves one inch closer to the data and avoids the enum being out of sync with the floors.

**Pro:** solves the user request — anyone can open the dashboard, paint their land, save. No code change, no redeploy. The same manifest mechanism that already carries pieces and anchors carries the venue, so backup/export/migrate stories all come for free. The Decentraland scene that consumes the manifest can introspect `manifest.venue` at load time and lay out walls accordingly — no scene-repo redeploy when a forker adds a new floor.
**Con:** the static `Area` enum was load-bearing for type safety everywhere it was used — `area: AreaT` parameters in [app/map/map-view.tsx:61-73](../app/map/map-view.tsx#L61-L73), area chip lists, the FLOORS record indexed by area key. All of those have to switch from "compile-time exhaustive" to "runtime-checked." A small amount of safety is lost; runtime guards have to be added at the few places where the code today assumed all 12 areas were present (e.g. atrium handling).

### C. Upload a top-down image and trace parcels visually

The map-uploader page accepts an SVG / PNG of the floor plan. The curator drops it, sets two corners ("this point is parcel `0,0`; that point is parcel `80,64`") to establish scale, and the dashboard auto-snaps a parcel grid over the image. They click parcels to assign them to floors, the image becomes a background layer in the map view.

**Pro:** matches how forkers actually plan — they have a sketch from their architect, not a list of `(x, z)` tuples. The floor map looks like the real building instead of an abstract square grid. Best demo.
**Con:** much more UI than B. Has to handle image storage (another Blob path), grid alignment, image-coordinate ↔ parcel-coordinate transform, two-corner anchoring, possibly rotation. The schema gets a `venue.backgroundImage?: { url, originX, originZ, scaleM }` field. Worth doing **after** B is in hand and the schema move is settled — Strategy C is purely an additive UX layer on top of B's data model.

### Recommendation

**Strategy B for v1**, with the option to fold C in once the schema settles.

The hard part of this problem is moving the venue from compile-time to runtime — once `manifest.venue` exists and is editable, painting a grid (B) and tracing over an image (C) are two front-ends to the same data. Ship B first because it unblocks every forker (they can rename floors and edit parcels without a deploy), then layer C on when someone says "I want to upload a real floor plan."

The rest of this doc assumes Strategy B and calls out which pieces become free once C is added.

---

## UI flow — the Map Setup tab

A new top-nav tab between **Map** and **Pieces**: **Setup**. (Naming-wise, "Setup" beats "Venue" because it generalizes to other one-time config — the curator password reminder, the scene's manifest URL, etc.)

### Step 1 — Name the venue

Single text input at the top: **Venue name**. Defaults to `manifest.venue.name`. Writes to the same field. Shows up in the top-nav header replacing today's hardcoded "Panel Haus" string (currently in [app/layout.tsx](../app/layout.tsx)).

### Step 2 — Define the parcel grid

A scrollable canvas showing a 32×32-parcel grid (configurable bound) at the standard Decentraland parcel size (16m). Each cell:

- **empty** (default) — no border, light hatch
- **claimed** — solid color, labeled with the floor it belongs to
- **hover** — outline highlight

The curator paints by clicking cells. Holding shift drag-paints a rectangle. Right-click un-assigns.

A floor-picker chip bar at the top of the canvas: **F1 · F2 · Atrium · …** plus **+ New floor**. The active chip is what gets assigned on click. This mirrors the existing area chip bar at [app/map/map-view.tsx](../app/map/map-view.tsx), so the muscle memory carries over.

### Step 3 — Configure each floor

To the right of the canvas, a panel for the currently-selected floor:

```
ID:           [ f1 ]          ← lowercase slug, validated /^[a-z0-9][a-z0-9_-]*$/
Label:        [ F1 — Ground ]
Subtitle:     [ entrance + lobby ]
Height (m):   [ 12 ]
Atrium hole:  [ none ] / [ pick parcel ]
Vault flag:   [ ☐ ]
Hall of Fame: [ ☐ ]
Description:  [ multiline HTML — preserves the rich-text already in floor-data.ts ]

[ Delete this floor ]
```

`ID` is editable but warns if existing anchors reference it ("12 anchors will be reassigned to the new ID"). On rename, the dashboard rewrites every `anchor.area === oldId` to `newId` in the same manifest save — atomic from the scene's view.

Bridges and pathways (the rectangles drawn on `f5`'s bridge and the `skywalk` arms) are a sub-list within the floor: **Bridges** with a tiny per-row "draw rectangle" tool, same canvas as the parcel painter. Match the existing data shape at [app/map/floor-data.ts:132](../app/map/floor-data.ts#L132) and [app/map/floor-data.ts:187-190](../app/map/floor-data.ts#L187-L190).

### Step 4 — Save

Single **Save venue** button at the bottom. Runs the same `saveManifest()` round-trip everything else does. Manifest version bumps. The Map tab refreshes against the new `venue.floors`.

### Step 5 — Export / import

Two utility buttons in the corner:

- **Export venue JSON** — downloads `manifest.venue` as `<venue-name>-floors.json`. For sharing a template, or for committing a known-good baseline to the fork's repo.
- **Import venue JSON** — same paste-textarea as the existing [Import tab](../app/import/import-view.tsx) but accepts the floors shape. The merge rules are: replace `venue.name` and `venue.parcelSize` wholesale; for each floor in the import, upsert by `id`. Existing anchors keep their `area` reference — if the imported floors omit a referenced ID, surface a warning ("3 anchors are orphaned to area `vt5` which no longer exists") rather than silently deleting them.

This pair makes "I want to start from Panel Haus's layout and edit" a single paste, and "I want to back up my venue config before I experiment" a single download.

---

## Schema changes — the only hard part

### `Area` enum becomes `string`

[schema/manifest.ts:15-28](../schema/manifest.ts#L15-L28) currently:

```ts
export const Area = z.enum([
  "atrium",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "vt2",
  "vt3",
  "vt4",
  "vt5",
  "vt6",
  "skywalk",
]);
```

After:

```ts
// Format-only validation. Existence is checked against manifest.venue.floors
// at the application layer (see lib/venue.ts).
export const Area = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, "must be a slug");
```

This is a deliberate **loosening** of the schema. A Zod-level enum can't reference data that lives in the same document being validated — there's no way to say "must be one of `venue.floors[].id`" inside a `Manifest` schema and still have the schema parse a freshly-imported manifest. Either the enum is static and we're back where we started, or the existence check moves up.

A `validateManifestIntegrity(m: ManifestT)` helper in `lib/venue.ts` runs after Zod parse:

```ts
const known = new Set(m.venue.floors.map((f) => f.id));
const orphans = m.anchors.filter((a) => !known.has(a.area));
if (orphans.length) {
  // soft-warn, not hard-fail — we want orphans to be visible & fixable in UI,
  // not to brick the manifest load. The scene side does its own filtering.
  console.warn(
    `[manifest] ${orphans.length} anchor(s) reference unknown floor`,
  );
}
```

The scene-side schema (the copy of this file at the path called out in [schema/manifest.ts:5](../schema/manifest.ts#L5)) gets the same change.

### `FLOORS` constant moves to a selector

Today: `import { FLOORS } from "./floor-data"` at [app/map/map-view.tsx:28](../app/map/map-view.tsx#L28).
Tomorrow: `const floors = useFloors(manifest)` returning a `Record<string, Floor>` derived from `manifest.venue.floors`. Plus a `useScale(manifest)` returning `{ SCENE_W, SCENE_D }` computed from the parcel extent.

`floor-data.ts` survives as a **seed** — the values it holds today become the default `manifest.venue` injected by [lib/seed.ts](../lib/seed.ts) when a fresh manifest is created. A new fork starts with Panel Haus's geometry, then the operator edits it in the Map Setup tab and saves.

### `AREA_ORDER` and `AREA_LABEL`

[schema/manifest.ts](../schema/manifest.ts) (or a sibling) exports these arrays for the chip bar. They become derived: `AREA_ORDER` is `venue.floors.map(f => f.id)` in document order; `AREA_LABEL` is `Object.fromEntries(venue.floors.map(f => [f.id, f.label]))`. Both move from constants to selectors.

---

## API surface — none

Same shape as every other plan in this docs folder: zero new endpoints. The venue is just another field on the manifest; the existing `GET /api/manifest` and `POST /api/manifest` ([app/api/manifest/route.ts](../app/api/manifest/route.ts)) carry it. The existing `POST /api/import` accepts capture JSON today — extending it to accept a venue JSON payload (discriminated by top-level key: `{ anchors: [...] }` vs `{ venue: {...} }`) is a 5-line route change, not a new endpoint.

This is on purpose. Forkers should be able to deploy the dashboard once and configure everything from inside it; adding endpoints for venue CRUD would just be more surface for "oh wait, I also need to set up X."

---

## Migration — making the cutover safe

The live manifest at `panelhaus:manifest:v1` has no `venue` field today. On the first GET after deploy, the server has to migrate-in-place:

```ts
// app/api/manifest/route.ts (GET)
const raw = await redis.get(MANIFEST_KEY);
const m = ensureVenue(raw); // inject seed venue if missing
return NextResponse.json(m);
```

Where `ensureVenue(raw)` checks `raw.venue`; if absent, attaches the Panel Haus seed verbatim from `lib/seed.ts` and bumps the version. **The next POST persists it.** That way the current production manifest survives the schema change without a manual migration step, and forks start from the same baseline.

If the operator immediately customizes their venue, their first save overwrites the seed. If they don't, the dashboard keeps showing the Panel Haus floors and the forker realizes they have to visit the Setup tab.

---

## Decentraland-side coupling — the scene also has to know

The dashboard isn't the only consumer of `area`. The scene repo reads the manifest at load time and renders walls + anchors against the same floor IDs. Anything that's currently hardcoded scene-side (a `FLOOR_HEIGHTS` table, an `AREA_NAMES` registry, a switch on `area` to position lightboxes around the atrium) has to migrate to "read from `manifest.venue.floors`" the same way.

The handoff doc the README points at ([DASHBOARD_HANDOFF.md](../README.md#L8) in the scene repo) needs an addendum: **the scene is now venue-agnostic**. It builds whatever `manifest.venue.floors` describes; it does not assume Panel Haus.

This is the part most likely to spill outside the dashboard repo. A fork operator who wants to **fully** repurpose the project for their land has to:

1. Fork the scene repo as well.
2. Update the scene's `scene.json` parcel claims to match their actual land.
3. Confirm the scene-side schema mirror got the same `Area = string` change.
4. Re-bake the fallback manifest (`manifest.baked.json`) from their dashboard's first save.

A short **FORK_GUIDE.md** in this repo, sibling to [CURATOR_GUIDE.md](CURATOR_GUIDE.md), should walk through that ladder — separate from this plan but in scope as a follow-up.

---

## Risks / open questions

- **Renaming a floor mid-show.** If the curator renames `f3` to `balcony` while there are 40 anchors on `f3`, the rewrite has to be atomic in the same manifest save. Otherwise a fetch between the rename-write and the anchors-rewrite leaves the manifest in a state where anchors point to a floor that no longer exists. Solution: do both writes as a single `saveManifest()` payload — never a two-step. Already how anchors-as-pieces edits work; just be explicit about it in the Map Setup save handler.

- **`(x, z)` coordinates outside the new parcel grid.** An operator who shrinks their venue from 96×80 to 32×32 will orphan every anchor whose `(x, z)` falls outside the new footprint. Surface as a soft warning before save: "23 anchors will fall outside the new parcel layout — keep them anyway?" Don't auto-delete; let the curator decide. Same pattern as the orphan-warning at import time.

- **Description rich-text drift.** Today's floor descriptions are HTML strings with `<strong>` and `<em>` baked in ([app/map/floor-data.ts:61](../app/map/floor-data.ts#L61) and friends). If the Setup tab renders them in a `<textarea>` it'll show the raw tags; in a contenteditable it might allow tags we don't want. Cleanest: store descriptions as markdown, render in the Map view through a tiny markdown-to-HTML pass. Migrating the existing strings is mechanical (`<strong>X</strong>` → `**X**`).

- **Parcel-size assumptions outside DCL.** The `parcelSize: 16` default in the schema fits Decentraland. If someone later forks this for Cryptovoxels (8m parcels) or Hyperfy (no parcel system), they need to set `parcelSize` to match — and the renderer needs to honor it instead of treating 16 as a constant. [app/map/floor-data.ts:3-4](../app/map/floor-data.ts#L3-L4) is the canary: anywhere `SCENE_W` is used as if it's always in 16m increments has to multiply by `parcelSize` instead. v1 can keep the default and call out the assumption; v2 fixes it.

- **The `atrium` special case.** Panel Haus has a vertical void that's neither a floor nor a parcel cluster — it's a shaft visible from multiple floors. The current schema models it as a regular floor with `parcels: [[48, 32]]`, which is a polite lie. A fork-operator with no atrium will leave the field empty; one with multiple atria can't express that without an `atria: Rect[]` sub-field. Out of scope for v1, but the schema should permit it — leave room for `Floor.kind?: "floor" | "shaft" | "bridge"` so it isn't a breaking change later.

- **Zod-level `Area` looseness regresses type safety.** Today, `area: AreaT` in TypeScript catches typos at compile time (you can't pass `"f7"` to a function expecting `AreaT`). After the change, every `area: string` accepts garbage. Mitigation: a branded type via `z.string().brand("FloorId")` + a `parseFloorId(s, m)` helper that checks against the live `venue.floors` and returns a branded string. Callers stay strict; the schema stays loose. Not free — a handful of cast sites in the existing UI — but a one-afternoon refactor.

- **`Area` enum referenced by tooling outside this repo.** Anywhere the scene repo has a Zod schema import or a switch on the 12 area literals will break. The schema-sync hash mechanism at [schema/manifest.ts:4-6](../schema/manifest.ts#L4-L6) is exactly the safety net for this: the scene repo can't load a newer manifest until it pulls the matching schema. So the failure mode is "scene won't boot against a venue-aware manifest" — loud and obvious — rather than silent corruption.

---

## Estimate

- **Schema changes** (`Area` enum → string, `Venue` + `Floor` schemas, `validateManifestIntegrity` helper, seed migration): **half day**.
- **`useFloors` / `useScale` selectors** + refactor of [app/map/map-view.tsx](../app/map/map-view.tsx) imports and the chip bar: **half day**.
- **Map Setup tab UI** (parcel painter canvas, floor list, per-floor form, save handler): **2 days**. The painter is the bulk of the work; everything else is text inputs.
- **Bridges / pathways drawing tool** (rectangles on the same canvas, persisted into `Floor.bridges` / `Floor.pathways`): **half day**.
- **Export / import venue JSON** (download + paste-merge): **quarter day**.
- **Manifest GET migration** (`ensureVenue` shim, seed inject if missing): **quarter day**.
- **Updating the scene-side schema mirror + handoff doc**: out of scope here, but the cross-repo work is **half a day** by itself.

Total **~4 days** dashboard-side, **~4.5 days** end-to-end with the scene mirror. Strategy C (background image trace) is an additional **~2 days** layered on top, untouched here.

---

## Out of scope (so we don't conflate)

- **Image-trace floor uploader (Strategy C).** Documented above as the next iteration. Don't build until Strategy B's data model is settled and someone asks.

- **Generic 3D venue editor.** Picking floor heights and parcel ids in 2D is a curator tool; a full 3D massing editor (drag walls, rotate ceilings) is a different product. The scene repo is the source of truth for actual geometry; the dashboard only needs enough to drive curation.

- **Multi-venue support in one dashboard.** Today one Upstash key → one manifest → one venue. "I want to manage Panel Haus AND my own land from the same dashboard" implies multi-tenancy: per-venue Redis keys, per-venue auth, a venue-switcher in the top nav. Real, but its own design pass — `manifest.venue` is plural-shaped (`floors: []`, `parcelSize: number`) but singular-scoped on purpose for v1.

- **Auto-import from Decentraland's `scene.json`.** A DCL parcel-claim file already lists the operator's parcels in `[x,y]` tuples. A "paste your `scene.json` here" affordance could pre-fill the parcel grid. Nice quick-start; not the critical path. Add once Strategy B is shipping.

- **Coordinate-system flips and rotations.** The current renderer flips X at [app/map/map-view.tsx:44-47](../app/map/map-view.tsx#L44-L47) for Panel Haus's specific north orientation. Operators with differently-oriented land will eventually need a `venue.northRotation: 0 | 90 | 180 | 270` field. Cheap to add; defer until someone actually has the problem.

- **Per-floor wallpaper / theme.** The current floor descriptions are prose, not visual config. "I want F2's walls to be brick and F3's to be concrete" is a scene-side rendering concern — out of scope for the dashboard's geometry model, in scope for a future `manifest.theme` doc.

- **Sharing venue templates publicly.** "Upload your venue.json to a gallery so other operators can fork it" is a meta-curation product. The export button this doc proposes is the building block; the gallery is its own deploy.
