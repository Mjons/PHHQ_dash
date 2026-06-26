"use client";

import { useState } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done" }
  | { kind: "error"; message: string };

export default function RaffleClient({
  ethWallet,
}: {
  ethWallet: string | null;
}) {
  const [solWallet, setSolWallet] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sol = solWallet.trim();
    if (!sol) {
      setStatus({ kind: "error", message: "Paste your Solana wallet first." });
      return;
    }
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/dumpstr-raffle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ solWallet: sol, ethWallet }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatus({
          kind: "error",
          message: data?.error || `Couldn't enter you (${res.status}).`,
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
          You&apos;re in the dump ✓
        </p>
        <p className="text-sm text-muted mt-2">
          Winners are drawn after the entry window closes and the drop airdrops
          straight to your wallet. You can close this tab.
        </p>
      </section>
    );
  }

  const busy = status.kind === "saving";

  return (
    <form
      onSubmit={onSubmit}
      className="border-[3px] border-ink bg-cream-dark p-5 shadow-[4px_4px_0_var(--color-ink)] flex flex-col gap-5"
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-black uppercase tracking-widest">
          Your Solana wallet
        </span>
        <input
          type="text"
          value={solWallet}
          onChange={(e) => setSolWallet(e.target.value)}
          placeholder="e.g. 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={busy}
          className="border-[3px] border-ink bg-cream px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gold"
        />
        <span className="text-[11px] text-muted">
          A Solana address (base58), not an ETH 0x… address.
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
        {busy ? "Entering…" : "Enter the raffle"}
      </button>
    </form>
  );
}
