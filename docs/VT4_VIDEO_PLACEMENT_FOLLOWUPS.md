# VT4 Video Pieces — Follow-Ups

**Date:** 2026-05-25 · **Manifest version checked:** v1424 · **Source investigation:** in-conversation notes (not committed)

## Headline

Previous diagnosis ("both video pieces have no poster") is **stale** — the sync script at [scripts/sync-voluptechne-posters.js](../scripts/sync-voluptechne-posters.js) has since run and both posters are live in v1424. The real blockers are placement and aspect.

The Voluptechne video centerpiece slot (`vt4-w-3`, noted "her only video piece, must-include") is currently showing `vt4-royal-self-portrait-23` — a static piece — and `vt4-voluptechne-video` is in the manifest but hung nowhere.

---

## Action punch list

Ordered so the upstream questions (which gate the rest) get answered first.

### 1. Verify the real video aspect ratios on SuperRare ⬅ blocks #3, #4

Open both artwork pages and check the actual encoded dimensions:

- `vt4-voluptechne-video` → https://superrare.com/artwork/eth/0x3caabFCad9c7Bb04f62A1D0703FB202CB31D9Dd4/15
- `vt4-body-mapping` → https://superrare.com/artwork/eth/0x1259.../35

Both pieces are currently declared `"aspect": 1.0` (square). The posters are SR imgix `w=800&h=418&fit=crop` stills — 1.91:1. If the videos are actually widescreen (1920×1080 is SR's common encoding for non-square work), the manifest aspect is wrong and the in-room frame will mis-letterbox the poster.

Outcome → either:

- **Videos are square (1:1):** aspect is correct, posters need a square crop (see #4)
- **Videos are widescreen (16:9):** update `aspect` to `1.7778` on both pieces; the existing 1.91:1 posters land close enough

### 2. Place `vt4-voluptechne-video` on `vt4-w-3`

Map view → VT F4 → click `vt4-w-3` → swap pieceId to `vt4-voluptechne-video`. Coordinates already verified (x=80.25, z=23, `allowedFrames: ["B"]`).

Once placed, the note "Voluptechne video; her only video piece, must-include" on `vt4-w-3` becomes accurate again.

### 3. Decide what to do with `vt4-body-mapping`

It's in the manifest with a poster and a SuperRare link but is currently homeless. Two paths:

- **Place it** — pick one of the open `vt4-e-*` anchors (or any allowed-frame-B slot) and assign. If #1 says the real aspect differs from 1.0, fix `aspect` before placing.
- **Leave unplaced** — the piece stays in the picker for later. No harm, just don't forget it exists.

### 4. Source square posters (only if videos turn out to be 1:1)

The current 1.91:1 imgix stills will get center-cropped into a square frame, losing ~47% of the image on each side. Two cheap options if you need real square stills:

- Screenshot a frame from the SR video player → upload to Vercel Blob via the dashboard piece editor → paste the blob URL into the AnchorCard poster row
- Use the un-cropped imgix asset path (`...asset/88009d8c....jpeg` for `vt4-voluptechne-video`, `...asset/f4f481fd....jpeg` for `vt4-body-mapping`) **with a fresh imgix signature** — but the signature is HMAC'd to the SR imgix token, so this would need a re-sign you can't do from outside SR

Skip this entirely if the videos are widescreen (per #1).

### 5. Clean up `vt4-w-3-2` (duplicate-or-distinct anchor)

`vt4-w-3` (z=23) and `vt4-w-3-2` (z=18) both carry the identical note "W wall (3/5 — CENTER) — Voluptechne video; her only video piece, must-include" but only one was ever supposed to hold that video. Decide:

- If `vt4-w-3-2` is a valid second slot — clear the duplicate note, assign a distinct piece
- If it's a layout accident — delete the anchor via the × button on the AnchorCard

The current `vt4-proud-mary` assignment on `vt4-w-3-2` is reasonable as-is; the only real cleanup is the misleading note.

### 6. Add `"video"` tag to `vt4-body-mapping`

Currently tagged `["1/1","eth","superrare","sold","animated","vt4-residency"]`. `vt4-voluptechne-video` has `"video"` in its tags; `vt4-body-mapping` doesn't. Inconsistent → it won't show up if a curator filters the Pieces view by `video`. Add via the inline tag editor on either the AnchorCard (once placed) or the Pieces view row.

The `isVideoPiece` helper at [lib/pieces.ts:13-25](../lib/pieces.ts#L13-L25) already detects video via either tag (`animated` OR `video`) or extension, so this is a curator-discoverability fix, not a render fix.

---

## Hypothesis cleared (parking-lot for the music loop bug)

While walking the manifest I checked all 9 tracks' `durationSec`:

| Track                      | durationSec  |
| -------------------------- | ------------ |
| D.I.Y. (Disguise Yourself) | 98.4 (1:38)  |
| Doors Open (Haus)          | 169.5 (2:49) |
| GENESIS CITY               | 267.8 (4:28) |
| Haus Lights                | 251.8 (4:12) |
| Inked Up                   | 100.8 (1:41) |
| Multiverse Mascot          | 142.5 (2:23) |
| Smudge                     | 73.5 (1:13)  |
| The Ballad of Smudge       | 122.5 (2:03) |
| Welcome to the Haus        | 269.8 (4:30) |

All realistic. The music loop bug is **not** a "bad `durationSec` → 6s advance timer" issue. That hypothesis is dead. Remaining suspect: ungated `applyNowPlaying` on every scene poll — already noted as Hypothesis 1 in [MUSIC_LOOP_BUG_INVESTIGATION.md](MUSIC_LOOP_BUG_INVESTIGATION.md).

---

## Open questions

- **What aspect are the actual videos?** Gates #1, #3, #4. Cannot be answered from the manifest alone — needs eyes on the SR video player.
- **Is `vt4-w-3-2` intentional?** Gates #5. Probably a layout accident given the identical note, but worth a sanity check before deleting.
- **Does the residency want `vt4-body-mapping` placed at all?** Gates #3. The artist sent both pieces but the centerpiece is `vt4-voluptechne-video`; `vt4-body-mapping` might be intentional inventory rather than a wall piece.

---

## Not in scope

- The scene-side fallback for video pieces without posters (already specced in [SCENE_VIDEO_POSTER.md](SCENE_VIDEO_POSTER.md))
- The clickable-link-in-scene work (specced in [SCENE_LINKS_HANDOFF.md](SCENE_LINKS_HANDOFF.md))
- Re-signing imgix URLs to change crops — requires SR's imgix token, won't happen
