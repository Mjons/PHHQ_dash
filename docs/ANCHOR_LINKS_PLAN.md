# Anchor Links — Surface Per-Piece External URLs From the Anchor Card

**Status:** pre-design
**Date:** 2026-05-25
**Author:** dashboard team

## What the curator wants

> "The artist is sending me a spreadsheet with 20 SuperRare / OpenSea / objkt links. I want to drop them on the anchors as I place pieces, not dig through the Pieces tab."

In plain English: today the curator places a piece on an anchor via the **PiecePicker** modal ([app/anchors-view.tsx:226-235](../app/anchors-view.tsx#L226-L235)), and that's it. There is no link field visible on the anchor card. `piece.link` exists in the schema ([schema/manifest.ts:48](../schema/manifest.ts#L48)) and is editable inside the batch-upload "More options" panel ([app/pieces/pieces-view.tsx:1197-1205](../app/pieces/pieces-view.tsx#L1197-L1205)) — but it is **never displayed anywhere after upload, and never read by the scene renderer.** The data is stranded.

## Why this is tractable right now

1. **Schema already supports it.** `piece.link: httpUrl.optional()` is a validated field. No migration, no new types.
2. **One existing surface (batch upload) already writes to it.** The form, validation, and persistence path are proven.
3. **The anchor card is already inline-editable** ([app/anchors-view.tsx:242-516](../app/anchors-view.tsx#L242-L516)) with `note`, `tags`, position, frame. Adding a link row is the same pattern.

The work is **surfacing an existing field on a new screen**, not building new data infrastructure.

---

## Decision: where does the link live?

### Option A — keep it on `Piece`, surface from AnchorCard (recommended)

The link is a property of the artwork, not the wall slot. The same artwork on a different anchor (e.g. moved during a re-hang) should still link to the same marketplace listing. Storing on the piece keeps a single source of truth.

The AnchorCard reads `pieces.find(p => p.id === anchor.pieceId)?.link` and exposes it as an inline editable row. Saving the row patches the piece, not the anchor.

**Pros:** no schema change; same piece moved between anchors keeps its link; matches mental model (link belongs to artwork).
**Cons:** editing from the AnchorCard mutates a piece other anchors might also reference. Mitigation: show "applies to all anchors using this piece" hint when piece is referenced more than once (rare in practice — vault floors have unique pieces).

### Option B — add anchor-level `link` override

New field `anchor.link: httpUrl.optional()`. If set, takes precedence over `piece.link` when rendering.

**Pros:** curator can show a "buy the print" link on one anchor and a "view on chain" link on another, for the same piece.
**Cons:** two fields to reason about, two places to look. We have no concrete use case for divergence yet.

**Pick A.** Revisit if a curator surfaces a real "same piece, different link per anchor" need.

---

## Surfaces

### 1. Dashboard — AnchorCard (in scope)

Add a "Link" row below `note`:

- Renders `piece.link` as a clickable chip + small "edit" button when piece is assigned and has a link
- Renders an "+ Add link" affordance when piece is assigned but `link` is empty
- Hidden when no piece is assigned (anchor has no piece, nothing to link)
- Edit triggers an inline input (same pattern as `note`), validates against `httpUrl` zod, calls a new helper `patchPieceLink(pieceId, url)` that PATCHes the piece in the manifest and saves
- Multi-anchor hint: if `manifest.anchors.filter(a => a.pieceId === piece.id).length > 1`, show a small "shared with N anchors" badge next to the input

### 2. Dashboard — PiecePicker (in scope, small)

Show a tiny chain-link glyph on piece thumbnails that have a link set, so the curator can see at a glance which pieces are "linkable" before placing them. No editing here — the picker stays a picker.

### 3. Scene — render the link as a clickable frame (handed off separately)

The renderer does not currently consume `piece.link`. The scene-side work — attaching a pointer to each placed frame and calling `openExternalUrl(piece.link)` on E-press — has its own handoff at [SCENE_LINKS_HANDOFF.md](SCENE_LINKS_HANDOFF.md). Design rationale and option comparison sit in [SCENE_PIECE_LINKS_EXPLORATION.md](SCENE_PIECE_LINKS_EXPLORATION.md).

**This plan still only changes the dashboard.** The scene handoff is independent and the two ship in either order — the dashboard surface gracefully degrades when `piece.link` is absent, and the scene handler gracefully skips pointer attach for pieces without a link.

---

## Implementation tasks

Small enough to fit in a single PR:

1. **AnchorCard link row** — read piece, render chip/input, wire validation. [app/anchors-view.tsx:242-516](../app/anchors-view.tsx#L242-L516).
2. **`patchPieceLink` helper** — thin wrapper around the existing manifest patch flow used by piece edits. Find the piece in `manifest.pieces`, set `link`, call `saveManifest`. Lives in [lib/client.ts](../lib/client.ts) alongside other patchers.
3. **PiecePicker glyph** — conditional `<LinkIcon>` on thumbnails where `piece.link` is set. [app/\_components/piece-picker.tsx](../app/_components/piece-picker.tsx).
4. **Shared-anchor badge** — derive count from `manifest.anchors`, render inline. Same component.
5. **Empty + invalid states** — input shows zod error inline (matches the `note` pattern).

No new endpoints. No migrations. The manifest write path is unchanged.

---

## Edge cases

- **Piece removed while link is being edited** — the input should close gracefully if the piece disappears mid-edit (concurrent dashboard session, unlikely). Same handling as the existing `note` edit.
- **Link points at a takedown'd listing** — out of scope, curator's problem to keep fresh. We don't lint URLs.
- **Tezos / IPFS URLs** — `httpUrl` zod accepts both. The artist's spreadsheet had `objkt.com`, `superrare.com`, `i2c.seadn.io`, `superrare-artworks.imgix.net`. All resolve fine. `ipfs://` schemes would fail `httpUrl` — if the artist sends raw IPFS, the curator paste-converts to a gateway URL.
- **Pieces with a link uploaded before this lands** — already in the manifest, will just start displaying. No backfill needed.

---

## Out of scope

- In-scene rendering of the link (see Surfaces §3)
- Per-anchor link overrides (see Option B)
- URL preview / OG-card unfurling on the dashboard
- Bulk paste from a spreadsheet (could be a follow-up — map column C → `piece.link` during batch upload by filename match)

---

## Before coding

`AGENTS.md` reminder: this is not stock Next.js — read the relevant guide in `node_modules/next/dist/docs/` before touching routing or server actions. This plan stays in client-side patching territory (existing `saveManifest` path), so the blast radius is small, but the reminder applies if the manifest write path needs server work.
