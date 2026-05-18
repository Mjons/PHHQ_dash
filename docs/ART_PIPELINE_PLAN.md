# Art Hanging Pipeline

How art enters the scene, where it hangs, and how to rotate it without spelunking through twelve files. Frame primitives already exist at [frames.ts](src/scene/art/frames.ts) — this doc designs the layer above them.

## The problem we're solving

Art moves. A new resident drops in, an old piece retires, a hero wall gets re-curated for an event. Today there's no system: the frame primitives at [frames.ts](src/scene/art/frames.ts) are solid, but the only consumer is [frames-preview.ts](src/scene/art/frames-preview.ts), which hardcodes positions inline. If we keep adding art that way, every swap becomes a code change in whichever floor file owns that wall — and clipping/sizing bugs creep in because every author re-derives the math.

We want **one place** that answers: "what hangs in the scene, where, in what frame, at what size?" Then changing art is a one-line edit, not an archaeology dig.

---

## TL;DR — the four pieces

```
        ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
        │ 1. ASSETS    │───▶│ 2. REGISTRY  │───▶│ 3. ANCHORS   │───▶│ 4. RENDERER  │
        │ webp / png   │    │ pieces.ts    │    │ walls.ts     │    │ buildArt()   │
        │ in /assets   │    │ id, src,     │    │ id → pos,    │    │ pairs them   │
        │              │    │ artist, tags │    │ facing, max  │    │ and spawns   │
        └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

1. **Assets** — image files on disk (or a remote URL), with a strict naming/sizing convention.
2. **Piece registry** — a flat TS list of every available artwork (`id`, `src`, dimensions, frame preference, metadata). Decoupled from location.
3. **Anchor registry** — every wall hang-point in the scene as a named slot (`id`, position, facing, max size, allowed frame types, current `pieceId`).
4. **Renderer** — a single `buildArtwork()` call from [index.ts](src/index.ts) that walks anchors, looks up the piece, picks the frame, and spawns it.

Swapping a piece = changing one string. Adding a new wall = adding one anchor object. Curating a show = swapping `pieceId` values on several anchors.

---

## 1. Assets — naming and sizing

Lives under `assets/art/`. One subfolder per show or batch keeps git diffs sane:

```
assets/art/
├── core/              # always-on house pieces
│   ├── logo-hero.webp
│   └── manifesto.webp
├── residency-2026-q2/
│   ├── jane-doe-01.webp
│   ├── jane-doe-02.webp
│   └── ...
└── one-offs/
```

**File rules** (enforce in a `pieces.ts` comment header, not a script — overkill for now):

- **Format:** `.webp` (8× smaller than `.png` at equivalent visual quality for ink/halftone work). Reserve `.png` for art that legitimately needs alpha (frameless cutouts).
- **Power-of-two dimensions** when possible (1024×1024, 2048×1024). DCL doesn't require it but mipmap quality is better and the runtime doesn't have to rescale.
- **Hard cap 2048 on the long edge.** Anything bigger is wasted bandwidth — players never get close enough to see it.
- **Filename = piece id.** `jane-doe-01.webp` → registry id `jane-doe-01`. Removes one layer of indirection.
- **Point filtering** is the project default per [feedback_no_antialiasing.md](C:/Users/unrea/.claude/projects/c--Users-unrea-AppData-Roaming-creator-hub-Scenes-Panel-Haus-Party/memory/feedback_no_antialiasing.md). The frame functions already pass `TFM_POINT` at [frames.ts:60](src/scene/art/frames.ts#L60) — don't accept PRs that add bilinear-filtered art.

---

## 2. Piece registry — `src/scene/art/pieces.ts`

A flat list, one entry per piece, no nesting. Location lives elsewhere (anchors), so the same piece can hang in multiple spots without duplication.

```ts
// src/scene/art/pieces.ts
export type FrameKind = "A" | "B" | "C" | "D" | "E" | "F";

