# DUMPSTR Raffle — Dashboard Handoff (phhq_build)

> **For:** the phhq_build dashboard repo (`phhq-dash-rkwi.vercel.app`).
> **Scope:** capture a player's **Solana wallet** as a DUMPSTR raffle entry, let the
> scene confirm the entry, and give operators a **raffle draw** tool to pick winners
> for the CyberKongz DUMPSTR NFT giveaway.
>
> **Why this exists:** the scene's credit-gating aggregates **ETH only**, so SOL
> communities can't get wallet-connect credit drops yet. The agreed SOL path is
> **codes + raffle**. This is the raffle's dashboard half.
>
> **Scene context:** reward step of the "One Man's Trash" quest
> ([ONE_MANS_TRASH_QUEST_PLAN.md](ONE_MANS_TRASH_QUEST_PLAN.md)). Mulligan (the
> dumpster ape on F3) sends finishers to "drop your solana bag" — that CTA opens
> the capture form below.
>
> **Pattern to copy:** this mirrors the Q5 submission contract exactly — see
> [CREATOR_QUEST_COMPLETION_DETECTION.md](CREATOR_QUEST_COMPLETION_DETECTION.md).
> Same identity model, same `/api/quest-status` poll, same caching rules.

---

## Identity & trust model

Reuse **option A** from the Q5 contract:

|                                         | Mechanism                                                        | Trust                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Write** (who entered / which SOL bag) | `?wallet=<ethAddr>` query param + pasted SOL address on the form | Trust-on-write. A crafted URL can add a spurious entry; it can't steal/overwrite another player's. |
| **Read** (did _this_ player enter)      | `signedFetch` — DCL signs with the player's auth-chain           | Airtight. Derive the ETH wallet from the verified signer, never from body/query.                   |

- **ETH identity is the dedupe / eligibility key** (one entry per ETH wallet).
- **The SOL address is just the payout target** — captured trust-on-write.
- **Real-value note:** the Q5 contract flags that if a reward gates real value
  ("AI credits, raffle"), consider upgrading the _write_ to wallet sign-in. The
  prize here is an NFT, so this is a real decision — see Open Questions. Recommended
  v1: keep trust-on-write entry (you must complete the in-scene quest to get the
  CTA) + ETH-identity dedupe; harden later with a Phantom "sign a message" verify.

---

## Route 1 — `GET /dumpstr-raffle` (the capture form) ⟵ the new build

Opened from the scene via `openExternalUrl` →
`https://phhq-dash-rkwi.vercel.app/dumpstr-raffle?wallet=0xETH...`.

**Server SHOULD:**

