"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ASPECT_LABEL,
  AREA_LABEL,
  COVER_ASPECT_LABEL,
  PEDESTAL_ASPECT_LABEL,
  BookAnchor,
  BookSeries as BookSeriesSchema,
  BookEpisode as BookEpisodeSchema,
  type AspectT,
  type AreaT,
  type BookAnchorT,
  type BookEpisodeT,
  type BookSeriesT,
  type CoverAspectT,
  type FacingT,
  type ManifestT,
  type PedestalAspectT,
} from "@/schema/manifest";
import {
  fetchManifest,
  saveManifest,
  uploadBookAsset,
  type BookUploadKind,
} from "@/lib/client";

// ----- helpers --------------------------------------------------------------

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function pageKindFor(index: number): BookUploadKind {
  return `page-${String(index + 1).padStart(2, "0")}` as BookUploadKind;
}

// The pedestal "book" shape shows the cover stretched across an open book (2×
// portrait width = 3:2) — same display as the wide cover for the thumbnail.
function pedestalAspectAsCoverAspect(p: PedestalAspectT): CoverAspectT {
  return p === "book" ? "wide" : p;
}

// Treat known placeholder URLs as missing — earlier dashboard versions
// auto-filled placehold.co into new episodes before frontCover became optional.
// Mirrors src/scene/books/reader.ts:effectiveCover so the dashboard preview
// matches what the scene will actually render.
function effectiveCover(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.includes("placehold.co")) return undefined;
  return url;
}

const ASPECTS: AspectT[] = ["square", "portrait", "landscape", "spread"];
const FACINGS: FacingT[] = ["N", "E", "S", "W"];

// Measure an image file's width/height ratio (w/h) in the browser. Format-
// agnostic — the <img> decoder handles png/jpg/webp/gif alike. Rejects on a
// decode failure or zero height so callers can fall back to leaving the aspect
// untouched.
function measureImageRatio(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      URL.revokeObjectURL(url);
      if (h > 0 && Number.isFinite(w / h)) resolve(w / h);
      else reject(new Error("could not read image dimensions"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not decode image"));
    };
    img.src = url;
  });
}

// Map a measured w/h ratio to the nearest named aspect. Canonical ratios mirror
// the schema labels: portrait 7:10, square 1:1, landscape 10:8, wide 3:2.
function nearestByRatio<T extends string>(
  ratio: number,
  candidates: ReadonlyArray<readonly [T, number]>,
): T {
  let best = candidates[0];
  for (const c of candidates) {
    if (Math.abs(ratio - c[1]) < Math.abs(ratio - best[1])) best = c;
  }
  return best[0];
}

const COVER_RATIOS: ReadonlyArray<readonly [CoverAspectT, number]> = [
  ["portrait", 7 / 10],
  ["square", 1],
  ["landscape", 10 / 8],
  ["wide", 3 / 2],
];
const PEDESTAL_RATIOS: ReadonlyArray<readonly [PedestalAspectT, number]> = [
  // "book" is a deliberate open-book (2× width) display mode that a single
  // cover image's ratio shouldn't infer — excluded from auto-detection.
  ["portrait", 7 / 10],
  ["square", 1],
  ["landscape", 10 / 8],
];

// Detect a cover image's aspect for auto-fill on upload. Returns null on any
// measurement failure so the caller leaves the existing aspect alone.
async function detectCoverAspect(file: File): Promise<CoverAspectT | null> {
  try {
    return nearestByRatio(await measureImageRatio(file), COVER_RATIOS);
  } catch {
    return null;
  }
}
async function detectPedestalAspect(
  file: File,
): Promise<PedestalAspectT | null> {
  try {
    return nearestByRatio(await measureImageRatio(file), PEDESTAL_RATIOS);
  } catch {
    return null;
  }
}

// Default placement target — F2 footprint roughly spans [16..80] × [16..64].
const F2_DEFAULT = { area: "f2" as AreaT, x: 48, z: 40 };

// ----- top-level view -------------------------------------------------------

type Tab = "series" | "pedestals";

export default function BooksView() {
  const [manifest, setManifest] = useState<ManifestT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("series");
  const [selSeriesId, setSelSeriesId] = useState<string | null>(null);
  const [selAnchorId, setSelAnchorId] = useState<string | null>(null);

  useEffect(() => {
    fetchManifest()
      .then(setManifest)
      .catch((e) => setError(String(e)));
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2400);
  }

  async function save(next: ManifestT, msg: string) {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      showToast(`${msg} · v${saved.version}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !manifest)
    return <div className="p-8 text-coral font-bold">Error: {error}</div>;
  if (!manifest) return <div className="p-8 text-muted">Loading…</div>;

  const selectedSeries =
    manifest.series.find((s) => s.id === selSeriesId) ?? null;
  const selectedAnchor =
    manifest.bookAnchors.find((a) => a.id === selAnchorId) ?? null;

  return (
    <div className="max-w-[1400px] mx-auto px-7 py-6 pb-24">
      <div className="flex items-end justify-between pb-4 border-b-2 border-ink mb-6">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-wide">Books</h1>
          <p className="text-muted text-sm mt-1">
            {manifest.series.length} series · {manifest.bookAnchors.length}{" "}
            pedestal{manifest.bookAnchors.length === 1 ? "" : "s"} · v
            {manifest.version}
          </p>
        </div>
        <div className="flex gap-1">
          <TabBtn active={tab === "series"} onClick={() => setTab("series")}>
            Series
          </TabBtn>
          <TabBtn
            active={tab === "pedestals"}
            onClick={() => setTab("pedestals")}
          >
            Pedestals
          </TabBtn>
        </div>
      </div>

      {tab === "series" ? (
        <SeriesTab
          manifest={manifest}
          selected={selectedSeries}
          onSelect={setSelSeriesId}
          busy={busy}
          onSave={save}
        />
      ) : (
        <PedestalsTab
          manifest={manifest}
          selected={selectedAnchor}
          onSelect={setSelAnchorId}
          busy={busy}
          onSave={save}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-ink text-cream px-5 py-3 border-[3px] border-gold font-bold uppercase tracking-widest text-sm shadow-[4px_4px_0_var(--color-ink)]">
          ✓ {toast}
        </div>
      )}
      {error && manifest && (
        <div className="fixed bottom-6 left-6 bg-coral text-ink px-5 py-3 border-[3px] border-ink font-bold text-sm flex items-center gap-3 max-w-[600px]">
          <span className="break-all">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="underline text-xs shrink-0"
          >
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-5 py-2 text-sm font-black uppercase tracking-widest border-2 border-ink ${
        active
          ? "bg-gold shadow-[3px_3px_0_var(--color-ink)]"
          : "bg-cream hover:bg-cream-dark"
      }`}
    >
      {children}
    </button>
  );
}

