// Row Fill — clone a seed anchor along its wall, filling both directions.
// V1 scope: only handles floor.parcels. Bridges, pathways, and the atrium void
// are not modeled; seeds in those zones fall back to a single 16m wall centered
// on the seed and the curator hand-deletes any spillover.
// See docs/ROW_FILL_V1.md for the design notes.

import type { AnchorT } from "@/schema/manifest";
import type { Floor } from "@/app/map/floor-data";

const PARCEL_M = 16;

export type WallExtent = { min: number; max: number };

// Trace the contiguous wall the seed sits on, along the axis parallel to that
// wall. Returns axis bounds in meters. For an N/S-facing piece the wall runs
// along x; for E/W it runs along z. Perpendicular coord is snapped to the
// nearest 16m grid line — seeds clicked mid-parcel still resolve to the wall
// they're nearest to.
export function traceWall(seed: AnchorT, floor: Floor): WallExtent {
  const horizontal = seed.facing === "N" || seed.facing === "S";
  const perpRaw = horizontal ? seed.z : seed.x;
  const perpSnapped = Math.round(perpRaw / PARCEL_M) * PARCEL_M;

  const ranges: Array<[number, number]> = [];
  for (const [px, pz] of floor.parcels) {
    const pAxis = horizontal ? px : pz;
    const pPerp = horizontal ? pz : px;
    if (pPerp === perpSnapped || pPerp + PARCEL_M === perpSnapped) {
      ranges.push([pAxis, pAxis + PARCEL_M]);
    }
  }

  const seedAxis = horizontal ? seed.x : seed.z;
  if (ranges.length === 0) {
    return { min: seedAxis - PARCEL_M / 2, max: seedAxis + PARCEL_M / 2 };
  }

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [
    [ranges[0][0], ranges[0][1]] as [number, number],
  ];
  for (let i = 1; i < ranges.length; i++) {
    const cur = ranges[i];
    const last = merged[merged.length - 1];
    if (cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      merged.push([cur[0], cur[1]]);
    }
  }

  for (const [min, max] of merged) {
    if (seedAxis >= min && seedAxis <= max) return { min, max };
  }
  return { min: seedAxis - PARCEL_M / 2, max: seedAxis + PARCEL_M / 2 };
}

export type RowPosition = { x: number; z: number; isSeed: boolean };

// Compute clone positions along the wall, with `gapM` meters between piece
// edges. Includes the seed itself (flagged isSeed=true) so the result is a
// complete description of the row. Sorted along the wall axis.
export function rowFillPositions(
  seed: AnchorT,
  gapM: number,
  floor: Floor,
): RowPosition[] {
  const horizontal = seed.facing === "N" || seed.facing === "S";
  const pieceSize = horizontal ? seed.maxWidth : seed.maxHeight;
  const step = pieceSize + gapM;
  const half = pieceSize / 2;
  const wall = traceWall(seed, floor);
  const seedAxis = horizontal ? seed.x : seed.z;

  const positions: RowPosition[] = [{ x: seed.x, z: seed.z, isSeed: true }];

  for (let p = seedAxis + step; p + half <= wall.max + 1e-6; p += step) {
    positions.push(
      horizontal
        ? { x: p, z: seed.z, isSeed: false }
        : { x: seed.x, z: p, isSeed: false },
    );
  }
  for (let p = seedAxis - step; p - half >= wall.min - 1e-6; p -= step) {
    positions.push(
      horizontal
        ? { x: p, z: seed.z, isSeed: false }
        : { x: seed.x, z: p, isSeed: false },
    );
  }

  positions.sort((a, b) => (horizontal ? a.x - b.x : a.z - b.z));
  return positions;
}

// Build a fresh anchor that inherits everything from the seed except identity,
// position, piece assignment, and the seed's note. Tags propagate so a single
// tag-filter selection finds the whole row.
export function cloneAnchor(
  seed: AnchorT,
  position: { x: number; z: number },
  takenIds: Set<string>,
): AnchorT {
  let n = 2;
  let id = `${seed.id}-${n}`;
  while (takenIds.has(id)) {
    n++;
    id = `${seed.id}-${n}`;
  }
  const clone: AnchorT = {
    ...seed,
    id,
    x: position.x,
    z: position.z,
    pieceId: null,
  };
  delete (clone as { note?: string }).note;
  return clone;
}
