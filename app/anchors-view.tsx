"use client";

import { useEffect, useState } from "react";
import {
  AREA_LABEL,
  AREA_ORDER,
  FRAME_LABEL,
  type AnchorT,
  type ManifestT,
  type PieceT,
} from "@/schema/manifest";
import { fetchManifest, saveManifest } from "@/lib/client";

export default function AnchorsView() {
  const [manifest, setManifest] = useState<ManifestT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  useEffect(() => {
    fetchManifest()
      .then(setManifest)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <p className="text-coral font-bold">Failed to load manifest: {error}</p>
      </div>
    );
  }
  if (!manifest) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <p className="text-muted">Loading…</p>
      </div>
    );
  }

  const pieces = Object.values(manifest.pieces);
  const byArea = new Map<string, AnchorT[]>();
  for (const a of manifest.anchors) {
    const list = byArea.get(a.area) ?? [];
    list.push(a);
    byArea.set(a.area, list);
  }

  async function updateAnchor(anchorId: string, newPieceId: string | null) {
    if (!manifest) return;
    const next: ManifestT = {
      ...manifest,
      anchors: manifest.anchors.map((a) =>
        a.id === anchorId ? { ...a, pieceId: newPieceId } : a,
      ),
    };
    setSavingFor(anchorId);
    setError(null);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      setSavedToast(`Saved · v${saved.version}`);
      setTimeout(() => setSavedToast(null), 1800);
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingFor(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-7 py-8 pb-24">
      <div className="flex items-end justify-between pb-4 border-b-2 border-ink mb-7">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-wide">
            Anchors
          </h1>
          <p className="text-muted text-sm mt-1">
            {manifest.anchors.length} hang-points · {pieces.length} pieces · v
            {manifest.version}
          </p>
        </div>
      </div>

      {AREA_ORDER.filter((k) => byArea.has(k)).map((area) => {
        const anchors = byArea.get(area)!;
        return (
          <section key={area} className="mb-9">
            <h2 className="inline-block bg-ink text-cream px-3.5 py-1.5 text-sm font-black uppercase tracking-widest mb-3">
              {AREA_LABEL[area]}{" "}
              <span className="bg-gold text-ink px-2 py-0.5 rounded-xl text-[11px] ml-2">
                {anchors.length}
              </span>
            </h2>
            <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(380px,1fr))]">
              {anchors.map((a) => (
                <AnchorCard
                  key={a.id}
                  anchor={a}
                  pieces={pieces}
                  saving={savingFor === a.id}
                  onChange={(newPieceId) => updateAnchor(a.id, newPieceId)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {manifest.anchors.length === 0 && <EmptyState />}

      {savedToast && (
        <div className="fixed bottom-6 right-6 bg-ink text-cream px-5 py-3 border-[3px] border-gold font-bold uppercase tracking-widest text-sm shadow-[4px_4px_0_var(--color-ink)]">
          ✓ {savedToast}
        </div>
      )}
    </div>
  );
}

function AnchorCard({
  anchor,
  pieces,
  saving,
  onChange,
}: {
  anchor: AnchorT;
  pieces: PieceT[];
  saving: boolean;
  onChange: (newPieceId: string | null) => void;
}) {
  const piece = pieces.find((p) => p.id === anchor.pieceId);
  const isEmpty = !piece;
  const frameKey = anchor.allowedFrames?.[0] ?? "A";

  return (
    <article className="bg-cream border-[3px] border-ink p-3.5 grid grid-cols-[88px_1fr] gap-3.5 shadow-[4px_4px_0_var(--color-ink)] relative">
      <div
        className={`border-2 border-ink relative overflow-hidden flex items-center justify-center ${
          isEmpty
            ? "bg-[repeating-linear-gradient(45deg,var(--color-cream-dark)_0_8px,var(--color-cream)_8px_16px)]"
            : "bg-cream-dark"
        }`}
        style={{ width: 88, height: 88 }}
      >
        {isEmpty ? (
          <span className="text-[10px] font-black tracking-widest text-muted">
            EMPTY
          </span>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={piece.src}
              alt={piece.title || piece.id}
              className="max-w-full max-h-full object-contain"
              style={{ imageRendering: "auto" }}
            />
            <span className="absolute top-0.5 left-0.5 bg-gold text-ink font-black text-[10px] px-1 border border-ink">
              {frameKey}
            </span>
          </>
        )}
      </div>
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="font-mono text-sm font-bold">{anchor.id}</div>
        {anchor.note && (
          <div className="text-xs italic text-muted truncate">
            {anchor.note}
          </div>
        )}
        <div className="text-[11px] font-mono text-muted">
          {anchor.allowedFrames?.map((f) => (
            <span
              key={f}
              className="inline-block bg-cream-dark border border-muted px-1.5 mr-1"
            >
              {f}·{FRAME_LABEL[f]}
            </span>
          ))}
          <span className="inline-block bg-cream-dark border border-muted px-1.5">
            {anchor.maxWidth}×{anchor.maxHeight}m
          </span>
        </div>
        <select
          value={anchor.pieceId ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={saving}
          className="font-sans text-sm font-semibold p-1.5 border-2 border-ink bg-cream mt-1 focus:outline-none focus:ring-2 focus:ring-gold disabled:opacity-50"
        >
          <option value="">— empty —</option>
          {pieces.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title || p.id}
              {p.artist ? ` — ${p.artist}` : ""}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}

function EmptyState() {
  return (
    <div className="border-2 border-dashed border-muted p-12 text-center text-muted">
      <p className="font-bold text-lg uppercase tracking-widest mb-2">
        No anchors yet
      </p>
      <p className="text-sm">
        Capture anchors in-scene with the anchor-capture tool, then paste the
        JSON on the{" "}
        <a href="/import" className="text-coral underline font-bold">
          Import
        </a>{" "}
        page.
      </p>
    </div>
  );
}
