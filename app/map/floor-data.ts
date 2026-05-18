import type { AreaT } from "@/schema/manifest";

export const SCENE_W = 96;
export const SCENE_D = 80;

export const ALL_PARCELS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [16, 0],
  [32, 0],
  [80, 0],
  [16, 16],
  [32, 16],
  [48, 16],
  [64, 16],
  [80, 16],
  [16, 32],
  [32, 32],
  [48, 32],
  [64, 32],
  [16, 48],
  [32, 48],
  [48, 48],
  [64, 48],
  [48, 64],
  [64, 64],
];

type Rect = {
  x: number;
  z: number;
  width: number;
  height: number;
  label?: string;
};

export type Floor = {
  label: string;
  sub: string;
  heightM: number;
  parcels: ReadonlyArray<readonly [number, number]>;
  atriumHole?: readonly [number, number] | null;
  bridges?: ReadonlyArray<Rect>;
  pathways?: ReadonlyArray<Rect>;
  isVault?: boolean;
  isHallOfFame?: boolean;
  description: string;
};

const VT_PARCELS: ReadonlyArray<readonly [number, number]> = [
  [80, 0],
  [80, 16],
];

export const FLOORS: Record<AreaT, Floor> = {
  atrium: {
    label: "Atrium",
    sub: "vertical void, F2 floor → roof",
    heightM: 35,
    parcels: [[48, 32]],
    description:
      "<strong>Not a floor — a vertical SHAFT.</strong> A 16×16m void at the dead center of the building. Sits on top of F2 (whose center parcel forms its floor) and opens straight up through F3 and beyond, ending around F4's level. The <strong>four atrium walls on each level</strong> hold lightbox hero pieces that glow and are visible from <em>every</em> surrounding floor.",
  },
  f1: {
    label: "F1 — Ground",
    sub: "entrance + lobby",
    heightM: 12,
    parcels: ALL_PARCELS,
    description:
      "The <strong>ground floor</strong> where every visitor spawns. Houses the front doors, lobby, and the base of the atrium shaft. Outer perimeter walls are prime <em>first-impression</em> real estate — pieces here set the tone before anyone climbs higher.",
  },
  f2: {
    label: "F2 — Main Gallery",
    sub: "rotating show wall",
    heightM: 10,
    parcels: [
      [16, 16],
      [32, 16],
      [48, 16],
      [64, 16],
      [16, 32],
      [32, 32],
      [48, 32],
      [64, 32],
      [16, 48],
      [32, 48],
      [48, 48],
      [64, 48],
    ],
    description:
      "First elevated floor (12m up). The <strong>main gallery</strong>: a complete 4×3 rectangle with <em>no atrium hole</em> — F2's center parcel forms the ceiling of F1 and the floor of the atrium above. All four perimeter walls host the rotating shows.",
  },
  f3: {
    label: "F3 — Balcony",
    sub: "wraps the atrium void",
    heightM: 9,
    parcels: [
      [32, 16],
      [48, 16],
      [64, 16],
      [32, 32],
      [64, 32],
      [32, 48],
      [48, 48],
      [64, 48],
    ],
    atriumHole: [48, 32],
    description:
      "One floor up from F2 (22m). The <strong>atrium void opens here</strong> — the center parcel is missing, so this floor wraps around the shaft like a balcony. Banners hung over the balcony edge read from <em>across</em> the atrium and are visible from F1 below, F4 above, and any floor in between.",
  },
  f4: {
    label: "F4 — Stage",
    sub: "DJ booth + dance floor",
    heightM: 16,
    parcels: [
      [48, 48],
      [64, 48],
      [48, 64],
    ],
    description:
      "L-shaped floor (31m up) housing the <strong>DJ booth, dance floor, and stage</strong>. The tall 16m ceiling fits banners and lightbox pieces that flank the booth and read with the show lighting. Sits on top of F3, so the atrium ends just below.",
  },
  f5: {
    label: "F5 — Pavilion",
    sub: "two islands + bridge",
    heightM: 13,
    parcels: [
      [48, 32],
      [64, 32],
      [48, 64],
      [64, 64],
    ],
    bridges: [{ x: 56, z: 48, width: 16, height: 16 }],
    description:
      "The <strong>Pavilion</strong> (47m up). Two island clusters joined by a <strong>central bridge</strong> spanning the 16m gap between them. The bridge is part of the floor; visitors walk across it to move between halves.",
  },
  vt2: {
    label: "VT F2 — Residency",
    sub: "first residency tier",
    heightM: 8,
    parcels: VT_PARCELS,
    isVault: true,
    description:
      "<strong>Vault Tower — Floor 2.</strong> First residency level above the VT lobby. A single artist occupies all four walls for one rotation cycle (≈monthly).",
  },
  vt3: {
    label: "VT F3 — Residency",
    sub: "mid residency tier",
    heightM: 8,
    parcels: VT_PARCELS,
    isVault: true,
    description:
      "<strong>Vault Tower — Floor 3.</strong> Mid-tier residency. Same footprint as VT F2/F4/F6, hosts one artist at a time across all walls.",
  },
  vt4: {
    label: "VT F4 — Residency",
    sub: "senior residency tier",
    heightM: 8,
    parcels: VT_PARCELS,
    isVault: true,
    description:
      "<strong>Vault Tower — Floor 4.</strong> Senior residency tier — typically a more established artist or a multi-piece installation.",
  },
  vt5: {
    label: "VT F5 — Hall of Fame",
    sub: "past-residents showcase",
    heightM: 8,
    parcels: VT_PARCELS,
    isVault: true,
    isHallOfFame: true,
    description:
      "<strong>Vault Tower — Floor 5: HALL OF FAME.</strong> A <em>curated retrospective</em> of past residents. Pulls from pieces tagged as alumni and rotates less often.",
  },
  vt6: {
    label: "VT F6 — Residency",
    sub: "top-floor prestige",
    heightM: 8,
    parcels: VT_PARCELS,
    isVault: true,
    description:
      "<strong>Vault Tower — Floor 6.</strong> Top-floor residency, the prestige slot. Visitors climb past four lower residencies to reach this artist's work at the summit.",
  },
  skywalk: {
    label: "Skywalk",
    sub: "two-arm overhead bridge",
    heightM: 4,
    parcels: [],
    pathways: [
      { x: 0, z: 6, width: 80, height: 5, label: "WEST ARM" },
      { x: 83, z: 32, width: 5, height: 48, label: "SOUTH ARM" },
    ],
    description:
      "A <strong>two-arm overhead skybridge</strong> emerging from the Vault Tower. The <strong>west arm</strong> crosses ~48m back toward the main building; the <strong>south arm</strong> extends ~24m south of VT. The pathway is ~5m wide. Banners hung along the arms read while visitors traverse.",
  },
};

export const ASPECT_PRESETS: ReadonlyArray<{
  label: string;
  w: number;
  h: number;
}> = [
  { label: "1:1", w: 3, h: 3 },
  { label: "2:3", w: 2, h: 3 },
  { label: "3:2", w: 3, h: 2 },
  { label: "16:9", w: 3.6, h: 2 },
  { label: "4:1 ↔", w: 4, h: 1 },
  { label: "1:4 ↕", w: 1, h: 4 },
];
