"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FRAME_LABEL,
  Piece,
  type FrameKindT,
  type ManifestT,
  type PieceT,
} from "@/schema/manifest";
import { fetchManifest, saveManifest } from "@/lib/client";

const FRAMES: FrameKindT[] = ["A", "B", "C", "D", "E", "F"];

type Draft = {
  file: File | null;
  preview: string | null;
  aspect: number | null;
  slug: string;
  title: string;
  artist: string;
  preferredFrame: FrameKindT;
  batch: string;
  link: string;
  tags: string;
};

const EMPTY_DRAFT: Draft = {
  file: null,
  preview: null,
  aspect: null,
  slug: "",
  title: "",
  artist: "",
  preferredFrame: "A",
  batch: "",
  link: "",
  tags: "",
};

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

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export default function PiecesView() {
  const [manifest, setManifest] = useState<ManifestT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  useEffect(() => {
    fetchManifest()
      .then(setManifest)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    return () => {
      if (draft.preview) URL.revokeObjectURL(draft.preview);
    };
  }, [draft.preview]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2400);
  }

  async function pickFile(file: File | null) {
    if (!file) {
      setDraft({ ...draft, file: null, preview: null, aspect: null });
      return;
    }
    try {
      const { preview, aspect } = await fileToImageMeta(file);
      if (draft.preview) URL.revokeObjectURL(draft.preview);
      setDraft({
        ...draft,
        file,
        preview,
        aspect,
        slug: draft.slug || slugify(file.name.replace(/\.[^.]+$/, "")),
      });
    } catch (e) {
      setError(String(e));
    }
  }

  async function uploadAndSave() {
    if (!manifest || !draft.file || !draft.aspect) return;
    const slug = draft.slug.trim();
    if (!slug) {
      alert("Slug is required.");
      return;
    }
    if (manifest.pieces[slug]) {
      if (
        !confirm(`Piece "${slug}" already exists. Replace it with this upload?`)
      ) {
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", draft.file);
      form.append("slug", slug);
      if (draft.batch.trim()) form.append("batch", draft.batch.trim());

      const res = await fetch("/api/pieces/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`upload ${res.status}: ${text}`);
      }
      const { url } = (await res.json()) as { url: string };

      const tags = draft.tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const piece: PieceT = {
        id: slug,
        src: url,
        aspect: Number(draft.aspect.toFixed(4)),
        preferredFrame: draft.preferredFrame,
        ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
        ...(draft.artist.trim() ? { artist: draft.artist.trim() } : {}),
        ...(draft.link.trim() ? { link: draft.link.trim() } : {}),
        ...(draft.batch.trim() ? { batch: draft.batch.trim() } : {}),
        ...(tags.length ? { tags } : {}),
      };

      const v = Piece.safeParse(piece);
      if (!v.success) {
        throw new Error(
          `invalid piece: ${v.error.issues[0]?.message ?? v.error.message}`,
        );
      }

      const next: ManifestT = {
        ...manifest,
        pieces: { ...manifest.pieces, [slug]: piece },
      };
      const saved = await saveManifest(next);
      setManifest(saved);
      if (draft.preview) URL.revokeObjectURL(draft.preview);
      setDraft(EMPTY_DRAFT);
      showToast(`Uploaded "${slug}" · v${saved.version}`);
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

  const byBatch = useMemo(() => {
    if (!manifest) return new Map<string, PieceT[]>();
    const m = new Map<string, PieceT[]>();
    for (const p of Object.values(manifest.pieces)) {
      const key = p.batch || "(unbatched)";
      const list = m.get(key) ?? [];
      list.push(p);
      m.set(key, list);
    }
    for (const list of m.values())
      list.sort((a, b) => a.id.localeCompare(b.id));
    return m;
  }, [manifest]);

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
                      />
                    ))}
                  </div>
                </div>
              ))
          )}
        </section>

        <aside>
          <UploadPanel
            draft={draft}
            busy={busy}
            onPickFile={pickFile}
            onChange={setDraft}
            onSubmit={uploadAndSave}
            onReset={() => {
              if (draft.preview) URL.revokeObjectURL(draft.preview);
              setDraft(EMPTY_DRAFT);
            }}
          />
        </aside>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-ink text-cream px-5 py-3 border-[3px] border-gold font-bold uppercase tracking-widest text-sm shadow-[4px_4px_0_var(--color-ink)]">
          ✓ {toast}
        </div>
      )}
      {error && manifest && (
        <div className="fixed bottom-6 left-6 bg-coral text-ink px-5 py-3 border-[3px] border-ink font-bold text-sm flex items-center gap-3">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="underline text-xs"
          >
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function PieceCard({
  piece,
  usedBy,
  busy,
  onDelete,
}: {
  piece: PieceT;
  usedBy: number;
  busy: boolean;
  onDelete: () => void;
}) {
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
        <div className="flex items-center justify-between mt-1.5">
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

function UploadPanel({
  draft,
  busy,
  onPickFile,
  onChange,
  onSubmit,
  onReset,
}: {
  draft: Draft;
  busy: boolean;
  onPickFile: (file: File | null) => void;
  onChange: (next: Draft) => void;
  onSubmit: () => void;
  onReset: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const hasFile = !!draft.file && !!draft.preview;
  const slug = draft.slug.trim();
  const missing: string[] = [];
  if (!hasFile) missing.push("file");
  if (!slug) missing.push("slug");
  const ready = missing.length === 0 && !busy;

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onPickFile(file);
  }

  function handleDragEvt(e: React.DragEvent<HTMLLabelElement>, over: boolean) {
    e.preventDefault();
    if (!busy) setDragOver(over);
  }

  return (
    <section className="bg-cream border-[3px] border-ink p-4 shadow-[5px_5px_0_var(--color-ink)] flex flex-col gap-3 sticky top-4">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
          Upload piece
        </div>
        {hasFile && (
          <button
            type="button"
            onClick={onReset}
            disabled={busy}
            className="text-[10px] text-muted hover:text-coral underline disabled:opacity-40"
          >
            clear
          </button>
        )}
      </div>

      <label
        onDragEnter={(e) => handleDragEvt(e, true)}
        onDragOver={(e) => handleDragEvt(e, true)}
        onDragLeave={(e) => handleDragEvt(e, false)}
        onDrop={handleDrop}
        className={`relative block min-h-[180px] p-4 text-center cursor-pointer transition-all border-[3px] ${
          dragOver
            ? "border-coral bg-coral/15 border-dashed"
            : hasFile
              ? "border-good border-solid bg-cream-dark"
              : "border-ink border-dashed bg-cream-dark hover:bg-cream"
        } ${busy ? "opacity-60 cursor-wait" : ""}`}
      >
        {hasFile && draft.preview ? (
          <div className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={draft.preview}
              alt="preview"
              className="max-h-48 max-w-full object-contain border border-ink/20"
              style={{ imageRendering: "auto" }}
            />
            <div className="text-[10px] font-mono text-muted leading-snug">
              <div className="font-bold text-ink">{draft.file?.name}</div>
              <div>
                {((draft.file?.size ?? 0) / 1024).toFixed(0)} KB ·{" "}
                {draft.aspect ? `aspect ${draft.aspect.toFixed(2)}` : "…"}
              </div>
            </div>
            <div className="text-[10px] text-coral font-bold uppercase tracking-widest">
              {dragOver ? "Drop to replace" : "Drop or click to replace"}
            </div>
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
              {dragOver ? "Drop to upload" : "Drop image here"}
            </div>
            <div className="text-xs">or click to pick a file</div>
            <div className="text-[10px] mt-1">
              PNG · JPG · WEBP · GIF · 8MB max
            </div>
          </div>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-wait"
          disabled={busy}
          onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
        />
      </label>

      <Field
        label="Slug — becomes the piece ID"
        hint={
          hasFile && !slug
            ? "auto-suggested from filename; edit if you want"
            : "letters, numbers, dashes"
        }
      >
        <input
          type="text"
          value={draft.slug}
          onChange={(e) =>
            onChange({ ...draft, slug: e.target.value.toLowerCase() })
          }
          placeholder="jane-doe-01"
          spellCheck={false}
          className="w-full font-mono text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Title">
          <input
            type="text"
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            placeholder="Smoke Signal"
            className="w-full text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </Field>
        <Field label="Artist">
          <input
            type="text"
            value={draft.artist}
            onChange={(e) => onChange({ ...draft, artist: e.target.value })}
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
              onClick={() => onChange({ ...draft, preferredFrame: f })}
              className={`text-[11px] font-bold border-2 border-ink py-1 transition-colors ${
                draft.preferredFrame === f
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
        <div className="flex flex-col gap-3 mt-2 pl-1 border-l-2 border-cream-dark">
          <Field label="Batch (folder/show)" hint="groups pieces in the list">
            <input
              type="text"
              value={draft.batch}
              onChange={(e) => onChange({ ...draft, batch: e.target.value })}
              placeholder="residency-2026-q3"
              className="w-full font-mono text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </Field>
          <Field label="Link">
            <input
              type="text"
              value={draft.link}
              onChange={(e) => onChange({ ...draft, link: e.target.value })}
              placeholder="https://artist.com/work"
              className="w-full text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </Field>
          <Field label="Tags" hint="comma-separated">
            <input
              type="text"
              value={draft.tags}
              onChange={(e) => onChange({ ...draft, tags: e.target.value })}
              placeholder="hero, alumni"
              className="w-full text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </Field>
        </div>
      </details>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!ready}
        title={
          ready
            ? "Upload to Vercel Blob and save to manifest"
            : `Need: ${missing.join(", ")}`
        }
        className="bg-gold border-2 border-ink px-4 py-3 font-black uppercase tracking-widest text-sm shadow-[4px_4px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0_var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed transition-transform"
      >
        {busy
          ? "Uploading…"
          : ready
            ? "Upload"
            : `Add ${missing.join(" + ")} to upload`}
      </button>
    </section>
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
