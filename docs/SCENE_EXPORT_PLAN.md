# Scene Export — Portable Bundles for Multi-Scene Workflows

**Status:** exploration / pre-design
**Date:** 2026-05-18
**Author:** dashboard team
**Companion doc:** [EVENT_TEMPLATES_PLAN.md](./EVENT_TEMPLATES_PLAN.md) — server-side template storage. This doc is the portability counterpart: how to lift a whole scene (manifest + images) off the server and put it back somewhere else.

## What the curator wants

> "Export the full scene — manifest and images together — so we can make multiple scenes. Hand one to another venue, archive last year's NYE build, seed a staging environment, swap entire shows in and out."

In plain English: a single downloadable artifact (a `.zip` or a directory of files) that contains **everything needed to reconstruct the current scene from scratch**. Drop it into a fresh dashboard, click Import, get back the same anchor layout, the same pieces assigned, the same images on the walls — without depending on the original Vercel Blob or Redis being reachable.

This is different from [EVENT_TEMPLATES_PLAN.md](./EVENT_TEMPLATES_PLAN.md) in one important way: that plan keeps everything inside the same dashboard's Redis + Blob. **Export crosses the boundary**: the bundle has to be self-contained and consumable by a system that has never heard of our Upstash database.

---

## Why we'd want this

The templates plan covers "many scenes inside one dashboard." Export covers the cases templates can't:

1. **Cross-environment transfer.** Copy the production scene to a staging Vercel project for safe rehearsal. Without export, that means duplicating env vars, sharing blob credentials, and praying.
2. **Cold archive.** A year from now, the NYE 2026 show may be gone from Redis (cleaned up, migrated, lost). An exported `.zip` on a curator's Google Drive is a permanent record — opens in any future dashboard that can parse the schema.
3. **Multi-venue distribution.** If another venue spins up their own dashboard instance, the curator can hand them the bundle as a starter pack: "here's our standing rotation, edit from there."
4. **Vercel Blob unbinding.** Image URLs in the manifest are `phhq-dash-rkwi.public.blob.vercel-storage.com/pieces/foo.png` — tied to one Vercel project's blob store. A bundle that includes the binaries can rehost into a different store and rewrite the URLs.
5. **Disaster recovery.** Upstash deletes the database, blob store gets purged — without an export there is no offline copy of the show. The baked `manifest.baked.json` in the scene bundle is one half of this (the JSON); the other half (the actual image bytes) lives nowhere outside Vercel Blob today.
6. **Pre-show review.** Email a `.zip` to a stakeholder: "this is what Saturday's show looks like, all the art, here's the layout." They open it locally without needing dashboard access.

---

## What's in the bundle

The minimum self-contained payload:

```
panelhaus-scene-nye-2026.zip
├── manifest.json              ← the Manifest (verbatim from /api/manifest)
├── meta.json                  ← export metadata (when, from where, schema version)
├── images/
│   ├── pieces/
│   │   ├── smudge-luchador.png
│   │   ├── jane-portrait.jpg
│   │   └── ... (one file per Piece.id, original extension)
│   └── README.txt             ← "these are referenced by manifest.json's pieces.<id>.src"
└── README.md                  ← human-readable: what this is, how to import
```

Two design decisions baked into this layout:

**Why a directory, not one big JSON with base64-embedded images?**
A 40-piece show at 4 MB average is 160 MB of binary. Base64-encoded that becomes ~213 MB of UTF-8 inside a JSON, with the whole thing needing to be in memory for parse. A `.zip` of separate files lets the import streamer process pieces one at a time, and lets a human eyeball the contents without a script.

**Why `manifest.json` verbatim and not a rewritten "local-paths" variant?**
On export, `Piece.src` is still the original blob URL. The bundle is a snapshot of what the manifest _is_, not a rewritten copy. On import, the importer is responsible for: (1) uploading each `images/pieces/<id>.<ext>` to the destination's blob store, (2) rewriting each `pieces.<id>.src` in the manifest to point at the new URL. This keeps the export side dumb (just dump what we have) and the import side smart (it knows where the images should go). Inverting that — bake import-time assumptions into the export — would make exports brittle across destinations.

### `meta.json` shape

