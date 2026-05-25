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

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;

// kind values:
//   series-cover  → books/<series>/cover.<ext>            (pedestal book art)
//   front         → books/<series>/<episode>/front.<ext>  (3:2)
//   back          → books/<series>/<episode>/back.<ext>   (3:2)
//   page-NN       → books/<series>/<episode>/page-NN.<ext>  (NN ∈ 01..34)
const KIND_RE = /^(series-cover|front|back|page-(0[1-9]|[12][0-9]|3[0-4]))$/;

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
  const series = String(form.get("series") || "").trim();
  const episode = String(form.get("episode") || "").trim();
  const kind = String(form.get("kind") || "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "`file` field is required" },
      { status: 400 },
    );
  }
  if (!SLUG_RE.test(series)) {
    return NextResponse.json(
      { error: "series must be a slug (a-z, 0-9, _, -)" },
      { status: 400 },
    );
  }
  if (!KIND_RE.test(kind)) {
    return NextResponse.json(
      {
        error:
          "kind must be one of: series-cover, front, back, page-NN (NN ∈ 01..34)",
      },
      { status: 400 },
    );
  }
  const needsEpisode = kind !== "series-cover";
  if (needsEpisode && !SLUG_RE.test(episode)) {
    return NextResponse.json(
      { error: "episode is required (slug) for this kind" },
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

  const path =
    kind === "series-cover"
      ? `books/${series}/cover.${ext}`
      : `books/${series}/${episode}/${kind}.${ext}`;

  const blob = await put(path, file, {
    access: "public",
    contentType: file.type,
    allowOverwrite: true,
  });

  return NextResponse.json({
    url: blob.url,
    pathname: blob.pathname,
    contentType: file.type,
    size: file.size,
  });
}
