"use client";

import { useState } from "react";

// Q6 "The Commute" prize claim. The scene opens /submit?code=PHAUS-XXXX-XXXX
// (and renders this instead of the comic-upload flow when a code is present).
// One click POSTs to /api/reward/redeem; the scene's status poll then sees the
// claim, completes the quest, and rains confetti in-world.

type Status =
  | { kind: "idle" }
  | { kind: "claiming" }
  | { kind: "done" }
  | { kind: "already" }
  | { kind: "notfound" }
  | { kind: "error" };

export default function RedeemClient({ code }: { code: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function claim() {
    setStatus({ kind: "claiming" });
    try {
      const res = await fetch("/api/reward/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) return setStatus({ kind: "done" });
      if (res.status === 409) return setStatus({ kind: "already" });
      if (res.status === 404) return setStatus({ kind: "notfound" });
      setStatus({ kind: "error" });
    } catch {
      setStatus({ kind: "error" });
    }
  }

  const claimed = status.kind === "done" || status.kind === "already";

  return (
    <section className="flex flex-col gap-5">
      <div className="border-[3px] border-ink bg-cream-dark p-5 shadow-[4px_4px_0_var(--color-ink)]">
        <div className="text-[10px] font-black uppercase tracking-widest text-muted">
          Your prize code
        </div>
        <div className="font-black text-2xl tracking-[0.15em] mt-2 select-all">
          {code}
        </div>
      </div>

      {!claimed && (
        <button
          type="button"
          onClick={claim}
          disabled={status.kind === "claiming"}
          className="border-[3px] border-ink bg-gold font-black uppercase tracking-wide py-3 shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-60"
        >
          {status.kind === "claiming" ? "Claiming…" : "Claim prize"}
        </button>
      )}

      {status.kind === "done" && (
        <p className="font-bold text-green-700">
          Claimed! Head back into Panel Haus — the confetti is on us. 🎉
        </p>
      )}
      {status.kind === "already" && (
        <p className="font-bold text-muted">
          This code was already claimed. Nice — you&apos;re all set.
        </p>
      )}
      {status.kind === "notfound" && (
        <p className="font-bold text-red-700">
          We don&apos;t recognize that code. Make sure you opened this from the
          quest log in the venue.
        </p>
      )}
      {status.kind === "error" && (
        <p className="font-bold text-red-700">
          Something went wrong. Give it another try in a moment.
        </p>
      )}
    </section>
  );
}
