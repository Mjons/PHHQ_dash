import type { ManifestT } from "@/schema/manifest";
import type { TipStateMap } from "@/lib/tips";

export async function fetchTipState(): Promise<TipStateMap> {
  const res = await fetch("/api/tips", { cache: "no-store" });
  if (!res.ok) throw new Error(`fetchTipState: ${res.status}`);
  const json = (await res.json()) as { tips: TipStateMap };
  return json.tips;
}

export async function fetchManifest(): Promise<ManifestT> {
  const res = await fetch("/api/manifest", { cache: "no-store" });
  if (!res.ok) throw new Error(`fetchManifest: ${res.status}`);
  return res.json();
}

export async function saveManifest(m: ManifestT): Promise<ManifestT> {
  const res = await fetch("/api/manifest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(m),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`saveManifest: ${res.status} ${text}`);
  }
  return res.json();
}

export async function postImport(
  payload: unknown,
  options: { overwriteExisting?: boolean } = {},
): Promise<{
  added: number;
  updated: number;
  skipped: number;
  total: number;
  version: number;
}> {
  const body =
    payload && typeof payload === "object"
      ? {
          ...(payload as Record<string, unknown>),
          overwriteExisting: !!options.overwriteExisting,
        }
      : payload;
  const res = await fetch("/api/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`postImport: ${res.status} ${text}`);
  }
  return res.json();
}

export type BookUploadKind =
  "series-cover" | "front" | "back" | `page-${string}`;

export async function uploadTrack(
  file: File,
  slug: string,
): Promise<{
  url: string;
  pathname: string;
  contentType: string;
  size: number;
}> {
  const form = new FormData();
  form.append("file", file);
  form.append("slug", slug);
  const res = await fetch("/api/tracks/upload", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`uploadTrack: ${res.status} ${text}`);
  }
  return res.json();
}

// Uploads one image to Vercel Blob via /api/books/upload.
// `episode` is required for everything except `series-cover`.
export async function uploadBookAsset(
  file: File,
  series: string,
  episode: string | null,
  kind: BookUploadKind,
): Promise<{ url: string; pathname: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("series", series);
  if (episode) form.append("episode", episode);
  form.append("kind", kind);
  const res = await fetch("/api/books/upload", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`uploadBookAsset(${kind}): ${res.status} ${text}`);
  }
  return res.json();
}
