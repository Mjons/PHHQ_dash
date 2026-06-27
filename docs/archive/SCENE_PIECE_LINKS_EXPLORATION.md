# In-Scene Clickable Links — Exploration

**Status:** exploration — recommendation accepted, scene work handed off in [SCENE_LINKS_HANDOFF.md](SCENE_LINKS_HANDOFF.md)
**Date:** 2026-05-25
**Author:** dashboard team
**Companion docs:** [ANCHOR_LINKS_PLAN.md](ANCHOR_LINKS_PLAN.md) (dashboard side) · [SCENE_LINKS_HANDOFF.md](SCENE_LINKS_HANDOFF.md) (scene side) · [SCENE_INTEGRATION.md](SCENE_INTEGRATION.md) (renderer contract) · [VAULT_SCENE_HANDOFF.md](VAULT_SCENE_HANDOFF.md) (pointer + `openExternalUrl` precedent)

---

## What the curator wants

> "When a visitor walks up to a piece on the wall, they should be able to click right on the artwork and land on the SuperRare / objkt / OpenSea page where it actually lives. Right now they walk past it, take a screenshot, and that's the end of the funnel."

In plainer terms: every wall piece placed via the dashboard should be a hyperlink. The render the visitor sees in-scene IS the link. No QR detour, no plaque hunting — point, press E, browser opens.

## Why we can do this now

The data side is _almost_ free:

