"use client";

import { useState } from "react";
import type { RaffleEntry, RaffleDraw } from "@/lib/raffle";

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="border-[3px] border-ink bg-cream px-2 py-1 text-[10px] font-black uppercase tracking-widest shadow-[2px_2px_0_var(--color-ink)] hover:bg-gold"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

export default function RaffleAdminClient({
  entries,
  draws,
}: {
  entries: RaffleEntry[];
  draws: RaffleDraw[];
}) {
  const [n, setN] = useState(1);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<RaffleDraw | null>(draws.at(-1) ?? null);

  async function draw() {
    setDrawing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/raffle/draw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Draw failed (${res.status}).`);
        return;
      }
      setLatest(data.draw as RaffleDraw);
    } catch {
      setError("Network error — try again.");
    } finally {
      setDrawing(false);
    }
  }

  function exportCsv() {
    const rows = [
      ["solWallet", "ethWallet", "enteredAt"],
      ...entries.map((e) => [
        e.solWallet,
        e.ethWallet ?? "",
        new Date(e.ts).toISOString(),
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dumpstr-raffle-entries.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-cream text-ink px-5 py-8">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <header>
          <div className="text-[10px] font-black uppercase tracking-widest text-muted">
            DUMPSTR · Operator
          </div>
          <h1 className="font-black text-3xl uppercase tracking-wide mt-1">
            Raffle Draw
          </h1>
          <p className="text-sm text-muted mt-2">
            {entries.length} entrant{entries.length === 1 ? "" : "s"} in the
            pool.
          </p>
        </header>

        {/* Draw controls */}
        <section className="border-[3px] border-ink bg-cream-dark p-5 shadow-[4px_4px_0_var(--color-ink)] flex flex-col gap-4">
          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-black uppercase tracking-widest">
                Winners
              </span>
              <input
                type="number"
                min={1}
                max={Math.max(1, entries.length)}
                value={n}
                onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 border-[3px] border-ink bg-cream px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </label>
            <button
              onClick={draw}
              disabled={drawing || entries.length === 0}
              className="border-[3px] border-ink bg-ink px-4 py-3 font-black uppercase tracking-widest text-cream shadow-[4px_4px_0_var(--color-gold)] disabled:opacity-50"
            >
              {drawing ? "Drawing…" : "Draw winner"}
            </button>
          </div>
          {error && <p className="text-sm font-bold text-red-700">{error}</p>}
        </section>

        {/* Latest result — the address(es) to hand off */}
        {latest && (
          <section className="border-[3px] border-ink bg-gold/20 p-5 shadow-[4px_4px_0_var(--color-ink)] flex flex-col gap-3">
            <div className="text-[11px] font-black uppercase tracking-widest text-muted">
              Winner{latest.winners.length === 1 ? "" : "s"} ·{" "}
              {fmtTime(latest.drawnAt)} · seed {latest.seed} ·{" "}
              {latest.entrantCount} entrants
            </div>
            {latest.winners.map((w) => (
              <div
                key={w}
                className="flex items-center justify-between gap-3 border-[3px] border-ink bg-cream px-3 py-2"
              >
                <code className="text-sm break-all">{w}</code>
                <CopyButton value={w} />
              </div>
            ))}
          </section>
        )}

        {/* Entrant list */}
        <section className="border-[3px] border-ink bg-cream-dark p-5 shadow-[4px_4px_0_var(--color-ink)] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-black uppercase tracking-widest">
              Entrants
            </div>
            <button
              onClick={exportCsv}
              disabled={entries.length === 0}
              className="border-[3px] border-ink bg-cream px-3 py-1.5 text-[10px] font-black uppercase tracking-widest shadow-[2px_2px_0_var(--color-ink)] hover:bg-gold disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>
          {entries.length === 0 ? (
            <p className="text-sm text-muted">No entries yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {entries.map((e) => (
                <li
                  key={e.solWallet}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <code className="break-all">{e.solWallet}</code>
                  <span className="text-[11px] text-muted whitespace-nowrap">
                    {fmtTime(e.ts)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
