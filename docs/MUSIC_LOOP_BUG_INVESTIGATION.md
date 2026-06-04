# Music — "loops the first ~6s then jumps to next track" investigation

**Reported:** 2026-05-25 — venue music is restarting every few seconds and then
jumping to the next track instead of playing a track end-to-end.

**TL;DR:** the bug is almost certainly on the **scene** side (Decentraland repo
at `c:\Users\unrea\AppData\Roaming\creator-hub\Scenes\Panel Haus Party`), not in
this dashboard. The dashboard's job is just to publish `nowPlaying` +
`playbackStartedAt` to Redis. The scene is what tears down and recreates the
`AudioStream`, and that's where a short, repeating "first few seconds then
switch" pattern can come from.

The two most likely root causes, ranked:

1. **Ungated `applyNowPlaying`** — the scene calls it on every manifest poll
   instead of only when the hash changes, so the `AudioStream` gets torn down
   and re-created every poll cycle. Each rebuild restarts the track from `0:00`.
2. **Bad `durationSec` on the uploaded tracks** — `probeDuration` returned a
   small number (e.g. 6) at upload time, and the scene's playlist advance
   `setTimeout` therefore fires after 6s for every track.

Read past the TL;DR for evidence and a triage plan.

---

## Where playback actually happens

This dashboard repo only contains:

