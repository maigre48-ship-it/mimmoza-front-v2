// massingFacadeGrid.ts — Architectural window grid calculator
// Computes window placement for each facade edge with proper hierarchy:
//   - Socle (RDC): taller openings, potential door bays
//   - Corps (typical floors): regular window grid
//   - Attique (top floor if setback): smaller, more discreet openings

// ─── Types ────────────────────────────────────────────────────────────────────

export type ZoneType = "socle" | "corps" | "attique";

export interface WindowBay {
  /** Position along facade edge (0 = start, 1 = end) */
  tStart: number;
  tEnd: number;
  /** Vertical bounds relative to floor */
  vBottom: number; // ratio from floor bottom (0 = floor, 1 = ceiling)
  vTop: number;
  /** Bay type */
  type: "window" | "porte_fenetre" | "door" | "vitrine";
  /** Zone this bay belongs to */
  zone: ZoneType;
}

export interface FacadeFloorGrid {
  floorIndex: number;
  zone: ZoneType;
  bays: WindowBay[];
  /** Floor Y bounds in scene units (absolute) */
  yBottom: number;
  yTop: number;
}

export interface FacadeGridResult {
  floors: FacadeFloorGrid[];
  /** Number of vertical bays across the facade */
  numBays: number;
}

export interface FacadeGridParams {
  /** Facade edge length in scene units */
  edgeLength: number;
  /** Total number of above-ground floors */
  totalFloors: number;
  /** Height of each floor in scene units */
  floorHeight: number;
  /** Base Y of the building in scene units */
  baseY: number;
  /** Window-to-wall ratio (0.25 – 0.90) */
  windowRatio: number;
  /** Bay width target in scene units */
  bayWidth: number;
  /** Whether this facade is a socle-only face (short edge, etc) */
  isSocle?: boolean;
  /** Index of the floor where attique starts (0-based). -1 = no attique */
  attiqueStartFloor: number;
  /** Has balconies? */
  hasBalconies: boolean;
  /** Balcony frequency (every N floors) */
  balconyFreq: number;
  /** Facade style hint */
  facadeStyle: string;
}

// ─── Grid computation ─────────────────────────────────────────────────────────

/**
 * Compute the full window grid for one facade edge.
 * Returns per-floor bay lists with proper architectural hierarchy.
 */
export function computeFacadeGrid(params: FacadeGridParams): FacadeGridResult {
  const {
    edgeLength, totalFloors, floorHeight, baseY,
    windowRatio, bayWidth, attiqueStartFloor,
    hasBalconies, balconyFreq, facadeStyle,
  } = params;

  // Skip very short edges (< 1.5m equivalent)
  if (edgeLength < bayWidth * 0.4) {
    return { floors: [], numBays: 0 };
  }

  // ── Compute bay count ──
  const minMargin = bayWidth * 0.25; // smaller margin = more filled facade
  const usableWidth = edgeLength - 2 * minMargin;
  if (usableWidth < bayWidth * 0.5) {
    return { floors: [], numBays: 0 };
  }

  const rawBays = Math.max(1, Math.round(usableWidth / bayWidth));
  const numBays = rawBays;
  const actualBayWidth = usableWidth / numBays;
  const marginT = minMargin / edgeLength;
  const bayWidthT = actualBayWidth / edgeLength;

  // ── Window proportions by zone ──
  // Wider windows = more residential, less prison-like
  const windowWidthRatio = Math.min(0.85, windowRatio * 1.3);
  const socleWindowWidthRatio = Math.min(0.90, windowRatio * 1.4);

  const floors: FacadeFloorGrid[] = [];

  for (let f = 0; f < totalFloors; f++) {
    const yBottom = baseY + f * floorHeight;
    const yTop = yBottom + floorHeight;
    const zone = classifyZone(f, totalFloors, attiqueStartFloor);
    const bays: WindowBay[] = [];

    for (let b = 0; b < numBays; b++) {
      const centerT = marginT + (b + 0.5) * bayWidthT;
      const bay = computeSingleBay(
        centerT, bayWidthT, zone, f, totalFloors,
        windowWidthRatio, socleWindowWidthRatio,
        hasBalconies, balconyFreq, facadeStyle,
        b, numBays,
      );
      if (bay) bays.push(bay);
    }

    floors.push({ floorIndex: f, zone, bays, yBottom, yTop });
  }

  return { floors, numBays };
}

// ─── Zone classification ──────────────────────────────────────────────────────

function classifyZone(floor: number, totalFloors: number, attiqueStart: number): ZoneType {
  if (floor === 0) return "socle";
  if (attiqueStart > 0 && floor >= attiqueStart) return "attique";
  return "corps";
}

// ─── Single bay computation ───────────────────────────────────────────────────

function computeSingleBay(
  centerT: number,
  bayWidthT: number,
  zone: ZoneType,
  floor: number,
  totalFloors: number,
  windowWidthRatio: number,
  socleWindowWidthRatio: number,
  hasBalconies: boolean,
  balconyFreq: number,
  facadeStyle: string,
  bayIndex: number,
  numBays: number,
): WindowBay | null {

  // Determine opening proportions based on zone
  let wRatio: number;
  let vBottom: number;
  let vTop: number;
  let type: WindowBay["type"];

  switch (zone) {
    case "socle": {
      // Ground floor: taller openings, potentially doors
      const isDoor = bayIndex === 0 || (numBays >= 4 && bayIndex === Math.floor(numBays / 2));
      if (isDoor) {
        wRatio = socleWindowWidthRatio * 0.7;
        vBottom = 0.02;
        vTop = 0.92;
        type = "door";
      } else if (facadeStyle === "vitrage") {
        wRatio = socleWindowWidthRatio;
        vBottom = 0.05;
        vTop = 0.92;
        type = "vitrine";
      } else {
        wRatio = socleWindowWidthRatio;
        vBottom = 0.08;
        vTop = 0.85;
        type = "porte_fenetre";
      }
      break;
    }
    case "attique": {
      // Top recessed floor: smaller, more discreet
      wRatio = windowWidthRatio * 0.85;
      vBottom = 0.18;
      vTop = 0.78;
      type = "window";
      break;
    }
    case "corps":
    default: {
      // Typical floors — wider, more residential proportions
      const isBalconyFloor = hasBalconies && floor > 0 && (floor % balconyFreq === 0);
      if (isBalconyFloor) {
        wRatio = windowWidthRatio;
        vBottom = 0.05;
        vTop = 0.84;
        type = "porte_fenetre";
      } else {
        wRatio = windowWidthRatio;
        vBottom = 0.22;  // higher sill = more square window
        vTop = 0.82;
        type = "window";
      }
      break;
    }
  }

  const halfW = (bayWidthT * wRatio) / 2;
  return {
    tStart: centerT - halfW,
    tEnd: centerT + halfW,
    vBottom,
    vTop,
    type,
    zone,
  };
}

// ─── Utility: check if a floor should have balconies ──────────────────────────

export function shouldHaveBalcony(floor: number, zone: ZoneType, hasBalconies: boolean, freq: number): boolean {
  if (!hasBalconies) return false;
  if (zone === "socle") return false;
  return floor > 0 && (floor % freq === 0);
}