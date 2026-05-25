# Curator Guide — From Capture JSON to Live Art

You've been handed a `.json` file from the scene team. It's the output of the in-scene anchor-capture tool: someone walked the venue, marked every wall position where art should hang, and exported the result. Your job is to take that JSON, import it into this dashboard, upload your images, assign them to the captured anchors, and watch them appear on the walls of the Decentraland scene — no code, no manual JSON editing.

This is the end-to-end loop. Plan on 15–30 minutes for a typical batch.

---

## What you need before you start

- The dashboard URL (production): **https://phhq-dash-rkwi.vercel.app**
- Your **curator password** (provided separately — `CURATOR_PASSWORD`)
- The capture `.json` file from the scene team (looks like `2026-05-18_capture-01.json`)
- The piece images you want to hang (PNG, JPG, WEBP, or GIF, ≤ 8MB each)

---

## Step 1 — Sign in (10 seconds)

1. Open the dashboard URL.
2. You'll land on `/login`. Paste the curator password and press enter.
3. You'll be redirected to the **Anchors** page. The first time, it's mostly empty.

There's a top bar with four tabs you'll use: **Anchors · Map · Pieces · Import**.

---

## Step 2 — Import the capture JSON (1 minute)

This creates anchor "slots" on each wall — placeholders that don't have art assigned yet.

1. Click the **Import** tab.
2. Open your `.json` file in any text editor, **select all, copy**.
3. Paste it into the large textarea on the Import page.
4. Click **Preview**. You should see a green confirmation like `Valid · 12 anchors ready to import`. If you see a red error instead, the JSON is malformed — check with the scene team before continuing.
5. Click **Import anchors**. You'll see `✓ Imported · added N, updated 0, total N · manifest v1`.

What just happened:

- Each anchor in the file is now a hang-point in the manifest.
- New IDs were added; if any IDs already existed, only their **position/area/facing/size** was updated — your previously-assigned pieces and notes are preserved.
- The manifest version bumped. The scene will pick up the change on next load.

Click **Anchors** in the top nav. You should now see cards grouped by floor (F1 — Entrance, F2 — Main Gallery, etc.) with an "EMPTY" placeholder in each thumbnail box. The next step fills them.

---

## Step 3 — Upload the piece images (2 minutes per piece)

Each piece is one image plus a few fields of metadata.

1. Click the **Pieces** tab.
2. On the right side you'll see a big dashed **drop zone** labeled "Drop image here". You can either:
   - **Drag** an image file from your file manager onto the zone, or
   - **Click** the zone to open a native file picker.
3. After the file lands, a preview appears with the filename, file size, and computed aspect ratio.
4. Fill in the form:
   - **Slug** — auto-filled from the filename (e.g. `Jane_Doe-01.png` → `jane-doe-01`). This becomes the piece's permanent ID. Use lowercase letters, numbers, and dashes. Edit if you want something cleaner.
   - **Title** — display name (e.g. "Smoke Signal"). Optional, but recommended.
   - **Artist** — display name (e.g. "Jane Doe"). Optional.
   - **Preferred frame** — pick one of six (see "Frame styles" below). Most pieces want **A · Ink** (the default).
   - **More options** (collapsed by default — click to expand): batch / show name for grouping, external link, tags.
5. Click **Upload**. The button is disabled until you have both a file and a slug. Hover for a hint about what's missing.
6. The image uploads to Vercel Blob storage, gets a permanent URL, and is added to the manifest. Toast: `✓ Uploaded "jane-doe-01" · v2`.

Repeat for every piece. They'll appear in a grid on the left, grouped by batch.

### Frame styles — when to use which

| Letter | Name           | When                                                                                                                |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| **A**  | Ink            | Default. ~95% of pieces. Plain 8cm black border.                                                                    |
| **B**  | Gold           | Hero pieces. Ornate gold frame with a glow. Use sparingly (≤ a few per show).                                       |
| **C**  | Lightbox       | Emissive cream halo around the piece. Use on F4 stage walls or atrium hero spots.                                   |
| **D**  | Frameless      | No border — alpha-keyed cutout floating on the wall. **Image must have a transparent background** (PNG with alpha). |
| **E**  | Plinth         | Freestanding column with double-sided art on top. Anchor must be in open floor space, not against a wall.           |
| **F**  | Hanging Banner | Top-bracketed, dangles. Needs vertical headroom above the anchor.                                                   |

The full guide is in [`FRAMES_AND_ASPECTS.md`](FRAMES_AND_ASPECTS.md).

---

## Step 4 — Assign pieces to anchors (the actual curation)

You have two interfaces. Use whichever feels right.

### Option A — Anchors list (`/`)

The fastest way to bulk-assign. Each anchor card has a dropdown showing every available piece. Pick one — it auto-saves. The thumbnail updates to show the assigned piece. Manifest version bumps each time. Toast confirms.

Use this view when you have a clear plan ("these five pieces go on F2 north wall, in this order"). Fast clicks, quick visual scan.

### Option B — Map (`/map`)

A top-down floor plan of the venue. Use this when you don't know which wall is which from the IDs alone — you can see spatially where each anchor sits and what's already on neighboring walls.

