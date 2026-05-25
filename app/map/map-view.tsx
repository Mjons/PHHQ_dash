"use client";

import { useEffect, useRef, useState } from "react";
import {
  Anchor,
  AREA_LABEL,
  AREA_ORDER,
  FRAME_LABEL,
  Piece,
  type AnchorT,
  type AreaT,
  type FacingT,
  type FrameKindT,
  type ManifestT,
  type PieceT,
} from "@/schema/manifest";
import { fetchManifest, saveManifest } from "@/lib/client";
import {
  parseTagsInput,
  passesTagFilter,
  tagsToInput,
  type TagFilterState,
} from "@/lib/tags";
import {
  isValidSlug,
  resolveSlugCollisions,
  slugifyFilename,
  uploadOne,
} from "@/lib/upload-queue";
import { TagList } from "../_components/tag-chip";
import { TagFilterBar } from "../_components/tag-filter-bar";
import { PiecePicker } from "../_components/piece-picker";
import {
  ALL_PARCELS,
  ASPECT_PRESETS,
  FLOORS,
  isInArea,
  SCENE_D,
  SCENE_W,
} from "./floor-data";
import {
  cloneAnchor,
  rowFillPositions,
  type RowPosition,
} from "@/lib/row-fill";

const FRAMES: FrameKindT[] = ["A", "B", "C", "D", "E", "F"];
const NUDGE_STEP = 0.25;
const FACING_CYCLE: FacingT[] = ["N", "E", "S", "W"];
const nextFacing = (f: FacingT): FacingT =>
  FACING_CYCLE[(FACING_CYCLE.indexOf(f) + 1) % FACING_CYCLE.length];

const flipX = (x: number) => SCENE_W - x;
const flipZ = (z: number) => z;
const parcelX = (x: number) => SCENE_W - x - 16;
const parcelY = (z: number) => z;
const snap = (v: number, step = 0.5) => Math.round(v / step) * step;
// Same clamps the W/H inputs in the detail card use (min 0.5, max 20, step 0.25).
const clampSize = (v: number) =>
  Math.max(0.5, Math.min(20, Math.round(v * 4) / 4));

function facingArrow(facing: FacingT, cx: number, cy: number) {
  const len = 2.2;
  let dx = 0;
  let dy = 0;
  if (facing === "N") dy = len;
  if (facing === "S") dy = -len;
  if (facing === "E") dx = -len;
  if (facing === "W") dx = len;
  return { x1: cx, y1: cy, x2: cx + dx, y2: cy + dy };
}

type Draft = {
  id: string;
  area: AreaT;
  x: number | null;
  z: number | null;
  facing: FacingT;
  maxW: number;
  maxH: number;
  allowed: FrameKindT[];
  note: string;
  pieceId: string | null;
  tags: string;
};

