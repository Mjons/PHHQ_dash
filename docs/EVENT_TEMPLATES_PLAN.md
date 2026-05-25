# Event Templates — Save & Swap Whole Scene Loadouts

**Status:** exploration / pre-design
**Date:** 2026-05-18
**Author:** dashboard team

## What the curator wants

> "I want to save a full scene template — image and all. And be able to swap out for a whole new floor plan template, with its respective images. Then we can easily flip for different events."

In plain English: the curator wants **named snapshots** of the entire dashboard state — every anchor, every piece, every image — that they can save under a label (e.g. `nye-2026`, `frieze-week`, `default-rotation`), then **swap the live manifest** to any of them with one click. Use case: Friday is an art fair, Saturday is a DJ night, Sunday is the standing rotation; the venue is the same building, the art on the walls is completely different.

Right now this is impossible. There is one manifest at one Redis key (`panelhaus:manifest:v1`). Every save mutates that single document. To do a "Saturday night" build the curator would have to delete every piece, upload new ones, re-assign every anchor, and then on Sunday morning manually undo all of it. There is no concept of "two parallel curations of the same venue."

This doc explores what changes (schema, storage, UI, scene) to make event-template save/swap real, including the image-bundle question (do we duplicate blobs, share them, or namespace them per template?).

---

## What "save the whole template" actually means today

