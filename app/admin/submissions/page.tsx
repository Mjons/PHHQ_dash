import SubmissionsView from "./submissions-view";
import { readAllSubmissions } from "@/lib/submissions";
import { auth } from "@/auth";

export const metadata = { title: "Submissions — Panel Haus" };

// This page is PUBLIC (allowlisted in proxy.ts) — anyone can view the gallery.
// But delete is curator-only, so we check the session here and only hand the
// view `canDelete` when a curator is signed in. Reads submission state from
// Redis at request time.
export const dynamic = "force-dynamic";

export default async function SubmissionsPage() {
  const [submissions, session] = await Promise.all([
    readAllSubmissions(),
    auth(),
  ]);
  return (
    <SubmissionsView submissions={submissions} canDelete={!!session?.user} />
  );
}
