// src/spaces/promoteur/plan2d/floorElements.geometry.ts
// Fonctions géométriques pour les éléments architecturaux par étage.
// Toutes les fonctions respectent la rotation de l'OrientedRect.

import type { FloorEdge, FloorBalcony2D, FloorLoggia2D, FloorTerrace2D } from './floorElements.types';
import { rectCorners } from './editor2d.geometry';

// ─── Types locaux ─────────────────────────────────────────────────────

export interface Point2D { x: number; y: number; }

export interface OrientedRect {
  center:      Point2D;
  width:       number;
  depth:       number;
  rotationDeg: number;
}

// ─── COMPASS → INDEX D'ARÊTE ──────────────────────────────────────────
//
// Arêtes du rect (corners = [nw, ne, se, sw]) :
//   0 : nw→ne  (haut,   facing north à rot=0°)
//   1 : ne→se  (droite, facing east  à rot=0°)
//   2 : se→sw  (bas,    facing south à rot=0°)
//   3 : sw→nw  (gauche, facing west  à rot=0°)
//
// Quand le bâtiment tourne de rotSteps × 90°, l'arête "north" glisse.

export function compassEdgeIndex(edge: FloorEdge, rotationDeg: number): number {
  const ci = ({ north:0, east:1, south:2, west:3 } as const)[edge];
  const rs = (((Math.round(rotationDeg / 90) % 4) + 4) % 4);
  return (ci + rs) % 4;
}

// ─── SEGMENT D'ARÊTE ──────────────────────────────────────────────────
/**
 * Retourne les deux extrémités du côté désigné par `edge`.
 * Prend en compte la rotation du rect.
 */
export function getEdgeSegment(
  rect: OrientedRect,
  edge: FloorEdge,
): [Point2D, Point2D] {
  const corners = rectCorners(rect as any) as Point2D[];
  const ei = compassEdgeIndex(edge, rect.rotationDeg);
  const edgeMap: [number, number][] = [[0,1],[1,2],[2,3],[3,0]];
  return [corners[edgeMap[ei][0]], corners[edgeMap[ei][1]]];
}

// ─── PROJECTION GÉNÉRIQUE ─────────────────────────────────────────────

/**
 * Calcule un rectangle projeté perpendiculairement à une arête.
 * direction = +1 → vers l'extérieur (balcon)
 * direction = -1 → vers l'intérieur (loggia)
 */
function edgeProjection(
  rect:      OrientedRect,
  edge:      FloorEdge,
  offsetM:   number,
  widthM:    number,
  depthM:    number,
  direction: 1 | -1,
): Point2D[] {
  const [p1, p2] = getEdgeSegment(rect, edge);
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.sqrt(dx*dx + dy*dy);
  if (len < 0.01) return [];

  const ex = dx/len, ey = dy/len;   // vecteur unitaire de l'arête
  const nx =  ey,   ny = -ex;       // normale sortante (CW perp en SVG Y-down)

  // Point milieu de l'arête + décalage latéral
  const mx = (p1.x + p2.x)/2 + ex*offsetM;
  const my = (p1.y + p2.y)/2 + ey*offsetM;
  const hw = widthM / 2;

  return [
    { x: mx - ex*hw,                        y: my - ey*hw                        },
    { x: mx + ex*hw,                        y: my + ey*hw                        },
    { x: mx + ex*hw + nx*depthM*direction,  y: my + ey*hw + ny*depthM*direction  },
    { x: mx - ex*hw + nx*depthM*direction,  y: my - ey*hw + ny*depthM*direction  },
  ];
}

// ─── API PUBLIQUE ─────────────────────────────────────────────────────

/**
 * Polygone du balcon (saillie vers l'extérieur).
 * Retourne 4 Point2D, ou [] si géométrie dégénérée.
 */
export function getBalconyPolygon(
  rect:    OrientedRect,
  balcony: FloorBalcony2D,
): Point2D[] {
  return edgeProjection(rect, balcony.edge, balcony.offsetM, balcony.widthM, balcony.depthM, 1);
}

/**
 * Polygone de la loggia (creusement vers l'intérieur).
 * Retourne 4 Point2D, ou [] si géométrie dégénérée.
 */
export function getLoggiaPolygon(
  rect:   OrientedRect,
  loggia: FloorLoggia2D,
): Point2D[] {
  return edgeProjection(rect, loggia.edge, loggia.offsetM, loggia.widthM, loggia.depthM, -1);
}

/**
 * Polygone de la terrasse.
 *   - kind='roof'    → rectangle centré sur le bâtiment
 *   - kind='setback' → rectangle en retrait sur une façade
 *
 * Note : le polygone est dans l'espace non-rotaté pour les terrasses roof.
 * Appliquer `rotate(rotationDeg, center)` dans le SVG.
 */
export function getTerracePolygon(
  rect:    OrientedRect,
  terrace: FloorTerrace2D,
): Point2D[] {
  if (terrace.kind === 'roof') {
    const cx = rect.center.x, cy = rect.center.y;
    const hw = terrace.widthM/2, hd = terrace.depthM/2;
    return [
      { x: cx-hw, y: cy-hd }, { x: cx+hw, y: cy-hd },
      { x: cx+hw, y: cy+hd }, { x: cx-hw, y: cy+hd },
    ];
  }
  // setback : creusement sur une façade (comme une loggia large)
  if (!terrace.edge) return [];
  return edgeProjection(rect, terrace.edge, terrace.offsetM??0, terrace.widthM, terrace.depthM, -1);
}

// ─── HELPER EXPORT CENTROID ───────────────────────────────────────────

export function polygonCentroid(pts: Point2D[]): Point2D {
  if (!pts.length) return { x:0, y:0 };
  return {
    x: pts.reduce((s,p) => s+p.x, 0) / pts.length,
    y: pts.reduce((s,p) => s+p.y, 0) / pts.length,
  };
}