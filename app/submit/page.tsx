import SubmitClient from "./submit-client";
import { isWalletAddress } from "@/lib/submissions";

export const metadata = { title: "Make Your Mark — Panel Haus" };

// Player-facing Creator Quest Q5 entry point. The scene opens this via
// openExternalUrl(buildSubmitUrl()) → /submit?wallet=0x... . Anonymous: players
// are not curators, so this route is allowlisted in proxy.ts.
//
// Next 16: searchParams is a Promise and must be awaited.
export default async function SubmitPage({
  searchParams,
}: {
  searchParams: Promise<{ wallet?: string }>;
}) {
  const { wallet } = await searchParams;
  const validWallet =
    typeof wallet === "string" && isWalletAddress(wallet) ? wallet : null;

  return (
    <main className="min-h-screen bg-cream text-ink flex justify-center px-5 py-8">
      <div className="max-w-md w-full flex flex-col gap-6">
        <header>
          <div className="text-[10px] font-black uppercase tracking-widest text-muted">
            Panel Haus · Creator Quest
          </div>
          <h1 className="font-black text-3xl uppercase tracking-wide mt-1">
            Make Your Mark
          </h1>
        </header>

        {validWallet ? (
          <SubmitClient wallet={validWallet} />
        ) : (
          // Degrade per the contract: a player who opened the page directly has
          // no wallet, so detection can't fire. Tell them to launch from the
          // venue rather than failing silently.
          <section className="border-[3px] border-ink bg-cream-dark p-5 shadow-[4px_4px_0_var(--color-ink)]">
            <p className="font-bold">Open this page from inside Panel Haus.</p>
            <p className="text-sm text-muted mt-2">
              Walk up to the “Make Your Mark” station in the venue and use the
              submit prompt there — it carries your wallet so we can credit your
              Resident badge. This link is missing that, so we can’t record your
              submission yet.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
