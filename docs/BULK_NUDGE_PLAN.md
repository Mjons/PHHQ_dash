# Multi-Select + Bulk Nudge — Move Anchor Groups Together

**Status:** exploration / pre-design
**Date:** 2026-05-18
**Author:** dashboard team

## What the curator wants

> "Highlight a bunch of anchors and then nudge them on X or Z together."

Why this comes up: a whole row of pieces is 25 cm too far west; the south wall hang is fine but the whole north wall needs to slide 1 m toward the entrance; the VT6 prestige hang at [captures/2026-05-18_vt6-prestige.json](../captures/2026-05-18_vt6-prestige.json) has six anchors that should move as a unit if the wall is repositioned. Doing this anchor-by-anchor today is six saves, six round-trips, six chances to lose your place. The position of every other anchor _relative to its neighbors_ should stay identical — only the group's origin moves.

This doc is about closing the gap between **what the map view can almost do** (multi-select exists, bulk edit panel exists) and **what the curator actually needs** (a `±X` / `±Z` button that nudges every selected anchor by the same delta).

---

## What exists today

### `/map` ([app/map/map-view.tsx](../app/map/map-view.tsx))

- **Shift-click multi-select is real.** [app/map/map-view.tsx:208-219](../app/map/map-view.tsx#L208-L219) — first click selects, shift-click toggles add/remove. Selected anchors render with a highlight at [app/map/map-view.tsx:857](../app/map/map-view.tsx#L857) (`isSel = selectedIds.has(a.id)`).
- **Bulk edits exist for some fields.** `BulkEditPanel` at [app/map/map-view.tsx:1659](../app/map/map-view.tsx#L1659) handles: size presets (W×H), facing (N/E/S/W), allowed frames, Y height, distribute along X or Z, add tags, clear pieces, delete all.
- **What's missing:** nudge X / nudge Z for the selection. There is no `±` button in `BulkEditPanel`. The `patchAnchors(ids, patch)` helper at [app/map/map-view.tsx:221](../app/map/map-view.tsx#L221) is perfectly capable of doing it — there's just no UI calling it with a coordinate delta.

### `/anchors` ([app/anchors-view.tsx](../app/anchors-view.tsx))

- **No multi-select at all.** Cards are independent; each one has its own `±x` / `±z` buttons at [app/anchors-view.tsx:347-391](../app/anchors-view.tsx#L347-L391).
- **Nudge is per-card.** Each click POSTs the full manifest. Moving 6 anchors = 6 saves.
- `NUDGE_STEP = 0.25` is the same constant as on the map ([app/anchors-view.tsx:23](../app/anchors-view.tsx#L23), [app/map/map-view.tsx:39](../app/map/map-view.tsx#L39)).

### The save model

Every patch goes through `POST /api/manifest` which replaces the whole document, bumps `version`, validates with Zod. There's no diff/patch endpoint; the client always sends the entire next manifest ([app/api/manifest/route.ts:27](../app/api/manifest/route.ts#L27)). That's load-bearing for our design: **bulk nudge is naturally one save, not N saves**, because the client constructs the next manifest with all the moves applied and ships it in one round-trip. We don't need a new endpoint.

---

## The actual change is small — what makes it worth a doc

The mechanical work is "add two `±X` / `±Z` button rows to `BulkEditPanel`, wire them to `onPatchAll`." Half an hour of code.

The design questions worth thinking through:

1. **What exactly does "move the group" mean?** Absolute or relative?
2. **Step size — fixed or configurable?**
3. **Should `/anchors` get multi-select too, or is the map the right home?**
4. **Keyboard shortcuts — arrow keys?**
5. **How do we surface the group's bounding box so the curator can predict the move?**
6. **Undo.** Right now a wrong nudge means manually nudging the other direction (or harder, restoring a manifest version). Bulk-nudge magnifies the blast radius.

The "make a row of six slide 1 m left" interaction is the kind of edit that, done wrong, silently misaligns the show. Worth getting the affordances right before shipping.

---

## Design — bulk nudge on the map

### The control

Add a new `FieldGroup` to [`BulkEditPanel`](../app/map/map-view.tsx#L1659), positioned above "Distribute evenly" (it's the more common operation):

```
┌─ Nudge position (all) ────────┐
│   X  [−] [−10cm] [+10cm] [+]  │
│   Z  [−] [−10cm] [+10cm] [+]  │
│                               │
│ x range: 80.25 → 80.25 (0.00) │
│ z range: 0.25 → 31.75 (31.50) │
│ Step: ● 25cm ○ 10cm ○ 1m      │
└───────────────────────────────┘
```

- `[−]` and `[+]` use the active step (default 0.25, same `NUDGE_STEP` already in scope).
- `[−10cm]` / `[+10cm]` are convenience for fine adjustments; `[+1m]` could replace them as a third granularity if we want fewer buttons.
- Step selector lets the curator switch between coarse (1m for "slide the whole wall") and fine (0.10m for "the row is just barely off").
- Bounding-box readout below the buttons makes it visible what's moving as a group. Critical: prevents the "I thought these three were selected but actually only two were" footgun.

### The handler

The existing `patchAnchors(ids, patch)` at [app/map/map-view.tsx:221](../app/map/map-view.tsx#L221) takes a single patch object and applies it identically to every id. That works for "set facing to S" but **not for nudge** — each anchor needs `{x: a.x + delta}` based on its own current value.

Two options:

**Option A: A second helper that takes a per-anchor patch function.**

```ts
async function patchAnchorsFn(
  ids: string[],
  fn: (a: AnchorT) => Partial<AnchorT>,
) {
  if (!manifest || ids.length === 0) return;
  const idSet = new Set(ids);
  const next: ManifestT = {
    ...manifest,
    anchors: manifest.anchors.map((a) =>
      idSet.has(a.id) ? { ...a, ...fn(a) } : a,
    ),
  };
  setSaving(true);
  try {
    const saved = await saveManifest(next);
    setManifest(saved);
    showToast(`Nudged · ${ids.length} anchors · v${saved.version}`, 3000);
  } catch (e) {
    setError(String(e));
  } finally {
    setSaving(false);
  }
}
```

Then nudge X+ is `patchAnchorsFn(ids, (a) => ({ x: round2(a.x + step) }))`.

**Option B: Compute the deltas in the panel and call the existing `patchAnchors` with per-id results.** Awkward — `patchAnchors` doesn't support per-id values today. We'd be widening it to do the same thing as Option A, just with a worse signature.

**Recommend Option A.** Five lines, clean, reusable for any future "transform each selected anchor by its own current value" operation (rotate, scale, flip across axis, etc.).

### Rounding

Floor coordinates are floats. After `a.x + 0.25` we want `80.50`, not `80.4999999`. Use the existing `snap` helper at [app/map/map-view.tsx:48](../app/map/map-view.tsx#L48):

```ts
const snap = (v: number, step = 0.5) => Math.round(v / step) * step;
```

Call it with the nudge step so the result quantizes to the grid. `Math.round(v * 100) / 100` (used in `distributeAnchors` at line 252) is fine as a fallback for sub-step rounding.

### Bounds checking

Each floor has dimensions in [`app/map/floor-data.ts`](../app/map/floor-data.ts). Nudging an anchor past the wall is nonsensical. The simplest safe behavior: **compute the post-nudge bounding box; if any anchor would land outside its area's bounds, refuse the nudge and toast "would move <id> off floor."** Don't clip-and-continue — that breaks the "group moves as a unit" invariant the curator is depending on.

Cross-floor selections (atrium + vt6) probably shouldn't be bulk-nudged at all — coordinates aren't comparable across areas in a meaningful way. Either: (a) refuse if `selectedAnchors` spans multiple `area` values, (b) allow but warn, (c) nudge per-area (each subset moves independently in its own coord frame). **Recommend (a) — refuse with a clear message.** Cross-area selections are valid for "set facing to all" but not for "translate as one group."

---

## Design — keyboard shortcuts

Once a selection exists, the curator's hands are already on the mouse — but arrow keys are the muscle-memory expectation for "nudge selection." Bind on the map view:

| Key             | Action                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `←` / `→`       | Nudge X by `−step` / `+step`                                                                                   |
| `↑` / `↓`       | Nudge Z by `−step` / `+step`                                                                                   |
| `Shift + arrow` | Nudge by 10× step (1 m by default)                                                                             |
| `Alt + arrow`   | Nudge by 0.1× step (2.5 cm)                                                                                    |
| `Esc`           | Clear selection (already wired at [app/map/map-view.tsx:100-104](../app/map/map-view.tsx#L100-L104) for draft) |
| `Ctrl/Cmd + Z`  | Undo last bulk operation (see "Undo" below)                                                                    |

Implementation: add to the existing `onKey` `useEffect` at [app/map/map-view.tsx:99](../app/map/map-view.tsx#L99). Skip if a text input is focused (`document.activeElement instanceof HTMLInputElement`) so typing in the tag input doesn't move anchors.

**Don't** bind arrows on the Anchors card view — too many text inputs, too many ways for a stray keypress to silently move something while the curator thinks they're editing a tag.

---

## Design — multi-select on `/anchors`

Open question whether to add it at all. Two arguments:

**For:** `/anchors` is the curator's text-heavy view. If they're tag-filtering down to "north wall" and want to nudge that whole set, having to switch to `/map` to do it breaks the flow. Adding a checkbox in each card's corner plus a sticky bulk-action bar at the bottom would mirror the map's affordances.

**Against:** `/map` already has selection + bulk edits + a spatial view that makes "what am I about to move" obvious. The card view is a worse place to do positional edits — you can't _see_ the result. Adding multi-select there creates two parallel UX patterns and an inevitable "which view should I use for what?" confusion. The current card-level nudge buttons (one card at a time, one save at a time) are honest about being for single-anchor adjustments.

**Recommend: ship the map-side bulk nudge first; revisit `/anchors` only if the curator reports actually wanting it.** YAGNI on the second view.

If we do later add multi-select to `/anchors`: checkbox in the top-right of each `AnchorCard` (next to the existing `×` delete button), sticky bar at the bottom of the page when `selectedIds.size > 0`, same nudge controls as the map's `BulkEditPanel`. Tag-filtering should still apply — invisible (filtered-out) anchors don't become selected via a "select all" action.

---

## Selection affordances — what gets better

Today's selection model on the map is functional but quiet. Improvements that pair well with bulk nudge:

- **Drag-rect selection.** Click-drag on empty floor to select all anchors inside the rectangle. Today you have to shift-click each one. For "select this whole row" this is a big win. Implement as a transient SVG `<rect>` overlay that follows mouse drag; on mouseup, compute which anchors fall inside the rect's bounding box and `setSelectedIds(new Set([...]))`.
- **Select by row/column heuristic.** "Select all anchors on the same wall" — i.e. same `area`, same `facing`, same coordinate axis to within a tolerance. Useful because that's what the curator usually means when they say "the north wall hang."
- **Select all visible.** Button in the bulk panel: "Select all on this floor" — fills selection with all anchors in `activeArea`.
- **Invert selection.** Less critical, but cheap.

Of these, drag-rect is the one that makes bulk nudge feel native. The others are nice to have.

---

## Undo

Right now there is no undo. Every save bumps `manifest.version` but we don't keep prior versions. A bad bulk nudge ("oh, I moved the whole hang in the wrong direction by 1 m") means the curator has to nudge back the same amount — usually fine, sometimes lossy if they also edited size/tags in the middle.

Options, in increasing cost:

1. **Client-only undo stack.** Keep the last N manifests in React state. `Ctrl+Z` POSTs the previous one. Survives until page reload. ~half day, no schema change.
2. **Server-side version history.** Each `POST /api/manifest` archives the prior to `panelhaus:manifest:v<N-1>` with TTL of a week. Add `GET /api/manifest/versions` and `POST /api/manifest/restore`. ~1 day, but unlocks "what did it look like Tuesday."
3. **Operation-level undo.** Save each user action (nudge, retag, delete) as a discrete record; replay/reverse. Real CRDT-flavored. Out of scope.

For shipping bulk nudge **safely**, option 1 is plenty — the bad case ("I just nudged 12 anchors the wrong way and now I want them back") is exactly what client-stack undo solves. Option 2 is a separate feature worth its own doc.

---

## Phased build

1. **`patchAnchorsFn` helper.** New function in `map-view.tsx` next to existing `patchAnchors`. Trivial. **15 min.**
2. **Nudge X / Z buttons in `BulkEditPanel`.** Four buttons + step selector + bounding-box readout. **1–2 hours.**
3. **Cross-area refuse + bounds check.** Hook into commit path; toast on refuse. **1 hour.**
4. **Keyboard arrow shortcuts.** Add to the existing `onKey` effect with text-input guard. **1 hour.**
5. **Drag-rect selection on the map SVG.** Transient overlay, hit-test on mouseup. **2–3 hours.**
6. **Client-only undo stack (optional v1.5).** Keep last 10 manifests in state. **2–3 hours.**

**Total v1 (steps 1–4):** ~half day. Drag-rect (step 5) is the highest-leverage stretch goal — without it, you still need to shift-click every anchor, which gets tedious for the kind of moves bulk nudge is for.

---

## Risks / open questions

- **Saving on every nudge button click.** A curator who taps `+` 8 times to slide a row by 2 m sends 8 POSTs. Today's single-anchor nudge has the same issue — it's been fine. If it stops being fine, debounce the writes: collect pending deltas, fire one POST after 300ms of quiet. Adds complexity (intermediate state diverges from server state); only do it if needed.
- **Concurrent edits across tabs.** Per [docs/SAVE_FLOW.md:51](../docs/SAVE_FLOW.md#L51), nothing locks. If two curator sessions are nudging at once, last-writer-wins. Bulk nudge magnifies this: a tab with a stale 12-anchor selection could overwrite another tab's recent single-anchor fix. Not introducing a new class of bug, just amplifying. Worth mentioning in onboarding; mitigation belongs in a separate "manifest concurrency" effort.
- **Step granularity vs scene geometry.** The scene's positioning grid isn't documented as snapping to anything in particular. 25 cm has been the default nudge forever and seems to work. If we add 10 cm and 1 m as options, the curator might land on a sub-step value (e.g. 80.10) that doesn't align with anything intentional. Probably fine — anchors are placed by capture-tool JSON to wherever the curator's avatar happened to be standing, which is already not on a clean grid.
- **Visual feedback during nudge.** A 12-anchor bulk move with no animation feels jumpy. Cheap upgrade: a 200ms CSS transition on the anchor circles in the SVG. Worth doing in v1 if simple.
- **Capture-import semantics.** The capture-tool merge at [app/api/import/route.ts:42-45](../app/api/import/route.ts#L42-L45) preserves curator-set fields but **overwrites position** with the captured value. So if the curator nudges a row of 6, then re-runs the capture tool against those same IDs, the nudges are lost. This is a pre-existing footgun, not new — but worth flagging to the curator. Possible mitigation later: mark anchors as "manually positioned" (sticky flag) and have the importer skip position updates on flagged anchors.

---

## Out of scope

- **Rotation of a group around its centroid.** "Rotate the north wall 15°" — non-trivial because facing also has to change. Defer.
- **Scaling a group.** "Spread these 6 anchors apart by 1.5×." Distribute-evenly already handles most of this; explicit scale isn't asked for.
- **Snapping to other anchors.** "Drag-align this anchor's x to that anchor's x." Useful, separate feature.
- **Numeric coordinate input for the group.** "Set x=80 for all." Already possible via the existing per-anchor inputs; bulk equivalent could land later but the typical use is _move by_ not _move to_.
- **Cross-floor group transform.** Sliding atrium+vt6 anchors together — coordinate frames aren't comparable. Refuse and move on.
