// ─── editor2d.snap.ts ────────────────────────────────────────────────────────
// Moteur de snap — priorité intelligente, calculs en espace monde

import type { Point2D, SnapOptions } from './editor2d.types';
import { closestPointOnSegment, pointToSegmentDist, dist } from './editor2d.geometry';

export type SnapKind = 'parcelleVertex' | 'parcelleEdge' | 'orthogonal' | 'grid' | null;

export interface SnapResult {
  point:     Point2D;
  snappedTo: SnapKind;
}

export interface SnapContext {
  options:          SnapOptions;
  /** Pixels par unité monde (depuis getScreenCTM().a) */
  zoom:             number;
  parcellePolygon:  Point2D[];
  /** Référence pour snap orthogonal (origine du draw en cours) */
  orthogonalRef?:   Point2D;
}

/** Convertit le seuil pixel en unités monde */
function worldThreshold(thresholdPx: number, zoom: number): number {
  return thresholdPx / zoom;
}

function snapGrid(p: Point2D, size: number): Point2D {
  return {
    x: Math.round(p.x / size) * size,
    y: Math.round(p.y / size) * size,
  };
}

/**
 * Point d'entrée principal.
 * Ordre de priorité : sommet parcelle > orthogonal > segment parcelle > grille > brut
 */
export function snapPoint(raw: Point2D, ctx: SnapContext): SnapResult {
  const { options, zoom, parcellePolygon, orthogonalRef } = ctx;
  const thresh = worldThreshold(options.thresholdPx, zoom);

  // 1. Sommets parcelle
  if (options.parcelleVertices) {
    for (const v of parcellePolygon) {
      if (dist(raw, v) < thresh) {
        return { point: { ...v }, snappedTo: 'parcelleVertex' };
      }
    }
  }

  // 2. Orthogonal (axe du point d'origine du draw)
  if (options.orthogonal && orthogonalRef) {
    const dx = Math.abs(raw.x - orthogonalRef.x);
    const dy = Math.abs(raw.y - orthogonalRef.y);
    const orthoThresh = thresh * 1.5;
    if (dx < orthoThresh && dy >= orthoThresh) {
      return { point: { x: orthogonalRef.x, y: raw.y }, snappedTo: 'orthogonal' };
    }
    if (dy < orthoThresh && dx >= orthoThresh) {
      return { point: { x: raw.x, y: orthogonalRef.y }, snappedTo: 'orthogonal' };
    }
  }

  // 3. Segments parcelle
  if (options.parcelleEdges) {
    let bestDist = thresh;
    let bestPt: Point2D | null = null;
    for (let i = 0; i < parcellePolygon.length; i++) {
      const a = parcellePolygon[i];
      const b = parcellePolygon[(i + 1) % parcellePolygon.length];
      const d = pointToSegmentDist(raw, a, b);
      if (d < bestDist) {
        bestDist = d;
        bestPt = closestPointOnSegment(raw, a, b);
      }
    }
    if (bestPt) return { point: bestPt, snappedTo: 'parcelleEdge' };
  }

  // 4. Grille
  if (options.grid) {
    const gp = snapGrid(raw, options.gridSize);
    if (dist(gp, raw) < thresh) {
      return { point: gp, snappedTo: 'grid' };
    }
  }

  return { point: raw, snappedTo: null };
}