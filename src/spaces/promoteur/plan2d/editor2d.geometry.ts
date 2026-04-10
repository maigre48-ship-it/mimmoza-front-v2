// ─── editor2d.geometry.ts V2 ─────────────────────────────────────────────────

import type { Point2D, OrientedRect } from './editor2d.types';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

// ── Rotation ──────────────────────────────────────────────────────────────────

export function rotatePoint(p: Point2D, deg: number, o: Point2D = { x: 0, y: 0 }): Point2D {
  const r = deg * DEG2RAD;
  const cos = Math.cos(r), sin = Math.sin(r);
  const dx = p.x - o.x, dy = p.y - o.y;
  return { x: o.x + dx * cos - dy * sin, y: o.y + dx * sin + dy * cos };
}

// ── Rectangle orienté ─────────────────────────────────────────────────────────

/** 4 coins en espace monde — ordre: NW, NE, SE, SW */
export function rectCorners(r: OrientedRect): [Point2D, Point2D, Point2D, Point2D] {
  const hw = r.width / 2, hd = r.depth / 2;
  const local: Point2D[] = [
    { x: r.center.x - hw, y: r.center.y - hd },
    { x: r.center.x + hw, y: r.center.y - hd },
    { x: r.center.x + hw, y: r.center.y + hd },
    { x: r.center.x - hw, y: r.center.y + hd },
  ];
  return local.map(p => rotatePoint(p, r.rotationDeg, r.center)) as [Point2D, Point2D, Point2D, Point2D];
}

