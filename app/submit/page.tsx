import SubmitClient from "./submit-client";
import RedeemClient from "./redeem-client";
import RedeemEntry from "./redeem-entry";
import { isWalletAddress } from "@/lib/submissions";

export const metadata = { title: "Make Your Mark — Panel Haus" };

const CODE_RE = /^PHAUS-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

// Player-facing Creator Quest entry point. The scene opens this via
// openExternalUrl → /submit . Two modes share the page:
//   ?wallet=0x...   → Q5 "Make Your Mark" comic upload (SubmitClient)
//   ?code=PHAUS-... → Q6 "The Commute" prize claim (RedeemClient)
// Anonymous either way (players aren't curators), so it's allowlisted in proxy.ts.
//
// Next 16: searchParams is a Promise and must be awaited.
export default async function SubmitPage({
  searchParams,
}: {
  searchParams: Promise<{ wallet?: string; code?: string }>;
}) {
  const { wallet, code } = await searchParams;
  const validWallet =
    typeof wallet === "string" && isWalletAddress(wallet) ? wallet : null;
  const validCode =
    typeof code === "string" && CODE_RE.test(code.trim().toUpperCase())
      ? code.trim().toUpperCase()
      : null;

  // Prize claim takes precedence — a player arriving with a code is finishing
  // Q6, not submitting a comic.
  if (validCode) {
    return (
      <main className="min-h-screen bg-cream text-ink flex justify-center px-5 py-8">
        <div className="max-w-md w-full flex flex-col gap-6">
          <header>
            <div className="text-[10px] font-black uppercase tracking-widest text-muted">
              Panel Haus · Creator Quest
            </div>
            <h1 className="font-black text-3xl uppercase tracking-wide mt-1">
              Claim Your Prize
            </h1>
          </header>
          <RedeemClient code={validCode} />
        </div>
      </main>
    );
  }

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

        {/* Prize-code fallback — most players arrive with ?code= prefilled and
            never see this, but anyone can paste a code here to claim. */}
        <RedeemEntry />
      </div>
    </main>
  );
}
