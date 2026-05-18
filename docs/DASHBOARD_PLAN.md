# Curator Dashboard

A Next.js web app on Vercel that lets you swap art (and later livestream URLs, music tracks, scheduled events) without touching code. The scene fetches a JSON manifest at load and renders accordingly. Companion to [ART_PIPELINE_PLAN.md](ART_PIPELINE_PLAN.md), [DASHBOARD_HANDOFF.md](DASHBOARD_HANDOFF.md), and [ANCHOR_CAPTURE_PLAN.md](ANCHOR_CAPTURE_PLAN.md).

## v1 scope (build this, defer the rest)

**Ship first:** Anchors view + Map view + the manifest API. That's the workflow you'd actually use weekly, and it's the minimum that proves the dashboard→scene round-trip works end-to-end. Bootstrap the initial anchor data via [ANCHOR_CAPTURE_PLAN.md](ANCHOR_CAPTURE_PLAN.md) — walk the venue, capture, import — so v1 doesn't have to also solve "how do I type 30 anchor positions by hand."

**Defer to v2 (after v1 is proven):**

- Pieces upload UI (Vercel Blob integration, batch organization) — for v1, pre-seed pieces in the manifest manually or via a one-time script.
- Scene State form (livestream URL, music playlist, events, theme).
- Floor map SVG editor / drag-to-move anchors (the mockup shows it; not critical for v1).
- Scheduled rotations, alumni tags, multi-curator auth.

The single coord-system promise and the manifest shape from [DASHBOARD_HANDOFF.md](DASHBOARD_HANDOFF.md) stay the same across v1 → v2, so deferred features slot in without rework.

## Why bother

The art pipeline already makes swaps cheap _in code_ — three lines and you're done. That's still:

- open editor
- edit `anchors.ts`
- `npm run start` to preview
- redeploy

For weekly+ rotation that's a real tax, and you can't curate from your phone. A dashboard collapses the loop to: open URL → pick image → save. The scene picks it up on next load. No git, no editor, no deploy.

---

## TL;DR — the pipeline

```
┌────────────────┐   ┌──────────────────┐   ┌──────────────────┐   ┌────────────────┐
│ Curator (you)  │──▶│ Dashboard        │──▶│ Manifest store   │──▶│ Scene fetches  │
│ any browser    │   │ Next.js + Vercel │   │ Vercel KV +      │   │ on load via    │
│                │   │                  │   │ Vercel Blob      │   │ signedFetch    │
└────────────────┘   └──────────────────┘   └──────────────────┘   └────────────────┘
```

- **Dashboard** — Next.js app, one curator logs in, edits pieces + anchors.
- **Manifest** — JSON object in Vercel KV, mirrors the in-scene shape from [ART_PIPELINE_PLAN.md](ART_PIPELINE_PLAN.md).
- **Images** — uploaded to Vercel Blob, public HTTPS URLs land in the manifest.
- **Scene** — `signedFetch`es the manifest at startup, baked fallback if anything's off.

Lives in its own repo / Vercel project, separate from the scene. The two only talk over the manifest URL.

---

## Stack

| Piece          | Choice                                      | Why                                                                          |
| -------------- | ------------------------------------------- | ---------------------------------------------------------------------------- |
| Frontend + API | **Next.js 14** (App Router) on **Vercel**   | Free tier, deploys on `git push`, API routes co-located with UI.             |
| Manifest store | **Vercel KV** (Redis-backed)                | Instant reads/writes, no schema migrations, simple key per environment.      |
| Image hosting  | **Vercel Blob**                             | Public HTTPS + permissive CORS by default — both mandatory for DCL textures. |
| Auth           | **NextAuth** email magic link, allowlisted  | One curator, nothing to leak, free.                                          |
| Schema         | **Zod**, shared file copied into both repos | Same parser on dashboard form and scene-side fetch.                          |
| Styling        | Tailwind + shadcn/ui                        | Tables, dialogs, forms — boring, fast, no design work.                       |

