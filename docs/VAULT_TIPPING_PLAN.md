# Vault Tower Tipping — Per-Floor Artist Tips with Gold-Frame Reward

**Status:** v1 scope locked (2026-05-23)
**Date:** 2026-05-23
**Author:** dashboard team

## What the curator wants

> "Yes lets add this on each floor of the vault tower. It should exist on our dashboard so we can input the artist's address to be tipped to for the floor and a custom msg from them we put for them."

In plain English: each Vault Tower floor (VT2–VT6) gets a tipping pedestal. The curator configures, **per floor**, the artist's wallet address and a short artist message. Visitors who land on that floor see the pedestal, scan a QR with their phone, and tip USDC straight to the artist on Polygon — no custody, no fees, no platform cut. As tips come in, every piece on that floor's frame upgrades to **Gold** for 24h, so visitors walking through can _see_ which residencies are hot.

This is tractable because every load-bearing primitive already exists in this stack:

- **Per-floor data model** — your manifest's `Anchor.area` already segments by VT floor; we just add a parallel `vaultResidencies` map keyed by the same area enum.
- **Plinth pedestal** — the `E · Plinth` frame primitive at [schema/manifest.ts:35](../schema/manifest.ts#L35) and the scene's `framePlinth` already render exactly the freestanding-column shape we need.
- **Hanging banner** — `F · Hanging Banner` is the right shape for the artist message displayed over the pedestal.
- **Frame override** — the scene's `chooseFrame()` logic already wraps anchor/piece frame selection in one function ([SCENE_INTEGRATION.md §Task 5](SCENE_INTEGRATION.md)); a small extension lets us force `B` (Gold) when the floor has an active tip.
- **Curator-auth save flow** — `POST /api/manifest` ([app/api/manifest/route.ts:27](../app/api/manifest/route.ts#L27)) already gates writes behind `CURATOR_PASSWORD`; the new Vault tab uses the same primitive.

What's _not_ in this stack and needs net-new work: a Polygon webhook listener, a mobile tip page (wagmi + RainbowKit), QR-code generation, and one Claude moderation pass on artist messages.

---

## Why per-floor, not per-piece

The original brainstorm ([ENGAGEMENT_BRAINSTORM.md §2.5](ENGAGEMENT_BRAINSTORM.md#25-tipping-into-a-piece-lift-large--needs-wallet-sign)) framed this per-piece. The curator's instinct to scope to VT floors is right for three reasons:

1. **VT floors are already residency-shaped.** [FRAMES_AND_ASPECTS.md](FRAMES_AND_ASPECTS.md) treats VT3–VT4 as residency walls, VT5 as Hall of Fame, VT6 as prestige. Each floor = one artist's body of work. Tipping at floor granularity matches the actual conceptual unit.
2. **One config per residency change.** When a new artist moves in, the curator fills out one form on one tab — not 8 forms for 8 pieces.
3. **Visual reward composes upward.** A single gold piece on a wall reads as "someone liked this one piece." An entire VT floor glowing gold reads as "this residency is hot right now." The second is more legible from across the atrium.

Per-piece tipping in F2 main gallery is still a worthwhile v2 — but it stays on shelves until VT-floor proves the mechanic and the visual.

---

## Schema additions

Append to [schema/manifest.ts](../schema/manifest.ts), don't modify existing types:

```ts
// schema/manifest.ts — proposed additions

const ethAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 40-char hex address");

export const VaultResidency = z.object({
  artistWallet: ethAddress,
  artistName: z.string().min(1).max(80).optional(),
  artistMessage: z.string().min(1).max(280),
  artistLinks: z
    .object({
      twitter: z.string().url().optional(),
      lens: z.string().url().optional(),
      farcaster: z.string().url().optional(),
      opensea: z.string().url().optional(),
      site: z.string().url().optional(),
    })
    .optional(),
  // Where in the floor the pedestal sits. Set in Map view.
  // If absent, the floor has no pedestal (config exists but isn't placed yet).
  pedestalPos: z.object({ x: z.number(), z: z.number() }).optional(),
  qrSrc: httpUrl.optional(), // generated server-side on save
  activeUntil: z.string().optional(), // ISO; if past, floor reverts to no-tipping
});

export type VaultResidencyT = z.infer<typeof VaultResidency>;

// Manifest gets one new key. Tip state lives elsewhere (see §Storage split).
export const Manifest = z.object({
  // …existing fields…
  vaultResidencies: z
    .record(z.enum(["vt2", "vt3", "vt4", "vt5", "vt6"]), VaultResidency)
    .default({}),
});
```

**Critical:** `vaultResidencies` only holds **curator-authored config** — address, message, links, pedestal position, QR URL. Tip state (totals, last-tip-time, frame override) is **not** on the manifest. See §Storage split below for why.

---

## Storage split — why tip state isn't on the manifest

Option A would be to put `tipState: { totalUsd, lastTipAt, frameOverride }` directly on `VaultResidency`. This is what I almost wrote. It's wrong because:

- The manifest is **edge-cached for 10s** ([app/api/manifest/route.ts:20](../app/api/manifest/route.ts#L20)) and ships a baked snapshot on every scene deploy. Mutating it on every tip means either invalidating the cache constantly or accepting up-to-10s staleness on visible tip counts.
- Manifest version bumps on every save. A floor that gets 50 tips during an event would bump the manifest 50 times, polluting the version history that's otherwise meaningful (curator edits).
- The scene already has to handle "manifest absent, fall back to baked" — adding live tip state to the baked fallback means the baked manifest carries financial state, which is wrong.

**Option B (what we ship):** keep curator config on the manifest, keep tip state in a separate `panelhaus:tips:<floor>` Redis key with its own endpoint `/api/tips`.

```
Redis:
  panelhaus:manifest:v1          → existing manifest (now includes vaultResidencies config)
  panelhaus:tips:vt3             → { totalUsd, tipCount, lastTipAt, recentTippers[], frameOverride? }
  panelhaus:tips:vt4             → { … }
```

The scene polls both:

- `/api/manifest` — slow cadence (existing), edge-cached, never mutates from tips
- `/api/tips` — fast cadence (every 15s), short cache (`max-age=15`), returns the whole tip-state map for all five VT floors in one shot

Scene-side, this means one new fetcher and one new "apply tip override" pass after the frame is chosen. Trivial.

---

## Token + chain choice

**USDC on Polygon, v1 only.**

| Token        | Chain       | Why                                                                 | Why not (yet)                                                  |
| ------------ | ----------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| **USDC**     | **Polygon** | Stable, sub-cent gas, broadly held, no slippage UX, easiest webhook | —                                                              |
| USDC.e       | Polygon     | Many older wallets still default to it (bridged USDC)               | Accept as alias (same webhook), display as "USDC"              |
| MANA         | Polygon     | Native to Decentraland, thematic                                    | Volatile, smaller holder base, adds price-feed complexity      |
| ETH / WMATIC | Polygon     | Common                                                              | Volatile; adds USD-conversion math for the "$X raised" display |
| USDC         | Ethereum L1 | Universal                                                           | Gas alone destroys tip economics ($5–$30 per tx)               |

USDC native on Polygon is `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` (Circle's 2024+ native deployment). USDC.e bridged is `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`. Listen to both; treat as one logical token. ⚠️ Confirm the native USDC address before deploy — Circle has migrated naming conventions before.

---

## Tip flow — QR to phone, not in-scene signing

DCL SDK7's `signedFetch` only does auth-style signatures (read-only proof of wallet ownership). Arbitrary `eth_sendTransaction` from inside the scene isn't supported cleanly. So we don't try. The flow:

1. **In-scene** — visitor approaches the VT-floor pedestal, presses **E**.
2. **Overlay opens** — UI shows: artist message, artist name + ENS (if set), `$X raised · N tippers`, amount preset hints ($1 / $5 / $25), and a large QR code that encodes `https://phhq-dash-rkwi.vercel.app/tip/<floor>`.
3. **Scan with phone** — visitor's phone camera opens the URL.
4. **Dashboard tip page** — `app/tip/[floor]/page.tsx`. Shows the same artist message + amount picker + RainbowKit "Connect Wallet" button. WalletConnect v2 covers Rainbow / MetaMask Mobile / Trust / 90% of wallets.
5. **Sign** — visitor selects an amount, hits Tip; we build a USDC `transfer(artistAddress, amount)` tx via viem, dispatch via the connected wallet. Visitor signs on phone.
6. **Confirmation** — page polls the tx hash; on confirmation, shows "go back to the gallery — the floor will glow gold within 30 seconds."
7. **Server side** — Alchemy Notify webhook is registered on the artist's address. When Polygon confirms the inbound USDC transfer, Alchemy POSTs to our `/api/tips/webhook`. We update `panelhaus:tips:<floor>`, set `frameOverride: 'B'` with TTL 24h, increment counters.
8. **Scene picks it up** — within 15s (tip-state poll cadence), the scene re-fetches `/api/tips`, sees `frameOverride: 'B'` for that floor, swaps all the VT3 anchors' rendered frames to Gold.

⚠️ The visitor must use a phone wallet that supports WalletConnect v2. Desktop visitors with only a browser-extension wallet are out of luck for v1 — could add a desktop-only "tip from this browser" button later, but the QR path covers mobile, which is where 80% of Decentraland traffic actually is anyway.

---

## Backend — the webhook receiver

New route: `app/api/tips/webhook/route.ts`.

Alchemy Notify configuration: one webhook per active VT floor's artist address, watching for inbound USDC + USDC.e transfers. Register via Alchemy's API at curator-save time (when a new `VaultResidency` is written, register; when one is removed or activeUntil passes, unregister). Stash the webhook ID alongside the residency in Redis (`panelhaus:tips:<floor>:webhookId`) so we can unregister cleanly.

Webhook handler verifies the signature header (Alchemy signs payloads with a per-webhook secret), parses the activity, looks up which VT floor the destination address belongs to, and updates state:

```ts
// pseudocode
const event = parseAlchemyPayload(req); // { from, to, value, hash, blockNum }
const floor = await findFloorByArtistAddress(event.to);
if (!floor) return; // tip to an artist whose residency ended
const usd = await convertToUsd(event.value); // 1:1 for USDC, trivial

await redis
  .multi()
  .hincrby(`panelhaus:tips:${floor}`, "tipCount", 1)
  .hincrbyfloat(`panelhaus:tips:${floor}`, "totalUsd", usd)
  .hset(`panelhaus:tips:${floor}`, "lastTipAt", new Date().toISOString())
  .hset(`panelhaus:tips:${floor}`, "frameOverride", "B")
  .expire(`panelhaus:tips:${floor}:override`, 86400) // 24h TTL on the override key
  .lpush(
    `panelhaus:tips:${floor}:recent`,
    JSON.stringify({ from: event.from, usd, t: Date.now() }),
  )
  .ltrim(`panelhaus:tips:${floor}:recent`, 0, 9) // keep last 10
  .exec();
```

The TTL trick: store `frameOverride` and a sibling `:override` key with EXPIRE 86400. The `GET /api/tips` reader checks the `:override` key's existence to decide whether to return `frameOverride: 'B'`. When the sibling expires, the override silently disappears. No cron job needed.

**Alternative if Alchemy adds a fee tier issue:** poll Polygon RPC for `Transfer` events on the USDC contracts filtered by `to` address, every ~30s, via a Vercel Cron. Cheaper, ~30s slower to detect. Fine for v1 traffic; switch when load demands.

---

## Dashboard — the Vault tab

New nav entry, between Music and Import (which is where Pieces/Books/Music live in the current layout):

```tsx
<NavLink href="/vault">Vault</NavLink>
```

View at `app/vault/vault-view.tsx`. Five cards, one per VT floor (VT2 → VT6), vertically stacked. Each card:

```
┌─────────────────────────────────────────────────────────────────┐
│ VT3 — Residency Floor                          [● Active] [Save] │
│                                                                  │
│ Artist wallet:    [ 0x742d35Cc6634C0532925a3b844Bc454e4438f44e ] │
│                   → ENS: artistname.eth                          │
│ Artist name:      [ artistname.eth                             ] │
│ Message (280):    [ ┌────────────────────────────────────────┐ ] │
│                     │ "Sketches from my year in Kyoto.       │   │
│                     │  Tips go to my next book of paintings."│   │
│                     └────────────────────────────────────────┘   │
│ Links:            ▸ twitter / lens / farcaster / opensea / site  │
│ Pedestal:         placed at (12.3, 18.7) · [Re-place in Map]     │
│ Active until:     [ 2026-08-15        ]  ✕ Clear                 │
│                                                                  │
│ ─── Tip activity ─────────────────────────────────────────────   │
│ $1,247 raised across 38 tips · last tip 14m ago                  │
│ ◯ Frame override active (gold for 23h 46m)                       │
│                                                                  │
│ Recent tippers:                                                  │
│   $25  vitalik.eth          14m ago    [view tx]                 │
│   $5   0x8f...3a            42m ago    [view tx]                 │
│   $50  pranksy.eth          2h ago     [view tx]                 │
│   …                                                              │
└─────────────────────────────────────────────────────────────────┘
```

**Wiring details:**

- Address input validates with viem's `isAddress` on blur; if invalid, shows a red border + helper text. ENS lookup runs against Ethereum mainnet (not Polygon — ENS lives on L1) via viem's `getEnsName`.
- Message textarea has a live preview to the right showing how the in-scene plaque will render (re-using the dashboard's existing anchor-preview pattern from [app/pieces/pieces-view.tsx](../app/pieces/pieces-view.tsx)).
- Save button writes the residency into `manifest.vaultResidencies[floor]` via the existing `saveManifest` flow in [lib/client.ts](../lib/client.ts). On save:
  1. Run Claude Haiku moderation pass on the message (cheap, ~150ms); if flagged, refuse with a clear error.
  2. Generate the QR code server-side (using `qrcode` npm package) → upload PNG to Vercel Blob at `vault/<floor>/qr.png` → write `qrSrc` into the residency.
  3. Register/update the Alchemy webhook for this address.
  4. Patch the manifest. Bump version. Done.
- "Re-place in Map" button deep-links to `/map?placePedestal=vt3` — the map view enters a pedestal-placement mode that lets the curator click on the VT3 floor plan to set `pedestalPos`. Same primitive as the existing anchor add-by-hand flow.
- Tip activity panel reads from `/api/tips/<floor>` and refreshes every 15s. Transaction links resolve to `polygonscan.com/tx/<hash>`.

VT2 lobby card can have a "no residency, tipping disabled" placeholder — the curator decides whether to enable. VT5 Hall of Fame and VT6 prestige are configurable the same way (could go to a "venue support" address; the schema doesn't care).

---

## In-scene rendering

Scene-side, new file `src/scene/art/vault-tips.ts` (companion to `build.ts`).

Two new spawns per active residency:

1. **Pedestal** — call `framePlinth` at `pedestalPos`, sized `1×1.5×1` m, with `textureSrc = residency.qrSrc`. The QR code becomes the pedestal's visible face.
2. **Message banner** — call `frameHangingBanner` directly above the pedestal at `y = floorY + 4`, with a generated texture: a black-on-cream banner with the artist message + name rendered as text. Texture is baked server-side at save time (same time as the QR), stored at `vault/<floor>/banner.png`. Banner size: `3 × 0.8` m.

Both spawns happen in a `buildVaultTipping(manifest)` pass that runs after `buildArtwork(manifest)` in `main()`.

**UI overlay on E-press:**

Use SDK7's `ReactEcs` UI. A `PointerEventsSystem.onPointerDown` on the pedestal entity opens an overlay (`engine.addEntity` with a UiTransform + UiText). Overlay contents:

```
Artist: artistname.eth
"Sketches from my year in Kyoto.
 Tips go to my next book of paintings."

$1,247 raised · 38 tips · 12m ago

Scan to tip:
[ QR code image, 256x256 ]

Suggested: $1   $5   $25   Custom
```

Close on second E-press or any movement key. No actual signing happens here — the QR is the handoff point.

**Frame override hook:**

Modify the scene's `chooseFrame` (from [SCENE_INTEGRATION.md §Task 5](SCENE_INTEGRATION.md), in `src/scene/art/build.ts`) to consult tip state for VT floors:

```ts
function chooseFrame(
  anchor: AnchorT,
  piece: PieceT,
  tipState: TipStateMap,
): FrameKindT {
  // Vault floor override: if this floor has an active tip, force Gold.
  if (
    anchor.area.startsWith("vt") &&
    tipState[anchor.area]?.frameOverride === "B"
  ) {
    return "B";
  }
  // …existing logic…
}
```

`tipState` is loaded once per render pass (which fires when `/api/tips` poll returns new data). The override is _all-anchors-on-floor_, not per-anchor — every piece on VT3 goes gold together when the floor is hot.

---

## Moderation + safety

Non-negotiable for shipping:

- **Address validation** — viem's `isAddress` server-side before writing. Reject anything that doesn't match the EIP-55 checksum form.
- **Message moderation** — every `artistMessage` runs through Claude Haiku with a moderation prompt before write. Reject on flag, return error to curator with reason. Cost: <$0.001 per save. Worth it — the curator could be lazy-pasting raw artist submissions.
- **Tip rate limit** — Alchemy webhook handler dedupes by tx hash. Server caps tip-update writes at one per wallet per floor per minute (an attacker can't artificially inflate `tipCount` by re-broadcasting). Real tips pass through; storms get throttled.
- **Tip amount sanity cap** — server-side, ignore individual tx values above $10K USD (silently still count it but cap the displayed total). Sanity guard against either an attacker generating fake-Alchemy webhook calls or a misconfigured address that someone tips by accident.
- **Webhook signature verification** — Alchemy signs every payload with a per-webhook secret. We verify the `X-Alchemy-Signature` header on every receipt. Unsigned / wrong-signature payloads get a 401, no state mutation.
- **No custody** — every tip goes wallet-to-wallet on-chain. We never hold funds. The dashboard observes, it doesn't escrow. This is the single best security property of the design and we should preserve it forever.

---

## Cost model

**Vercel:**

- Bundle bytes: +~120 KB for wagmi + viem + RainbowKit on the tip page (route-split, doesn't affect main dashboard). Tolerable.
- Function invocations: webhook receiver fires once per tip. 100 tips/day = 100 invocations/day. Free tier covers it for years.

**Alchemy:**

- Notify webhooks: free tier includes generous webhook events per month. Our 5-floor venue with even heavy traffic will not hit limits. If we do, paid tier is $49/mo.

**Polygon gas:**

- Paid by tipper, not us. ~$0.001 per USDC transfer.

**Claude API:**

- Moderation pass on message save: ~$0.0005 per call via Haiku. Negligible.

**Vercel Blob:**

- QR PNG + banner PNG per residency: ~30 KB each, 5 floors = ~300 KB total. Free.

**Net monthly cost at v1 scale: under $5.** No real cost story until the venue is doing thousands of tips per day.

---

## What I'd build first

Roughly **2 days of focused work** for the v1 minimum:

1. **Schema + storage** (2 hours) — add `VaultResidency` to [schema/manifest.ts](../schema/manifest.ts), set up `panelhaus:tips:*` keys, write the schema-sync header bump so the scene picks up the new types.
2. **Tip state API** (1 hour) — `GET /api/tips` reading the Redis map. No auth (public read).
3. **Webhook receiver** (3 hours) — `POST /api/tips/webhook`, Alchemy signature verification, state mutation with TTL trick. Test with a manual curl + dummy payload before wiring real Alchemy.
4. **Dashboard Vault tab** (4 hours) — `/vault` page with five cards, address validation, message editor, save flow. Skip the live preview + ENS lookup for v1; add later.
5. **Tip page** (3 hours) — `/tip/[floor]` with wagmi + RainbowKit + viem USDC transfer. The smallest possible page that connects, signs, confirms.
6. **QR + banner generation** (1 hour) — server-side `qrcode` for QR, server-side `@vercel/og` or similar for the banner text. Both bake on `vaultResidencies` save.
7. **Scene-side `buildVaultTipping`** (3 hours) — spawn pedestal + banner per residency, UI overlay on E-press, hook `chooseFrame` for gold override.
8. **Alchemy webhook registration** (1 hour) — small admin function that registers/unregisters webhooks when residencies change. Initially can be a manual one-time script.
9. **Moderation pass** (30 min) — Claude Haiku call inside the save handler.

**Total: ~18 hours.** Two solid days.

---

## Out of scope (call out so we don't conflate)

- **Multi-token tipping.** USDC-only v1. MANA / ETH / WMATIC come when an artist asks. Each is a new token-detection branch in the webhook handler + a new option on the tip page.
- **Splits.** No artist/venue revenue split. 100% to artist. If we want to add a venue cut later, we either ask artists to forward manually or set up a Splits.org contract per residency (composable; we don't touch escrow).
- **Tip-to-mint mementos.** "Tip $25, get a Zora 1155 of the piece" is a great v2 but adds an entire NFT minting flow.
- **Per-piece tipping in F2 / atrium.** Save for v2 once VT-floor proves the mechanic. Same primitives, narrower scope.
- **Leaderboards** ("top tipper this month") — add once `recentTippers` is consistently populated; trivial to read.
- **Withdrawals dashboard for artists.** Funds are on-chain in the artist's wallet — they manage withdrawal in whatever wallet they use. We could surface a "this is your tip history" page gated by wallet signature later.
- **Tip-triggered effects beyond gold frame.** Confetti particles, sound, ambient glow — fun follow-ups, but the gold frame is the load-bearing visual.
- **In-scene wallet signing for desktop.** Wait for SDK7 to add it cleanly. QR-to-phone covers mobile, which is most DCL traffic.

---

## Open questions / risks

- **Alchemy free tier ceiling.** Need to verify the per-month webhook event count before committing. If too low, switch to RPC polling via Vercel Cron as a fallback.
- **USDC contract address drift.** Circle has migrated naming before (USDC vs USDC.e). Hardcode both addresses, treat as one token; revisit if Circle deprecates the bridged one.
- **WalletConnect v2 mobile UX quality.** Empirically good for Rainbow / MetaMask Mobile, occasionally janky on Trust. Test on real devices before public launch.
- **Pedestal collisions.** If the curator places a pedestal where there's already an art piece anchor, both render and the scene looks broken. Add a placement-time check in the Map view: if the click is within 1.5m of an existing anchor or pedestal, refuse with a tooltip.
- **What happens when residency ends mid-tip-cycle?** A tip arrives 5 minutes after `activeUntil` passes. Options: (a) accept and credit, but don't show the floor as gold; (b) refund — impossible, funds are on-chain; (c) accept silently. Recommend (a): the tip still goes to the artist; we just stop incrementing visible counters once the residency window closes.
- **What if an artist's wallet is compromised mid-residency?** The artist updates the address on the dashboard; the curator approves the change; webhook gets re-registered. Past tips already sent to the old address are gone, like real-world tipping into the wrong jar. This is the cost of non-custodial — we accept it.

---

## Reference

- Original brainstorm context — [ENGAGEMENT_BRAINSTORM.md §2.5](ENGAGEMENT_BRAINSTORM.md)
- Manifest schema (where `vaultResidencies` lands) — [schema/manifest.ts](../schema/manifest.ts)
- Manifest API the dashboard already writes through — [app/api/manifest/route.ts](../app/api/manifest/route.ts)
- Existing curator-auth gate — [auth.ts](../auth.ts)
- Scene-side render contract (where `chooseFrame` lives) — [SCENE_INTEGRATION.md](SCENE_INTEGRATION.md)
- Frame primitives `framePlinth` / `frameHangingBanner` — `src/scene/art/frames.ts` in the scene repo
- Per-area Y-coord lookup the pedestal spawn needs — `src/scene/art/floor-y.ts` in the scene repo
- Curator UX pattern to mirror for the Vault cards — [app/anchors-view.tsx](../app/anchors-view.tsx)
- Vercel Blob upload pattern for QR + banner generation — [app/api/pieces/upload/route.ts](../app/api/pieces/upload/route.ts)
- Map-view "click to place" primitive to extend for pedestal placement — [app/map/map-view.tsx](../app/map/map-view.tsx)
