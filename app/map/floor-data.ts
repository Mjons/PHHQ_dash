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
    // Fills the entire empty [64,64] quadrant with two 8m-deep strips,
    // splitting it into dance floor (south half, against [64,48]) and stage
    // (north half, against the venue's north boundary).
    bridges: [
      // Dance floor extension — flush against [64,48]'s north (bottom-of-
      // screen) edge along the full 16m width.
      { x: 64, z: 64, width: 16, height: 8, label: "DANCE EXT" },
      // Stage extension — flush against the dance floor's north edge (z=72).
      // Adds a 16m north wall (z=80) and an 8m east wall (x=80) for hero
      // pieces; west edge butts up against [48,64] so no new west wall.
      { x: 64, z: 72, width: 16, height: 8, label: "STAGE EXT" },
    ],
    description:
      "L-shaped floor (31m up) housing the <strong>DJ booth, dance floor, and stage</strong>. The tall 16m ceiling fits banners and lightbox pieces that flank the booth and read with the show lighting. Sits on top of F3, so the atrium ends just below. An <strong>8m-deep dance-floor extension</strong> plus an <strong>8m-deep stage extension</strong> fill the NE corner: dance floor abuts the main stage; the stage extension sits at the venue's north edge with a 16m back wall.",
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
    sub: "U-shaped overhead bridge from spawn",
    heightM: 4,
    parcels: [],
    pathways: [
      // South path — sits at the bottom edge of the z=0 parcel row
      // (z=11..16), west end aligned with the west leg (x=3), running east
      // to x=48. 45m long. (Right-of-screen = WEST in world.)
      { x: 3, z: 11, width: 45, height: 5, label: "SOUTH PATH" },
      // West leg — inset 3m from the west edge of the venue (x=3..8). Top
      // aligned with the south path (z=11), runs down to the north span
      // (z=53). 42m tall. Visitor enters here from spawn.
      { x: 3, z: 11, width: 5, height: 42, label: "WEST LEG" },
      // East leg — short stub on the NE corner, attached to the north span
      // and rising about halfway up. Doesn't reach the south path.
      { x: 75, z: 26, width: 5, height: 27, label: "EAST LEG" },
      // North span across the lower-middle row at z=48–53. West end aligned
      // with the west leg (x=3), running east to x=80. 77m long.
      { x: 3, z: 48, width: 77, height: 5, label: "NORTH SPAN" },
    ],
    description:
      "An overhead <strong>skybridge</strong> with four segments. Enter from the <strong>spawn corner</strong> in the SW; the <strong>south path</strong> (~45m) hugs the south edge running east to x=48. The <strong>west leg</strong> drops the full height from spawn down to the north span. The <strong>north span</strong> (~77m) runs west-to-east across the lower-middle row. The <strong>east leg</strong> is a short stub climbing about halfway up from the NE corner. Pathways are 5m wide.",
  },
};

const PARCEL_M = 16;

// True if (x, z) falls inside any parcel (or bridge / skywalk pathway) of the
// given area. Used by bulk nudge to refuse moves that would slide an anchor
// off the floor. Parcels are authoritative — F3's missing center parcel is
// already excluded by FLOORS.f3.parcels, so the atrium void requires no extra
// hole check.
export function isInArea(area: AreaT, x: number, z: number): boolean {
  const floor = FLOORS[area];
  for (const [px, pz] of floor.parcels) {
    if (x >= px && x <= px + PARCEL_M && z >= pz && z <= pz + PARCEL_M)
      return true;
  }
  for (const b of floor.bridges ?? []) {
    if (x >= b.x && x <= b.x + b.width && z >= b.z && z <= b.z + b.height)
      return true;
  }
  for (const p of floor.pathways ?? []) {
    if (x >= p.x && x <= p.x + p.width && z >= p.z && z <= p.z + p.height)
      return true;
  }
  return false;
}

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
