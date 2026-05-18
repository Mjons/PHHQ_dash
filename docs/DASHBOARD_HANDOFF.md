# Dashboard ↔ Scene Handoff Contract

The single document both repos hold to. Companion to [DASHBOARD_PLAN.md](DASHBOARD_PLAN.md) and [ART_PIPELINE_PLAN.md](ART_PIPELINE_PLAN.md).

## Why this exists

Once the dashboard lives in its own repo, the scene and dashboard are two systems that must agree on shape. Without a written contract, either side can drift — a renamed field, a units change, a different enum — and the failure mode is "art doesn't appear in the scene and nobody knows why." This doc is the agreement. Edit it deliberately; commit changes to both sides whenever it changes.

---

## The four promises

### 1. Manifest URL location

- **Scene side:** one env var `MANIFEST_URL`. Read at scene-load time, no other place hard-codes it.
- **Dashboard side:** ships a single public endpoint `GET /api/manifest` returning the full manifest JSON. No auth on read.
- **Default value in scene:** `https://panelhaus-dashboard.vercel.app/api/manifest` (or whatever your final Vercel project URL is).
- **Override mechanism:** local `.env` for staging or testing against a different dashboard deploy.

### 2. Shared schema

- The single source of truth is `schema/manifest.ts` in the **dashboard** repo (Zod types).
- Sync to the **scene** repo by **copy-paste**, with a header comment recording the source commit:

```ts
// SYNC: copied from panelhaus-dashboard/src/schema/manifest.ts @ <commit-hash>
// Do not edit in-place — change in the dashboard repo, then re-copy here.
import { z } from "zod";
// ...
```

- **Why copy-paste, not npm package:** one file, one consumer on each side. A package adds version-pinning, publishing, and registry overhead for zero benefit at this scale. Revisit if a third consumer ever appears.
- **When schema changes:** bump the commit hash in the comment, copy fresh, run typecheck on both sides.

### 3. Coord system (the load-bearing promise)

This is the one that, if violated, makes nothing work. **The dashboard's anchor coordinates ARE the scene's coordinates.** No translation layer.

```
anchor.x  (manifest)  ==  centerPos.x  (FRAMES[k]({ centerPos, … }))
anchor.z  (manifest)  ==  centerPos.z
anchor.facing         ==  Facing argument to the frame primitive
```

- Units are **scene-local meters**. Origin (0, 0) is the SW corner of the scene's parcel footprint.
- `anchor.area` (`'f1' | 'f2' | … | 'vt2' | … | 'atrium'`) determines the **Y baseline** the scene applies. The scene owns this mapping:

```ts
// scene side — single source of truth for floor-y mapping
const FLOOR_BASE_Y: Record<Area, number> = {
  f1: 0,
  f2: 12,
  f3: 22,
  f4: 31,
  f5: 47,
  vt2: 12,
  vt3: 20,
  vt4: 28,
  vt5: 36,
  vt6: 44,
  atrium: 12,
  skywalk: 35,
};
```

- `anchor.facing` is `'N' | 'E' | 'S' | 'W'`, identical to the existing `Facing` type in [frames.ts:13](src/scene/art/frames.ts#L13). Same values mean the same directions.
- **The dashboard map renders these coords with a 180° visual rotation. The manifest values are NEVER rotated.** The rotation is a render-side affordance; the data on disk is raw scene coords.

If the dashboard ever wants to store something _other_ than scene coords (e.g., parcel-relative), this contract is broken and the doc must be updated first.

### 4. Baked fallback

- The scene ships with a baked snapshot at `src/scene/art/manifest.baked.json`.
- On any failure to fetch or parse the live manifest, the scene falls back to the baked one. **The scene never spawns empty.**
- Refresh the bake before every scene deploy:

```bash
curl https://panelhaus-dashboard.vercel.app/api/manifest > src/scene/art/manifest.baked.json
```

- Add this as `prebuild` in `package.json` once it's annoying to do manually.

---

## Error contract (scene-side)

What the scene does when the manifest is unreachable or wrong:

| Failure                             | Scene behavior                     |
| ----------------------------------- | ---------------------------------- |
| Network error / timeout (>5s)       | Use baked, log a warning           |
| HTTP non-200                        | Use baked, log status code         |
| Empty body                          | Use baked, log "empty manifest"    |
| `JSON.parse` throws                 | Use baked, log "malformed JSON"    |
| Zod validation fails                | Use baked, log first 3 Zod issues  |
| Anchor references missing piece     | Skip that anchor (no crash)        |
| Piece `src` URL fails to load       | Skip that anchor at render time    |
| Anchor `area` not in `FLOOR_BASE_Y` | Skip that anchor, log unknown area |

**The scene never crashes on bad manifest data.** Worst case is fewer pieces appear than the dashboard advertises — visible to the curator, recoverable.

---

## Versioning

- Manifest carries `version: number`, monotonic, bumped on every dashboard save.
- Scene logs the version + fetch latency on load. Useful for support: "I just saved v89, what does the scene see?"
- **Breaking schema changes** follow this order:
  1. Ship scene code that accepts both old and new shapes (Zod `.or()` or a fallback parser).
  2. Bump dashboard to write the new shape.
  3. Once all scene clients have rolled the new code (week or two), drop the legacy parser.

---

## Scene-side fetch — concrete sketch

What the scene actually does. Replace pseudocode with this file when wiring up:

```ts
// src/scene/art/manifest.ts
import { signedFetch } from "~system/SignedFetch";
import { Manifest } from "./schema"; // ← copied from dashboard repo
import BAKED_MANIFEST from "./manifest.baked.json";

const MANIFEST_URL = "https://panelhaus-dashboard.vercel.app/api/manifest";
const FETCH_TIMEOUT_MS = 5000;

export async function loadManifest(): Promise<Manifest> {
  try {
    const res = await Promise.race([
      signedFetch({ url: MANIFEST_URL, init: { method: "GET" } }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), FETCH_TIMEOUT_MS),
      ),
    ]);
    if (!res.body) throw new Error("empty body");
    const parsed = Manifest.safeParse(JSON.parse(res.body));
    if (!parsed.success) {
      console.warn(
        "[art] manifest validation failed",
        parsed.error.issues.slice(0, 3),
      );
      return BAKED_MANIFEST as Manifest;
    }
    console.log(`[art] manifest v${parsed.data.version} loaded`);
    return parsed.data;
  } catch (e) {
    console.warn("[art] manifest fetch failed, using baked", e);
    return BAKED_MANIFEST as Manifest;
  }
}
```

And the consumer in `buildArtwork()` (per [ART_PIPELINE_PLAN.md](ART_PIPELINE_PLAN.md)) reads `anchor.x`, `anchor.z`, `anchor.area`, `anchor.facing` exactly — no coord adjustment, no rotation.

---

## What this doc does NOT cover

- Dashboard internals (auth, KV layout, UI) → [DASHBOARD_PLAN.md](DASHBOARD_PLAN.md).
- Scene-side anchor data structures and frame selection → [ART_PIPELINE_PLAN.md](ART_PIPELINE_PLAN.md).
- How anchor positions get into the manifest in the first place → [ANCHOR_CAPTURE_PLAN.md](ANCHOR_CAPTURE_PLAN.md).

Keep this file short. If it grows, it's drifting into one of the above.