export interface Piece {
  id: string;
  src: string;
  aspect: number; // width / height; renderer uses this to fit the anchor
  preferredFrame: FrameKind;
  artist?: string;
  title?: string;
  link?: string; // portfolio / mint URL — surface in UI later
  tags?: string[]; // 'hero', 'comic', 'photo' — used by curation queries
}

export const PIECES: Record<string, Piece> = {
  "logo-hero": {
    id: "logo-hero",
    src: "assets/art/core/logo-hero.webp",
    aspect: 1,
    preferredFrame: "B",
    title: "Panel Haus",
    tags: ["hero", "core"],
  },
  "jane-doe-01": {
    id: "jane-doe-01",
    src: "assets/art/residency-2026-q2/jane-doe-01.webp",
    aspect: 1.5,
    preferredFrame: "A",
    artist: "Jane Doe",
    title: "Smoke Signal",
    link: "https://janedoe.art",
    tags: ["residency-2026-q2"],
  },
  // ...
};
```

**Why a `Record` not an array:** we look up by id all day from the anchor registry. O(1) beats `find()` for every wall.

**Why `aspect` instead of width+height:** the wall (anchor) decides physical size. The piece only knows its own proportions. This is the key decoupling — it lets a tall poster slot into a tall anchor or a small anchor without rewriting the piece entry.

---

## 3. Anchor registry — `src/scene/art/anchors.ts`

Every hang-point in the scene, named, with hard constraints. Grouped by area so curating "everything on F2" is a visual scan.

```ts
// src/scene/art/anchors.ts
import { Facing, FrameKind } from "./frames";

export interface Anchor {
  id: string; // e.g. 'f2-north-wall-01'
  area: "f1" | "f2" | "f3" | "f4" | "f5" | "vt" | "atrium" | "skywalk";
  centerPos: { x: number; y: number; z: number };
  maxWidth: number; // hard cap; renderer scales piece to fit
  maxHeight: number;
  facing: Facing;
  allowedFrames?: FrameKind[]; // e.g. ['A', 'B'] — VIP wall forbids frameless
  pieceId: string | null; // null = empty slot, intentionally
  note?: string; // for humans: 'over the bar', 'visible from spawn'
}

export const ANCHORS: Anchor[] = [
  // ── F2 gallery wall ──────────────────────────────────────
  {
    id: "f2-north-01",
    area: "f2",
    centerPos: { x: 32, y: 14, z: 4 },
    maxWidth: 3,
    maxHeight: 3,
    facing: "S",
    allowedFrames: ["A", "B"],
    pieceId: "logo-hero",
    note: "first piece visible from F2 stair-top",
  },
  {
    id: "f2-north-02",
    area: "f2",
    centerPos: { x: 36, y: 14, z: 4 },
    maxWidth: 3,
    maxHeight: 3,
    facing: "S",
    pieceId: "jane-doe-01",
  },
  // ...
];
```

**The constraints matter.** `maxWidth` / `maxHeight` mean a curator swapping in a piece can't accidentally make it clip through a doorway. `allowedFrames` lets you mark hero walls "gold only" and side walls "ink only" so the aesthetic stays coherent even when the art rotates.

**`pieceId: null` is a feature.** An empty anchor renders nothing — useful for "this wall is between shows" or seasonal walls. Better than commenting code out.

---

## 4. Renderer — `src/scene/art/build.ts`

One function. Iterates anchors, fits the piece to the anchor, calls the right frame.

```ts
// src/scene/art/build.ts
import { ANCHORS } from "./anchors";
import { PIECES } from "./pieces";
import { FRAMES } from "./frames";
import { Vector3 } from "@dcl/sdk/math";

