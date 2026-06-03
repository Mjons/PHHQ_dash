"use client";

import { useState } from "react";

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

type Status =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "done" }
  | { kind: "error"; message: string };

export default function SubmitClient({ wallet }: { wallet: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [dclName, setDclName] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setStatus({ kind: "error", message: "Pick your comic image first." });
      return;
    }
    setStatus({ kind: "uploading" });
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("wallet", wallet);
      body.set("dclName", dclName);
      const res = await fetch("/api/quest/submit", { method: "POST", body });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatus({
          kind: "error",
          message: data?.error || `Upload failed (${res.status}).`,
        });
        return;
      }
      setStatus({ kind: "done" });
    } catch {
      setStatus({
        kind: "error",
        message: "Network error — check your connection and try again.",
      });
    }
  }

  if (status.kind === "done") {
    return (
      <section className="border-[3px] border-ink bg-cream-dark p-5 shadow-[4px_4px_0_var(--color-ink)]">
        <p className="font-black text-xl uppercase tracking-wide">
          Submitted ✓
        </p>
        <p className="text-sm text-muted mt-2">
          Head back into Panel Haus — your Resident badge unlocks within a few
          seconds. You can close this tab.
        </p>
      </section>
    );
  }

  const busy = status.kind === "uploading";

  return (
    <>
      {/* Step 1 — point players to the tool that makes the comic before they
          upload. Most arrive here without a comic in hand yet. */}
      <section className="border-[3px] border-ink bg-gold/20 p-5 shadow-[4px_4px_0_var(--color-ink)] flex flex-col gap-3">
        <div className="text-[11px] font-black uppercase tracking-widest text-muted">
          Step 1 · Make your comic
        </div>
        <p className="text-sm">
          Don’t have a comic yet? Head to{" "}
          <span className="font-bold">panelhaus.app</span>, follow the quick
          tutorial, and you’ll have{" "}
          <span className="font-bold">panels on paper in about 5 minutes</span>.
          Then come back here to upload.
        </p>
        <a
          href="https://panelhaus.app"
          target="_blank"
          rel="noreferrer"
          className="self-start border-[3px] border-ink bg-gold px-4 py-2 font-black uppercase tracking-widest text-ink shadow-[4px_4px_0_var(--color-ink)] hover:bg-gold-light"
        >
          Make my comic →
        </a>
      </section>

      <form
        onSubmit={onSubmit}
        className="border-[3px] border-ink bg-cream-dark p-5 shadow-[4px_4px_0_var(--color-ink)] flex flex-col gap-5"
      >
        <p className="text-sm text-muted">
          <span className="font-black uppercase tracking-widest text-ink">
            Step 2 ·{" "}
          </span>
          Submitting as{" "}
          <span className="font-mono font-bold text-ink">
            {shortenAddress(wallet)}
          </span>
          . Upload your comic to earn the Resident badge.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-black uppercase tracking-widest">
            Decentraland name (optional)
          </span>
          <input
            type="text"
            value={dclName}
            onChange={(e) => setDclName(e.target.value)}
            placeholder="e.g. inkslinger"
            maxLength={120}
            disabled={busy}
            className="border-[3px] border-ink bg-cream px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-black uppercase tracking-widest">
            Comic image
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
            className="text-sm file:mr-3 file:border-[3px] file:border-ink file:bg-gold file:px-3 file:py-1.5 file:font-bold file:uppercase file:tracking-widest file:text-ink"
          />
          <span className="text-[11px] text-muted">
            PNG, JPG, WEBP or GIF · up to 8 MB.
          </span>
        </label>

        {status.kind === "error" && (
          <p className="text-sm font-bold text-red-700">{status.message}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="border-[3px] border-ink bg-ink px-4 py-3 font-black uppercase tracking-widest text-cream shadow-[4px_4px_0_var(--color-gold)] disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Submit comic"}
        </button>
      </form>
    </>
  );
}
