"use client";

import { useEffect, useRef, useState } from "react";
import {
  Anchor,
  AREA_LABEL,
  AREA_ORDER,
  FRAME_LABEL,
  type AnchorT,
  type AreaT,
  type FacingT,
  type FrameKindT,
  type ManifestT,
  type PieceT,
} from "@/schema/manifest";
import { fetchManifest, saveManifest } from "@/lib/client";
import {
  ALL_PARCELS,
  ASPECT_PRESETS,
  FLOORS,
  SCENE_D,
  SCENE_W,
} from "./floor-data";

const FRAMES: FrameKindT[] = ["A", "B", "C", "D", "E", "F"];

const flipX = (x: number) => SCENE_W - x;
const flipZ = (z: number) => z;
const parcelX = (x: number) => SCENE_W - x - 16;
const parcelY = (z: number) => z;
const snap = (v: number, step = 0.5) => Math.round(v / step) * step;

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
};

export default function MapView() {
  const [manifest, setManifest] = useState<ManifestT | null>(null);
  const [activeArea, setActiveArea] = useState<AreaT>("f1");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const ghostRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    fetchManifest()
      .then(setManifest)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && draft) setDraft(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2200);
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
    });
    setSelectedId(null);
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
      setSelectedId(anchor.id);
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

  async function deleteAnchor(id: string) {
    if (!manifest) return;
    if (!confirm(`Delete anchor "${id}"? This cannot be undone.`)) return;
    const next: ManifestT = {
      ...manifest,
      anchors: manifest.anchors.filter((a) => a.id !== id),
    };
    setSaving(true);
    try {
      const saved = await saveManifest(next);
      setManifest(saved);
      if (selectedId === id) setSelectedId(null);
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
  const selectedAnchor = selectedId
    ? (manifest.anchors.find((a) => a.id === selectedId) ?? null)
    : null;
  const activeSet = new Set(floor.parcels.map(([x, z]) => `${x},${z}`));
  const isPlacing = !!draft;
  const skywalkPathways = FLOORS.skywalk.pathways;

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
                setSelectedId(null);
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
              const isSel = a.id === selectedId;
              const label = a.id.startsWith(`${activeArea}-`)
                ? a.id.slice(activeArea.length + 1)
                : a.id;
              const fill = isSel ? "#ff8c42" : isFilled ? "#f5b119" : "#f5f0e1";
              return (
                <g key={a.id}>
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
                      setSelectedId(a.id);
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
                      setSelectedId(a.id);
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
          ) : selectedAnchor ? (
            <DetailCard
              anchor={selectedAnchor}
              pieces={pieces}
              saving={saving}
              onPatch={(patch) => patchAnchor(selectedAnchor.id, patch)}
              onDelete={() => deleteAnchor(selectedAnchor.id)}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <div className="border-2 border-dashed border-muted p-6 text-center text-muted text-sm">
              Click any anchor marker on the map to inspect or edit it.
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
  saving,
  onPatch,
  onDelete,
  onClose,
}: {
  anchor: AnchorT;
  pieces: PieceT[];
  saving: boolean;
  onPatch: (patch: Partial<AnchorT>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const allowed = anchor.allowedFrames ?? ["A"];
  const piece = anchor.pieceId
    ? pieces.find((p) => p.id === anchor.pieceId)
    : null;
  const frameKey = allowed[0];
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

      <div
        className={`border-2 border-ink relative overflow-hidden flex items-center justify-center ${
          piece
            ? "bg-cream-dark"
            : "bg-[repeating-linear-gradient(45deg,var(--color-cream-dark)_0_8px,var(--color-cream)_8px_16px)]"
        }`}
        style={{ aspectRatio: `${anchor.maxWidth} / ${anchor.maxHeight}` }}
      >
        {piece ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={piece.src}
              alt={piece.title || piece.id}
              className="max-w-full max-h-full object-contain"
              style={{ imageRendering: "auto" }}
            />
            <span className="absolute top-1 left-1 bg-gold text-ink font-black text-[10px] px-1.5 py-0.5 border border-ink">
              {frameKey}
            </span>
            {piece.title && (
              <div className="absolute bottom-0 left-0 right-0 bg-ink/80 text-cream text-[10px] font-bold uppercase tracking-widest px-2 py-1 truncate">
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
          <span className="text-[10px] font-black tracking-widest text-muted">
            EMPTY · {frameKey}
          </span>
        )}
      </div>

      {anchor.note && (
        <div className="text-xs italic text-muted">{anchor.note}</div>
      )}

      <div className="text-[11px] font-mono text-muted">
        x={anchor.x} · z={anchor.z} · faces {anchor.facing}
      </div>

      <FieldGroup label="Aspect">
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
        <div className="text-[10px] text-muted mt-1.5 font-mono">
          {anchor.maxWidth} × {anchor.maxHeight} m
        </div>
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
        <select
          value={anchor.pieceId ?? ""}
          disabled={saving}
          onChange={(e) => onPatch({ pieceId: e.target.value || null })}
          className="w-full font-sans text-sm font-semibold p-1.5 border-2 border-ink bg-cream focus:outline-none focus:ring-2 focus:ring-gold disabled:opacity-50"
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

      <button
        type="button"
        onClick={onDelete}
        disabled={saving}
        className="self-start text-xs text-coral border border-coral px-2 py-1 font-bold uppercase tracking-widest hover:bg-coral hover:text-ink disabled:opacity-40"
      >
        Delete anchor
      </button>
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
