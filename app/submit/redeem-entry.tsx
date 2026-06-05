"use client";

import { useState } from "react";

const CODE_RE = /^PHAUS-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

type Status =
  | "idle"
  | "claiming"
  | "done"
  | "already"
  | "notfound"
  | "invalid"
  | "error";

// Manual prize-code entry — the fallback for a player who lands on /submit
// without ?code= (e.g. typed the page in by hand). The in-world quest log +
// Smudge open this page WITH the code prefilled, so most players never see this.
export default function RedeemEntry() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function claim() {
    const c = code.trim().toUpperCase();
    if (!CODE_RE.test(c)) return setStatus("invalid");
    setStatus("claiming");
    try {
      const res = await fetch("/api/reward/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      if (res.ok) return setStatus("done");
      if (res.status === 409) return setStatus("already");
      if (res.status === 404) return setStatus("notfound");
      setStatus("error");
    } catch {
      setStatus("error");
    }
  }

  const claimed = status === "done" || status === "already";

  return (
    <section className="border-[3px] border-ink bg-cream-dark p-5 shadow-[4px_4px_0_var(--color-ink)] flex flex-col gap-3">
      <div className="text-[10px] font-black uppercase tracking-widest text-muted">
        Have a prize code?
      </div>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="PHAUS-XXXX-XXXX"
        disabled={claimed}
        className="border-[3px] border-ink bg-cream px-3 py-2 font-black tracking-[0.15em] uppercase placeholder:text-muted placeholder:font-normal placeholder:tracking-normal"
      />
      {!claimed && (
        <button
          type="button"
          onClick={claim}
          disabled={status === "claiming"}
          className="border-[3px] border-ink bg-gold font-black uppercase tracking-wide py-3 shadow-[4px_4px_0_var(--color-ink)] disabled:opacity-60"
        >
          {status === "claiming" ? "Claiming…" : "Claim prize"}
        </button>
      )}

      {status === "invalid" && (
        <p className="text-sm font-bold text-red-700">
          That doesn&apos;t look like a Panel Haus code (PHAUS-XXXX-XXXX).
        </p>
      )}
      {status === "notfound" && (
        <p className="text-sm font-bold text-red-700">
          We don&apos;t recognize that code.
        </p>
      )}
      {status === "done" && (
        <p className="text-sm font-bold text-green-700">
          Claimed! Head back into Panel Haus — the confetti is on us. 🎉
        </p>
      )}
      {status === "already" && (
        <p className="text-sm font-bold text-muted">
          That code was already claimed.
        </p>
      )}
      {status === "error" && (
        <p className="text-sm font-bold text-red-700">
          Something went wrong. Try again in a moment.
        </p>
      )}
    </section>
  );
}