export function buildArtwork(): void {
  for (const anchor of ANCHORS) {
    if (!anchor.pieceId) continue;
    const piece = PIECES[anchor.pieceId];
    if (!piece) {
      console.warn(
        `[art] anchor ${anchor.id} references missing piece ${anchor.pieceId}`,
      );
      continue;
    }

    const frameKind = chooseFrame(anchor, piece);
    const { width, height } = fit(
      piece.aspect,
      anchor.maxWidth,
      anchor.maxHeight,
    );

    FRAMES[frameKind]({
      centerPos: Vector3.create(
        anchor.centerPos.x,
        anchor.centerPos.y,
        anchor.centerPos.z,
      ),
      width,
      height,
      facing: anchor.facing,
      textureSrc: piece.src,
    });
  }
}

function chooseFrame(anchor: Anchor, piece: Piece): FrameKind {
  if (!anchor.allowedFrames) return piece.preferredFrame;
  return anchor.allowedFrames.includes(piece.preferredFrame)
    ? piece.preferredFrame
    : anchor.allowedFrames[0];
}

function fit(
  aspect: number,
  maxW: number,
  maxH: number,
): { width: number; height: number } {
  // Letterbox the piece into the anchor's bounding box.
  const anchorAspect = maxW / maxH;
  if (aspect > anchorAspect) {
    return { width: maxW, height: maxW / aspect };
  }
  return { width: maxH * aspect, height: maxH };
}
```

Then a single call in [index.ts](src/index.ts) — `buildArtwork()` — wires the whole system in. Adding it slots right next to existing scene builders.

---

## Authoring workflow — what "shifting art around" actually looks like

### Swap one piece on one wall

1. Drop new file into `assets/art/<batch>/`.
2. Add a `PIECES[...]` entry.
3. Change one `pieceId` on the relevant anchor.

Three lines touched, one rebuild, done.

### Rotate a whole show

The whole show is a batch of pieces sharing a `tag`. To rotate F2 to the next show:

```ts
// curate.ts — a one-off script run by hand, not shipped
import { ANCHORS } from "./anchors";
import { PIECES } from "./pieces";

const f2Anchors = ANCHORS.filter((a) => a.area === "f2");
const nextShow = Object.values(PIECES).filter((p) =>
  p.tags?.includes("residency-2026-q3"),
);

f2Anchors.forEach((a, i) => {
  a.pieceId = nextShow[i]?.id ?? null;
});
```

Or just hand-edit the anchors file. Either way the surface area is **one file**.

### Add a new hang-point on a wall

1. Eyeball the position in-scene.
2. Append an `Anchor` to `ANCHORS`.
3. Set `pieceId`.

You never touch the floor's `.ts` file (`f2.ts`, `f3.ts`, etc.) for art again. Those files own walls and lights; the art layer sits on top.

---

## Curation strategies (orthogonal — pick what you need)

### Static curation

What this doc describes. `anchors.ts` is the source of truth, edits go in git. **Right default.** Versioned, reviewable, predictable. Bad fit for: anything changing more than once a week.

### Show-based curation

Add a `currentShow: string` constant somewhere visible (top of `anchors.ts`). Pieces are tagged with the show they belong to. A pre-build step (or just `chooseFrame`-style logic in the renderer) pulls pieces matching the active show into anchors that opt in. Lets you flip the whole venue with one variable.

### Manifest-driven curation

Anchor data still in code, but `pieceId` resolution reads from a remote JSON manifest fetched at scene start. Lets non-coders curate via a Google Sheet → JSON pipeline. Mid-tier complexity, big payoff if you have a non-technical curator. Caveats: the manifest host needs CORS+HTTPS (same gotchas as the livestream doc); cache it, don't refetch per frame; ship a baked fallback into the build so the scene never spawns empty.

### Wallet-signed curation

A wallet-gated "curator" can call a Decentraland Comms message that broadcasts `{anchorId, pieceId}` swaps live. Every client mutates their local anchor map. Wild and fun for live events; overkill for normal operation. Don't trust the network — any client must be able to reject bogus piece ids and fall back to baked content.

### IPFS / on-chain pieces

`piece.src` can be an `ipfs://` URL or a Decentraland content-server hash. Same pipeline; you just gain permanence and lose hot-reload speed during development. Pin everything you care about — public IPFS gateways disappear.

