"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ManifestT,
  NowPlayingT,
  PlaylistT,
  TrackT,
} from "@/schema/manifest";
import { fetchManifest, saveManifest, uploadTrack } from "@/lib/client";
import { isValidSlug, slugifyFilename } from "@/lib/upload-queue";

const MIME_BY_EXT: Record<string, TrackT["mime"]> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
};

function inferMime(file: File): TrackT["mime"] | null {
  if (file.type === "audio/mpeg") return "audio/mpeg";
  if (file.type === "audio/mp4") return "audio/mp4";
  if (file.type === "audio/ogg") return "audio/ogg";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? null;
}

function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const d = Number.isFinite(audio.duration) ? audio.duration : null;
      cleanup();
      resolve(d);
    };
    audio.onerror = () => {
      cleanup();
      resolve(null);
    };
    audio.src = url;
  });
}

function formatDuration(sec: number | undefined): string {
  if (!sec || !Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function MusicView() {
  const [manifest, setManifest] = useState<ManifestT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [savingFor, setSavingFor] = useState<string | null>(null);

  useEffect(() => {
    fetchManifest()
      .then(setManifest)
      .catch((e) => setError(String(e)));
  }, []);

  function showToast(msg: string, ms = 1800) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), ms);
  }

  async function patchManifest(
    mutate: (m: ManifestT) => ManifestT,
    busyKey: string,
  ) {
    if (!manifest) return;
    const next = mutate(manifest);
    setSavingFor(busyKey);
    setError(null);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      showToast(`Saved · v${saved.version}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingFor(null);
    }
  }

  async function patchTrack(id: string, patch: Partial<TrackT>) {
    await patchManifest((m) => {
      const cur = m.tracks[id];
      if (!cur) return m;
      return { ...m, tracks: { ...m.tracks, [id]: { ...cur, ...patch } } };
    }, `track:${id}`);
  }

  async function deleteTrack(id: string) {
    if (!manifest) return;
    const t = manifest.tracks[id];
    if (!t) return;
    const np = manifest.nowPlaying;
    if (np.kind === "track" && np.trackId === id) {
      alert(
        `"${t.title}" is currently set as Now Playing. Switch the venue to Off or another track before deleting.`,
      );
      return;
    }
    if (!confirm(`Delete track "${t.title}"? This cannot be undone.`)) return;
    await patchManifest((m) => {
      const rest = { ...m.tracks };
      delete rest[id];
      return { ...m, tracks: rest };
    }, `track:${id}`);
  }

  async function saveNowPlaying(np: NowPlayingT) {
    await patchManifest((m) => ({ ...m, nowPlaying: np }), "nowPlaying");
  }

  async function savePlaylist(pl: PlaylistT) {
    await patchManifest(
      (m) => ({ ...m, playlists: { ...m.playlists, [pl.id]: pl } }),
      `playlist:${pl.id}`,
    );
  }

  async function deletePlaylist(id: string) {
    if (!manifest) return;
    const pl = manifest.playlists[id];
    if (!pl) return;
    const np = manifest.nowPlaying;
    if (np.kind === "playlist" && np.playlistId === id) {
      alert(
        `"${pl.name}" is the playlist currently selected as Now Playing. Switch to a different playlist or mode before deleting.`,
      );
      return;
    }
    if (
      !confirm(`Delete playlist "${pl.name}"? Tracks themselves stay safe.`)
    ) {
      return;
    }
    await patchManifest((m) => {
      const rest = { ...m.playlists };
      delete rest[id];
      return { ...m, playlists: rest };
    }, `playlist:${id}`);
  }

  if (error && !manifest) {
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

  // Defensive ?? {} — old manifests in Redis may pre-date the tracks field.
  // The API now parses through the schema (which fills the default), but
  // this guards against any other code path serving an unparsed manifest.
  const trackList = Object.values(manifest.tracks ?? {}).sort((a, b) =>
    a.title.localeCompare(b.title),
  );
  const playlistList = Object.values(manifest.playlists ?? {}).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <div className="max-w-5xl mx-auto px-7 py-8 pb-24">
      <div className="flex items-end justify-between pb-4 border-b-2 border-ink mb-7">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-wide">Music</h1>
          <p className="text-muted text-sm mt-1">
            {trackList.length} track{trackList.length === 1 ? "" : "s"} · v
            {manifest.version}
          </p>
        </div>
      </div>

      <NowPlayingPanel
        nowPlaying={manifest.nowPlaying}
        tracks={trackList}
        playlists={playlistList}
        saving={savingFor === "nowPlaying"}
        onSave={saveNowPlaying}
      />

      <PlaylistsPanel
        playlists={playlistList}
        tracks={trackList}
        tracksById={manifest.tracks}
        existingIds={new Set(Object.keys(manifest.playlists))}
        savingFor={savingFor}
        onSave={savePlaylist}
        onDelete={deletePlaylist}
      />

      <UploadPanel
        existingSlugs={new Set(Object.keys(manifest.tracks))}
        onUploaded={async (track) => {
          await patchManifest(
            (m) => ({
              ...m,
              tracks: { ...m.tracks, [track.id]: track },
            }),
            `upload:${track.id}`,
          );
        }}
        busy={savingFor?.startsWith("upload:") ?? false}
      />

      <section className="mt-8">
        <h2 className="inline-block bg-ink text-cream px-3.5 py-1.5 text-sm font-black uppercase tracking-widest mb-3">
          Library{" "}
          <span className="bg-gold text-ink px-2 py-0.5 rounded-xl text-[11px] ml-2">
            {trackList.length}
          </span>
        </h2>
        {trackList.length === 0 ? (
          <div className="border-2 border-dashed border-muted p-12 text-center text-muted">
            <p className="font-bold uppercase tracking-widest mb-2">
              No tracks yet
            </p>
            <p className="text-sm">
              Upload an MP3, M4A, or OGG above. The file lands in Vercel Blob
              and the curator can play it venue-wide.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {trackList.map((t) => (
              <TrackRow
                key={t.id}
                track={t}
                saving={savingFor === `track:${t.id}`}
                isPlaying={
                  manifest.nowPlaying.kind === "track" &&
                  manifest.nowPlaying.trackId === t.id
                }
                onPatch={(patch) => patchTrack(t.id, patch)}
                onDelete={() => deleteTrack(t.id)}
              />
            ))}
          </div>
        )}
      </section>

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

// =========================================================
// Now Playing panel
// =========================================================

function NowPlayingPanel({
  nowPlaying,
  tracks,
  playlists,
  saving,
  onSave,
}: {
  nowPlaying: NowPlayingT;
  tracks: TrackT[];
  playlists: PlaylistT[];
  saving: boolean;
  onSave: (np: NowPlayingT) => Promise<void>;
}) {
  const [kind, setKind] = useState<NowPlayingT["kind"]>(nowPlaying.kind);
  const [trackId, setTrackId] = useState<string>(
    nowPlaying.kind === "track" ? nowPlaying.trackId : (tracks[0]?.id ?? ""),
  );
  const [trackLoop, setTrackLoop] = useState<boolean>(
    nowPlaying.kind === "track" ? nowPlaying.loop : false,
  );
  const [playlistLoop, setPlaylistLoop] = useState<boolean>(
    nowPlaying.kind === "playlist" ? nowPlaying.loop : true,
  );
  // "" sentinel = "all tracks alphabetical" (legacy behavior, no playlistId).
  const [playlistId, setPlaylistId] = useState<string>(
    nowPlaying.kind === "playlist" ? (nowPlaying.playlistId ?? "") : "",
  );
  const [streamUrl, setStreamUrl] = useState<string>(
    nowPlaying.kind === "stream" ? nowPlaying.streamUrl : "",
  );

  // Resync when the manifest finishes saving (so the panel always reflects
  // truth after a successful save). Deferred to a microtask to satisfy
  // react-hooks/set-state-in-effect — same pattern as
  // app/admin/blob-orphans/blob-orphans-view.tsx.
  useEffect(() => {
    Promise.resolve().then(() => {
      setKind(nowPlaying.kind);
      if (nowPlaying.kind === "track") {
        setTrackId(nowPlaying.trackId);
        setTrackLoop(nowPlaying.loop);
      }
      if (nowPlaying.kind === "playlist") {
        setPlaylistLoop(nowPlaying.loop);
        setPlaylistId(nowPlaying.playlistId ?? "");
      }
      if (nowPlaying.kind === "stream") setStreamUrl(nowPlaying.streamUrl);
    });
  }, [nowPlaying]);

  const selectedTrack = tracks.find((t) => t.id === trackId);
  const selectedPlaylist = playlistId
    ? playlists.find((p) => p.id === playlistId)
    : null;

  const draft: NowPlayingT | null =
    kind === "off"
      ? { kind: "off" }
      : kind === "track" && trackId
        ? { kind: "track", trackId, loop: trackLoop }
        : kind === "playlist"
          ? {
              kind: "playlist",
              loop: playlistLoop,
              ...(playlistId ? { playlistId } : {}),
            }
          : kind === "stream" && /^https?:\/\/.+/.test(streamUrl)
            ? { kind: "stream", streamUrl }
            : null;

  const dirty =
    draft !== null && JSON.stringify(draft) !== JSON.stringify(nowPlaying);

  function playlistLabel(np: NowPlayingT & { kind: "playlist" }): string {
    if (np.playlistId) {
      const pl = playlists.find((p) => p.id === np.playlistId);
      if (pl)
        return `Playlist · ${pl.name} · ${pl.trackIds.length} track${pl.trackIds.length === 1 ? "" : "s"}`;
      return `Playlist · ${np.playlistId} (missing)`;
    }
    return `Playlist · all ${tracks.length} track${tracks.length === 1 ? "" : "s"}`;
  }

  const currentLabel =
    nowPlaying.kind === "off"
      ? "Off — silence in the venue"
      : nowPlaying.kind === "track"
        ? `Track · ${tracks.find((t) => t.id === nowPlaying.trackId)?.title ?? nowPlaying.trackId}${nowPlaying.loop ? " · looping" : ""}`
        : nowPlaying.kind === "playlist"
          ? `${playlistLabel(nowPlaying)}${nowPlaying.loop ? " · looping" : ""}`
          : `Live stream · ${nowPlaying.streamUrl}`;

  return (
    <section className="bg-cream border-[3px] border-ink shadow-[4px_4px_0_var(--color-ink)] p-5 mb-8">
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <h2 className="text-xl font-black uppercase tracking-widest">
          Now Playing
        </h2>
        <span
          className="text-xs font-mono text-muted truncate"
          title={currentLabel}
        >
          {currentLabel}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <ModeButton
          active={kind === "off"}
          onClick={() => setKind("off")}
          label="Off"
        />
        <ModeButton
          active={kind === "playlist"}
          onClick={() => setKind("playlist")}
          label="Playlist"
          disabled={tracks.length === 0}
          title={tracks.length === 0 ? "Upload a track first" : undefined}
        />
        <ModeButton
          active={kind === "track"}
          onClick={() => setKind("track")}
          label="Single track"
          disabled={tracks.length === 0}
          title={tracks.length === 0 ? "Upload a track first" : undefined}
        />
        <ModeButton
          active={kind === "stream"}
          onClick={() => setKind("stream")}
          label="Live stream"
        />
      </div>

      {kind === "track" && (
        <div className="flex flex-col gap-3 mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
              Track
            </span>
            <select
              value={trackId}
              onChange={(e) => setTrackId(e.target.value)}
              className="text-sm p-2 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
            >
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                  {t.artist ? ` — ${t.artist}` : ""}
                </option>
              ))}
            </select>
          </label>
          {selectedTrack && (
            <audio
              key={selectedTrack.id}
              controls
              src={selectedTrack.src}
              loop={trackLoop}
              className="w-full"
            />
          )}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={trackLoop}
              onChange={(e) => setTrackLoop(e.target.checked)}
              className="w-4 h-4 accent-gold"
            />
            <span className="text-xs font-bold uppercase tracking-widest">
              Loop this track
            </span>
          </label>
        </div>
      )}

      {kind === "playlist" &&
        (() => {
          const displayTracks: TrackT[] = selectedPlaylist
            ? (selectedPlaylist.trackIds
                .map((id) => tracks.find((t) => t.id === id))
                .filter(Boolean) as TrackT[])
            : tracks;
          const missing = selectedPlaylist
            ? selectedPlaylist.trackIds.filter(
                (id) => !tracks.some((t) => t.id === id),
              )
            : [];
          return (
            <div className="flex flex-col gap-3 mb-4">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                  Which playlist?
                </span>
                <select
                  value={playlistId}
                  onChange={(e) => setPlaylistId(e.target.value)}
                  className="text-sm p-2 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
                >
                  <option value="">— All tracks (alphabetical) —</option>
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.trackIds.length})
                    </option>
                  ))}
                </select>
                {playlists.length === 0 && (
                  <span className="text-[10px] text-muted italic mt-1">
                    No named playlists yet. Create one in the Playlists section
                    below, or leave this set to “All tracks”.
                  </span>
                )}
              </label>
              <div className="border-2 border-ink bg-cream-dark/40 p-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">
                  Playlist order{" "}
                  {selectedPlaylist
                    ? `(${selectedPlaylist.name})`
                    : "(alphabetical by title)"}
                </div>
                {displayTracks.length === 0 ? (
                  <div className="text-[11px] italic text-muted">
                    This playlist is empty — add tracks to it below.
                  </div>
                ) : (
                  <ol className="flex flex-col gap-1 text-xs">
                    {displayTracks.map((t, i) => (
                      <li
                        key={t.id}
                        className="flex items-baseline gap-2 font-mono"
                      >
                        <span className="text-muted tabular-nums w-5 text-right">
                          {i + 1}.
                        </span>
                        <span className="font-bold truncate">{t.title}</span>
                        {t.artist && (
                          <span className="text-muted truncate">
                            — {t.artist}
                          </span>
                        )}
                        {t.durationSec && (
                          <span className="text-muted ml-auto flex-none">
                            {formatDuration(t.durationSec)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                {missing.length > 0 && (
                  <div className="text-[10px] text-coral font-bold mt-2">
                    {missing.length} track{missing.length === 1 ? "" : "s"} in
                    this playlist no longer exist in the library and will be
                    skipped: {missing.join(", ")}
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={playlistLoop}
                  onChange={(e) => setPlaylistLoop(e.target.checked)}
                  className="w-4 h-4 accent-gold"
                />
                <span className="text-xs font-bold uppercase tracking-widest">
                  Loop the playlist
                </span>
                <span className="text-[10px] text-muted normal-case font-normal tracking-normal">
                  (when the last track ends, restart from the first)
                </span>
              </label>
            </div>
          );
        })()}

      {kind === "stream" && (
        <div className="flex flex-col gap-3 mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
              Live stream URL
            </span>
            <input
              type="url"
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              placeholder="https://stream.example.com/live.mp3"
              className="text-sm p-2 border-2 border-ink bg-cream font-mono focus:outline-none focus:ring-2 focus:ring-gold"
            />
          </label>
          {/^https?:\/\/.+/.test(streamUrl) && (
            <audio
              key={streamUrl}
              controls
              src={streamUrl}
              className="w-full"
            />
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => draft && onSave(draft)}
          disabled={!dirty || saving || !draft}
          className="bg-gold border-2 border-ink px-5 py-2 font-black uppercase tracking-widest text-sm shadow-[3px_3px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed transition-transform"
        >
          {saving ? "Saving…" : dirty ? "Save now playing" : "Saved"}
        </button>
      </div>
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-4 py-2 border-2 border-ink font-bold uppercase tracking-widest text-xs transition-shadow ${
        active
          ? "bg-ink text-cream shadow-[3px_3px_0_var(--color-gold)]"
          : "bg-cream hover:bg-cream-dark shadow-[2px_2px_0_var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-cream"
      }`}
    >
      {label}
    </button>
  );
}

