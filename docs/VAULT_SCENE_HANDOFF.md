# Vault Tipping — Scene-Side Integration Handoff

**Status:** ready for scene team (MVP scope)
**Date:** 2026-05-23
**Author:** dashboard team

You're a fresh agent on the **scene** repo, picking up the Vault Tower tipping pedestals. The dashboard already ships per-VT-floor artist residency config in the manifest and serves a mobile-friendly tip page at `/tip/<floor>`. The scene currently ignores all of it. This doc is everything you need to make the pedestals appear in the venue and route visitors into the tip flow.

The companion design doc is [`VAULT_TIPPING_PLAN.md`](VAULT_TIPPING_PLAN.md) — read it for the why; this doc is the how.

---

## Repo paths

- **Scene repo (where you work):** `c:\Users\unrea\AppData\Roaming\creator-hub\Scenes\Panel Haus Party`
- **Dashboard repo (read-only reference):** `C:\Users\unrea\projects_claudecode\phhq_build`

See sibling doc [`SCENE_INTEGRATION.md`](SCENE_INTEGRATION.md) for the broader scene contract — schema sync rules, manifest fetcher, baked fallback. This doc adds the Vault tipping layer on top.

---

## What already exists on the dashboard side

1. **`VaultResidency` schema** in [`schema/manifest.ts`](../schema/manifest.ts) — `artistWallet` (0x address), `artistName?`, `artistMessage` (≤280 chars), `artistLinks?` (twitter/lens/farcaster/opensea/site), `pedestalPos?` (`{x,z}`), `activeUntil?` (ISO).
2. **`Manifest.vaultResidencies`** — `Record<string, VaultResidency>` keyed by VT floor (`vt2 | vt3 | vt4 | vt5 | vt6`). Absent floor = no residency, no pedestal.
3. **`VTFloor` enum** + **`VAULT_FLOORS`** array + **`VAULT_FLOOR_LABEL`** map.
4. **Curator UI at `/vault`** — five floor cards, address validation, plaque message editor, residency end-date, optional artist links. Same save flow as everything else (`POST /api/manifest`).
5. **Public mobile tip page** — `GET https://phhq-dash-rkwi.vercel.app/tip/<floor>`. Renders the artist plaque, EIP-681 wallet deep-link buttons for $5/$10/$25/$50, and a copyable address fallback. Handles unconfigured / expired residencies with a polite empty state.
6. **QR endpoint** — `GET https://phhq-dash-rkwi.vercel.app/api/qr/<floor>.png` — 512×512 PNG encoding the tip URL for that floor. Cached forever, served with `access-control-allow-origin: *`, safe to use directly as an `Material.texture.src`.
7. **Public tip-state endpoint** — `GET https://phhq-dash-rkwi.vercel.app/api/tips` — returns `{ tips: Record<VTFloor, {totalUsd, tipCount, lastTipAt, frameOverride, recent[]}> }`. **Currently always returns `{ tips: {} }`** because tip detection is deferred (see §"What's NOT in MVP").

The dashboard's contract: **whatever the curator configures on the Vault tab, the scene renders as a tip pedestal on that floor.** Funds flow wallet-to-wallet on Polygon; the dashboard observes nothing in MVP.

---

## The contract you must not break

1. **Non-custodial, always.** The scene MUST NOT collect or display wallet seed phrases, ask the visitor to sign anything from inside the scene, or imply that Panel Haus holds the funds. The only role of the scene is to display the pedestal and **open the dashboard tip URL externally**. Signing is the visitor's wallet's job, off-scene.
2. **`pedestalPos` is the source of truth for placement.** When present, render at exactly those `x/z` coordinates (with `y = FLOOR_Y[floor] + pedestal-half-height`). When absent, **don't render anything** — the curator hasn't placed it yet. Don't fall back to a default position.
3. **`activeUntil` past → no pedestal.** If `activeUntil` is set and its parsed date is before `Date.now()`, treat the residency as ended. Don't render. The tip page on the dashboard already shows the "residency ended" message for visitors who follow stale QRs.
4. **The QR texture URL is stable.** Once you know the floor, the QR PNG URL is `https://phhq-dash-rkwi.vercel.app/api/qr/<floor>.png` forever. Cache it. Don't re-fetch on every render pass.
5. **The tip URL is stable.** `https://phhq-dash-rkwi.vercel.app/tip/<floor>`. Hardcode the base URL alongside the manifest URL — don't try to derive it from the manifest.
6. **No wallet UI in-scene.** SDK7 sandboxing means in-scene code cannot call `eth_sendTransaction`. Don't try. The only correct flow is `openExternalUrl(tipUrl)` to hand off to the visitor's actual browser + wallet.
7. **Baked fallback defaults to empty `vaultResidencies`.** If manifest fetch fails, no pedestals spawn. The scene never renders a pedestal pointing at a stale address.

