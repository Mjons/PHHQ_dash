import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart form" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  const slugRaw = String(form.get("slug") || "").trim();
  const batchRaw = String(form.get("batch") || "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "`file` field is required" },
      { status: 400 },
    );
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slugRaw)) {
    return NextResponse.json(
      {
        error:
          "slug must start with alphanumeric and contain only a-z, 0-9, _, -",
      },
      { status: 400 },
    );
  }
  if (batchRaw && !/^[a-z0-9][a-z0-9_-]*$/i.test(batchRaw)) {
    return NextResponse.json(
      {
        error:
          "batch must start with alphanumeric and contain only a-z, 0-9, _, -",
      },
      { status: 400 },
    );
  }
  const ext = EXT[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: `unsupported image type: ${file.type || "unknown"}` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `file too large (${(file.size / 1024 / 1024).toFixed(1)}MB > 8MB)`,
      },
      { status: 400 },
    );
  }

  const path = batchRaw
    ? `pieces/${batchRaw}/${slugRaw}.${ext}`
    : `pieces/${slugRaw}.${ext}`;
  // 1-year client + CDN cache. Pieces in v1 are effectively immutable —
  // curators get a new slug when uploading a new file. With
  // `allowOverwrite: true`, a same-slug re-upload writes new bytes but the
  // URL is unchanged, so visitor caches will keep serving the OLD content
  // for up to a year. If a curator needs an immediate refresh, the path is
  // upload under a new slug and repoint the anchor, not overwrite in place.
  // Trade-off accepted to cap repeat-visit blob egress (see Vercel Blob
  // 10GB/mo Hobby ceiling — burned through in 8 days without this).
  const blob = await put(path, file, {
    access: "public",
    contentType: file.type,
    allowOverwrite: true,
    cacheControlMaxAge: 31536000,
  });

  return NextResponse.json({
    url: blob.url,
    pathname: blob.pathname,
    contentType: file.type,
    size: file.size,
  });
}