- The `Track` / `NowPlaying` schema — [schema/manifest.ts:151-184](../schema/manifest.ts#L151-L184).
- The curator UI — [app/music/music-view.tsx](../app/music/music-view.tsx).
- The manifest writer — [app/api/manifest/route.ts](../app/api/manifest/route.ts).
- The DJ-booth skip endpoint — [app/api/manifest/skip/route.ts](../app/api/manifest/skip/route.ts).

The actual `AudioStream` component lives in the scene repo. The contract for
how it's supposed to behave is in
[docs/archive/MUSIC_SCENE_HANDOFF.md](archive/MUSIC_SCENE_HANDOFF.md), and the relevant code
sketch is at [archive/MUSIC_SCENE_HANDOFF.md:79-173](archive/MUSIC_SCENE_HANDOFF.md#L79-L173).

The scene reads `playbackStartedAt` and computes "which track at what offset"
locally every poll — recent commit `786e2d3 music: scene-driven playlist sync
via playbackStartedAt + skip endpoint`.

---

## Hypothesis 1 — Scene re-applies on every poll (most likely)

The handoff doc explicitly warns:

> Important: only call `applyNowPlaying(manifest)` when the relevant fields
> actually change. Otherwise every poll tears down and rebuilds the
> AudioStream — the curator hears stutter every few seconds.
> ([archive/MUSIC_SCENE_HANDOFF.md:187](archive/MUSIC_SCENE_HANDOFF.md#L187))

The contract relies on `lastNowPlayingHash` gating ([archive/MUSIC_SCENE_HANDOFF.md:189-205](archive/MUSIC_SCENE_HANDOFF.md#L189-L205)).

Two ways the scene-side implementation could still misfire after that
commit:

- **Hash includes elapsed time.** If the scene computed the hash as something
  like `JSON.stringify(nowPlaying) + ":" + currentIndex` and the
  `currentIndex` calculation drifts every tick (e.g. it's deriving from
  `Date.now() - playbackStartedAt` and floor-dividing wrong), the hash flips
  on every poll → teardown → rebuild → audio restarts from 0:00.
- **Hash gate omitted entirely.** Easy to do during the playbackStartedAt
  refactor; the gate from the original handoff might have been removed when
  the new sync logic was added.

**Why this matches "loops the first ~6 seconds":** the dashboard's manifest
GET has `cache-control: public, max-age=10, stale-while-revalidate=60`
([app/api/manifest/route.ts:41](../app/api/manifest/route.ts#L41)). If the
scene polls every ~6s and bypasses the cache (the scene fetcher probably
sends `cache: "no-store"`, like our own [scripts/sync-voluptechne-posters.js](../scripts/sync-voluptechne-posters.js)
does), every poll = a fresh `applyNowPlaying` call = tear down +
re-create the `AudioStream` = first few seconds of audio re-buffer and play
again. When the scene poll happens to cross a track boundary, the next
recreated stream is the next track — so "loops then switches."

### Fix sketch (scene repo)

In `src/scene/audio/venue-audio.ts`, gate by a hash that captures only the
"identity" of the current segment, never the elapsed offset:

```ts
function nowPlayingFingerprint(m: ManifestT): string {
  const np = m.nowPlaying;
  if (np.kind !== "playlist") {
    // off / stream / single-track — JSON of nowPlaying is enough
    return JSON.stringify(np);
  }
  // playlist: include the resolved current track id + loop flag + tracks-key
  // list (so adding/removing tracks restarts), but NOT the elapsed offset.
  const order = playlistOrder(m);
  const idx = currentIndexFromStartedAt(m, order);
  return `pl:${order[idx]?.id ?? ""}:${np.loop}:${order.map((t) => t.id).join(",")}`;
}
```

Then in the poll handler:

```ts
const fp = nowPlayingFingerprint(m);
if (fp !== lastFingerprint) {
  applyNowPlaying(m);
  lastFingerprint = fp;
}
```

This is the single change most likely to resolve the symptom. The
"start mid-track" math (so a late joiner doesn't restart the song from
0:00) is a separate problem — see Hypothesis 3 below.

---

## Hypothesis 2 — `durationSec` is being stored as a tiny number

The scene advances the playlist via `setTimeout(advancePlaylist, durationSec * 1000)`
because SDK7's `AudioStream` has no `ended` event
([archive/MUSIC_SCENE_HANDOFF.md:155-158](archive/MUSIC_SCENE_HANDOFF.md#L155-L158)). If
`durationSec` is e.g. 6 instead of the real 246, the advance fires after 6s
on every track.

`durationSec` is set client-side at upload time by
[app/music/music-view.tsx:24-41](../app/music/music-view.tsx#L24-L41):

```ts
function probeDuration(file: File): Promise<number | null> {
  ...
  audio.preload = "metadata";
  audio.onloadedmetadata = () => {
    const d = Number.isFinite(audio.duration) ? audio.duration : null;
    ...
  };
  ...
}
```

This is sound for well-formed files, but:

- **VBR MP3 without an Xing header** — Chrome returns `Infinity` for
  `audio.duration` on `loadedmetadata`. The guard drops it to `null` (good),
  so the scene would fall back to the 10-minute default — not 6s.
- **MP4/M4A with bad `moov` atom** — sometimes reports a tiny duration.
  Plausible, especially if the file was transcoded oddly.
- **Browser cached `metadata` from an earlier partial fetch** — rare.

### Triage (do this first, takes 30 seconds)

Open [/music](../app/music/music-view.tsx) in the dashboard and read the
duration column on each track row
([music-view.tsx:797](../app/music/music-view.tsx#L797)). If any track shows
`0:06` or similar — that's the smoking gun. Re-probe and patch:

1. In the dashboard, click the file's `<audio controls>` element. The browser
   shows the real total duration in the control. If it's correct but
   `durationSec` in the manifest is wrong, re-upload, or write a one-off
   server patch that probes with `ffprobe` on the Blob URL.
2. If we want a belt-and-braces guard against this in the future:
   server-side re-probe in the POST handler when `durationSec` is missing or
   suspiciously small (`< 15s` for a track flagged as music is almost
   certainly wrong).

---

## Hypothesis 3 — playbackStartedAt-driven sync starts every track at 0:00

Less likely to be the symptom-cause but worth flagging because it interacts
with H1.

The scene now computes "current track at what offset" from
`Date.now() - playbackStartedAt`
([schema/manifest.ts:237-244](../schema/manifest.ts#L237-L244)). But SDK7's
`AudioStream` has **no seek API** — you can set `playing: true/false`, that's
it. So even though the scene knows "we should be 47s into track 2," it can
only spawn the stream from 0:00.

Two consequences:

- A late joiner hears track 2 from the beginning instead of mid-track. That's
  a UX deviation from the handoff's "in lockstep" promise but is not the
  reported bug.
- If the scene's `setTimeout` for advancing is scheduled at the **full**
  `durationSec * 1000` (instead of `(durationSec - currentOffset) * 1000`),
  late joiners will overshoot the playlist's intended schedule. That causes
  drift, not a 6s loop.

This is a contract gap, not a fix. Document the limitation in
[archive/MUSIC_SCENE_HANDOFF.md](archive/MUSIC_SCENE_HANDOFF.md) and accept it for v1, or
ship the `(durationSec - currentOffset)` setTimeout correction.

---

## Hypothesis 4 — Server is rewriting `playbackStartedAt` too often

Checked and ruled out. The dashboard only rewrites `playbackStartedAt` when
`modeSignature` changes
([app/api/manifest/route.ts:12-23](../app/api/manifest/route.ts#L12-L23),
[app/api/manifest/route.ts:75-80](../app/api/manifest/route.ts#L75-L80)).
`modeSignature` is `kind:trackId` / `playlist` / `stream:url` / `off`. So
gain edits, loop toggles, and library additions all keep the timestamp
stable. The skip endpoint deliberately rewrites it
([app/api/manifest/skip/route.ts:139-145](../app/api/manifest/skip/route.ts#L139-L145)),
but only on `next`/`prev` clicks.

---

## Recommended action

Do these in order; stop when the bug stops.

1. **Open `/music` on the dashboard** and confirm `durationSec` looks right on
   every track. If a track reports `0:06`, jump to Hypothesis 2's triage —
   re-probe or re-upload. Cheap and decisive.
2. **In the scene repo**, open `src/scene/audio/venue-audio.ts` and confirm
   the `lastNowPlayingHash` gate is intact and doesn't include the elapsed
   offset. Replace with the fingerprint sketch in Hypothesis 1.
3. **Add a one-line console log in the scene** at the top of
   `applyNowPlaying` (`console.log("[venue-audio] applyNowPlaying", reason)`)
   and confirm in the DCL preview console that it fires only on real mode
   changes, not on every poll. Remove the log once verified.
4. If we still see the symptom: add a server-side ffprobe fallback in the
   manifest POST handler so bogus `durationSec` values get auto-corrected.

If we want to harden the dashboard against (2) regardless, the minimum is a
"this track is shorter than 15 seconds — are you sure?" guard on the upload
panel, plus a "re-probe duration" button on each library row.