1. Read `wallet` (the player's ETH identity) from the query param.
2. Present a **DUMPSTR-branded capture form** (green #4cae4c / banana — see the
   `src/whitelabel/dumpstr/` skin for visual language). Copy can lean on the brand:
   "feed the dump — a banger prints. winners drawn from the bag."
3. **Show the entry requirements prominently at the top** (numbered, can't-miss) —
   this is a post-to-enter contest, not just a wallet drop:

   > **HOW TO ENTER THE DUMPSTR GTD RAFFLE**
   >
   > 1. **Make a meme** at **memes.panelhaus.app**
   > 2. **Post it on X** tagging **@panelhaus** with **#smudgethesponge**
   > 3. **Drop your Solana wallet + your post link below**

4. **Fields:**
   - **Solana wallet** (required) — **validate**: base58, decodes to 32 bytes
     (≈32–44 chars); reject ETH-looking `0x…` input with a clear error.
   - **Post link** (required, recommended) — URL of the X post. Lets the operator
     verify the post + tags before drawing. Light validation (looks like an
     x.com/twitter.com URL) is enough; the real check is at draw time.
5. On submit, **upsert keyed on the ETH wallet**:
   `entries[ethWallet] = { solWallet, postUrl, ethWallet, quest: 'one-mans-trash', ts }`.
   Re-visits update the same row (no dupes). The scene only needs the boolean back.
6. Show a confirmation state ("you're in the dump — winners drawn after launch")
   so the player gets instant feedback (the scene poll confirms a few seconds later).

If `wallet` is absent (page opened directly), fall back to asking for the ETH
address or a manual code path — the scene's confirm poll just won't fire, which is
the correct degrade (same as `/submit`).

**Tags are exact:** **@panelhaus** and **#smudgethesponge** — render them
copy-pasteable so entrants get them right (mismatched tags = unverifiable entry).

**Phantom connect** can replace the paste field later; the stored shape is identical.

---

## Route 2 — extend `GET /api/quest-status` (the read-back the scene polls)

The scene already polls this endpoint signed (every 15s) for Q5. **Add one field**
so the same poll confirms raffle entry — do NOT make a new auth path.

**Server MUST** (unchanged from the Q5 contract):

1. Verify the auth-chain; derive `wallet` from the **verified signer**, never the query.
2. Look up that wallet and return its flags.

**Response** `200 application/json` — add `dumpstrRaffleEntered`:

```json
{ "makeYourMark": true, "dumpstrRaffleEntered": true }
```

Return `false` (or omit) when the wallet has no raffle entry. Field name must match
the scene's `QuestStatus.dumpstrRaffleEntered` (the scene poll reads only what it needs).

**⚠️ Same caching gotcha:** this response is **per-wallet** — `Cache-Control: private,
no-store`. Never behind the shared `/api/manifest` CDN cache.

---

## Route 3 — Raffle admin tool (operator-only, NOT scene-facing)

A gated internal page/endpoint (behind your existing operator auth — same allowlist
spirit as the in-scene capture curators):

1. **List entrants** — table of `{ ethWallet, solWallet, postUrl, ts }`, with a count.
   Make `postUrl` a clickable link so the operator can open each post and confirm it
   tags **@panelhaus** + **#smudgethesponge** before (or after) the draw.
2. **Draw N winners** — random selection with a **stored seed** so the draw is
   **auditable/verifiable** (e.g. seeded PRNG over the sorted entrant list; persist
   `{ seed, drawnAt, winners[] }`). Don't draw with an unseeded `Math.random()` you
   can't reproduce. (If you want only verified posts eligible, add a `verified` flag
   and draw from `entries.filter(e => e.verified)`.)
3. **Mark + export** — flag winners and **export the winning SOL wallets + post URLs**
   (CSV/JSON) for the DUMPSTR NFT airdrop.
4. _(Optional)_ surface "you won" back through `/api/quest-status`
   (`dumpstrRaffleWon: true`) so the scene can congratulate the winner in-world later.

---

## Data model (suggested)

```
dumpstrRaffleEntries: {
  [ethWallet: string]: {       // dedupe key (lowercased)
    solWallet: string,         // base58, validated; payout target
    postUrl: string,           // X post tagging @panelhaus + #smudgethesponge
    ethWallet: string,
    quest: 'one-mans-trash',
    ts: number,                // epoch ms
    verified?: boolean,        // optional: operator confirmed the post + tags
    won?: boolean              // set by the draw
  }
}
raffleDraws: [
  { seed: string, drawnAt: number, winners: string[] /* ethWallets */ }
]
```

---

## End-to-end flow

1. Player finishes the salvage hunt → Dumpy's finale sends them to make a meme at
   **memes.panelhaus.app** and to the raffle page `/dumpstr-raffle?wallet=0xPLAYER`.
2. Player **makes a meme**, **posts it on X** tagging **@panelhaus** + **#smudgethesponge**,
   then drops their **SOL wallet + post link** → `entries[0xPLAYER] = { solWallet, postUrl, … }`.
3. Scene's 15s poll hits `/api/quest-status` signed as `0xPLAYER` →
   `{ dumpstrRaffleEntered: true }`.
4. Scene `advanceStep('raffle')` → … → `completeQuest('one-mans-trash')` + claim-code caption.
5. **Later (operator):** verify posts → run the seeded draw → export winning SOL wallets
   → CyberKongz airdrops the DUMPSTR NFT(s).

---

## Scene-side (this repo — for reference; we build it)

- New `src/scene/quests/quest_dumpster_ape.ts` will `openExternalUrl` the capture URL
  (built like `buildSubmitUrl` in
  [quest_status.ts](src/scene/quests/quest_status.ts)) and poll `/api/quest-status`
  for `dumpstrRaffleEntered` (clone `initQuestStatusPoll`).
- We need the **exact route path** (`/dumpstr-raffle`) and the **field name**
  (`dumpstrRaffleEntered`) locked so the scene code matches. Propose changes here if
  you'd name them differently.

---

## Open questions (need answers — several are Henry/CyberKongz)

1. **Prize & funding:** how many DUMPSTR NFTs, who funds, and the airdrop mechanism?
   (Currently a placeholder "access spot.")
2. **Dates:** entry window open/close; draw cadence (single draw at close, rolling, or per-pool)?
3. **Verify level:** trust the pasted SOL address (v1, recommended) or require a Phantom
   sign-a-message to prove ownership before entry counts?
4. **Eligibility:** entry purely on quest completion, or also require holding a
   Kongz/collab asset / a code? Any region/KYC constraints on the NFT prize?
5. **One entry per:** ETH identity (recommended) or per SOL wallet?
6. **Rules/legal:** canonical rules tweet URL (the lander's `rulesUrl` is still `#`) and
   any "no purchase necessary" disclosure the form should link.

## Acceptance criteria

- [ ] `GET /dumpstr-raffle?wallet=0x…` renders the branded form **with the numbered
      entry instructions** (make a meme → post with @panelhaus + #smudgethesponge →
      drop wallet + post link), validates SOL input, captures the post URL, upserts
      keyed on ETH wallet, shows a confirm state.
- [ ] `GET /api/quest-status` returns `dumpstrRaffleEntered` for the verified signer,
      `private, no-store`, not shared-cached.
- [ ] Operator draw tool: list, seeded/auditable draw of N winners, mark, export SOL wallets.
- [ ] Direct-open (no `wallet`) degrades gracefully (asks for address or no-ops).
