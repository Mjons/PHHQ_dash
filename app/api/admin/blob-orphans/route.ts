import { NextResponse } from "next/server";
import { del, list, type ListBlobResultBlob } from "@vercel/blob";
import { auth } from "@/auth";
import { redis, MANIFEST_KEY } from "@/lib/redis";
import { Manifest, type ManifestT } from "@/schema/manifest";
import { SEED_MANIFEST } from "@/lib/seed";

export const dynamic = "force-dynamic";

// Scans Vercel Blob under `pieces/`, `books/`, and `tracks/` and returns every
// blob that no entry in the live manifest points at. Curators can then delete
// the orphans from the admin UI to reclaim storage.
//
// Orphans come from two known leaks:
//   1. Deleting a piece/track via the dashboard removes the manifest entry but
//      leaves the blob (existing behavior, surfaced to the curator).
//   2. Batch upload uploads blobs eagerly; if the curator closes the tab
//      before committing, the blobs are uploaded but never referenced.

const PREFIXES = ["pieces/", "books/", "tracks/"];

type OrphanRow = {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
};

async function readManifest(): Promise<ManifestT> {
  const raw = await redis.get<unknown>(MANIFEST_KEY);
  if (!raw) return SEED_MANIFEST;
  return Manifest.parse(raw);
}

// Collect every URL the manifest currently points at, so we can subtract it
// from the blob listing. Covers pieces, books (covers + episode pages), and
// tracks.
function referencedUrls(m: ManifestT): Set<string> {
  const refs = new Set<string>();
  const add = (u: string | undefined) => {
    if (u) refs.add(u);
  };
  for (const p of Object.values(m.pieces)) add(p.src);
  for (const s of m.series ?? []) {
    add(s.cover);
    for (const ep of s.episodes) {
      add(ep.frontCover);
      add(ep.backCover);
      for (const page of ep.pages) add(page);
    }
  }
  for (const t of Object.values(m.tracks ?? {})) add(t.src);
  return refs;
}

async function listAll(prefix: string): Promise<ListBlobResultBlob[]> {
  const out: ListBlobResultBlob[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  const manifest = await readManifest();
  const refs = referencedUrls(manifest);

  const blobs = (await Promise.all(PREFIXES.map((p) => listAll(p)))).flat();

  const orphans: OrphanRow[] = blobs
    .filter((b) => !refs.has(b.url))
    .map((b) => ({
      url: b.url,
      pathname: b.pathname,
      size: b.size,
      uploadedAt:
        b.uploadedAt instanceof Date
          ? b.uploadedAt.toISOString()
          : String(b.uploadedAt),
    }))
    .sort((a, b) => a.pathname.localeCompare(b.pathname));

  return NextResponse.json({
    orphans,
    totalBlobs: blobs.length,
    totalReferenced: refs.size,
    manifestVersion: manifest.version,
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }
  const urls =
    body &&
    typeof body === "object" &&
    Array.isArray((body as { urls?: unknown }).urls)
      ? ((body as { urls: unknown[] }).urls.filter(
          (u) => typeof u === "string",
        ) as string[])
      : null;
  if (!urls || urls.length === 0) {
    return NextResponse.json(
      { error: "expected { urls: string[] }" },
      { status: 400 },
    );
  }

  // Defensive re-check: never delete a URL the manifest currently references,
  // even if the client thought it was an orphan. (Race against another tab.)
  const manifest = await readManifest();
  const refs = referencedUrls(manifest);
  const safe: string[] = [];
  const refused: string[] = [];
  for (const u of urls) {
    if (refs.has(u)) refused.push(u);
    else safe.push(u);
  }

  if (safe.length === 0) {
    return NextResponse.json(
      { deleted: 0, refused: refused.length, refusedUrls: refused },
      { status: 409 },
    );
  }

  await del(safe);
  return NextResponse.json({
    deleted: safe.length,
    refused: refused.length,
    refusedUrls: refused,
  });
}
