// Fan-out uploader for the Pieces batch flow.
// Posts N files to /api/pieces/upload with a concurrency cap, calling back
// with status transitions per row so the UI can live-update.

export type UploadInput = {
  id: string; // local row id (stable across the queue's lifetime)
  file: File;
  slug: string;
  batch?: string;
};

export type UploadResult =
  | { id: string; ok: true; url: string }
  | { id: string; ok: false; error: string };

export type StatusEvent =
  | { id: string; phase: "uploading" }
  | { id: string; phase: "done"; url: string }
  | { id: string; phase: "error"; error: string };

export async function uploadOne(input: UploadInput): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("slug", input.slug);
  if (input.batch) form.append("batch", input.batch);
  let res: Response;
  try {
    res = await fetch("/api/pieces/upload", { method: "POST", body: form });
  } catch (e) {
    return { id: input.id, ok: false, error: String(e) };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      id: input.id,
      ok: false,
      error: `upload ${res.status}${text ? `: ${text}` : ""}`,
    };
  }
  const json = (await res.json().catch(() => null)) as { url?: string } | null;
  if (!json?.url) {
    return { id: input.id, ok: false, error: "missing url in response" };
  }
  return { id: input.id, ok: true, url: json.url };
}

// Runs `inputs` through `concurrency` parallel workers; reports each status
// change via onEvent. Resolves with the full results array (input-order).
export async function uploadAll(
  inputs: UploadInput[],
  onEvent: (e: StatusEvent) => void,
  concurrency = 4,
): Promise<UploadResult[]> {
  const results: UploadResult[] = new Array(inputs.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= inputs.length) return;
      const input = inputs[idx];
      onEvent({ id: input.id, phase: "uploading" });
      const r = await uploadOne(input);
      results[idx] = r;
      if (r.ok) onEvent({ id: input.id, phase: "done", url: r.url });
      else onEvent({ id: input.id, phase: "error", error: r.error });
    }
  }

  const n = Math.max(1, Math.min(concurrency, inputs.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

// Slugify a filename for piece IDs. Mirrors the server's
// /^[a-z0-9][a-z0-9_-]*$/i validator so we always produce valid output.
export function slugifyFilename(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "");
  return (
    stem
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "piece"
  );
}

// True if `slug` matches what /api/pieces/upload accepts.
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(slug);
}

// Given an ordered list of desired slugs and a set of slugs that already exist
// (in the manifest, or earlier in the same batch), return a new list with
// numeric suffixes appended to resolve collisions. Order is preserved; earlier
// rows keep their preferred slug, later rows get -2, -3, etc.
//
// `taken` is mutated to include every produced slug so the caller can pass the
// same set through successive batches.
export function resolveSlugCollisions(
  desired: string[],
  taken: Set<string>,
): string[] {
  const out: string[] = [];
  for (const raw of desired) {
    const base = raw || "piece";
    let candidate = base;
    let n = 2;
    while (taken.has(candidate)) {
      candidate = `${base}-${n++}`;
    }
    taken.add(candidate);
    out.push(candidate);
  }
  return out;
}
