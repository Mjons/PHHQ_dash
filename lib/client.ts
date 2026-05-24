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

export async function postImport(payload: unknown): Promise<{
  added: number;
  updated: number;
  total: number;
  version: number;
}> {
  const res = await fetch("/api/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`postImport: ${res.status} ${text}`);
  }
  return res.json();
}