---

## Task 1 — Re-copy the schema (5 min)

Source: `C:\Users\unrea\projects_claudecode\phhq_build\schema\manifest.ts`
Destination: `src/scene/art/schema.ts`

Same file you already copied for art and music. Re-copy verbatim, bump the source-commit hash in the header comment. The new exports you need:

```ts
(VaultResidency, VTFloor);
(VaultResidencyT, VTFloorT);
(VAULT_FLOORS, VAULT_FLOOR_LABEL);
```

These sit alongside the existing `Piece`, `Anchor`, `Track`, `NowPlaying`, `Manifest` exports.

Verify: `npx tsc --noEmit` should be clean and `Manifest.parse(...)` should now accept manifests with a `vaultResidencies` field. Old baked manifests still parse — the field has a `.default({})`.

---

## Task 2 — Build the pedestal renderer (45 min)

Create `src/scene/art/vault-tips.ts`.

### 2a. Pick the right primitives

Decentraland SDK7 components you'll use:

- **`Material` + `Texture.src`** — for the QR code on the pedestal face. URL-sourced PNG, served with CORS, cached forever.
- **Existing `framePlinth`** at [`src/scene/art/frames.ts`](src/scene/art/frames.ts) — perfect shape for the pedestal column.
- **Existing `frameHangingBanner`** — perfect shape for the artist message plaque above the pedestal. You'll generate the banner texture client-side as a baked image or use `TextShape` directly on a flat plane; pick whichever is easier in your scene's existing patterns.
- **`PointerEvents` + `PointerEventsSystem.onPointerDown`** — to detect E-press on the pedestal and open the tip page.
- **`openExternalUrl`** from `~system/RestrictedActions` — to launch the visitor's browser at the tip URL.

### 2b. Skeleton

```ts
import {
  engine,
  Transform,
  Material,
  MeshRenderer,
  PointerEvents,
  InputAction,
  PointerEventType,
} from "@dcl/sdk/ecs";
import { Vector3, Quaternion } from "@dcl/sdk/math";
import { openExternalUrl } from "~system/RestrictedActions";
import { framePlinth, frameHangingBanner } from "./frames";
import { FLOOR_Y } from "./floor-y";
import {
  VAULT_FLOORS,
  type ManifestT,
  type VaultResidencyT,
  type VTFloorT,
} from "./schema";

const DASHBOARD_BASE = "https://phhq-dash-rkwi.vercel.app";
const PEDESTAL_HEIGHT = 1.5; // meters, matches framePlinth default

function tipUrl(floor: VTFloorT): string {
  return `${DASHBOARD_BASE}/tip/${floor}`;
}

function qrTextureUrl(floor: VTFloorT): string {
  return `${DASHBOARD_BASE}/api/qr/${floor}.png`;
}

function isActive(r: VaultResidencyT): boolean {
  if (!r.activeUntil) return true;
  const t = Date.parse(r.activeUntil);
  return Number.isFinite(t) ? t > Date.now() : true;
}

export function buildVaultTipping(manifest: ManifestT): void {
  let spawned = 0;
  for (const floor of VAULT_FLOORS) {
    const r = manifest.vaultResidencies[floor];
    if (!r) continue;
    if (!r.pedestalPos) continue; // curator hasn't placed it yet
    if (!isActive(r)) continue; // residency ended

    spawnPedestal(floor, r);
    spawned++;
  }
  console.log(`[vault] spawned ${spawned} tipping pedestals`);
}

function spawnPedestal(floor: VTFloorT, r: VaultResidencyT): void {
  const floorY = FLOOR_Y[floor];
  if (floorY === undefined) {
    console.log(`[vault] unknown floor ${floor}, skipping pedestal`);
    return;
  }
  const { x, z } = r.pedestalPos!;
  const baseY = floorY + PEDESTAL_HEIGHT / 2;

  // 1. The plinth column with the QR code as its texture
  framePlinth({
    centerPos: Vector3.create(x, baseY, z),
    width: 1,
    height: PEDESTAL_HEIGHT,
    facing: "N", // QR faces north by default; rotate if needed
    textureSrc: qrTextureUrl(floor), // CORS-safe, cached forever
  });

  // 2. The plaque above the pedestal — banner shape, rendered text or
  //    pre-baked banner image. Pick whichever fits your existing patterns.
  //    A TextShape on a thin plane is the simplest; you'll need to manage
  //    line wrap for the 280-char message yourself.
  spawnPlaqueAbove({
    x,
    y: floorY + PEDESTAL_HEIGHT + 0.8,
    z,
    artistName: r.artistName,
    message: r.artistMessage,
  });

  // 3. Pointer interaction → open external tip URL
  const interactionEntity = engine.addEntity();
  Transform.create(interactionEntity, {
    position: Vector3.create(x, baseY, z),
  });
  // ... attach a clickable mesh or PointerEvents to the existing plinth
  // entity if framePlinth returns one. Pattern depends on how your other
  // interactive primitives (like the helicopter) wire pointer events.
  PointerEvents.create(interactionEntity, {
    pointerEvents: [
      {
        eventType: PointerEventType.PET_DOWN,
        eventInfo: {
          button: InputAction.IA_PRIMARY,
          hoverText: `Tip ${r.artistName ?? "artist"} (opens browser)`,
          maxDistance: 4,
        },
      },
    ],
  });
}
```

