## Comic Submissions — Ingest & Gallery (dashboard side)

**Status:** ready to implement (pending one external confirmation)
**Date:** 2026-06-02
**Author:** dashboard team

### Decisions (2026-06-02)

| #   | Question                                  | Decision                                                                                                           |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Q1  | Submission as `Piece` or new entity?      | **`Piece` + `tags: ["submission"]`**                                                                               |
| Q2  | Moderation model?                         | **Curator approval queue**                                                                                         |
| Q3  | Gallery wall?                             | **F1 east wall**, FIFO rotation when full; initial anchor count + spacing TBD with curator on the map              |
| Q4  | Auth between panelhaus.app and dashboard? | **Shared bearer token** (`PANELHAUS_INGEST_TOKEN`) — _pending confirmation that panelhaus.app can send the header_ |
| Q5  | Attribution payload?                      | `title`, `artistHandle`, `artistProfileUrl?`, `image`, `submittedAt`                                               |
| Q6  | Image transfer mode?                      | **Multipart upload** to the dashboard, dashboard owns the Blob                                                     |
| Q7  | Side-table for metadata?                  | **`Manifest.submissions: Record<string, SubmissionMeta>`** keyed by Piece id                                       |
| —   | Rejected submissions?                     | **Hard delete** (Piece + SubmissionMeta + Blob), no archive                                                        |

## Scope

Visitors complete the comic quest on **panelhaus.app** — that app owns sign-up, the 5-minute wizard, and the comic export. This doc only covers what the **dashboard repo** has to do:

1. Accept finished comics posted by panelhaus.app.
2. Persist the image + metadata.
3. Auto-place each accepted submission onto a designated gallery wall so the scene renders it without curator intervention.

The wizard, account model, and any client-side editing live on panelhaus.app and are out of scope here.

---

## What already exists (relevant pieces)