```json
{
  "exportedAt": "2026-05-18T14:33:00.000Z",
  "exportedBy": "mjonsson1@gmail.com",
  "sourceOrigin": "https://phhq-dash-rkwi.vercel.app",
  "schemaVersion": "manifest-v1",
  "sceneCommit": "a85e4f0",
  "manifestVersion": 247,
  "pieceCount": 38,
  "anchorCount": 124,
  "totalImageBytes": 156234112,
  "imageMap": {
    "smudge-luchador": {
      "originalUrl": "https://phhq-dash-rkwi.public.blob.vercel-storage.com/pieces/smudge-luchador-AbC123.png",
      "bundlePath": "images/pieces/smudge-luchador.png",
      "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "bytes": 3145728,
      "contentType": "image/png"
    }
  }
}
```

The `imageMap` is the load-bearing thing. It is the lookup table that lets an importer answer "which file in `images/pieces/` corresponds to which piece in the manifest?" The `sha256` lets the importer detect corruption and dedupe across multiple imports.

---

## Export flow

### From the UI

A new button on the Pieces page (or in a fresh Templates tab if that plan ships first): **Export full scene**.

```
[Export full scene ▼]
  ├── Download as .zip
  ├── Download manifest.json only (no images)
  └── Copy public manifest URL
```

On `Download as .zip`:

1. UI POSTs `/api/export` (curator-auth-gated).
2. Server reads the active manifest, enumerates `pieces`, fetches each `Piece.src` from blob storage, streams everything into a ZIP, sends back as `application/zip` with `Content-Disposition: attachment; filename="panelhaus-scene-<slug>-<date>.zip"`.
3. Browser saves the file. Progress bar in the UI based on chunked stream size if practical (a 160 MB export takes ~20–60 s depending on blob fetch latency).

### From the API

```
POST /api/export
  body: { format: "zip" | "json", includeImages: boolean }
  → application/zip (binary stream) or application/json
```

Auth-gated. Streamed, not buffered — for a 200 MB show we don't want the Vercel serverless function holding all of it in memory.