// ----- SERIES TAB ===========================================================

function SeriesTab({
  manifest,
  selected,
  onSelect,
  busy,
  onSave,
}: {
  manifest: ManifestT;
  selected: BookSeriesT | null;
  onSelect: (id: string | null) => void;
  busy: boolean;
  onSave: (next: ManifestT, msg: string) => Promise<void>;
}) {
  async function createSeries(slug: string, title: string) {
    if (!slug) return;
    if (manifest.series.some((s) => s.id === slug)) {
      alert(`A series with id "${slug}" already exists.`);
      return;
    }
    const next: ManifestT = {
      ...manifest,
      series: [
        ...manifest.series,
        {
          id: slug,
          title: title || slug,
          cover: "https://placehold.co/600x900/0a0f1e/f5b119?text=NO+COVER",
          pedestalAspect: "portrait",
          episodes: [],
        },
      ],
    };
    await onSave(next, `Created "${slug}"`);
    onSelect(slug);
  }

  async function updateSeries(id: string, patch: Partial<BookSeriesT>) {
    const next: ManifestT = {
      ...manifest,
      series: manifest.series.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    };
    await onSave(next, `Updated "${id}"`);
  }

  async function deleteSeries(id: string) {
    const usedBy = manifest.bookAnchors.filter((a) => a.seriesId === id);
    const note =
      usedBy.length > 0
        ? `\n\nThis series is assigned to ${usedBy.length} pedestal${usedBy.length === 1 ? "" : "s"} — those will be cleared.`
        : "";
    if (
      !confirm(
        `Delete series "${id}"? Blob assets stay; only the manifest entry is removed.${note}`,
      )
    )
      return;
    const next: ManifestT = {
      ...manifest,
      series: manifest.series.filter((s) => s.id !== id),
      bookAnchors: manifest.bookAnchors.map((a) =>
        a.seriesId === id ? { ...a, seriesId: null } : a,
      ),
    };
    await onSave(next, `Deleted "${id}"`);
    onSelect(null);
  }

  // Map seriesId → number of anchors using it.
  const anchorUsage = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of manifest.bookAnchors)
      if (a.seriesId) m.set(a.seriesId, (m.get(a.seriesId) || 0) + 1);
    return m;
  }, [manifest.bookAnchors]);

  return (
    <div className="grid grid-cols-[320px_1fr] gap-6 items-start">
      <SeriesList
        list={manifest.series}
        usage={anchorUsage}
        selectedId={selected?.id ?? null}
        onSelect={onSelect}
        onCreate={createSeries}
        busy={busy}
      />
      {selected ? (
        <SeriesDetail
          key={selected.id}
          manifest={manifest}
          series={selected}
          busy={busy}
          onUpdate={(patch) => updateSeries(selected.id, patch)}
          onDelete={() => deleteSeries(selected.id)}
          onSave={onSave}
        />
      ) : (
        <div className="border-2 border-dashed border-muted p-12 text-center text-muted">
          <p className="font-bold uppercase tracking-widest mb-2">
            Select a series, or create one
          </p>
        </div>
      )}
    </div>
  );
}