export default function MapView() {
  const [manifest, setManifest] = useState<ManifestT | null>(null);
  const [activeArea, setActiveArea] = useState<AreaT>("f1");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<TagFilterState>({});
  const [fillPreview, setFillPreview] = useState<{
    seedId: string;
    positions: RowPosition[];
    gapM: number;
  } | null>(null);
  const [pickerForAnchorId, setPickerForAnchorId] = useState<string | null>(
    null,
  );
  const [uploadingForAnchorId, setUploadingForAnchorId] = useState<
    string | null
  >(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const ghostRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    fetchManifest()
      .then(setManifest)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (draft) setDraft(null);
        else if (fillPreview) setFillPreview(null);
        return;
      }
      if (draft) return;
      if (selectedIds.size === 0) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable) return;
      // Screen-relative mapping. The map renders with X flipped (parcelX in
      // this file), so visual-left = scene +X. Z is not flipped.
      let axis: "x" | "z" | null = null;
      let dir = 0;
      if (e.key === "ArrowLeft") {
        axis = "x";
        dir = 1;
      } else if (e.key === "ArrowRight") {
        axis = "x";
        dir = -1;
      } else if (e.key === "ArrowUp") {
        axis = "z";
        dir = -1;
      } else if (e.key === "ArrowDown") {
        axis = "z";
        dir = 1;
      } else {
        return;
      }
      // 1× = 25cm (default), Shift = 1m, Alt = 5cm.
      const mult = e.shiftKey ? 4 : e.altKey ? 0.2 : 1;
      e.preventDefault();
      void bulkNudge(axis, dir * NUDGE_STEP * mult);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // bulkNudge reads manifest/selectedIds/saving — all in deps — so the
    // function captured on rebind is always current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, fillPreview, selectedIds, manifest, saving]);

  function showToast(msg: string, durationMs = 2200) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), durationMs);
  }

  function startCreate() {
    if (!manifest) return;
    const taken = new Set(manifest.anchors.map((a) => a.id));
    let n = 1;
    while (taken.has(`${activeArea}-new-${n}`)) n++;
    setDraft({
      id: `${activeArea}-new-${n}`,
      area: activeArea,
      x: null,
      z: null,
      facing: "S",
      maxW: 3,
      maxH: 3,
      allowed: ["A"],
      note: "",
      pieceId: null,
      tags: "",
    });
    setSelectedIds(new Set());
  }

  async function commitDraft() {
    if (!draft || !manifest) return;
    if (draft.x == null || draft.z == null) return;
    const id = draft.id.trim();
    if (!id) {
      alert("Anchor ID is required.");
      return;
    }
    if (manifest.anchors.some((a) => a.id === id)) {
      alert(`Anchor "${id}" already exists.`);
      return;
    }
    if (draft.allowed.length === 0) {
      alert("At least one allowed frame is required.");
      return;
    }
    const draftTags = parseTagsInput(draft.tags);
    const anchor: AnchorT = {
      id,
      area: draft.area,
      x: draft.x,
      z: draft.z,
      facing: draft.facing,
      maxWidth: draft.maxW,
      maxHeight: draft.maxH,
      allowedFrames: draft.allowed,
      pieceId: draft.pieceId,
      note: draft.note,
      ...(draftTags.length ? { tags: draftTags } : {}),
    };
    const v = Anchor.safeParse(anchor);
    if (!v.success) {
      alert(`Invalid: ${v.error.issues[0]?.message ?? v.error.message}`);
      return;
    }
    const next: ManifestT = {
      ...manifest,
      anchors: [...manifest.anchors, anchor],
    };
    setSaving(true);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      setDraft(null);
      setSelectedIds(new Set([anchor.id]));
      showToast(`Added "${anchor.id}" · v${saved.version}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function patchAnchor(id: string, patch: Partial<AnchorT>) {
    if (!manifest) return;
    const next: ManifestT = {
      ...manifest,
      anchors: manifest.anchors.map((a) =>
        a.id === id ? { ...a, ...patch } : a,
      ),
    };
    setSaving(true);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      showToast(`Saved · v${saved.version}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  // Drop-on-preview flow: upload `file`, create a new Piece in the manifest
  // with a non-colliding slug derived from the filename, and assign it to
  // `anchor`. Non-destructive — existing pieces are untouched even if they
  // share content. Refreshes the manifest before saving so concurrent edits
  // (capture imports, batch uploads) don't get clobbered.
  async function uploadAndAssignPiece(anchor: AnchorT, file: File) {
    if (!manifest) return;
    const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!ALLOWED.includes(file.type)) {
      setError(`Unsupported image type: ${file.type || "unknown"}`);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError(
        `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB > 8MB)`,
      );
      return;
    }

    // Read the file's natural aspect — needed for the Piece record.
    let aspect = 1;
    try {
      aspect = await new Promise<number>((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new window.Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img.naturalWidth / img.naturalHeight);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("could not read image"));
        };
        img.src = url;
      });
    } catch (e) {
      setError(String(e));
      return;
    }

    const base = slugifyFilename(file.name);
    const taken = new Set(Object.keys(manifest.pieces));
    const [slug] = resolveSlugCollisions([base], taken);
    if (!isValidSlug(slug)) {
      setError(`Could not derive a valid slug from "${file.name}"`);
      return;
    }

    setUploadingForAnchorId(anchor.id);
    setError(null);
    try {
      const result = await uploadOne({ id: anchor.id, file, slug });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const piece: PieceT = {
        id: slug,
        src: result.url,
        aspect: Number(aspect.toFixed(4)),
        preferredFrame: (anchor.allowedFrames ?? ["A"])[0],
      };
      const parsed = Piece.safeParse(piece);
      if (!parsed.success) {
        setError(
          `Invalid piece: ${parsed.error.issues[0]?.message ?? parsed.error.message}`,
        );
        return;
      }

      // Refresh-before-commit so a concurrent edit doesn't get clobbered.
      const live = await fetchManifest();
      const next: ManifestT = {
        ...live,
        pieces: { ...live.pieces, [slug]: piece },
        anchors: live.anchors.map((a) =>
          a.id === anchor.id ? { ...a, pieceId: slug } : a,
        ),
      };
      const saved = await saveManifest(next);
      setManifest(saved);
      showToast(`Uploaded "${slug}" → ${anchor.id} · v${saved.version}`, 3000);
    } catch (e) {
      setError(String(e));
    } finally {
      setUploadingForAnchorId(null);
    }
  }

  function handleAnchorClick(id: string, shiftKey: boolean) {
    if (shiftKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelectedIds(new Set([id]));
    }
  }

  async function patchAnchors(ids: string[], patch: Partial<AnchorT>) {
    if (!manifest || ids.length === 0) return;
    const idSet = new Set(ids);
    const next: ManifestT = {
      ...manifest,
      anchors: manifest.anchors.map((a) =>
        idSet.has(a.id) ? { ...a, ...patch } : a,
      ),
    };
    setSaving(true);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      showToast(`Saved · ${ids.length} anchors · v${saved.version}`, 4000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  // Per-anchor transform: each selected anchor gets a patch computed from its
  // own current state. Powers bulk nudge, where each anchor moves by the same
  // delta relative to where it currently is.
  async function patchAnchorsFn(
    ids: string[],
    fn: (a: AnchorT) => Partial<AnchorT>,
    toastLabel: string,
  ) {
    if (!manifest || ids.length === 0) return;
    const idSet = new Set(ids);
    const next: ManifestT = {
      ...manifest,
      anchors: manifest.anchors.map((a) =>
        idSet.has(a.id) ? { ...a, ...fn(a) } : a,
      ),
    };
    setSaving(true);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      showToast(
        `${toastLabel} · ${ids.length} anchor${ids.length === 1 ? "" : "s"} · v${saved.version}`,
        3000,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  // Slide every selected anchor by the same (axis, delta). Refuses cross-area
  // selections (coordinate frames aren't comparable) and refuses if any
  // anchor would land outside its floor's parcels.
  async function bulkNudge(axis: "x" | "z", delta: number) {
    if (!manifest) return;
    const subset = manifest.anchors.filter((a) => selectedIds.has(a.id));
    if (subset.length === 0) return;
    const areas = new Set(subset.map((a) => a.area));
    if (areas.size > 1) {
      showToast("Can't nudge across floors — selection spans multiple areas");
      return;
    }
    for (const a of subset) {
      const nx = axis === "x" ? a.x + delta : a.x;
      const nz = axis === "z" ? a.z + delta : a.z;
      if (!isInArea(a.area, nx, nz)) {
        showToast(`Would move "${a.id}" off ${AREA_LABEL[a.area]}`);
        return;
      }
    }
    const round2 = (v: number) => Math.round(v * 100) / 100;
    await patchAnchorsFn(
      subset.map((a) => a.id),
      (a) => ({ [axis]: round2(a[axis] + delta) }),
      `Nudged ${axis.toUpperCase()} ${delta > 0 ? "+" : ""}${delta}m`,
    );
  }

  async function distributeAnchors(axis: "x" | "z") {
    if (!manifest) return;
    const subset = manifest.anchors.filter((a) => selectedIds.has(a.id));
    if (subset.length < 3) return;
    const sorted = [...subset].sort((a, b) => a[axis] - b[axis]);
    const min = sorted[0][axis];
    const max = sorted[sorted.length - 1][axis];
    const step = (max - min) / (sorted.length - 1);
    const newPos = new Map<string, number>();
    sorted.forEach((a, i) => {
      newPos.set(a.id, Math.round((min + step * i) * 100) / 100);
    });
    const next: ManifestT = {
      ...manifest,
      anchors: manifest.anchors.map((a) =>
        newPos.has(a.id) ? { ...a, [axis]: newPos.get(a.id)! } : a,
      ),
    };
    setSaving(true);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      showToast(
        `Distributed ${subset.length} anchors along ${axis} · v${saved.version}`,
        4000,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteAnchors(ids: string[]) {
    if (!manifest || ids.length === 0) return;
    const idSet = new Set(ids);
    const next: ManifestT = {
      ...manifest,
      anchors: manifest.anchors.filter((a) => !idSet.has(a.id)),
    };
    setSaving(true);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      setSelectedIds(new Set());
      showToast(`Deleted ${ids.length} anchors · v${saved.version}`, 4000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function previewFillRow(seed: AnchorT, gapM: number) {
    const floor = FLOORS[seed.area];
    const positions = rowFillPositions(seed, gapM, floor);
    setFillPreview({ seedId: seed.id, positions, gapM });
  }

  function cancelFillPreview() {
    setFillPreview(null);
  }

  async function commitFillRow() {
    if (!manifest || !fillPreview) return;
    const seed = manifest.anchors.find((a) => a.id === fillPreview.seedId);
    if (!seed) return;
    const clones = fillPreview.positions.filter((p) => !p.isSeed);
    if (clones.length === 0) {
      setFillPreview(null);
      showToast("No room for clones at this gap");
      return;
    }
    const taken = new Set(manifest.anchors.map((a) => a.id));
    const newAnchors: AnchorT[] = [];
    for (const pos of clones) {
      const c = cloneAnchor(seed, { x: pos.x, z: pos.z }, taken);
      taken.add(c.id);
      newAnchors.push(c);
    }
    const next: ManifestT = {
      ...manifest,
      anchors: [...manifest.anchors, ...newAnchors],
    };
    setSaving(true);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      setFillPreview(null);
      showToast(
        `Filled wall · +${newAnchors.length} anchors · v${saved.version}`,
        6000,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function duplicateAnchor(seed: AnchorT) {
    if (!manifest) return;
    const taken = new Set(manifest.anchors.map((a) => a.id));
    let n = 2;
    let id = `${seed.id}-${n}`;
    while (taken.has(id)) {
      n++;
      id = `${seed.id}-${n}`;
    }
    const horizontal = seed.facing === "N" || seed.facing === "S";
    const dup: AnchorT = {
      ...seed,
      id,
      x: horizontal ? seed.x + 1 : seed.x,
      z: horizontal ? seed.z : seed.z + 1,
    };
    const next: ManifestT = {
      ...manifest,
      anchors: [...manifest.anchors, dup],
    };
    setSaving(true);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      setSelectedIds(new Set([dup.id]));
      showToast(`Duplicated → "${dup.id}" · v${saved.version}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteAnchor(
    id: string,
    opts: { skipConfirm?: boolean } = {},
  ) {
    if (!manifest) return;
    if (
      !opts.skipConfirm &&
      !confirm(`Delete anchor "${id}"? This cannot be undone.`)
    )
      return;
    const next: ManifestT = {
      ...manifest,
      anchors: manifest.anchors.filter((a) => a.id !== id),
    };
    setSaving(true);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      showToast(`Deleted "${id}" · v${saved.version}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function sceneFromEvent(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: SCENE_W - p.x, z: p.y };
  }

  function onSvgMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!draft || !ghostRef.current) return;
    const p = sceneFromEvent(e);
    if (!p) return;
    const sceneX = snap(p.x);
    const sceneZ = snap(p.z);
    const inBounds =
      sceneX >= -2 &&
      sceneX <= SCENE_W + 2 &&
      sceneZ >= -2 &&
      sceneZ <= SCENE_D + 2;
    const g = ghostRef.current;
    if (!inBounds) {
      g.setAttribute("opacity", "0");
      return;
    }
    g.setAttribute("opacity", draft.x != null ? "0.55" : "1");
    g.setAttribute("cx", String(flipX(sceneX)));
    g.setAttribute("cy", String(flipZ(sceneZ)));
  }

  function onSvgLeave() {
    if (ghostRef.current) ghostRef.current.setAttribute("opacity", "0");
  }

  function onSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!draft) return;
    const p = sceneFromEvent(e);
    if (!p) return;
    const sceneX = Math.max(0, Math.min(SCENE_W, snap(p.x)));
    const sceneZ = Math.max(0, Math.min(SCENE_D, snap(p.z)));
    setDraft({ ...draft, x: sceneX, z: sceneZ });
  }

  if (error && !manifest) {
    return <div className="p-8 text-coral font-bold">Error: {error}</div>;
  }
  if (!manifest) {
    return <div className="p-8 text-muted">Loading…</div>;
  }

  const floor = FLOORS[activeArea];
  const anchorsOnFloor = manifest.anchors.filter((a) => a.area === activeArea);
  const filled = anchorsOnFloor.filter((a) => a.pieceId).length;
  const pieces: PieceT[] = Object.values(manifest.pieces);
  const selectedAnchors = manifest.anchors.filter((a) => selectedIds.has(a.id));
  const selectedAnchor =
    selectedAnchors.length === 1 ? selectedAnchors[0] : null;
  const activeSet = new Set(floor.parcels.map(([x, z]) => `${x},${z}`));
  const isPlacing = !!draft;
  const skywalkPathways = FLOORS.skywalk.pathways;

  const effectiveTags = (a: AnchorT): string[] => {
    const fromAnchor = a.tags ?? [];
    const piece = a.pieceId ? manifest.pieces[a.pieceId] : undefined;
    const fromPiece = piece?.tags ?? [];
    if (fromPiece.length === 0) return fromAnchor;
    const seen = new Set(fromAnchor.map((t) => t.toLowerCase()));
    const merged = [...fromAnchor];
    for (const t of fromPiece) {
      if (!seen.has(t.toLowerCase())) {
        merged.push(t);
        seen.add(t.toLowerCase());
      }
    }
    return merged;
  };

  const allTags = (() => {
    const seen = new Map<string, string>();
    for (const a of manifest.anchors)
      for (const t of a.tags ?? []) {
        const k = t.toLowerCase();
        if (!seen.has(k)) seen.set(k, t);
      }
    for (const p of Object.values(manifest.pieces))
      for (const t of p.tags ?? []) {
        const k = t.toLowerCase();
        if (!seen.has(k)) seen.set(k, t);
      }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  })();

  const anchorVisible = (a: AnchorT) =>
    passesTagFilter(effectiveTags(a), tagFilter);
  const visibleOnFloor = anchorsOnFloor.filter(anchorVisible);

  return (
    <div className="max-w-[1400px] mx-auto px-7 py-6 pb-24">
      <div className="flex items-end justify-between pb-4 border-b-2 border-ink mb-4">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-wide">Map</h1>
          <p className="text-muted text-sm mt-1">
            {floor.label} — {floor.sub} ·{" "}
            <span className="font-mono">v{manifest.version}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          disabled={isPlacing || saving}
          className="bg-gold border-2 border-ink px-7 py-3.5 font-black uppercase tracking-widest text-base shadow-[5px_5px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[6px_6px_0_var(--color-ink)] disabled:opacity-40 transition-transform"
        >
          + Add anchor
        </button>
      </div>

      {isPlacing && (
        <div className="bg-coral text-ink px-4 py-2.5 mb-3 border-2 border-ink font-bold text-sm flex items-center justify-between">
          <span>
            PLACEMENT MODE — Click anywhere on the map to place. Press ESC to
            cancel.
          </span>
          <span className="text-xs font-mono">
            {draft!.x != null
              ? `placed at x=${draft!.x} · z=${draft!.z}`
              : "not placed yet"}
          </span>
        </div>
      )}

      <TagFilterBar
        allTags={allTags}
        filter={tagFilter}
        onChange={setTagFilter}
        label="Filter by tag"
        visibleCount={visibleOnFloor.length}
        totalCount={anchorsOnFloor.length}
      />

      <div className="flex flex-wrap gap-1 mb-4">
        {AREA_ORDER.map((area) => {
          const f = FLOORS[area];
          const count = manifest.anchors.filter((a) => a.area === area).length;
          const isActive = area === activeArea;
          const isHof = !!f.isHallOfFame;
          let cls = "bg-cream text-ink hover:bg-cream-dark";
          if (isActive && isHof)
            cls =
              "bg-gold text-ink outline outline-2 outline-coral outline-offset-2";
          else if (isActive) cls = "bg-ink text-cream";
          else if (isHof) cls = "bg-coral text-ink";
          return (
            <button
              key={area}
              type="button"
              onClick={() => {
                setActiveArea(area);
                setSelectedIds(new Set());
                if (draft) setDraft({ ...draft, area, x: null, z: null });
              }}
              className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wider border-2 border-ink ${cls}`}
            >
              {f.label}
              <span
                className={`ml-1.5 px-1 text-[10px] ${
                  isActive ? "bg-cream/20" : "bg-ink/10"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        <div
          className={`border-[3px] border-ink bg-cream shadow-[4px_4px_0_var(--color-ink)] p-2 justify-self-start w-full ${
            isPlacing ? "cursor-crosshair" : ""
          }`}
          style={{
            aspectRatio: "116 / 102",
            maxWidth: "min(870px, calc((100svh - 220px) * 116 / 102))",
          }}
        >
          <svg
            ref={svgRef}
            viewBox="-8 -10 116 102"
            preserveAspectRatio="xMidYMid meet"
            width="100%"
            height="100%"
            className="block select-none"
            onMouseMove={onSvgMove}
            onMouseLeave={onSvgLeave}
            onClick={onSvgClick}
          >
            {ALL_PARCELS.filter(([x, z]) => !activeSet.has(`${x},${z}`)).map(
              ([x, z]) => (
                <rect
                  key={`o-${x}-${z}`}
                  x={parcelX(x)}
                  y={parcelY(z)}
                  width={16}
                  height={16}
                  fill="#ebe4cf"
                  stroke="#8a857a"
                  strokeWidth={0.2}
                  strokeDasharray="1 1"
                  opacity={0.4}
                />
              ),
            )}

            {floor.parcels.map(([x, z]) => (
              <rect
                key={`a-${x}-${z}`}
                x={parcelX(x)}
                y={parcelY(z)}
                width={16}
                height={16}
                fill="#ebe4cf"
                stroke="#1a1a1a"
                strokeWidth={0.4}
              />
            ))}

            {floor.atriumHole && (
              <>
                <rect
                  x={parcelX(floor.atriumHole[0])}
                  y={parcelY(floor.atriumHole[1])}
                  width={16}
                  height={16}
                  fill="#f5f0e1"
                  stroke="#ff8c42"
                  strokeWidth={0.5}
                  strokeDasharray="1.2 0.8"
                />
                <text
                  x={parcelX(floor.atriumHole[0]) + 8}
                  y={parcelY(floor.atriumHole[1]) + 9}
                  textAnchor="middle"
                  fontSize={2.6}
                  fill="#ff8c42"
                  fontWeight={700}
                  letterSpacing="0.08em"
                  style={{ pointerEvents: "none" }}
                >
                  ATRIUM VOID
                </text>
              </>
            )}

            {floor.bridges?.map((b, i) => {
              const bx = flipX(b.x + b.width);
              return (
                <g key={`b-${i}`} style={{ pointerEvents: "none" }}>
                  <rect
                    x={bx}
                    y={b.z}
                    width={b.width}
                    height={b.height}
                    fill="#f9c84d"
                    fillOpacity={0.65}
                    stroke="#1a1a1a"
                    strokeWidth={0.4}
                  />
                  <text
                    x={bx + b.width / 2}
                    y={b.z + b.height / 2 + 0.8}
                    textAnchor="middle"
                    fontSize={2.2}
                    fill="#1a1a1a"
                    fontWeight={700}
                    letterSpacing="0.14em"
                  >
                    BRIDGE
                  </text>
                </g>
              );
            })}

            {floor.pathways?.map((p, i) => {
              const px = flipX(p.x + p.width);
              const cx = px + p.width / 2;
              const cy = p.z + p.height / 2;
              const horizontal = p.width >= p.height;
              return (
                <g key={`p-${i}`} style={{ pointerEvents: "none" }}>
                  <rect
                    x={px}
                    y={p.z}
                    width={p.width}
                    height={p.height}
                    fill="#ff8c42"
                    fillOpacity={0.55}
                    stroke="#1a1a1a"
                    strokeWidth={0.4}
                  />
                  {p.label && (
                    <text
                      x={cx}
                      y={cy + 0.7}
                      textAnchor="middle"
                      fontSize={2.2}
                      fill="#1a1a1a"
                      fontWeight={900}
                      letterSpacing="0.18em"
                      transform={
                        horizontal ? undefined : `rotate(-90 ${cx} ${cy})`
                      }
                    >
                      {p.label}
                    </text>
                  )}
                </g>
              );
            })}

            {activeArea === "f1" &&
              skywalkPathways?.map((p, i) => {
                const px = flipX(p.x + p.width);
                return (
                  <rect
                    key={`sk-${i}`}
                    x={px}
                    y={p.z}
                    width={p.width}
                    height={p.height}
                    fill="#ff8c42"
                    fillOpacity={0.12}
                    stroke="#ff8c42"
                    strokeWidth={0.2}
                    strokeDasharray="0.6 0.4"
                    style={{ pointerEvents: "none" }}
                  />
                );
              })}
            {activeArea === "f1" && (
              <text
                x={flipX(56)}
                y={11.5}
                textAnchor="middle"
                fontSize={1.8}
                fill="#ff8c42"
                fontWeight={700}
                letterSpacing="0.1em"
                opacity={0.55}
                style={{ pointerEvents: "none" }}
              >
                ↑ SKYWALK OVERHEAD ↑
              </text>
            )}

            <g style={{ pointerEvents: "none" }}>
              <circle
                cx={flipX(4)}
                cy={flipZ(4)}
                r={2.2}
                fill="#f5b119"
                stroke="#1a1a1a"
                strokeWidth={0.4}
              />
              <text
                x={flipX(4)}
                y={flipZ(4) - 3.5}
                textAnchor="middle"
                fontSize={2.4}
                fill="#1a1a1a"
                fontWeight={900}
              >
                SPAWN
              </text>
              <text
                x={flipX(4)}
                y={flipZ(4) + 5.5}
                textAnchor="middle"
                fontSize={1.6}
                fill="#8a857a"
                fontWeight={700}
              >
                YOU ENTER HERE
              </text>
            </g>

            <g transform="translate(-2, -4)" style={{ pointerEvents: "none" }}>
              <circle r={4} fill="#1a1a1a" />
              <polygon
                points="0,-3 1,0 0,3 -1,0"
                fill="#f5b119"
                stroke="#f5b119"
                strokeWidth={0.4}
              />
              <text
                x={0}
                y={-5.5}
                textAnchor="middle"
                fontSize={3.6}
                fill="#f5f0e1"
                fontWeight={900}
              >
                N
              </text>
            </g>

            <g transform="translate(-4, 88)" style={{ pointerEvents: "none" }}>
              <line
                x1={0}
                y1={0}
                x2={16}
                y2={0}
                stroke="#1a1a1a"
                strokeWidth={0.3}
              />
              <line
                x1={0}
                y1={-0.8}
                x2={0}
                y2={0.8}
                stroke="#1a1a1a"
                strokeWidth={0.3}
              />
              <line
                x1={16}
                y1={-0.8}
                x2={16}
                y2={0.8}
                stroke="#1a1a1a"
                strokeWidth={0.3}
              />
              <text
                x={8}
                y={-1.5}
                textAnchor="middle"
                fontSize={2}
                fill="#1a1a1a"
                fontWeight={700}
              >
                16m / 1 parcel
              </text>
            </g>

            {anchorsOnFloor.map((a) => {
              const cx = flipX(a.x);
              const cy = flipZ(a.z);
              const arrow = facingArrow(a.facing, cx, cy);
              const isFilled = !!a.pieceId;
              const isSel = selectedIds.has(a.id);
              const label = a.id.startsWith(`${activeArea}-`)
                ? a.id.slice(activeArea.length + 1)
                : a.id;
              const fill = isSel ? "#ff8c42" : isFilled ? "#f5b119" : "#f5f0e1";
              const hidden = !anchorVisible(a);
              return (
                <g
                  key={a.id}
                  opacity={hidden ? 0.12 : 1}
                  style={{ pointerEvents: hidden ? "none" : undefined }}
                >
                  <line
                    x1={arrow.x1}
                    y1={arrow.y1}
                    x2={arrow.x2}
                    y2={arrow.y2}
                    stroke="#1a1a1a"
                    strokeWidth={0.3}
                    style={{ pointerEvents: "none" }}
                  />
                  <circle
                    cx={arrow.x2}
                    cy={arrow.y2}
                    r={0.55}
                    fill="#1a1a1a"
                    style={{ pointerEvents: "none" }}
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={1.8}
                    fill={fill}
                    stroke="#1a1a1a"
                    strokeWidth={isSel ? 0.6 : 0.4}
                    strokeDasharray={
                      !isFilled && !isSel ? "0.6 0.4" : undefined
                    }
                    style={{
                      cursor: isPlacing ? "default" : "pointer",
                      pointerEvents: isPlacing ? "none" : "auto",
                    }}
                    onClick={(e) => {
                      if (draft) return;
                      e.stopPropagation();
                      handleAnchorClick(a.id, e.shiftKey);
                    }}
                    onContextMenu={(e) => {
                      if (draft) return;
                      e.preventDefault();
                      e.stopPropagation();
                      deleteAnchor(a.id, { skipConfirm: true });
                    }}
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={3}
                    fill="transparent"
                    style={{
                      cursor: isPlacing ? "default" : "pointer",
                      pointerEvents: isPlacing ? "none" : "auto",
                    }}
                    onClick={(e) => {
                      if (draft) return;
                      e.stopPropagation();
                      handleAnchorClick(a.id, e.shiftKey);
                    }}
                    onContextMenu={(e) => {
                      if (draft) return;
                      e.preventDefault();
                      e.stopPropagation();
                      deleteAnchor(a.id, { skipConfirm: true });
                    }}
                  />
                  <text
                    x={cx + 2.6}
                    y={cy + 0.8}
                    fontSize={2}
                    fill="#1a1a1a"
                    fontWeight={700}
                    style={{ pointerEvents: "none" }}
                  >
                    {label}
                  </text>
                </g>
              );
            })}

            {fillPreview &&
              selectedAnchor &&
              fillPreview.seedId === selectedAnchor.id &&
              selectedAnchor.area === activeArea &&
              fillPreview.positions
                .filter((p) => !p.isSeed)
                .map((p, i) => {
                  const cx = flipX(p.x);
                  const cy = flipZ(p.z);
                  return (
                    <g key={`fp-${i}`} style={{ pointerEvents: "none" }}>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={1.6}
                        fill="#a26ee0"
                        fillOpacity={0.55}
                        stroke="#5c2db5"
                        strokeWidth={0.45}
                        strokeDasharray="0.7 0.4"
                      />
                    </g>
                  );
                })}

            {draft &&
              draft.area === activeArea &&
              draft.x != null &&
              draft.z != null &&
              (() => {
                const cx = flipX(draft.x);
                const cy = flipZ(draft.z);
                const arrow = facingArrow(draft.facing, cx, cy);
                return (
                  <g style={{ pointerEvents: "none" }}>
                    <line
                      x1={arrow.x1}
                      y1={arrow.y1}
                      x2={arrow.x2}
                      y2={arrow.y2}
                      stroke="#1a1a1a"
                      strokeWidth={0.3}
                    />
                    <circle
                      cx={arrow.x2}
                      cy={arrow.y2}
                      r={0.55}
                      fill="#1a1a1a"
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={2.1}
                      fill="#ff8c42"
                      stroke="#1a1a1a"
                      strokeWidth={0.6}
                    >
                      <animate
                        attributeName="opacity"
                        values="1;0.55;1"
                        dur="1.1s"
                        repeatCount="indefinite"
                      />
                    </circle>
                    <text
                      x={cx + 2.8}
                      y={cy + 0.8}
                      fontSize={2.2}
                      fill="#ff8c42"
                      fontWeight={900}
                      letterSpacing="0.12em"
                    >
                      DRAFT
                    </text>
                  </g>
                );
              })()}

            {draft && (
              <circle
                ref={ghostRef}
                r={1.7}
                cx={-100}
                cy={-100}
                opacity={0}
                fill="#ff8c42"
                fillOpacity={0.35}
                stroke="#ff8c42"
                strokeWidth={0.45}
                strokeDasharray="0.7 0.4"
                style={{ pointerEvents: "none" }}
              />
            )}
          </svg>
        </div>

        <aside className="flex flex-col gap-4">
          <section className="bg-cream border-[3px] border-ink p-4 shadow-[4px_4px_0_var(--color-ink)]">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">
              About this area
            </div>
            <div
              className="text-sm leading-relaxed [&_strong]:font-bold [&_em]:italic [&_code]:font-mono [&_code]:bg-cream-dark [&_code]:px-1 [&_code]:border [&_code]:border-muted"
              dangerouslySetInnerHTML={{ __html: floor.description }}
            />
            <div className="grid grid-cols-2 gap-1.5 mt-3 text-[11px] font-mono">
              <Stat label="Anchors" value={anchorsOnFloor.length} />
              <Stat label="Filled" value={filled} />
              <Stat label="Empty" value={anchorsOnFloor.length - filled} />
              <Stat label="Parcels" value={floor.parcels.length} />
              <Stat label="Height" value={`${floor.heightM}m`} />
              {floor.atriumHole && (
                <div className="bg-cream px-2 py-1 border border-coral text-coral text-[10px] uppercase tracking-wider font-bold col-span-2">
                  Has atrium void
                </div>
              )}
            </div>
          </section>

          {draft ? (
            <DraftForm
              draft={draft}
              pieces={pieces}
              saving={saving}
              onChange={setDraft}
              onCancel={() => setDraft(null)}
              onSave={commitDraft}
            />
          ) : selectedAnchors.length >= 2 ? (
            <BulkEditPanel
              key={selectedAnchors.map((a) => a.id).join("|")}
              anchors={selectedAnchors}
              saving={saving}
              onPatchAll={(patch) =>
                patchAnchors(
                  selectedAnchors.map((a) => a.id),
                  patch,
                )
              }
              onPatchEach={(fn) =>
                patchAnchorsFn(
                  selectedAnchors.map((a) => a.id),
                  fn,
                  "Resized",
                )
              }
              onDeleteAll={() =>
                deleteAnchors(selectedAnchors.map((a) => a.id))
              }
              onDistribute={distributeAnchors}
              onNudge={bulkNudge}
              onClose={() => setSelectedIds(new Set())}
            />
          ) : selectedAnchor ? (
            <DetailCard
              key={selectedAnchor.id}
              anchor={selectedAnchor}
              pieces={pieces}
              pieceTags={
                selectedAnchor.pieceId
                  ? (manifest.pieces[selectedAnchor.pieceId]?.tags ?? [])
                  : []
              }
              saving={saving}
              uploading={uploadingForAnchorId === selectedAnchor.id}
              fillPreview={
                fillPreview?.seedId === selectedAnchor.id ? fillPreview : null
              }
              onPatch={(patch) => patchAnchor(selectedAnchor.id, patch)}
              onOpenPicker={() => setPickerForAnchorId(selectedAnchor.id)}
              onDropFile={(file) => uploadAndAssignPiece(selectedAnchor, file)}
              onDelete={() => deleteAnchor(selectedAnchor.id)}
              onDuplicate={() => duplicateAnchor(selectedAnchor)}
              onClose={() => setSelectedIds(new Set())}
              onPreviewFill={(gapM) => previewFillRow(selectedAnchor, gapM)}
              onCommitFill={commitFillRow}
              onCancelFill={cancelFillPreview}
            />
          ) : (
            <div className="border-2 border-dashed border-muted p-6 text-center text-muted text-sm">
              Click any anchor marker on the map to inspect or edit it.
              <span className="block mt-1.5 text-[10px] uppercase tracking-widest">
                Shift-click to multi-select · right-click to delete
              </span>
            </div>
          )}

          <section className="bg-cream-dark border-2 border-ink p-3 text-[11px]">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted mb-2">
              Legend
            </div>
            <div className="flex flex-col gap-1 font-mono">
              <LegendDot cls="filled" label="Filled anchor (has piece)" />
              <LegendDot cls="empty" label="Empty anchor" />
              <LegendDot cls="selected" label="Selected" />
              <LegendDot cls="draft" label="Draft (placing)" />
            </div>
          </section>
        </aside>
      </div>

      {pickerForAnchorId &&
        (() => {
          const target = manifest.anchors.find(
            (a) => a.id === pickerForAnchorId,
          );
          if (!target) return null;
          return (
            <PiecePicker
              pieces={pieces}
              currentPieceId={target.pieceId}
              anchorAspect={target.maxWidth / target.maxHeight}
              onClose={() => setPickerForAnchorId(null)}
              onPick={(pieceId) => {
                void patchAnchor(target.id, { pieceId });
                setPickerForAnchorId(null);
              }}
            />
          );
        })()}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-ink text-cream px-5 py-3 border-[3px] border-gold font-bold uppercase tracking-widest text-sm shadow-[4px_4px_0_var(--color-ink)]">
          ✓ {toast}
        </div>
      )}
      {error && manifest && (
        <div className="fixed bottom-6 left-6 bg-coral text-ink px-5 py-3 border-[3px] border-ink font-bold text-sm flex items-center gap-3">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="underline text-xs"
          >
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-cream-dark border border-muted px-2 py-1">
      <span className="text-muted">{label} </span>
      <strong>{value}</strong>
    </div>
  );
}

function LegendDot({
  cls,
  label,
}: {
  cls: "filled" | "empty" | "selected" | "draft";
  label: string;
}) {
  const styles: Record<typeof cls, React.CSSProperties> = {
    filled: {
      background: "var(--color-gold)",
      border: "1.5px solid var(--color-ink)",
    },
    empty: {
      background: "var(--color-cream)",
      border: "1.5px dashed var(--color-ink)",
    },
    selected: {
      background: "var(--color-coral)",
      border: "2px solid var(--color-ink)",
    },
    draft: {
      background: "var(--color-coral)",
      border: "2px solid var(--color-ink)",
      opacity: 0.7,
    },
  };
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block w-3 h-3 rounded-full" style={styles[cls]} />
      <span>{label}</span>
    </div>
  );
}

function DetailCard({
  anchor,
  pieces,
  pieceTags,
  saving,
  uploading,
  fillPreview,
  onPatch,
  onOpenPicker,
  onDropFile,
  onDelete,
  onDuplicate,
  onClose,
  onPreviewFill,
  onCommitFill,
  onCancelFill,
}: {
  anchor: AnchorT;
  pieces: PieceT[];
  pieceTags: string[];
  saving: boolean;
  uploading: boolean;
  fillPreview: { positions: RowPosition[]; gapM: number } | null;
  onPatch: (patch: Partial<AnchorT>) => void;
  onOpenPicker: () => void;
  onDropFile: (file: File) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onClose: () => void;
  onPreviewFill: (gapM: number) => void;
  onCommitFill: () => void;
  onCancelFill: () => void;
}) {
  const horizontalWall = anchor.facing === "N" || anchor.facing === "S";
  const pieceSize = horizontalWall ? anchor.maxWidth : anchor.maxHeight;
  const suggestedGap = Math.max(1, Math.round(pieceSize * 2 * 2) / 2);
  const [gapInput, setGapInput] = useState(() => String(suggestedGap));
  const allowed = anchor.allowedFrames ?? ["A"];
  const piece = anchor.pieceId
    ? pieces.find((p) => p.id === anchor.pieceId)
    : null;
  const frameKey = allowed[0];
  const [tagsInput, setTagsInput] = useState(() => tagsToInput(anchor.tags));
  const [lastSyncedTags, setLastSyncedTags] = useState(anchor.tags);
  const [lockAspect, setLockAspect] = useState(true);
  if (anchor.tags !== lastSyncedTags) {
    setLastSyncedTags(anchor.tags);
    setTagsInput(tagsToInput(anchor.tags));
  }
  function commitTags() {
    const next = parseTagsInput(tagsInput);
    const current = anchor.tags ?? [];
    const same =
      next.length === current.length &&
      next.every((t, i) => t.toLowerCase() === current[i]?.toLowerCase());
    if (!same) onPatch({ tags: next.length ? next : undefined });
  }
  return (
    <section className="bg-cream border-[3px] border-ink p-4 shadow-[4px_4px_0_var(--color-ink)] flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Selected anchor
          </div>
          <div className="font-mono text-sm font-bold mt-0.5">{anchor.id}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted hover:text-ink underline"
        >
          close
        </button>
      </div>

      <AnchorPreview
        anchor={anchor}
        piece={piece ?? null}
        frameKey={frameKey}
        uploading={uploading}
        disabled={saving}
        onOpenPicker={onOpenPicker}
        onDropFile={onDropFile}
      />

      {anchor.note && (
        <div className="text-xs italic text-muted">{anchor.note}</div>
      )}

      <FieldGroup label="Position · facing">
        <div className="text-[11px] font-mono text-muted flex flex-wrap items-center gap-1">
          <span className="text-muted/70 pr-0.5">x</span>
          <button
            type="button"
            disabled={saving}
            onClick={(e) =>
              onPatch({ x: anchor.x - (e.shiftKey ? 1 : NUDGE_STEP) })
            }
            className="w-6 h-6 leading-none bg-cream border-2 border-ink font-bold hover:bg-cream-dark disabled:opacity-50"
            aria-label="nudge x minus"
            title="Shift+click = 1m"
          >
            −
          </button>
          <span className="w-12 text-center tabular-nums">
            {anchor.x.toFixed(2)}
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={(e) =>
              onPatch({ x: anchor.x + (e.shiftKey ? 1 : NUDGE_STEP) })
            }
            className="w-6 h-6 leading-none bg-cream border-2 border-ink font-bold hover:bg-cream-dark disabled:opacity-50"
            aria-label="nudge x plus"
            title="Shift+click = 1m"
          >
            +
          </button>
          <span className="text-muted/70 pl-2 pr-0.5">z</span>
          <button
            type="button"
            disabled={saving}
            onClick={(e) =>
              onPatch({ z: anchor.z - (e.shiftKey ? 1 : NUDGE_STEP) })
            }
            className="w-6 h-6 leading-none bg-cream border-2 border-ink font-bold hover:bg-cream-dark disabled:opacity-50"
            aria-label="nudge z minus"
            title="Shift+click = 1m"
          >
            −
          </button>
          <span className="w-12 text-center tabular-nums">
            {anchor.z.toFixed(2)}
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={(e) =>
              onPatch({ z: anchor.z + (e.shiftKey ? 1 : NUDGE_STEP) })
            }
            className="w-6 h-6 leading-none bg-cream border-2 border-ink font-bold hover:bg-cream-dark disabled:opacity-50"
            aria-label="nudge z plus"
            title="Shift+click = 1m"
          >
            +
          </button>
          <span className="text-muted/70 pl-2 pr-0.5">y</span>
          <button
            type="button"
            disabled={saving}
            onClick={(e) => {
              const cur = anchor.y ?? 2.5;
              const step = e.shiftKey ? 1 : NUDGE_STEP;
              onPatch({ y: Math.max(0, cur - step) });
            }}
            className="w-6 h-6 leading-none bg-cream border-2 border-ink font-bold hover:bg-cream-dark disabled:opacity-50"
            aria-label="nudge y minus"
            title="Lower on wall · Shift+click = 1m"
          >
            −
          </button>
          <span
            className={`w-12 text-center tabular-nums ${anchor.y == null ? "italic text-muted/60" : ""}`}
            title={
              anchor.y == null
                ? "Auto — scene picks default. Nudge to set explicitly."
                : `Height ${anchor.y.toFixed(2)}m`
            }
          >
            {anchor.y == null ? "auto" : anchor.y.toFixed(2)}
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={(e) => {
              const cur = anchor.y ?? 2.5;
              const step = e.shiftKey ? 1 : NUDGE_STEP;
              onPatch({ y: cur + step });
            }}
            className="w-6 h-6 leading-none bg-cream border-2 border-ink font-bold hover:bg-cream-dark disabled:opacity-50"
            aria-label="nudge y plus"
            title="Raise on wall · Shift+click = 1m"
          >
            +
          </button>
          {anchor.y != null && (
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                onPatch({ y: undefined } as unknown as Partial<AnchorT>)
              }
              className="ml-1 px-1.5 h-6 leading-none bg-cream border border-muted text-[10px] text-muted hover:text-ink disabled:opacity-50"
              aria-label="clear y, back to auto"
              title="Clear — let the scene pick the default height"
            >
              auto
            </button>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => onPatch({ facing: nextFacing(anchor.facing) })}
            className="ml-2 px-2 h-6 leading-none bg-cream border-2 border-ink font-bold hover:bg-cream-dark disabled:opacity-50"
            aria-label={`facing ${anchor.facing}, click to rotate`}
            title="Rotate facing N→E→S→W"
          >
            ↻ {anchor.facing}
          </button>
        </div>
      </FieldGroup>

      <FieldGroup label="Size">
        <div className="grid grid-cols-3 gap-1.5">
          {ASPECT_PRESETS.map((p) => {
            const isActive =
              anchor.maxWidth === p.w && anchor.maxHeight === p.h;
            return (
              <button
                key={p.label}
                type="button"
                disabled={saving}
                onClick={() => onPatch({ maxWidth: p.w, maxHeight: p.h })}
                className={`text-[11px] font-bold border-2 border-ink py-1 ${
                  isActive ? "bg-gold" : "bg-cream hover:bg-cream-dark"
                } disabled:opacity-50`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <label className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted font-bold uppercase tracking-widest text-[10px]">
              W
            </span>
            <input
              key={`w-${anchor.maxWidth}`}
              type="number"
              min={0.5}
              max={20}
              step={0.25}
              defaultValue={anchor.maxWidth}
              disabled={saving}
              onBlur={(e) => {
                const w = parseFloat(e.target.value);
                if (!Number.isFinite(w) || w <= 0) return;
                if (w === anchor.maxWidth) return;
                if (lockAspect) {
                  const ratio = anchor.maxWidth / anchor.maxHeight;
                  const h = clampSize(w / ratio);
                  onPatch({ maxWidth: clampSize(w), maxHeight: h });
                } else {
                  onPatch({ maxWidth: w });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="w-full font-mono text-xs p-1 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold disabled:opacity-50"
            />
            <span className="text-muted text-[10px]">m</span>
          </label>
          <label className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted font-bold uppercase tracking-widest text-[10px]">
              H
            </span>
            <input
              key={`h-${anchor.maxHeight}`}
              type="number"
              min={0.5}
              max={20}
              step={0.25}
              defaultValue={anchor.maxHeight}
              disabled={saving}
              onBlur={(e) => {
                const h = parseFloat(e.target.value);
                if (!Number.isFinite(h) || h <= 0) return;
                if (h === anchor.maxHeight) return;
                if (lockAspect) {
                  const ratio = anchor.maxWidth / anchor.maxHeight;
                  const w = clampSize(h * ratio);
                  onPatch({ maxWidth: w, maxHeight: clampSize(h) });
                } else {
                  onPatch({ maxHeight: h });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="w-full font-mono text-xs p-1 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold disabled:opacity-50"
            />
            <span className="text-muted text-[10px]">m</span>
          </label>
        </div>
        <label className="flex items-center gap-2 mt-2 text-[11px] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={lockAspect}
            onChange={(e) => setLockAspect(e.target.checked)}
            disabled={saving}
            className="w-3.5 h-3.5 accent-gold disabled:opacity-50"
          />
          <span className="font-bold uppercase tracking-widest text-[10px]">
            {lockAspect ? "🔒 Lock aspect ratio" : "🔓 Free resize"}
          </span>
          <span className="text-muted text-[10px] normal-case font-normal tracking-normal">
            {lockAspect
              ? `(${(anchor.maxWidth / anchor.maxHeight).toFixed(2)}:1)`
              : "(W and H change independently)"}
          </span>
        </label>
      </FieldGroup>

      <FieldGroup label="Allowed frames">
        <FrameChecks
          value={allowed}
          disabled={saving}
          onChange={(next) =>
            onPatch({ allowedFrames: next.length ? next : ["A"] })
          }
        />
      </FieldGroup>

      <FieldGroup label="Piece">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenPicker}
            disabled={saving || uploading}
            className="flex-1 bg-cream border-2 border-ink px-3 py-1.5 text-sm font-bold uppercase tracking-widest text-left shadow-[3px_3px_0_var(--color-ink)] hover:bg-cream-dark disabled:opacity-50 disabled:cursor-not-allowed truncate"
            title="Browse all pieces in the system"
          >
            {piece ? (
              <span className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {piece.title || piece.id}
                  {piece.artist ? (
                    <span className="text-muted font-normal normal-case tracking-normal">
                      {" — "}
                      {piece.artist}
                    </span>
                  ) : null}
                </span>
                <span className="text-[10px] text-muted flex-none">
                  browse ↗
                </span>
              </span>
            ) : (
              <span className="flex items-center justify-between gap-2 text-muted">
                <span className="italic normal-case font-normal tracking-normal">
                  — empty —
                </span>
                <span className="text-[10px] flex-none">browse ↗</span>
              </span>
            )}
          </button>
          {piece && (
            <button
              type="button"
              onClick={() => onPatch({ pieceId: null })}
              disabled={saving || uploading}
              className="text-[10px] text-coral border-2 border-coral px-2 py-1 font-bold uppercase tracking-widest hover:bg-coral hover:text-ink disabled:opacity-40"
              title="Clear assignment (anchor stays, piece is unaffected)"
            >
              ×
            </button>
          )}
        </div>
        <p className="text-[10px] text-muted italic mt-1">
          Drop a file on the preview above to upload + assign a new image.
        </p>
      </FieldGroup>

      <FieldGroup label="Tags (comma-separated)">
        <input
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          onBlur={commitTags}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          disabled={saving}
          placeholder="may-activation, hero"
          className="w-full font-mono text-xs p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold disabled:opacity-50"
        />
        {anchor.tags?.length || pieceTags.length ? (
          <div className="mt-1.5 flex flex-col gap-1">
            {anchor.tags && anchor.tags.length > 0 && (
              <TagList tags={anchor.tags} size="xs" />
            )}
            {pieceTags.length > 0 && (
              <div className="flex items-center gap-1.5 opacity-70">
                <span className="text-[9px] uppercase text-muted">
                  from piece:
                </span>
                <TagList tags={pieceTags} size="xs" />
              </div>
            )}
          </div>
        ) : null}
      </FieldGroup>

      <FieldGroup label="Fill wall with copies of this anchor">
        {fillPreview ? (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-mono bg-cream-dark border-2 border-[#5c2db5] text-[#3b1a6e] px-2 py-1.5">
              {fillPreview.positions.length} anchor
              {fillPreview.positions.length === 1 ? "" : "s"} along this wall
              {" · "}gap {fillPreview.gapM}m
              {fillPreview.positions.length === 1 && (
                <div className="text-coral mt-0.5">
                  No room for clones at this gap — try smaller.
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancelFill}
                disabled={saving}
                className="bg-cream border-2 border-ink px-3 py-1.5 font-bold uppercase tracking-widest text-xs disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onCommitFill}
                disabled={saving || fillPreview.positions.length <= 1}
                className="bg-[#a26ee0] border-2 border-ink px-3 py-1.5 font-black uppercase tracking-widest text-xs shadow-[3px_3px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] disabled:opacity-40 transition-transform"
              >
                {saving
                  ? "Saving…"
                  : `Place ${fillPreview.positions.length - 1} clone${
                      fillPreview.positions.length - 1 === 1 ? "" : "s"
                    }`}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-0.5 text-[10px] font-bold uppercase tracking-widest text-muted">
              Gap (m)
              <input
                type="number"
                min={0}
                max={20}
                step={0.1}
                value={gapInput}
                onChange={(e) => setGapInput(e.target.value)}
                disabled={saving}
                className="w-20 font-mono text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold disabled:opacity-50"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                const g = parseFloat(gapInput);
                if (!Number.isFinite(g) || g < 0) return;
                onPreviewFill(g);
              }}
              disabled={saving}
              className="bg-cream border-2 border-ink px-3 py-1.5 font-bold uppercase tracking-widest text-xs hover:bg-[#a26ee0]/30 disabled:opacity-40"
              title="Preview a row of copies along this wall"
            >
              Fill row →
            </button>
          </div>
        )}
        <div className="text-[10px] text-muted mt-1.5 leading-snug">
          Clones inherit size, frame, facing and tags. Piece assignment is
          cleared — assign per-anchor after placing.
        </div>
      </FieldGroup>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDuplicate}
          disabled={saving || !!fillPreview}
          className="text-xs border-2 border-ink bg-cream hover:bg-cream-dark px-2 py-1 font-bold uppercase tracking-widest disabled:opacity-40"
          title="Create one copy of this anchor, offset 1m along the wall"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={saving || !!fillPreview}
          className="text-xs text-coral border border-coral px-2 py-1 font-bold uppercase tracking-widest hover:bg-coral hover:text-ink disabled:opacity-40"
        >
          Delete anchor
        </button>
      </div>
    </section>
  );
}

// Clickable + droppable anchor preview. Click opens the piece picker, drop
// uploads a file and assigns it. Shows an inflight overlay while uploading.
function AnchorPreview({
  anchor,
  piece,
  frameKey,
  uploading,
  disabled,
  onOpenPicker,
  onDropFile,
}: {
  anchor: AnchorT;
  piece: PieceT | null;
  frameKey: FrameKindT;
  uploading: boolean;
  disabled: boolean;
  onOpenPicker: () => void;
  onDropFile: (file: File) => void;
}) {
  // drag-leave counter pattern — events bubble through children, so we
  // track net depth instead of toggling on each event.
  const [dragDepth, setDragDepth] = useState(0);
  const dragOver = dragDepth > 0;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inert = disabled || uploading;

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragDepth(0);
    if (inert) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onDropFile(file);
  }

  function handleClick() {
    if (inert) return;
    onOpenPicker();
  }

  function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onDropFile(file);
    e.target.value = "";
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="button"
        tabIndex={inert ? -1 : 0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!inert) setDragDepth((d) => d + 1);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (!inert) setDragDepth((d) => Math.max(0, d - 1));
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className={`border-[3px] relative overflow-hidden flex items-center justify-center transition-colors cursor-pointer ${
          dragOver
            ? "border-coral bg-coral/15"
            : piece
              ? "border-ink bg-cream-dark"
              : "border-ink bg-[repeating-linear-gradient(45deg,var(--color-cream-dark)_0_8px,var(--color-cream)_8px_16px)]"
        } ${inert ? "cursor-wait opacity-90" : "hover:border-gold"}`}
        style={{ aspectRatio: `${anchor.maxWidth} / ${anchor.maxHeight}` }}
        title={
          inert
            ? uploading
              ? "Uploading…"
              : "Saving…"
            : "Click to browse pieces · drop an image to upload + assign"
        }
      >
        {piece ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={piece.src}
              alt={piece.title || piece.id}
              className="max-w-full max-h-full object-contain pointer-events-none"
              style={{ imageRendering: "auto" }}
            />
            <span className="absolute top-1 left-1 bg-gold text-ink font-black text-[10px] px-1.5 py-0.5 border border-ink pointer-events-none">
              {frameKey}
            </span>
            {piece.title && (
              <div className="absolute bottom-0 left-0 right-0 bg-ink/80 text-cream text-[10px] font-bold uppercase tracking-widest px-2 py-1 truncate pointer-events-none">
                {piece.title}
                {piece.artist ? (
                  <span className="text-cream-dark/80 font-normal normal-case tracking-normal">
                    {" — "}
                    {piece.artist}
                  </span>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <span className="text-[10px] font-black tracking-widest text-muted pointer-events-none">
            EMPTY · {frameKey}
          </span>
        )}

        {dragOver && !inert && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-coral/30 text-ink pointer-events-none">
            <div className="text-3xl" aria-hidden>
              ⤓
            </div>
            <div className="font-black text-xs uppercase tracking-widest">
              Drop to upload + assign
            </div>
          </div>
        )}

        {uploading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-ink/70 text-cream pointer-events-none">
            <div className="text-2xl animate-pulse" aria-hidden>
              ⋯
            </div>
            <div className="font-black text-xs uppercase tracking-widest">
              Uploading…
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted">
        <span className="italic">
          Click image to browse · drop file to upload
        </span>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={inert}
          className="underline hover:text-ink disabled:opacity-40"
        >
          Upload new ↑
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={handlePickFile}
        />
      </div>
    </div>
  );
}

const NUDGE_STEPS: ReadonlyArray<{ label: string; m: number }> = [
  { label: "10cm", m: 0.1 },
  { label: "25cm", m: 0.25 },
  { label: "1m", m: 1 },
];

function BulkEditPanel({
  anchors,
  saving,
  onPatchAll,
  onPatchEach,
  onDeleteAll,
  onDistribute,
  onNudge,
  onClose,
}: {
  anchors: AnchorT[];
  saving: boolean;
  onPatchAll: (patch: Partial<AnchorT>) => void;
  onPatchEach: (fn: (a: AnchorT) => Partial<AnchorT>) => void;
  onDeleteAll: () => void;
  onDistribute: (axis: "x" | "z") => void;
  onNudge: (axis: "x" | "z", delta: number) => void;
  onClose: () => void;
}) {
  const [tagInput, setTagInput] = useState("");
  const [yInput, setYInput] = useState("");
  const [nudgeStep, setNudgeStep] = useState(0.25);
  const [lockAspect, setLockAspect] = useState(false);
  const n = anchors.length;
  const firstAllowed = anchors[0]?.allowedFrames ?? ["A"];
  const allShareFacing = anchors.every((a) => a.facing === anchors[0].facing);
  const sharedFacing: FacingT | null = allShareFacing
    ? anchors[0].facing
    : null;
  const allShareSize = anchors.every(
    (a) =>
      a.maxWidth === anchors[0].maxWidth &&
      a.maxHeight === anchors[0].maxHeight,
  );
  const allShareY = anchors.every((a) => a.y === anchors[0].y);
  const allShareArea = anchors.every((a) => a.area === anchors[0].area);
  const xs = anchors.map((a) => a.x);
  const zs = anchors.map((a) => a.z);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  const fmt = (v: number) => v.toFixed(2);

  function addTags() {
    const tags = parseTagsInput(tagInput);
    if (tags.length === 0) return;
    setTagInput("");
    onPatchAll({ tags } as Partial<AnchorT>);
  }

  return (
    <section className="bg-cream border-[3px] border-ink p-4 shadow-[4px_4px_0_var(--color-ink)] flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Bulk edit
          </div>
          <div className="font-mono text-sm font-bold mt-0.5">
            {n} anchors selected
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted hover:text-ink underline"
        >
          clear
        </button>
      </div>

      <div className="text-[10px] font-mono text-muted leading-snug max-h-20 overflow-y-auto bg-cream-dark border border-muted px-2 py-1">
        {anchors.map((a) => a.id).join(" · ")}
      </div>

      <FieldGroup label="Set size for all">
        <div className="grid grid-cols-3 gap-1.5">
          {ASPECT_PRESETS.map((p) => {
            const isActive =
              allShareSize &&
              anchors[0].maxWidth === p.w &&
              anchors[0].maxHeight === p.h;
            return (
              <button
                key={p.label}
                type="button"
                disabled={saving}
                onClick={() => onPatchAll({ maxWidth: p.w, maxHeight: p.h })}
                className={`text-[11px] font-bold border-2 border-ink py-1 ${
                  isActive ? "bg-gold" : "bg-cream hover:bg-cream-dark"
                } disabled:opacity-50`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <label className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted font-bold uppercase tracking-widest text-[10px]">
              W
            </span>
            <input
              key={`bw-${allShareSize ? anchors[0].maxWidth : "mixed"}`}
              type="number"
              min={0.5}
              max={20}
              step={0.25}
              defaultValue={allShareSize ? anchors[0].maxWidth : ""}
              placeholder={allShareSize ? undefined : "mixed"}
              disabled={saving}
              onBlur={(e) => {
                const w = parseFloat(e.target.value);
                if (!Number.isFinite(w) || w <= 0) return;
                if (allShareSize && w === anchors[0].maxWidth) return;
                if (lockAspect) {
                  onPatchEach((a) => ({
                    maxWidth: clampSize(w),
                    maxHeight: clampSize(w * (a.maxHeight / a.maxWidth)),
                  }));
                } else {
                  onPatchAll({ maxWidth: w });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="w-full font-mono text-xs p-1 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold disabled:opacity-50"
            />
            <span className="text-muted text-[10px]">m</span>
          </label>
          <label className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted font-bold uppercase tracking-widest text-[10px]">
              H
            </span>
            <input
              key={`bh-${allShareSize ? anchors[0].maxHeight : "mixed"}`}
              type="number"
              min={0.5}
              max={20}
              step={0.25}
              defaultValue={allShareSize ? anchors[0].maxHeight : ""}
              placeholder={allShareSize ? undefined : "mixed"}
              disabled={saving}
              onBlur={(e) => {
                const h = parseFloat(e.target.value);
                if (!Number.isFinite(h) || h <= 0) return;
                if (allShareSize && h === anchors[0].maxHeight) return;
                if (lockAspect) {
                  onPatchEach((a) => ({
                    maxWidth: clampSize(h * (a.maxWidth / a.maxHeight)),
                    maxHeight: clampSize(h),
                  }));
                } else {
                  onPatchAll({ maxHeight: h });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="w-full font-mono text-xs p-1 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold disabled:opacity-50"
            />
            <span className="text-muted text-[10px]">m</span>
          </label>
        </div>
        <label className="flex items-center gap-2 mt-2 text-[11px] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={lockAspect}
            onChange={(e) => setLockAspect(e.target.checked)}
            disabled={saving}
            className="w-3.5 h-3.5 accent-gold disabled:opacity-50"
          />
          <span className="font-bold uppercase tracking-widest text-[10px]">
            {lockAspect ? "🔒 Lock aspect ratio" : "🔓 Free resize"}
          </span>
          <span className="text-muted text-[10px] normal-case font-normal tracking-normal">
            {lockAspect
              ? allShareSize
                ? `(${(anchors[0].maxWidth / anchors[0].maxHeight).toFixed(2)}:1)`
                : "(each anchor keeps its own ratio)"
              : "(presets and W/H apply to all)"}
          </span>
        </label>
        {!allShareSize && (
          <div className="text-[10px] text-muted mt-1.5 italic">
            {lockAspect
              ? "Mixed sizes — typing W or H rescales each anchor proportionally."
              : "Mixed sizes — pick a preset or type W/H to unify."}
          </div>
        )}
      </FieldGroup>

      <FieldGroup label="Set facing for all">
        <div className="grid grid-cols-4 gap-1.5">
          {(["N", "E", "S", "W"] as FacingT[]).map((f) => (
            <button
              key={f}
              type="button"
              disabled={saving}
              onClick={() => onPatchAll({ facing: f })}
              className={`text-[11px] font-bold border-2 border-ink py-1 ${
                sharedFacing === f ? "bg-gold" : "bg-cream hover:bg-cream-dark"
              } disabled:opacity-50`}
            >
              {f}
            </button>
          ))}
        </div>
        {!sharedFacing && (
          <div className="text-[10px] text-muted mt-1.5 italic">
            Mixed facings.
          </div>
        )}
      </FieldGroup>

      <FieldGroup label="Set allowed frames for all">
        <FrameChecks
          value={firstAllowed}
          disabled={saving}
          onChange={(next) =>
            onPatchAll({ allowedFrames: next.length ? next : ["A"] })
          }
        />
      </FieldGroup>

      <FieldGroup label="Set height (Y) for all">
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted font-bold uppercase tracking-widest text-[10px]">
              Y
            </span>
            <input
              type="number"
              min={0}
              max={50}
              step={0.25}
              value={yInput}
              onChange={(e) => setYInput(e.target.value)}
              placeholder={
                allShareY
                  ? anchors[0].y == null
                    ? "auto"
                    : String(anchors[0].y)
                  : "mixed"
              }
              disabled={saving}
              className="w-20 font-mono text-xs p-1 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold disabled:opacity-50"
            />
            <span className="text-muted text-[10px]">m</span>
          </label>
          <button
            type="button"
            disabled={saving || yInput.trim() === ""}
            onClick={() => {
              const y = parseFloat(yInput);
              if (!Number.isFinite(y) || y < 0) return;
              onPatchAll({ y });
              setYInput("");
            }}
            className="bg-cream border-2 border-ink px-3 py-1.5 font-bold uppercase tracking-widest text-xs disabled:opacity-40"
          >
            Set
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              onPatchAll({ y: undefined } as unknown as Partial<AnchorT>)
            }
            className="bg-cream border border-muted px-2 py-1.5 text-[10px] uppercase tracking-widest text-muted hover:text-ink disabled:opacity-40"
            title="Clear Y on all — scene picks default height again"
          >
            auto
          </button>
        </div>
        <div className="text-[10px] text-muted mt-1 italic">
          {allShareY
            ? anchors[0].y == null
              ? "All auto-height (scene default)."
              : `All at ${anchors[0].y}m.`
            : "Mixed heights — type a value to unify."}
        </div>
      </FieldGroup>

      <FieldGroup label="Nudge position (all)">
        <div className="grid grid-cols-[14px_1fr] gap-x-1.5 gap-y-1 items-center">
          <span className="text-[10px] font-bold text-muted">X</span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={saving || !allShareArea}
              onClick={() => onNudge("x", -nudgeStep)}
              className="flex-1 text-xs font-bold border-2 border-ink py-1 bg-cream hover:bg-cream-dark disabled:opacity-40"
              title={`X -${nudgeStep}m`}
            >
              − {nudgeStep}m
            </button>
            <button
              type="button"
              disabled={saving || !allShareArea}
              onClick={() => onNudge("x", nudgeStep)}
              className="flex-1 text-xs font-bold border-2 border-ink py-1 bg-cream hover:bg-cream-dark disabled:opacity-40"
              title={`X +${nudgeStep}m`}
            >
              + {nudgeStep}m
            </button>
          </div>
          <span className="text-[10px] font-bold text-muted">Z</span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={saving || !allShareArea}
              onClick={() => onNudge("z", -nudgeStep)}
              className="flex-1 text-xs font-bold border-2 border-ink py-1 bg-cream hover:bg-cream-dark disabled:opacity-40"
              title={`Z -${nudgeStep}m`}
            >
              − {nudgeStep}m
            </button>
            <button
              type="button"
              disabled={saving || !allShareArea}
              onClick={() => onNudge("z", nudgeStep)}
              className="flex-1 text-xs font-bold border-2 border-ink py-1 bg-cream hover:bg-cream-dark disabled:opacity-40"
              title={`Z +${nudgeStep}m`}
            >
              + {nudgeStep}m
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            Step
          </span>
          {NUDGE_STEPS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setNudgeStep(s.m)}
              className={`text-[10px] font-bold border-2 border-ink px-2 py-0.5 ${
                nudgeStep === s.m ? "bg-gold" : "bg-cream hover:bg-cream-dark"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="text-[10px] font-mono text-muted mt-2 leading-snug">
          x: {fmt(xMin)} → {fmt(xMax)} (span {fmt(xMax - xMin)})
          <br />
          z: {fmt(zMin)} → {fmt(zMax)} (span {fmt(zMax - zMin)})
        </div>
        {!allShareArea && (
          <div className="text-[10px] text-coral mt-1.5 italic font-bold">
            Selection spans multiple floors — nudge disabled.
          </div>
        )}
        <div className="text-[10px] text-muted mt-1 italic">
          Arrow keys also nudge · Shift = 1m · Alt = 5cm
        </div>
      </FieldGroup>

      <FieldGroup label="Distribute evenly">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={saving || n < 3}
            onClick={() => onDistribute("x")}
            className="text-[11px] font-bold border-2 border-ink py-1.5 bg-cream hover:bg-cream-dark disabled:opacity-40"
            title="Even spacing along X — endpoints stay, middles redistribute"
          >
            ↔ Horizontal (X)
          </button>
          <button
            type="button"
            disabled={saving || n < 3}
            onClick={() => onDistribute("z")}
            className="text-[11px] font-bold border-2 border-ink py-1.5 bg-cream hover:bg-cream-dark disabled:opacity-40"
            title="Even spacing along Z — endpoints stay, middles redistribute"
          >
            ↕ Vertical (Z)
          </button>
        </div>
        <div className="text-[10px] text-muted mt-1 italic">
          {n < 3
            ? `Need 3+ anchors to distribute (have ${n}).`
            : "Endpoints (min/max on axis) stay put, middles get equal spacing."}
        </div>
      </FieldGroup>

      <FieldGroup label="Add tags to all">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTags();
              }
            }}
            disabled={saving}
            placeholder="hero, may-activation"
            className="flex-1 font-mono text-xs p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold disabled:opacity-50"
          />
          <button
            type="button"
            onClick={addTags}
            disabled={saving || !tagInput.trim()}
            className="bg-cream border-2 border-ink px-3 py-1.5 font-bold uppercase tracking-widest text-xs disabled:opacity-40"
          >
            Set
          </button>
        </div>
        <div className="text-[10px] text-muted mt-1 italic">
          Replaces existing tags on all selected.
        </div>
      </FieldGroup>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => onPatchAll({ pieceId: null })}
          disabled={saving}
          className="bg-cream border-2 border-ink px-3 py-1.5 font-bold uppercase tracking-widest text-xs disabled:opacity-40"
          title="Set pieceId=null on every selected anchor"
        >
          Clear pieces
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete ${n} anchors? This cannot be undone.`))
              onDeleteAll();
          }}
          disabled={saving}
          className="bg-coral border-2 border-ink px-3 py-1.5 font-black uppercase tracking-widest text-xs text-ink disabled:opacity-40"
        >
          Delete {n}
        </button>
      </div>
    </section>
  );
}

function DraftForm({
  draft,
  pieces,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  pieces: PieceT[];
  saving: boolean;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const placed = draft.x != null && draft.z != null;
  return (
    <section className="bg-cream border-[3px] border-coral p-4 shadow-[4px_4px_0_var(--color-ink)] flex flex-col gap-3">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-coral">
          New anchor — {AREA_LABEL[draft.area]}
        </div>
      </div>

      <div
        className={`text-xs px-2 py-1.5 border-2 border-dashed font-mono ${
          placed
            ? "border-good text-ink bg-cream-dark"
            : "border-coral text-coral"
        }`}
      >
        {placed
          ? `✓ Placed — x=${draft.x} · z=${draft.z}  ·  click again to move`
          : "⤓ Click anywhere on the map to place"}
      </div>

      <FieldGroup label="Anchor ID">
        <input
          type="text"
          value={draft.id}
          onChange={(e) => onChange({ ...draft, id: e.target.value })}
          className="w-full font-mono text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
        />
      </FieldGroup>

      <FieldGroup label="Facing">
        <select
          value={draft.facing}
          onChange={(e) =>
            onChange({ ...draft, facing: e.target.value as FacingT })
          }
          className="w-full font-sans text-sm font-semibold p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
        >
          <option value="N">N — North</option>
          <option value="E">E — East</option>
          <option value="S">S — South</option>
          <option value="W">W — West</option>
        </select>
      </FieldGroup>

      <FieldGroup label="Aspect">
        <div className="grid grid-cols-3 gap-1.5">
          {ASPECT_PRESETS.map((p) => {
            const isActive = draft.maxW === p.w && draft.maxH === p.h;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange({ ...draft, maxW: p.w, maxH: p.h })}
                className={`text-[11px] font-bold border-2 border-ink py-1 ${
                  isActive ? "bg-gold" : "bg-cream hover:bg-cream-dark"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <label className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted">W</span>
            <input
              type="number"
              step="0.5"
              min="0.5"
              value={draft.maxW}
              onChange={(e) =>
                onChange({ ...draft, maxW: parseFloat(e.target.value) || 0 })
              }
              className="w-full font-mono text-xs p-1 border-2 border-ink bg-cream"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted">H</span>
            <input
              type="number"
              step="0.5"
              min="0.5"
              value={draft.maxH}
              onChange={(e) =>
                onChange({ ...draft, maxH: parseFloat(e.target.value) || 0 })
              }
              className="w-full font-mono text-xs p-1 border-2 border-ink bg-cream"
            />
          </label>
        </div>
      </FieldGroup>

      <FieldGroup label="Allowed frames">
        <FrameChecks
          value={draft.allowed}
          disabled={false}
          onChange={(allowed) => onChange({ ...draft, allowed })}
        />
      </FieldGroup>

      <FieldGroup label="Note (optional)">
        <input
          type="text"
          value={draft.note}
          onChange={(e) => onChange({ ...draft, note: e.target.value })}
          placeholder="e.g. over the bar, visible from spawn"
          className="w-full text-sm p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
        />
      </FieldGroup>

      <FieldGroup label="Piece (optional)">
        <select
          value={draft.pieceId ?? ""}
          onChange={(e) =>
            onChange({ ...draft, pieceId: e.target.value || null })
          }
          className="w-full font-sans text-sm font-semibold p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
        >
          <option value="">— empty —</option>
          {pieces.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title || p.id}
              {p.artist ? ` — ${p.artist}` : ""}
            </option>
          ))}
        </select>
      </FieldGroup>

      <FieldGroup label="Tags (optional, comma-separated)">
        <input
          type="text"
          value={draft.tags}
          onChange={(e) => onChange({ ...draft, tags: e.target.value })}
          placeholder="may-activation, hero"
          className="w-full font-mono text-xs p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold"
        />
      </FieldGroup>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="bg-cream border-2 border-ink px-3 py-1.5 font-bold uppercase tracking-widest text-xs disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!placed || saving || draft.allowed.length === 0}
          className="bg-gold border-2 border-ink px-3 py-1.5 font-black uppercase tracking-widest text-xs shadow-[3px_3px_0_var(--color-ink)] hover:translate-x-[-1px] hover:translate-y-[-1px] disabled:opacity-40 transition-transform"
        >
          {saving ? "Saving…" : "Save anchor"}
        </button>
      </div>
    </section>
  );
}

function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

function FrameChecks({
  value,
  disabled,
  onChange,
}: {
  value: FrameKindT[];
  disabled: boolean;
  onChange: (next: FrameKindT[]) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {FRAMES.map((f) => {
        const checked = value.includes(f);
        return (
          <label
            key={f}
            className={`flex items-center gap-1.5 text-[11px] font-bold border-2 border-ink px-1.5 py-1 cursor-pointer ${
              checked ? "bg-gold" : "bg-cream hover:bg-cream-dark"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...value, f]
                  : value.filter((x) => x !== f);
                onChange(next);
              }}
              className="w-3 h-3"
            />
            <span>
              {f} {FRAME_LABEL[f]}
            </span>
          </label>
        );
      })}
    </div>
  );
}
