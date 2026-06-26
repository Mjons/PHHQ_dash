import RaffleAdminClient from "./raffle-admin-client";
import { readAllEntries, readDraws } from "@/lib/raffle";
import { auth } from "@/auth";

export const metadata = { title: "DUMPSTR Raffle — Admin" };

// Operator-only draw tool. Gated by proxy.ts (every /admin path except
// /admin/submissions requires the curator session) and re-checked here.
export const dynamic = "force-dynamic";

export default async function RaffleAdminPage() {
  const session = await auth();
  if (!session?.user) {
    return (
      <main className="min-h-screen bg-cream text-ink flex items-center justify-center p-8">
        <p className="font-bold">Sign in as a curator to run the raffle.</p>
      </main>
    );
  }

  const [entries, draws] = await Promise.all([readAllEntries(), readDraws()]);
  return <RaffleAdminClient entries={entries} draws={draws} />;
}