1. Click a floor button along the top (Atrium, F1, F2, … VT2–VT6, Skywalk).
2. Anchors on that floor appear as dots: **gold = filled (has piece)**, **cream = empty**.
3. Click any dot. The right sidebar shows the **anchor inspector**:
   - **Preview thumbnail** — the assigned piece's image, letterboxed into the anchor's aspect ratio (so you see exactly how it'll appear in-scene)
   - **Aspect quick-picks** — six preset shapes (1:1, 2:3, 3:2, 16:9, 4:1 ↔, 1:4 ↕). Click one to change the anchor's bounding box.
   - **Allowed frames** — six checkboxes. By default only the frame chosen at capture is allowed; tick more to give the renderer flexibility (e.g. `[A, B]` means "accept either Ink or Gold pieces").
   - **Piece dropdown** — pick the assigned piece. Auto-saves.
   - **Delete anchor** — removes this hang-point entirely.
4. To **add a new anchor by hand** (instead of importing), click **+ Add anchor** in the top right. The cursor becomes a crosshair, a coral ghost dot follows the mouse. Click anywhere on the floor to drop a draft. Fill in ID/facing/aspect/frame/note/piece and click **Save anchor**. Press **ESC** to cancel.

---

## Step 5 — Watch the scene pick it up

There's nothing to deploy. The Decentraland scene fetches `/api/manifest` from this dashboard on every load.

- If a visitor is **already** in the scene when you save: their session keeps the old manifest until they re-enter.
- A **fresh visitor** sees the new state.
- For belt-and-suspenders before public events: the scene team also ships a baked fallback (`manifest.baked.json`) inside the scene bundle, snapshotted via a `prebuild` script. If the dashboard is unreachable for any reason, the scene still spawns the last-known state — never empty.

To verify a change took effect, open `https://phhq-dash-rkwi.vercel.app/api/manifest` in a browser tab. The JSON returned is exactly what the scene sees. Confirm your piece appears in `pieces` and is referenced from the right anchor's `pieceId`.

---

## Common operations

**Swap a piece on a wall.** Go to Anchors or Map → pick a different piece from the anchor's dropdown. Old piece is unassigned, new piece appears. The image file isn't deleted — you can re-assign it later.

**Retire a piece.** Pieces tab → find the card → **Delete**. Warning shows how many anchors are currently using it; those anchors are auto-unassigned. The underlying file stays in Vercel Blob (you can clean up via the Storage tab in Vercel if you want — not strictly necessary).

**Move an anchor.** Currently the easiest path: delete the existing anchor (in Map), then re-capture in-scene at the new position and re-import. The dashboard doesn't expose anchor-position drag-editing yet — capture is the source of truth for positions.

**Edit aspect or allowed frames on an anchor.** Map → click anchor → use the quick-pick buttons. The change saves instantly. Re-importing the same anchor ID later won't clobber these — the import only updates position/area/facing/size, never `pieceId` / `allowedFrames` / `note`.

**Re-survey the venue.** When the architecture changes (a wall moves, a new floor opens), the scene team walks the affected area with the capture tool and sends you an updated `.json`. Re-importing is a structural merge: new IDs add, existing IDs update positions, and all your curatorial work (piece assignments, notes, broadened frames) is preserved.

**Check the manifest version.** It's shown in the page header (e.g. `v9`). Every save increments it. The scene logs `[art] manifest v<N> loaded` on load, so you can confirm which version is live.

---

## Troubleshooting

**"I uploaded a piece but it shows as a white box in-scene."**  
Almost always the **D · Frameless** frame on a piece that doesn't have a transparent background. Frameless renders the image as a flat plane with no border — opaque backgrounds become visible. Either re-upload as a transparent PNG, or switch the anchor's frame to A (Ink) or another bordered style.

**"My piece appears in the dashboard thumbnail but not in-scene."**  
The scene caches per-session. Reload Decentraland. If still missing, check the manifest at `/api/manifest` — does the piece have a valid `src` URL? Visit the URL directly; it should load the image.

**"The anchor is in the wrong floor / wrong height."**  
The anchor's `area` field determines floor (and therefore Y-height). If the scene team's capture tool inferred the wrong area, you can correct it in the dashboard, but currently the only way to change `area` is to delete and re-capture — or hand-edit the manifest via raw API call (ask the dev team). Most cases are right.

**"I imported and now I have duplicate anchors."**  
The import endpoint merges by **anchor ID**, not by position. If the same wall got captured twice with different IDs, you'll have two anchors at near-identical coords. Delete the one you don't want from the Map view.

---

## Reference

- **Frame and aspect details:** [`FRAMES_AND_ASPECTS.md`](FRAMES_AND_ASPECTS.md)
- **Capture tool / how the JSON gets made:** [`ANCHOR_CAPTURE_PLAN.md`](ANCHOR_CAPTURE_PLAN.md)
- **Scene ↔ dashboard contract (for devs):** [`DASHBOARD_HANDOFF.md`](DASHBOARD_HANDOFF.md)
- **How the scene renders the manifest (for devs):** [`SCENE_INTEGRATION.md`](SCENE_INTEGRATION.md)
- **Schema (the JSON shape, source of truth):** [`../schema/manifest.ts`](../schema/manifest.ts)
- **Sample capture JSON to compare against:** [`../captures/2026-05-18_capture-01.json`](../captures/2026-05-18_capture-01.json)
