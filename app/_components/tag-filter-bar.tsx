"use client";

import {
  type TagFilterState,
  isFilterActive,
  nextFilterState,
} from "@/lib/tags";
import { TagChip } from "./tag-chip";

export function TagFilterBar({
  allTags,
  filter,
  onChange,
  label = "Tags",
  visibleCount,
  totalCount,
}: {
  allTags: string[];
  filter: TagFilterState;
  onChange: (next: TagFilterState) => void;
  label?: string;
  visibleCount?: number;
  totalCount?: number;
}) {
  const active = isFilterActive(filter);
  if (allTags.length === 0 && !active) return null;

  function toggle(name: string) {
    const next = nextFilterState(filter[name]);
    const copy: TagFilterState = { ...filter };
    if (next === undefined) delete copy[name];
    else copy[name] = next;
    onChange(copy);
  }

  function clear() {
    onChange({});
  }

  return (
    <div className="bg-cream-dark border-2 border-ink p-2 mb-4 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted pr-1">
        {label}
      </span>
      {allTags.length === 0 ? (
        <span className="text-[11px] italic text-muted">
          no tags yet — add some on a piece or anchor
        </span>
      ) : (
        allTags.map((name) => {
          const state = filter[name];
          const visualState =
            state === "include"
              ? "include"
              : state === "exclude"
                ? "exclude"
                : "neutral";
          return (
            <TagChip
              key={name}
              name={name}
              state={visualState}
              onClick={() => toggle(name)}
            />
          );
        })
      )}
      {active && (
        <button
          type="button"
          onClick={clear}
          className="ml-auto text-[10px] font-bold uppercase tracking-widest text-coral underline hover:no-underline"
        >
          Clear
        </button>
      )}
      {visibleCount !== undefined && totalCount !== undefined && active && (
        <span className="text-[10px] font-mono text-muted">
          {visibleCount} / {totalCount}
        </span>
      )}
      {allTags.length > 0 && (
        <div className="basis-full text-[9px] text-muted italic mt-0.5">
          Click a tag to filter (include). Click again to hide. Click a third
          time to clear.
        </div>
      )}
    </div>
  );
}
