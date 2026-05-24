# Visitor Engagement — Cutting-Edge, Whacky, Unfiltered Brainstorm

**Status:** brainstorm, deliberately unfiltered
**Date:** 2026-05-23
**Author:** dashboard team

## Frame for this doc

Decentraland gives most venues a brutal first 90 seconds: the visitor lands, sees art on walls, walks a lap, leaves. Static galleries lose to that timer. The venues that **don't** lose to it do one of three things:

1. **React to who you are** (wallet, ENS, NFTs held, prior visits)
2. **React to who else is there** (presence, crowd dynamics, asymmetric roles)
3. **Promise that this moment is different from any other moment** (time-windowed content, generative state, live performance)

Everything below is sorted under one of those three pillars, plus a fourth: **the venue remembers**. Each idea has a one-line bet on whether it's a v1 lift, a stretch project, or a "we'd need to build a small platform first."

The point is breadth — read this looking for the two or three that snap into your roadmap, not a checklist.

---

## Pillar 1 — The venue reacts to YOU

The Decentraland visitor arrives with a wallet, a name, maybe an ENS, maybe a Lens/Farcaster handle, maybe a backpack of NFTs. Today the venue ignores all of that. Every one of these ideas converts that "ignored signal" into a moment.

### 1.1 Wallet-mirrored hero wall (lift: medium)

One anchor — say the atrium hero or a single F6 prestige slot — auto-displays a piece **from the visitor's own NFT collection**. Read their wallet via `getUserData`, query OpenSea/Reservoir for their ERC-721s on Ethereum + Polygon, pick the highest-floor-priced one (or random, or "most stared at by other visitors"), render it into the slot.

> "I walked into the gallery and they were showing my art" is the most viral thing this venue could ever do.

The implementation seam already exists: the manifest renderer in the scene takes any `Piece.src` URL. A `dynamicPiece` flag on an anchor could tell the scene to resolve `src` at render time from a player-context API instead of the manifest. The dashboard never sees the personal piece — it just declares the slot as personal-reactive.

Risks: NFT image hosts can be slow / NSFW. Need a moderation layer (Claude-based content check on the resolved URL before display) and a graceful fallback to a static piece.

### 1.2 ENS / Lens / Farcaster welcome lightbox (lift: small)

When the visitor enters, one specific Lightbox frame on F1 entrance briefly displays a banner: _"Welcome, vitalik.eth"_ or _"Welcome, dwr.eth — last seen 3 weeks ago"_. Resolves ENS → if none, Lens → if none, Farcaster (via Neynar) → if none, shortened wallet address.

Then it fades back to the curated piece after ~10 seconds. The personal touch costs nothing and is the kind of thing visitors screenshot.

### 1.3 Backpack-conditional rooms (lift: medium-large)

Certain rooms / floors / anchors are gated by **what wearables or NFTs the visitor is wearing**. Wearing a Panel Haus wearable from a past show? VT6 prestige opens for you. Holding the curator's last drop? F5 secret room shows a second piece behind the canonical one.

The DCL SDK7 has `Avatar` and emote inspection. Combine with NFT ownership reads. This is how you build **soft loyalty** — there's no spam-bot way to fake it.

### 1.4 Personal piece-stamping (lift: small)

Every piece accumulates a list of wallet addresses that have "stamped" it (looked at it for >10s, or pressed E near it). A small floating counter under each anchor: _"42 collectors have stood here"_. Visitor sees their wallet enter the count. Cheap dopamine.

Manifest extension: nothing — store stamps in Redis under `panelhaus:stamps:<pieceId>`. The scene polls a `/api/stamps` endpoint and renders the count as a UI overlay attached to the anchor.

### 1.5 Generative welcome poem (lift: medium, depends on Claude API)

On entry, Claude generates a one-line haiku addressed to the visitor that pulls from their ENS / wallet history / displayed PFP. The line shows up as a hanging banner over the F1 entrance for ~30s, then fades.

