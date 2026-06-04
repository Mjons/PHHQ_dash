// Re-upload every manifest-referenced blob with the 1-year cache header that
// the dashboard now writes by default for new uploads. Reduces repeat-visit
// blob egress to near-zero for any HTTP-caching client.
//
// WHY THIS SCRIPT IS NEEDED
// `cacheControlMaxAge` is fixed at upload time. The 131 blobs already in our
// store (122 pieces + 9 tracks + book pages) predate the dashboard's cache-
// header fix in commit ebf2e66 and got Vercel Blob's default cache lifetime —
// which apparently was not aggressive enough to keep us under the 10GB/mo
// Hobby ceiling. This script fetches each existing blob and re-uploads it at
// the same path with `cacheControlMaxAge: 31536000`, bumping the response
// header on every cached copy going forward.
//
// WHEN TO RUN IT
// AFTER the store is unblocked (paid upgrade, or 30-day reset on 6/24/26).
// The script needs to GET each blob (~317MB total egress against your quota)
// to re-upload its bytes, so don't run it while the cap is still red.
//
// WHY NOT THE EXISTING BROWSER-CONSOLE SCRIPTS PATTERN
// Other scripts in this dir (e.g. sync-voluptechne-posters.js) paste into
// the dashboard's DevTools console and ride the curator's session auth.
// That won't work here: re-uploading via @vercel/blob requires the server
// BLOB_READ_WRITE_TOKEN, which the browser context doesn't have. This one
// runs via `node` against the live store.
//
// USAGE
//   1. Make sure BLOB_READ_WRITE_TOKEN is in .env.local (copy from Vercel
//      dashboard → project → Settings → Environment Variables).
//   2. Dry run first:
//        node scripts/repatch-blob-cache.js --dry-run
//      This lists every URL it would re-upload, no writes.
//   3. Real run:
//        node scripts/repatch-blob-cache.js
//      Re-uploads each URL. Progress logged per file. Re-runnable — if it
//      bombs mid-way, just run again (allowOverwrite handles dupes).
//
// FLAGS
//   --dry-run         List URLs, do not write.
//   --manifest=<url>  Override manifest source (default: production).
//   --concurrency=N   Parallel uploads (default: 4). Keep low to be polite
//                     to the blob API and not race the quota.

const fs = require("fs");
const path = require("path");

const MANIFEST_URL_DEFAULT = "https://phhq-dash-rkwi.vercel.app/api/manifest";
const CACHE_MAX_AGE = 31536000; // 1 year — matches dashboard upload routes
const DEFAULT_CONCURRENCY = 4;

// =========================================================================
// .env.local loader — node doesn't read this automatically the way Next.js
// does, and we don't want to depend on a runtime config library.
// =========================================================================
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] !== undefined) continue; // existing env wins
    // Strip surrounding quotes if present.
    let val = raw;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadDotEnv(path.join(__dirname, "..", ".env.local"));
loadDotEnv(path.join(__dirname, "..", ".env"));

// =========================================================================
// Arg parsing
// =========================================================================
const args = process.argv.slice(2);
const flags = {
  dryRun: false,
  manifestUrl: MANIFEST_URL_DEFAULT,
  concurrency: DEFAULT_CONCURRENCY,
};
for (const a of args) {
  if (a === "--dry-run") flags.dryRun = true;
  else if (a.startsWith("--manifest="))
    flags.manifestUrl = a.slice("--manifest=".length);
  else if (a.startsWith("--concurrency=")) {
    const n = parseInt(a.slice("--concurrency=".length), 10);
    if (Number.isFinite(n) && n > 0) flags.concurrency = n;
  } else {
    console.error(`[repatch] unknown flag: ${a}`);
    process.exit(1);
  }
}