### 2c. The plaque

For the plaque above the pedestal: simplest is a `TextShape` on a thin flat plane (`MeshRenderer.setPlane`) sized roughly `2.5m × 1.0m`, positioned 0.8m above the pedestal top. Materials match the venue's ink-on-cream palette: cream background (`#f4ecd8`), ink text (`#0a0a0a`).

The artist message can be up to 280 chars — handle line wrap (rough heuristic: ~30 chars per line, ~4 lines max). If you want a fancier baked-image plaque, the dashboard can generate one server-side later; for MVP, in-scene text is fine.

Include the `artistName` (or shortened address if absent) above the message in a slightly larger font.

### 2d. Pointer → open tip URL

When the visitor presses E within 4m of the pedestal, call:

```ts
await openExternalUrl({ url: tipUrl(floor) });
```

This is the **entire wallet integration**. The visitor's browser opens the tip page in a new tab; they tap a `$5` deep-link button there; their phone wallet handles the rest. Nothing else happens in the scene.

Show a small toast / hint after the call ("Opened tip page in browser") to confirm the action fired — `openExternalUrl` doesn't always give visual feedback on every DCL client.

---

## Task 3 — Wire into `src/index.ts` (2 min)

Same shape as the existing `buildArtwork` hook described in [`SCENE_INTEGRATION.md`](SCENE_INTEGRATION.md):

```ts
// at the top, with the other imports:
import { buildVaultTipping } from "./scene/art/vault-tips";

// at the end of main(), after buildArtwork has been called:
export function main() {
  // ... all the existing build* calls ...
  buildPavilionHelicopter();

  void loadManifest().then((m) => {
    buildArtwork(m);
    buildVaultTipping(m); // ← NEW
  });
}
```

Both renderers walk the same manifest. They can't conflict because:

- `buildArtwork` walks `manifest.anchors` and spawns wall pieces
- `buildVaultTipping` walks `manifest.vaultResidencies` and spawns floor-standing pedestals

The only risk is two pedestals overlapping (a `vaultResidencies[vt3].pedestalPos` happening to coincide with a `framePlinth`-style anchor). That's a dashboard-side concern to flag; for now, trust the curator's placement.

---

## Task 4 — Bake-time considerations (5 min)

The bake script (`scripts/bake-manifest.js` or `prebuild` curl) already snapshots the full manifest. No change needed — `vaultResidencies` rides along automatically.

The baked fallback's empty state is `vaultResidencies: {}` — no pedestals spawn, which is the right behavior when the manifest fetch fails.

---

## Acceptance criteria

After all 4 tasks:

1. `npx tsc --noEmit` is clean.
2. `npm run start` boots the scene. Console shows `[vault] spawned <N> tipping pedestals` where N matches the number of VT floors with both a residency AND a `pedestalPos`.
3. **Smoke test the renderer:** hand-edit `manifest.baked.json` to include a residency on VT3 (sample below). Rebuild, walk to VT3, see the pedestal with QR + plaque appear. Press E within 4m → your default browser opens to the tip page.
4. **Smoke test the empty path:** clear the VT3 residency, rebuild — pedestal disappears, no console errors.
5. **Smoke test the expired path:** set `activeUntil: "2020-01-01T00:00:00.000Z"`, rebuild — pedestal disappears.

Sample residency for the baked smoke test:

