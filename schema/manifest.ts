import { z } from "zod";

// SYNC: source of truth for the dashboard <-> scene contract.
// When this file changes, copy it into the scene repo at src/scene/art/schema.ts
// and update the commit hash in that file's header comment.
// Contract reference: DASHBOARD_HANDOFF.md in the scene repo.

// Same regex as Piece.src — works around DCL's QuickJS rejecting digit-leading
// hostnames in `new URL(...)` (Vercel Blob hostnames look like
// 8f9d...public.blob.vercel-storage.com). See MANIFEST_INTEGRATION.md.
const httpUrl = z.string().regex(/^https?:\/\/.+/, "must be http(s) URL");

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

// Sub-enum of Area covering only the Vault Tower floors. Used as the typed
// key of `Manifest.vaultResidencies` so per-floor configs can't accidentally
// be written for non-VT areas. See docs/VAULT_TIPPING_PLAN.md.
export const VTFloor = z.enum(["vt2", "vt3", "vt4", "vt5", "vt6"]);

// 0x-prefixed 40-char hex address. EIP-55 checksum is verified client-side
// via viem; here we just enforce the shape so junk can't land in the manifest.
const ethAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "must be a 0x-prefixed 40-char hex address");

export const Piece = z.object({
  id: z.string().min(1),
  src: httpUrl,
  // Still poster used by the scene when `src` is a video file (e.g. SuperRare
  // signed `.mp4`) or any other format the in-scene texture loader can't
  // decode. Dashboard previews always use `src` (so the curator sees the
  // motion in the picker); the scene reads `poster ?? src`. Required in
  // practice for any piece a curator places in-room with a video src —
  // without it, the scene errors out on texture load. See docs/SCENE_VIDEO_POSTER.md.
  poster: httpUrl.optional(),
  aspect: z.number().positive(),
  preferredFrame: FrameKind,
  artist: z.string().optional(),
  title: z.string().optional(),
  link: httpUrl.optional(),
  tags: z.array(z.string()).optional(),
  batch: z.string().optional(),
});

export const Anchor = z.object({
  id: z.string().min(1),
  area: Area,
  x: z.number(),
  z: z.number(),
  // Height above the floor in meters. Optional: when absent, the scene picks
  // its existing default (typically the wall midpoint). When present, scene
  // should use this exact value. Curator-set via the map dashboard.
  y: z.number().nonnegative().optional(),
  facing: Facing,
  maxWidth: z.number().positive(),
  maxHeight: z.number().positive(),
  allowedFrames: z.array(FrameKind).optional(),
  pieceId: z.string().nullable(),
  note: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

// =========================================================
// Books — pedestal-mounted multi-page comics. See
// BOOKS_VERCEL_BLOB_EXPLORATION.md in the scene repo for the design contract.
// =========================================================

// Episode page-layout aspect. Cover aspect is independent (CoverAspect below).
//   square    → 1:1   (e.g. 1080×1080)        — Instagram/panel-of-the-day
//   portrait  → 7:10  (e.g. 980×1400)         — classic comic page
//   landscape → 10:8  (e.g. 1250×1000, 5:4)   — widescreen splash
//   spread    → two 7:10 pages side-by-side   — book-style; pages advance in PAIRS
export const Aspect = z.enum(["square", "portrait", "landscape", "spread"]);

// Cover aspect. `wide` is the traditional comic-book 3:2 (front+spine+back
// wraparound) and remains the default. Other values let curators upload
// portrait book covers, square poster covers, etc.
//   wide      → 3:2   (e.g. 1500×1000)        — default
//   square    → 1:1   (e.g. 1080×1080)
//   portrait  → 7:10  (e.g. 980×1400)         — book-cover style
//   landscape → 10:8  (e.g. 1250×1000)
export const CoverAspect = z.enum(["wide", "square", "portrait", "landscape"]);

// Pedestal cover shape — drives the 3D book mesh on the plinth.
//   portrait  → 7:10 (default — closed book, taller than wide)
//   square    → 1:1
//   landscape → 10:8 (5:4, slightly wider than tall)
//   book      → 3:2 OPEN book; cover image stretches across two pages, same
//               height as portrait so books on adjacent pedestals line up.
export const PedestalAspect = z.enum([
  "portrait",
  "square",
  "landscape",
  "book",
]);

export const BookEpisode = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  byline: z.string().optional(),
  frontCover: httpUrl.optional(), // first frame if present
  backCover: httpUrl.optional(), // last frame if present
  coverAspect: CoverAspect.default("wide"), // shape of front/back covers
  pages: z.array(httpUrl).min(1).max(34),
  aspect: Aspect,
});