1. **`Piece.link` already exists** in [schema/manifest.ts:55](../schema/manifest.ts#L55) as `httpUrl.optional()`. Validated, persisted, riding along on every manifest fetch the scene already makes.
2. **The dashboard is about to start writing it from a visible surface.** [ANCHOR_LINKS_PLAN.md](ANCHOR_LINKS_PLAN.md) adds the link row to the AnchorCard — once that ships, curators have a one-click path to attach a marketplace URL to any placed piece.
3. **The scene already has the pointer + external-URL pattern wired.** [VAULT_SCENE_HANDOFF.md](VAULT_SCENE_HANDOFF.md) §2d uses `PointerEvents` + `openExternalUrl` for the tipping pedestal. The piece-link case is the same shape — different entity, different URL, identical mechanism.

The data is in the manifest. The pointer pattern is in the scene. What's missing is **the renderer reading `piece.link` and attaching a pointer to the frame entity it just spawned.**

## Where the gap is today

Walking the path end-to-end:

| Step                                   | State                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Curator uploads piece with link        | Works (batch upload "More options" panel, [app/pieces/pieces-view.tsx:1201-1209](../app/pieces/pieces-view.tsx#L1201-L1209))                                       |
| Link persists in manifest              | Works (validated by `Piece` zod)                                                                                                                                   |
| Link surfaces on dashboard AnchorCard  | In flight, see [ANCHOR_LINKS_PLAN.md](ANCHOR_LINKS_PLAN.md)                                                                                                        |
| Scene fetches manifest with link field | Already works — `loadManifest()` doesn't filter fields                                                                                                             |
| Scene renderer consumes `piece.link`   | **Missing.** [SCENE_INTEGRATION.md](SCENE_INTEGRATION.md) §Task 5's `buildArtwork` only reads `piece.src` and `piece.aspect`; `piece.link` is dropped on the floor |
| Visitor clicks frame in-scene          | **Missing.** No pointer attached                                                                                                                                   |
| Browser opens marketplace page         | **Missing.** No `openExternalUrl` call                                                                                                                             |

So three lines of net new work in the scene's `buildArtwork`, plus a decision on the hover hint copy.

---

## Design options

### Option A — pointer directly on the frame entity (recommended)

After `FRAMES[kind]({ … })` spawns the frame, grab the entity it returns and attach `PointerEvents` + a system handler that fires `openExternalUrl({ url: piece.link })`.

```ts
// inside buildArtwork(), after spawning the frame for an anchor:
if (piece.link) {
  const entity = FRAMES[kind]({/* … */}); // assumes frames return entity
  PointerEvents.create(entity, {
    pointerEvents: [
      {
        eventType: PointerEventType.PET_DOWN,
        eventInfo: {
          button: InputAction.IA_PRIMARY,
          hoverText: `View on ${prettyHost(piece.link)}`,
          maxDistance: 6,
        },
      },
    ],
  });
  pointerEventsSystem.onPointerDown(
    {
      entity,
      opts: {/* same as above */},
    },
    () => {
      void openExternalUrl({ url: piece.link! });
    },
  );
}
```

**Pros:**

- One-to-one with the visitor's mental model: the thing they see IS the link
- No new geometry, no plaque clutter, no extra textures
- Reuses the exact pattern already shipping for vault pedestals
- Pieces without `link` simply skip the pointer attach — graceful degradation

**Cons:**

- Requires the frame primitives to return their root entity. Need to check [src/scene/art/frames.ts](src/scene/art/frames.ts) — `frameInk`, `frameGold`, etc. are currently typed as `void` returns. **This is the load-bearing question** (see "Open questions" below). If they don't return, either:
  - bump the contract to return the entity (touches the file `SCENE_INTEGRATION.md` says "**don't modify**" — coordinate with scene team), OR
  - spawn an invisible collider entity at the frame's `centerPos` and put the pointer there. Slightly more code, no frame-contract change.
- The 6m `maxDistance` is a guess. Need to playtest with the F2 main-gallery walls (they're spaced wider than VT floors) — visitors shouldn't have to walk _into_ a piece to click it.

### Option B — second QR on the artist plaque

Bake the link as a QR onto an existing or new plaque texture; visitor scans with their phone. Same shape as the tipping pedestal QR ([VAULT_SCENE_HANDOFF.md](VAULT_SCENE_HANDOFF.md) §2a).

**Pros:**

- Mobile-native: visitor scans, lands in their phone browser where their actual wallet lives
- No SDK7 pointer fiddling; QR is just a `Material.texture.src`
- Works for visitors on DCL clients without mouse pointer (e.g. mobile DCL app)

**Cons:**

- Needs a server endpoint to generate per-piece QRs (mirror of `/api/qr/<floor>`, but keyed by piece id or URL hash). Real work, not free
- Needs plaque geometry on every framed piece — today we don't render plaques on standard wall art, only on vault pedestals. That's a lot of new clutter on the F1-F5 walls
- QRs at wall-art viewing distance are awkward — visitor needs to walk close enough to scan, then back up to look at the art

### Option C — hover "View on [domain]" pill, no click handler

Display-only affordance: when the visitor looks at a piece with a `link`, show a small floating pill that names the destination (e.g. "↗ superrare.com"). Don't make it clickable — just signal that the piece is "linked" so curious visitors look it up themselves.

**Pros:**

- Lowest implementation surface — just `TextShape` + `VisibilityComponent`
- No external-URL legalese ("opens browser") — the visitor decides

**Cons:**

- Doesn't actually deliver the curator's goal. "Show them the URL" ≠ "let them click through"
- Easy to miss; floating text in 3D scenes blends into the venue
- We'd still want to add Option A later — so this is a half-step

### Option D — embed link in plaque text on placed pieces

If/when we add per-piece plaques (artist name + title strip below the frame), include the link as visible text. No interaction, just disclosure.

**Pros:**

- Cheap if plaques are coming anyway for unrelated reasons
- No new pointer code

**Cons:**

- Same "doesn't actually deliver the click" problem as Option C
- URLs are ugly. `https://objkt.com/asset/KT1UXZ.../67` does not belong in a gallery plaque
- Best as a _supplement_ to Option A, not a replacement

---

## Recommendation

**Ship Option A.** The dashboard side ([ANCHOR_LINKS_PLAN.md](ANCHOR_LINKS_PLAN.md)) and scene side (this doc) together close the loop the curator described — paste URL on AnchorCard, walk up to the piece in scene, press E, marketplace page opens.

If after playtest the pointer feels finicky (E-press in DCL has a learning curve for first-time visitors), layer Option D on top: a small visible "↗" glyph baked into the frame corner, plus an unobtrusive plaque domain hint. That's a polish pass, not a blocker.

Option B (QR) stays on the shelf for a later pass aimed at mobile-DCL visitors specifically.

---

## Open questions

1. **Do `FRAMES[kind]` primitives return an entity?** Need to read [src/scene/art/frames.ts](src/scene/art/frames.ts) (scene repo) and check the return type. If `void`, Option A needs the invisible-collider workaround or a frame-contract bump. This determines whether the work is ~10 lines or ~30.
2. **Hover text copy.** `"View on superrare.com"` is clear but verbose. `"↗ superrare.com"` is cleaner but uses a non-ASCII glyph DCL's text renderer may or may not handle gracefully. Confirm character support.
3. **`maxDistance` per frame size.** A 1m-wide ink frame and a 6m-wide banner have very different "click reach" expectations. May want to derive `maxDistance` from `width` (e.g. `Math.max(4, width * 1.2)`) rather than hardcoding.
4. **Pieces with no `link` set.** Confirmed graceful: just don't attach pointer. But should we visually distinguish them in-scene? Probably not for v1 — let absence be invisible. Re-evaluate if curators complain that "the link ones don't look any different so visitors don't know to click."
5. **Video pieces.** `piece.poster` is used as the texture when `src` is a video the scene can't decode ([SCENE_VIDEO_POSTER.md](SCENE_VIDEO_POSTER.md)). Pointer attaches to the frame entity regardless of texture choice — should just work, but smoke-test with one of the vt4 SuperRare videos.
6. **Analytics.** Do we want to count link clicks (drives the "did the venue actually drive traffic" question)? Could fire a beacon to a dashboard endpoint before `openExternalUrl`. Out of scope for v1; flag for future.

---

## Implementation sketch (when the time comes)

This is for the scene-repo agent; lives next to [SCENE_INTEGRATION.md](SCENE_INTEGRATION.md)'s Task 5 instructions.

1. **Confirm/extend the frame contract.** Read `frames.ts`. If primitives already return their root entity, you're good. If not, choose between:
   - Adding `: Entity` to the return type of all six primitives (coordinate with scene-team; small change but touches the "don't modify" file)
   - Spawning a sibling collider entity at `centerPos` sized to `width × height` with `MeshCollider.setBox` and attaching the pointer there. Invisible, no rendering cost
2. **In `buildArtwork`**, after the `FRAMES[kind]({ … })` call, branch on `piece.link`:
   - Skip if absent
   - Attach `PointerEvents` with `PET_DOWN`, `IA_PRIMARY`, `hoverText: "View on " + new URL(piece.link).hostname`
   - Register `pointerEventsSystem.onPointerDown` handler → `openExternalUrl({ url: piece.link })`
3. **Tiny helper:** `prettyHost(url)` strips `www.` and trailing `/` so the hover hint reads `"View on objkt.com"` not `"View on www.objkt.com/"`
4. **Don't `await` `openExternalUrl`** — same fire-and-forget pattern as the vault pedestal
5. **Smoke test:** add a `link` to one of the test pieces in `manifest.baked.json` (e.g. `"https://superrare.com/artwork-v2/test"`), rebuild, walk to it, press E, confirm browser opens

Estimated effort: **30-45 min** if the frames return entities, **60-90 min** if the collider workaround is needed.

---

## What this exploration is NOT

- Not a green-light to start coding — needs the dashboard-side AnchorCard ship ([ANCHOR_LINKS_PLAN.md](ANCHOR_LINKS_PLAN.md)) so there's real coverage of `piece.link` values across the venue before the scene change is worth user-testing
- Not a schema change. `piece.link` already exists. If we later want **per-anchor** link overrides (the rejected Option B from the dashboard plan), that becomes a separate exploration
- Not a replacement for the vault tipping pedestal flow. Tipping pedestals point at `/tip/<floor>` (Panel Haus dashboard); piece links point at external marketplaces. Different destinations, same `openExternalUrl` primitive

---

## Sequencing

1. ✅ Schema supports `link` (already done)
2. 🔄 Dashboard surfaces link on AnchorCard ([ANCHOR_LINKS_PLAN.md](ANCHOR_LINKS_PLAN.md))
3. ⏳ Curators backfill links on placed pieces (one-time pass, plus ongoing as new pieces land)
4. ⏳ Scene renderer reads `piece.link`, attaches pointer (this doc, when sequenced)
5. ⏳ Playtest with real visitors at next event
6. ⏳ Decide on Option D polish pass based on observed click-through behavior

The dashboard work in step 2 unblocks itself. Step 4 is blocked only by "have we got enough coverage to make it worth shipping" — premature to land if `piece.link` is set on 2 out of 80 pieces.
