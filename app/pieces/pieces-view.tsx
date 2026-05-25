"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FRAME_LABEL,
  Piece,
  type FrameKindT,
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
import {
  isValidSlug,
  resolveSlugCollisions,
  slugifyFilename,
  uploadAll,
  type UploadInput,
} from "@/lib/upload-queue";
import { TagList } from "../_components/tag-chip";
import { TagFilterBar } from "../_components/tag-filter-bar";

const FRAMES: FrameKindT[] = ["A", "B", "C", "D", "E", "F"];
const UPLOAD_CONCURRENCY = 4;

type RowField =
  | "slug"
  | "title"
  | "artist"
  | "preferredFrame"
  | "batch"
  | "link"
  | "tags";

type Touched = Partial<Record<RowField, true>>;

type Row = {
  id: string;
  file: File;
  preview: string;
  aspect: number;
  defaultSlug: string;
  slug: string;
  title: string;
  artist: string;
  preferredFrame: FrameKindT;
  batch: string;
  link: string;
  tags: string;
  touched: Touched;
  status: "pending" | "uploading" | "done" | "error";
  url?: string;
  error?: string;
};

type HeaderMeta = {
  artist: string;
  batch: string;
  preferredFrame: FrameKindT;
  tags: string;
};

const EMPTY_HEADER: HeaderMeta = {
  artist: "",
  batch: "",
  preferredFrame: "A",
  tags: "",
};

let rowIdSeq = 1;
function newRowId() {
  return `r-${rowIdSeq++}-${Math.random().toString(36).slice(2, 6)}`;
}

