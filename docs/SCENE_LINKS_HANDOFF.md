# Scene Contract — Clickable Piece Links (`Piece.link`)

**Status:** ready for scene team
**Date:** 2026-05-25
**Audience:** scene-repo maintainers
**Companion docs:** [ANCHOR_LINKS_PLAN.md](ANCHOR_LINKS_PLAN.md) (dashboard side) · [SCENE_PIECE_LINKS_EXPLORATION.md](SCENE_PIECE_LINKS_EXPLORATION.md) (design rationale & option comparison) · [VAULT_SCENE_HANDOFF.md](VAULT_SCENE_HANDOFF.md) (pointer + `openExternalUrl` precedent) · [SCENE_INTEGRATION.md](SCENE_INTEGRATION.md) (renderer contract you're extending)

You're picking up the scene side of "drop a marketplace URL on the dashboard → visitor clicks the piece in-scene → their browser opens that URL." The dashboard side already writes `Piece.link` from the AnchorCard. The scene side currently drops the field on the floor. This doc is how to close the loop.

---

## What changed on the dashboard

Nothing schema-shaped — `Piece.link: httpUrl.optional()` has existed in [`schema/manifest.ts`](../schema/manifest.ts) for a while, and the field has always been transmitted in the manifest. What changed:

1. **Curators can now set it from the AnchorCard** (in addition to the existing batch-upload form) — see [ANCHOR_LINKS_PLAN.md](ANCHOR_LINKS_PLAN.md). This means link coverage across placed pieces is about to climb from "a handful" to "most pieces with a marketplace listing."
2. **The expected user experience is now end-to-end clickable.** The PiecePicker shows a chain-link glyph on linkable pieces, the AnchorCard shows the link inline, and **the scene is the last hop:** visitor walks up, presses E on the frame, browser opens the marketplace.

So the data has been ready. This handoff turns it on.

---

## Repo paths

- **Scene repo (where you work):** `c:\Users\unrea\AppData\Roaming\creator-hub\Scenes\Panel Haus Party`
- **Dashboard repo (read-only reference):** `C:\Users\unrea\projects_claudecode\phhq_build`

See [SCENE_INTEGRATION.md](SCENE_INTEGRATION.md) for the broader scene contract — schema sync rules, manifest fetcher, baked fallback. This handoff layers on top of that document's Task 5 renderer (`buildArtwork`).

---

## The contract you must not break

1. **Pointer is additive.** Frames without `piece.link` MUST render exactly as they do today — no pointer attach, no hover hint, no behavioral change. The flag is `piece.link` presence.
2. **`openExternalUrl` only.** Same rule as the vault tipping pedestal ([VAULT_SCENE_HANDOFF.md](VAULT_SCENE_HANDOFF.md) §"Contract you must not break" #1 & #6) — the scene must NOT attempt in-scene wallet signing, MUST NOT collect URLs from the visitor, MUST only hand off via `openExternalUrl({ url: piece.link })`. The visitor's actual browser handles whatever the destination is.
3. **No URL mutation.** Pass `piece.link` to `openExternalUrl` verbatim. Don't append tracking params, don't normalize the host, don't try to "fix" `ipfs://` (it's already validated as `http(s)` by the zod `httpUrl` regex). What the curator pasted is what opens.
4. **Hover text reveals the destination host.** Visitors should know they're being sent off-platform before they press E. `hoverText: "View on " + hostname` is the contract. Don't show "Click for more" or any other host-hiding copy.
5. **Frame primitives stay untouched.** [SCENE_INTEGRATION.md](SCENE_INTEGRATION.md) §"What NOT to do" rule #1 still holds — do NOT edit `src/scene/art/frames.ts` in place. See "Open question" below for how to attach a pointer without modifying the frame primitives.
6. **Video pieces work the same as image pieces.** `piece.poster ?? piece.src` is the texture (per [SCENE_VIDEO_POSTER.md](SCENE_VIDEO_POSTER.md)); `piece.link` is the click destination. The two fields are independent. A vt4 SuperRare video with a poster and a `superrare.com/...` link must show the still on the wall AND open SuperRare on E-press.

---

## The open question (resolve first)

**Do `FRAMES[kind]({ … })` calls return their root entity?**

Read [`src/scene/art/frames.ts`](src/scene/art/frames.ts) and check the return type of `frameInk`, `frameGold`, `frameLightbox`, `frameFrameless`, `framePlinth`, `frameHangingBanner`.

- **If they return `Entity`:** great — attach the pointer to that entity directly. This is **Path A**, ~10 lines of code.
- **If they return `void`:** don't change the primitive's signature (the contract says don't touch). Instead, spawn an **invisible collider sibling entity** at the same `centerPos`, sized to `width × height`, and attach the pointer there. This is **Path B**, ~25 lines of code.

Both paths are valid. Path A is cleaner if the contract already allows it. If you find the primitives all return entities but it's undocumented, add a one-line JSDoc comment to the `FrameSpec` interface noting the return type — that's not a contract change, it's a contract clarification.

---

## Task 1 — Schema sync (likely no-op, 2 min)

`Piece.link` should already be in `src/scene/art/schema.ts` from the verbatim copy described in [SCENE_INTEGRATION.md](SCENE_INTEGRATION.md) §Task 1. Verify:

```bash
grep -n "link:" src/scene/art/schema.ts
```

You should see:

```ts
link: httpUrl.optional(),
```

If it's missing, the scene's schema copy is stale — re-copy from [`schema/manifest.ts`](../schema/manifest.ts) verbatim and bump the source-commit hash in the header per the SYNC convention.

---

## Task 2 — Add the link handler to `buildArtwork` (15-30 min)

You're editing the renderer at `src/scene/art/build.ts` — same file [SCENE_INTEGRATION.md](SCENE_INTEGRATION.md) §Task 5 walks you through. After the existing `FRAMES[kind]({ … })` call, branch on `piece.link`.

### Shared helpers

Add at the top of the file (or in a sibling util module if you have one):

```ts
import { openExternalUrl } from "~system/RestrictedActions";
import {
  PointerEvents,
  PointerEventType,
  InputAction,
  pointerEventsSystem,
  engine,
  Transform,
  MeshCollider,
} from "@dcl/sdk/ecs";

// Render-friendly host: "View on superrare.com", not "View on www.superrare.com/"
function prettyHost(url: string): string {
  // QuickJS-safe: no `new URL(...)` — DCL's runtime rejects digit-leading hosts
  // (same gotcha SCENE_INTEGRATION.md warns about for Vercel Blob URLs).
  // Cheap regex pull instead.
  const m = url.match(/^https?:\/\/(?:www\.)?([^\/?#]+)/i);
  return m ? m[1] : url;
}

// Reach scales with frame width so a 6m banner stays clickable from across
// the gallery and a 1m ink frame doesn't trigger from the next room over.
function clickReach(width: number): number {
  return Math.max(4, width * 1.2);
}
```

### Path A — primitives return Entity

Inside the `for (const anchor of manifest.anchors) { … }` loop, after the existing spawn call:

```ts
const entity = FRAMES[kind]({
  centerPos: Vector3.create(anchor.x, floorY + WALL_MID_HEIGHT, anchor.z),
  width,
  height,
  facing: anchor.facing,
  textureSrc: piece.poster ?? piece.src,
});

if (piece.link) {
  const link = piece.link; // capture for the closure
  PointerEvents.createOrReplace(entity, {
    pointerEvents: [
      {
        eventType: PointerEventType.PET_DOWN,
        eventInfo: {
          button: InputAction.IA_PRIMARY,
          hoverText: `View on ${prettyHost(link)}`,
          maxDistance: clickReach(width),
        },
      },
    ],
  });
  pointerEventsSystem.onPointerDown(
    {
      entity,
      opts: {
        button: InputAction.IA_PRIMARY,
        hoverText: `View on ${prettyHost(link)}`,
      },
    },
    () => {
      void openExternalUrl({ url: link });
    },
  );
}
```

### Path B — primitives return void (invisible collider)

Same as Path A, but with an extra entity for the pointer:

```ts
FRAMES[kind]({
  centerPos: Vector3.create(anchor.x, floorY + WALL_MID_HEIGHT, anchor.z),
  width,
  height,
  facing: anchor.facing,
  textureSrc: piece.poster ?? piece.src,
});

if (piece.link) {
  const link = piece.link;
  const clickEntity = engine.addEntity();
  Transform.create(clickEntity, {
    position: Vector3.create(anchor.x, floorY + WALL_MID_HEIGHT, anchor.z),
    // Rotate so the collider faces outward from the wall. Match the existing
    // facing→rotation table used by frames.ts (N=0, E=90, S=180, W=270).
    rotation: Quaternion.fromEulerDegrees(0, FACING_DEG[anchor.facing], 0),
    scale: Vector3.create(width, height, 0.1),
  });
  MeshCollider.setBox(clickEntity);
  PointerEvents.createOrReplace(clickEntity, {
    pointerEvents: [
      {
        eventType: PointerEventType.PET_DOWN,
        eventInfo: {
          button: InputAction.IA_PRIMARY,
          hoverText: `View on ${prettyHost(link)}`,
          maxDistance: clickReach(width),
        },
      },
    ],
  });
  pointerEventsSystem.onPointerDown(
    {
      entity: clickEntity,
      opts: {
        button: InputAction.IA_PRIMARY,
        hoverText: `View on ${prettyHost(link)}`,
      },
    },
    () => {
      void openExternalUrl({ url: link });
    },
  );
}
```

`FACING_DEG` is the same N/E/S/W → 0/90/180/270 table the frame primitives use internally. If it's not already exported, define it locally — don't reach into `frames.ts`.

### Counter for the boot log

Augment the existing `spawned`/`skipped` log line (per [SCENE_INTEGRATION.md](SCENE_INTEGRATION.md) §Task 5) with a `linked` count so you can verify coverage from the boot log:

```ts
console.log(
  `[art] spawned ${spawned} pieces, skipped ${skipped}, ${linked} linked`,
);
```

That's it. No new files, no new endpoints, no new components — one branch inside `buildArtwork`.

---

## Acceptance criteria

1. `npx tsc --noEmit` is clean.
2. `npm run start` boots the scene. Boot log shows `[art] spawned <N> pieces, skipped <M>, <K> linked` where `K` matches `manifest.pieces` entries with a non-empty `link`.
3. **Smoke test the happy path.** Set a real link on one of the vt4 pieces via the dashboard AnchorCard (or hand-edit the baked manifest — sample below). Rebuild. Walk to vt4. Hover the piece — hint reads `View on superrare.com` (or `objkt.com`, depending). Press E within ~5m. Your default browser opens to the marketplace page.
4. **Smoke test the no-link path.** Walk to any piece that has no `link` set. Confirm no hover hint appears and pressing E does nothing — exactly today's behavior.
5. **Smoke test the video path.** vt4 has video pieces with `poster` set (see [SCENE_VIDEO_POSTER.md](SCENE_VIDEO_POSTER.md)). Confirm the still still renders correctly AND the click still routes to the link. The two features must not interfere.

Sample for the baked smoke test (add `link` to the existing test piece from [SCENE_INTEGRATION.md](SCENE_INTEGRATION.md) §"Acceptance criteria"):

```json
{
  "pieces": {
    "test-piece": {
      "id": "test-piece",
      "src": "assets/logos/panelhaus-logo-primary.png",
      "aspect": 1,
      "preferredFrame": "A",
      "title": "Test",
      "link": "https://panelhaus.com/about"
    }
  }
}
```

Walk to F1 z=24.5 (per the existing smoke test) — hover should now read `View on panelhaus.com` and E-press should open the about page.

---

## What's NOT in scope

- **Visual indication that a piece is linkable** (small "↗" glyph in the frame corner, glow, etc.). Discoverability pass after we see how visitors actually behave. Track it as a follow-up if curators or playtesters report visitors walking past linkable pieces without trying to click.
- **Per-anchor link overrides.** [ANCHOR_LINKS_PLAN.md](ANCHOR_LINKS_PLAN.md) considered and rejected `anchor.link` for now. If that ever lands, this handler would change to `anchor.link ?? piece.link`. Until then: piece-level only.
- **Analytics / click counting.** No beacon fire before `openExternalUrl`. If/when we want this, it's a separate handoff (probably a `POST /api/events/link-click` endpoint on the dashboard and a small `signedFetch` before the open call).
- **In-scene browser embedding.** Not supported by SDK7. `openExternalUrl` is the only correct hand-off.
- **Books / tracks / vault pedestals.** Books have their own pedestal interaction; tracks have no spatial entity; vault pedestals already open `/tip/<floor>`. This handoff is exclusively about wall pieces spawned by `buildArtwork`.

---

## What NOT to do

- ❌ Don't modify `src/scene/art/frames.ts`. The contract says no, [SCENE_INTEGRATION.md](SCENE_INTEGRATION.md) says no, this doc says no.
- ❌ Don't `await openExternalUrl`. Fire-and-forget, same as the vault pedestal pattern.
- ❌ Don't use `new URL(piece.link).hostname` in the hover hint — DCL's QuickJS rejects digit-leading hostnames (same gotcha that put the regex on `httpUrl` in the dashboard schema). Use the `prettyHost` regex helper.
- ❌ Don't attach the pointer when `piece.link` is empty/missing. Pieces without a link must behave exactly as they do today — no hover artifact.
- ❌ Don't conflate `link` with `poster`. They're independent fields. A piece can have either, both, or neither.
- ❌ Don't push to git or run `dcl deploy`. The user does that.

---

## Versioning

Additive and optional, same posture as [SCENE_VIDEO_POSTER.md](SCENE_VIDEO_POSTER.md). Pre-existing manifests parse and render unchanged. Scene clients on the old build continue to render frames as static — no regression, no improvement. After this handoff lands, the same manifests start serving clickable frames wherever the dashboard has a link set.

The baked fallback at `src/scene/art/manifest.baked.json` will start picking up `link` values whenever the bake script next runs against the live manifest — no manual backfill needed.

---

## Files touched

Scene repo (after you implement):

- `src/scene/art/build.ts` — link-aware branch inside `buildArtwork` (the only real change)
- `src/scene/art/schema.ts` — verify-only; `Piece.link` should already be present from the verbatim copy

Dashboard repo (already done or in flight):

- [schema/manifest.ts](../schema/manifest.ts) — `Piece.link: httpUrl.optional()` (already shipped)
- [app/pieces/pieces-view.tsx](../app/pieces/pieces-view.tsx) — batch-upload link input (already shipped)
- [app/anchors-view.tsx](../app/anchors-view.tsx) — AnchorCard inline link editor (in flight per [ANCHOR_LINKS_PLAN.md](ANCHOR_LINKS_PLAN.md))
- [app/\_components/piece-picker.tsx](../app/_components/piece-picker.tsx) — chain-link glyph on linkable pieces (in flight per [ANCHOR_LINKS_PLAN.md](ANCHOR_LINKS_PLAN.md))

---

## Estimated total time

**Path A:** ~30 min (verify schema, add helpers, ~10 lines in `buildArtwork`, smoke test).
**Path B:** ~60 min (same, plus the collider sibling entity boilerplate and getting `FACING_DEG` right).

Once it's wired and the smoke tests pass, the round-trip is complete: curator pastes URL on AnchorCard → manifest writes → scene fetches → frame spawns → visitor hovers → visitor presses E → marketplace opens in their browser. No platform cut, no detour, no friction between the wall and the listing.
