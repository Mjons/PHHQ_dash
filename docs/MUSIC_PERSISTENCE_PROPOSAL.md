# Music — Persistence Across Visits (Proposal)

**Date:** 2026-05-26
**Status:** superseded — concrete scene-side patches now live in the scene repo at [MUSIC_WITHIN_TRACK_SYNC_PLAN.md](file:///c:/Users/unrea/AppData/Roaming/creator-hub/Scenes/Panel%20Haus%20Party/MUSIC_WITHIN_TRACK_SYNC_PLAN.md). This doc remains for context on the dashboard side; the actual implementation work happens against `src/scene/audio/venue-audio.ts` per the scene plan.
**Companion to:** [MUSIC_LOOP_BUG_INVESTIGATION.md](MUSIC_LOOP_BUG_INVESTIGATION.md), [MUSIC_SCENE_HANDOFF.md](MUSIC_SCENE_HANDOFF.md)

---

## Corrections after reading the current scene code

- The scene already has a stable hash gate (`musicHash` in [src/scene/audio/venue-audio.ts](file:///c:/Users/unrea/AppData/Roaming/creator-hub/Scenes/Panel%20Haus%20Party/src/scene/audio/venue-audio.ts) keys on `nowPlaying + playbackStartedAt + sortedTrackIds`). **Hypothesis 1 is already addressed** in the existing implementation; the "every 6s" symptom, if still observed, is more likely related to bad `durationSec` data (Hypothesis 2) than to poll-rebuild churn.
- The scene's "full-tracks-from-zero" is an **explicit, documented design decision** (see scene repo's MUSIC_UX_AUDIT.md §3.2, §5), not an oversight. This proposal asks the curator to flip that trade-off.
- The dashboard side has no work to do. `playbackStartedAt` is already published correctly and the scene has all the math it needs.

---

## The new requirement

> When a visitor leaves the plot and comes back, the music should keep
> playing where it left off. It should not restart from `0:00` every time.

---

## Decisions baked into this proposal

So the doc is a build plan, not a checklist of questions:

1. **Scene-only change.** Dashboard already publishes `playbackStartedAt`; the
   scene has all the math it needs locally. No new routes, no schema bump.
2. **Finished non-looping mode → silent.** A single track with `loop: false`
   that has elapsed past its duration, or a playlist with `loop: false` that
   has elapsed past its total, returns no audio. Restarting from the top on
   visitor return would feel arbitrary; the curator can pick a new mode if
   they want sound again.
3. **Live streams are unaffected.** `kind: "stream"` is continuous by
   contract; the persistence question doesn't apply.
4. **Sub-second offsets clamp to zero.** Anything below ~1s starts the track
   from the top to avoid hairline re-buffers and keep URLs stable.

---

## Why this is a distinct problem

Two "restart" failure modes can both look like "music keeps resetting":

| Failure mode                                                                          | Trigger                                                                                                                                                                                                                                                                                                               | Where the fix lives                     |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **A. Stays in scene, rebuilds AudioStream on every poll**                             | Hash gate in scene-side `applyNowPlaying` is missing or includes the elapsed offset (Hypothesis 1 in the investigation).                                                                                                                                                                                              | Scene repo — fix the fingerprint.       |
| **B. Truly leaves scene, scene unloads, comes back, AudioStream re-spawns at `0:00`** | DCL fully tears down a scene's module state once the player wanders far enough; on re-entry the module re-runs and all in-memory state (`playlistIndex`, `lastNowPlayingHash`, advance timers) reinitializes. SDK7 `AudioStream` has **no seek API**, so the new stream starts at the beginning of the current track. | Scene repo — needs an offset mechanism. |

Mode A is what the existing investigation already addresses. Mode B is the
new ask. They're orthogonal — fixing A doesn't fix B, and vice versa. The
build plan ships both, in order.

---

## What we already have on the dashboard

Persistence-of-position data is **already published**. The manifest carries
`playbackStartedAt` ([schema/manifest.ts:237-244](../schema/manifest.ts#L237-L244)),
set server-side only when the mode signature changes
([app/api/manifest/route.ts:75-80](../app/api/manifest/route.ts#L75-L80)). From
that anchor, any client can compute "what track should be playing right now,
and how many seconds into it we are" — purely locally, no extra round-trips.

So the dashboard has done its half. The piece that's missing is **the scene
acting on the computed offset** when it spawns the `AudioStream`. The handoff
doc anticipated this gap (Hypothesis 3 in the investigation), and v1 shipped
without it.

---

## Triage first — which failure mode is in play?

10 minutes of work, decides everything that follows. Drop both of these into
the scene repo:

1. At the top of the scene's entry point (`src/index.ts` or wherever
   `engine.addSystem`/`onStart` runs), log a one-shot console line:
   ```ts
   console.log("[scene] entry-point run", Date.now());
   ```
2. At the top of `applyNowPlaying`, log:
   ```ts
   console.log("[venue-audio] applyNowPlaying", reason, Date.now());
   ```

Then in the DCL preview:

- Stand inside the venue with music playing.
- Walk **two parcels away** and wait ~20 seconds.
- Walk back.
- Watch the preview console.

Diagnostic key:

| What you see                                                                                                                 | Means                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry-point line fires **again** on return.                                                                                  | Scene was fully unloaded → **Mode B**. Persistence needs offset injection.                                                                               |
| Entry-point line only fires once, but `applyNowPlaying` fires repeatedly while you're outside.                               | Scene stayed warm but hash gate is broken → **Mode A**. Fix the fingerprint per the existing investigation.                                              |
| Entry-point line only fires once, `applyNowPlaying` only fires on real mode changes, **but audio still restarts on return**. | Something subtler — probably the `AudioStream` itself unloads when the player exits its broadcast radius, even with the scene warm. Treat as **Mode B**. |

---

## The Mode B fix — HTML5 Media Fragments

The HTML5 spec lets any media URL carry a `#t=N` fragment that asks the
underlying player to start playback `N` seconds in:

```
https://...blob.vercel-storage.com/tracks/ambient-01.mp3#t=47.3
```

Browser-native `<audio>` honors this. Vercel Blob serves HTTP Range requests
(it has to — that's how `<audio>` seeks), so the underlying byte fetch pulls
the right segment. The unknown is whether DCL's `AudioStream` component
passes the fragment through to its playback engine or strips it first.

### The decisive 10-minute experiment

In the scene repo, temporarily hard-code:

```ts
AudioStream.create(host, {
  url: "https://samplelib.com/lib/preview/mp3/sample-15s.mp3#t=10",
  playing: true,
  volume: 0.7,
});
```

If you hear playback start ~10 seconds in instead of from the top, fragments
work — proceed to the implementation below. If it starts from `0:00`,
fragments are stripped — fall through to "If the experiment fails."

### Implementation (scene-only, if the experiment passes)

One helper resolves "what should be playing right now" from the manifest,
encoding the "stay silent on finish" decision in its return type. Everything
else flows from it.

```ts
// src/scene/audio/venue-audio.ts
type Resolved =
  | { kind: "off" }
  | { kind: "stream"; streamUrl: string }
  | {
      kind: "track";
      track: TrackT;
      offset: number; // seconds from track start
      remainingSec: number; // seconds until natural end (ignored if loop=true)
      loop: boolean;
    }
  | {
      kind: "playlist";
      track: TrackT;
      index: number;
      offset: number;
      remainingSec: number;
      loop: boolean;
    };

function resolvePlayback(m: ManifestT): Resolved {
  const np = m.nowPlaying;
  if (np.kind === "off") return { kind: "off" };
  if (np.kind === "stream") return { kind: "stream", streamUrl: np.streamUrl };

  const elapsed = Math.max(
    0,
    (Date.now() - new Date(m.playbackStartedAt).getTime()) / 1000,
  );

  if (np.kind === "track") {
    const t = m.tracks[np.trackId];
    if (!t?.durationSec) return { kind: "off" };
    if (!np.loop && elapsed >= t.durationSec) return { kind: "off" };
    const offset = np.loop ? elapsed % t.durationSec : elapsed;
    return {
      kind: "track",
      track: t,
      offset,
      remainingSec: t.durationSec - offset,
      loop: np.loop,
    };
  }

  // playlist
  const order = playlistOrder(m);
  if (order.length === 0) return { kind: "off" };
  const total = order.reduce((s, t) => s + (t.durationSec ?? 600), 0);
  if (total <= 0) return { kind: "off" };
  if (!np.loop && elapsed >= total) return { kind: "off" };

  const into = np.loop ? elapsed % total : elapsed;
  let cum = 0;
  for (let i = 0; i < order.length; i++) {
    const d = order[i].durationSec ?? 600;
    if (into < cum + d) {
      return {
        kind: "playlist",
        track: order[i],
        index: i,
        offset: into - cum,
        remainingSec: d - (into - cum),
        loop: np.loop,
      };
    }
    cum += d;
  }
  return { kind: "off" };
}

function withOffset(src: string, offset: number): string {
  // Sub-second seeks are jitter; clamp to 0 to avoid hairline re-buffers
  // and keep the URL stable so the AudioStream identity doesn't churn.
  if (!Number.isFinite(offset) || offset < 1) return src;
  return `${src}#t=${offset.toFixed(2)}`;
}
```

The mode switch becomes one branch per `Resolved` kind:

```ts
let currentTimer: ReturnType<typeof setTimeout> | null = null;

export function applyNowPlaying(m: ManifestT) {
  if (currentTimer) {
    clearTimeout(currentTimer);
    currentTimer = null;
  }
  if (AudioStream.has(host)) AudioStream.deleteFrom(host);

  const r = resolvePlayback(m);
  if (r.kind === "off") return;

  if (r.kind === "stream") {
    AudioStream.create(host, {
      url: r.streamUrl,
      playing: true,
      volume: 0.7,
    });
    return;
  }

  if (r.kind === "track") {
    AudioStream.create(host, {
      url: withOffset(r.track.src, r.offset),
      playing: true,
      loop: r.loop,
      volume: gainToVolume(r.track.gainDb),
    });
    if (!r.loop) {
      // For non-looping single tracks we don't *need* a timer (the AudioStream
      // just plays out and stops), but if we want to react cleanly to natural
      // end — e.g., to clear the entity so a future mode flip doesn't fight
      // a phantom stream — schedule cleanup at remainingSec.
      currentTimer = setTimeout(
        () => {
          if (AudioStream.has(host)) AudioStream.deleteFrom(host);
        },
        Math.max(1000, r.remainingSec * 1000),
      );
    }
    return;
  }

  // playlist — advance at the *natural* end of the current track, not
  // durationSec later, so re-entering mid-track doesn't desync the schedule.
  AudioStream.create(host, {
    url: withOffset(r.track.src, r.offset),
    playing: true,
    loop: false,
    volume: gainToVolume(r.track.gainDb),
  });
  currentTimer = setTimeout(
    () => applyNowPlaying(m),
    Math.max(1000, r.remainingSec * 1000),
  );
}
```

Note the playlist-advance path: instead of incrementing a module-level
`playlistIndex` and starting the next track manually, it just **re-runs
`applyNowPlaying(m)`** when the current track is supposed to end. The next
call re-resolves from `playbackStartedAt`, so the new track and its offset
fall out of the same math. That removes `playlistIndex` from module state
entirely — which means scene reloads, mode flips, and natural advances all
take the same path and there's no per-visit index to drift.

### What this gives us

- Visitor leaves, scene unloads → on return, `applyNowPlaying` resolves to
  the right track and offset, the new `AudioStream` spawns mid-track.
- Late joiners (visitor arrives 10 minutes into a residency set) drop into
  the same point as everyone else. This closes Hypothesis 3's contract gap.
- Non-looping playlist that ran past its end → silent. Non-looping single
  track that ran past its duration → silent.
- Mode `stream` and mode `off` are unchanged.

### Risks

- DCL's audio backend on **mobile clients** has historically lagged the
  desktop client on media-spec compliance. Fragments may work in the desktop
  preview but not on the mobile native client. Verify on both before
  declaring done.
- If a track's `durationSec` is wrong (Hypothesis 2 in the investigation —
  bad probe data), offsets compound the error. Fix duration probing as a
  prerequisite, or the resolver lands on quicksand.

### If the experiment fails

If `#t=N` is stripped by `AudioStream`, the lowest-honest move is to **accept
the limitation and document it** in
[MUSIC_SCENE_HANDOFF.md](MUSIC_SCENE_HANDOFF.md):

> Returning visitors and late joiners enter at the right **track** (computed
> from `playbackStartedAt`) but always at `0:00` of that track. SDK7
> `AudioStream` exposes no seek API, so mid-track resume isn't possible
> without a server-side proxy.

A server-side seek proxy is the alternative — a new `/api/track/[id]?t=<sec>`
route that range-reads from Blob and re-streams from the requested time.
Doing this correctly requires re-encoding (VBR MP3 byte offset ≠ time
offset), which means `ffmpeg` per request: more CPU, more latency, more
serverless surface area. Not recommended unless the persistence UX gets
escalated.

---

## What this proposal does NOT touch

- **Hypothesis 1 from the investigation doc** (poll-time AudioStream
  rebuild) — that's a real bug and the dominant cause of the "every 6s"
  symptom. It needs to be fixed regardless of the persistence work. The two
  are orthogonal and can ship independently.
- **`durationSec` probe correctness** (Hypothesis 2). The resolver's
  accuracy depends on correct durations. Triage that first per the existing
  doc.
- **Volume ducking when the player walks far away.** Out of scope — venue
  audio is global by design.
- **Multi-listener sync across clients.** Already handled by
  `playbackStartedAt`; persistence-across-visits inherits the same
  guarantee.

---

## Sequence

1. **Triage**: run the entry-point + `applyNowPlaying` logging experiment.
   Confirm whether the symptom is Mode A, Mode B, or both.
2. **Fix Hypothesis 1 in the scene** (hash fingerprint) regardless — it's
   the dominant cause of the reported "every 6s" issue and lands cheaply.
3. **Run the 10-minute Media Fragment experiment** in the scene repo.
   - If it passes → implement the resolver above. Single scene-side PR.
     Verify on desktop **and** mobile preview clients before declaring done.
   - If it fails → document the limitation in
     [MUSIC_SCENE_HANDOFF.md](MUSIC_SCENE_HANDOFF.md) and stop.
4. Update [MUSIC_SCENE_HANDOFF.md](MUSIC_SCENE_HANDOFF.md) with the shipped
   stance so future agents inherit the right contract.
