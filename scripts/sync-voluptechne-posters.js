// Sync poster URLs onto Voluptechne residency pieces that are already in the
// live manifest. Additive only — never overwrites a poster that's already set
// (so dashboard edits win over this script).
//
// USAGE: open the dashboard in a logged-in tab → DevTools → Console → paste
// this file → Enter. Re-runnable: add more entries to POSTERS as you collect
// them and re-paste; only the missing posters get applied.
//
// To get a poster URL for an objkt token:
//   https://assets.objkt.media/file/assets-003/<CONTRACT>/<TOKEN_ID>/social
// For SuperRare, grab the og:image <meta> tag from the artwork page source.

(async () => {
  const POSTERS = {
    "vt4-body-mapping-ii":
      "https://assets.objkt.media/file/assets-003/KT1UXZ8HF2aEHhYrYvAmArD5QGjBq61qCFPc/67/social",
    // Same objkt /social pattern as Body Mapping II, token 68 instead of 67.
    "vt4-proof-of-palm":
      "https://assets.objkt.media/file/assets-003/KT1UXZ8HF2aEHhYrYvAmArD5QGjBq61qCFPc/68/social",
    // SuperRare og:image stills (1.91:1 — letterboxed inside the square frame).
    // NOTE: assumed order — swap these two if the wrong artwork shows up on
    // the wrong piece.
    "vt4-body-mapping":
      "https://superrare-artworks.imgix.net/asset/f4f481fdb011b96d445177e2f1061c6bc13c1b8eb1f2954bb229b4376e22878a.jpeg?ixlib=js-3.8.0&auto=compress&quality=100&dpr=2&cs=origin&w=800&h=418&fm=jpg&fit=crop&s=ad045a51f5e20b67097f55e1e8b612e9",
    "vt4-voluptechne-video":
      "https://superrare-artworks.imgix.net/asset/88009d8cec646f743aed80141dda9b216bb25c51924adbd1e794db071fd67ebe.jpeg?ixlib=js-3.8.0&auto=compress&quality=100&dpr=2&cs=origin&w=800&h=418&fm=jpg&fit=crop&s=449c56c3fac1f83fab0c8426f4411b88",
  };

  console.log("[posters] fetching live manifest…");
  const getRes = await fetch("/api/manifest", { cache: "no-store" });
  if (!getRes.ok) throw new Error(`GET /api/manifest: ${getRes.status}`);
  const manifest = await getRes.json();

  const applied = [];
  const skippedMissing = [];
  const skippedExisting = [];
  const nextPieces = { ...manifest.pieces };
  for (const [id, posterUrl] of Object.entries(POSTERS)) {
    const piece = nextPieces[id];
    if (!piece) {
      skippedMissing.push(id);
      continue;
    }
    if (piece.poster) {
      skippedExisting.push(id);
      continue;
    }
    nextPieces[id] = { ...piece, poster: posterUrl };
    applied.push(id);
  }

  if (applied.length === 0) {
    console.log("[posters] nothing to do.", {
      skippedMissing,
      skippedExisting,
    });
    return;
  }

  console.log("[posters] applying to:", applied);
  if (skippedMissing.length)
    console.log("[posters] piece id not in manifest:", skippedMissing);
  if (skippedExisting.length)
    console.log(
      "[posters] poster already set, leaving alone:",
      skippedExisting,
    );

  const postRes = await fetch("/api/manifest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...manifest, pieces: nextPieces }),
  });
  if (!postRes.ok) {
    const text = await postRes.text();
    throw new Error(`POST /api/manifest: ${postRes.status} ${text}`);
  }
  const saved = await postRes.json();
  console.log(`[posters] done · manifest v${saved.version}`);
})();
