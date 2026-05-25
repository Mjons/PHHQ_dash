"use client";

import { useState } from "react";
import { CaptureImport } from "@/schema/manifest";
import { postImport } from "@/lib/client";

const EXAMPLE_JSON = `{
  "capturedAt": "2026-05-17T22:15:00Z",
  "sceneCommit": "f3a2b1c",
  "anchors": [
    {
      "id": "f2-capture-1",
      "area": "f2",
      "x": 40.5,
      "z": 18.0,
      "facing": "S",
      "maxWidth": 3,
      "maxHeight": 3,
      "allowedFrames": ["A"],
      "pieceId": null,
      "note": ""
    }
  ]
}`;

type Result =
  | {
      ok: true;
      added: number;
      updated: number;
      skipped: number;
      total: number;
      version: number;
    }
  | { ok: false; message: string; issues?: unknown };

export default function ImportView() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [parsedPreview, setParsedPreview] = useState<{
    valid: boolean;
    count: number;
    error?: string;
  } | null>(null);

  function preview() {
    setResult(null);
    setParsedPreview(null);
    try {
      const obj = JSON.parse(text);
      const parsed = CaptureImport.safeParse(obj);
      if (!parsed.success) {
        setParsedPreview({
          valid: false,
          count: 0,
          error: parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
        return;
      }
      setParsedPreview({ valid: true, count: parsed.data.anchors.length });
    } catch (e) {
      setParsedPreview({ valid: false, count: 0, error: String(e) });
    }
  }

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const obj = JSON.parse(text);
      const res = await postImport(obj, { overwriteExisting });
      setResult({ ok: true, ...res });
    } catch (e) {
      setResult({ ok: false, message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-7 py-8">
      <div className="flex items-end justify-between pb-4 border-b-2 border-ink mb-7">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-wide">
            Import
          </h1>
          <p className="text-muted text-sm mt-1">
            Paste capture JSON from the in-scene anchor-capture tool. New IDs
            are added; existing IDs are left alone unless you opt in to
            overwriting below.
          </p>
        </div>
      </div>

      <label className="block text-[10px] font-bold uppercase tracking-widest text-muted mb-1">
        Capture JSON
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={18}
        spellCheck={false}
        placeholder={EXAMPLE_JSON}
        className="w-full border-2 border-ink bg-cream p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-gold"
      />

      <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={overwriteExisting}
          onChange={(e) => setOverwriteExisting(e.target.checked)}
          className="w-4 h-4 accent-coral border-2 border-ink"
        />
        <span className="text-sm font-bold uppercase tracking-widest">
          Overwrite existing anchors
        </span>
        <span className="text-xs text-muted normal-case font-normal tracking-normal">
          {overwriteExisting
            ? "matching IDs will have their position, area, facing, and size updated (pieceId/note/frames preserved)"
            : "matching IDs will be skipped — only new anchors are added"}
        </span>
      </label>

      <div className="flex gap-3 mt-4">
        <button
          type="button"
          onClick={preview}
          disabled={!text.trim() || busy}
          className="bg-cream border-2 border-ink px-5 py-2.5 font-black uppercase tracking-widest text-sm shadow-[4px_4px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0_var(--color-ink)] disabled:opacity-40 transition-transform"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || busy || parsedPreview?.valid === false}
          className="bg-gold border-2 border-ink px-5 py-2.5 font-black uppercase tracking-widest text-sm shadow-[4px_4px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0_var(--color-ink)] disabled:opacity-40 transition-transform"
        >
          {busy ? "Importing…" : "Import anchors"}
        </button>
      </div>

      {parsedPreview && (
        <div
          className={`mt-5 border-2 p-3 text-sm ${
            parsedPreview.valid
              ? "border-good text-ink"
              : "border-coral text-coral"
          }`}
        >
          {parsedPreview.valid
            ? `Valid · ${parsedPreview.count} anchor${parsedPreview.count === 1 ? "" : "s"} ready to import.`
            : `Invalid: ${parsedPreview.error}`}
        </div>
      )}

      {result && (
        <div
          className={`mt-5 border-2 p-3 text-sm font-mono ${
            result.ok ? "border-good" : "border-coral text-coral"
          }`}
        >
          {result.ok
            ? `✓ Imported · added ${result.added}, updated ${result.updated}, skipped ${result.skipped}, total ${result.total} · manifest v${result.version}`
            : `✕ ${result.message}`}
        </div>
      )}
    </div>
  );
}
