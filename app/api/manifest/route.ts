import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { redis, MANIFEST_KEY } from "@/lib/redis";
import { Manifest, type ManifestT } from "@/schema/manifest";
import { SEED_MANIFEST } from "@/lib/seed";

export const dynamic = "force-dynamic";

async function readManifest(): Promise<ManifestT> {
  const raw = await redis.get<ManifestT>(MANIFEST_KEY);
  if (!raw) return SEED_MANIFEST;
  return raw;
}

// Public read — the scene fetches this on load.
export async function GET() {
  const m = await readManifest();
  return NextResponse.json(m, {
    headers: {
      "cache-control": "public, max-age=10, stale-while-revalidate=60",
      "access-control-allow-origin": "*",
    },
  });
}

// Authenticated write — curator only.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const parsed = Manifest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues.slice(0, 10) },
      { status: 422 },
    );
  }

  const existing = await readManifest();
  const next: ManifestT = {
    ...parsed.data,
    version: existing.version + 1,
    updatedAt: new Date().toISOString(),
  };

  await redis.set(MANIFEST_KEY, next);
  return NextResponse.json(next);
}
