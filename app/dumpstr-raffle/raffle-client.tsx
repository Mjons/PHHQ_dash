"use client";

import { useState } from "react";

const MEME_URL = "https://memes.panelhaus.app";
const HANDLE = "@panelhaus";
const HASHTAG = "#smudgethesponge";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "done" }
  | { kind: "error"; message: string };

// Small copy-to-clipboard chip so entrants get the exact tag — a mistyped
// handle or hashtag makes the entry unverifiable.
function TagChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 border-[3px] border-ink bg-cream px-2 py-1 font-mono text-sm font-bold shadow-[2px_2px_0_var(--color-ink)] hover:bg-gold"
      title="Copy"
    >
      {value}
      <span className="text-[10px] font-black uppercase tracking-widest text-muted">
        {copied ? "✓" : "copy"}
      </span>
    </button>
  );
}

export default function RaffleClient({
  ethWallet,
}: {
  ethWallet: string | null;
}) {
  const [solWallet, setSolWallet] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sol = solWallet.trim();
    const post = postUrl.trim();
    if (!sol) {
      setStatus({ kind: "error", message: "Paste your Solana wallet first." });
      return;
    }
    if (!post) {
      setStatus({ kind: "error", message: "Paste the link to your X post." });
      return;
    }
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/dumpstr-raffle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ solWallet: sol, postUrl: post, ethWallet }),
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
          We&apos;ll check your post, then winners are drawn after the entry
          window closes — the drop airdrops straight to your wallet. You can
          close this tab.
        </p>
      </section>
    );
  }

  const busy = status.kind === "saving";

  return (
    <>
      {/* Entry requirements — this is a post-to-enter contest, so put the
          rules up top where they can't be missed. */}
      <section className="border-[3px] border-ink bg-gold/20 p-5 shadow-[4px_4px_0_var(--color-ink)] flex flex-col gap-4">
        <div className="text-[11px] font-black uppercase tracking-widest text-muted">
          How to enter the DUMPSTR GTD raffle
        </div>
        <ol className="flex flex-col gap-3 text-sm">
          <li className="flex gap-2.5">
            <span className="font-black">1.</span>
            <span>
              <span className="font-bold">Make a meme</span> at{" "}
              <a
                href={MEME_URL}
                target="_blank"
                rel="noreferrer"
                className="font-bold underline decoration-2 underline-offset-2"
              >
                memes.panelhaus.app
              </a>
              .
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="font-black">2.</span>
            <span>
              <span className="font-bold">Post it on X</span> tagging these
              exactly:
              <span className="mt-2 flex flex-wrap gap-2">
                <TagChip value={HANDLE} />
                <TagChip value={HASHTAG} />
              </span>
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="font-black">3.</span>
            <span>
              <span className="font-bold">
                Drop your Solana wallet + post link
              </span>{" "}
              below.
            </span>
          </li>
        </ol>
      </section>

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

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-black uppercase tracking-widest">
            Your X post link
          </span>
          <input
            type="url"
            value={postUrl}
            onChange={(e) => setPostUrl(e.target.value)}
            placeholder="https://x.com/you/status/…"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy}
            className="border-[3px] border-ink bg-cream px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gold"
          />
          <span className="text-[11px] text-muted">
            The post tagging {HANDLE} + {HASHTAG}. We check it before the draw.
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
    </>
  );
}
