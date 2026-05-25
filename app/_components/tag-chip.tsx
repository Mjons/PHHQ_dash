"use client";

import { tagColor } from "@/lib/tags";

export function TagChip({
  name,
  state,
  onClick,
  onRemove,
  size = "sm",
}: {
  name: string;
  state?: "include" | "exclude" | "neutral";
  onClick?: () => void;
  onRemove?: () => void;
  size?: "xs" | "sm";
}) {
  const c = tagColor(name);
  const isExclude = state === "exclude";
  const isInclude = state === "include";
  const py = size === "xs" ? "py-px" : "py-0.5";
  const px = size === "xs" ? "px-1.5" : "px-2";
  const text = size === "xs" ? "text-[10px]" : "text-[11px]";
  return (
    <span
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`inline-flex items-center gap-1 ${px} ${py} ${text} font-bold uppercase tracking-wider border-2 ${
        onClick ? "cursor-pointer hover:brightness-95" : ""
      } ${isExclude ? "line-through opacity-60" : ""}`}
      style={{
        background: isExclude ? "transparent" : c.bg,
        color: c.fg,
        borderColor: c.border,
        borderStyle: isExclude ? "dashed" : "solid",
        boxShadow: isInclude ? `0 0 0 1.5px var(--color-ink)` : undefined,
      }}
      title={
        state === "include"
          ? `Showing only items tagged "${name}"`
          : state === "exclude"
            ? `Hiding items tagged "${name}"`
            : name
      }
    >
      <span>{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove tag ${name}`}
          className="leading-none hover:text-coral"
          style={{ color: c.fg }}
        >
          ×
        </button>
      )}
    </span>
  );
}

export function TagList({
  tags,
  size = "sm",
  onRemove,
}: {
  tags: string[] | undefined;
  size?: "xs" | "sm";
  onRemove?: (name: string) => void;
}) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <TagChip
          key={t}
          name={t}
          size={size}
          onRemove={onRemove ? () => onRemove(t) : undefined}
        />
      ))}
    </div>
  );
}
