"use client";

import { useState } from "react";
import { fetchManifest, saveManifest } from "@/lib/client";
import type { PieceT } from "@/schema/manifest";

// Curator-only. Promotes a Q5 comic submission into the manifest's `pieces`
// collection so it can then be chosen on an anchor via the piece-picker. Does
// the same read-modify-write the Pieces page does (fetchManifest → merge →
// saveManifest); saveManifest POSTs to the curator-gated /api/manifest.
//
// `pieceId` is computed server-side (submissionPieceId) and passed in so this
// client component doesn't import the redis-backed lib/submissions module.

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Measure a cross-origin image's width/height ratio. naturalWidth/Height are
// readable for cross-origin images without CORS (only canvas pixel reads taint),
// so no crossOrigin attribute is needed.
function measureAspect(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      if (h > 0 && Number.isFinite(w / h)) resolve(w / h);
      else reject(new Error("could not read image dimensions"));
    };
    img.onerror = () => reject(new Error("could not load comic image"));
    img.src = url;
  });
}

type State = "idle" | "working" | "done" | "error";

export default function AddToPiecesButton({
  pieceId,
  wallet,
  dclName,
  comicUrl,
  added,
}: {
  pieceId: string;
  wallet: string;
  dclName: string;
  comicUrl: string;
  added: boolean;
}) {
  const [state, setState] = useState<State>(added ? "done" : "idle");
  const [msg, setMsg] = useState("");

  async function onAdd() {
    setState("working");
    setMsg("");
    try {
      const aspect = Number((await measureAspect(comicUrl)).toFixed(4));
      const manifest = await fetchManifest();

      if (manifest.pieces[pieceId] && state !== "done") {
        if (
          !confirm(
            `A piece "${pieceId}" already exists. Overwrite it with this submission?`,
          )
        ) {
          setState("idle");
          return;
        }
      }

      const piece: PieceT = {
        id: pieceId,
        src: comicUrl,
        aspect,
        preferredFrame: "A",
        title: dclName || `Resident ${shortenAddress(wallet)}`,
        tags: ["resident-submission"],
        batch: "submissions",
        ...(dclName ? { artist: dclName } : {}),
      };

      await saveManifest({
        ...manifest,
        pieces: { ...manifest.pieces, [pieceId]: piece },
      });
      setState("done");
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  if (state === "done") {
    return (
      <span className="inline-flex items-center gap-2 text-[11px]">
        <span className="font-black uppercase tracking-widest text-green-700">
          ✓ In pieces
        </span>
        <a
          href="/pieces"
          className="border-2 border-ink bg-cream px-2 py-1 font-bold uppercase tracking-widest hover:bg-gold"
        >
          Open pieces →
        </a>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onAdd}
        disabled={state === "working"}
        className="border-2 border-ink bg-gold px-2 py-1 text-[11px] font-black uppercase tracking-widest text-ink hover:bg-gold-light disabled:opacity-50"
      >
        {state === "working" ? "Adding…" : "Add to pieces"}
      </button>
      {state === "error" && (
        <span className="text-[11px] font-bold text-red-700">{msg}</span>
      )}
    </span>
  );
}
