"use client";

import { useEffect, useState } from "react";
import {
  VAULT_FLOORS,
  VAULT_FLOOR_LABEL,
  type ManifestT,
  type VaultResidencyT,
  type VTFloorT,
} from "@/schema/manifest";
import { fetchManifest, fetchTipState, saveManifest } from "@/lib/client";
import type { TipStateMap, TipStateT } from "@/lib/tips";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TIP_POLL_MS = 20_000;

function shortAddr(a: string): string {
  if (!a || !ADDRESS_RE.test(a)) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const diff = Date.now() - t;
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export default function VaultView() {
  const [manifest, setManifest] = useState<ManifestT | null>(null);
  const [tips, setTips] = useState<TipStateMap>({});
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [savingFor, setSavingFor] = useState<string | null>(null);

  useEffect(() => {
    fetchManifest()
      .then(setManifest)
      .catch((e) => setError(String(e)));
    fetchTipState()
      .then(setTips)
      .catch(() => {
        // Tip state is non-critical to view rendering — silently empty
        // is fine; the per-card panel just shows "no tips yet".
      });
    const id = setInterval(() => {
      fetchTipState()
        .then(setTips)
        .catch(() => {});
    }, TIP_POLL_MS);
    return () => clearInterval(id);
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

  async function saveResidency(floor: VTFloorT, r: VaultResidencyT) {
    await patchManifest(
      (m) => ({
        ...m,
        vaultResidencies: { ...m.vaultResidencies, [floor]: r },
      }),
      `floor:${floor}`,
    );
  }

  async function removeResidency(floor: VTFloorT) {
    if (
      !confirm(
        `Remove residency on ${VAULT_FLOOR_LABEL[floor]}? The tip pedestal disappears from the venue and the address is unregistered. Tip activity history is preserved.`,
      )
    )
      return;
    await patchManifest((m) => {
      const rest = { ...m.vaultResidencies };
      delete rest[floor];
      return { ...m, vaultResidencies: rest };
    }, `floor:${floor}`);
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

  const activeCount = VAULT_FLOORS.filter(
    (f) => !!manifest.vaultResidencies[f],
  ).length;

  return (
    <div className="max-w-5xl mx-auto px-7 py-8 pb-24">
      <div className="flex items-end justify-between pb-4 border-b-2 border-ink mb-7">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-wide">Vault</h1>
          <p className="text-muted text-sm mt-1">
            {activeCount} of {VAULT_FLOORS.length} floor
            {activeCount === 1 ? "" : "s"} configured · v{manifest.version}
          </p>
        </div>
        <p className="text-xs text-muted max-w-md text-right hidden md:block">
          One artist per VT floor. Tips are USDC on Polygon, wallet-to-wallet —
          we never custody. See{" "}
          <a
            href="/docs/VAULT_TIPPING_PLAN.md"
            className="underline hover:text-ink"
          >
            VAULT_TIPPING_PLAN.md
          </a>
          .
        </p>
      </div>

      <div className="flex flex-col gap-5">
        {VAULT_FLOORS.map((floor) => (
          <FloorCard
            key={floor}
            floor={floor}
            residency={manifest.vaultResidencies[floor]}
            tipState={tips[floor]}
            saving={savingFor === `floor:${floor}`}
            onSave={(r) => saveResidency(floor, r)}
            onRemove={() => removeResidency(floor)}
          />
        ))}
      </div>

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
// Per-floor card
// =========================================================

function FloorCard({
  floor,
  residency,
  tipState,
  saving,
  onSave,
  onRemove,
}: {
  floor: VTFloorT;
  residency: VaultResidencyT | undefined;
  tipState: TipStateT | undefined;
  saving: boolean;
  onSave: (r: VaultResidencyT) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [artistWallet, setArtistWallet] = useState(
    residency?.artistWallet ?? "",
  );
  const [artistName, setArtistName] = useState(residency?.artistName ?? "");
  const [artistMessage, setArtistMessage] = useState(
    residency?.artistMessage ?? "",
  );
  const [twitter, setTwitter] = useState(residency?.artistLinks?.twitter ?? "");
  const [lens, setLens] = useState(residency?.artistLinks?.lens ?? "");
  const [farcaster, setFarcaster] = useState(
    residency?.artistLinks?.farcaster ?? "",
  );
  const [opensea, setOpensea] = useState(residency?.artistLinks?.opensea ?? "");
  const [site, setSite] = useState(residency?.artistLinks?.site ?? "");
  const [activeUntil, setActiveUntil] = useState(residency?.activeUntil ?? "");
  const [linksOpen, setLinksOpen] = useState(false);

  // Resync local state when the underlying manifest residency changes (saved
  // from another tab / fresh fetch). Microtask defer matches the pattern in
  // music-view.tsx to satisfy react-hooks lint.
  useEffect(() => {
    Promise.resolve().then(() => {
      setArtistWallet(residency?.artistWallet ?? "");
      setArtistName(residency?.artistName ?? "");
      setArtistMessage(residency?.artistMessage ?? "");
      setTwitter(residency?.artistLinks?.twitter ?? "");
      setLens(residency?.artistLinks?.lens ?? "");
      setFarcaster(residency?.artistLinks?.farcaster ?? "");
      setOpensea(residency?.artistLinks?.opensea ?? "");
      setSite(residency?.artistLinks?.site ?? "");
      setActiveUntil(residency?.activeUntil ?? "");
    });
  }, [residency]);

  const trimmedWallet = artistWallet.trim();
  const walletValid = ADDRESS_RE.test(trimmedWallet);
  const messageValid =
    artistMessage.trim().length > 0 && artistMessage.trim().length <= 280;
  const canSave = walletValid && messageValid && !saving;

  const draft: VaultResidencyT | null = canSave
    ? {
        artistWallet: trimmedWallet,
        artistName: artistName.trim() || undefined,
        artistMessage: artistMessage.trim(),
        artistLinks: linksObject({
          twitter,
          lens,
          farcaster,
          opensea,
          site,
        }),
        activeUntil: activeUntil.trim() || undefined,
        pedestalPos: residency?.pedestalPos,
        qrSrc: residency?.qrSrc,
      }
    : null;

  const dirty =
    draft !== null && JSON.stringify(draft) !== JSON.stringify(residency);

  const expired =
    residency?.activeUntil && Date.parse(residency.activeUntil) < Date.now();

  const isConfigured = !!residency;
  const isHot = !!tipState?.frameOverride;

  return (
    <article
      className={`bg-cream border-[3px] p-5 shadow-[4px_4px_0_var(--color-ink)] relative ${
        isHot ? "border-gold" : isConfigured ? "border-ink" : "border-muted"
      }`}
    >
      {isHot && (
        <span className="absolute -top-2.5 left-3 bg-gold text-ink text-[10px] font-black uppercase tracking-widest px-2 border-2 border-ink">
          ◯ Floor glowing gold
        </span>
      )}
      {expired && !isHot && (
        <span className="absolute -top-2.5 left-3 bg-coral text-ink text-[10px] font-black uppercase tracking-widest px-2 border-2 border-ink">
          Residency expired
        </span>
      )}

      <div className="flex items-baseline justify-between gap-4 mb-4">
        <h2 className="text-xl font-black uppercase tracking-widest">
          {VAULT_FLOOR_LABEL[floor]}
        </h2>
        <span className="text-xs font-mono text-muted">
          {isConfigured ? "Active" : "Not configured"}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-4">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Artist wallet (Polygon)
          </span>
          <input
            type="text"
            value={artistWallet}
            onChange={(e) => setArtistWallet(e.target.value)}
            placeholder="0x742d35Cc6634C0532925a3b844Bc454e4438f44e"
            className={`text-sm p-2 border-2 bg-cream font-mono focus:outline-none focus:ring-2 focus:ring-gold ${
              artistWallet && !walletValid ? "border-coral" : "border-ink"
            }`}
          />
          {artistWallet && !walletValid && (
            <span className="text-[10px] text-coral font-bold">
              ✕ must be a 0x-prefixed 40-char hex address
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Artist name (optional)
          </span>
          <input
            type="text"
            value={artistName}
            onChange={(e) => setArtistName(e.target.value)}
            placeholder="artistname.eth"
            maxLength={80}
            className="text-sm p-2 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Residency end (optional)
          </span>
          <input
            type="date"
            value={activeUntil ? activeUntil.slice(0, 10) : ""}
            onChange={(e) =>
              setActiveUntil(
                e.target.value
                  ? new Date(`${e.target.value}T00:00:00Z`).toISOString()
                  : "",
              )
            }
            className="text-sm p-2 border-2 border-ink bg-cream font-mono focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </label>

        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Plaque message · {280 - artistMessage.length} chars left
          </span>
          <textarea
            value={artistMessage}
            onChange={(e) => setArtistMessage(e.target.value.slice(0, 280))}
            placeholder='"Sketches from my year in Kyoto. Tips go to my next book."'
            rows={3}
            className={`text-sm p-2 border-2 bg-cream focus:outline-none focus:ring-2 focus:ring-gold resize-none ${
              artistMessage && !messageValid ? "border-coral" : "border-ink"
            }`}
          />
        </label>
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setLinksOpen((v) => !v)}
          className="text-[10px] font-bold uppercase tracking-widest text-muted hover:text-ink"
        >
          {linksOpen ? "▾" : "▸"} Artist links (optional)
        </button>
        {linksOpen && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2 pl-4 border-l-2 border-cream-dark">
            <LinkInput
              label="Twitter / X"
              value={twitter}
              onChange={setTwitter}
            />
            <LinkInput label="Lens" value={lens} onChange={setLens} />
            <LinkInput
              label="Farcaster"
              value={farcaster}
              onChange={setFarcaster}
            />
            <LinkInput label="OpenSea" value={opensea} onChange={setOpensea} />
            <LinkInput label="Website" value={site} onChange={setSite} />
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 mt-4">
        {isConfigured && (
          <button
            type="button"
            onClick={onRemove}
            disabled={saving}
            className="text-[10px] font-bold uppercase tracking-widest text-coral hover:underline disabled:opacity-40"
          >
            × remove residency
          </button>
        )}
        <button
          type="button"
          onClick={() => draft && onSave(draft)}
          disabled={!dirty || !canSave}
          className="bg-gold border-2 border-ink px-5 py-2 font-black uppercase tracking-widest text-sm shadow-[3px_3px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-40 disabled:cursor-not-allowed transition-transform"
        >
          {saving ? "Saving…" : isConfigured ? "Save changes" : "Activate"}
        </button>
      </div>

      {isConfigured && (
        <div className="mt-4 flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-muted">
          <a
            href={`/api/qr/${floor}.png`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-ink"
          >
            ▢ view pedestal QR
          </a>
          <a
            href={`/tip/${floor}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-ink"
          >
            ↗ preview tip page
          </a>
        </div>
      )}

      {isConfigured && <TipActivity floor={floor} state={tipState} />}
    </article>
  );
}

function LinkInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
        {label}
      </span>
      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://…"
        className="text-xs p-1.5 border-2 border-ink bg-cream font-mono focus:outline-none focus:ring-2 focus:ring-gold"
      />
    </label>
  );
}

function linksObject(raw: {
  twitter: string;
  lens: string;
  farcaster: string;
  opensea: string;
  site: string;
}) {
  const trimmed = {
    twitter: raw.twitter.trim() || undefined,
    lens: raw.lens.trim() || undefined,
    farcaster: raw.farcaster.trim() || undefined,
    opensea: raw.opensea.trim() || undefined,
    site: raw.site.trim() || undefined,
  };
  const hasAny = Object.values(trimmed).some(Boolean);
  return hasAny ? trimmed : undefined;
}

// =========================================================
// Tip activity panel (read-only)
// =========================================================

function TipActivity({
  floor,
  state,
}: {
  floor: VTFloorT;
  state: TipStateT | undefined;
}) {
  if (!state || state.tipCount === 0) {
    return (
      <div className="mt-5 pt-4 border-t-2 border-cream-dark">
        <div className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">
          Tip activity
        </div>
        <div className="text-xs text-muted italic">
          No tips yet. The QR code on the {floor.toUpperCase()} pedestal will
          activate once the curator places it in Map view.
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 pt-4 border-t-2 border-cream-dark">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
          Tip activity
        </span>
        <span className="text-xs font-mono text-muted">
          {formatUsd(state.totalUsd)} across {state.tipCount} tip
          {state.tipCount === 1 ? "" : "s"} · last {timeAgo(state.lastTipAt)}
        </span>
      </div>
      {state.recent.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs font-mono">
          {state.recent.map((r) => (
            <li
              key={r.txHash}
              className="flex items-baseline gap-3 border-b border-cream-dark py-1 last:border-b-0"
            >
              <span className="font-bold tabular-nums w-16">
                {formatUsd(r.usd)}
              </span>
              <span className="text-muted truncate flex-1">
                {shortAddr(r.from)}
              </span>
              <span className="text-muted tabular-nums">{timeAgo(r.at)}</span>
              <a
                href={`https://polygonscan.com/tx/${r.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] underline text-muted hover:text-ink"
              >
                tx
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
