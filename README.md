# Panel Haus / Curator Dashboard

Curator dashboard for the [Panel Haus](https://decentraland.org) Decentraland venue. The dashboard writes a JSON **manifest** that the scene fetches at load time to know which art hangs where.

See the scene repo for the design docs that drive this project:

- `DASHBOARD_PLAN.md` — overall v1 scope
- `DASHBOARD_HANDOFF.md` — the contract between this repo and the scene
- `ANCHOR_CAPTURE_PLAN.md` — how anchors get into the manifest
- `ART_PIPELINE_PLAN.md` — how the scene consumes the manifest

## Architecture in 60 seconds

```
Curator ─► Dashboard (this repo) ─► Upstash Redis (manifest JSON) ─► Scene fetches on load
```

- **Auth:** NextAuth v5 Credentials provider, single password (`CURATOR_PASSWORD`).
- **Storage:** Upstash Redis via Vercel Marketplace. One key: `panelhaus:manifest:v1`.
- **API:**
  - `GET /api/manifest` — public, no auth. The scene calls this.
  - `POST /api/manifest` — auth required. Curator saves the whole manifest.
  - `POST /api/import` — auth required. Merges in-scene anchor capture JSON.
- **UI:** `/` (Anchors list), `/map` (placeholder for the rotated floor map, ports from the HTML mockup later), `/import` (paste capture JSON).

## v1 scope

What ships:

- ✅ Auth (Credentials, password gate)
- ✅ Manifest CRUD (GET public, POST gated)
- ✅ Anchor capture import endpoint
- ✅ Anchors list UI (group by area, dropdown to swap piece)
- ✅ Import UI (paste JSON, preview, submit)
- ⬜ Floor map UI with click-to-place (porting from `dashboard-mockup.html` in scene repo — next pass)
- ⬜ Pieces upload UI + Vercel Blob (v2)
- ⬜ Scene State form — livestream URL, music, events, theme (v2)

## Local development

### 1. Install

```bash
npm install
```

### 2. Configure env

```bash
cp .env.local.example .env.local
```

Then fill in:

- `AUTH_SECRET` — random 32-byte string. Generate: `openssl rand -base64 32` (or any random source).
- `CURATOR_PASSWORD` — your chosen password.
- `CURATOR_EMAIL` — optional, shown in the top bar.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` — copy from your Vercel project's env vars after the Upstash Redis integration is added.

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in with `CURATOR_PASSWORD`.

## Deployment

### One-time Vercel setup

1. Import this repo into Vercel.
2. **Storage tab** → add **Upstash Redis** (or any Redis from the Marketplace). Vercel auto-injects the env vars.
3. **Settings → Environment Variables**: add `AUTH_SECRET`, `CURATOR_PASSWORD`, `CURATOR_EMAIL`.
4. Push to `main` → Vercel deploys.

### After every save

Snapshot the live manifest into the scene repo's baked fallback **before** every scene deploy:

```bash
curl https://<your-project>.vercel.app/api/manifest > <scene-repo>/src/scene/art/manifest.baked.json
```

(Or, in the scene repo's `package.json`, add a `prebuild` script that does this automatically.)

## Schema

The single source of truth for the dashboard ⇄ scene contract is [`schema/manifest.ts`](./schema/manifest.ts). When that file changes, copy it into the scene repo at `src/scene/art/schema.ts` and bump the commit hash in that file's header comment. See `DASHBOARD_HANDOFF.md` in the scene repo for the full rules.

## Stack

- Next.js 16 (App Router, no `src/` dir)
- React 19
- TypeScript
- Tailwind v4
- Zod 4 (schema validation, source of truth for the manifest shape)
- NextAuth v5 / Auth.js (Credentials provider)
- Upstash Redis (manifest storage)
