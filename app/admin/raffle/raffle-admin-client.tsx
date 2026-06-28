"use client";

import { useState } from "react";
import type {
  RaffleEntry,
  RaffleDraw,
  EntryFlag,
  BatchAddResult,
} from "@/lib/raffle";

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

// A small toggle pill for an entry flag. `on` colors it; click flips it.
function FlagToggle({
  label,
  on,
  onColor,
  onClick,
}: {
  label: string;
  on: boolean;
  onColor: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 border-[3px] border-ink px-2 py-1 text-[10px] font-black uppercase tracking-widest shadow-[2px_2px_0_var(--color-ink)] ${
        on ? onColor : "bg-cream hover:bg-gold"
      }`}
    >
      {on ? `${label} ✓` : label}
    </button>
  );
}

export default function RaffleAdminClient({
  entries: initialEntries,
  draws,
}: {
  entries: RaffleEntry[];
  draws: RaffleDraw[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [n, setN] = useState(1);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<RaffleDraw | null>(draws.at(-1) ?? null);
  const [addText, setAddText] = useState("");
  const [addVerified, setAddVerified] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addSummary, setAddSummary] = useState<BatchAddResult | null>(null);

  const verifiedCount = entries.filter((e) => e.verified).length;
  // Who the draw would actually consider, mirroring lib/raffle.drawWinners.
  const eligible = entries.filter(
    (e) => !e.won && !e.team && (!verifiedOnly || e.verified),
  );

  async function setFlag(entry: RaffleEntry, flag: EntryFlag, value: boolean) {
    const prev = entries;
    // Optimistic.
    setEntries((es) =>
      es.map((e) =>
        e.solWallet === entry.solWallet ? { ...e, [flag]: value } : e,
      ),
    );
    try {
      const res = await fetch("/api/admin/raffle/flag", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ solWallet: entry.solWallet, flag, value }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setEntries(prev); // roll back
      setError(`Couldn't save the ${flag} toggle — try again.`);
    }
  }

  async function addBatch() {
    setAdding(true);
    setError(null);
    setAddSummary(null);
    try {
      const res = await fetch("/api/admin/raffle/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: addText, verified: addVerified }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Add failed (${res.status}).`);
        return;
      }
      const result = data.result as BatchAddResult;
      setAddSummary(result);
      if (result.added.length > 0) {
        setEntries((es) => [...es, ...result.added]);
        setAddText("");
      }
    } catch {
      setError("Network error — try again.");
    } finally {
      setAdding(false);
    }
  }

  async function resetDraws() {
    const wonCount = entries.filter((e) => e.won).length;
    if (
      !confirm(
        `Clear the "won" flag on ${wonCount} entrant${wonCount === 1 ? "" : "s"} and re-open the full pool? Entrants and the draw history are kept.`,
      )
    ) {
      return;
    }
    setError(null);
    const prev = entries;
    setEntries((es) => es.map((e) => ({ ...e, won: false })));
    setLatest(null);
    try {
      const res = await fetch("/api/admin/raffle/reset", { method: "POST" });
      if (!res.ok) throw new Error();
    } catch {
      setEntries(prev); // roll back
      setError("Couldn't reset the draws — try again.");
    }
  }

  async function draw() {
    setDrawing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/raffle/draw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ n, verifiedOnly }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Draw failed (${res.status}).`);
        return;
      }
      const drawn = data.draw as RaffleDraw;
      setLatest(drawn);
      // Winners are marked `won` server-side — reflect that locally so they
      // drop out of the eligible pool immediately.
      const winners = new Set(drawn.winners);
      setEntries((es) =>
        es.map((e) => (winners.has(e.solWallet) ? { ...e, won: true } : e)),
      );
    } catch {
      setError("Network error — try again.");
    } finally {
      setDrawing(false);
    }
  }

  function exportCsv() {
    const rows = [
      [
        "solWallet",
        "postUrl",
        "verified",
        "won",
        "team",
        "ethWallet",
        "enteredAt",
      ],
      ...entries.map((e) => [
        e.solWallet,
        e.postUrl ?? "",
        e.verified ? "yes" : "no",
        e.won ? "yes" : "no",
        e.team ? "yes" : "no",
        e.ethWallet ?? "",
        new Date(e.ts).toISOString(),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
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
            {entries.length} entrant{entries.length === 1 ? "" : "s"} ·{" "}
            {eligible.length} eligible · {verifiedCount} verified. Past winners
            and team entries are excluded automatically.
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
                max={Math.max(1, eligible.length)}
                value={n}
                onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))}
                className="w-20 border-[3px] border-ink bg-cream px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold"
              />
            </label>
            <button
              onClick={draw}
              disabled={drawing || eligible.length === 0}
              className="border-[3px] border-ink bg-ink px-4 py-3 font-black uppercase tracking-widest text-cream shadow-[4px_4px_0_var(--color-gold)] disabled:opacity-50"
            >
              {drawing ? "Drawing…" : "Draw winner"}
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={verifiedOnly}
              onChange={(e) => setVerifiedOnly(e.target.checked)}
              className="size-4 accent-[var(--color-ink)]"
            />
            <span>
              Only draw <span className="font-bold">verified</span> entrants
            </span>
          </label>
          <div className="flex items-center gap-3 border-t-[3px] border-ink/15 pt-3">
            <button
              onClick={resetDraws}
              disabled={drawing || entries.every((e) => !e.won)}
              className="border-[3px] border-ink bg-cream px-3 py-1.5 text-[10px] font-black uppercase tracking-widest shadow-[2px_2px_0_var(--color-ink)] hover:bg-gold disabled:opacity-50"
            >
              Reset draws
            </button>
            <span className="text-[11px] text-muted">
              Clears the “won” flag on all entrants so you can draw again.
            </span>
          </div>
          {error && <p className="text-sm font-bold text-red-700">{error}</p>}
        </section>

        {/* Latest result — the address(es) to hand off */}
        {latest && (
          <section className="border-[3px] border-ink bg-gold/20 p-5 shadow-[4px_4px_0_var(--color-ink)] flex flex-col gap-3">
            <div className="text-[11px] font-black uppercase tracking-widest text-muted">
              Winner{latest.winners.length === 1 ? "" : "s"} ·{" "}
              {fmtTime(latest.drawnAt)} · seed {latest.seed} ·{" "}
              {latest.entrantCount} eligible
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

        {/* Bulk add — paste a batch of SOL addresses collected off-platform */}
        <section className="border-[3px] border-ink bg-cream-dark p-5 shadow-[4px_4px_0_var(--color-ink)] flex flex-col gap-3">
          <div className="text-[11px] font-black uppercase tracking-widest">
            Add addresses
          </div>
          <p className="text-[11px] text-muted">
            Paste extra SOL addresses (one per line, or comma/space separated).
            Invalid addresses and ones already in the list are skipped.
          </p>
          <textarea
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            disabled={adding}
            rows={4}
            placeholder={
              "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU\nSo11111111111111111111111111111111111111112"
            }
            className="border-[3px] border-ink bg-cream px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gold"
          />
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={addVerified}
                onChange={(e) => setAddVerified(e.target.checked)}
                className="size-4 accent-[var(--color-ink)]"
              />
              <span>
                Mark as <span className="font-bold">verified</span>
              </span>
            </label>
            <button
              onClick={addBatch}
              disabled={adding || addText.trim().length === 0}
              className="border-[3px] border-ink bg-ink px-4 py-2 font-black uppercase tracking-widest text-cream shadow-[4px_4px_0_var(--color-gold)] disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add to list"}
            </button>
          </div>
          {addSummary && (
            <div className="text-sm">
              <p className="font-bold">
                Added {addSummary.added.length} · skipped{" "}
                {addSummary.duplicates.length} dupe
                {addSummary.duplicates.length === 1 ? "" : "s"} ·{" "}
                {addSummary.invalid.length} invalid
              </p>
              {addSummary.invalid.length > 0 && (
                <p className="text-[11px] text-red-700 mt-1 break-all">
                  Invalid: {addSummary.invalid.join(", ")}
                </p>
              )}
            </div>
          )}
        </section>

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
            <ul className="flex flex-col gap-2">
              {entries.map((e) => {
                const excluded = e.won || e.team;
                return (
                  <li
                    key={e.solWallet}
                    className={`flex flex-col gap-1.5 border-[3px] border-ink px-3 py-2 ${
                      excluded ? "bg-cream-dark opacity-60" : "bg-cream"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <code className="text-sm break-all">{e.solWallet}</code>
                      <span className="text-[11px] text-muted whitespace-nowrap">
                        {fmtTime(e.ts)}
                      </span>
                    </div>
                    {e.postUrl ? (
                      <a
                        href={e.postUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-muted underline decoration-2 underline-offset-2 break-all"
                      >
                        {e.postUrl}
                      </a>
                    ) : (
                      <span className="text-[11px] italic text-muted">
                        no post link
                      </span>
                    )}
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      <FlagToggle
                        label="Verified"
                        on={!!e.verified}
                        onColor="bg-green-300"
                        onClick={() => setFlag(e, "verified", !e.verified)}
                      />
                      <FlagToggle
                        label="Won"
                        on={!!e.won}
                        onColor="bg-gold"
                        onClick={() => setFlag(e, "won", !e.won)}
                      />
                      <FlagToggle
                        label="Team"
                        on={!!e.team}
                        onColor="bg-blue-300"
                        onClick={() => setFlag(e, "team", !e.team)}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
