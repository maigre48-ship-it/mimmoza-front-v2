// ─── editor2d.measure.ts ─────────────────────────────────────────────────────
// Calculs des lignes de cotes — purs, sans dépendance React

import type { Point2D, Building2D, Parking2D } from './editor2d.types';
import {
  rectCorners,
  midpoint,
  pointToSegmentDist,
  closestPointOnSegment,
  dist,
} from './editor2d.geometry';

export type CoteFamily = 'building' | 'setback' | 'interBuilding' | 'parking';

export interface DimensionLine {
  id:      string;
  from:    Point2D;
  to:      Point2D;
  label:   string;
  family:  CoteFamily;
  /** Décalage perpendiculaire en unités monde pour affichage */
  perpOffset: number;
}

// ── Dimensions bâtiment ──────────────────────────────────────────────────────

export function buildingDimensions(b: Building2D): DimensionLine[] {
  const c = rectCorners(b.rect);
  const ow = 2; // offset monde
  return [
    {
      id:          `dim-w-${b.id}`,
      from:        c[0],
      to:          c[1],
      label:       `${b.rect.width.toFixed(1)} m`,
      family:      'building',
      perpOffset:  -ow,
    },
    {
      id:          `dim-d-${b.id}`,
      from:        c[1],
      to:          c[2],
      label:       `${b.rect.depth.toFixed(1)} m`,
      family:      'building',
      perpOffset:  ow,
    },
  ];
}

// ── Dimensions parking ────────────────────────────────────────────────────────

export function parkingDimensions(p: Parking2D): DimensionLine[] {
  const c = rectCorners(p.rect);
  const ow = 2;
  return [
    {
      id:          `dim-w-${p.id}`,
      from:        c[0],
      to:          c[1],
      label:       `${p.rect.width.toFixed(1)} m`,
      family:      'parking',
      perpOffset:  -ow,
    },
    {
      id:          `dim-d-${p.id}`,
      from:        c[1],
      to:          c[2],
      label:       `${p.rect.depth.toFixed(1)} m`,
      family:      'parking',
      perpOffset:  ow,
    },
  ];
}

// ── Reculs aux limites parcellaires ──────────────────────────────────────────

export function buildingSetbacks(
  building: Building2D,
  parcellePoly: Point2D[],
): DimensionLine[] {
  const corners = rectCorners(building.rect);
  const sides = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ] as const;

  const lines: DimensionLine[] = [];
  const labels = ['N', 'E', 'S', 'O'];

  sides.forEach(([a, b], i) => {
    const mid = midpoint(a, b);
    let minD = Infinity;
    let closestPt: Point2D = mid;

    for (let j = 0; j < parcellePoly.length; j++) {
      const pa = parcellePoly[j];
      const pb = parcellePoly[(j + 1) % parcellePoly.length];
      const d = pointToSegmentDist(mid, pa, pb);
      if (d < minD) {
        minD = d;
        closestPt = closestPointOnSegment(mid, pa, pb);
      }
    }

    if (minD > 0.1 && minD < 200) {
      lines.push({
        id:          `setback-${building.id}-${labels[i]}`,
        from:        mid,
        to:          closestPt,
        label:       `${minD.toFixed(1)} m`,
        family:      'setback',
        perpOffset:  0,
      });
    }
  });

  return lines;
}

// ── Distance inter-bâtiments ──────────────────────────────────────────────────

export function interBuildingDistance(
  a: Building2D,
  b: Building2D,
): DimensionLine | null {
  const ca = rectCorners(a.rect);
  const cb = rectCorners(b.rect);

  const sidesA = ca.map((pt, i) => [pt, ca[(i + 1) % 4]] as [Point2D, Point2D]);
  const sidesB = cb.map((pt, i) => [pt, cb[(i + 1) % 4]] as [Point2D, Point2D]);

  let minD = Infinity;
  let fromPt = ca[0], toPt = cb[0];

  for (const [a1, a2] of sidesA) {
    const mid = midpoint(a1, a2);
    for (const [b1, b2] of sidesB) {
      const d = pointToSegmentDist(mid, b1, b2);
      if (d < minD) {
        minD = d;
        fromPt = mid;
        toPt = closestPointOnSegment(mid, b1, b2);
      }
    }
  }

  if (minD < 0.5 || minD > 200) return null;

  return {
    id:          `inter-${a.id}-${b.id}`,
    from:        fromPt,
    to:          toPt,
    label:       `${minD.toFixed(1)} m`,
    family:      'interBuilding',
    perpOffset:  0,
  };
}