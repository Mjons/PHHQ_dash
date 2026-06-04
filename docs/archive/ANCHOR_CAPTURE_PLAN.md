# In-Scene Anchor Capture

Walk through the venue in-game, mark anchor positions by looking at walls, export a JSON, drop it into the dashboard. One-time bootstrap that seeds the entire manifest with real, walked-to-the-wall coordinates instead of eyeballed-from-a-top-down-map approximations.

## Why bother

The dashboard's map view is great for _editing_ once anchors exist — dropdown the piece, drag a marker, swap a frame. It's mediocre for _creating_ anchors from scratch, because you're estimating where a wall is on a 2D plan when the actual feel of "is this the right wall, the right height, the right facing" only comes from standing in front of it. Doubly true for a stylized space like this where walls aren't on grid edges and floors have funky shapes (F4 L-shape, F5 Pavilion bridge, atrium void).

The fix: turn the **scene itself into the surveying tool.** Walk to a wall, press a key, captured. Repeat for the whole venue. Export, upload, done. The dashboard becomes the place you _curate_ anchors that already exist, not the place you _invent_ them.

---

## TL;DR — the loop

```
┌────────────────────────────┐    ┌─────────────────┐    ┌────────────────────┐
│ Scene (debug-gated)        │    │ JSON file /     │    │ Dashboard          │
│                            │    │ clipboard       │    │                    │
│  walk to wall → press M    │───▶│ {anchors: [...]}│───▶│ paste into Import  │
│  raycast captures pos +    │    │                 │    │ modal → merge into │
│  wall normal               │    │                 │    │ manifest           │
└────────────────────────────┘    └─────────────────┘    └────────────────────┘
```

Three pieces:

1. **In-scene capture mode** — a dev-only overlay in the DCL scene with hotkeys to mark, undo, and export.
2. **Capture JSON** — same shape as the manifest's `anchors` array, so importing is a merge, not a translation.
3. **Dashboard import endpoint** — a paste-and-validate modal that adds/updates anchors in the live manifest.

---

## In-scene capture mode

A new module: `src/scene/dev/anchor-capture.ts`. Gated by an env flag or wallet allowlist so it never ships to public visitors.

### How a single capture works