// =========================================================================
// Main
// =========================================================================
async function main() {
  if (!flags.dryRun && !process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("[repatch] BLOB_READ_WRITE_TOKEN missing.");
    console.error("  Set it in .env.local or pass --dry-run to list only.");
    process.exit(1);
  }

  // Lazy-import @vercel/blob only when we actually need it (dry-run skips).
  const { put } = flags.dryRun ? { put: null } : require("@vercel/blob");

  console.log(`[repatch] fetching manifest from ${flags.manifestUrl}`);
  const manifestRes = await fetch(flags.manifestUrl);
  if (!manifestRes.ok) {
    console.error(`[repatch] manifest fetch failed: ${manifestRes.status}`);
    process.exit(1);
  }
  const manifest = await manifestRes.json();

  // Collect every blob URL we care about. Skip externally-hosted assets
  // (objkt, superrare, etc.) — those aren't ours to repatch.
  const urls = collectOurBlobUrls(manifest);
  console.log(
    `[repatch] found ${urls.length} URLs to repatch in v${manifest.version}`,
  );

  if (flags.dryRun) {
    for (const u of urls) console.log(`  [dry-run] would repatch ${u}`);
    console.log(`[repatch] dry run complete — no writes.`);
    return;
  }

  // Process in waves of `concurrency`. Keeps memory bounded and is polite
  // to the blob API. Each file is fetched + re-uploaded; failures logged
  // but don't abort the run (re-running is safe).
  let done = 0;
  let failed = 0;
  let skipped = 0;
  const start = Date.now();

  for (let i = 0; i < urls.length; i += flags.concurrency) {
    const wave = urls.slice(i, i + flags.concurrency);
    await Promise.all(
      wave.map(async (url) => {
        try {
          const result = await repatchOne(url, put);
          if (result === "skipped") skipped++;
          else done++;
          const idx = i + wave.indexOf(url) + 1;
          console.log(`[repatch ${idx}/${urls.length}] ${result} · ${url}`);
        } catch (e) {
          failed++;
          console.error(`[repatch] FAILED ${url}: ${e.message}`);
        }
      }),
    );
  }

  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `[repatch] done in ${elapsedSec}s · repatched=${done} skipped=${skipped} failed=${failed}`,
  );
  if (failed > 0) process.exit(2);
}

// =========================================================================
// Helpers
// =========================================================================

// Walks the manifest and collects every URL hosted on our Vercel Blob store.
// Same shape as the dashboard's blob-orphans `referencedUrls` collector —
// keep in sync if the manifest grows new blob-pointing fields.
function collectOurBlobUrls(m) {
  const set = new Set();
  const add = (u) => {
    if (!u) return;
    if (typeof u !== "string") return;
    if (!isOurBlob(u)) return;
    set.add(u);
  };
  for (const p of Object.values(m.pieces ?? {})) {
    add(p.src);
    // p.poster is also ours when curators upload posters, but most posters
    // currently point at SR's imgix — isOurBlob filters non-ours out.
    add(p.poster);
  }
  for (const s of m.series ?? []) {
    add(s.cover);
    for (const ep of s.episodes ?? []) {
      add(ep.frontCover);
      add(ep.backCover);
      for (const page of ep.pages ?? []) add(page);
    }
  }
  for (const t of Object.values(m.tracks ?? {})) add(t.src);
  return [...set];
}

function isOurBlob(url) {
  try {
    const u = new URL(url);
    return u.host.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

// Fetch one blob's bytes, then re-upload at the same path with the new
// cache header. Returns "repatched" on success, "skipped" if the blob no
// longer exists (404), throws on other errors.
async function repatchOne(url, put) {
  const u = new URL(url);
  const pathname = u.pathname.replace(/^\//, ""); // "pieces/foo.png" not "/pieces/foo.png"

  const res = await fetch(url);
  if (res.status === 404) return "skipped";
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status}`);
  }
  const contentType =
    res.headers.get("content-type") || guessContentType(pathname);
  const arrayBuffer = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);

  await put(pathname, buf, {
    access: "public",
    contentType,
    allowOverwrite: true,
    cacheControlMaxAge: CACHE_MAX_AGE,
  });

  return "repatched";
}

function guessContentType(pathname) {
  const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
  const map = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    ogg: "audio/ogg",
    oga: "audio/ogg",
  };
  return map[ext] || "application/octet-stream";
}

main().catch((e) => {
  console.error(`[repatch] fatal: ${e.stack || e.message}`);
  process.exit(1);
});
