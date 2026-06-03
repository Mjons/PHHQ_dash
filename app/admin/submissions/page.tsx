import SubmissionsView from "./submissions-view";
import { readAllSubmissions } from "@/lib/submissions";

export const metadata = { title: "Submissions — Panel Haus / Curator" };

// Curator-gated by proxy.ts (NOT in the public allowlist). Reads submission
// state from Redis at request time.
export const dynamic = "force-dynamic";

export default async function SubmissionsPage() {
  const submissions = await readAllSubmissions();
  return <SubmissionsView submissions={submissions} />;
}