function SeriesList({
  list,
  usage,
  selectedId,
  onSelect,
  onCreate,
  busy,
}: {
  list: BookSeriesT[];
  usage: Map<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (slug: string, title: string) => Promise<void>;
  busy: boolean;
}) {
  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const slug = newSlug || slugify(newTitle);

  return (
    <aside className="bg-cream border-[3px] border-ink p-4 shadow-[5px_5px_0_var(--color-ink)] flex flex-col gap-3 sticky top-4">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
        Series · {list.length}
      </div>
      <div className="flex flex-col gap-1.5 max-h-[60vh] overflow-y-auto">
        {list.length === 0 ? (
          <p className="text-xs text-muted italic px-2 py-3">
            no series yet — create one below
          </p>
        ) : (
          list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={`text-left p-2 border-2 ${
                selectedId === s.id
                  ? "border-ink bg-gold"
                  : "border-transparent bg-cream-dark/50 hover:bg-cream-dark"
              }`}
            >
              <div className="font-black text-sm truncate">{s.title}</div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-muted mt-0.5">
                <span>{s.id}</span>
                <span>
                  · {s.episodes.length} ep
                  {s.episodes.length === 1 ? "" : "s"}
                </span>
                {usage.get(s.id) ? (
                  <span className="text-good">· {usage.get(s.id)} placed</span>
                ) : (
                  <span className="italic">· unplaced</span>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      <div className="border-t-2 border-ink pt-3 flex flex-col gap-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
          New series
        </div>
        <input
          type="text"
          value={newTitle}
          onChange={(e) => {
            setNewTitle(e.target.value);
            if (!newSlug) setNewSlug("");
          }}
          placeholder="Title"
          disabled={busy}
          className="w-full text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
        />
        <input
          type="text"
          value={slug}
          onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
          placeholder="slug"
          disabled={busy}
          className="w-full font-mono text-xs p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
        />
        <button
          type="button"
          disabled={busy || !slug || !newTitle.trim()}
          onClick={async () => {
            await onCreate(slug, newTitle.trim());
            setNewTitle("");
            setNewSlug("");
          }}
          className="bg-gold border-2 border-ink py-2 font-black uppercase tracking-widest text-xs shadow-[3px_3px_0_var(--color-ink)] disabled:opacity-40"
        >
          Create
        </button>
      </div>
    </aside>
  );
}

// ----- SERIES DETAIL --------------------------------------------------------

function SeriesDetail({
  manifest,
  series,
  busy,
  onUpdate,
  onDelete,
  onSave,
}: {
  manifest: ManifestT;
  series: BookSeriesT;
  busy: boolean;
  onUpdate: (patch: Partial<BookSeriesT>) => Promise<void>;
  onDelete: () => Promise<void>;
  onSave: (next: ManifestT, msg: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(series.title);
  const [byline, setByline] = useState(series.byline || "");
  const [tagsInput, setTagsInput] = useState((series.tags || []).join(", "));
  const [pedestalAspect, setPedestalAspect] = useState<PedestalAspectT>(
    series.pedestalAspect,
  );
  const [dirty, setDirty] = useState(false);
  const [expandedEpId, setExpandedEpId] = useState<string | null>(null);

  // Reset local edits when series switches
  useEffect(() => {
    setTitle(series.title);
    setByline(series.byline || "");
    setTagsInput((series.tags || []).join(", "));
    setPedestalAspect(series.pedestalAspect);
    setDirty(false);
  }, [
    series.id,
    series.title,
    series.byline,
    series.tags,
    series.pedestalAspect,
  ]);

  async function saveSeriesMeta() {
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const patch: Partial<BookSeriesT> = {
      title: title.trim() || series.id,
      pedestalAspect,
    };
    if (byline.trim()) patch.byline = byline.trim();
    else patch.byline = undefined;
    if (tags.length) patch.tags = tags;
    else patch.tags = undefined;
    await onUpdate(patch);
    setDirty(false);
  }

  async function uploadCover(file: File) {
    try {
      // Auto-detect the pedestal shape from the cover image so it doesn't get
      // stuck on the default. Preserve "book" — that's a deliberate open-book
      // (2× width) display mode a single image's ratio shouldn't override.
      const detected =
        pedestalAspect === "book" ? null : await detectPedestalAspect(file);
      const { url } = await uploadBookAsset(
        file,
        series.id,
        null,
        "series-cover",
      );
      const patch: Partial<BookSeriesT> = { cover: url };
      if (detected && detected !== pedestalAspect) {
        patch.pedestalAspect = detected;
        setPedestalAspect(detected);
      }
      await onUpdate(patch);
    } catch (e) {
      alert(String(e));
    }
  }

  async function addEpisode() {
    const epTitle = prompt(
      "Episode title (e.g. 'Episode 01'):",
      `Episode ${String(series.episodes.length + 1).padStart(2, "0")}`,
    );
    if (!epTitle) return;
    const epId = slugify(epTitle) || `ep-${series.episodes.length + 1}`;
    if (series.episodes.some((e) => e.id === epId)) {
      alert(`Episode "${epId}" already exists in this series.`);
      return;
    }
    const next: ManifestT = {
      ...manifest,
      series: manifest.series.map((s) =>
        s.id === series.id
          ? {
              ...s,
              episodes: [
                ...s.episodes,
                {
                  id: epId,
                  title: epTitle,
                  // frontCover + backCover both omitted — curator uploads when ready.
                  pages: [
                    "https://placehold.co/980x1400/0a0f1e/f5b119?text=PAGE+1",
                  ],
                  aspect: "portrait",
                  coverAspect: "wide",
                },
              ],
            }
          : s,
      ),
    };
    await onSave(next, `Added episode "${epId}"`);
    setExpandedEpId(epId);
  }

  async function updateEpisode(epId: string, patch: Partial<BookEpisodeT>) {
    const next: ManifestT = {
      ...manifest,
      series: manifest.series.map((s) =>
        s.id === series.id
          ? {
              ...s,
              episodes: s.episodes.map((e) =>
                e.id === epId ? { ...e, ...patch } : e,
              ),
            }
          : s,
      ),
    };
    await onSave(next, `Updated "${epId}"`);
  }

  async function deleteEpisode(epId: string) {
    if (!confirm(`Delete episode "${epId}"? Blob assets stay.`)) return;
    const next: ManifestT = {
      ...manifest,
      series: manifest.series.map((s) =>
        s.id === series.id
          ? { ...s, episodes: s.episodes.filter((e) => e.id !== epId) }
          : s,
      ),
    };
    await onSave(next, `Deleted "${epId}"`);
    if (expandedEpId === epId) setExpandedEpId(null);
  }

  return (
    <section className="bg-cream border-[3px] border-ink p-5 shadow-[5px_5px_0_var(--color-ink)] flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start gap-5 pb-4 border-b-2 border-ink">
        <CoverThumb
          src={series.cover}
          coverAspect={pedestalAspectAsCoverAspect(pedestalAspect)}
          label={`Pedestal cover (${PEDESTAL_ASPECT_LABEL[pedestalAspect]})`}
          onPick={uploadCover}
          busy={busy}
        />
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              placeholder="Series title"
              className="flex-1 text-2xl font-black uppercase tracking-wide p-2 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
            />
            <span className="font-mono text-xs text-muted bg-cream-dark px-2 py-1 border border-ink/40">
              {series.id}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Byline (optional)">
              <input
                type="text"
                value={byline}
                onChange={(e) => {
                  setByline(e.target.value);
                  setDirty(true);
                }}
                placeholder="Panel Haus Originals"
                className="w-full text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </Field>
            <Field label="Tags (comma-separated)">
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => {
                  setTagsInput(e.target.value);
                  setDirty(true);
                }}
                placeholder="featured, residency"
                className="w-full text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </Field>
          </div>
          <Field label="Pedestal cover shape (3D book on the plinth)">
            <div className="grid grid-cols-4 gap-1.5">
              {(
                ["portrait", "square", "landscape", "book"] as PedestalAspectT[]
              ).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => {
                    setPedestalAspect(a);
                    setDirty(true);
                  }}
                  className={`text-[11px] font-bold border-2 border-ink py-1.5 transition-colors ${
                    pedestalAspect === a
                      ? "bg-gold"
                      : "bg-cream hover:bg-cream-dark"
                  }`}
                >
                  {PEDESTAL_ASPECT_LABEL[a]}
                </button>
              ))}
            </div>
          </Field>
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={saveSeriesMeta}
              disabled={busy || !dirty}
              className="bg-gold border-2 border-ink px-3 py-1.5 font-black uppercase tracking-widest text-xs shadow-[3px_3px_0_var(--color-ink)] disabled:opacity-40"
            >
              Save series
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="bg-cream border-2 border-coral px-3 py-1.5 text-coral font-bold uppercase tracking-widest text-xs hover:bg-coral hover:text-cream"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Episodes */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black uppercase tracking-widest">
            Episodes · {series.episodes.length}
          </h2>
          <button
            type="button"
            onClick={addEpisode}
            disabled={busy}
            className="bg-ink text-cream border-2 border-ink px-3 py-1.5 font-bold uppercase tracking-widest text-xs hover:bg-gold hover:text-ink"
          >
            + Add episode
          </button>
        </div>

        {series.episodes.length === 0 ? (
          <p className="text-sm text-muted italic">
            no episodes yet — add one above
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {series.episodes.map((ep) => (
              <EpisodeCard
                key={ep.id}
                seriesId={series.id}
                seriesByline={series.byline}
                episode={ep}
                expanded={expandedEpId === ep.id}
                onToggle={() =>
                  setExpandedEpId(expandedEpId === ep.id ? null : ep.id)
                }
                busy={busy}
                onUpdate={(p) => updateEpisode(ep.id, p)}
                onDelete={() => deleteEpisode(ep.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ----- EPISODE CARD + EDITOR ------------------------------------------------

function EpisodeCard({
  seriesId,
  seriesByline,
  episode,
  expanded,
  onToggle,
  busy,
  onUpdate,
  onDelete,
}: {
  seriesId: string;
  seriesByline?: string;
  episode: BookEpisodeT;
  expanded: boolean;
  onToggle: () => void;
  busy: boolean;
  onUpdate: (patch: Partial<BookEpisodeT>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  return (
    <div className="border-2 border-ink bg-cream-dark">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-cream"
      >
        <div
          className="w-16 h-10 bg-ink/10 border border-ink/40 bg-cover bg-center flex items-center justify-center"
          style={
            effectiveCover(episode.frontCover)
              ? {
                  backgroundImage: `url(${effectiveCover(episode.frontCover)})`,
                }
              : undefined
          }
        >
          {!effectiveCover(episode.frontCover) && (
            <span className="text-[8px] text-muted font-bold uppercase tracking-widest">
              title card
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-black uppercase tracking-wide text-sm">
            {episode.title}
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono text-muted mt-0.5">
            <span>{episode.id}</span>
            <span className="bg-gold/40 px-1.5 py-px text-ink">
              {ASPECT_LABEL[episode.aspect]}
            </span>
            <span>· {episode.pages.length} pages</span>
            {effectiveCover(episode.frontCover) && <span>· front</span>}
            {effectiveCover(episode.backCover) && <span>· back</span>}
            {episode.byline && <span>· {episode.byline}</span>}
          </div>
        </div>
        <div className="text-xs text-muted">{expanded ? "▲" : "▼"}</div>
      </button>

      {expanded && (
        <EpisodeEditor
          seriesId={seriesId}
          seriesByline={seriesByline}
          episode={episode}
          busy={busy}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

function EpisodeEditor({
  seriesId,
  seriesByline,
  episode,
  busy,
  onUpdate,
  onDelete,
}: {
  seriesId: string;
  seriesByline?: string;
  episode: BookEpisodeT;
  busy: boolean;
  onUpdate: (patch: Partial<BookEpisodeT>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [title, setTitle] = useState(episode.title);
  const [byline, setByline] = useState(episode.byline || "");
  const [aspect, setAspect] = useState<AspectT>(episode.aspect);
  const [coverAspect, setCoverAspect] = useState<CoverAspectT>(
    episode.coverAspect,
  );
  const [pageUploadStatus, setPageUploadStatus] = useState<string>("");

  async function saveMeta() {
    const patch: Partial<BookEpisodeT> = {
      title: title.trim() || episode.id,
      aspect,
      coverAspect,
    };
    patch.byline = byline.trim() || undefined;
    await onUpdate(patch);
  }

  async function uploadCover(file: File, side: "front" | "back") {
    try {
      // The front cover defines the cover frame's shape — auto-detect its aspect
      // from the image so it doesn't get stuck on the schema default ("wide").
      // The selector still lets the curator override afterward. Back covers
      // share coverAspect, so the front governs and back uploads leave it alone.
      const detected = side === "front" ? await detectCoverAspect(file) : null;
      const { url } = await uploadBookAsset(file, seriesId, episode.id, side);
      const patch: Partial<BookEpisodeT> =
        side === "front" ? { frontCover: url } : { backCover: url };
      if (detected && detected !== coverAspect) {
        patch.coverAspect = detected;
        setCoverAspect(detected);
      }
      await onUpdate(patch);
    } catch (e) {
      alert(String(e));
    }
  }

  async function clearCover(side: "front" | "back") {
    const label = side === "front" ? "front" : "back";
    if (!confirm(`Remove ${label} cover from this episode?`)) return;
    const patch: Partial<BookEpisodeT> =
      side === "front" ? { frontCover: undefined } : { backCover: undefined };
    await onUpdate(patch);
  }

  // Bulk page upload: name-sorted, replaces the whole pages[] array.
  async function uploadPages(files: File[]) {
    if (files.length === 0) return;
    if (files.length > 34) {
      alert(`Too many files (${files.length}). Max 34 pages per episode.`);
      return;
    }
    const ok = confirm(
      `Upload ${files.length} file${files.length === 1 ? "" : "s"} as pages? ` +
        `This REPLACES the existing ${episode.pages.length}-page list.`,
    );
    if (!ok) return;
    const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
    const urls: string[] = [];
    setPageUploadStatus(`0 / ${sorted.length}`);
    try {
      for (let i = 0; i < sorted.length; i++) {
        const f = sorted[i];
        const { url } = await uploadBookAsset(
          f,
          seriesId,
          episode.id,
          pageKindFor(i),
        );
        urls.push(url);
        setPageUploadStatus(`${i + 1} / ${sorted.length}`);
      }
      await onUpdate({ pages: urls });
    } catch (e) {
      alert(`Upload failed: ${e}\n${urls.length} pages were uploaded.`);
    } finally {
      setPageUploadStatus("");
    }
  }

  // Single-page replace at index i
  async function replacePage(file: File, i: number) {
    try {
      const { url } = await uploadBookAsset(
        file,
        seriesId,
        episode.id,
        pageKindFor(i),
      );
      const next = [...episode.pages];
      next[i] = url;
      await onUpdate({ pages: next });
    } catch (e) {
      alert(String(e));
    }
  }

  async function removePage(i: number) {
    if (episode.pages.length <= 1) {
      alert("An episode must have at least one page.");
      return;
    }
    if (!confirm(`Remove page ${i + 1}? Blob asset stays.`)) return;
    const next = episode.pages.filter((_, idx) => idx !== i);
    await onUpdate({ pages: next });
  }

  return (
    <div className="border-t-2 border-ink p-4 bg-cream flex flex-col gap-4">
      <div className="grid grid-cols-[1fr_1fr] gap-3">
        <Field label="Title">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-sm p-1.5 border-2 border-ink bg-cream"
          />
        </Field>
        <Field label="Byline (optional)">
          <input
            type="text"
            value={byline}
            onChange={(e) => setByline(e.target.value)}
            placeholder="(falls back to series byline)"
            className="w-full text-sm p-1.5 border-2 border-ink bg-cream"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Page aspect">
          <div className="grid grid-cols-2 gap-1.5">
            {ASPECTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAspect(a)}
                className={`text-[11px] font-bold border-2 border-ink py-1.5 transition-colors ${
                  aspect === a ? "bg-gold" : "bg-cream hover:bg-cream-dark"
                }`}
              >
                {ASPECT_LABEL[a]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Cover aspect (front + back)">
          <div className="grid grid-cols-2 gap-1.5">
            {(
              ["wide", "square", "portrait", "landscape"] as CoverAspectT[]
            ).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setCoverAspect(a)}
                className={`text-[11px] font-bold border-2 border-ink py-1.5 transition-colors ${
                  coverAspect === a ? "bg-gold" : "bg-cream hover:bg-cream-dark"
                }`}
              >
                {COVER_ASPECT_LABEL[a]}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={saveMeta}
          disabled={busy}
          className="bg-gold border-2 border-ink px-3 py-1.5 font-black uppercase tracking-widest text-xs shadow-[3px_3px_0_var(--color-ink)] disabled:opacity-40"
        >
          Save episode meta
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="bg-cream border-2 border-coral px-3 py-1.5 text-coral font-bold uppercase tracking-widest text-xs"
        >
          Delete episode
        </button>
      </div>

      <div className="border-t-2 border-ink pt-3 grid grid-cols-2 gap-3">
        <div>
          <CoverThumb
            src={effectiveCover(episode.frontCover) ?? null}
            coverAspect={coverAspect}
            label={`Front cover (${COVER_ASPECT_LABEL[coverAspect]}, optional)`}
            titleCardPreview={
              effectiveCover(episode.frontCover)
                ? null
                : {
                    title: title.trim() || episode.title,
                    byline: byline.trim() || seriesByline?.trim() || undefined,
                  }
            }
            onPick={(f) => uploadCover(f, "front")}
            busy={busy}
          />
          {effectiveCover(episode.frontCover) && (
            <button
              type="button"
              onClick={() => clearCover("front")}
              disabled={busy}
              className="mt-2 text-[10px] text-coral underline hover:no-underline"
            >
              remove front cover
            </button>
          )}
        </div>
        <div>
          <CoverThumb
            src={effectiveCover(episode.backCover) ?? null}
            coverAspect={coverAspect}
            label={`Back cover (${COVER_ASPECT_LABEL[coverAspect]}, optional)`}
            placeholderText={
              effectiveCover(episode.backCover) ? null : "NO BACK"
            }
            onPick={(f) => uploadCover(f, "back")}
            busy={busy}
          />
          {effectiveCover(episode.backCover) && (
            <button
              type="button"
              onClick={() => clearCover("back")}
              disabled={busy}
              className="mt-2 text-[10px] text-coral underline hover:no-underline"
            >
              remove back cover
            </button>
          )}
        </div>
      </div>

      <div className="border-t-2 border-ink pt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Pages · {episode.pages.length} / 34
            {aspect === "spread" && (
              <span className="ml-2 text-ink/70 normal-case font-normal italic">
                (spread mode pairs them — {Math.ceil(episode.pages.length / 2)}{" "}
                spreads)
              </span>
            )}
          </div>
          {pageUploadStatus && (
            <span className="text-[10px] font-mono text-good">
              Uploading {pageUploadStatus}
            </span>
          )}
        </div>

        <BulkPageDrop onFiles={uploadPages} busy={busy || !!pageUploadStatus} />

        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
          {episode.pages.map((p, i) => (
            <PageTile
              key={`${i}-${p}`}
              src={p}
              index={i}
              busy={busy}
              onReplace={(f) => replacePage(f, i)}
              onRemove={() => removePage(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function BulkPageDrop({
  onFiles,
  busy,
}: {
  onFiles: (files: File[]) => void;
  busy: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <label
      onDragEnter={(e) => {
        e.preventDefault();
        if (!busy) setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (busy) return;
        const files = Array.from(e.dataTransfer.files).filter((f) =>
          f.type.startsWith("image/"),
        );
        if (files.length) onFiles(files);
      }}
      className={`relative block py-5 px-4 text-center cursor-pointer border-[3px] border-dashed ${
        dragOver ? "border-coral bg-coral/15" : "border-ink bg-cream-dark"
      } ${busy ? "opacity-60 cursor-wait" : "hover:bg-cream"}`}
    >
      <div className="font-black uppercase tracking-widest text-xs">
        {dragOver ? "Drop to upload" : "Drop pages here"}
      </div>
      <div className="text-[10px] text-muted">
        replaces the page list · name-sorted · max 34
      </div>
      <input
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif"
        disabled={busy}
        className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-wait"
        onChange={(e) => {
          const fs = e.target.files ? Array.from(e.target.files) : [];
          if (fs.length) onFiles(fs);
          e.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function PageTile({
  src,
  index,
  busy,
  onReplace,
  onRemove,
}: {
  src: string;
  index: number;
  busy: boolean;
  onReplace: (f: File) => void;
  onRemove: () => void;
}) {
  return (
    <div className="bg-cream-dark border-2 border-ink flex flex-col">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`page ${index + 1}`}
        className="w-full aspect-[7/10] object-cover bg-ink/10"
      />
      <div className="p-1 flex items-center justify-between gap-1">
        <span className="text-[10px] font-mono">p{index + 1}</span>
        <div className="flex gap-1">
          <label
            className={`text-[10px] underline cursor-pointer ${busy ? "opacity-40 cursor-wait" : ""}`}
          >
            replace
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              disabled={busy}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onReplace(f);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="text-[10px] text-coral underline"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- COVER THUMB (file pick + preview) ------------------------------------

// Aspect-class lookup for the TailwindCSS `aspect-[…]` value used by the
// thumbnail preview. Matches the reader's COVER_FRAME ratios.
const COVER_THUMB_ASPECT: Record<CoverAspectT | "portrait", string> = {
  wide: "aspect-[3/2]",
  square: "aspect-square",
  portrait: "aspect-[7/10]",
  landscape: "aspect-[10/8]",
};

const COVER_THUMB_WIDTH: Record<CoverAspectT | "portrait", string> = {
  wide: "w-44",
  square: "w-36",
  portrait: "w-32",
  landscape: "w-44",
};

function CoverThumb({
  src,
  coverAspect,
  label,
  placeholderText,
  titleCardPreview,
  onPick,
  busy,
}: {
  src: string | null;
  // "portrait" is used by the series pedestal cover; episodes pass a CoverAspectT.
  coverAspect: CoverAspectT | "portrait";
  label: string;
  placeholderText?: string | null;
  // When set AND no src is uploaded, render a live mirror of the synthesised
  // title-card the scene will show (big title + small byline on white).
  titleCardPreview?: { title: string; byline?: string } | null;
  onPick: (file: File) => void;
  busy: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const aspect = COVER_THUMB_ASPECT[coverAspect];
  const w = COVER_THUMB_WIDTH[coverAspect];

  function pickFirstImage(
    list: FileList | File[] | null | undefined,
  ): File | null {
    if (!list) return null;
    for (const f of Array.from(list)) {
      if (f.type.startsWith("image/")) return f;
    }
    return null;
  }

  const showPlaceholder = !src;

  return (
    <label
      onDragEnter={(e) => {
        e.preventDefault();
        if (!busy) setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (busy) return;
        const f = pickFirstImage(e.dataTransfer.files);
        if (f) onPick(f);
      }}
      className={`flex flex-col gap-1 cursor-pointer ${busy ? "opacity-60 cursor-wait" : ""}`}
    >
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
        {label}
      </span>
      <div
        className={`${w} ${aspect} border-2 bg-cover bg-center transition-all flex flex-col items-center justify-center text-center p-2 overflow-hidden ${
          showPlaceholder ? (titleCardPreview ? "bg-white" : "bg-ink/10") : ""
        } ${
          dragOver
            ? "border-coral ring-4 ring-coral/40 scale-105"
            : "border-ink hover:ring-2 hover:ring-gold"
        }`}
        style={src ? { backgroundImage: `url(${src})` } : undefined}
      >
        {showPlaceholder && titleCardPreview ? (
          <>
            {titleCardPreview.byline && (
              <span className="text-[9px] text-muted leading-tight mb-1 uppercase tracking-widest break-words max-w-full">
                {titleCardPreview.byline}
              </span>
            )}
            <span className="text-sm font-black text-ink leading-tight break-words max-w-full">
              {titleCardPreview.title || "(no title)"}
            </span>
          </>
        ) : (
          showPlaceholder &&
          placeholderText && (
            <span className="whitespace-pre-line text-[10px] font-bold uppercase tracking-widest text-muted">
              {placeholderText}
            </span>
          )
        )}
      </div>
      <span className="text-[10px] text-muted italic">
        {dragOver
          ? "drop to upload"
          : src
            ? "click or drop to replace"
            : titleCardPreview
              ? "click or drop to upload · or leave blank for a title card"
              : "click or drop to upload"}
      </span>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        disabled={busy}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.currentTarget.value = "";
        }}
      />
    </label>
  );
}

// ----- PEDESTALS TAB =======================================================

function PedestalsTab({
  manifest,
  selected,
  onSelect,
  busy,
  onSave,
}: {
  manifest: ManifestT;
  selected: BookAnchorT | null;
  onSelect: (id: string | null) => void;
  busy: boolean;
  onSave: (next: ManifestT, msg: string) => Promise<void>;
}) {
  async function addAnchor(x: number, z: number) {
    const id = `pedestal-${Date.now().toString(36).slice(-6)}`;
    const next: ManifestT = {
      ...manifest,
      bookAnchors: [
        ...manifest.bookAnchors,
        {
          id,
          area: F2_DEFAULT.area,
          x,
          z,
          facing: "S",
          seriesId: null,
        },
      ],
    };
    await onSave(next, `Placed ${id}`);
    onSelect(id);
  }

  async function updateAnchor(id: string, patch: Partial<BookAnchorT>) {
    const next: ManifestT = {
      ...manifest,
      bookAnchors: manifest.bookAnchors.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    };
    await onSave(next, `Updated ${id}`);
  }

  async function deleteAnchor(id: string) {
    if (!confirm(`Delete pedestal "${id}"?`)) return;
    const next: ManifestT = {
      ...manifest,
      bookAnchors: manifest.bookAnchors.filter((a) => a.id !== id),
    };
    await onSave(next, `Deleted ${id}`);
    onSelect(null);
  }

  const f2Anchors = manifest.bookAnchors.filter((a) => a.area === "f2");

  return (
    <div className="grid grid-cols-[1fr_360px] gap-6 items-start">
      <F2Map
        anchors={f2Anchors}
        selectedId={selected?.id ?? null}
        onSelect={onSelect}
        onAddAt={addAnchor}
        busy={busy}
      />
      <aside className="bg-cream border-[3px] border-ink p-4 shadow-[5px_5px_0_var(--color-ink)] flex flex-col gap-3 sticky top-4">
        {selected ? (
          <AnchorDetail
            key={selected.id}
            manifest={manifest}
            anchor={selected}
            busy={busy}
            onUpdate={(p) => updateAnchor(selected.id, p)}
            onDelete={() => deleteAnchor(selected.id)}
          />
        ) : (
          <div className="text-muted text-sm p-4 text-center">
            <p className="font-bold uppercase tracking-widest mb-2 text-xs">
              No pedestal selected
            </p>
            <p className="text-xs">
              Click empty floor on the map to place a new pedestal, or click an
              existing dot to edit.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

// F2 floor footprint:
//   Parcels (16m each): x ∈ {16,32,48,64} × z ∈ {16,32,48}
//   Walkable: x ∈ [16, 80], z ∈ [16, 64].
const F2_X_MIN = 16;
const F2_X_MAX = 80;
const F2_Z_MIN = 16;
const F2_Z_MAX = 64;
const F2_W = F2_X_MAX - F2_X_MIN; // 64
const F2_D = F2_Z_MAX - F2_Z_MIN; // 48

function F2Map({
  anchors,
  selectedId,
  onSelect,
  onAddAt,
  busy,
}: {
  anchors: BookAnchorT[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddAt: (x: number, z: number) => Promise<void>;
  busy: boolean;
}) {
  // SVG: 64m × 48m, scaled. 8 px per meter.
  const SCALE = 8;
  const VIEW_W = F2_W * SCALE;
  const VIEW_D = F2_D * SCALE;

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (busy) return;
    const target = e.target as SVGElement;
    // If the click was on an existing dot, the dot's onClick will fire instead.
    if (target.tagName !== "rect" && target.tagName !== "svg") return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const local = pt.matrixTransform(ctm.inverse());
    const x = F2_X_MIN + local.x / SCALE;
    const z = F2_Z_MIN + local.y / SCALE;
    if (x < F2_X_MIN || x > F2_X_MAX || z < F2_Z_MIN || z > F2_Z_MAX) return;
    void onAddAt(Math.round(x * 10) / 10, Math.round(z * 10) / 10);
  }

  return (
    <section className="bg-cream border-[3px] border-ink p-4 shadow-[5px_5px_0_var(--color-ink)]">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-black uppercase tracking-widest">
          F2 — Main Gallery
        </h2>
        <span className="text-xs text-muted font-mono">
          x: {F2_X_MIN}–{F2_X_MAX}m · z: {F2_Z_MIN}–{F2_Z_MAX}m · click empty
          floor to add
        </span>
      </div>
      <div className="border-2 border-ink bg-cream-dark inline-block">
        <svg
          width={VIEW_W}
          height={VIEW_D}
          viewBox={`0 0 ${VIEW_W} ${VIEW_D}`}
          onClick={handleClick}
          style={{ display: "block", cursor: busy ? "wait" : "crosshair" }}
        >
          {/* Background grid — one rect per 16m parcel */}
          {[0, 1, 2, 3].map((col) =>
            [0, 1, 2].map((row) => (
              <rect
                key={`p-${col}-${row}`}
                x={col * 16 * SCALE}
                y={row * 16 * SCALE}
                width={16 * SCALE}
                height={16 * SCALE}
                fill={(col + row) % 2 === 0 ? "#f4ead8" : "#e9dcb8"}
                stroke="#1a1a1a"
                strokeWidth={1}
              />
            )),
          )}
          {/* North label */}
          <text
            x={VIEW_W / 2}
            y={14}
            fontSize={12}
            textAnchor="middle"
            fontWeight="bold"
            fill="#1a1a1a"
          >
            ▲ N (z → 0)
          </text>

          {/* Anchors */}
          {anchors.map((a) => {
            const cx = (a.x - F2_X_MIN) * SCALE;
            const cy = (a.z - F2_Z_MIN) * SCALE;
            const isSel = a.id === selectedId;
            // Facing arrow direction (in svg local: y axis = world z increasing)
            const arrowDx = a.facing === "E" ? 16 : a.facing === "W" ? -16 : 0;
            const arrowDy = a.facing === "S" ? 16 : a.facing === "N" ? -16 : 0;
            return (
              <g
                key={a.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(a.id);
                }}
                style={{ cursor: "pointer" }}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={10}
                  fill={a.seriesId ? "#f5b119" : "#9aa0a6"}
                  stroke="#1a1a1a"
                  strokeWidth={isSel ? 4 : 2}
                />
                <line
                  x1={cx}
                  y1={cy}
                  x2={cx + arrowDx}
                  y2={cy + arrowDy}
                  stroke="#1a1a1a"
                  strokeWidth={3}
                />
                {isSel && (
                  <text
                    x={cx}
                    y={cy - 14}
                    fontSize={10}
                    fontFamily="monospace"
                    textAnchor="middle"
                    fill="#1a1a1a"
                  >
                    {a.id}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex gap-3 mt-2 text-[10px] font-mono text-muted">
        <span>
          <span className="inline-block w-3 h-3 align-middle rounded-full border-2 border-ink bg-gold mr-1" />
          assigned
        </span>
        <span>
          <span className="inline-block w-3 h-3 align-middle rounded-full border-2 border-ink bg-[#9aa0a6] mr-1" />
          empty plinth
        </span>
        <span>arrow = facing direction</span>
      </div>
    </section>
  );
}

function AnchorDetail({
  manifest,
  anchor,
  busy,
  onUpdate,
  onDelete,
}: {
  manifest: ManifestT;
  anchor: BookAnchorT;
  busy: boolean;
  onUpdate: (patch: Partial<BookAnchorT>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [x, setX] = useState(String(anchor.x));
  const [z, setZ] = useState(String(anchor.z));
  const [note, setNote] = useState(anchor.note || "");

  useEffect(() => {
    setX(String(anchor.x));
    setZ(String(anchor.z));
    setNote(anchor.note || "");
  }, [anchor.id, anchor.x, anchor.z, anchor.note]);

  async function commitPos() {
    const nx = Number(x);
    const nz = Number(z);
    if (!Number.isFinite(nx) || !Number.isFinite(nz)) {
      alert("x and z must be numbers");
      return;
    }
    await onUpdate({ x: nx, z: nz });
  }

  const assignedSeries =
    manifest.series.find((s) => s.id === anchor.seriesId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
          {anchor.id}
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="text-[10px] text-coral underline"
        >
          delete
        </button>
      </div>

      <Field label="Area">
        <select
          value={anchor.area}
          onChange={(e) => onUpdate({ area: e.target.value as AreaT })}
          disabled={busy}
          className="w-full text-sm p-1.5 border-2 border-ink bg-cream"
        >
          {Object.entries(AREA_LABEL).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="x (m)">
          <input
            type="number"
            step="0.1"
            value={x}
            onChange={(e) => setX(e.target.value)}
            onBlur={commitPos}
            disabled={busy}
            className="w-full text-sm p-1.5 border-2 border-ink bg-cream font-mono"
          />
        </Field>
        <Field label="z (m)">
          <input
            type="number"
            step="0.1"
            value={z}
            onChange={(e) => setZ(e.target.value)}
            onBlur={commitPos}
            disabled={busy}
            className="w-full text-sm p-1.5 border-2 border-ink bg-cream font-mono"
          />
        </Field>
      </div>

      <Field label="Facing (cover faces this direction)">
        <div className="grid grid-cols-4 gap-1.5">
          {FACINGS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onUpdate({ facing: f })}
              disabled={busy}
              className={`text-xs font-bold border-2 border-ink py-1.5 ${
                anchor.facing === f ? "bg-gold" : "bg-cream hover:bg-cream-dark"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Series">
        <select
          value={anchor.seriesId ?? ""}
          onChange={(e) => onUpdate({ seriesId: e.target.value || null })}
          disabled={busy}
          className="w-full text-sm p-1.5 border-2 border-ink bg-cream"
        >
          <option value="">— empty plinth —</option>
          {manifest.series.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} ({s.id}) · {s.episodes.length} ep
            </option>
          ))}
        </select>
      </Field>

      {assignedSeries && (
        <div className="bg-cream-dark p-2 border border-ink/40 flex items-center gap-2">
          <div
            className="w-12 h-16 bg-cover bg-center border border-ink/40"
            style={{ backgroundImage: `url(${assignedSeries.cover})` }}
          />
          <div className="text-xs flex-1 min-w-0">
            <div className="font-black truncate">{assignedSeries.title}</div>
            <div className="text-muted text-[10px]">
              {assignedSeries.episodes.length} episode
              {assignedSeries.episodes.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      )}

      <Field label="Note (optional)">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => onUpdate({ note: note.trim() || undefined })}
          disabled={busy}
          placeholder="south wall, near stairs"
          className="w-full text-sm p-1.5 border-2 border-ink bg-cream"
        />
      </Field>
    </div>
  );
}

// ----- field wrapper --------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

// Re-export so tree-shakers see the schemas as used (they validate the schema
// is in sync; the actual runtime validation happens on the API side).
export const _schemas = {
  BookAnchor,
  BookEpisode: BookEpisodeSchema,
  BookSeries: BookSeriesSchema,
};