function fileToImageMeta(
  file: File,
): Promise<{ preview: string; aspect: number }> {
  return new Promise((resolve, reject) => {
    const preview = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      resolve({ preview, aspect: img.naturalWidth / img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(preview);
      reject(new Error("could not load image"));
    };
    img.src = preview;
  });
}

export default function PiecesView() {
  const [manifest, setManifest] = useState<ManifestT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [queue, setQueue] = useState<Row[]>([]);
  const [header, setHeader] = useState<HeaderMeta>(EMPTY_HEADER);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [tagFilter, setTagFilter] = useState<TagFilterState>({});

  // Ref mirror of queue so async callbacks always read the latest state.
  // (Status events from uploadAll fire while React state is mid-batch.)
  const queueRef = useRef(queue);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    fetchManifest()
      .then(setManifest)
      .catch((e) => setError(String(e)));
  }, []);

  // Revoke every queued preview when the component unmounts.
  useEffect(() => {
    return () => {
      for (const r of queueRef.current) URL.revokeObjectURL(r.preview);
    };
  }, []);

  function showToast(msg: string, ms = 2400) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), ms);
  }

  async function pickFiles(files: File[]) {
    if (files.length === 0) return;
    const existing = manifest
      ? new Set(Object.keys(manifest.pieces))
      : new Set<string>();
    const inQueue = new Set(queueRef.current.map((r) => r.slug));
    const taken = new Set<string>([...existing, ...inQueue]);

    // Probe aspects in parallel with a small cap so 40-file drops don't
    // pin the main thread.
    const metas = await runWithCap(files, 6, async (file) => {
      try {
        const m = await fileToImageMeta(file);
        return { file, ...m, error: null as string | null };
      } catch (e) {
        return { file, preview: "", aspect: 0, error: String(e) };
      }
    });

    const okMetas = metas.filter((m) => !m.error);
    const failures = metas.filter((m) => m.error);
    if (failures.length) {
      setError(
        `Could not read ${failures.length} file${failures.length === 1 ? "" : "s"}: ${failures[0].file.name}`,
      );
    }

    const desired = okMetas.map((m) => slugifyFilename(m.file.name));
    // When `replaceExisting` is on, manifest slugs are not collisions — only
    // intra-queue ones are. Build the taken-set accordingly.
    const conflictPool = new Set<string>(replaceExisting ? inQueue : taken);
    const resolved = resolveSlugCollisions(desired, conflictPool);

    const rows: Row[] = okMetas.map((m, i) => ({
      id: newRowId(),
      file: m.file,
      preview: m.preview,
      aspect: m.aspect,
      defaultSlug: desired[i],
      slug: resolved[i],
      title: "",
      artist: header.artist,
      preferredFrame: header.preferredFrame,
      batch: header.batch,
      link: "",
      tags: header.tags,
      touched: {},
      status: "pending",
    }));

    setQueue((q) => [...q, ...rows]);
  }

  function updateHeader<K extends keyof HeaderMeta>(
    field: K,
    value: HeaderMeta[K],
  ) {
    setHeader((h) => ({ ...h, [field]: value }));
    const fieldKey = field as RowField;
    setQueue((q) =>
      q.map((r) =>
        r.touched[fieldKey] || r.status === "done"
          ? r
          : ({ ...r, [fieldKey]: value } as Row),
      ),
    );
  }

  function updateRow(id: string, field: RowField, value: string | FrameKindT) {
    setQueue((q) =>
      q.map((r) => {
        if (r.id !== id) return r;
        const next: Row = {
          ...r,
          [field]: value,
          touched: { ...r.touched, [field]: true },
        };
        // In queue-of-1 mode, mirror edits to the header so a later file
        // inherits what the user just typed.
        return next;
      }),
    );
    // Mirror to header when there is exactly one row — outside setQueue so
    // we don't read stale state.
    if (queueRef.current.length === 1 && field in EMPTY_HEADER) {
      const k = field as keyof HeaderMeta;
      setHeader((h) => ({ ...h, [k]: value }) as HeaderMeta);
    }
  }

  function removeRow(id: string) {
    setQueue((q) => {
      const target = q.find((r) => r.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return q.filter((r) => r.id !== id);
    });
  }

  function clearQueue() {
    for (const r of queueRef.current) URL.revokeObjectURL(r.preview);
    setQueue([]);
  }

  function setRowStatus(
    id: string,
    patch: Partial<Pick<Row, "status" | "url" | "error">>,
  ) {
    setQueue((q) => q.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // Validates rows that need to upload (pending + previously errored) and
  // surfaces blocking issues before any network work happens.
  function validateForUpload(): { ok: boolean; reason?: string } {
    const rows = queueRef.current.filter((r) => r.status !== "done");
    if (rows.length === 0) return { ok: false, reason: "nothing to upload" };

    const seen = new Set<string>();
    for (const r of rows) {
      const slug = r.slug.trim();
      if (!slug)
        return { ok: false, reason: `row "${r.file.name}" has no slug` };
      if (!isValidSlug(slug))
        return {
          ok: false,
          reason: `slug "${slug}" must match a-z, 0-9, _, -`,
        };
      if (seen.has(slug))
        return { ok: false, reason: `duplicate slug in queue: "${slug}"` };
      seen.add(slug);
    }
    return { ok: true };
  }

  async function uploadBatch() {
    if (busy) return;
    const v = validateForUpload();
    if (!v.ok) {
      setError(v.reason!);
      return;
    }
    setError(null);

    const rows = queueRef.current.filter((r) => r.status !== "done");
    const inputs: UploadInput[] = rows.map((r) => ({
      id: r.id,
      file: r.file,
      slug: r.slug.trim(),
      batch: r.batch.trim() || undefined,
    }));

    // Reset any prior error rows back to pending so the UI doesn't flash
    // stale messages while they re-upload.
    for (const r of rows) {
      if (r.status === "error")
        setRowStatus(r.id, { status: "pending", error: undefined });
    }

    setBusy(true);
    try {
      await uploadAll(
        inputs,
        (e) => {
          if (e.phase === "uploading")
            setRowStatus(e.id, { status: "uploading" });
          else if (e.phase === "done")
            setRowStatus(e.id, {
              status: "done",
              url: e.url,
              error: undefined,
            });
          else setRowStatus(e.id, { status: "error", error: e.error });
        },
        UPLOAD_CONCURRENCY,
      );
    } finally {
      setBusy(false);
    }
  }

  // Builds a Piece from a row+url. Returns null if the row hasn't uploaded.
  function rowToPiece(r: Row): PieceT | null {
    if (!r.url) return null;
    const tags = parseTagsInput(r.tags);
    const piece: PieceT = {
      id: r.slug.trim(),
      src: r.url,
      aspect: Number(r.aspect.toFixed(4)),
      preferredFrame: r.preferredFrame,
      ...(r.title.trim() ? { title: r.title.trim() } : {}),
      ...(r.artist.trim() ? { artist: r.artist.trim() } : {}),
      ...(r.link.trim() ? { link: r.link.trim() } : {}),
      ...(r.batch.trim() ? { batch: r.batch.trim() } : {}),
      ...(tags.length ? { tags } : {}),
    };
    return piece;
  }

  async function commitBatch(opts: { skipFailed?: boolean } = {}) {
    if (busy) return;
    const done = queueRef.current.filter((r) => r.status === "done");
    const failed = queueRef.current.filter((r) => r.status === "error");
    if (done.length === 0) {
      setError("nothing to save — upload some pieces first");
      return;
    }
    if (failed.length > 0 && !opts.skipFailed) {
      setError(
        `${failed.length} row${failed.length === 1 ? "" : "s"} still failed — retry or use "skip & save"`,
      );
      return;
    }

    // Build + validate pieces client-side before round-tripping the manifest.
    const newPieces: Record<string, PieceT> = {};
    for (const r of done) {
      const p = rowToPiece(r);
      if (!p) continue;
      const parsed = Piece.safeParse(p);
      if (!parsed.success) {
        setError(
          `invalid piece "${p.id}": ${parsed.error.issues[0]?.message ?? parsed.error.message}`,
        );
        return;
      }
      newPieces[p.id] = p;
    }

    setBusy(true);
    setError(null);
    try {
      // Refresh the live manifest first so a concurrent capture-import or
      // other curator edit doesn't get clobbered by our stale base.
      const live = await fetchManifest();
      const next: ManifestT = {
        ...live,
        pieces: { ...live.pieces, ...newPieces },
      };
      const saved = await saveManifest(next);
      setManifest(saved);

      // Drop committed rows; leave any still-pending/error rows in queue.
      const committedIds = new Set(done.map((r) => r.id));
      for (const r of done) URL.revokeObjectURL(r.preview);
      setQueue((q) => q.filter((r) => !committedIds.has(r.id)));
      if (opts.skipFailed && failed.length > 0) {
        for (const r of failed) URL.revokeObjectURL(r.preview);
        setQueue((q) => q.filter((r) => r.status !== "error"));
      }

      const n = done.length;
      showToast(
        `Saved ${n} piece${n === 1 ? "" : "s"} · v${saved.version}`,
        4000,
      );

      if (queueRef.current.length === 0) setHeader(EMPTY_HEADER);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deletePiece(id: string) {
    if (!manifest) return;
    const usedBy = manifest.anchors.filter((a) => a.pieceId === id);
    const note =
      usedBy.length > 0
        ? `\n\nThis piece is currently assigned to ${usedBy.length} anchor${usedBy.length === 1 ? "" : "s"}:\n${usedBy.map((a) => `  • ${a.id}`).join("\n")}\n\nThose anchors will be cleared.`
        : "";
    if (
      !confirm(
        `Delete piece "${id}"? The image will stay in Blob storage; only the manifest entry is removed.${note}`,
      )
    ) {
      return;
    }
    const { [id]: _removed, ...rest } = manifest.pieces;
    void _removed;
    const next: ManifestT = {
      ...manifest,
      pieces: rest,
      anchors: manifest.anchors.map((a) =>
        a.pieceId === id ? { ...a, pieceId: null } : a,
      ),
    };
    setBusy(true);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      showToast(`Deleted "${id}" · v${saved.version}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function updatePieceTags(id: string, tags: string[]) {
    if (!manifest) return;
    const piece = manifest.pieces[id];
    if (!piece) return;
    const nextPiece: PieceT = { ...piece };
    if (tags.length) nextPiece.tags = tags;
    else delete nextPiece.tags;
    const next: ManifestT = {
      ...manifest,
      pieces: { ...manifest.pieces, [id]: nextPiece },
    };
    setBusy(true);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      showToast(`Tags saved · v${saved.version}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const allTags = useMemo(() => {
    if (!manifest) return [] as string[];
    const seen = new Map<string, string>();
    for (const p of Object.values(manifest.pieces)) {
      for (const t of p.tags ?? []) {
        const k = t.toLowerCase();
        if (!seen.has(k)) seen.set(k, t);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [manifest]);

  const visiblePieces = useMemo(() => {
    if (!manifest) return [] as PieceT[];
    return Object.values(manifest.pieces).filter((p) =>
      passesTagFilter(p.tags, tagFilter),
    );
  }, [manifest, tagFilter]);

  const byBatch = useMemo(() => {
    const m = new Map<string, PieceT[]>();
    for (const p of visiblePieces) {
      const key = p.batch || "(unbatched)";
      const list = m.get(key) ?? [];
      list.push(p);
      m.set(key, list);
    }
    for (const list of m.values())
      list.sort((a, b) => a.id.localeCompare(b.id));
    return m;
  }, [visiblePieces]);

  // Collision count vs current manifest — drives the "replace existing" warning.
  const manifestCollisions = useMemo(() => {
    if (!manifest) return 0;
    let n = 0;
    for (const r of queue) {
      if (r.status === "done") continue;
      if (manifest.pieces[r.slug.trim()]) n++;
    }
    return n;
  }, [queue, manifest]);

  if (error && !manifest)
    return <div className="p-8 text-coral font-bold">Error: {error}</div>;
  if (!manifest) return <div className="p-8 text-muted">Loading…</div>;

  const usageById = new Map<string, number>();
  for (const a of manifest.anchors) {
    if (a.pieceId)
      usageById.set(a.pieceId, (usageById.get(a.pieceId) || 0) + 1);
  }
  const totalPieces = Object.keys(manifest.pieces).length;

  return (
    <div className="max-w-[1200px] mx-auto px-7 py-6 pb-24">
      <div className="flex items-end justify-between pb-4 border-b-2 border-ink mb-6">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-wide">
            Pieces
          </h1>
          <p className="text-muted text-sm mt-1">
            {totalPieces} piece{totalPieces === 1 ? "" : "s"} · v
            {manifest.version}
          </p>
        </div>
      </div>

      <TagFilterBar
        allTags={allTags}
        filter={tagFilter}
        onChange={setTagFilter}
        label="Filter pieces by tag"
        visibleCount={visiblePieces.length}
        totalCount={totalPieces}
      />

      <div className="grid grid-cols-[1fr_360px] gap-6 items-start">
        <section>
          {totalPieces === 0 ? (
            <div className="border-2 border-dashed border-muted p-12 text-center text-muted">
              <p className="font-bold uppercase tracking-widest mb-2">
                No pieces yet
              </p>
              <p className="text-sm">
                Use the upload panel on the right to add your first piece.
              </p>
            </div>
          ) : visiblePieces.length === 0 ? (
            <div className="border-2 border-dashed border-muted p-12 text-center text-muted">
              <p className="font-bold uppercase tracking-widest mb-2">
                No pieces match the current filter
              </p>
              <p className="text-sm">
                Clear the filter bar above to see all {totalPieces} pieces.
              </p>
            </div>
          ) : (
            Array.from(byBatch.entries())
              .sort(([a], [b]) =>
                a === "(unbatched)" ? 1 : a.localeCompare(b),
              )
              .map(([batch, list]) => (
                <div key={batch} className="mb-8">
                  <h2 className="inline-block bg-ink text-cream px-3.5 py-1.5 text-sm font-black uppercase tracking-widest mb-3">
                    {batch}{" "}
                    <span className="bg-gold text-ink px-2 py-0.5 rounded-xl text-[11px] ml-2">
                      {list.length}
                    </span>
                  </h2>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                    {list.map((p) => (
                      <PieceCard
                        key={p.id}
                        piece={p}
                        usedBy={usageById.get(p.id) || 0}
                        busy={busy}
                        onDelete={() => deletePiece(p.id)}
                        onSaveTags={(tags) => updatePieceTags(p.id, tags)}
                      />
                    ))}
                  </div>
                </div>
              ))
          )}
        </section>

        <aside>
          <UploadQueuePanel
            manifest={manifest}
            queue={queue}
            header={header}
            replaceExisting={replaceExisting}
            manifestCollisions={manifestCollisions}
            busy={busy}
            onPickFiles={pickFiles}
            onUpdateHeader={updateHeader}
            onUpdateRow={updateRow}
            onRemoveRow={removeRow}
            onClearQueue={clearQueue}
            onToggleReplace={setReplaceExisting}
            onUpload={uploadBatch}
            onCommit={() => commitBatch({})}
            onCommitSkippingFailed={() => commitBatch({ skipFailed: true })}
          />
        </aside>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-ink text-cream px-5 py-3 border-[3px] border-gold font-bold uppercase tracking-widest text-sm shadow-[4px_4px_0_var(--color-ink)]">
          ✓ {toast}
        </div>
      )}
      {error && manifest && (
        <div className="fixed bottom-6 left-6 bg-coral text-ink px-5 py-3 border-[3px] border-ink font-bold text-sm flex items-center gap-3 max-w-[480px]">
          <span className="break-words">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="underline text-xs flex-none"
          >
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// runWithCap — bounded-concurrency map.
async function runWithCap<T, R>(
  items: T[],
  cap: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const n = Math.max(1, Math.min(cap, items.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

function PieceCard({
  piece,
  usedBy,
  busy,
  onDelete,
  onSaveTags,
}: {
  piece: PieceT;
  usedBy: number;
  busy: boolean;
  onDelete: () => void;
  onSaveTags: (tags: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [tagsInput, setTagsInput] = useState("");

  function startEdit() {
    setTagsInput(tagsToInput(piece.tags));
    setEditing(true);
  }

  function commitTags() {
    const next = parseTagsInput(tagsInput);
    const current = piece.tags ?? [];
    const same =
      next.length === current.length &&
      next.every((t, i) => t.toLowerCase() === current[i]?.toLowerCase());
    setEditing(false);
    if (!same) onSaveTags(next);
  }

  return (
    <article className="bg-cream border-[3px] border-ink shadow-[4px_4px_0_var(--color-ink)] flex flex-col">
      <div
        className="bg-cream-dark border-b-2 border-ink overflow-hidden flex items-center justify-center"
        style={{ aspectRatio: piece.aspect }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={piece.src}
          alt={piece.title || piece.id}
          className="max-w-full max-h-full object-contain"
        />
      </div>
      <div className="p-2.5 flex flex-col gap-1 text-sm">
        <div className="font-bold truncate">{piece.title || piece.id}</div>
        {piece.artist && (
          <div className="text-xs text-muted truncate">{piece.artist}</div>
        )}
        <div className="flex items-center gap-1.5 text-[10px] font-mono mt-1">
          <span className="bg-cream-dark border border-muted px-1.5">
            {piece.id}
          </span>
          <span className="bg-cream-dark border border-muted px-1.5">
            {piece.preferredFrame}·{FRAME_LABEL[piece.preferredFrame]}
          </span>
          <span className="bg-cream-dark border border-muted px-1.5">
            {piece.aspect.toFixed(2)}
          </span>
        </div>
        <div className="flex items-start justify-between gap-2 mt-1.5">
          {editing ? (
            <input
              autoFocus
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              onBlur={commitTags}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditing(false);
              }}
              placeholder="hero, alumni"
              className="flex-1 min-w-0 text-[10px] p-1 border border-ink bg-cream font-mono"
            />
          ) : (
            <button
              type="button"
              onClick={startEdit}
              disabled={busy}
              className="flex-1 min-w-0 text-left disabled:opacity-40"
              title="Click to edit tags"
            >
              {piece.tags && piece.tags.length > 0 ? (
                <TagList tags={piece.tags} size="xs" />
              ) : (
                <span className="text-[10px] italic text-muted underline decoration-dotted">
                  + add tags
                </span>
              )}
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] font-mono text-muted">
            {usedBy > 0
              ? `${usedBy} anchor${usedBy === 1 ? "" : "s"}`
              : "unused"}
          </span>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="text-[10px] text-coral border border-coral px-1.5 py-0.5 font-bold uppercase tracking-widest hover:bg-coral hover:text-ink disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

function UploadQueuePanel({
  manifest,
  queue,
  header,
  replaceExisting,
  manifestCollisions,
  busy,
  onPickFiles,
  onUpdateHeader,
  onUpdateRow,
  onRemoveRow,
  onClearQueue,
  onToggleReplace,
  onUpload,
  onCommit,
  onCommitSkippingFailed,
}: {
  manifest: ManifestT;
  queue: Row[];
  header: HeaderMeta;
  replaceExisting: boolean;
  manifestCollisions: number;
  busy: boolean;
  onPickFiles: (files: File[]) => void;
  onUpdateHeader: <K extends keyof HeaderMeta>(
    field: K,
    value: HeaderMeta[K],
  ) => void;
  onUpdateRow: (
    id: string,
    field: RowField,
    value: string | FrameKindT,
  ) => void;
  onRemoveRow: (id: string) => void;
  onClearQueue: () => void;
  onToggleReplace: (v: boolean) => void;
  onUpload: () => void;
  onCommit: () => void;
  onCommitSkippingFailed: () => void;
}) {
  const counts = useMemo(() => {
    let pending = 0,
      uploading = 0,
      done = 0,
      error = 0;
    for (const r of queue) {
      if (r.status === "pending") pending++;
      else if (r.status === "uploading") uploading++;
      else if (r.status === "done") done++;
      else error++;
    }
    return { pending, uploading, done, error, total: queue.length };
  }, [queue]);

  const showHeader = queue.length >= 2;
  const showFullRow = queue.length === 1;
  const canUpload = counts.pending > 0 || counts.error > 0;
  const canCommit = counts.done > 0 && counts.uploading === 0;

  return (
    <section className="bg-cream border-[3px] border-ink p-4 shadow-[5px_5px_0_var(--color-ink)] flex flex-col gap-3 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
          {queue.length === 0
            ? "Upload pieces"
            : `Queue · ${queue.length} file${queue.length === 1 ? "" : "s"}`}
        </div>
        {queue.length > 0 && (
          <button
            type="button"
            onClick={onClearQueue}
            disabled={busy}
            className="text-[10px] text-muted hover:text-coral underline disabled:opacity-40"
          >
            clear queue
          </button>
        )}
      </div>

      <DropZone
        compact={queue.length > 0}
        busy={busy}
        onPickFiles={onPickFiles}
      />

      {showHeader && (
        <div className="border-2 border-ink bg-cream-dark/40 p-2.5 flex flex-col gap-2.5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Apply to all unedited rows
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Artist">
              <input
                type="text"
                value={header.artist}
                onChange={(e) => onUpdateHeader("artist", e.target.value)}
                placeholder="Jane Doe"
                className="w-full text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </Field>
            <Field label="Batch" hint="groups in list">
              <input
                type="text"
                value={header.batch}
                onChange={(e) => onUpdateHeader("batch", e.target.value)}
                placeholder="residency-2026-q3"
                className="w-full font-mono text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </Field>
          </div>
          <Field label="Preferred frame">
            <div className="grid grid-cols-6 gap-1">
              {FRAMES.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => onUpdateHeader("preferredFrame", f)}
                  className={`text-[10px] font-bold border-2 border-ink py-0.5 transition-colors ${
                    header.preferredFrame === f
                      ? "bg-gold"
                      : "bg-cream hover:bg-cream-dark"
                  }`}
                  title={FRAME_LABEL[f]}
                >
                  {f}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Tags" hint="comma-separated">
            <input
              type="text"
              value={header.tags}
              onChange={(e) => onUpdateHeader("tags", e.target.value)}
              placeholder="hero, alumni"
              className="w-full text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </Field>
        </div>
      )}

      {queue.length > 0 && (
        <div className="flex flex-col gap-2">
          {queue.map((r) =>
            showFullRow ? (
              <FullRow
                key={r.id}
                row={r}
                busy={busy}
                onUpdate={(field, value) => onUpdateRow(r.id, field, value)}
                onRemove={() => onRemoveRow(r.id)}
              />
            ) : (
              <CompactRow
                key={r.id}
                row={r}
                busy={busy}
                onUpdate={(field, value) => onUpdateRow(r.id, field, value)}
                onRemove={() => onRemoveRow(r.id)}
              />
            ),
          )}
        </div>
      )}

      {queue.length > 0 && manifestCollisions > 0 && (
        <label className="flex items-start gap-2 text-xs border-2 border-coral bg-coral/10 p-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(e) => onToggleReplace(e.target.checked)}
            className="w-4 h-4 mt-0.5 accent-coral flex-none"
          />
          <span>
            <span className="font-bold">
              {manifestCollisions} slug{manifestCollisions === 1 ? "" : "s"}{" "}
              already exist
            </span>{" "}
            in the manifest.{" "}
            {replaceExisting ? (
              <span className="text-coral font-bold">
                Will overwrite existing pieces on save.
              </span>
            ) : (
              <span>Will be rejected unless you check this box.</span>
            )}
          </span>
        </label>
      )}

      {(counts.uploading > 0 || (counts.total > 0 && busy)) && (
        <ProgressBar counts={counts} />
      )}

      {queue.length > 0 && (
        <div className="flex flex-col gap-2">
          {canUpload && (
            <button
              type="button"
              onClick={onUpload}
              disabled={busy || !canUpload}
              className="bg-gold border-2 border-ink px-4 py-2.5 font-black uppercase tracking-widest text-sm shadow-[4px_4px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0_var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed transition-transform"
            >
              {busy
                ? `Uploading… (${counts.done}/${counts.total})`
                : counts.error > 0 && counts.pending === 0
                  ? `Retry ${counts.error} failed`
                  : `Upload ${counts.pending + counts.error} piece${counts.pending + counts.error === 1 ? "" : "s"}`}
            </button>
          )}
          {canCommit && (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={onCommit}
                disabled={busy || counts.error > 0}
                className="bg-good border-2 border-ink px-4 py-2.5 font-black uppercase tracking-widest text-sm shadow-[4px_4px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0_var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed transition-transform"
                title={
                  counts.error > 0
                    ? "Retry or skip failed rows first"
                    : "Save uploaded pieces to manifest"
                }
              >
                Save {counts.done} to manifest
              </button>
              {counts.error > 0 && (
                <button
                  type="button"
                  onClick={onCommitSkippingFailed}
                  disabled={busy}
                  className="bg-cream border-2 border-ink px-4 py-1.5 font-bold uppercase tracking-widest text-[10px] hover:bg-cream-dark disabled:opacity-40"
                >
                  Skip {counts.error} failed and save {counts.done}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {/* Hint for the empty state, with a quiet note about the existing
          manifest if there's anything to delete/replace. */}
      {queue.length === 0 && (
        <p className="text-[11px] text-muted leading-relaxed">
          Drop one file or a whole folder of images. Multiple files will share
          the artist / batch / frame / tags fields you set above the queue.
          Per-row title and slug are editable inline. Manifest has{" "}
          {Object.keys(manifest.pieces).length} piece
          {Object.keys(manifest.pieces).length === 1 ? "" : "s"} today.
        </p>
      )}
    </section>
  );
}

function DropZone({
  compact,
  busy,
  onPickFiles,
}: {
  compact: boolean;
  busy: boolean;
  onPickFiles: (files: File[]) => void;
}) {
  // Counter pattern: drag events bubble through child elements, so we
  // only flip the visual state when the *net* enter count > 0.
  const [dragDepth, setDragDepth] = useState(0);
  const dragOver = dragDepth > 0;

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragDepth(0);
    if (busy) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) onPickFiles(files);
  }

  function pickInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) onPickFiles(files);
    e.target.value = "";
  }

  return (
    <label
      onDragEnter={(e) => {
        e.preventDefault();
        if (!busy) setDragDepth((d) => d + 1);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        if (!busy) setDragDepth((d) => Math.max(0, d - 1));
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className={`relative block text-center cursor-pointer transition-all border-[3px] ${
        dragOver
          ? "border-coral bg-coral/15 border-dashed"
          : "border-ink border-dashed bg-cream-dark hover:bg-cream"
      } ${busy ? "opacity-60 cursor-wait" : ""} ${
        compact ? "py-2.5 px-3" : "min-h-[160px] p-4"
      }`}
    >
      {compact ? (
        <div className="text-xs text-muted">
          <span className="font-black uppercase tracking-widest text-ink">
            {dragOver ? "Drop to add" : "+ Drop more here"}
          </span>{" "}
          or click to pick
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-2 py-6 text-muted">
          <div
            className={`text-3xl transition-transform ${dragOver ? "scale-125" : ""}`}
            aria-hidden
          >
            ⤓
          </div>
          <div className="font-black uppercase tracking-widest text-sm text-ink">
            {dragOver ? "Drop to upload" : "Drop one file or a folder"}
          </div>
          <div className="text-xs">or click to pick files</div>
          <div className="text-[10px] mt-1">
            PNG · JPG · WEBP · GIF · 8MB each
          </div>
        </div>
      )}
      <input
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-wait"
        disabled={busy}
        onChange={pickInput}
      />
    </label>
  );
}

// FullRow — single-file mode. Looks like the original UploadPanel body:
// preview at top, every field inline, no separate header bar.
function FullRow({
  row,
  busy,
  onUpdate,
  onRemove,
}: {
  row: Row;
  busy: boolean;
  onUpdate: (field: RowField, value: string | FrameKindT) => void;
  onRemove: () => void;
}) {
  const slugInvalid = row.slug.trim() !== "" && !isValidSlug(row.slug.trim());
  return (
    <div className="flex flex-col gap-2.5">
      <div className="border-2 border-ink bg-cream-dark flex items-center justify-center overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={row.preview}
          alt="preview"
          className="max-h-56 max-w-full object-contain"
        />
      </div>
      <div className="text-[10px] font-mono text-muted leading-snug flex items-center justify-between">
        <div>
          <span className="font-bold text-ink">{row.file.name}</span>
          {" · "}
          {(row.file.size / 1024).toFixed(0)} KB · aspect{" "}
          {row.aspect.toFixed(2)}
        </div>
        <StatusBadge row={row} />
      </div>
      <Field
        label="Slug — becomes the piece ID"
        hint={
          slugInvalid ? "must match a-z, 0-9, _, -" : "letters, numbers, dashes"
        }
      >
        <input
          type="text"
          value={row.slug}
          onChange={(e) => onUpdate("slug", e.target.value.toLowerCase())}
          placeholder="jane-doe-01"
          spellCheck={false}
          className={`w-full font-mono text-sm p-1.5 border-2 ${slugInvalid ? "border-coral" : "border-ink"} bg-cream focus:outline-none focus:ring-2 focus:ring-gold`}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Title">
          <input
            type="text"
            value={row.title}
            onChange={(e) => onUpdate("title", e.target.value)}
            placeholder="Smoke Signal"
            className="w-full text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </Field>
        <Field label="Artist">
          <input
            type="text"
            value={row.artist}
            onChange={(e) => onUpdate("artist", e.target.value)}
            placeholder="Jane Doe"
            className="w-full text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </Field>
      </div>
      <Field
        label="Preferred frame"
        hint="renders unless the anchor disallows it"
      >
        <div className="grid grid-cols-3 gap-1.5">
          {FRAMES.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onUpdate("preferredFrame", f)}
              className={`text-[11px] font-bold border-2 border-ink py-1 transition-colors ${
                row.preferredFrame === f
                  ? "bg-gold"
                  : "bg-cream hover:bg-cream-dark"
              }`}
            >
              {f} {FRAME_LABEL[f]}
            </button>
          ))}
        </div>
      </Field>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted uppercase tracking-widest font-bold text-[10px] py-1 hover:text-ink">
          More options (batch, link, tags)
        </summary>
        <div className="flex flex-col gap-2.5 mt-2 pl-1 border-l-2 border-cream-dark">
          <Field label="Batch (folder/show)" hint="groups pieces in the list">
            <input
              type="text"
              value={row.batch}
              onChange={(e) => onUpdate("batch", e.target.value)}
              placeholder="residency-2026-q3"
              className="w-full font-mono text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </Field>
          <Field label="Link">
            <input
              type="text"
              value={row.link}
              onChange={(e) => onUpdate("link", e.target.value)}
              placeholder="https://artist.com/work"
              className="w-full text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </Field>
          <Field label="Tags" hint="comma-separated">
            <input
              type="text"
              value={row.tags}
              onChange={(e) => onUpdate("tags", e.target.value)}
              placeholder="hero, alumni"
              className="w-full text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </Field>
        </div>
      </details>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          disabled={busy && row.status === "uploading"}
          className="text-[10px] text-muted hover:text-coral underline disabled:opacity-40"
        >
          remove from queue
        </button>
      </div>
    </div>
  );
}

// CompactRow — batch mode. Thumbnail + slug + title + status, all inline.
// Frame/artist/batch/link/tags come from the header.
function CompactRow({
  row,
  busy,
  onUpdate,
  onRemove,
}: {
  row: Row;
  busy: boolean;
  onUpdate: (field: RowField, value: string | FrameKindT) => void;
  onRemove: () => void;
}) {
  const slugInvalid = row.slug.trim() !== "" && !isValidSlug(row.slug.trim());
  const done = row.status === "done";

  return (
    <div
      className={`border-2 border-ink p-2 flex gap-2 items-center bg-cream ${done ? "opacity-60" : ""}`}
      title={
        done ? "Already uploaded — will be saved on commit" : row.file.name
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={row.preview}
        alt=""
        className="w-12 h-12 object-cover border border-ink flex-none"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <input
          type="text"
          value={row.slug}
          onChange={(e) => onUpdate("slug", e.target.value.toLowerCase())}
          placeholder="slug"
          disabled={done || row.status === "uploading"}
          spellCheck={false}
          className={`w-full font-mono text-xs p-1 border ${slugInvalid ? "border-coral" : "border-ink/40"} bg-cream focus:outline-none focus:border-ink disabled:bg-cream-dark`}
        />
        <input
          type="text"
          value={row.title}
          onChange={(e) => onUpdate("title", e.target.value)}
          placeholder="title (optional)"
          disabled={done || row.status === "uploading"}
          className="w-full text-xs p-1 border border-ink/40 bg-cream focus:outline-none focus:border-ink disabled:bg-cream-dark"
        />
        {row.status === "error" && (
          <div
            className="text-[10px] text-coral font-mono truncate"
            title={row.error}
          >
            {row.error}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 flex-none">
        <StatusBadge row={row} />
        <button
          type="button"
          onClick={onRemove}
          disabled={busy && row.status === "uploading"}
          className="text-[10px] text-muted hover:text-coral disabled:opacity-40"
          title="Remove from queue"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ row }: { row: Row }) {
  const map: Record<Row["status"], { label: string; cls: string }> = {
    pending: { label: "queued", cls: "bg-cream-dark text-muted" },
    uploading: { label: "⋯ uploading", cls: "bg-gold text-ink" },
    done: { label: "✓ done", cls: "bg-good text-ink" },
    error: { label: "✕ failed", cls: "bg-coral text-ink" },
  };
  const { label, cls } = map[row.status];
  return (
    <span
      className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 border border-ink ${cls}`}
    >
      {label}
    </span>
  );
}

function ProgressBar({
  counts,
}: {
  counts: {
    pending: number;
    uploading: number;
    done: number;
    error: number;
    total: number;
  };
}) {
  const settled = counts.done + counts.error;
  const pct = counts.total > 0 ? Math.round((settled / counts.total) * 100) : 0;
  return (
    <div className="border-2 border-ink p-2 bg-cream-dark/40 flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] font-mono">
        <span>
          {counts.done}/{counts.total} done
          {counts.error > 0 ? ` · ${counts.error} failed` : ""}
          {counts.uploading > 0 ? ` · ${counts.uploading} in flight` : ""}
        </span>
        <span className="font-bold">{pct}%</span>
      </div>
      <div className="h-1.5 bg-cream border border-ink overflow-hidden">
        <div
          className="h-full bg-gold transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
          {label}
        </div>
        {hint && <div className="text-[9px] text-muted italic">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