**Recommendation:** ship static curation first. Add show-based when you have two distinct shows queued. Add manifest-driven the moment a non-coder wants to curate. Wallet-signed and IPFS are content decisions for later.

---

## Where the anchors live (rough plan, fill in with real coords later)

| Area                | Anchor count (guess) | Frame defaults | Notes                                                                             |
| ------------------- | -------------------- | -------------- | --------------------------------------------------------------------------------- |
| **Atrium**          | 1–2                  | C (lightbox)   | Glowing hero pieces visible from every floor. Pair with the livestream screen.    |
| **F1 entrance**     | 2–3                  | A (ink)        | First impression. Comics/storyboards setting tone.                                |
| **F2 main gallery** | 6–8                  | A, B mix       | The proper gallery wall. This is where rotation happens most.                     |
| **F3 balcony**      | 2–3                  | F (banners)    | Big banners hanging into the atrium void. Read from across the scene.             |
| **F4 stage area**   | 2                    | C (lightbox)   | Behind/beside the DJ. Emissive so they read with the lighting.                    |
| **F5 secret**       | 1                    | D (frameless)  | One odd surprise. Cutout art that breaks the grid.                                |
| **Vault Tower**     | 3–4                  | A, E (plinth)  | Plinth pieces in lobby, ink frames going up the shaft. Mix of standing + hanging. |
| **Skywalk**         | 2                    | F (banners)    | Long banners — readable while traversing.                                         |

**~20–25 anchors total** is a reasonable upper bound. Less than that feels sparse; more than that and the venue stops being a gallery and starts being a hoarder's house.

---

## Validation — fail loud, fail at scene-load

A `validateAnchors()` pass in `buildArtwork()` (dev-only, gated by a debug flag) catches the boring bugs before they become "why is the painting clipping through the wall in production":

- Anchor references a missing `pieceId` → console.warn (already in the sketch above).
- Anchor's `allowedFrames` is empty → error.
- Two anchors share an `id` → error.
- Anchor `maxWidth` or `maxHeight` ≤ 0 → error.
- Piece referenced by anchor but never used anywhere → info (not an error, often intentional during prep).

Don't build a heavy linter. Five `if` statements that log clearly are worth more than a 200-line validation library.

---

## What this doesn't solve (yet)

- **Interactivity.** Clicking a piece to see artist info is a separate system — it'd attach a `PointerEvents` and a UI panel to each spawned frame, reading from `piece.title` / `piece.link`. Easy to bolt on once the registry exists.
- **Lighting per piece.** Some pieces want a spotlight, some want ambient. Could live as an optional `lightHint: 'spot' | 'flood' | 'none'` on either anchor or piece. Defer until we feel the need.
- **Print-quality assets for AR / promo.** Out of scope. The 2048-edge cap is fine for in-scene; keep originals somewhere else.
- **Audio / video as "art".** [LIVESTREAM_PLAN.md](LIVESTREAM_PLAN.md) covers the video screen. If still images and video want to share walls one day, anchors could carry a `kind: 'image' | 'video'` discriminator — not worth it until that demand is real.

---

## What I'd build first

1. **Hour 1:** Create `pieces.ts`, `anchors.ts`, `build.ts` with two real pieces and two real anchors. Hook `buildArtwork()` into [index.ts](src/index.ts). Verify it spawns.
2. **Hour 2:** Migrate the [frames-preview.ts](src/scene/art/frames-preview.ts) lineup into proper anchors (one anchor per frame type) so the showcase still exists but uses the production path. Delete the inline preview.
3. **Hour 3:** Walk the scene, drop ~10 real anchors at the spots in the table above. Leave `pieceId: null` where art isn't ready — empty slots are fine and make the gallery shape visible without committing content.
4. **Later:** Validation pass. Show-tag rotation script. Manifest-driven mode if a curator asks.

Everything past hour 3 is a content decision, not an engineering one.