export const BookSeries = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  cover: httpUrl, // texture on the 3D pedestal book; aspect = pedestalAspect
  pedestalAspect: PedestalAspect.default("portrait"),
  episodes: z.array(BookEpisode),
  byline: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

// Curator-placed pedestals. Mirrors `Anchor` so the dashboard can reuse the
// placement UX. `seriesId` is the foreign key into `series[].id`; null = empty.
export const BookAnchor = z.object({
  id: z.string().min(1),
  area: Area, // v1 is always "f2"; schema allows any area
  x: z.number(),
  z: z.number(),
  facing: Facing,
  seriesId: z.string().nullable(),
  note: z.string().optional(),
});

// =========================================================
// Music — global venue audio. v1 is one library of uploaded tracks plus a
// single `nowPlaying` switch that selects which one (or a live stream) the
// scene plays venue-wide. See docs/MUSIC_HOSTING_PLAN.md.
// =========================================================

export const TrackMime = z.enum(["audio/mpeg", "audio/mp4", "audio/ogg"]);

export const Track = z.object({
  id: z.string().min(1),
  src: httpUrl,
  title: z.string().min(1),
  artist: z.string().optional(),
  durationSec: z.number().positive().optional(),
  mime: TrackMime,
  gainDb: z.number().min(-30).max(6).default(0),
  tags: z.array(z.string()).optional(),
});

// Discriminated union — exactly one mode at a time. The scene reads
// `nowPlaying.kind` once and branches; no precedence rules to maintain.
//
// Looping lives on the playback decision (here), not on the track, so the
// curator has one switch per mode instead of per-file confusion:
//   - track:    `loop` = repeat this single track forever
//   - playlist: `loop` = when the last track ends, restart from the first
//   - stream:   live streams are never looped (they're already continuous)
export const NowPlaying = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("off") }),
  z.object({
    kind: z.literal("track"),
    trackId: z.string().min(1),
    loop: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("playlist"),
    loop: z.boolean().default(true),
  }),
  z.object({ kind: z.literal("stream"), streamUrl: httpUrl }),
]);

// =========================================================
// Vault Tower tipping — per-VT-floor artist residencies + tip pedestal config.
// Tip *state* (totals, last-tip time, gold-frame override) is intentionally
// NOT on the manifest — it's a separate Redis namespace served by /api/tips
// to avoid bumping manifest version on every on-chain tip. See
// docs/VAULT_TIPPING_PLAN.md.
// =========================================================

export const VaultResidency = z.object({
  // Recipient wallet. Tips are USDC-on-Polygon, wallet-to-wallet, no custody.
  artistWallet: ethAddress,
  // Display name; falls back to ENS or shortened address client-side.
  artistName: z.string().min(1).max(80).optional(),
  // Plaque text shown above the in-scene pedestal.
  artistMessage: z.string().min(1).max(280),
  artistLinks: z
    .object({
      twitter: httpUrl.optional(),
      lens: httpUrl.optional(),
      farcaster: httpUrl.optional(),
      opensea: httpUrl.optional(),
      site: httpUrl.optional(),
    })
    .optional(),
  // Where in the floor the pedestal sits, scene-local meters on the floor's
  // Y baseline. Absent = config exists but pedestal not placed yet; the scene
  // skips rendering it until both fields are present.
  pedestalPos: z.object({ x: z.number(), z: z.number() }).optional(),
  // QR PNG generated server-side on save; encodes /tip/<floor>.
  qrSrc: httpUrl.optional(),
  // ISO datetime; when past, the floor reverts to no-tipping behaviour but
  // historical tip state stays readable via /api/tips for activity records.
  activeUntil: z.string().optional(),
});

