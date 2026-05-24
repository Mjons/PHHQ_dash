"use client";

import { useState } from "react";
import type { VaultResidencyT, VTFloorT } from "@/schema/manifest";

// USDC native on Polygon (Circle, 2024+). USDC has 6 decimals.
const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USDC_DECIMALS = 6;
const POLYGON_CHAIN_ID = 137;

// EIP-681 payment request. Most modern phone wallets (MetaMask Mobile,
// Rainbow, Trust, Coinbase Wallet) handle this URI scheme — tapping a link
// opens the wallet with the USDC transfer pre-filled.
//
// Format: ethereum:<token>@<chain>/transfer?address=<recipient>&uint256=<rawAmount>
function buildPaymentURI(toAddress: string, usdAmount: number): string {
  const raw = BigInt(Math.round(usdAmount * 10 ** USDC_DECIMALS));
  return `ethereum:${USDC_POLYGON}@${POLYGON_CHAIN_ID}/transfer?address=${toAddress}&uint256=${raw.toString()}`;
}

const AMOUNT_PRESETS = [5, 10, 25, 50] as const;

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function TipPageClient({
  floor,
  floorLabel,
  residency,
}: {
  floor: VTFloorT;
  floorLabel: string;
  residency: VaultResidencyT;
}) {
  const [copied, setCopied] = useState(false);
  const displayName =
    residency.artistName?.trim() || shortenAddress(residency.artistWallet);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(residency.artistWallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail on insecure contexts / certain mobile
      // browsers. Surface the failure visibly so the visitor falls back to
      // manual selection of the text in the input.
      setCopied(false);
      alert(
        "Couldn't copy automatically — long-press the address below to select and copy.",
      );
    }
  }

  return (
    <main className="min-h-screen bg-cream text-ink flex justify-center px-5 py-8">
      <div className="max-w-md w-full flex flex-col gap-6">
        {/* Header */}
        <header>
          <div className="text-[10px] font-black uppercase tracking-widest text-muted">
            Panel Haus · {floorLabel}
          </div>
          <h1 className="font-black text-3xl uppercase tracking-wide mt-1">
            Tip the artist
          </h1>
        </header>

        {/* Artist plaque */}
        <section className="border-[3px] border-ink bg-cream-dark p-5 shadow-[4px_4px_0_var(--color-ink)]">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Resident artist
          </div>
          <div className="text-lg font-black mt-1 break-words">
            {displayName}
          </div>
          <blockquote className="mt-3 text-sm italic border-l-4 border-gold pl-3 break-words">
            &ldquo;{residency.artistMessage}&rdquo;
          </blockquote>
          {residency.artistLinks && (
            <div className="flex flex-wrap gap-3 mt-4 text-[11px] font-bold uppercase tracking-widest">
              {Object.entries(residency.artistLinks).map(([key, url]) =>
                url ? (
                  <a
                    key={key}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-ink/70"
                  >
                    {key}
                  </a>
                ) : null,
              )}
            </div>
          )}
        </section>

        {/* Amount presets (deep links) */}
        <section>
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">
            Tap to tip · opens your wallet
          </div>
          <div className="grid grid-cols-4 gap-2">
            {AMOUNT_PRESETS.map((amount) => (
              <a
                key={amount}
                href={buildPaymentURI(residency.artistWallet, amount)}
                className="bg-gold border-2 border-ink py-4 text-center font-black text-xl shadow-[3px_3px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0_var(--color-ink)] transition-transform active:translate-x-[0] active:translate-y-[0] active:shadow-[2px_2px_0_var(--color-ink)]"
              >
                ${amount}
              </a>
            ))}
          </div>
          <p className="text-[11px] text-muted mt-2 leading-snug">
            Sends USDC on Polygon. Works in MetaMask Mobile, Rainbow, Trust,
            Coinbase Wallet, and most other phone wallets.
          </p>
        </section>

        {/* Copy-address fallback */}
        <section className="border-[3px] border-ink bg-cream p-4 shadow-[4px_4px_0_var(--color-ink)]">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">
            Or send manually
          </div>
          <div className="flex gap-2 items-stretch">
            <input
              type="text"
              readOnly
              value={residency.artistWallet}
              onClick={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 text-xs font-mono p-2 border-2 border-ink bg-cream-dark/50 focus:outline-none focus:ring-2 focus:ring-gold"
              aria-label="Artist wallet address"
            />
            <button
              type="button"
              onClick={copyAddress}
              className="bg-ink text-cream border-2 border-ink px-3 py-2 font-black uppercase tracking-widest text-xs hover:bg-ink/90 active:translate-y-px"
            >
              {copied ? "✓" : "Copy"}
            </button>
          </div>
          <ol className="text-[11px] text-muted mt-3 list-decimal list-inside space-y-0.5 leading-snug">
            <li>Open your wallet</li>
            <li>Pick USDC on the Polygon network</li>
            <li>Paste the address above</li>
            <li>Send any amount</li>
          </ol>
        </section>

        {/* Reassurance + verification links */}
        <section className="text-[11px] text-muted leading-snug border-t-2 border-cream-dark pt-4">
          <p>
            Tips go directly from your wallet to{" "}
            <span className="font-bold text-ink">{displayName}</span>. Panel
            Haus never holds the funds — there is no platform fee.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[10px] font-bold uppercase tracking-widest">
            <a
              href={`https://polygonscan.com/address/${residency.artistWallet}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-ink"
            >
              verify on polygonscan
            </a>
            <span className="font-mono normal-case font-normal tracking-normal">
              floor: {floor}
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}
