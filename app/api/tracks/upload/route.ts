import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024;

const EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
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
  const ext = EXT[file.type];
  if (!ext) {
    return NextResponse.json(
      {
        error: `unsupported audio type: ${file.type || "unknown"} (allow: mp3, m4a, ogg)`,
      },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `file too large (${(file.size / 1024 / 1024).toFixed(1)}MB > ${MAX_BYTES / 1024 / 1024}MB)`,
      },
      { status: 400 },
    );
  }

  const path = `tracks/${slugRaw}.${ext}`;
  // 1-year client + CDN cache — see pieces/upload route for the rationale
  // and the `allowOverwrite` caveat. Tracks especially benefit: a single
  // playlist cycle re-fetches every track via DCL's AudioStream, so any
  // intermediary that respects HTTP caching avoids the repeat draw.
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
