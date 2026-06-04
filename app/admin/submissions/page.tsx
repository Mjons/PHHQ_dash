import SubmissionsView from "./submissions-view";
import { readAllSubmissions, getAutoPlace } from "@/lib/submissions";
import { redis, MANIFEST_KEY } from "@/lib/redis";
import { auth } from "@/auth";

export const metadata = { title: "Submissions — Panel Haus" };

// This page is PUBLIC (allowlisted in proxy.ts) — anyone can view the gallery.
// Curator-only actions (add-to-pieces, delete) are gated by the session check
// here. Reads submission state from Redis at request time.
export const dynamic = "force-dynamic";

// Piece ids registered in the manifest (marks "already in pieces") plus the
// piece ids currently assigned to an anchor (marks "on wall"). Reads the raw
// manifest object directly — no schema parse needed for these lookups.
async function readManifestPieceState(): Promise<{
  existing: string[];
  placed: string[];
}> {
  const raw = await redis.get<{
    pieces?: Record<string, unknown>;
    anchors?: Array<{ pieceId?: string | null }>;
  }>(MANIFEST_KEY);
  const existing = raw?.pieces ? Object.keys(raw.pieces) : [];
  const placed = (raw?.anchors ?? [])
    .map((a) => a.pieceId)
    .filter((id): id is string => typeof id === "string");
  return { existing, placed };
}

export default async function SubmissionsPage() {
  const [submissions, session, pieceState, autoPlace] = await Promise.all([
    readAllSubmissions(),
    auth(),
    readManifestPieceState(),
    getAutoPlace(),
  ]);
  return (
    <SubmissionsView
      submissions={submissions}
      isCurator={!!session?.user}
      existingPieceIds={pieceState.existing}
      placedPieceIds={pieceState.placed}
      autoPlace={autoPlace}
    />
  );
}
