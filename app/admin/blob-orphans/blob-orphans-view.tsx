"use client";

import { useEffect, useMemo, useState } from "react";

type Orphan = {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
};

type ListResp = {
  orphans: Orphan[];
  totalBlobs: number;
  totalReferenced: number;
  manifestVersion: number;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatAge(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const ms = Date.now() - t;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function isImage(pathname: string): boolean {
  return /\.(png|jpg|jpeg|webp|gif)$/i.test(pathname);
}

function isAudio(pathname: string): boolean {
  return /\.(mp3|m4a|mp4|ogg|oga)$/i.test(pathname);
}

export default function BlobOrphansView() {
  const [data, setData] = useState<ListResp | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/blob-orphans", { cache: "no-store" });
      if (!res.ok) throw new Error(`list ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as ListResp;
      setData(json);
      setSelected(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // Defer to a microtask so the effect body itself never calls setState
    // synchronously (react-hooks/set-state-in-effect).
    Promise.resolve().then(load);
  }, []);

  const totalSize = useMemo(
    () => (data?.orphans ?? []).reduce((s, o) => s + o.size, 0),
    [data],
  );
  const selectedSize = useMemo(
    () =>
      (data?.orphans ?? [])
        .filter((o) => selected.has(o.url))
        .reduce((s, o) => s + o.size, 0),
    [data, selected],
  );

  function toggle(url: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function toggleAll() {
    if (!data) return;
    if (selected.size === data.orphans.length) setSelected(new Set());
    else setSelected(new Set(data.orphans.map((o) => o.url)));
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (
      !confirm(
        `Delete ${selected.size} orphan blob${selected.size === 1 ? "" : "s"}? ` +
          `This is permanent and frees ${formatBytes(selectedSize)} of storage.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/blob-orphans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: [...selected] }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        deleted?: number;
        refused?: number;
      };
      if (!res.ok)
        throw new Error(`delete ${res.status}: ${JSON.stringify(json)}`);
      const msg =
        `Deleted ${json.deleted ?? 0}` +
        (json.refused ? ` · refused ${json.refused} (now referenced)` : "");
      setToast(msg);
      setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[1100px] mx-auto px-7 py-8">
      <div className="flex items-end justify-between pb-4 border-b-2 border-ink mb-6">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-wide">
            Blob Orphans
          </h1>
          <p className="text-muted text-sm mt-1">
            Blobs in storage that no piece, book cover, or page references. Safe
            to delete — anything still in use is filtered out and double-checked
            at delete time.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="bg-cream border-2 border-ink px-4 py-2 font-bold uppercase tracking-widest text-xs shadow-[3px_3px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-40 transition-transform"
        >
          {busy ? "…" : "Refresh"}
        </button>
      </div>

      {!data && !error && (
        <div className="p-8 text-muted">Scanning blob storage…</div>
      )}

      {data && (
        <div className="flex items-center justify-between text-xs font-mono mb-4 text-muted">
          <div>
            {data.totalBlobs} blob{data.totalBlobs === 1 ? "" : "s"} total ·{" "}
            {data.totalReferenced} referenced ·{" "}
            <span className="text-ink font-bold">
              {data.orphans.length} orphan{data.orphans.length === 1 ? "" : "s"}{" "}
              ({formatBytes(totalSize)})
            </span>{" "}
            · manifest v{data.manifestVersion}
          </div>
          {data.orphans.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs underline hover:text-ink"
              >
                {selected.size === data.orphans.length
                  ? "deselect all"
                  : "select all"}
              </button>
              <button
                type="button"
                onClick={deleteSelected}
                disabled={busy || selected.size === 0}
                className="bg-coral text-ink border-2 border-ink px-3 py-1.5 font-black uppercase tracking-widest text-xs shadow-[3px_3px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-40 transition-transform"
              >
                Delete {selected.size > 0 ? selected.size : ""} ·{" "}
                {formatBytes(selectedSize)}
              </button>
            </div>
          )}
        </div>
      )}

      {data && data.orphans.length === 0 && (
        <div className="border-2 border-dashed border-good p-12 text-center">
          <div className="text-2xl mb-2">✓</div>
          <p className="font-bold uppercase tracking-widest">No orphans</p>
          <p className="text-muted text-sm mt-1">
            Every blob in storage is referenced by the live manifest.
          </p>
        </div>
      )}

      {data && data.orphans.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {data.orphans.map((o) => {
            const checked = selected.has(o.url);
            return (
              <label
                key={o.url}
                className={`bg-cream border-[3px] cursor-pointer flex flex-col text-sm transition-shadow ${
                  checked
                    ? "border-coral shadow-[4px_4px_0_var(--color-coral)]"
                    : "border-ink shadow-[3px_3px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_var(--color-ink)]"
                }`}
              >
                <div className="bg-cream-dark border-b-2 border-ink aspect-square flex items-center justify-center overflow-hidden p-2">
                  {isImage(o.pathname) ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={o.url}
                      alt={o.pathname}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : isAudio(o.pathname) ? (
                    <div className="flex flex-col items-center gap-2 w-full">
                      <span className="text-muted text-[10px] font-bold uppercase tracking-widest">
                        audio
                      </span>
                      <audio
                        controls
                        preload="none"
                        src={o.url}
                        className="w-full"
                      />
                    </div>
                  ) : (
                    <span className="text-muted text-xs font-mono">
                      no preview
                    </span>
                  )}
                </div>
                <div className="p-2 flex flex-col gap-1">
                  <div
                    className="text-[10px] font-mono truncate"
                    title={o.pathname}
                  >
                    {o.pathname}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted font-mono">
                    <span>{formatBytes(o.size)}</span>
                    <span>{formatAge(o.uploadedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest">
                      {checked ? "× delete" : "keep"}
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(o.url)}
                      className="w-4 h-4 accent-coral"
                    />
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-ink text-cream px-5 py-3 border-[3px] border-gold font-bold uppercase tracking-widest text-sm shadow-[4px_4px_0_var(--color-ink)]">
          ✓ {toast}
        </div>
      )}
      {error && (
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
