# Handoff — Editable Anchor Dimensions

From: scene team
To: dashboard team
Date: 2026-05-18
Status: ready to implement; tiny change

## Goal

Let the curator edit `maxWidth` / `maxHeight` on an anchor from the dashboard without re-capturing or re-importing. End-state: the existing AnchorCard grows two number inputs, save flows through the same POST `/api/manifest` we already use for piece assignment.

## Why this is the right knob

The scene side is fully wired today — `maxWidth` and `maxHeight` are first-class schema fields, the manifest already carries them, and the renderer letterbox-fits pieces into that box ([scene src/scene/art/build.ts:fit](../../../AppData/Roaming/creator-hub/Scenes/Panel%20Haus%20Party/src/scene/art/build.ts)). The capture tool sets them from 6 aspect presets ([scene src/scene/dev/anchor-capture.ts:83](../../../AppData/Roaming/creator-hub/Scenes/Panel%20Haus%20Party/src/scene/dev/anchor-capture.ts#L83)) and that's the only knob right now. After import they're frozen unless we re-capture — which is clunky for fixing "this wall fits more art than I thought."

Other options considered (`Piece.displayScale`, per-assignment override) are deferred until this one demonstrably fails. Full analysis at [scene RESIZE_OPTIONS.md](../../../AppData/Roaming/creator-hub/Scenes/Panel%20Haus%20Party/RESIZE_OPTIONS.md).

## What changes

**Schema:** nothing. `Piece` and `Anchor` already validated; both fields already required.

**API:** nothing. `POST /api/manifest` ([phhq_build/app/api/manifest/route.ts](../app/api/manifest/route.ts)) re-validates the full manifest on save — width/height changes are accepted today, there's just no UI to produce them.

**Scene:** nothing. Restart preview, new dims render.

**Dashboard UI:** one file — [app/anchors-view.tsx](../app/anchors-view.tsx).

## The exact change

Today's `AnchorCard` (lines 121-202) shows dims as static text at line 182:

```tsx
<span className="inline-block bg-cream-dark border border-muted px-1.5">
  {anchor.maxWidth}×{anchor.maxHeight}m
</span>
```

Replace with two `<input type="number">` controls that mirror the same save pattern as `updateAnchor` (lines 49-69). Suggested shape:

```tsx
// In the parent component, alongside updateAnchor():
async function updateAnchorDims(anchorId: string, w: number, h: number) {
  if (!manifest) return;
  const next: ManifestT = {
    ...manifest,
    anchors: manifest.anchors.map((a) =>
      a.id === anchorId ? { ...a, maxWidth: w, maxHeight: h } : a,
    ),
  };
  setSavingFor(anchorId);
  setError(null);
  try {
    const saved = await saveManifest(next);
    setManifest(saved);
    setSavedToast(`Saved · v${saved.version}`);
    setTimeout(() => setSavedToast(null), 1800);
  } catch (e) {
    setError(String(e));
  } finally {
    setSavingFor(null);
  }
}

// Pass it down:
<AnchorCard
  ...
  onResize={(w, h) => updateAnchorDims(a.id, w, h)}
/>

// In AnchorCard, replace the static dim chip with:
<div className="flex items-center gap-1 text-[11px]">
  <input
    type="number"
    min={0.5}
    max={20}
    step={0.25}
    defaultValue={anchor.maxWidth}
    disabled={saving}
    onBlur={(e) => {
      const w = parseFloat(e.target.value);
      if (Number.isFinite(w) && w !== anchor.maxWidth) onResize(w, anchor.maxHeight);
    }}
    className="w-14 bg-cream border border-muted px-1 font-mono"
  />
  <span>×</span>
  <input
    type="number"
    min={0.5}
    max={20}
    step={0.25}
    defaultValue={anchor.maxHeight}
    disabled={saving}
    onBlur={(e) => {
      const h = parseFloat(e.target.value);
      if (Number.isFinite(h) && h !== anchor.maxHeight) onResize(anchor.maxWidth, h);
    }}
    className="w-14 bg-cream border border-muted px-1 font-mono"
  />
  <span className="text-muted">m</span>
</div>
```

Why `onBlur` instead of `onChange`: avoids saving on every keystroke (typing "12" would briefly save `1`). Commit on blur or Enter. If you want Enter to commit too, add `onKeyDown` to call `e.currentTarget.blur()`.

Why `defaultValue` not `value`: lets the user type freely without React fighting the input. Reset on parent re-render is fine because the manifest reload after save will give a new key/render.

Why a single combined `onResize(w, h)` rather than two separate `onWidth`/`onHeight`: one POST instead of two when both change.

## Validation

- Front-end: `min=0.5`, `step=0.25`, the `Number.isFinite` guard above.
- Back-end: Zod already enforces `z.number().positive()` on both fields in [schema/manifest.ts](../schema/manifest.ts) — the POST will 422 on garbage.

Reasonable bounds (don't enforce in UI, just nudge with `max`):

- minimum sensible art: 0.5 × 0.5 m
- maximum: ~8 m wide for hero pieces in the atrium / hall of fame. Banner Frame F goes wider.

## Optional follow-ups (skip for v1)

- **Aspect-lock toggle** — small "🔒" button beside the inputs that, when on, computes the matched dim so curators can resize without changing aspect.
- **Preset shortcuts** — same 6 buttons the capture tool uses (1:1, 2:3, 3:2, 16:9, 4:1, 1:4) above the inputs so curators can snap back to a clean aspect after free-form editing.
- **In-scene wireframe sync** — emit an event so the scene can refresh that anchor's preview box without a full reload. Not worth the complexity unless curators are doing many small adjustments.
- **Optimistic UI** — `setManifest(next)` before the await, revert on error. The full-manifest POST round-trip is fast enough that this isn't urgent.

## Test plan

1. Open `/anchors`, edit `f1-cap-1` width from `2` → `4`, blur, see toast `Saved · v10`.
2. `curl https://phhq-dash-rkwi.vercel.app/api/manifest | jq '.anchors[] | select(.id=="f1-cap-1")'` — confirm `maxWidth: 4`.
3. Restart the scene preview, walk to the wall, verify the Smudge Luchador is now bigger (renders 3×3 — square piece letterboxes into the 4×3 box).
4. Bad input: type `0` or `-1`, blur, expect either UI rejection (the `min={0.5}` prompt) or a 422 from POST + the `error` state surfaced.

## Estimate

~30 min of focused work. No new files, no new endpoints, no schema migration, no scene change. The whole patch is in [app/anchors-view.tsx](../app/anchors-view.tsx).
