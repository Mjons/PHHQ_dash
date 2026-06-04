import SubmissionsView from "./submissions-view";
import { readAllSubmissions } from "@/lib/submissions";
import { redis, MANIFEST_KEY } from "@/lib/redis";
import { auth } from "@/auth";

export const metadata = { title: "Submissions — Panel Haus" };

// This page is PUBLIC (allowlisted in proxy.ts) — anyone can view the gallery.
// Curator-only actions (add-to-pieces, delete) are gated by the session check
// here. Reads submission state from Redis at request time.
export const dynamic = "force-dynamic";

// Just the piece ids from the manifest — enough to mark which submissions are
// already promoted into the pieces collection. Reads the raw manifest object
// directly (no schema parse needed for a keys lookup).
async function readPieceIds(): Promise<string[]> {
  const raw = await redis.get<{ pieces?: Record<string, unknown> }>(
    MANIFEST_KEY,
  );
  return raw?.pieces ? Object.keys(raw.pieces) : [];
}

export default async function SubmissionsPage() {
  const [submissions, session, existingPieceIds] = await Promise.all([
    readAllSubmissions(),
    auth(),
    readPieceIds(),
  ]);
  return (
    <SubmissionsView
      submissions={submissions}
      isCurator={!!session?.user}
      existingPieceIds={existingPieceIds}
    />
  );
}