1. Player walks to a wall and aims the camera at it.
2. Player presses `M`.
3. Scene fires a `Raycast` from the camera forward.
4. The first hit gives **hit point** + **surface normal**.
5. From that, we derive:
   - `x`, `z` — the hit point (snap to 0.5m).
   - `facing` — the cardinal direction closest to `-normal` (the art faces _away_ from the wall, opposite of the wall's outward normal).
   - `area` — derived from the player's current Y position vs. the floor base heights in [constants.ts](src/scene/constants.ts).
   - `id` — auto-generated `<area>-capture-<n>`, editable later.
6. The anchor goes into an in-memory list. A small UI overlay updates the count.

### Hotkey map

| Key | Action                                                             |
| --- | ------------------------------------------------------------------ |
| `M` | Mark anchor at raycast hit (the main one)                          |
| `U` | Undo last capture                                                  |
| `R` | Re-capture the last one (replace position/facing with current aim) |
| `N` | Open a chat-message-style prompt to attach a note to the last one  |
| `E` | Export — copy JSON to clipboard, also log to console               |
| `C` | Clear all captures (with confirmation)                             |

DCL doesn't expose raw keyboard easily, so in practice these become **on-screen buttons** in the overlay UI plus optional input actions. Buttons are fine — capturing isn't a hot loop.

### What the overlay shows

```
┌──────────────────────────────┐
│ ANCHOR CAPTURE              │
│ 7 captured · last: f2-cap-3 │
│ [ Mark ] [ Undo ] [ Note ]  │
│ [ Export ] [ Clear ]        │
└──────────────────────────────┘
```

Top-right corner. Cream + ink-black + gold to match the venue's aesthetic. Hidden in production builds.

### Raycast specifics

DCL SDK7 exposes `Raycast` via `engine.addEntity()` + `Raycast.create()` + `RaycastResult` reading. The pattern:

```ts
// pseudocode — finalize against the SDK7 API at build time
function captureAnchor() {
  const camera = Transform.get(engine.CameraEntity);
  const ray = engine.addEntity();
  Raycast.create(ray, {
    origin: camera.position,
    direction: cameraForward(camera.rotation),
    maxDistance: 5,
    queryType: RaycastQueryType.RQT_HIT_FIRST,
    continuous: false,
  });
  // Read RaycastResult next frame...
}
```

Range capped at ~5m so the player has to actually walk close to a wall — keeps captures honest.

### Inferring `facing` from the normal

```ts
function normalToFacing(normal: Vector3): "N" | "E" | "S" | "W" {
  // Art faces away from the wall (opposite of wall normal).
  const artDir = Vector3.negate(normal);
  // Pick the dominant axis.
  if (Math.abs(artDir.z) > Math.abs(artDir.x)) {
    return artDir.z > 0 ? "N" : "S";
  }
  return artDir.x > 0 ? "E" : "W";
}
```

Snaps any wall orientation to the four cardinal facings the frame primitives accept. Diagonal walls round to whichever cardinal is closest — good enough; curator adjusts later in the dashboard if needed.

### Inferring `area` from Y

Compare player Y to `FLOOR_BASE` in [constants.ts](src/scene/constants.ts). Whichever floor base is just below the player → that's the area. Special cases: if X > 80 (the Vault Tower x-range), prefix with `vt` and pick the VT-internal floor by Y banding (every 8m). If the player is over the atrium void parcel (48 ≤ x ≤ 64 AND 32 ≤ z ≤ 48), it's an atrium anchor regardless of Y.

```ts
function inferArea(pos: Vector3): Area {
  if (pos.x >= 80) {
    const vtBase = Math.floor((pos.y - 12) / 8); // 12m above F1 floor = vt2 base
    return ["vt2", "vt3", "vt4", "vt5", "vt6"][
      Math.max(0, Math.min(4, vtBase))
    ];
  }
  if (pos.x >= 48 && pos.x <= 64 && pos.z >= 32 && pos.z <= 48) {
    return "atrium";
  }
  if (pos.y < 12) return "f1";
  if (pos.y < 22) return "f2";
  if (pos.y < 31) return "f3";
  if (pos.y < 47) return "f4";
  return "f5";
}
```

Curator can override `area` later in the dashboard if the heuristic gets it wrong.

---

## Capture JSON shape

Identical to the dashboard manifest's `anchors` array entries, so import is a structural merge:

```json
{
  "capturedAt": "2026-05-17T22:15:00Z",
  "sceneCommit": "f3a2b1c",
  "anchors": [
    {
      "id": "f2-capture-1",
      "area": "f2",
      "x": 40.5,
      "z": 18.0,
      "facing": "S",
      "maxWidth": 3,
      "maxHeight": 3,
      "allowedFrames": ["A"],
      "pieceId": null,
      "note": ""
    },
    {
      "id": "vt5-capture-1",
      "area": "vt5",
      "x": 88,
      "z": 8,
      "facing": "W",
      "maxWidth": 2,
      "maxHeight": 2,
      "allowedFrames": ["A", "B"],
      "pieceId": null,
      "note": "hof — first wall on entry"
    }
  ]
}
```

Defaults applied on capture:

- `maxWidth` / `maxHeight`: 3×3 (sensible mid-size; resize later).
- `allowedFrames`: `['A']` (Ink, the most common default).
- `pieceId`: always `null` on capture — pieces get assigned in the dashboard.
- `note`: empty unless the curator pressed `N` to add one.

`capturedAt` and `sceneCommit` are metadata for debugging ("when was this surveyed, against what scene version?") — the dashboard import ignores them.

---

## Dashboard import

New button on the Anchors view: **"Import from scene capture"**. Opens a modal:

```
┌─────────────────────────────────────────────────────────┐
│ Import anchors from in-scene capture                    │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Paste capture JSON here…                            │ │
│ │                                                     │ │
│ │                                                     │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ☐ Update existing anchors if IDs match                  │
│ ☐ Add new anchors                                       │
│                                                         │
│             [ Cancel ]  [ Preview ]  [ Import N ]       │
└─────────────────────────────────────────────────────────┘
```

Flow:

1. Curator pastes the JSON.
2. Click **Preview** → Zod validates, dashboard shows a diff: `5 new, 2 updated, 0 conflicts`.
3. Per-anchor checkboxes (defaulted all-on) let the curator skip individual entries.
4. Click **Import N** → merges into the active manifest, bumps `version`, fires the same save toast.

Idempotent: re-importing the same JSON is a no-op (matches by `id`, sees no changes, doesn't bump version).

**The dashboard becomes the editor; the scene capture is the surveyor.** Curator never types coordinates.

---

## Image folder convention

When the curator uploads piece images in the dashboard, the form collects:

| Field      | Example value       | Used for                                        |
| ---------- | ------------------- | ----------------------------------------------- |
| **Batch**  | `residency-2026-q3` | Mental folder (free text or dropdown of recent) |
| **Slug**   | `jane-doe-01`       | Becomes the piece ID                            |
| **Title**  | `Smoke Signal`      | Display name                                    |
| **Artist** | `Jane Doe`          | Display name                                    |

Behind the scenes Vercel Blob stores files at hashed URLs (`https://….vercel-blob.com/abcd1234/jane-doe-01.webp`), so the "folder" is metadata, not a real path. But the manifest carries `batch` and `slug` as fields, so:

- Pieces view in the dashboard groups by batch (one section per show)
- A future "purge old shows" command can delete all pieces in `residency-2026-q1` in one click
- Logical organization survives even though the underlying URLs are flat

This gets you the _feeling_ of `assets/art/residency-2026-q3/jane-doe-01.webp` without managing a real folder hierarchy.

---

## Honest tradeoffs

**Pro: real positions, no eyeballing.** A 2D map can't tell you that the wall jogs back 30cm at the F4 stage. Walking to it tells you instantly.

**Pro: aesthetic judgment in-place.** "Does a 3×3 piece make sense here?" is answered by standing where the viewer will stand. The dashboard map can't do that.

**Pro: re-survey is cheap.** After an architectural change, walk the affected area, re-export, re-import. Updates by ID, doesn't lose any curator edits to `pieceId` / `note`.

**Con: another tool to maintain.** Capture mode is scene-side code that has to keep working as the SDK evolves. Mitigation: keep it 200 lines tops, hidden behind a flag, tolerate minor breakage.

**Con: initial survey is a focused afternoon.** Walking the whole venue marking ~25 anchors, even at 2 minutes each, is an hour of focused work. Worth it because it's _one_ hour, not "every time."

**Con: DCL raycast can have jank.** Some surfaces won't return a clean normal (especially custom GLB models without proper colliders). Mitigation: fallback to player-position-+-camera-forward if raycast fails, and let the curator nudge in the dashboard after.

---

## Alternatives considered

| Option                                                   | Why not                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| Eyeball from dashboard 2D map only                       | Works for ~5 anchors. Painful at 25+. Loses the spatial intuition.  |
| Manual: jot coords in a notebook                         | Slow, error-prone, transcription errors. Same effort, worse output. |
| Visual "anchor inspector" mode (read-only, see existing) | Useful but doesn't help bootstrap. Build later if needed.           |
| Capture by clicking 3D entities in the editor            | DCL doesn't have a Unity-style scene editor with click-to-place.    |

Stick with the in-scene capture overlay — it's the right combination of accuracy, low maintenance, and curator ergonomics.

---

## What to build first

1. **Hour 1:** `anchor-capture.ts` skeleton with the overlay UI (no raycast yet — buttons that capture the player's current position + camera forward as a fallback). Verify the JSON export shape.
2. **Hour 2:** Wire up raycast for accurate wall-hit position + normal-to-facing inference.
3. **Hour 3:** Add the inferArea logic, including the VT-vertical-banding and atrium-void exceptions.
4. **Hour 4 (dashboard):** Import modal — JSON paste, Zod validate, preview diff, merge.
5. **The afternoon you walk the venue:** capture every anchor. Output one big JSON. Import.

After step 5, the manifest reflects the real venue. Everything else is curation in the dashboard.

---

## What this doesn't solve (yet)

- **Anchor visualization in-scene.** You can't see existing anchors as 3D ghosts while you walk. Add later if useful — same raycast infra, just inverted (read manifest, spawn placeholder boxes).
- **Per-anchor frame preview.** Capture mode doesn't render the actual frame yet, so you can't tell visually if the size you chose is right. Refine after capture in the dashboard, or build a "preview at this anchor" hotkey later.
- **Group operations.** "Capture all the F2 north wall positions at once with 4m spacing" would be nice. Skip for v1; manual marking is fine for the initial survey.