/** Rectangle axis-aligné depuis deux coins (drag simple) */
export function rectFromTwoPoints(a: Point2D, b: Point2D): OrientedRect {
  return {
    center:      { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    width:       Math.abs(b.x - a.x),
    depth:       Math.abs(b.y - a.y),
    rotationDeg: 0,
  };
}

/** ✦ V2 — Carré contraint (Shift) */
export function squareFromTwoPoints(a: Point2D, b: Point2D): OrientedRect {
  const size = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  const sx = b.x >= a.x ? 1 : -1;
  const sy = b.y >= a.y ? 1 : -1;
  return rectFromTwoPoints(a, { x: a.x + size * sx, y: a.y + size * sy });
}

/** ✦ V2 — Dessin depuis le centre (Alt) */
export function rectFromCenterAndPoint(center: Point2D, p: Point2D): OrientedRect {
  return {
    center,
    width:       Math.abs(p.x - center.x) * 2,
    depth:       Math.abs(p.y - center.y) * 2,
    rotationDeg: 0,
  };
}

/** ✦ V2 — Carré depuis le centre (Shift+Alt) */
export function squareFromCenterAndPoint(center: Point2D, p: Point2D): OrientedRect {
  const half = Math.max(Math.abs(p.x - center.x), Math.abs(p.y - center.y));
  return { center, width: half * 2, depth: half * 2, rotationDeg: 0 };
}

/** ✦ V2 — Taille minimale garantie */
export function clampRectSize(r: OrientedRect, minW = 1, minD = 1): OrientedRect {
  return { ...r, width: Math.max(minW, r.width), depth: Math.max(minD, r.depth) };
}

/** Position du handle de rotation (depuis le milieu du bord nord, en espace monde) */
export function rotationHandlePos(rect: OrientedRect, gap = 6): Point2D {
  const [nw, ne] = rectCorners(rect);
  const top = midpoint(nw, ne);
  const angle = rect.rotationDeg * DEG2RAD;
  return {
    x: top.x + Math.sin(angle) * gap,
    y: top.y - Math.cos(angle) * gap,
  };
}

/** Normalise un angle en degrés dans ]-180, 180] */
export function normalizeAngleDeg(deg: number): number {
  let a = deg % 360;
  if (a > 180)  a -= 360;
  if (a <= -180) a += 360;
  return a;
}

/** Déplacement d'un rect */
export function moveRect(r: OrientedRect, dx: number, dy: number): OrientedRect {
  return { ...r, center: { x: r.center.x + dx, y: r.center.y + dy } };
}

/** Resize depuis un handle (delta monde depuis startWorld) */
export function resizeRectFromHandle(
  original: OrientedRect,
  handle: string,
  worldDelta: Point2D,
): OrientedRect {
  const rotRad = original.rotationDeg * DEG2RAD;
  const cos = Math.cos(rotRad), sin = Math.sin(rotRad);
  // Monde → local
  const lx = worldDelta.x * cos + worldDelta.y * sin;
  const ly = -worldDelta.x * sin + worldDelta.y * cos;

  let { width, depth } = original;
  let dCx = 0, dCy = 0;

  if (handle.includes('e')) { const nw = Math.max(1, width + lx); dCx += (nw - width) / 2; width = nw; }
  if (handle.includes('w')) { const nw = Math.max(1, width - lx); dCx -= (nw - width) / 2; width = nw; }
  if (handle.includes('s')) { const nd = Math.max(1, depth + ly); dCy += (nd - depth) / 2; depth = nd; }
  if (handle.includes('n')) { const nd = Math.max(1, depth - ly); dCy -= (nd - depth) / 2; depth = nd; }

  // Local → monde
  const wdx = dCx * cos - dCy * sin;
  const wdy = dCx * sin + dCy * cos;

  return { ...original, width, depth, center: { x: original.center.x + wdx, y: original.center.y + wdy } };
}

// ── Polygone ──────────────────────────────────────────────────────────────────

export function pointHitsRect(p: Point2D, r: OrientedRect, margin = 0): boolean {
  const rad = -r.rotationDeg * DEG2RAD;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = p.x - r.center.x, dy = p.y - r.center.y;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= r.width / 2 + margin && Math.abs(ly) <= r.depth / 2 + margin;
}

/** Ray casting — point dans polygone */
export function pointInPolygon(p: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Vrai si les 4 coins du rect sont dans le polygone */
export function rectFullyInsidePolygon(rect: OrientedRect, poly: Point2D[]): boolean {
  return rectCorners(rect).every(c => pointInPolygon(c, poly));
}

/** Vrai si au moins un coin du rect est dans le polygone */
export function rectPartiallyInsidePolygon(rect: OrientedRect, poly: Point2D[]): boolean {
  return rectCorners(rect).some(c => pointInPolygon(c, poly));
}

export function polygonBBox(pts: Point2D[]): { min: Point2D; max: Point2D } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

export function toSvgPoints(pts: Point2D[]): string {
  return pts.map(p => `${p.x},${p.y}`).join(' ');
}

export function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function angleDeg(from: Point2D, to: Point2D): number {
  return Math.atan2(to.y - from.y, to.x - from.x) * RAD2DEG;
}

export function pointToSegmentDist(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function closestPointOnSegment(p: Point2D, a: Point2D, b: Point2D): Point2D {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { ...a };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function genId(): string {
  return Math.random().toString(36).slice(2, 9);
}

export function computeParkingSlots(
  width: number, depth: number,
  slotW: number, slotD: number, aisleW: number,
): number {
  const bayH = slotD * 2 + aisleW;
  const doubleBays = Math.floor(depth / bayH);
  const remaining = depth - doubleBays * bayH;
  const singleBays = remaining >= slotD + aisleW ? 1 : 0;
  return Math.max(0, (doubleBays * 2 + singleBays) * Math.floor(width / slotW));
}

export function geoPolygonToLocal(
  coords: [number, number][],
  originLon: number,
  originLat: number,
): Point2D[] {
  const R = 6371000;
  const pts = coords[coords.length - 1][0] === coords[0][0] &&
              coords[coords.length - 1][1] === coords[0][1]
    ? coords.slice(0, -1) : coords;
  const latRad = originLat * DEG2RAD;
  return pts.map(([lon, lat]) => ({
    x:  (lon - originLon) * DEG2RAD * R * Math.cos(latRad),
    y: -(lat - originLat) * DEG2RAD * R,
  }));
}