// =========================================================
// Upload panel
// =========================================================

function UploadPanel({
  existingSlugs,
  onUploaded,
  busy,
}: {
  existingSlugs: Set<string>;
  onUploaded: (track: TrackT) => Promise<void>;
  busy: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [artist, setArtist] = useState("");
  const [duration, setDuration] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setSlug("");
    setSlugTouched(false);
    setTitle("");
    setTitleTouched(false);
    setArtist("");
    setDuration(null);
    setLocalError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onPickFile(picked: File | null) {
    setLocalError(null);
    setFile(picked);
    setDuration(null);
    if (!picked) return;
    if (!slugTouched) setSlug(slugifyFilename(picked.name));
    if (!titleTouched) setTitle(picked.name.replace(/\.[^.]+$/, ""));
    const d = await probeDuration(picked);
    setDuration(d);
  }

  const mime = file ? inferMime(file) : null;
  const slugCollides = slug && existingSlugs.has(slug);
  const canUpload =
    !!file &&
    !!mime &&
    isValidSlug(slug) &&
    !slugCollides &&
    title.trim().length > 0 &&
    !uploading &&
    !busy;

  async function doUpload() {
    if (!file || !mime || !canUpload) return;
    setUploading(true);
    setLocalError(null);
    try {
      const { url } = await uploadTrack(file, slug);
      const track: TrackT = {
        id: slug,
        src: url,
        title: title.trim(),
        artist: artist.trim() || undefined,
        mime,
        gainDb: 0,
        ...(duration ? { durationSec: duration } : {}),
      };
      await onUploaded(track);
      reset();
    } catch (e) {
      setLocalError(String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="bg-cream border-[3px] border-ink shadow-[4px_4px_0_var(--color-ink)] p-5 mb-2">
      <h2 className="text-xl font-black uppercase tracking-widest mb-4">
        Upload track
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            File (MP3, M4A, OGG — up to 20 MB)
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/mpeg,audio/mp4,audio/ogg,.mp3,.m4a,.ogg,.oga"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            className="text-xs p-1.5 border-2 border-ink bg-cream file:mr-3 file:border-0 file:bg-ink file:text-cream file:px-3 file:py-1 file:font-bold file:uppercase file:tracking-widest file:text-[10px] file:cursor-pointer"
          />
          {file && (
            <span className="text-[10px] font-mono text-muted mt-1">
              {formatBytes(file.size)}
              {duration ? ` · ${formatDuration(duration)}` : ""}
              {mime ? ` · ${mime}` : " · unknown type"}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Slug (used as ID + filename)
          </span>
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            placeholder="my-track"
            className="text-sm p-2 border-2 border-ink bg-cream font-mono focus:outline-none focus:ring-2 focus:ring-gold"
          />
          {slugCollides && (
            <span className="text-[10px] text-coral font-bold">
              ✕ a track with this id already exists
            </span>
          )}
          {slug && !isValidSlug(slug) && (
            <span className="text-[10px] text-coral font-bold">
              ✕ a-z, 0-9, _, - only; must start alphanumeric
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Title
          </span>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleTouched(true);
            }}
            placeholder="Display title"
            className="text-sm p-2 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Artist (optional)
          </span>
          <input
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Artist name"
            className="text-sm p-2 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </label>
      </div>

      <div className="flex items-center justify-end gap-3 mt-4">
        {file && (
          <button
            type="button"
            onClick={reset}
            disabled={uploading}
            className="text-xs underline text-muted hover:text-ink disabled:opacity-40"
          >
            clear
          </button>
        )}
        <button
          type="button"
          onClick={doUpload}
          disabled={!canUpload}
          className="bg-gold border-2 border-ink px-5 py-2 font-black uppercase tracking-widest text-sm shadow-[3px_3px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed transition-transform"
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>

      {localError && (
        <div className="mt-3 border-2 border-coral text-coral p-2 text-xs font-mono break-words">
          {localError}
        </div>
      )}
    </section>
  );
}

// =========================================================
// Track row (library item)
// =========================================================

function TrackRow({
  track,
  saving,
  isPlaying,
  onPatch,
  onDelete,
}: {
  track: TrackT;
  saving: boolean;
  isPlaying: boolean;
  onPatch: (patch: Partial<TrackT>) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist ?? "");

  useEffect(() => {
    Promise.resolve().then(() => {
      setTitle(track.title);
      setArtist(track.artist ?? "");
    });
  }, [track.title, track.artist]);

  function commit() {
    const nextTitle = title.trim();
    const nextArtist = artist.trim();
    setEditing(false);
    const patch: Partial<TrackT> = {};
    if (nextTitle && nextTitle !== track.title) patch.title = nextTitle;
    if (nextArtist !== (track.artist ?? "")) {
      patch.artist = nextArtist || undefined;
    }
    if (Object.keys(patch).length > 0) onPatch(patch);
  }

  return (
    <article
      className={`bg-cream border-[3px] p-4 shadow-[4px_4px_0_var(--color-ink)] grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 relative ${
        isPlaying ? "border-gold" : "border-ink"
      }`}
    >
      {isPlaying && (
        <span className="absolute -top-2.5 left-3 bg-gold text-ink text-[10px] font-black uppercase tracking-widest px-2 border-2 border-ink">
          Now playing
        </span>
      )}
      <div className="flex flex-col gap-2 min-w-0">
        {editing ? (
          <div className="flex flex-col gap-1.5">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setTitle(track.title);
                  setArtist(track.artist ?? "");
                  setEditing(false);
                }
              }}
              autoFocus
              className="text-base font-bold p-1.5 border-2 border-ink bg-cream"
            />
            <input
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
              }}
              placeholder="Artist"
              className="text-xs p-1.5 border-2 border-ink bg-cream"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={saving}
            className="text-left disabled:opacity-50"
            title="Click to edit title/artist"
          >
            <div className="font-bold text-base truncate">{track.title}</div>
            <div className="text-xs text-muted truncate">
              {track.artist || (
                <span className="italic underline decoration-dotted">
                  + add artist
                </span>
              )}
            </div>
          </button>
        )}
        <audio controls src={track.src} preload="none" className="w-full" />
        <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-muted">
          <span>id: {track.id}</span>
          {track.durationSec && (
            <span>{formatDuration(track.durationSec)}</span>
          )}
          <span>{track.mime.replace("audio/", "")}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 items-end justify-between text-xs">
        <label className="flex items-center gap-2">
          <span className="font-bold uppercase tracking-widest text-[10px] text-muted">
            Gain
          </span>
          <input
            type="number"
            min={-30}
            max={6}
            step={1}
            value={track.gainDb}
            disabled={saving}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v !== track.gainDb)
                onPatch({ gainDb: v });
            }}
            className="w-14 text-xs p-1 border-2 border-ink bg-cream font-mono"
          />
          <span className="text-[10px] text-muted">dB</span>
        </label>
        <button
          type="button"
          onClick={onDelete}
          disabled={saving}
          className="text-[10px] font-bold uppercase tracking-widest text-coral hover:underline disabled:opacity-40"
        >
          × delete
        </button>
      </div>
    </article>
  );
}

