"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Curator-only. Deletes a submission via DELETE /api/quest/submit?wallet=...,
// which clears the Redis flag (and the blob) so the scene's poll reads
// makeYourMark:false again — the player has to redo Q5. Handy for testing.
export default function DeleteSubmissionButton({
  wallet,
  dclName,
}: {
  wallet: string;
  dclName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    const who = dclName || wallet;
    if (
      !confirm(
        `Delete the submission from ${who}? They'll need to resubmit to re-complete the quest.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/quest/submit?wallet=${encodeURIComponent(wallet)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error || `Delete failed (${res.status}).`);
        setBusy(false);
        return;
      }
      // Re-fetch the server component so the row disappears.
      router.refresh();
    } catch {
      alert("Network error — try again.");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      className="border-2 border-ink bg-cream px-2 py-1 text-[11px] font-black uppercase tracking-widest text-red-700 hover:bg-red-700 hover:text-cream disabled:opacity-50"
    >
      {busy ? "…" : "Delete"}
    </button>
  );
}
