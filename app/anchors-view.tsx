"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AREA_LABEL,
  AREA_ORDER,
  FRAME_LABEL,
  type AnchorT,
  type FacingT,
  type ManifestT,
  type PieceT,
} from "@/schema/manifest";
import { fetchManifest, saveManifest } from "@/lib/client";
import {
  parseTagsInput,
  passesTagFilter,
  tagsToInput,
  type TagFilterState,
} from "@/lib/tags";
import { TagList } from "./_components/tag-chip";
import { TagFilterBar } from "./_components/tag-filter-bar";
import { PiecePicker } from "./_components/piece-picker";

const NUDGE_STEP = 0.25;
const FACING_CYCLE: FacingT[] = ["N", "E", "S", "W"];
const nextFacing = (f: FacingT): FacingT =>
  FACING_CYCLE[(FACING_CYCLE.indexOf(f) + 1) % FACING_CYCLE.length];

export default function AnchorsView() {
  const [manifest, setManifest] = useState<ManifestT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<TagFilterState>({});
  const [pickerForAnchorId, setPickerForAnchorId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    fetchManifest()
      .then(setManifest)
      .catch((e) => setError(String(e)));
  }, []);

  const allTags = useMemo(() => {
    if (!manifest) return [] as string[];
    const seen = new Map<string, string>();
    for (const a of manifest.anchors)
      for (const t of a.tags ?? []) {
        const k = t.toLowerCase();
        if (!seen.has(k)) seen.set(k, t);
      }
    for (const p of Object.values(manifest.pieces))
      for (const t of p.tags ?? []) {
        const k = t.toLowerCase();
        if (!seen.has(k)) seen.set(k, t);
      }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [manifest]);

  function effectiveTags(a: AnchorT): string[] {
    if (!manifest) return a.tags ?? [];
    const fromAnchor = a.tags ?? [];
    const piece = a.pieceId ? manifest.pieces[a.pieceId] : undefined;
    const fromPiece = piece?.tags ?? [];
    if (fromPiece.length === 0) return fromAnchor;
    const seen = new Set(fromAnchor.map((t) => t.toLowerCase()));
    const merged = [...fromAnchor];
    for (const t of fromPiece) {
      if (!seen.has(t.toLowerCase())) {
        merged.push(t);
        seen.add(t.toLowerCase());
      }
    }
    return merged;
  }

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
  const visibleAnchors = manifest.anchors.filter((a) =>
    passesTagFilter(effectiveTags(a), tagFilter),
  );
  const byArea = new Map<string, AnchorT[]>();
  for (const a of visibleAnchors) {
    const list = byArea.get(a.area) ?? [];
    list.push(a);
    byArea.set(a.area, list);
  }

  async function patchAnchor(anchorId: string, patch: Partial<AnchorT>) {
    if (!manifest) return;
    const next: ManifestT = {
      ...manifest,
      anchors: manifest.anchors.map((a) =>
        a.id === anchorId ? { ...a, ...patch } : a,
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

  async function deleteAnchor(anchorId: string) {
    if (!manifest) return;
    if (!confirm(`Delete anchor "${anchorId}"? This cannot be undone.`)) return;
    const next: ManifestT = {
      ...manifest,
      anchors: manifest.anchors.filter((a) => a.id !== anchorId),
    };
    setSavingFor(anchorId);
    setError(null);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      setSavedToast(`Deleted "${anchorId}" · v${saved.version}`);
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

      <TagFilterBar
        allTags={allTags}
        filter={tagFilter}
        onChange={setTagFilter}
        label="Filter anchors by tag"
        visibleCount={visibleAnchors.length}
        totalCount={manifest.anchors.length}
      />

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
                  pieceTags={
                    a.pieceId ? (manifest.pieces[a.pieceId]?.tags ?? []) : []
                  }
                  saving={savingFor === a.id}
                  onPatch={(patch) => patchAnchor(a.id, patch)}
                  onDelete={() => deleteAnchor(a.id)}
                  onOpenPicker={() => setPickerForAnchorId(a.id)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {manifest.anchors.length === 0 && <EmptyState />}
      {manifest.anchors.length > 0 && visibleAnchors.length === 0 && (
        <div className="border-2 border-dashed border-muted p-12 text-center text-muted">
          <p className="font-bold uppercase tracking-widest mb-2">
            No anchors match the current filter
          </p>
          <p className="text-sm">
            Clear the filter bar above to see all {manifest.anchors.length}{" "}
            anchors.
          </p>
        </div>
      )}

      {savedToast && (
        <div className="fixed bottom-6 right-6 bg-ink text-cream px-5 py-3 border-[3px] border-gold font-bold uppercase tracking-widest text-sm shadow-[4px_4px_0_var(--color-ink)]">
          ✓ {savedToast}
        </div>
      )}

      {pickerForAnchorId &&
        (() => {
          const target = manifest.anchors.find(
            (a) => a.id === pickerForAnchorId,
          );
          if (!target) return null;
          return (
            <PiecePicker
              pieces={pieces}
              currentPieceId={target.pieceId}
              anchorAspect={target.maxWidth / target.maxHeight}
              onClose={() => setPickerForAnchorId(null)}
              onPick={(pieceId) => {
                void patchAnchor(target.id, { pieceId });
                setPickerForAnchorId(null);
              }}
            />
          );
        })()}
    </div>
  );
}

function AnchorCard({
  anchor,
  pieces,
  pieceTags,
  saving,
  onPatch,
  onDelete,
  onOpenPicker,
}: {
  anchor: AnchorT;
  pieces: PieceT[];
  pieceTags: string[];
  saving: boolean;
  onPatch: (patch: Partial<AnchorT>) => void;
  onDelete: () => void;
  onOpenPicker: () => void;
}) {
  const piece = pieces.find((p) => p.id === anchor.pieceId);
  const isEmpty = !piece;
  const frameKey = anchor.allowedFrames?.[0] ?? "A";
  const [editingTags, setEditingTags] = useState(false);
  const [tagsInput, setTagsInput] = useState("");

  function startEditTags() {
    setTagsInput(tagsToInput(anchor.tags));
    setEditingTags(true);
  }

  function commitTags() {
    const next = parseTagsInput(tagsInput);
    const current = anchor.tags ?? [];
    const same =
      next.length === current.length &&
      next.every((t, i) => t.toLowerCase() === current[i]?.toLowerCase());
    setEditingTags(false);
    if (!same) onPatch({ tags: next.length ? next : undefined });
  }

  return (
    <article className="bg-cream border-[3px] border-ink p-3.5 grid grid-cols-[88px_1fr] gap-3.5 shadow-[4px_4px_0_var(--color-ink)] relative">
      <button
        type="button"
        onClick={onDelete}
        disabled={saving}
        aria-label={`Delete anchor ${anchor.id}`}
        title="Delete anchor"
        className="absolute -top-2 -right-2 w-6 h-6 leading-none bg-cream border-2 border-ink font-black text-sm hover:bg-coral hover:text-cream disabled:opacity-40 shadow-[2px_2px_0_var(--color-ink)]"
      >
        ×
      </button>
      <button
        type="button"
        onClick={onOpenPicker}
        disabled={saving}
        title={isEmpty ? "Pick a piece" : "Change piece"}
        className={`border-2 border-ink relative overflow-hidden flex items-center justify-center group disabled:cursor-not-allowed disabled:opacity-60 ${
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
        <span className="absolute inset-0 flex items-center justify-center bg-ink/60 text-cream text-[10px] font-black uppercase tracking-widest opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
          Browse ↗
        </span>
      </button>
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="font-mono text-sm font-bold">{anchor.id}</div>
        {anchor.note && (
          <div className="text-xs italic text-muted truncate">
            {anchor.note}
          </div>
        )}
        <div className="text-[11px] font-mono text-muted flex flex-wrap items-center gap-1">
          {anchor.allowedFrames?.map((f) => (
            <span
              key={f}
              className="inline-block bg-cream-dark border border-muted px-1.5"
            >
              {f}·{FRAME_LABEL[f]}
            </span>
          ))}
          <input
            key={`w-${anchor.maxWidth}`}
            type="number"
            min={0.5}
            max={20}
            step={0.25}
            defaultValue={anchor.maxWidth}
            disabled={saving}
            onBlur={(e) => {
              const w = parseFloat(e.target.value);
              if (Number.isFinite(w) && w !== anchor.maxWidth)
                onPatch({ maxWidth: w });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-14 bg-cream border border-muted px-1 font-mono disabled:opacity-50"
          />
          <span>×</span>
          <input
            key={`h-${anchor.maxHeight}`}
            type="number"
            min={0.5}
            max={20}
            step={0.25}
            defaultValue={anchor.maxHeight}
            disabled={saving}
            onBlur={(e) => {
              const h = parseFloat(e.target.value);
              if (Number.isFinite(h) && h !== anchor.maxHeight)
                onPatch({ maxHeight: h });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-14 bg-cream border border-muted px-1 font-mono disabled:opacity-50"
          />
          <span className="text-muted">m</span>
        </div>
        <div className="text-[11px] font-mono text-muted flex flex-wrap items-center gap-1">
          <span className="text-muted/70 pr-0.5">x</span>
          <button
            type="button"
            disabled={saving}
            onClick={() => onPatch({ x: anchor.x - NUDGE_STEP })}
            className="w-5 h-5 leading-none bg-cream border border-ink font-bold hover:bg-cream-dark disabled:opacity-50"
            aria-label="nudge x −"
          >
            −
          </button>
          <span className="w-12 text-center tabular-nums">
            {anchor.x.toFixed(2)}
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={() => onPatch({ x: anchor.x + NUDGE_STEP })}
            className="w-5 h-5 leading-none bg-cream border border-ink font-bold hover:bg-cream-dark disabled:opacity-50"
            aria-label="nudge x +"
          >
            +
          </button>
          <span className="text-muted/70 pl-2 pr-0.5">z</span>
          <button
            type="button"
            disabled={saving}
            onClick={() => onPatch({ z: anchor.z - NUDGE_STEP })}
            className="w-5 h-5 leading-none bg-cream border border-ink font-bold hover:bg-cream-dark disabled:opacity-50"
            aria-label="nudge z −"
          >
            −
          </button>
          <span className="w-12 text-center tabular-nums">
            {anchor.z.toFixed(2)}
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={() => onPatch({ z: anchor.z + NUDGE_STEP })}
            className="w-5 h-5 leading-none bg-cream border border-ink font-bold hover:bg-cream-dark disabled:opacity-50"
            aria-label="nudge z +"
          >
            +
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onPatch({ facing: nextFacing(anchor.facing) })}
            className="ml-2 px-1.5 h-5 leading-none bg-cream border border-ink font-bold hover:bg-cream-dark disabled:opacity-50"
            aria-label={`facing ${anchor.facing}, click to rotate`}
            title="Rotate facing N→E→S→W"
          >
            ↻ {anchor.facing}
          </button>
        </div>
        <button
          type="button"
          onClick={onOpenPicker}
          disabled={saving}
          className="font-sans text-sm font-semibold p-1.5 border-2 border-ink bg-cream mt-1 text-left hover:bg-cream-dark focus:outline-none focus:ring-2 focus:ring-gold disabled:opacity-50 disabled:cursor-not-allowed shadow-[2px_2px_0_var(--color-ink)]"
          title="Browse all pieces"
        >
          {piece ? (
            <span className="flex items-center justify-between gap-2">
              <span className="truncate">
                {piece.title || piece.id}
                {piece.artist ? (
                  <span className="text-muted font-normal">
                    {" — "}
                    {piece.artist}
                  </span>
                ) : null}
              </span>
              <span className="text-[10px] text-muted flex-none">browse ↗</span>
            </span>
          ) : (
            <span className="flex items-center justify-between gap-2 text-muted">
              <span className="italic font-normal">— empty —</span>
              <span className="text-[10px] flex-none">browse ↗</span>
            </span>
          )}
        </button>
        <div className="flex items-start gap-1.5 mt-0.5">
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted pt-0.5">
            Tags
          </span>
          {editingTags ? (
            <input
              autoFocus
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              onBlur={commitTags}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditingTags(false);
              }}
              placeholder="may-activation, hero"
              className="flex-1 min-w-0 text-[10px] p-1 border border-ink bg-cream font-mono"
            />
          ) : (
            <button
              type="button"
              onClick={startEditTags}
              disabled={saving}
              className="flex-1 min-w-0 text-left disabled:opacity-40"
              title="Click to edit anchor tags"
            >
              {(anchor.tags && anchor.tags.length > 0) ||
              pieceTags.length > 0 ? (
                <span className="inline-flex flex-wrap gap-1">
                  <TagList tags={anchor.tags} size="xs" />
                  {pieceTags.length > 0 && (
                    <span
                      className="inline-flex items-center gap-1 opacity-60"
                      title="Inherited from piece"
                    >
                      <span className="text-[8px] uppercase text-muted">
                        from piece:
                      </span>
                      <TagList tags={pieceTags} size="xs" />
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-[10px] italic text-muted underline decoration-dotted">
                  + add tags
                </span>
              )}
            </button>
          )}
        </div>
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