Alternatives considered: committing JSON to a GitHub repo for free versioning (slow round-trip, eats API quota), Supabase (overkill — there's no relational data), Firebase (vendor lock + extra console). Keep KV for live state; if you want history, snapshot weekly via a cron route.

---

## Manifest schema

The dashboard and scene must agree on a shape. Define it once with Zod, copy the file into both repos:

```ts
// schema/manifest.ts (shared verbatim)
import { z } from "zod";

export const FrameKind = z.enum(["A", "B", "C", "D", "E", "F"]);
export const Facing = z.enum(["N", "E", "S", "W"]);

export const Piece = z.object({
  id: z.string(),
  src: z.string().url(),
  aspect: z.number().positive(),
  preferredFrame: FrameKind,
  artist: z.string().optional(),
  title: z.string().optional(),
  link: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
});

export const Anchor = z.object({
  id: z.string(),
  area: z.enum(["f1", "f2", "f3", "f4", "f5", "vt", "atrium", "skywalk"]),
  centerPos: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  maxWidth: z.number().positive(),
  maxHeight: z.number().positive(),
  facing: Facing,
  allowedFrames: z.array(FrameKind).optional(),
  pieceId: z.string().nullable(),
  note: z.string().optional(),
});

export const Manifest = z.object({
  version: z.number(), // monotonic, bumped on every save
  updatedAt: z.string(), // ISO timestamp
  pieces: z.record(Piece),
  anchors: z.array(Anchor),
});
```

`version` lets the scene cache the manifest and only re-render anchors when it changes (later optimization). `updatedAt` is just for the curator's eyes.

---

## Dashboard UI — the minimum that's useful

Three screens. Build the first one; add the others when you actually want them.

1. **Anchors view (MVP).** One row per anchor: thumbnail of current piece, dropdown of every available piece, save button (or auto-save). This is **80% of the value** — most rotation is "put piece X on wall Y."
2. **Pieces view.** Upload image → Vercel Blob → form for title/artist/aspect/preferredFrame → saves to manifest. Click an existing piece to edit metadata or replace the image.
3. **Floor map (later).** Top-down SVG of the scene with anchor markers; click a marker to edit. Pure ergonomics — defer until the table view feels painful.

What to skip in v1: scheduled rotations, draft/publish modes, multi-curator, audit log, undo. Add when you've felt the absence — most never will be needed.

---

## Scene-side integration

A `loadManifest()` step that runs before `buildArtwork()`:

```ts
// src/scene/art/manifest.ts
import { signedFetch } from "~system/SignedFetch";
import { Manifest } from "./schema";
import { BAKED_MANIFEST } from "./manifest.baked";

const MANIFEST_URL = "https://panelhaus-dashboard.vercel.app/api/manifest";

export async function loadManifest(): Promise<Manifest> {
  try {
    const res = await signedFetch({
      url: MANIFEST_URL,
      init: { method: "GET" },
    });
    if (!res.body) throw new Error("empty body");
    return Manifest.parse(JSON.parse(res.body));
  } catch (e) {
    console.warn("[art] manifest fetch failed, using baked fallback", e);
    return BAKED_MANIFEST;
  }
}
```

**The baked fallback is non-negotiable.** If Vercel is asleep, the manifest is malformed, or the dashboard repo dies, the scene still spawns the last known good art. Two ways to keep it fresh:

- **Manual snapshot:** `curl <manifest-url> > assets/manifest.baked.json` whenever you do a scene deploy.
- **Auto snapshot:** a tiny `prebuild` script in `package.json` that fetches the live manifest into `manifest.baked.json` before bundling. Now every scene deploy ships with the freshest fallback.

I'd start manual, switch to auto once it's annoying.

---

## Auth — single curator

NextAuth + Email provider, allowlist your email in the write routes:

```ts
// app/api/manifest/route.ts
import { auth } from "@/auth";

export async function GET() {
  return Response.json(await getManifest()); // public read
}

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.email !== process.env.CURATOR_EMAIL) {
    return new Response("Forbidden", { status: 403 });
  }
  // validate + write
}
```

Reads stay public (the scene needs them; the manifest is non-sensitive). Writes are gated. To add a co-curator later, swap the equality check for an `includes`.

---

## What this unlocks beyond art

Once the manifest exists, every other "thing that changes in the scene" can ride the same plumbing. One schema field + one form input per feature:

| Field                       | Replaces                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `livestream.activeSrc`      | The `LIVE` entry in `VIDEO_TRACKS` (see [LIVESTREAM_PLAN.md](LIVESTREAM_PLAN.md)).           |
| `livestream.offlineMessage` | "Back at 8pm" copy when the stream is dark.                                                  |
| `music.playlist`            | Track list the DJ booth cycles through.                                                      |
| `events.next`               | `{ title, startsAt, link }` shown on a kiosk near spawn.                                     |
| `theme.palette`             | Seasonal palette swaps without touching `PALETTE` in [constants.ts](src/scene/constants.ts). |

Compounds fast. Resist adding them until you need them — empty fields rot.

---

## Gotchas

- **`signedFetch` only.** Plain `fetch` works in some SDK versions but isn't the supported path; stick with `signedFetch` from `~system/SignedFetch`.
- **HTTPS only, no exceptions.** Mixed-content requests get blocked silently. Vercel handles this — just never put `http://` in the manifest.
- **Cold starts.** Vercel serverless functions can take 1–2 s to wake. The manifest route is read-heavy — set `export const revalidate = 60` and let the edge cache serve it. Writes invalidate the cache.
- **Don't block the scene.** If the fetch is slow, load the baked manifest first and apply the fresh one when it arrives. A 2 s lag for first scene load is fine; a 10 s blank scene because Vercel napped is not.
- **No realtime updates.** Visitors already in-scene won't see your changes until they reload. If you want push updates, that's a Decentraland Comms broadcast on save — defer until needed.
- **Image cache.** Vercel Blob URLs include a hash, so a new upload always gets a new URL. **Never reuse the same URL** for a different image — clients will serve the stale one for hours.
- **Schema drift.** When you add a required field, ship the scene update _first_ with a default, then update the dashboard to start writing the field. Otherwise old scene clients explode on new manifests.
- **Vercel Blob retention.** Free tier has limits (1 GB at the time of writing). Delete blobs when you delete a piece — write a `DELETE /api/pieces/:id` that removes both the manifest entry and the blob.

---

## What I'd build first

1. **Day 1:** Scaffold a Next.js app, deploy to Vercel, wire NextAuth email login. One protected page that says "logged in as you." End-to-end auth done in two hours.
2. **Day 2:** Vercel KV setup. `GET /api/manifest` returns whatever's in KV (seed it with the current in-scene anchors). `POST /api/manifest` validates with Zod and writes. Test with `curl`.
3. **Day 3:** Anchors table UI. One row per anchor, dropdown of pieces, save button. **This alone justifies the project** — past this point you're already saving real time.
4. **Day 4:** Wire scene to fetch the manifest + baked fallback. Verify offline behavior by stopping the Vercel deploy. Snapshot manifest into baked JSON on every scene deploy.
5. **Later:** Pieces upload page. Floor map view. Livestream + music + events fields. A schedule field that auto-rotates pieces by date.

After day 4 you're swapping art in 30 seconds from your phone. Everything past that is polish or expansion onto adjacent scene state.
