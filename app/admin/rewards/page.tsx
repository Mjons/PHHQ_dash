import { readAllRewards } from "@/lib/rewards";

export const metadata = { title: "Rewards — Panel Haus / Curator" };
export const dynamic = "force-dynamic";

// Curator view of every issued prize code + claim status. Behind auth — NOT in
// the proxy.ts public allowlist (unlike /admin/submissions), because the codes
// are claim secrets.
export default async function RewardsPage() {
  const rewards = await readAllRewards();
  const redeemed = rewards.filter((r) => r.redeemed).length;

  return (
    <div className="max-w-5xl mx-auto px-7 py-8">
      <header className="mb-6">
        <div className="text-[10px] font-black uppercase tracking-widest text-muted">
          Panel Haus · Creator Quest
        </div>
        <h1 className="font-black text-3xl uppercase tracking-wide mt-1">
          Prize Codes
        </h1>
        <p className="text-sm text-muted mt-2">
          {rewards.length} issued · {redeemed} claimed
        </p>
      </header>

      {rewards.length === 0 ? (
        <p className="text-muted">
          No codes issued yet. They mint when a player finishes Q6 “The
          Commute.”
        </p>
      ) : (
        <div className="border-[3px] border-ink overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink text-cream uppercase text-[11px] tracking-widest">
              <tr>
                <th className="text-left px-4 py-2">Code</th>
                <th className="text-left px-4 py-2">Wallet</th>
                <th className="text-left px-4 py-2">Quest</th>
                <th className="text-left px-4 py-2">Issued</th>
                <th className="text-left px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rewards.map((r) => (
                <tr key={r.code} className="border-t-[3px] border-ink bg-cream">
                  <td className="px-4 py-2 font-black tracking-wider">
                    {r.code}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.wallet.slice(0, 6)}…{r.wallet.slice(-4)}
                  </td>
                  <td className="px-4 py-2">{r.quest}</td>
                  <td className="px-4 py-2 text-muted">
                    {r.issuedAt ? r.issuedAt.slice(0, 10) : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {r.redeemed ? (
                      <span className="font-bold text-green-700">
                        ✓ claimed
                        {r.redeemedAt ? ` ${r.redeemedAt.slice(0, 10)}` : ""}
                      </span>
                    ) : (
                      <span className="text-muted">unclaimed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
