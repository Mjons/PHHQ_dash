"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FRAME_LABEL, type PieceT } from "@/schema/manifest";
import { passesTagFilter, type TagFilterState } from "@/lib/tags";
import { isVideoPiece } from "@/lib/pieces";
import { TagFilterBar } from "./tag-filter-bar";

// Tolerance for the aspect filter — anchor and piece aspects within ±10%
// are considered a match. Matches the curator's expectation that a roughly-
// square piece can go on a roughly-square anchor without surprising letterbox.
const ASPECT_TOLERANCE = 0.1;

// Mount-on-open: parent should render <PiecePicker /> only while the modal
// should be visible, so each open is a fresh mount with default filters
// (no reset effect needed).
export type PiecePickerProps = {
  pieces: PieceT[];
  currentPieceId: string | null;
  anchorAspect: number; // maxWidth / maxHeight of the target anchor
  onClose: () => void;
  onPick: (pieceId: string | null) => void; // null = leave anchor empty
};

export function PiecePicker({
  pieces,
  currentPieceId,
  anchorAspect,
  onClose,
  onPick,
}: PiecePickerProps) {
  const [query, setQuery] = useState("");
  const [matchAspect, setMatchAspect] = useState(true);
  const [tagFilter, setTagFilter] = useState<TagFilterState>({});
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus the search input on mount.
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  // Esc closes the modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const allTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of pieces) {
      for (const t of p.tags ?? []) {
        const k = t.toLowerCase();
        if (!seen.has(k)) seen.set(k, t);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [pieces]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pieces.filter((p) => {
      if (matchAspect) {
        const ratio = p.aspect / anchorAspect;
        if (Math.abs(ratio - 1) > ASPECT_TOLERANCE) return false;
      }
      if (!passesTagFilter(p.tags, tagFilter)) return false;
      if (q) {
        const hay =
          `${p.id} ${p.title ?? ""} ${p.artist ?? ""} ${p.batch ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pieces, query, matchAspect, anchorAspect, tagFilter]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pick a piece"
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-stretch justify-center p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="bg-cream border-[3px] border-ink shadow-[8px_8px_0_var(--color-ink)] w-full max-w-[1100px] max-h-full flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-baseline justify-between gap-4 px-5 py-3 border-b-2 border-ink">
          <div>
            <h2 className="text-xl font-black uppercase tracking-wide">
              Pick a piece
            </h2>
            <p className="text-[11px] text-muted mt-0.5">
              {pieces.length} piece{pieces.length === 1 ? "" : "s"} in the
              system · anchor aspect{" "}
              <span className="font-mono">{anchorAspect.toFixed(2)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted hover:text-ink underline"
          >
            close (Esc)
          </button>
        </header>

        <div className="px-5 py-3 border-b-2 border-ink flex flex-wrap items-center gap-3">
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, artist, slug, batch…"
            className="flex-1 min-w-[180px] text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
          />
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={matchAspect}
              onChange={(e) => setMatchAspect(e.target.checked)}
              className="w-4 h-4 accent-gold"
            />
            <span className="font-bold uppercase tracking-widest">
              Match aspect
            </span>
            <span className="text-muted normal-case font-normal tracking-normal text-[11px]">
              (within ±{Math.round(ASPECT_TOLERANCE * 100)}%)
            </span>
          </label>
        </div>

        {allTags.length > 0 && (
          <div className="px-5 pt-3">
            <TagFilterBar
              allTags={allTags}
              filter={tagFilter}
              onChange={setTagFilter}
              label="Filter by tag"
              visibleCount={filtered.length}
              totalCount={pieces.length}
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            <button
              type="button"
              onClick={() => onPick(null)}
              className={`bg-cream border-[3px] aspect-square flex flex-col items-center justify-center gap-1.5 text-center transition-shadow ${
                currentPieceId === null
                  ? "border-coral shadow-[4px_4px_0_var(--color-coral)]"
                  : "border-ink shadow-[3px_3px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_var(--color-ink)]"
              }`}
              title="Leave the anchor empty"
            >
              <span className="text-3xl text-muted" aria-hidden>
                ×
              </span>
              <span className="font-black text-[11px] uppercase tracking-widest">
                Leave empty
              </span>
            </button>
            {filtered.length === 0 ? (
              <div className="col-span-full border-2 border-dashed border-muted p-10 text-center text-muted text-sm">
                {pieces.length === 0
                  ? "No pieces in the manifest yet. Drop a file on the anchor preview to upload one."
                  : "No pieces match the current filter. Turn off match-aspect or clear filters."}
              </div>
            ) : (
              filtered.map((p) => {
                const selected = p.id === currentPieceId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onPick(p.id)}
                    className={`bg-cream border-[3px] flex flex-col text-left transition-shadow ${
                      selected
                        ? "border-coral shadow-[4px_4px_0_var(--color-coral)]"
                        : "border-ink shadow-[3px_3px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_var(--color-ink)]"
                    }`}
                    title={`${p.title || p.id}${p.artist ? ` — ${p.artist}` : ""}`}
                  >
                    <div
                      className="bg-cream-dark border-b-2 border-ink overflow-hidden flex items-center justify-center relative"
                      style={{ aspectRatio: p.aspect }}
                    >
                      {isVideoPiece(p) ? (
                        <video
                          src={p.src}
                          autoPlay
                          muted
                          loop
                          playsInline
                          className="max-w-full max-h-full object-contain"
                          aria-label={p.title || p.id}
                        />
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={p.src}
                          alt={p.title || p.id}
                          className="max-w-full max-h-full object-contain"
                          loading="lazy"
                        />
                      )}
                      {p.link && (
                        <span
                          className="absolute top-1 right-1 bg-gold text-ink text-[10px] font-black px-1 border border-ink leading-none py-0.5"
                          title={`has external link: ${p.link}`}
                          aria-label="has external link"
                        >
                          🔗
                        </span>
                      )}
                    </div>
                    <div className="p-2 flex flex-col gap-0.5">
                      <div className="text-xs font-bold truncate">
                        {p.title || p.id}
                      </div>
                      {p.artist && (
                        <div className="text-[10px] text-muted truncate">
                          {p.artist}
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-[9px] font-mono mt-0.5">
                        <span className="bg-cream-dark border border-muted px-1">
                          {p.id}
                        </span>
                        <span className="bg-cream-dark border border-muted px-1">
                          {p.preferredFrame}·{FRAME_LABEL[p.preferredFrame]}
                        </span>
                        <span className="bg-cream-dark border border-muted px-1">
                          {p.aspect.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