Today the **manifest** at [schema/manifest.ts:53](../schema/manifest.ts#L53) is the entire state:

```ts
Manifest = {
  version, updatedAt,
  pieces: Record<string, Piece>,   // ← every image's URL + metadata
  anchors: Anchor[],               // ← every wall slot, with pieceId pointing into pieces
}
```

Images themselves live in Vercel Blob — uploaded at [app/api/pieces/upload/route.ts:79](../app/api/pieces/upload/route.ts#L79), addressed by URL. The manifest stores only the URL string in `Piece.src`.

So "the template" already has two layers:

1. **Manifest document** (JSON, ~10–50 KB) — anchors, piece metadata, piece→URL pointers. Lives in Redis.
2. **Image binaries** (PNG/JPG/WEBP, up to 8 MB each) — live in Vercel Blob, addressed by stable public URLs.

A template snapshot = a frozen copy of the manifest. Whether the images are also copied is the design question, not a forced answer (see §"Image strategy" below).

The floor plan itself (atrium, F1, F2…, VT2…, skywalk) is **not** part of the manifest — it's hard-coded in [app/map/floor-data.ts:54](../app/map/floor-data.ts#L54) and in the Decentraland scene's static geometry. So when the curator says "floor plan template" they don't mean changing the building's shape — they mean **the full set of (anchors + assigned pieces) overlaid on the existing building**. That's a useful distinction; if at some point we want truly different _buildings_ per event, that's a separate, much larger project (scene-side geometry swap, new floor constants, new map SVG). For v1 we assume one venue, many art layouts.

---

## What changes — high level

Four moving parts:

1. **Storage** — replace the single Redis key with a per-template key plus a pointer to the active template.
2. **Schema** — add `Template` (id, label, manifest, createdAt, notes) and keep `Manifest` unchanged so the scene contract doesn't break.
3. **API + UI** — new endpoints to list / save-as / activate / delete templates; new "Templates" tab in the dashboard.
4. **Image strategy** — decide whether blobs are shared across templates (cheap, fragile) or duplicated per template (expensive, safe).

The scene side ideally **doesn't change at all** — it keeps fetching `GET /api/manifest` and rendering whatever it gets back. We make that endpoint serve "whichever template is currently active." The switching happens server-side; the scene just re-fetches on next boot.

---

## Storage model

### Today

```
Redis:
  panelhaus:manifest:v1  →  { version, updatedAt, pieces, anchors }
```

One key. Every POST `/api/manifest` overwrites it.

### Proposed

```
Redis:
  panelhaus:template:active                 →  "nye-2026"          (string — the id of the live template)
  panelhaus:template:nye-2026               →  { id, label, manifest, createdAt, notes }
  panelhaus:template:default-rotation       →  { ...  }
  panelhaus:template:frieze-week            →  { ...  }
  panelhaus:templates:index                 →  ["nye-2026", "default-rotation", "frieze-week"]
```

The `index` key is a denormalized list for fast `GET /api/templates` without `KEYS` scans (Upstash discourages `KEYS` in prod). Keep it sorted by `createdAt` desc on write.

**Backwards-compat path** for the existing manifest: on first deploy, write a one-shot migration that reads `panelhaus:manifest:v1`, wraps it as a template named `legacy-default`, sets it active, and leaves the old key in place for a release cycle as a fallback. Scene-side `GET /api/manifest` keeps working through the transition because we keep it serving the active template's manifest.

### Why not store all templates in one document?

We could put `{ active, templates: {id → {...}} }` in one big key. Don't — each template is 10–50 KB; a venue running 6 events accumulates 200–400 KB per write, and every save round-trips the whole thing through Redis. Per-template keys give us cheap reads (`MGET` the index, `GET` only the active one for the scene) and avoid write contention.

---

## Schema additions

Append to [schema/manifest.ts](../schema/manifest.ts), don't modify existing types:

```ts
export const TemplateMeta = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case slug"),
  label: z.string().min(1), // human-readable, "NYE 2026"
  createdAt: z.string(), // ISO
  updatedAt: z.string(),
  notes: z.string().optional(),
  // bookkeeping: where the images live, for the duplicate-per-template path
  blobPrefix: z.string().optional(), // e.g. "templates/nye-2026/"
});

export const Template = TemplateMeta.extend({
  manifest: Manifest, // ← reuse existing schema verbatim
});

export const TemplateList = z.object({
  active: z.string().nullable(),
  templates: z.array(TemplateMeta),
});
```

Critical: `manifest` inside `Template` is the **exact same `Manifest` type the scene already validates**. Templates are a server-side concept; the scene never sees them. This is what keeps the scene contract un-broken.

---

## API surface

New routes, all curator-auth-gated except `GET /api/manifest`:

| Method   | Path                           | Purpose                                                                                   |
| -------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `GET`    | `/api/templates`               | List meta for all templates + which one is active. Used by Templates tab.                 |
| `POST`   | `/api/templates`               | Create new template. Body: `{ id, label, notes?, copyFrom?: 'active' \| 'blank' \| id }`. |
| `GET`    | `/api/templates/[id]`          | Full template doc (meta + manifest) — for editing a non-active template.                  |
| `PUT`    | `/api/templates/[id]`          | Replace meta or full doc. Used by "save current edits to this template."                  |
| `DELETE` | `/api/templates/[id]`          | Remove. Refuse if active. Optionally cascade-delete blobs (see below).                    |
| `POST`   | `/api/templates/[id]/activate` | Set as live. Atomic — write `active` pointer, no copy of the manifest needed.             |
| `GET`    | `/api/manifest`                | **Unchanged contract.** Now returns the active template's `manifest`.                     |
| `POST`   | `/api/manifest`                | **Unchanged contract.** Writes into the _active_ template's `manifest`.                   |

The `POST /api/manifest` route already exists at [app/api/manifest/route.ts:27](../app/api/manifest/route.ts#L27). We change one thing inside it: instead of reading/writing `MANIFEST_KEY` directly, it reads the active pointer, mutates `templates:<active>.manifest`, and bumps version. Everything else (Zod validation, version++, NextAuth gate) stays put.

Same surgery on `GET` at [app/api/manifest/route.ts:16](../app/api/manifest/route.ts#L16) — read active, return its manifest.

This means **every existing UI page (Anchors, Pieces, Map, Import) keeps working without modification.** They all save through `POST /api/manifest`, which now transparently scopes to the active template. The user gets a "you are editing template X" badge in the header for situational awareness; the rest of the UX is unchanged.

---

## Image strategy — the load-bearing decision

Three options. None are obviously right; the curator's tolerance for cost vs. fragility decides.

### Option A: Shared blob pool (zero copy)

Templates reference image URLs that live in a single global blob pool. `template:nye-2026.manifest.pieces.smudge-luchador.src` and `template:default-rotation.manifest.pieces.smudge-luchador.src` point at the same Vercel Blob URL.

- **Pro:** zero storage overhead. Switching templates is purely a Redis pointer write — sub-ms. Re-using a piece across events is free.
- **Pro:** matches today's model (today's `/pieces` uploader already drops everything into a flat `pieces/` prefix in Blob).
- **Con:** deleting a piece from one template's `pieces` map breaks any other template that still references it, _unless_ we also refcount on delete. Easy to footgun.
- **Con:** "swap to this template" never feels like a true restore — if someone deleted the underlying blob, the old template renders broken thumbnails.
- **Mitigation:** make `DELETE /api/pieces/:id` refcount-aware (refuse delete if any _other_ template uses the piece) or move to a soft-delete model.

### Option B: Per-template blob namespace (full duplication)

When you `POST /api/templates` with `copyFrom: 'active'`, the server copies every blob in `templates/<source>/` to `templates/<new>/<...>`, rewriting `Piece.src` URLs in the new template's manifest accordingly.

- **Pro:** each template is fully self-contained. Deleting template X cleans up X's blobs without risk to Y. Restoring an old template is bit-for-bit faithful.
- **Pro:** clean mental model — "this template IS its art."
- **Con:** copy cost. A template with 40 pieces × 4 MB avg = 160 MB per duplicate. Vercel Blob charges for storage; 10 templates × 160 MB = 1.6 GB. Probably fine, worth confirming pricing for the curator's expected number of saved events.
- **Con:** copy time. `@vercel/blob` doesn't expose server-side `copy` natively for blob-to-blob — you'd `fetch` the source, then `put` to the new path. For 40 pieces, expect 10–30 s of POST time. Need a progress UI.

### Option C: Hybrid — shared by default, fork-on-edit

Templates share blobs by default (Option A's behavior), but when the curator edits a piece's image _within a template_, that single piece forks: a new blob is written under that template's namespace, the original is untouched.

- **Pro:** cheap for the common case (lots of templates, mostly the same art with a few swaps per event).
- **Con:** the most code. Need to detect "this is an edit, not a brand-new upload" and route the new blob into the right namespace. Workable but adds branching in the upload route.

### Recommendation (for the doc, not a forced choice)

**Start with Option A + a lightweight refcount on piece delete.** Reason: it matches today's model exactly, gets the feature shipped without touching the upload route, and the failure mode (broken thumbnail in an inactive template) is recoverable by re-uploading. If the curator hits the footgun ("I deleted Jane's photo and now the December template renders blank where Jane was") more than once, upgrade to Option B for the next major.

The refcount lives in the `DELETE /api/pieces/:id` handler: enumerate `panelhaus:templates:index`, fetch each template, count references to the piece id. Refuse if any non-active template uses it; offer "force delete and clear from all templates" as a deliberate second click.

---

## UI — what the curator sees

One new top-nav tab: **Templates** (sits after Import).

### Templates tab (`/templates`)

A list view. Each row:

- Template label + slug
- Created / last edited dates
- Anchor count, piece count, total image bytes
- "Active" pill if it's live
- Buttons: **Activate**, **Edit name/notes**, **Duplicate**, **Delete**

Top of page: **+ New template** button. Modal asks for: label (auto-slug), notes (optional), and a copy source dropdown: `Start blank` / `Copy from active` / `Copy from <other template>`.

Active template gets a colored border / "LIVE" badge so it's impossible to miss which one a save will mutate.

### Header badge everywhere

Top of every page (Anchors, Pieces, Map, Import), show a small badge: `Editing: nye-2026 (LIVE)` or `Editing: frieze-week (draft)`. Clicking it opens a quick-switcher. Why: prevents the curator from making "small fixes" to what they think is the live show but is actually a draft template, or vice versa.

### Activate flow

Click **Activate** on a non-active template → confirm modal: "This will replace the live scene art with the contents of `<template>`. Visitors already in the scene won't see the change until they re-enter; new visitors will see it immediately. Continue?" → on confirm, POST `/api/templates/:id/activate`, refresh, badge updates.

### Duplicate flow (image bundle question made concrete)

Click **Duplicate** → modal with two options (depending on chosen image strategy):

- **Shared images** (Option A): "Creates a new template sharing the same images as `<source>`. Editing pieces in either template affects both unless you re-upload." Fast (1 s).
- **Full copy** (Option B): "Creates an independent copy including all <N> images (<total> MB). Takes ~30 s. Templates are fully independent after this." Slow, with a progress bar.

If we go Option A initially, only show the shared-images path. Mention "full duplicate coming" in a footer note if useful.

---

## Scene side: change required?

Ideally **zero**. The scene calls `GET /api/manifest`, validates with Zod, renders. Active-template indirection is transparent.

One small consideration: caching. Today the GET response sends `cache-control: public, max-age=10, stale-while-revalidate=60` ([app/api/manifest/route.ts:20](../app/api/manifest/route.ts#L20)). After an `Activate`, the scene might serve a stale manifest for up to 10 s. For event night that's acceptable. If we want instant switches, add a cache-buster (`?t=<active-template-version>`) to the scene's fetch URL, or drop the edge cache to `max-age=0, stale-while-revalidate=10`. Decide when we know how snappy "snap to new show" needs to feel.

The baked fallback (`manifest.baked.json` shipped with the scene bundle) is still useful — it's the bottom of the resilience stack, only loaded if `/api/manifest` is unreachable. No change needed there; it continues to snapshot whatever the live manifest currently is.

---

## Migration plan

1. **Ship schema + storage refactor in a non-breaking way.** New keys, new helpers in `lib/templates.ts`. Manifest API routes get the indirection but external behavior is identical. On first call after deploy, lazy-migrate the legacy `panelhaus:manifest:v1` into `panelhaus:template:legacy-default` and set active. No UI change yet — invisible to curator.
2. **Add `GET / POST /api/templates` endpoints.** No UI. Test via curl.
3. **Add Templates tab + header badge.** Curator can now save/swap. This is the user-visible release.
4. **Add Duplicate (Option A, shared-images first).** Smallest possible thing.
5. **Refcount-aware piece delete.** Footgun mitigation.
6. **(Future) Option B full-copy duplication** if curator reports footguns or wants true archival.

Each step is independently shippable behind a feature flag if we want belt-and-suspenders. Probably overkill — the curator is one person, and steps 1–3 are coupled.

---

## Risks / open questions

- **Cost.** Per-template blob duplication (Option B) could add up. Need to read Vercel Blob pricing and estimate from realistic event count. Option A sidesteps this but trades it for the reference-integrity problem.
- **Concurrent edits.** Currently no locking — if two curator sessions edit at once, last-writer-wins. Templates don't change this, but they multiply the surface area ("I was editing X, you switched active to Y, my next save lands in Y by accident"). Mitigation: the header badge plus a `templateId` in the POST body that the server rejects if it doesn't match active.
- **Anchor positions.** Anchors include `x`/`z` per-floor. Today these come from capture-tool JSON. Templates share the same physical venue, so the same anchor coordinates work across all templates — but each template can have a _different set_ of anchors (some events use the atrium, others don't). The current schema already supports this: anchors are an array, not a map per area; an empty area = no art there. So this falls out for free.
- **Pieces tab semantics under shared-images model.** "Delete piece" today removes the manifest entry. Under templates, the question is whether `/pieces` lists pieces in the _active template only_ (matches today's UX) or pieces across _all templates_ (closer to a global asset library). Suggest active-only with a "see all" toggle — keeps daily curation focused, surfaces orphans when needed.
- **Backups.** Once we have named templates, the curator may expect "restore last week's NYE template from before I deleted three pieces." That's full versioning per template, not just templates. Out of scope for v1 — can be added later as `template:<id>:v<N>` snapshots on every POST if demanded.

---

## Estimate

- Storage + schema + API rewrite (steps 1–2): **1 day**.
- Templates UI (step 3): **1 day**.
- Duplicate (Option A) + refcount (steps 4–5): **half day**.
- Option B full-copy: **1–2 days** if/when needed, mostly tied up in progress UI and a reliable blob-copy loop.

Total for the v1 cycle (steps 1–5): **~2.5 days**, no scene-side changes required, fully backwards-compatible at the `/api/manifest` contract.

---

## Out of scope (call out so we don't conflate)

- **Different building geometries per template.** Floor plans here means art layout, not architecture. Different buildings = a separate scene-side project (new geometry, new floor map SVG, new constants).
- **Per-template auth / roles.** All templates editable by the same curator password. Multi-curator with permissions = later.
- **Scheduled activation.** "Switch to `nye-2026` on Dec 31 at 8pm." Cron + the existing activate endpoint would do it; defer until requested.
- **Public template gallery.** A read-only "see what shows have run here" page. Easy to add post-v1.