A non-authenticated `GET /api/manifest` already exists and serves the JSON portion freely. The new endpoint is specifically about **the bundle with binaries**, which is private (it includes the source-of-truth images, and shouldn't be world-readable as a single download).

### From the CLI (optional, post-v1)

A script in `scripts/export-scene.ts` that uses the curator session cookie or a service-role token to hit `/api/export` and save the result. Useful for nightly automated archives to S3 / Google Drive / a curator's local NAS.

---

## Import flow

The mirror image. A new page (or a section under the Import tab at [app/import/import-view.tsx](../app/import/import-view.tsx)) accepts a `.zip` drop.

```
POST /api/import-bundle
  body: multipart/form-data with the .zip
  → { status, pieceCount, anchorCount, imagesUploaded, manifestVersion }
```

Server-side steps:

1. **Stream-extract** the zip. Validate `manifest.json` against the existing `Manifest` Zod schema at [schema/manifest.ts:54](../schema/manifest.ts#L54). Bail with 422 if invalid (same UX as `POST /api/manifest`).
2. **Validate `meta.json`.** Schema-version check — refuse if the export is from a newer manifest schema than this dashboard understands. (Forward compatibility we can promise; backward we cannot.)
3. **Re-upload images.** For each entry in `meta.imageMap`, read the file from the extracted zip, `put()` it to this dashboard's Vercel Blob at `pieces/<piece-id>.<ext>` (or `pieces/imported/<bundle-slug>/<piece-id>.<ext>` to avoid clobbering — see "Open questions" below).
4. **Rewrite the manifest.** Walk `manifest.pieces`, replace each `Piece.src` with the new blob URL returned in step 3. The `Piece.id`, `aspect`, `preferredFrame`, `artist`, etc. stay verbatim.
5. **Mode selector** (form field on the import UI):
   - **Replace active manifest.** Overwrites the live scene. Aggressive — confirm modal.
   - **Save as new template.** (Requires [EVENT_TEMPLATES_PLAN.md](./EVENT_TEMPLATES_PLAN.md) to have shipped.) Creates a new template named after the bundle slug.
   - **Dry run.** Validate everything, report what _would_ happen, write nothing. Should be the default the first time someone imports a stranger's bundle.

The existing capture-import flow at [app/api/import/route.ts](../app/api/import/route.ts) handles a different case (anchor coordinates from the in-scene capture tool, no images, merge semantics). The new endpoint is full-scene replace/clone with binaries; keep them separate routes for clarity.

---

## Relationship to the templates plan

These two efforts are **complementary, not competing**:

| Concern                                      | Templates plan ([EVENT_TEMPLATES_PLAN.md](./EVENT_TEMPLATES_PLAN.md)) | Export plan (this doc)                    |
| -------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| Where do alternate scenes live?              | In the same Redis, namespaced per template                            | In a `.zip` outside the system            |
| How do you switch the live scene?            | Click Activate, server flips a pointer (sub-ms)                       | Import bundle into active slot (minutes)  |
| Can you do this without curator UI access?   | No                                                                    | Yes — bundle is portable to any dashboard |
| Are the images included?                     | Shared by default (refcount), optionally duplicated                   | Always — that's the point                 |
| Survives Redis/Blob loss?                    | No                                                                    | Yes                                       |
| Good for "Saturday vs Sunday show"?          | Yes — fast switching                                                  | Overkill — too slow                       |
| Good for "send NYE 2026 to the other venue"? | No — they don't have our Redis                                        | Yes                                       |
| Good for "back up before risky edit"?        | Sort of (duplicate template)                                          | Better (file you can put anywhere)        |

**If both ship,** the templates feature gains an obvious extension: each template gets an `Export` button alongside `Activate` / `Duplicate` / `Delete`. The export bundle is then "any template, ripped out as a portable archive." Conversely, the import flow's "Save as new template" option becomes the natural way to land an external bundle without disturbing the live show.

**If only one ships,** export is arguably the more durable win — it covers the disaster-recovery and cross-environment cases that templates can't. Templates are nicer day-to-day UX; export is a permanent escape hatch.

---

## Format & schema details

### Zip vs. tar.gz vs. directory

`.zip` wins on portability. Windows opens it natively (the curator is on Windows 11, per the working env). The browser File API can read it without extra deps. JS-side, [`fflate`](https://github.com/101arrowz/fflate) does stream zip/unzip in ~50 KB, runs in both Node and the browser, no native bindings. Picking `.zip` also keeps a non-developer's "open the file and look inside" workflow trivial.

`tar.gz` would compress slightly better for already-compressed image formats (marginally — PNG/JPG are incompressible), but loses the double-click-to-browse property.

A plain directory (no archive) is fine for `git`-tracked bundles or rsync-style transfers but is awkward to email or upload as a single thing.

**Recommend `.zip` with `deflate` set to "store" (no compression) for the images** — they're already compressed, so deflating them just burns CPU on both ends. The manifest JSON should still be deflated; it's tiny and gzips well.

### Manifest schema versioning

`schema/manifest.ts` has no top-level version field today (just `Manifest.version` which is a write-counter, not a schema version). If we're going to make exports interpretable years later, the bundle's `meta.json` needs an explicit `schemaVersion: "manifest-v1"`. When the schema changes in a breaking way, bump to `manifest-v2`, and the importer can detect and reject / offer to migrate.

The scene contract at the top of [schema/manifest.ts:3-6](../schema/manifest.ts#L3-L6) says "when this file changes, copy it into the scene repo." For exports, a similar contract: **when the schema changes, write a migrator** from the prior version to the current. Keep migrators around indefinitely so old bundles remain importable.

### Naming convention

`panelhaus-scene-<template-slug>-<YYYY-MM-DD>.zip`

Examples:

- `panelhaus-scene-nye-2026-2026-05-18.zip`
- `panelhaus-scene-default-rotation-2026-05-18.zip`
- `panelhaus-scene-pre-renovation-snapshot-2026-05-18.zip`

Predictable and sortable. Including the date even when the template name is unique helps when the same template is exported repeatedly.

---

## Edge cases

- **Piece ID collision on import.** Bundle has `smudge-luchador`; destination already has a different piece at `smudge-luchador`. Three options: refuse, overwrite, namespace as `smudge-luchador-imported`. Default to **namespace** (safest), with an option to overwrite if the curator confirms.
- **Anchor ID collision.** Anchors come from the in-scene capture tool and are stable across venues with the same geometry. If the destination dashboard is a different venue, the anchor coordinates are meaningless — import should warn loudly: "this bundle was captured against scene commit `a85e4f0`; your scene is at `<other>`. Anchor positions may not match." (We already capture `sceneCommit` per [docs/ANCHOR_CAPTURE_PLAN.md](./ANCHOR_CAPTURE_PLAN.md), so the bundle can carry it forward.)
- **Image fetch failures during export.** If a blob URL 404s (image deleted from Vercel Blob but still referenced in the manifest), the export should either skip that piece + warn, or fail loudly. Default to **warn and continue**, putting the missing piece's `imageMap` entry as `{ status: "missing", reason: "404 from source" }`. Importer then has the choice to import the manifest entry as a broken reference (visible footgun) or to drop the piece.
- **Concurrent export during edit.** The export reads the manifest at one point in time and the images at slightly later times. If the curator deletes a piece mid-export, we could end up with a manifest that references an image we couldn't fetch. Mitigation: snapshot the manifest first, then fetch images by URL (which were valid at snapshot time). Vercel Blob URLs are stable until explicitly deleted, so the race window is small.
- **Auth on the import side.** Anyone with a `.zip` and curator credentials can replace the live scene. That's the same authority as `POST /api/manifest` already grants, so no new attack surface — but the dry-run default means an accidental drag-drop of a malicious file doesn't immediately wreck the show.
- **Size limits.** Vercel serverless functions have body-size limits on requests. For uploads larger than ~4.5 MB the docs recommend client-side direct uploads to blob, then a JSON manifest of references. For exports (response size), streaming is unbounded as long as we stream — but a curator pulling a 500 MB bundle over a flaky network needs resumability. v1 can punt: if your show is over 200 MB, use the CLI export script (post-v1).

---

## Suggested phased build

1. **Export-only, JSON path (steps 1).** New `POST /api/export` returns `application/zip` containing **just** `manifest.json` + `meta.json`, no images. Useful immediately for backup and inspection. Cheap to build. ~half day.
2. **Export with images.** Add the image-fetch + zip-stream step. ~1 day, mostly testing against a real venue's 100+ piece manifest to make sure the streaming actually works under Vercel's function timeouts.
3. **Import (dry run + replace).** New `POST /api/import-bundle`. Validate, dry-run, replace flow. ~1 day.
4. **Import → Save as new template.** Requires templates plan to have landed. Lights up the cross-pollination story. ~half day on top of templates.
5. **CLI script.** Optional. For nightly archives. ~half day.

Total v1 (steps 1–3): **~2.5 days**, fully decoupled from the templates plan — can ship independently or interleaved.

---

## Risks / open questions

- **Function timeout vs. show size.** Vercel serverless functions have a hard wall-clock cap. A 200-piece show pulling images from blob, even at 100ms each, is 20s of network sequentially — fine. 500 pieces or slow blob = problem. Mitigation: parallelize fetches (Promise.all with concurrency limit), or push the export to a background job + email a download link when ready. Probably v2.
- **Whose Vercel Blob holds the re-uploaded images on import?** The destination dashboard's. So a bundle imported into staging populates staging's blob store. Fine, but it doubles storage cost if the same images live in prod and staging. Acceptable for the use case.
- **Cross-schema imports.** If the source dashboard has a newer schema (more frame kinds, new area enum values), the bundle won't validate on an older destination. Forward compatibility is the harder direction; v1 should explicitly refuse rather than silently drop unrecognized fields.
- **Are bundles deterministic?** Two exports of the same manifest, taken seconds apart, should produce byte-identical zips (or close to it) so `diff` and `sha256` are meaningful for audit. To get there: sort the JSON keys, sort the `imageMap`, use a fixed zip timestamp (epoch zero). Cheap, worth doing.
- **Signing / authenticity.** A future-future feature: sign bundles with a key the curator controls, so an importer can verify "this really came from panelhaus." Out of scope for v1; flag for later if cross-venue distribution becomes a real flow.
- **Public sharing.** Should there be a "share read-only" mode — a stable URL where someone can download a published bundle without curator auth? Useful for "here's our showreel" but introduces a new public surface. Defer until asked.

---

## Out of scope

- **Differential exports** ("just the pieces that changed since last export"). Nice for incremental backups; not worth building until the basic full-export is solid.
- **Importing into the scene directly, bypassing the dashboard.** The scene fetches `/api/manifest`; that's the contract. We're not adding a "scene reads a zip" path.
- **Editing the bundle externally and re-importing.** Theoretically supported (it's just files), but we don't promise the round-trip is lossless across arbitrary text editors on Windows/macOS (line endings, encoding). If this becomes a real workflow, ship a CLI editor instead of relying on Notepad.
- **Bundle-level migrations across radically different scene geometries.** If the destination is a fundamentally different building, anchor coordinates are nonsense. Out of scope — the export captures what the source had; reinterpretation for a new venue is human work.
