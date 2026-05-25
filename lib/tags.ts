// Deterministic tag → color. Auto-color from tag name (no schema field).
// Same input always returns the same hue, so colors are stable across views.

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function tagColor(name: string): {
  bg: string;
  fg: string;
  border: string;
} {
  const key = name.trim().toLowerCase();
  const h = hashStr(key);
  const hue = h % 360;
  return {
    bg: `hsl(${hue} 70% 86%)`,
    fg: `hsl(${hue} 55% 22%)`,
    border: `hsl(${hue} 55% 35%)`,
  };
}

export function parseTagsInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function tagsToInput(tags: string[] | undefined): string {
  return (tags ?? []).join(", ");
}

// Tristate filter: undefined = neutral, "include" = must-have, "exclude" = must-not-have.
export type TagFilterState = Record<string, "include" | "exclude" | undefined>;

export function nextFilterState(
  current: TagFilterState[string],
): TagFilterState[string] {
  if (current === undefined) return "include";
  if (current === "include") return "exclude";
  return undefined;
}

// Does an item with these tags pass the filter? Multiple "include" tags act as
// a union (at least one match); any "exclude" match drops the item.
export function passesTagFilter(
  itemTags: string[] | undefined,
  filter: TagFilterState,
): boolean {
  const tags = itemTags ?? [];
  const includes: string[] = [];
  const excludes: string[] = [];
  for (const [name, state] of Object.entries(filter)) {
    if (state === "include") includes.push(name.toLowerCase());
    else if (state === "exclude") excludes.push(name.toLowerCase());
  }
  const lower = tags.map((t) => t.toLowerCase());
  if (excludes.some((e) => lower.includes(e))) return false;
  if (includes.length === 0) return true;
  return includes.some((i) => lower.includes(i));
}

export function isFilterActive(filter: TagFilterState): boolean {
  return Object.values(filter).some((v) => v !== undefined);
}
