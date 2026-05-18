import { z } from "zod";

// SYNC: source of truth for the dashboard <-> scene contract.
// When this file changes, copy it into the scene repo at src/scene/art/schema.ts
// and update the commit hash in that file's header comment.
// Contract reference: DASHBOARD_HANDOFF.md in the scene repo.

export const FrameKind = z.enum(["A", "B", "C", "D", "E", "F"]);
export const Facing = z.enum(["N", "E", "S", "W"]);
export const Area = z.enum([
  "atrium",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "vt2",
  "vt3",
  "vt4",
  "vt5",
  "vt6",
  "skywalk",
]);

export const Piece = z.object({
  id: z.string().min(1),
  src: z.string().regex(/^https?:\/\/.+/, "must be http(s) URL"),
  aspect: z.number().positive(),
  preferredFrame: FrameKind,
  artist: z.string().optional(),
  title: z.string().optional(),
  link: z
    .string()
    .regex(/^https?:\/\/.+/, "must be http(s) URL")
    .optional(),
  tags: z.array(z.string()).optional(),
  batch: z.string().optional(),
});

export const Anchor = z.object({
  id: z.string().min(1),
  area: Area,
  x: z.number(),
  z: z.number(),
  facing: Facing,
  maxWidth: z.number().positive(),
  maxHeight: z.number().positive(),
  allowedFrames: z.array(FrameKind).optional(),
  pieceId: z.string().nullable(),
  note: z.string().optional(),
});

export const Manifest = z.object({
  version: z.number().int().nonnegative(),
  updatedAt: z.string(),
  pieces: z.record(z.string(), Piece),
  anchors: z.array(Anchor),
});

// Payload from the in-scene anchor capture tool. Same anchor shape, plus optional metadata.
export const CaptureImport = z.object({
  capturedAt: z.string().optional(),
  sceneCommit: z.string().optional(),
  anchors: z.array(Anchor),
});

export type FrameKindT = z.infer<typeof FrameKind>;
export type FacingT = z.infer<typeof Facing>;
export type AreaT = z.infer<typeof Area>;
export type PieceT = z.infer<typeof Piece>;
export type AnchorT = z.infer<typeof Anchor>;
export type ManifestT = z.infer<typeof Manifest>;
export type CaptureImportT = z.infer<typeof CaptureImport>;

export const FRAME_LABEL: Record<FrameKindT, string> = {
  A: "Ink",
  B: "Gold",
  C: "Lightbox",
  D: "Frameless",
  E: "Plinth",
  F: "Banner",
};

export const AREA_LABEL: Record<AreaT, string> = {
  atrium: "Atrium",
  f1: "F1 — Entrance",
  f2: "F2 — Main Gallery",
  f3: "F3 — Balcony",
  f4: "F4 — Stage",
  f5: "F5 — Pavilion",
  vt2: "VT F2 — Residency",
  vt3: "VT F3 — Residency",
  vt4: "VT F4 — Residency",
  vt5: "VT F5 — Hall of Fame",
  vt6: "VT F6 — Residency",
  skywalk: "Skywalk",
};

export const AREA_ORDER: AreaT[] = [
  "atrium",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "vt2",
  "vt3",
  "vt4",
  "vt5",
  "vt6",
  "skywalk",
];
