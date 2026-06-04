"use client";

import { useState } from "react";

// Curator-only switch between manual approval and auto-place-on-upload. Renders
// optimistically from the server-provided initial value, then POSTs the change
// to /api/submissions/automode.
export default function AutoModeToggle({ initial }: { initial: boolean }) {
  const [auto, setAuto] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function set(next: boolean) {
    if (next === auto || busy) return;
    setBusy(true);
    const prev = auto;
    setAuto(next); // optimistic
    try {
      const res = await fetch("/api/submissions/automode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ auto: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { auto: boolean };
      setAuto(data.auto);
    } catch {
      setAuto(prev); // revert on failure
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 border-[3px] border-ink bg-cream-dark px-4 py-3 shadow-[4px_4px_0_var(--color-ink)]">
      <div className="flex flex-col">
        <span className="text-[11px] font-black uppercase tracking-widest">
          New submissions
        </span>
        <span className="text-[11px] text-muted">
          {auto
            ? "Auto — placed on the gallery wall the moment they upload"
            : "Manual — wait here until you place them"}
        </span>
      </div>
      <div className="ml-auto flex border-[3px] border-ink">
        <button
          type="button"
          onClick={() => set(false)}
          disabled={busy}
          className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-widest disabled:opacity-50 ${
            !auto ? "bg-ink text-cream" : "bg-cream text-ink hover:bg-gold/40"
          }`}
        >
          Manual
        </button>
        <button
          type="button"
          onClick={() => set(true)}
          disabled={busy}
          className={`border-l-[3px] border-ink px-3 py-1.5 text-[11px] font-black uppercase tracking-widest disabled:opacity-50 ${
            auto ? "bg-gold text-ink" : "bg-cream text-ink hover:bg-gold/40"
          }`}
        >
          Auto
        </button>
      </div>
    </div>
  );
}