export const Manifest = z.object({
  version: z.number().int().nonnegative(),
  updatedAt: z.string(),
  pieces: z.record(z.string(), Piece),
  anchors: z.array(Anchor),
  series: z.array(BookSeries).default([]),
  bookAnchors: z.array(BookAnchor).default([]),
  tracks: z.record(z.string(), Track).default({}),
  nowPlaying: NowPlaying.default({ kind: "off" }),
  // Per-VT-floor residency config. Keys SHOULD be VTFloor values; the
  // dashboard form only writes those. Typed as a string-keyed record to match
  // the existing pieces/tracks pattern (Zod 4's enum-keyed record demands
  // every enum value, which is wrong for an optional partial map).
  // Absent floor = no residency, no pedestal, no tipping. Tip state lives in
  // /api/tips, not here.
  vaultResidencies: z.record(z.string(), VaultResidency).default({}),
  // Wall-clock instant the current `nowPlaying` mode began. The server sets
  // this in /api/manifest POST whenever the mode signature (kind + trackId +
  // streamUrl) changes; otherwise it carries over. Scene clients compute
  // "which track at what offset" deterministically from `Date.now() -
  // playbackStartedAt`, so returning visitors and late joiners enter the
  // playlist in lockstep. Epoch is the safe "no music has ever played" value
  // for backfill on pre-existing manifests.
  playbackStartedAt: z.string().default("1970-01-01T00:00:00.000Z"),
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
export type AspectT = z.infer<typeof Aspect>;
export type CoverAspectT = z.infer<typeof CoverAspect>;
export type PedestalAspectT = z.infer<typeof PedestalAspect>;
export type BookEpisodeT = z.infer<typeof BookEpisode>;
export type BookSeriesT = z.infer<typeof BookSeries>;
export type BookAnchorT = z.infer<typeof BookAnchor>;
export type TrackMimeT = z.infer<typeof TrackMime>;
export type TrackT = z.infer<typeof Track>;
export type NowPlayingT = z.infer<typeof NowPlaying>;
export type VTFloorT = z.infer<typeof VTFloor>;
export type VaultResidencyT = z.infer<typeof VaultResidency>;

export const VAULT_FLOORS: VTFloorT[] = ["vt2", "vt3", "vt4", "vt5", "vt6"];

export const VAULT_FLOOR_LABEL: Record<VTFloorT, string> = {
  vt2: "VT F2 — Residency",
  vt3: "VT F3 — Residency",
  vt4: "VT F4 — Residency",
  vt5: "VT F5 — Hall of Fame",
  vt6: "VT F6 — Residency",
};

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

export const ASPECT_LABEL: Record<AspectT, string> = {
  square: "Square 1:1",
  portrait: "Portrait 7:10",
  landscape: "Landscape 10:8",
  spread: "Spread (2 pages)",
};

export const COVER_ASPECT_LABEL: Record<CoverAspectT, string> = {
  wide: "Wide 3:2",
  square: "Square 1:1",
  portrait: "Portrait 7:10",
  landscape: "Landscape 10:8",
};

export const PEDESTAL_ASPECT_LABEL: Record<PedestalAspectT, string> = {
  portrait: "Portrait 7:10",
  square: "Square 1:1",
  landscape: "Landscape 10:8",
  book: "Book (open, 2× width)",
};