```json
{
  "vaultResidencies": {
    "vt3": {
      "artistWallet": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      "artistName": "Test Artist",
      "artistMessage": "Sketches from a test residency. Tips go straight to the wallet above — no platform fee.",
      "pedestalPos": { "x": 30, "z": 18 },
      "activeUntil": "2027-01-01T00:00:00.000Z"
    }
  }
}
```

Coordinate (30, 18) is a rough VT3 center; adjust based on your actual VT floor geometry to land it somewhere walkable.

---

## What's NOT in MVP

Deliberately deferred to v1.5:

- **Gold-frame override.** The dashboard ships `/api/tips` which returns per-floor `frameOverride` state, but nothing populates it because we haven't wired tip detection (Alchemy webhook / Polygon polling). For MVP, the scene **doesn't need to read `/api/tips` at all** — just render pedestals from `manifest.vaultResidencies`. When tip detection lands later, the scene gets a small `chooseFrame` extension that consults `/api/tips[anchor.area].frameOverride` and forces `B` (Gold) for VT-floor anchors when active.
- **Tip counters on the pedestal** (`$X raised · N tips · last 2m ago`). Same dependency — needs tip detection populated. The pedestal-side render code can be added in the same patch as the gold-frame override later.
- **Pedestal placement UX in Map view.** Currently the curator sets `pedestalPos` by hand-editing the manifest or by calling `POST /api/manifest` directly. The dashboard's Vault tab shows "preview tip page" and "view pedestal QR" links per residency, but adding "click on the floor map to place" is a separate dashboard task; the scene contract doesn't change.
- **In-scene wallet signing.** Not coming. SDK7 doesn't support arbitrary `eth_sendTransaction`. The tip URL handoff is the architecturally correct flow forever.

---

## What NOT to do

- ❌ Don't try to sign transactions inside the scene. SDK7 sandbox doesn't expose `window.ethereum`. The tip page on the dashboard is where signing happens.
- ❌ Don't fetch `/api/tips` for MVP. The endpoint exists and is safe to call, but it always returns empty in MVP — wiring it in costs you a fetch with no reward. Add when tip detection ships.
- ❌ Don't render a pedestal at a default position when `pedestalPos` is absent. Curators set position deliberately; absence means "not placed yet."
- ❌ Don't keep stale pedestals after a residency ends. Re-check `activeUntil` on every render pass.
- ❌ Don't bake the artist wallet address into a permanent texture or NPC line — the curator can rotate residencies; everything must be derived from the live manifest.
- ❌ Don't push to git or run `dcl deploy`. The user does that.

---

## Estimated total time

About **60 minutes** for an unfamiliar agent, 30 for someone who knows the scene patterns. Code surface is small (~120 lines across 1 new file + 2-line edit to `src/index.ts`).

Once it's wired and the smoke test passes, the round-trip is complete: curator fills out Vault tab → scene renders pedestal + plaque → visitor presses E → browser opens tip page → wallet sends USDC → artist gets paid. No platform cut, no infrastructure between funds and artist.

---

## Reference

All in `C:\Users\unrea\projects_claudecode\phhq_build\docs\`:

1. **[VAULT_TIPPING_PLAN.md](VAULT_TIPPING_PLAN.md)** — the design doc. Why per-floor not per-piece, why non-custodial, what's deferred to v1.5 and why.
2. **[SCENE_INTEGRATION.md](SCENE_INTEGRATION.md)** — the broader scene contract: schema sync, manifest fetcher, baked fallback. Read this first if you haven't.
3. **[MUSIC_SCENE_HANDOFF.md](MUSIC_SCENE_HANDOFF.md)** — sibling handoff for the music feature. Same shape as this doc; useful pattern reference.
4. **[FRAMES_AND_ASPECTS.md](FRAMES_AND_ASPECTS.md)** — frame primitives reference. The `E · Plinth` is what we wrap for the pedestal column.

In the scene repo:

- [`src/scene/art/frames.ts`](src/scene/art/frames.ts) — frame primitives (`framePlinth`, `frameHangingBanner`). **Read this.** Don't modify it.
- [`src/scene/art/floor-y.ts`](src/scene/art/floor-y.ts) — per-area Y baselines. Your pedestal needs `FLOOR_Y[floor]`.
- [`src/scene/art/build.ts`](src/scene/art/build.ts) — existing renderer for wall art. Your pedestal renderer follows the same shape but walks `vaultResidencies` instead of `anchors`.
- [`src/index.ts`](src/index.ts) — where `main()` lives and where you hook in.