// =========================================================
// Playlists — named ordered groups of tracks
// =========================================================

function slugifyPlaylistName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "playlist"
  );
}

function uniquePlaylistId(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function PlaylistsPanel({
  playlists,
  tracks,
  tracksById,
  existingIds,
  savingFor,
  onSave,
  onDelete,
}: {
  playlists: PlaylistT[];
  tracks: TrackT[];
  tracksById: Record<string, TrackT>;
  existingIds: Set<string>;
  savingFor: string | null;
  onSave: (pl: PlaylistT) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function createPlaylist() {
    const name = newName.trim();
    if (!name) return;
    const id = uniquePlaylistId(slugifyPlaylistName(name), existingIds);
    setCreating(true);
    try {
      await onSave({ id, name, trackIds: [] });
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="bg-cream border-[3px] border-ink shadow-[4px_4px_0_var(--color-ink)] p-5 mb-8">
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <h2 className="text-xl font-black uppercase tracking-widest">
          Playlists
        </h2>
        <span className="text-xs font-mono text-muted">
          {playlists.length} playlist{playlists.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-5">
        <label className="flex-1 min-w-[200px] flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            New playlist name
          </span>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createPlaylist();
            }}
            placeholder="e.g. Opening Set, Hype, After Hours"
            className="text-sm p-2 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </label>
        <button
          type="button"
          onClick={() => void createPlaylist()}
          disabled={!newName.trim() || creating}
          className="bg-gold border-2 border-ink px-4 py-2 font-black uppercase tracking-widest text-xs shadow-[3px_3px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed transition-transform"
        >
          {creating ? "Creating…" : "+ Create playlist"}
        </button>
      </div>

      {playlists.length === 0 ? (
        <div className="border-2 border-dashed border-muted p-8 text-center text-muted text-sm">
          No playlists yet. Name one above to start curating an ordered set
          list. Tracks stay in the library — playlists are just ordered
          references to them.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {playlists.map((pl) => (
            <PlaylistEditor
              key={pl.id}
              playlist={pl}
              tracks={tracks}
              tracksById={tracksById}
              saving={savingFor === `playlist:${pl.id}`}
              onSave={onSave}
              onDelete={() => onDelete(pl.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PlaylistEditor({
  playlist,
  tracks,
  tracksById,
  saving,
  onSave,
  onDelete,
}: {
  playlist: PlaylistT;
  tracks: TrackT[];
  tracksById: Record<string, TrackT>;
  saving: boolean;
  onSave: (pl: PlaylistT) => Promise<void>;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description ?? "");
  const [addPickerId, setAddPickerId] = useState("");

  // Resync local edit state after the manifest finishes saving. Microtask-
  // deferred to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    Promise.resolve().then(() => {
      setName(playlist.name);
      setDescription(playlist.description ?? "");
    });
  }, [playlist.name, playlist.description]);

  const presentIds = playlist.trackIds.filter((id) => tracksById[id]);
  const missingIds = playlist.trackIds.filter((id) => !tracksById[id]);
  const inPlaylist = new Set(playlist.trackIds);
  const candidates = tracks.filter((t) => !inPlaylist.has(t.id));

  function commitMeta() {
    const nextName = name.trim() || playlist.name;
    const nextDesc = description.trim();
    const patch: Partial<PlaylistT> = {};
    if (nextName !== playlist.name) patch.name = nextName;
    if ((playlist.description ?? "") !== nextDesc) {
      patch.description = nextDesc || undefined;
    }
    if (Object.keys(patch).length === 0) return;
    void onSave({ ...playlist, ...patch });
  }

  function setTrackIds(next: string[]) {
    void onSave({ ...playlist, trackIds: next });
  }

  function addTrack() {
    if (!addPickerId) return;
    setTrackIds([...playlist.trackIds, addPickerId]);
    setAddPickerId("");
  }

  function removeAt(idx: number) {
    setTrackIds(playlist.trackIds.filter((_, i) => i !== idx));
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    const next = [...playlist.trackIds];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setTrackIds(next);
  }

  function moveDown(idx: number) {
    if (idx >= playlist.trackIds.length - 1) return;
    const next = [...playlist.trackIds];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setTrackIds(next);
  }

  function pruneMissing() {
    if (missingIds.length === 0) return;
    setTrackIds(presentIds);
  }

  const totalSec = presentIds.reduce(
    (s, id) => s + (tracksById[id]?.durationSec ?? 0),
    0,
  );

  return (
    <article className="border-[3px] border-ink bg-cream-dark/40 shadow-[3px_3px_0_var(--color-ink)]">
      <header className="flex items-center gap-3 p-3 border-b-2 border-ink bg-cream">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-base font-black uppercase tracking-widest hover:text-coral"
          title={open ? "Collapse" : "Expand"}
        >
          {open ? "▾" : "▸"} {playlist.name}
        </button>
        <span className="text-[11px] font-mono text-muted">
          {presentIds.length} track{presentIds.length === 1 ? "" : "s"}
          {totalSec > 0 ? ` · ${formatDuration(totalSec)}` : ""}
          {missingIds.length > 0 ? ` · ${missingIds.length} missing` : ""}
        </span>
        <span className="ml-auto text-[10px] font-mono text-muted">
          id: {playlist.id}
        </span>
        <button
          type="button"
          onClick={onDelete}
          disabled={saving}
          className="text-[10px] font-bold uppercase tracking-widest text-coral hover:underline disabled:opacity-40"
        >
          × delete
        </button>
      </header>

      {open && (
        <div className="p-3 flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                Name
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={commitMeta}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                disabled={saving}
                className="text-sm p-2 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                Description (optional)
              </span>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={commitMeta}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="What this set is for"
                disabled={saving}
                className="text-sm p-2 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </label>
          </div>

          {missingIds.length > 0 && (
            <div className="flex items-center gap-2 border-2 border-coral text-coral p-2 text-[11px] font-mono">
              <span className="font-bold">
                {missingIds.length} track
                {missingIds.length === 1 ? "" : "s"} missing from library:
              </span>
              <span className="truncate">{missingIds.join(", ")}</span>
              <button
                type="button"
                onClick={pruneMissing}
                disabled={saving}
                className="ml-auto text-[10px] font-bold uppercase tracking-widest underline hover:no-underline disabled:opacity-40"
              >
                remove missing
              </button>
            </div>
          )}

          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1.5">
              Tracks in order
            </div>
            {playlist.trackIds.length === 0 ? (
              <div className="border-2 border-dashed border-muted p-4 text-center text-muted text-xs">
                Empty playlist. Add tracks from the library below.
              </div>
            ) : (
              <ol className="flex flex-col gap-1">
                {playlist.trackIds.map((id, i) => {
                  const t = tracksById[id];
                  return (
                    <li
                      key={`${id}-${i}`}
                      className={`grid grid-cols-[2rem_1fr_auto] items-center gap-2 px-2 py-1.5 border-2 ${
                        t ? "border-ink bg-cream" : "border-coral bg-cream"
                      }`}
                    >
                      <span className="font-mono text-xs text-muted tabular-nums text-right">
                        {i + 1}.
                      </span>
                      <div className="min-w-0">
                        {t ? (
                          <>
                            <div className="text-sm font-bold truncate">
                              {t.title}
                            </div>
                            <div className="text-[10px] font-mono text-muted truncate">
                              {t.artist ? `${t.artist} · ` : ""}
                              {t.durationSec
                                ? formatDuration(t.durationSec)
                                : "—"}
                            </div>
                          </>
                        ) : (
                          <div className="text-[11px] font-mono text-coral">
                            missing: {id}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={saving || i === 0}
                          onClick={() => moveUp(i)}
                          className="w-6 h-6 leading-none border-2 border-ink bg-cream hover:bg-cream-dark disabled:opacity-30 font-bold"
                          aria-label="move up"
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={
                            saving || i === playlist.trackIds.length - 1
                          }
                          onClick={() => moveDown(i)}
                          className="w-6 h-6 leading-none border-2 border-ink bg-cream hover:bg-cream-dark disabled:opacity-30 font-bold"
                          aria-label="move down"
                          title="Move down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => removeAt(i)}
                          className="w-6 h-6 leading-none border-2 border-coral text-coral bg-cream hover:bg-coral hover:text-ink disabled:opacity-30 font-bold"
                          aria-label="remove from playlist"
                          title="Remove from playlist"
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-2 pt-2 border-t-2 border-cream-dark">
            <label className="flex-1 min-w-[220px] flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                Add track from library
              </span>
              <select
                value={addPickerId}
                onChange={(e) => setAddPickerId(e.target.value)}
                disabled={saving || candidates.length === 0}
                className="text-sm p-2 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold disabled:opacity-50"
              >
                <option value="">
                  {candidates.length === 0
                    ? "— every track already in this playlist —"
                    : "— pick a track —"}
                </option>
                {candidates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                    {t.artist ? ` — ${t.artist}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={addTrack}
              disabled={!addPickerId || saving}
              className="bg-cream border-2 border-ink px-4 py-2 font-bold uppercase tracking-widest text-xs shadow-[2px_2px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0_var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed transition-transform"
            >
              + Add to playlist
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
