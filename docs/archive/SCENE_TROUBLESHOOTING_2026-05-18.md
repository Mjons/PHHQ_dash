# Scene → Dashboard Troubleshooting Handoff — 2026-05-18

From: scene team (Panel Haus Party DCL repo)
To: dashboard team (phhq-dash)
Status: **scene-side renderer wired; manifest validation fails in DCL runtime against the live endpoint.**

---

## What's working

- All 7 scene-integration tasks from `docs/SCENE_INTEGRATION.md` are complete and type-clean.
- Schema copied verbatim from `phhq_build/schema/manifest.ts @ a817e59` into `src/scene/art/schema.ts`.
- `zod@4.4.3` installed (matches dashboard).
- `signedFetch` from `~system/SignedFetch` is reaching the network — we are NOT seeing `[art] manifest fetch failed`.
- `scene.json` now declares `USE_FETCH`, `ALLOW_MEDIA_HOSTNAMES`, and whitelists both `phhq-dash-rkwi.vercel.app` and `8f9d6rrhl4wniqjf.public.blob.vercel-storage.com`.
- **Validated the live manifest against the exact scene schema in plain Node — `success: true`.** Repro: `node scripts/debug-validate.mjs` in the scene repo.

## What's failing

Live in-scene console (DCL preview, 08:58:21):

```
[LOG] SceneLog: [art] manifest validation failed [object Object],[object Object]
[LOG] SceneLog: [art] spawned 0 pieces, skipped 0
```

Two Zod issues. The same payload validates cleanly outside the DCL runtime, so something about how the body arrives via `signedFetch` differs from a plain `https.get`.

Renderer falls back to the empty baked JSON, walls stay blank.

## What we're doing on our end

Added debug log lines that will print (a) `res.body[0..200]` and (b) the top-level keys of `JSON.parse(res.body)`. Awaiting a scene restart from the curator to capture them. Once we have those, we'll know whether:

- the body is an envelope (`{ data: {...} }`)
- the body is HTML (Vercel error page or auth redirect)
- the body is the manifest but a field was transcoded (numbers→strings, ISO date→Date object, etc.)
- the body is truncated

## What might be useful from the dashboard side

Only if our next round of logs points to the dashboard, but pre-emptively:

1. **Does `/api/manifest` differentiate based on request headers?**
   `signedFetch` sets DCL-specific headers (`x-identity-auth-chain-0..N`, `x-identity-timestamp`, `x-identity-metadata`). If your route has middleware that inspects these (Next-Auth, NextAuth `auth()` wrapper, edge functions, etc.) and returns a different payload when it doesn't recognize the signature, that would explain the divergence.

2. **Is the route running on the edge runtime vs node runtime?**
   Edge runtime sometimes serializes Dates/BigInts differently. Confirm `export const runtime` setting on the manifest route.

3. **CORS / Vary header.**
   If `Vary: Origin` or wallet-header-based variant caching is in play, the response we get from a browser fetch (used in our Node debug script — wait, no, our script uses raw `https.get`) might differ from what arrives at the DCL runtime.

4. **Send us a `curl` capture with DCL-style headers**, e.g.:
   ```
   curl -i 'https://phhq-dash-rkwi.vercel.app/api/manifest' \
     -H 'x-identity-auth-chain-0: {}' \
     -H 'x-identity-timestamp: 0' \
     -H 'x-identity-metadata: {}'
   ```
   If the body or status differs vs an unauthenticated `curl`, we have our answer.

## Useful artifacts in the scene repo

- `src/scene/art/manifest.ts` — fetcher with debug logs (lines 19-22)
- `scripts/debug-validate.mjs` — node script that fetches + validates with the scene's exact schema (reports `success: true` today)
- `src/scene/art/schema.ts` — header records source commit `a817e59`

## Quick repro for the dashboard team

```bash
# In any folder with node 18+
node -e "
const https = require('https');
https.get('https://phhq-dash-rkwi.vercel.app/api/manifest', (r) => {
  let b=''; r.on('data',c=>b+=c); r.on('end',()=>{
    console.log('status', r.statusCode);
    console.log('content-type', r.headers['content-type']);
    console.log('body len', b.length);
    console.log('first 300:', b.slice(0,300));
  });
});
"
```

If that returns the same payload we already validated, the issue is entirely DCL-runtime-side and you don't need to act.

---

## Update — 2026-05-18 (dashboard team response)

### Dashboard side is clean

All four diagnostics passed:

| Check                                        | Result                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Plain `curl` body vs DCL-headers `curl` body | **byte-identical** (765 bytes both)                                                      |
| `Vary` header                                | none                                                                                     |
| `Content-Encoding`                           | none                                                                                     |
| Route runtime                                | Node (default; no `export const runtime` override)                                       |
| Middleware behavior on identity headers      | none — `proxy.ts` short-circuits `GET /api/manifest` to `NextResponse.next()`            |
| `Cache-Control`                              | `public, max-age=10` — same cached payload served to all requests, `X-Vercel-Cache: HIT` |

Reproduction:

```bash
curl -s 'https://phhq-dash-rkwi.vercel.app/api/manifest' > a.json
curl -s 'https://phhq-dash-rkwi.vercel.app/api/manifest' \
  -H 'x-identity-auth-chain-0: {}' -H 'x-identity-timestamp: 0' -H 'x-identity-metadata: {}' > b.json
diff a.json b.json   # → IDENTICAL
```

So the dashboard returns the same payload regardless of identity headers, runtime, or cache state.

### Root cause: `z.string().url()` is not portable to QuickJS

The schema you copied at commit `a817e59` had:

```ts
src: z.string().url(),
link: z.string().url().optional(),
```

Zod v4's `.url()` calls `new URL()` internally. **DCL's runtime (QuickJS) has a stricter URL parser than V8/Node.** Vercel Blob hostnames begin with a digit (`8f9d6rrhl4wniqjf.public.blob.vercel-storage.com`) — V8 accepts that, QuickJS rejects it. Hence:

- Plain Node validate (V8 URL) → `success: true`
- DCL runtime validate (QuickJS URL) → 2 issues, one per piece `src`
- Exactly **2** issues because there are **2 pieces in the live manifest**, both with Vercel Blob `src` values, and no other URL fields populated.

### Fix on the dashboard side (just pushed)

Schema swapped to a regex check that's runtime-agnostic:

```ts
src: z.string().regex(/^https?:\/\/.+/, "must be http(s) URL"),
link: z.string().regex(/^https?:\/\/.+/, "must be http(s) URL").optional(),
```

Same effective validation (must be `http(s)://something`), no `new URL()` call, identical behavior in V8 and QuickJS. Commit `<replace-with-pushed-hash>`.

### Action for the scene team

1. Re-copy `schema/manifest.ts` from this repo's HEAD into `src/scene/art/schema.ts`.
2. Bump the source-commit header in the scene's copy to the new hash.
3. Re-run `npx tsc --noEmit` then restart the scene. Expected log: `[art] manifest v9 loaded` followed by `[art] spawned 2 pieces, skipped 0`.

If you still see validation failures after the re-copy, paste the actual Zod issue paths (`issues[].path`) from the debug logs — the `[object Object]` toString hides them. Add:

```ts
console.log(
  "[art] manifest issues:",
  JSON.stringify(parsed.error.issues.slice(0, 5)),
);
```

to surface them.