> "vitalik.eth, the cathedral has been waiting / for someone who knows the weight of glass"

Cost is trivial per visit (cheap Haiku call). The Anthropic SDK + a Vercel edge route gives you sub-2s generation. The novelty per visitor lasts at least one session and probably one social-media post.

### 1.6 Collector-tier ambient color shift (lift: tiny)

The venue's accent color (skybox tint, lightbox glow color) gently shifts based on a single property of the visitor: years since their wallet's first transaction. Wallets older than 2017 get a warmer palette; freshly-minted wallets get cooler. Nobody will consciously notice, but you'll be making a venue that _feels different_ depending on who's in it.

### 1.7 Mirror of recent visitors (lift: small)

A wall on F1 entrance with the last 20 visitors' PFPs (from Lens/Farcaster/ENS resolution), updating live. Stand on a footprint marker and your own PFP joins the wall for the session. A trivial form of social proof — turns the entrance into "look who else has been here."

---

## Pillar 2 — The venue reacts to OTHER PEOPLE

A DCL scene that requires another human to fully experience it has a built-in retention engine: people will bring friends specifically to unlock the experience.

### 2.1 Multiplayer-only anchors (lift: medium)

Certain anchors stay blank until **two or more visitors stand within 5m simultaneously**. Then the piece materializes. The point: turn the venue into something you have to bring someone to.

