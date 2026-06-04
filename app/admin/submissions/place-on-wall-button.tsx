"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Curator-only. Places (or re-places) a submission on the gallery wall via
// POST /api/submissions/place, then refreshes the server component so the row's
// "On wall" state updates. `placed` is the server's current read of whether this
// submission's piece occupies a wall anchor.
export default function PlaceOnWallButton({
  wallet,
  placed,
}: {
  wallet: string;
  placed: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function onPlace() {
    setState("working");
    setMsg("");
    try {
      const res = await fetch("/api/submissions/place", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMsg(data?.error || `Place failed (${res.status}).`);
        setState("error");
        return;
      }
      router.refresh();
      setState("idle");
    } catch {
      setMsg("Network error — try again.");
      setState("error");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onPlace}
        disabled={state === "working"}
        className="border-2 border-ink bg-gold px-2 py-1 text-[11px] font-black uppercase tracking-widest text-ink hover:bg-gold-light disabled:opacity-50"
      >
        {state === "working"
          ? "Placing…"
          : placed
            ? "↻ Re-place on wall"
            : "Place on wall"}
      </button>
      {placed && state !== "error" && (
        <span className="text-[11px] font-black uppercase tracking-widest text-green-700">
          ✓ On wall
        </span>
      )}
      {state === "error" && (
        <span className="text-[11px] font-bold text-red-700">{msg}</span>
      )}
    </span>
  );
}
