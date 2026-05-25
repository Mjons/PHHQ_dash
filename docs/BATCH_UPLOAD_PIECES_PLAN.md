# Batch Upload for Pieces — Drop Many, Save Once

**Status:** exploration / pre-design
**Date:** 2026-05-18
**Author:** dashboard team

## What the curator wants

> "When a new show comes in I have 40-something files in a folder. Right now I drop them in one at a time, type a slug, type a batch, type an artist, click upload, wait, repeat. Forty times. There has to be a way to throw the whole folder at it."

Plus the obvious follow-on:

> "And if half of them are the same artist in the same batch, I shouldn't have to type that forty times either."

In plain English: today the Pieces tab is a **one-piece-at-a-time** form ([app/pieces/pieces-view.tsx:367-378](../app/pieces/pieces-view.tsx#L367-L378)). One file, one slug, one upload POST to [/api/pieces/upload](../app/api/pieces/upload/route.ts), one `saveManifest` POST, one toast. The whole flow blocks until that piece is committed. For a 40-piece residency drop, that's 40 round-trips and 40 forms.

Everything the curator wants — multi-file picker, shared metadata, queue + progress, atomic-ish save — can be built **on top of the existing single-file upload endpoint** without changing the server contract. This doc walks the options for how that fan-out happens (pure client loop vs. server-side multi-file vs. presigned direct-to-Blob), what slug/conflict logic looks like for a batch, and how to keep the manifest save sane when 40 pieces land at once.

---

## Why this is tractable right now

Three things make it cheap:

1. **The single-file endpoint is already idempotent and small.** [app/api/pieces/upload/route.ts:16](../app/api/pieces/upload/route.ts#L16) is one auth check + one `put()` to Vercel Blob + a JSON response. Calling it N times in parallel is fine — no shared state between calls, no rate limits we'd hit before the curator's bandwidth does.

2. **All the per-file metadata the curator cares about is already client-derivable.** `aspect` is computed in the browser at [app/pieces/pieces-view.tsx:49-64](../app/pieces/pieces-view.tsx#L49-L64); `slug` is already auto-generated from the filename at [app/pieces/pieces-view.tsx:112](../app/pieces/pieces-view.tsx#L112). No new server work to get sensible defaults for N files.

3. **The manifest write is one POST regardless of batch size.** `saveManifest` at [lib/client.ts:9](../lib/client.ts#L9) PUTs the whole document; adding 1 vs. 40 entries to `pieces` doesn't change the wire shape. So the bottleneck isn't manifest writes — it's the N blob uploads.

Together: client picks N files → fan out N parallel uploads to existing endpoint → collect URLs → build N `Piece` entries → one `saveManifest`. The hard parts are UX (progress, errors, edits) and a couple of edge cases around slug collisions and the manifest-version race.

---

## Three strategies for how the upload happens

### A. Pure client-side fan-out (recommended)

Loop the existing `/api/pieces/upload` endpoint N times from the browser. Each file gets its own `fetch`. Use a concurrency cap (e.g., 4 in flight) so a 40-file drop doesn't open 40 simultaneous connections.

```ts
async function uploadAll(drafts: Draft[], concurrency = 4) {
  const results: { draft: Draft; url?: string; error?: string }[] = [];
  let i = 0;
  async function worker() {
    while (i < drafts.length) {
      const idx = i++;
      const d = drafts[idx];
      try {
        const url = await uploadOne(d); // posts to /api/pieces/upload
        results[idx] = { draft: d, url };
      } catch (e) {
        results[idx] = { draft: d, error: String(e) };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
```

After the loop, build a single `Pieces` map from successes and `saveManifest` once.

**Pro:** zero server changes. Reuses the validated, auth'd, blob-size-checked endpoint that already exists. Per-file progress is trivial (each `fetch` is its own promise). If one file fails, the other 39 still succeed. No new tests for the server.
**Con:** N round-trips of auth check + form parse. For 40 small files this is a few hundred ms of overhead total — invisible compared to the actual blob upload time. Bigger drops (200+) would start to matter, at which point Strategy C wins.

### B. Server-side multi-file endpoint

New `POST /api/pieces/upload-batch` that accepts `FormData` with multiple `file` entries plus a parallel array of slugs/batches. Server uploads each to Blob in a `Promise.all` and returns an array of `{slug, url} | {slug, error}`.

```ts
const files = form.getAll("file") as File[];
const slugs = form.getAll("slug") as string[];
const results = await Promise.all(
  files.map((f, i) => safePut(slugs[i], f).catch((e) => ({ error: e }))),
);
return NextResponse.json({ results });
```

**Pro:** one round-trip from the client. Easier to reason about for "did everything succeed" because the server gives a single answer. Server can dedupe slug-conflict checks against an in-flight set, avoiding two files in the same batch racing to the same path.
**Con:** Vercel's serverless body limit (~4.5 MB default, can be raised to ~50 MB via [`config.api.bodyParser`](https://nextjs.org/docs/api-routes/api-middlewares) — but we're on the App Router, so it's [`route.ts` runtime config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config) and harder to push past 50 MB without going to Edge / streaming). 40 × 8 MB = 320 MB → won't fit in a single request. We'd need a chunking layer that defeats the "one round-trip" benefit. Also: any single-file error in the array doesn't fail-fast cleanly; the per-file error reporting we still need to build, so the simplicity gain is partly illusion.

### C. Direct-to-Blob with presigned tokens

Use `@vercel/blob`'s [`createClientTokenFromReadWriteToken`](https://vercel.com/docs/storage/vercel-blob/client-upload) (or the newer `handleUpload` callback pattern) so the browser PUTs straight to Blob with a short-lived token. The server only mints tokens.

**Pro:** uploads don't touch the serverless function at all — no body-size limit, no cold-start cost on each file, near-linear scaling to hundreds of files. This is what Vercel's docs actually recommend for "user uploads images" flows.
**Con:** auth boundary shifts. Token route has to enforce that only curators can mint, and the token itself has to encode allowed pathname prefixes so a leaked token can't be used to overwrite arbitrary blobs. More moving parts, more tests, and a real refactor of the upload path. Worth it eventually; overkill for a curator who uploads in batches of 40, not 4000.

### Recommendation

**Strategy A for v1.** It's the smallest delta — zero server change, ~150 LoC of client work — and 40-file batches comfortably fit in its envelope. Save B and C for if/when the curator starts saying "I dropped 200 files and it crawled" (B is a dead end at that scale because of body limits; jump straight to C).

The rest of this doc assumes Strategy A.

---

## UI flow — the queue panel

Replace the current `UploadPanel` at [app/pieces/pieces-view.tsx:515](../app/pieces/pieces-view.tsx#L515) with a queue-aware version. The single-file flow is just "queue of 1" — same component, no special-cased single mode.

### Drop step

Drag-drop or click-to-pick accepts **multiple files** (`<input multiple>`). The existing single-file handler at [app/pieces/pieces-view.tsx:99](../app/pieces/pieces-view.tsx#L99) extends to:

```ts
async function pickFiles(files: FileList | File[]) {
  const drafts: Draft[] = [];
  for (const file of Array.from(files)) {
    const { preview, aspect } = await fileToImageMeta(file);
    drafts.push({
      ...EMPTY_DRAFT,
      file,
      preview,
      aspect,
      slug: slugify(file.name.replace(/\.[^.]+$/, "")),
      // shared fields (artist, batch, preferredFrame, tags) inherit
      // from the queue header — see "Shared metadata" below
    });
  }
  setQueue((q) => [...q, ...drafts]);
}
```

`fileToImageMeta` already returns aspect + preview URL per file. Run it in `Promise.all` so 40 files load in parallel.

### Queue step

Show the drafts as a list of rows, each with:

- thumbnail (the existing `preview`)
- slug (editable inline)
- title (editable inline, optional)
- aspect badge (read-only)
- preferred frame (small dropdown)
- per-row tag chips (defaulting to the shared tags from the header)
- status icon: `pending` / `uploading…` / `done` / `error: …`
- per-row × to drop from the queue
- per-row ↻ to retry after a failure

Above the list, a **batch header** with shared fields that apply to every draft:

```
[ artist: ____________ ]  [ batch: ____________ ]  [ preferredFrame: A B C D E F ]
[ tags: hero, alumni ]
[ ☐ replace existing slugs ]    [ Upload 40 pieces ]   [ Clear queue ]
```

Editing a header field updates every queued draft's corresponding field **unless** the user has explicitly edited that field on a specific row (track a `Set<rowId>` of "user-touched" fields so the header doesn't blow away per-row edits).

This keeps the common case — "all 40 are by Jane Doe in batch `residency-2026-q3`" — to typing two values once. Per-piece overrides happen naturally when the curator clicks into a row.

### Upload step

Hitting "Upload N pieces" runs the fan-out from Strategy A. The queue rows live-update:

- `pending` → `uploading…` (spinner) when a worker picks them up
- → `done` (green check) on success, with the returned URL stashed in the draft
- → `error: <message>` (coral) on failure, with the per-row ↻ retry surfaced

A header progress bar shows `12/40 done · 2 failed · 26 pending`.

### Commit step

When the queue settles (no more `pending` / `uploading…` rows), the panel shows:

```
38 uploaded · 2 failed (retry or skip them)

[ Save 38 pieces to manifest ]    [ Retry failed ]    [ Skip failed and save 38 ]
```

Save is a single `saveManifest()` with all `done` rows added to `manifest.pieces`. Failed rows stay in the queue so the curator can fix and retry — or skip and re-upload later.

**Why split blob-upload from manifest-save into two explicit phases:** if the curator notices a typo on row 5 _after_ uploads finish but _before_ commit, they can fix the slug, retry that one row, and only then commit. The blob is uploaded to a sticky path on the first try — see the "stale blob" risk below.

---

## Slug derivation and collision handling

Filenames are usually messy (`IMG_2031.jpg`, `Jane Doe - Smoke Signal (final).png`). The existing `slugify()` at [app/pieces/pieces-view.tsx:66-72](../app/pieces/pieces-view.tsx#L66-L72) handles the basic case. Three collision classes to handle:

1. **Two files in the same batch slugify to the same thing.** `jane-doe-smoke.png` and `Jane Doe - Smoke.png` both become `jane-doe-smoke`. Detect on queue add; suffix the later one `-2`, `-3`, etc. Show a one-line "Auto-renamed `jane-doe-smoke` → `jane-doe-smoke-2`" in the row hint so the curator notices.

2. **Slug collides with an existing piece in the manifest.** Today single-file upload prompts ([app/pieces/pieces-view.tsx:127-131](../app/pieces/pieces-view.tsx#L127-L131)). For 40 files we can't 40-prompt. The batch header has a single **"Replace existing slugs"** checkbox; default off (skip with a warning), on means overwrite. Per-row indicator if a slug collides ("⚠ exists — will be skipped" or "⚠ exists — will overwrite"). Curator can edit the slug inline to dodge if they want neither.

3. **Slug fails the server regex.** The server regex at [app/api/pieces/upload/route.ts:42](../app/api/pieces/upload/route.ts#L42) is `/^[a-z0-9][a-z0-9_-]*$/i`. Run that client-side as the curator types so they don't discover the rule mid-upload. `slugify()` already produces compliant output for the auto-suggested case.

### Why not auto-suffix collisions with existing pieces too

Tempting — drop 40 files, anything that collides becomes `name-2`, no checkbox needed. But it silently creates duplicates: `jane-doe-smoke` AND `jane-doe-smoke-2` both exist, pointing to similar-but-different images, with no way to tell which the curator "meant." Worse, anchors assigned to the original `jane-doe-smoke` stay pointing there, so the new file appears unused. Better to make the curator decide: replace, skip, or rename.

---

## Manifest save — atomicity and the version race

Today `saveManifest` is read-modify-write with no version check:

```ts
// app/api/manifest/route.ts:48-55
const existing = await readManifest();
const next = { ...parsed.data, version: existing.version + 1, ... };
await redis.set(MANIFEST_KEY, next);
```

A batch upload doesn't make this worse, but it makes the **lost-update window** more painful. Sequence:

1. Curator A queues 40 files at v100.
2. Curator A clicks "Upload" — 40 blob PUTs start in parallel.
3. Meanwhile Curator B (or scene-side capture import) writes the manifest → v101.
4. Curator A's blobs finish; client builds `next` from the **v100 manifest it loaded at step 1** and POSTs.
5. Server `existing.version` is now 101; saves as v102, but `next` no longer contains Curator B's v101 anchors.

Two fixes, smallest first:

### Refresh-before-commit (recommended for v1)

When all blobs are done, **re-fetch the live manifest** and merge the new pieces into _that_, not into the stale v100 client copy. The pieces map is keyed by slug, so the merge is a `{...live.pieces, ...newPieces}` — last-write-wins on slug, which matches the "replace existing" intent anyway. Anchors aren't touched by piece upload, so Curator B's anchor work survives.

```ts
async function commitBatch(newPieces: Record<string, PieceT>) {
  const live = await fetchManifest();
  const next: ManifestT = {
    ...live,
    pieces: { ...live.pieces, ...newPieces },
  };
  return saveManifest(next);
}
```

Same number of POSTs (1), no schema change, plugs the race for the realistic case (curator + scene capture racing, not two curators racing each other).

### Optimistic-lock-on-version (do later, if needed)

Add an `If-Match: <version>` header on the manifest POST; server 409s if `existing.version !== requested-base`. Forces explicit conflict resolution. Worth doing if we ever get more than one curator, but a 409 mid-batch is also a worse UX than the refresh-before-commit "your save also picked up someone else's anchor edit" silent merge. So: ship the merge for v1, revisit if real conflicts appear.

---

## What happens to blobs from a partial / abandoned batch

If the curator uploads 40 blobs and then closes the tab before clicking "Save to manifest," the blobs exist in Vercel Blob storage but no `Piece` entry points at them. They're **orphans** — invisible in the dashboard, costing storage, never garbage-collected.

Three options, increasing effort:

- **Accept the leak (v1).** A residency drop is 40 × 4 MB ≈ 160 MB. Even 10 abandoned batches a year is < 2 GB. Vercel Blob storage is cheap and orphans don't break anything. Document it; move on.
- **Manual sweep tool.** A `/admin/blob-orphans` page that lists blobs under `pieces/` whose paths don't appear in any `Piece.src`. One button to delete. Same idea exists implicitly today (any deleted piece leaves its blob behind — see [app/pieces/pieces-view.tsx:200-204](../app/pieces/pieces-view.tsx#L200-L204)). Worth bundling with this work since batch upload widens the same gap.
- **Tombstone-before-upload.** Stash the intended slugs in a Redis set _before_ uploads start; if commit doesn't happen within 1h, a cron deletes the matching blobs. Overkill for v1.

Recommend **manual sweep tool** — it's a one-afternoon add and solves both this leak and the existing single-file delete leak. Tracks under "Out of scope" if we don't bundle.

---

## Schema changes — none

`Piece` ([schema/manifest.ts:30](../schema/manifest.ts#L30)) and `Manifest` ([schema/manifest.ts:99](../schema/manifest.ts#L99)) don't change. Batch upload writes the same shape that single upload writes, just N at a time. The `batch?: string` field already exists on `Piece` and groups them in the list ([app/pieces/pieces-view.tsx:269-280](../app/pieces/pieces-view.tsx#L269-L280)) — the queue header writes the same field on every uploaded piece, so the resulting list groups itself automatically.

Optional, only if we want to track provenance later: an `uploadGroupId?: string` so "show me everything uploaded together on Tuesday" is queryable. Cheap to add and ignored by the scene. Probably YAGNI; `batch` is doing 90% of that job already.

---

## API surface — none

Same as the Anchor Patterns doc: zero new endpoints. Strategy A uses the existing `POST /api/pieces/upload` ([app/api/pieces/upload/route.ts:16](../app/api/pieces/upload/route.ts#L16)) for blobs and the existing `POST /api/manifest` for the single commit. The server doesn't know batches exist.

This is on purpose. If we later add Strategy C (presigned tokens), _that_ adds one endpoint (`POST /api/pieces/upload-token`), but the current batch UI doesn't change shape — the worker function just calls a different upload path.

---

## Risks / open questions

- **Aspect detection on huge files blocks the UI.** `fileToImageMeta` decodes the image to read `naturalWidth/Height`. For 40 × 12 MP PNGs this can pin the main thread for seconds. Mitigation: run aspect probing through a `Promise.all` with a small concurrency cap (e.g., 6), and show "reading…" placeholders in queue rows so the curator knows the panel isn't frozen. If it's still bad, move the decode to an `<canvas>` off-screen or a Worker.

- **Bandwidth-bound batches stall the UI.** 40 × 4 MB on a residential 10 Mbps uplink is ~2.5 minutes of upload. Concurrency 4 helps utilization but doesn't shrink total bytes. Surface a kbps estimate from the first completed file to give the curator a realistic ETA in the progress bar, rather than a silent spinner.

- **`document` drag-leave events fire on child elements.** The existing single-file drop zone at [app/pieces/pieces-view.tsx:539-550](../app/pieces/pieces-view.tsx#L539-L550) uses `onDragEnter`/`onDragLeave` and is fine for a small target. The queue panel is bigger and the row list will flicker `dragOver` on/off as the cursor crosses rows. Standard fix: counter pattern (`enter++`, `leave--`, `dragOver = counter > 0`).

- **Per-row tag inheritance can confuse.** If the header tag bar says `hero, alumni` and the curator removes `hero` from row 5, then later adds `2026` to the header, does row 5 get `alumni, 2026` or `hero, alumni, 2026`? Cleanest answer: track per-field "user-touched" flags on each row; header writes only to untouched fields. Surprising but defensible. Spell it out in the curator guide.

- **Replace-existing checkbox is a footgun at scale.** "Replace existing slugs" applied to a 40-file batch can silently overwrite 40 curated pieces. Mitigation: when the checkbox is on AND the queue contains ≥1 colliding slug, show an inline summary ("Will replace 7 existing pieces: jane-01, jane-02, …") above the Upload button. Force the curator to look at the list before clicking.

- **Network failure mid-upload leaves a half-uploaded batch.** Vercel Blob `put()` is atomic per file, so a dropped connection means that file's status flips to `error` while siblings continue. The queue model handles this — retry just re-runs the failed rows. No partial-blob cleanup needed.

- **Slug-conflict check is racy against another curator deleting/adding pieces between queue-add and upload.** Same answer as the manifest version race: re-check at commit time. The cost of a wrong skip in the meantime is low; the curator sees "skipped 1 — slug now free" and can retry.

---

## UX detail: the "queue of 1" case

When the curator drops a single file, the queue panel should still feel as light as today's single-file form. Render rules:

- Queue length 1: collapse the row inline into the panel body so it visually matches the current `UploadPanel`. Header batch fields render as today's batch/artist/etc. inputs. No "Upload 1 pieces" button — just "Upload."
- Queue length ≥ 2: switch to the list-with-header layout described above.

Implementation-wise it's one component with a conditional render at the top — not two components — so the single-file path doesn't bit-rot when the queue path is the main one being used.

---

## Estimate

- `lib/upload-queue.ts` — fan-out worker, concurrency cap, status state machine: **half day**.
- Queue panel UI (replaces `UploadPanel`): rows, header, progress, error handling, drag-drop: **1 day**.
- Inline collision detection + auto-suffix + "replace existing" affordance: **half day**.
- Refresh-before-commit merge logic + tests: **quarter day**.
- Orphan blob sweep tool (optional, bundled here): **half day**.

Total **~2.5 days** without the sweep tool, **~3 days** with. Ships behind nothing — the existing single-file form gets replaced by the queue version, and "drop one file" is the queue-of-1 special case.

---

## Out of scope (so we don't conflate)

- **Server-side image processing.** No thumbnailing, no format conversion, no compression. Vercel Blob serves the original file; aspect is read client-side. If we ever need responsive variants, that's a separate pipeline (probably Vercel Image Optimization, not us).

- **ZIP / folder upload.** Modern browsers can't read folder contents via `<input type="file" webkitdirectory>` reliably cross-platform, and parsing a ZIP client-side is doable but bloats the bundle. Defer until a curator actually asks for it.

- **CSV/JSON metadata sidecar.** "Drop `pieces.csv` + a folder of images and we'll match titles/artists per file." Plausible v2 once batch upload is in hand and the curator is tired of typing artist into the header. Schema for the sidecar is a 10-line spec; the matcher is a few lines. Not v1.

- **Direct-to-Blob presigned uploads (Strategy C).** Documented above as the eventual scaling answer. Don't build until volume forces it.

- **Bulk re-edit of existing pieces.** "Select 20 pieces in the grid and set their batch to `q4-rotation`." Useful but unrelated — it's a Pieces _list_ operation, not an upload operation. Worth its own small doc when the curator hits it.

- **Multi-file upload for Books.** The Books flow at [lib/client.ts:59](../lib/client.ts#L59) already takes one file per call, and books have per-asset semantics (cover vs. page-N vs. back-cover) that don't map cleanly onto a flat queue. Different shape problem; out of scope here.