Implementation: the scene tracks `Transform` positions of remote players (already available in SDK7's `engine.getEntitiesWith(Transform, Player)`). Trigger anchor render when N players are within radius.

### 2.2 Choir mode — emote-synchronized art (lift: medium)

When 3+ visitors do the same emote at the same time (`wave`, `dance`, `clap`), the F4 stage's lightboxes pulse in unison and a hidden hero piece appears for the duration. The mechanic teaches itself the first time someone notices it. Within a week, regulars are coordinating in chat.

### 2.3 The Confessional Plinth (lift: medium)

A specific E-Plinth has a microphone icon. Press E, record a 10-second voice clip. Your clip is **anonymized** (pitched / scrambled) and plays from the plinth for the next visitor who walks past, then deletes itself after one play.

A one-shot voicemail chain. Curated by no one. Visitors will leave warnings, jokes, marriage proposals, lyrics. The plinth becomes the gallery's beating social heart.

Tech: dashboard route to upload audio blob; scene polls `/api/confessional/next` per plinth and plays via `AudioSource`. Auto-delete on play.

### 2.4 Patience pieces (lift: small)

A few specific anchors render a piece **only if a single visitor stands still within 3m for 90 seconds**. Movement resets the timer. The reward is a piece nobody who's just hurrying through will ever see, and a screenshot moment ("did you sit through it? what came up for you?").

Crowd dynamics emerge: when one visitor is sitting still, others get curious and gather. Bonus: bundle a Claude-generated 1-sentence reflection that displays alongside the piece — different every viewing.

### 2.5 Tipping into a piece (lift: large — needs wallet sign)

Each piece has a "tip the artist" pedestal. Tip in MANA / USDC / a Polygon native token; the piece's **frame upgrades temporarily** — A Ink → B Gold for 24h after each tip. Visitors gold-rush specific pieces; artists get real revenue; the gallery looks alive.

Requires a Polygon sign flow and a small backend to listen for tx confirmations. Manifest extension: `Piece.tipState = { totalTipped, currentFrameOverride }`.

### 2.6 Crowd-piloted skybox (lift: medium)

Once per hour, every in-scene visitor gets a 30-second prompt: _"Pick the venue's mood for the next hour: dawn / dusk / storm / void"_. Plurality wins. Skybox, ambient light, music gain all shift together.

Trivial Redis poll + scene fetch. The point isn't the outcome — it's that visitors who happen to overlap **had a moment together** that lives for one hour and never repeats.

### 2.7 Heat map ghost trails (lift: medium)

Render a faint ground-glow showing where past visitors have walked over the last 24 hours, like a worn carpet. Heavier traffic → brighter trail. F2 main gallery wears a literal path between the most-stared pieces.

This is a **memory of the crowd**. People will deliberately walk weird paths to see if they leave a mark.

Tech: scene posts player position samples (debounced, low-rate) to `/api/footprints`; a backend bucketizes into a 100x100 grid per floor; scene fetches the grid and renders as a transparent texture on the floor.

### 2.8 Whisper zones (lift: small, big payoff)

Two specific corners of the venue (one in atrium, one in VT lobby) are linked by a hidden audio channel. Anything said in chat in zone A is whispered through positional audio in zone B, and vice versa. No labels — visitors discover it.

Implementation: the scene already subscribes to chat events. Filter by zone, broadcast as positional `AudioSource` text-to-speech (use ElevenLabs cheap voice) in the linked zone.

### 2.9 Twitch chat overlay during events (lift: medium)

When the venue has a `nowPlaying.kind = "stream"` set (live event), connect a Twitch channel. Chat messages from Twitch appear as floating speech bubbles over the F4 stage, ephemeral, ~3s each.

This is how you make an in-scene event feel like a **broadcast that includes the room**. Twitch viewers feel present in DCL; DCL visitors see the broader audience.

---

## Pillar 3 — This moment is different from any other moment

The visitor needs to feel they're seeing something that won't be there tomorrow.

### 3.1 Drift mode (lift: small)

When the venue has <2 visitors for more than 10 minutes, it enters **drift**: pieces rotate autonomously every 90 seconds, randomly drawn from a curator-defined "drift pool." Music shifts to ambient. Lighting dims to nocturne.

The instant a third visitor enters, drift collapses back to the canonical layout. A visitor who happens to land during drift sees a private show. The dashboard exposes a "drift pool" multi-select on each piece, plus a drift settings page.

### 3.2 Generative AI piece on F5 (lift: medium)

One anchor on F5 (next to the canonical Secret) is a **regenerating piece**. Every hour, Claude generates a new image (via the dashboard hitting a model that returns image data — Replicate, fal, or a self-hosted SDXL via Modal), pulled from a hidden prompt template that incorporates: the venue's last 20 chat messages, the current weather in the curator's city, the top-of-feed Farcaster cast.

The piece is _never_ the same twice. Visitors who return get a new piece every visit. Logs the entire history; the curator can browse the gallery of past hours.

This is the closest the venue gets to a _living_ artwork.

### 3.3 Time-of-day shows (lift: small)

The venue's `templates` system (planned in `EVENT_TEMPLATES_PLAN.md`) gains a `schedule` field. The active template auto-rotates by clock:

- 06:00–10:00 — `morning-quiet` (sparse, contemplative, low-tipped music)
- 10:00–18:00 — `daylight-rotation` (the canonical show)
- 18:00–22:00 — `golden-hour` (more golds, warmer light, social pieces)
- 22:00–04:00 — `afterhours` (lightbox-heavy, frameless cutouts, club mix in `nowPlaying.stream`)

Visitors learn the rhythm. "Come back at 11pm, the venue is unrecognizable." Free retention loop.

### 3.4 Ephemeral drops at event end (lift: large)

At the end of every named event (closing bell on a curator-defined window), the **last N visitors still in the scene** get to claim a free POAP/NFT mint. The mint is gated on having been in the scene continuously for at least 20 minutes during the event window (server-side attestation via the scene posting heartbeat to a backend).

This creates real attendance value. POAPs are the simplest path; minting on Polygon is cheap.

### 3.5 Manifest-as-stage — DJ-driven anchor performance (lift: large)

During a live event, one wallet (the performer) gets a **performance UI** — a tiny web page where they can puppet specific anchors in real-time: flash lightboxes to a BPM, change which pieces are showing on the F4 wall, trigger banner drops from the F3 balcony.

The dashboard issues a one-time JWT to the performer wallet; the scene subscribes via SSE to a `/api/performance/<sessionId>` stream and applies low-latency overrides.

This turns the venue from a gallery into an **instrument**.

### 3.6 Weekly piece auction by attention (lift: medium)

Every piece accumulates "stare-seconds" — total time across all visitors that anyone has been within 3m and facing it. Weekly, the top-3 attention-getters go up for **bid** (off-chain or on, your call). Winners get either the digital piece, a print, or the right to suggest next week's hero.

The mechanic flips the script: visitors _generate_ the auction lot by paying attention. The venue auto-curates its own market.

### 3.7 Inverse vernissage — pieces age out (lift: small)

Every piece is given a `lifespan` — say 30 days. As it ages, its frame visually erodes (ink frame chips, gold frame tarnishes). At lifespan end, the piece is removed unless the curator extends it. Visitors get a _physical urgency_ to see things while they're fresh.

Pure visual treatment in the scene — manifest just stores `installedAt`; the frame primitives interpolate aging shaders by age.

### 3.8 Eclipse window (lift: small, theatrical)

Once a week, at a curator-set time, the venue runs a **5-minute eclipse**: skybox black, all music cuts, one single Lightbox in the atrium pulses to a Claude-generated short story it reads aloud. Then everything snaps back.

Visitors who happen to be there during eclipse will _talk about it for weeks_. The rarity is the feature.

---

## Pillar 4 — The venue remembers

A venue that forgets you the second you leave is a screensaver. A venue that knows you've been here three times before is a place.

### 4.1 Personal guestbook (lift: small)

Each visitor's wallet has a `/visitors/<wallet>` page on the dashboard (curator-private or public, configurable). It records: visit count, total time in scene, pieces stamped, friends overlapped with, emotes performed, POAPs claimed.

When the visitor returns, an NPC at the entrance greets them: _"Welcome back. Last time you sat with Smudge Luchador for four minutes. It's still in the corner."_

### 4.2 NPC docent powered by Claude (lift: medium, ongoing maintenance)

An avatar wanders the venue. Visitors can press E to talk. The NPC has read every piece's metadata + a curator-written "voice prompt." It carries a memory of the visitor (Pillar 1 + 4) and the venue's recent activity.

> Visitor: "What's new since last week?"
> NPC: "We swapped the F2 north wall — Jane Doe's piece moved up to the Hall of Fame. The new wall has work from a residency that finished Tuesday. Want me to walk you over?"

Claude API + a small RAG over the manifest + visitor log. Vector store optional; the manifest is small enough for full-context.

### 4.3 Layered visitor reputations (lift: medium)

The venue tracks **what kind of visitor** each wallet is, surfaced privately to the curator:

- **The Discoverer** — found N% of the secrets
- **The Patron** — tipped artists M times
- **The Drift Whisperer** — spent the most time during drift mode
- **The Crowd Bringer** — friends-of-friends overlap is high
- **The Echo** — typed first thing in chat 80% of visits

Recognition unlocks: e.g. discoverers get a Pavilion key wearable; crowd-bringers get to name a one-hour template.

### 4.4 Time capsules (lift: medium)

Once per visit, a visitor can leave a 280-character text + 1 piece-pick to a future visitor, with a delay (1 day, 1 week, 1 year). The capsule materializes for the next solo visitor after the delay, displayed as a hanging banner in atrium for 60s with the chosen piece in the lightbox below.

This is the closest a digital venue gets to a wishing well. People will leave heartfelt, weird, hostile, beautiful things.

### 4.5 The Library tab (uses the planned Books feature) (lift: small)

You're already adding a Books feature. Extend the schema: each book has a "visitor log" page that anyone can write into during a visit. A persistent journal per book. Future visitors flip through.

Suddenly the Books area is a _social object_, not a static asset. The dashboard's existing book uploader becomes the substrate for a slow-form blog.

### 4.6 Friends-of-Panel-Haus wall (lift: small)

A single wall on F1 entrance fills up over the gallery's lifetime with the PFPs of every wallet that has ever visited. Newest at top. Hover-on-PFP (using DCL hover) shows their first-visit date and total visits.

A trivial social-proof artifact that grows for free, simply by existing.

---

## Whacky tier — "we'd need to build a small platform first"

Ideas that aren't shippable next sprint but are interesting enough that putting them on paper might tilt a future decision.

### W.1 Real-world weather-coupled venue

The curator's IRL weather (or chosen anchor city) feeds the venue's mood. Rain in Brooklyn → audible rain in the atrium + glistening floor texture. Sunny → skybox brightens, lightboxes warm. Snow → particle effects on F4 stage. OpenWeather API → manifest field → scene-side ambient generators.

Why: visitors who know the curator's city become _aware of the curator as a person_. Visitors who don't will still notice "the venue feels different today."

### W.2 Cross-venue portals (lift: large, depends on partners)

Several frameless cutouts (the D-style frames already in your roster) become _literal portals_ into other DCL venues — a partner gallery, a friend's parcel, a museum's official scene. The portal renders a webcam-style live view from the destination (or a pre-rendered preview). Step through → DCL `teleportTo` to that parcel.

The venue becomes a **node in a network** instead of an island. The first venue to do this well becomes a navigation point.

### W.3 The Heartbeat Lightbox

A single hero lightbox on the atrium pulses to the **curator's real heart rate** (Apple Watch / Whoop / Fitbit HRM, polled by a small daemon → dashboard → manifest field). When the curator is calm, it's a slow throb. When they're at an event, it races.

Pure presence theater. Visitors won't always know what they're seeing, but they'll feel the room's pulse change.

### W.4 Curator's livestream of self via AudioStream + VideoTexture

The curator can flip a switch in the dashboard: "I'm live." The venue's stream URL becomes their OBS feed; a designated F4 wall becomes a VideoTexture playing their face/desk. They can talk to whoever's in the venue right now, see them via a Loom-style overlay, narrate the show. Then flip off.

Replaces the formal "event" model with **drop-in office hours**. Way more sustainable than producing a weekly show.

### W.5 Manifest-driven mini-games

Beyond the helicopter: tiny single-player mini-games triggered by anchor proximity. A balance puzzle on the skywalk. A typing speed test in the VT lobby. A music-rhythm sequence on the F4 stage. Each has a leaderboard tied to wallets.

Visitors who land bored try a game. Games convert "stand and look" to "do something." Friends compete.

### W.6 NFT-floor-driven ambient color

The accent color of the gallery is set by the median 24h floor price of a watched collection (say, Cryptopunks). Up → cooler / blue / silver. Down → warmer / red / amber. The venue becomes a _passive market signal_ visible from inside.

Bored Apes burning? The walls know. This is meta-art and visitors will love or hate it.

### W.7 Generative architecture moments

Once per day, a **fragment of the building** changes shape for an hour — a wall recedes, a stair extends, a new column appears in the atrium. Pre-baked variants in the scene; flag in the manifest picks which is active. Visitors talk about which version they saw.

The building itself becomes a content axis.

### W.8 Voice-cloned artist statements

When a visitor stands in front of a piece for 8s, they hear the artist's voice (cloned from a 30s sample via ElevenLabs or similar) speaking the statement out loud, positional audio at their head. Curator records or licenses the voice once; system reuses forever.

A piece that _speaks_ to you, in the artist's voice, when you stand at it. Cheap to build, mythical to experience.

### W.9 The bell anchor

A single E-Plinth on F3 has a literal bell. Pressing E rings it for everyone in the scene + posts to a public Discord webhook. There's a leaderboard of "who's rung the bell most." It does nothing else.

A useless, perfect mechanic. The leaderboard alone will sustain it.

### W.10 Adversarial co-curator

A second wallet (an AI agent, or a guest co-curator) has dashboard access with a single power: each day, it can replace **one piece** with a piece of its choosing. The curator can revert it the next day. The dance between human curator and adversarial co-curator becomes a visible-from-outside content stream.

If the co-curator is Claude, you can give it a personality ("you favor moody portraits"). Visitors check in to see what fight is happening this week.

### W.11 Acoustic anchors

Every anchor has an associated short audio (curator-uploaded or AI-generated from the piece description). When a visitor passes within 2m, the audio plays positionally — a single note, a whisper, a sample. Walking the gallery becomes a **chord progression** that depends on the path you take.

Each visitor scores their own walkthrough.

### W.12 The Mirror

One anchor on F1 isn't a piece — it's a near-real-time render of the visitor themselves (their avatar, posed, against the venue background). A photographic mirror. Tap it → it saves the snapshot to the visitor's guestbook + offers a tweet/cast link.

Visitors take screenshots inside DCL constantly. Build a frame that does the screenshot _for them_ and ships it.

### W.13 Whisper-to-skybox

A specific anchor with a microphone icon: speak (browser mic, scene-side mic if SDK supports) → your words appear projected across the _skybox_ for 15s, visible to everyone. Curator-moderated by a quick Claude pass for obvious abuse.

The dome of the world becomes a chat surface.

### W.14 Treasure dispersion

A daily-rotating hidden anchor (different floor each day, different time each day) gives the first visitor to find it a wearable / POAP / scrap of art. The dashboard surfaces a _hint_ — a riddle, a screenshot, a cryptic Farcaster post. Hunters return daily.

Combines: Pillar 3 (time-windowed), Pillar 4 (memory: who's found the most), discovery loop.

---

## Mini-games as venue features (separate cluster)

The pavilion helicopter is the precedent. More:

- **Pavilion bungee** off the skywalk; physics + leaderboard
- **Plinth pinball** — a multi-plinth installation where pressing E on plinths in sequence triggers a Rube Goldberg sound-and-light cascade. Curator-authored sequence; visitors discover the rhythm
- **Frame Tetris** — a hidden mini-game where the visitor can drag/snap unassigned anchor frames to walls themselves, saving to a "visitor proposals" queue the curator reviews
- **Hot or Cold** — an anchor that pulses red when you walk toward today's hidden piece and blue when you walk away. Use it to navigate to the secret of the day
- **The Echo Stair** — climb the staircase between floors; each step plays a note. Climb the right melody (changes daily) → unlocks a rare anchor on F6

Each mini-game is a 1–2-day SDK7 lift if you reuse the existing position-trigger primitives.

---

## Discovery / secrets (separate cluster)

You already have one Secret on F5. The pattern wants to expand:

- **Layered secrets** — finding Secret 1 reveals a hint about Secret 2 (banner appears on F3 only after first claim). Cascading discovery loop with 5–6 layers
- **Anti-secrets** — a piece visible to _first-time_ visitors only, never again. Newcomers feel special
- **Co-op secrets** — only revealed when two specific wallets are in the scene at once (mark a "pair" via dashboard, e.g., the curator + a featured artist)
- **Anti-helicopter** — to balance the pavilion's fast traversal, a slow-only secret that requires walking the long way around
- **Speed-run secrets** — visit all six floors in under 90 seconds → unlock a transient lightbox on F6 that lasts for the rest of your session

The point: **the venue should never feel fully mapped**. Layered secrets ensure no returning visitor ever feels like there's nothing left to find.

---

## Live event hooks (separate cluster)

Your `templates` plan + `nowPlaying` music plan combine into a **show mode**:

- **Curtain raises** — when an event template activates, the F4 stage's lightboxes go dark for 5s, then snap on with the new pieces
- **Soundcheck mode** — a pre-event template where the venue shows "doors at 8pm" countdown banners in every direction, music previews loop
- **Door count** — public visible counter at F1 entrance: "23 in attendance"
- **Performer profile pieces** — during a DJ set, the DJ's NFT collection or PFP becomes the F4 stage's central piece, auto-set when the template activates
- **Encore pieces** — the last 3 minutes of an event reveal one extra piece — the "encore" — that only attendees who stayed see
- **Afterparty drift** — when an event template's end-time passes, the venue auto-flips into a "afterparty" template (dim, ambient, fewer pieces) for the next 2 hours before reverting

Each one is a small dashboard field on a template entity. None of these are heavy lifts individually.

---

## Performance hook (the curator side)

Many of these ideas are weight on the curator. To prevent the venue from rotting:

- **Automation panel** — a dashboard tab where the curator wires up rules: "rotate F2 nightly," "drift pool = these 12 pieces," "Friday 8pm activate template `weekend`." Make the venue _self-running_ for the 90% of time the curator isn't watching
- **Activity digest** — daily email/Discord post to the curator: "yesterday: 47 visitors, 12 pieces stamped (top: Smoke Signal), 3 confessional clips left, drift mode active 4h." Closes the feedback loop and surfaces what's working
- **Outreach surface** — when a visitor returns 5+ times, the dashboard flags them; the curator can send a one-shot in-scene DM next time they're in ("hey, noticed you've been a regular — want a wearable?")

The venue is only as engaging as the curator is sustainable. These are the load-bearing tools.

---

## The "if we had a month and were brave" stack

If you could only build five of these and you wanted them to _transform_ the venue:

1. **Drift mode** (§3.1) — the venue stops being static. Smallest change with the biggest perceptual shift.
2. **Personal piece-stamping + stamps wall** (§1.4 + §4.6) — converts visiting into a verb, and the wall becomes the venue's social proof.
3. **NPC docent powered by Claude** (§4.2) — the venue gains a voice. Forgives a lot of other gaps.
4. **Time-of-day shows** (§3.3) — multiplies the venue's content by 4 without making 4× the art.
5. **Confessional plinth** (§2.3) — the venue gets a _culture_ nobody can replicate, because it's made of voices that have already been deposited.

Combine those five and the average visit goes from 90 seconds to 8 minutes, the return rate goes from ~3% to maybe 20%, and the social-share rate goes from near-zero to _occasional_.

---

## The "if we had a week" stack

If you want immediate ROI:

1. **ENS welcome lightbox** (§1.2) — half-day. Universally well-received.
2. **Friends-of-Panel-Haus wall** (§4.6) — one-day. Compounds in value daily.
3. **Time-of-day shows** (§3.3) — two days; uses the templates system already in design.
4. **Door count + activity digest** (§live + §curator) — one day. Makes the curator's job sustainable.

Four days of work for a venue that _feels_ significantly more alive.

---

## What this doc deliberately doesn't argue

- Which ideas are _correct_ — that's a curator + audience decision, not a doc decision
- Detailed implementation specs — each idea would need its own design doc when prioritized
- Cost models — most of these are cheap until they scale; scaling is a problem we'd love to have
- Decentraland SDK limits — some of these (W.1 video texture, W.4 OBS streaming) are at the edge of what SDK7 cleanly supports; we'd need a spike before committing

The brief was _whacky and intense_. The point of writing it all down is not to ship every one — it's to give us a **palette**. Pick what fits your audience this quarter, leave the rest on paper, revisit in six months when the audience has shifted.

---

## Reference

- Existing curator tools — [CURATOR_GUIDE.md](CURATOR_GUIDE.md)
- Scene-side rendering contract — [SCENE_INTEGRATION.md](SCENE_INTEGRATION.md)
- Frame primitives that all these ideas eventually call into — [FRAMES_AND_ASPECTS.md](FRAMES_AND_ASPECTS.md)
- Templates plan (Pillar 3 substrate) — [EVENT_TEMPLATES_PLAN.md](EVENT_TEMPLATES_PLAN.md)
- Music plan (substrate for Pillar 2 + 3 audio ideas) — [MUSIC_HOSTING_PLAN.md](MUSIC_HOSTING_PLAN.md)