- **Curator upload**: [app/api/pieces/upload/route.ts](../app/api/pieces/upload/route.ts) puts files in Vercel Blob at `pieces/{slug}.{ext}` after a NextAuth curator-session check. PNG/JPEG/WebP/GIF, 8 MB cap, 1-year cache headers.
- **Piece schema**: [schema/manifest.ts:41-58](../schema/manifest.ts#L41-L58) — `{ id, src, poster?, aspect, preferredFrame, artist?, title?, link?, tags?, batch? }`.
- **Anchor schema**: [schema/manifest.ts:60-76](../schema/manifest.ts#L60-L76) — wall slot with `pieceId: string | null`. The scene reads `anchor.pieceId` and renders `pieces[pieceId]` there.
- **Auto-placement primitive**: [lib/row-fill.ts](../lib/row-fill.ts) clones a seed anchor along a contiguous wall at a fixed gap. Used by the curator today via the map UI; it has no concept of "next free anchor."
- **Auth**: [auth.ts](../auth.ts) — single shared curator password via NextAuth Credentials. There is no per-visitor identity in this repo and we don't want to add one for this feature.
- **Scene contract**: dashboard writes the manifest → scene polls `/api/manifest` → scene re-renders on change. The pattern is documented in [docs/archive/SCENE_INTEGRATION.md](archive/SCENE_INTEGRATION.md) and [docs/archive/MUSIC_SCENE_HANDOFF.md](archive/MUSIC_SCENE_HANDOFF.md). Any new field added here must round-trip through that loop.

There is no existing submission queue, no community-gallery wall, and no public (un-curator-authed) write endpoint.

---

## Design decisions — rationale

Each subsection records why the locked-in decision at the top of this doc was chosen over the alternative. Kept here so future-us doesn't relitigate.

### Q1. Submission as `Piece`, or new `Submission` entity? → **`Piece`**

- **Chosen: `Piece` + `tags: ["submission"]`** — fewest schema/scene changes. Anchor.pieceId already does the placement work. Curator can filter by tag in the dashboard.
- Rejected: new `Submission` entity. Cleaner separation but requires schema bump, a scene render branch, and a parallel placement system — none of that is earned yet.
- Reopen if: moderation state or attribution grows past what fits on a `Piece` + side-table.

### Q2. Moderation: auto-publish, or approval queue? → **Approval queue**

- **Chosen: approval queue.** Submissions land in a `pending` bucket. Curator clicks Approve in a new dashboard route before they appear in-scene.
- Rejected: auto-publish. Blast radius of a bad submission on a public venue (NSFW, slurs, IP) is too high for v1.
- Reopen if: queue throughput becomes the bottleneck and curator wants to flip a default.

### Q3. Gallery wall? → **F1 east wall**, dedicated, FIFO on overflow

- **Chosen: F1 east wall**, pre-filled with N empty anchors tagged `gallery`. Auto-placement picks the next anchor with `pieceId === null`. When full, oldest submission rotates out (FIFO) and its Blob is GC'd (per the hard-delete decision).
- Rejected: growing the wall via `rowFillPositions` on each arrival. Runaway geometry risk if submissions outpace cleanup.
- **Still TBD with curator on the map:** exact wall span, anchor count, gap, height. Likely a single `rowFillPositions` invocation seeded from a curator-placed anchor on the F1 east face.

### Q4. App-to-app auth? → **Shared bearer token** _(pending external confirmation)_

- **Chosen: `Authorization: Bearer <PANELHAUS_INGEST_TOKEN>`.** Same threat model as the existing curator password — long random string, env var on both sides, rotate by replacing.
- Rejected: HMAC-signed body. More robust against replay; complexity not earned at this scale.
- **Pending:** confirm panelhaus.app can set the header on its outbound POST. If not, fall back to a token in a custom header or query string — same security properties over HTTPS.

### Q5. Attribution payload → **title, artistHandle, artistProfileUrl?, image, submittedAt**

panelhaus.app has the visitor's account; the dashboard doesn't need it, but the scene may want to show "by @handle". These map cleanly onto existing `Piece` fields (`title`, `artist`, `link`); `submittedAt` lives in the side table (Q7), not on `Piece`.

### Q6. Image transfer? → **Multipart upload**

- **Chosen: multipart upload** to `/api/submissions/ingest`. Dashboard does its own Blob put at `submissions/{ulid}.{ext}`, owns file lifecycle, enforces size/type. Mirrors `/api/pieces/upload`.
- Rejected: pre-uploaded URL from panelhaus.app's own bucket. Lighter for us, but we don't control retention and a panelhaus.app outage breaks the in-scene gallery.

### Q7. Side-table → **`Manifest.submissions: Record<string, SubmissionMeta>`**

- **Chosen:** side table on the manifest, keyed by the same id as the Piece. `SubmissionMeta = { status: "pending" | "approved", submittedAt: ISO string, artistHandle: string }`. Scene only reads `pieces` + `anchors` — `submissions` is dashboard-internal.
- Rejected: a separate Postgres/KV store. Overkill — the manifest already round-trips through Blob and gives us the invariant we want.
- Note: rejected submissions are hard-deleted (Piece + SubmissionMeta + Blob), so `status` is effectively binary in storage. The `"rejected"` value never persists.

---

## End-to-end flow

1. **panelhaus.app** finishes a comic → POSTs `multipart/form-data` to `POST /api/submissions/ingest` with `Authorization: Bearer $PANELHAUS_INGEST_TOKEN`. Body: `image`, `title`, `artistHandle`, `artistProfileUrl?`.
2. **Dashboard ingest route** validates token + file (PNG/JPEG/WebP, ≤8 MB), uploads to Blob at `submissions/{ulid}.{ext}`, writes:
   - A `Piece` into `manifest.pieces` with `tags: ["submission"]`, `artist = artistHandle`, `link = artistProfileUrl`.
   - A `SubmissionMeta` into `manifest.submissions` with `{ status: "pending", submittedAt, artistHandle }`.
   - **Does not** assign it to a gallery anchor yet.
3. **Curator** opens a new `/submissions` dashboard page, sees pending entries, clicks Approve or Reject.
4. **Approve handler** flips `status: "approved"`, then picks the F1 east gallery anchor to use:
   - First anchor tagged `gallery` with `pieceId === null` → assign.
   - If all full → find the anchor whose currently-assigned submission has the oldest `submittedAt`, evict it (clear the anchor's `pieceId`, delete the evicted Piece from `manifest.pieces`, delete its SubmissionMeta, delete its Blob), then assign the new submission.
5. **Scene** sees the changed manifest on its next poll and renders the new artwork. No scene-side code changes — same `Piece` + `Anchor` contract it already implements.

**Reject path:** curator clicks Reject → Piece deleted from `manifest.pieces`, SubmissionMeta deleted from `manifest.submissions`, Blob deleted. No archive, no audit trail. Idempotent — re-submission gets a fresh ulid.

---

## What this **doesn't** require

- **No scene-side changes.** Because submissions become `Piece`s on `Anchor`s, the scene's existing render path picks them up. Only relevant if Q1 flips to "new Submission entity."
- **No new auth model.** Curator password remains the only human auth on the dashboard. App-to-app uses a bearer token.
- **No visitor accounts on the dashboard.** Identity stays on panelhaus.app; we just record the handle for display.
- **No comic editor.** That's panelhaus.app's job.

---

## What to nail down before writing code

1. Confirm Q1–Q7 defaults (or correct them).
2. Pick the physical wall + initial anchor count + spacing. Needs a curator decision on the map.
3. Confirm panelhaus.app can POST multipart with a bearer token, and that we're allowed to require it.
4. Decide whether rejected submissions are hard-deleted or soft-archived (affects Blob GC + audit).
