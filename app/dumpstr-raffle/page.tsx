import RaffleClient from "./raffle-client";

export const metadata = { title: "DUMPSTR Raffle — drop your SOL bag" };

// Player-facing DUMPSTR raffle entry. The "One Man's Trash" finale (Mulligan
// the dumpster ape on F3) opens this via openExternalUrl. Reduced scope: we
// just collect a Solana payout address. The ETH ?wallet, if present, is
// stored for reference but isn't required — dedupe is on the SOL address.
//
// Next 16: searchParams is a Promise and must be awaited.
export default async function DumpstrRafflePage({
  searchParams,
}: {
  searchParams: Promise<{ wallet?: string }>;
}) {
  const { wallet } = await searchParams;
  const ethWallet = typeof wallet === "string" ? wallet : null;

  return (
    <main className="min-h-screen bg-cream text-ink flex justify-center px-5 py-8">
      <div className="max-w-md w-full flex flex-col gap-6">
        <header>
          <div className="text-[10px] font-black uppercase tracking-widest text-muted">
            DUMPSTR · One Man&apos;s Trash
          </div>
          <h1 className="font-black text-3xl uppercase tracking-wide mt-1">
            Drop your SOL bag
          </h1>
          <p className="text-sm text-muted mt-2">
            Feed the dump — a banger prints. Paste your Solana wallet to enter
            the raffle; winners get the DUMPSTR drop airdropped straight to it.
          </p>
        </header>

        <RaffleClient ethWallet={ethWallet} />
      </div>
    </main>
  );
}
