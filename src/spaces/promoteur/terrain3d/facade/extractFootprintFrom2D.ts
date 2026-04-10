// src/spaces/promoteur/terrain3d/facade/extractFootprintFrom2D.ts
// ─────────────────────────────────────────────────────────────────────────────
// Extraction de l'emprise réelle d'un bâtiment depuis le store 2D.
//
// Règles :
//   • Fonction pure — aucun effet de bord, ne modifie jamais le store
//   • Ne throw jamais — toujours retourner FootprintPoint[] ([] si impossible)
//   • Priorité polygone (points[]) > rectangle (x, y, width, height)
//   • Tolérance aux données partielles ou absentes
//   • Logging préfixé [MMZ][Footprint]
//
// V5 — Contour réel depuis floorPlans[0].volumes
//   • Conserve les chemins historiques : points, x/y/width/height
//   • Conserve l'inspection détaillée du bâtiment trouvé
//   • Supporte les géométries stockées dans floorPlans[0].volumes[].rect
//   • Reconstruit le contour extérieur exact des volumes orthogonaux
//     (au lieu d'un convex hull qui supprimait les décrochés)
//   • Supporte aussi polygonLocal si présent sur un volume/export
//   • Aucun throw, logs détaillés et diagnostics enrichis
//
// V5.1 — Support rotations orthogonales (0°, 90°, 180°, 270°)
//   • Les bâtiments en L/U/T dont les volumes ont des rotations en multiples
//     de 90° sont maintenant gérés par la grid union exacte
//   • Width/depth permutés automatiquement pour les volumes à ±90°
//   • Élimine le fallback "coins bruts" pour les cas orthogonaux
//
// V5.2 — Convex hull pour rotations non orthogonales
//   • Quand les volumes ont des rotations arbitraires (ex: bâtiment en biais),
//     le fallback produit maintenant un contour convexe propre (Graham scan)
//     au lieu d'un nuage de coins bruts sans topologie
//
// V5.3 — Sélection intelligente de la rotation de base
//   • Au lieu de prendre rects[0].rotationDeg comme base, on teste chaque
//     rotation unique et on garde celle qui rend le plus de volumes orthogonaux
//   • Résout le cas des bâtiments en biais (ex: 52°) sur la parcelle
//   • Tolérance orthogonale élargie à 1° (au lieu de 0.5°)
// ─────────────────────────────────────────────────────────────────────────────

import {
  getBuildingVolumes,
  useEditor2DStore,
} from "@/spaces/promoteur/plan2d/editor2d.store";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FootprintPoint = {
  x: number;
  y: number;
};

type RawBuilding = Record<string, unknown>;

type CandidateSource = {
  name: "editor2d.store.buildings" | "getBuildingVolumes()";
  buildings: RawBuilding[];
};

type OrientedRectLike = {
  center: FootprintPoint;
  width: number;
  depth: number;
  rotationDeg: number;
};

type AxisRect = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type Segment = {
  start: FootprintPoint;
  end: FootprintPoint;
};

// ─────────────────────────────────────────────────────────────────────────────
// Guards & helpers
// ─────────────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

function isValidPoint(p: unknown): p is FootprintPoint {
  return (
    p !== null &&
    typeof p === "object" &&
    typeof (p as Record<string, unknown>).x === "number" &&
    typeof (p as Record<string, unknown>).y === "number" &&
    Number.isFinite((p as FootprintPoint).x) &&
    Number.isFinite((p as FootprintPoint).y)
  );
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function getObjectKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

function getValueType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function safeIds(buildings: RawBuilding[]): unknown[] {
  return buildings.map((b) => b?.id);
}

function normalizeBuildingsArray(input: unknown): RawBuilding[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isRecord);
}

function getNested(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (isRecord(current)) { current = current[segment]; continue; }
    return undefined;
  }
  return current;
}

function tryExtractPointArray(candidate: unknown): FootprintPoint[] {
  if (!Array.isArray(candidate)) return [];
  const validPts = candidate.filter(isValidPoint);
  return validPts.length >= 3 ? validPts : [];
}

function tryExtractOrientedRect(candidate: unknown): OrientedRectLike | null {
  if (!isRecord(candidate)) return null;
  if (!isRecord(candidate.center)) return null;
  const center = candidate.center;
  const width = candidate.width;
  const depth = candidate.depth;
  const rotationDeg = candidate.rotationDeg;
  if (!isValidPoint(center) || !isFiniteNumber(width) || !isFiniteNumber(depth) || !isFiniteNumber(rotationDeg)) return null;
  if (width <= 0 || depth <= 0) return null;
  return { center, width, depth, rotationDeg };
}

function buildRectanglePoints(x: number, y: number, width: number, height: number): FootprintPoint[] {
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

function rectCornersFromOrientedRect(rect: OrientedRectLike): FootprintPoint[] {
  const halfW = rect.width / 2;
  const halfD = rect.depth / 2;
  const rad = (rect.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localCorners = [
    { x: -halfW, y: -halfD }, { x: halfW, y: -halfD },
    { x: halfW, y: halfD }, { x: -halfW, y: halfD },
  ];
  return localCorners.map((p) => ({
    x: rect.center.x + p.x * cos - p.y * sin,
    y: rect.center.y + p.x * sin + p.y * cos,
  }));
}

function roundCoord(v: number, precision = 1000): number {
  return Math.round(v * precision) / precision;
}

function pointKey(p: FootprintPoint): string {
  return `${roundCoord(p.x)}|${roundCoord(p.y)}`;
}

function dedupePoints(points: FootprintPoint[]): FootprintPoint[] {
  const seen = new Set<string>();
  const out: FootprintPoint[] = [];
  for (const p of points) {
    const key = pointKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x: roundCoord(p.x), y: roundCoord(p.y) });
  }
  return out;
}

function polygonSignedArea(points: FootprintPoint[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function simplifyCollinear(points: FootprintPoint[]): FootprintPoint[] {
  if (points.length < 4) return points;
  const out: FootprintPoint[] = [];
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];
    const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
    if (Math.abs(cross) > 1e-9) out.push(curr);
  }
  return out.length >= 3 ? out : points;
}

/**
 * Convex hull via Graham scan — retourne le contour convexe
 * dans le sens trigonométrique (CCW).
 * Utilisé comme fallback quand les volumes ont des rotations
 * non orthogonales et que la grid union est impossible.
 */
function convexHull(points: FootprintPoint[]): FootprintPoint[] {
  if (points.length < 3) return points;

  // Trouver le point le plus bas (puis le plus à gauche)
  const sorted = [...points].sort((a, b) => a.y - b.y || a.x - b.x);
  const pivot = sorted[0];

  // Trier par angle polaire par rapport au pivot
  const rest = sorted.slice(1).sort((a, b) => {
    const angleA = Math.atan2(a.y - pivot.y, a.x - pivot.x);
    const angleB = Math.atan2(b.y - pivot.y, b.x - pivot.x);
    if (Math.abs(angleA - angleB) < 1e-12) {
      // Même angle : garder le plus proche en premier
      const distA = (a.x - pivot.x) ** 2 + (a.y - pivot.y) ** 2;
      const distB = (b.x - pivot.x) ** 2 + (b.y - pivot.y) ** 2;
      return distA - distB;
    }
    return angleA - angleB;
  });

  const stack: FootprintPoint[] = [pivot];

  for (const p of rest) {
    while (stack.length >= 2) {
      const a = stack[stack.length - 2];
      const b = stack[stack.length - 1];
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (cross <= 0) {
        stack.pop();
      } else {
        break;
      }
    }
    stack.push(p);
  }

  return stack.length >= 3 ? stack : points;
}

function rotatePoint(p: FootprintPoint, angleDeg: number): FootprintPoint {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

function convertWorldToLocal(p: FootprintPoint, baseRotationDeg: number): FootprintPoint {
  return rotatePoint(p, -baseRotationDeg);
}

function convertLocalToWorld(p: FootprintPoint, baseRotationDeg: number): FootprintPoint {
  return rotatePoint(p, baseRotationDeg);
}

function almostEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function normalizeAngleDeg(angle: number): number {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a;
}

function angleDeltaDeg(a: number, b: number): number {
  const na = normalizeAngleDeg(a);
  const nb = normalizeAngleDeg(b);
  let d = Math.abs(na - nb);
  if (d > 180) d = 360 - d;
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecture sources
// ─────────────────────────────────────────────────────────────────────────────

function readBuildingsFromEditor2DStore(): RawBuilding[] {
  try {
    const state: unknown = useEditor2DStore.getState();
    const buildings = isRecord(state) ? state.buildings : undefined;
    const normalized = normalizeBuildingsArray(buildings);
    console.log("[MMZ][Footprint] Source editor2d.store.buildings lue", { count: normalized.length, ids: safeIds(normalized) });
    return normalized;
  } catch (err) {
    console.warn("[MMZ][Footprint] Impossible de lire editor2d.store.buildings", err);
    return [];
  }
}

function readBuildingsFromGetBuildingVolumes(): RawBuilding[] {
  try {
    const result: unknown = getBuildingVolumes();
    const normalized = normalizeBuildingsArray(result);
    console.log("[MMZ][Footprint] Source getBuildingVolumes() lue", { count: normalized.length, ids: safeIds(normalized) });
    return normalized;
  } catch (err) {
    console.warn("[MMZ][Footprint] getBuildingVolumes() a échoué — source ignorée", err);
    return [];
  }
}

function getCandidateSources(): CandidateSource[] {
  return [
    { name: "editor2d.store.buildings", buildings: readBuildingsFromEditor2DStore() },
    { name: "getBuildingVolumes()", buildings: readBuildingsFromGetBuildingVolumes() },
  ];
}

function findBuildingInSources(
  buildingId: string,
  sources: CandidateSource[],
): { source: CandidateSource["name"]; building: RawBuilding } | null {
  for (const source of sources) {
    const match = source.buildings.find((item) => item.id === buildingId);
    if (match) {
      console.log(`[MMZ][Footprint] Bâtiment trouvé dans ${source.name}`, { buildingId, keys: Object.keys(match) });
      return { source: source.name, building: match };
    }
  }
  console.warn(`[MMZ][Footprint] Bâtiment introuvable pour l'id : "${buildingId}"`, {
    sources: sources.map((s) => ({ source: s.name, count: s.buildings.length, ids: safeIds(s.buildings) })),
  });
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inspection debug
// ─────────────────────────────────────────────────────────────────────────────

function logBuildingGeometryInspection(building: RawBuilding, source: string): void {
  const floorPlans = getNested(building, ["floorPlans"]);
  const firstFloorPlan = getNested(building, ["floorPlans", "0"]);
  const firstFloorVolumes = getNested(building, ["floorPlans", "0", "volumes"]);
  console.log("[MMZ][Footprint] Inspection bâtiment trouvé", {
    id: building.id, source,
    rootKeys: Object.keys(building),
    rectKeys: getObjectKeys(building.rect),
    geometryKeys: getObjectKeys(building.geometry),
    shapeKeys: getObjectKeys(building.shape),
    polygonType: getValueType(building.polygon),
    footprintType: getValueType(building.footprint),
    outlineType: getValueType(building.outline),
    verticesType: getValueType(building.vertices),
    cornersType: getValueType(building.corners),
    floorPlansType: getValueType(floorPlans),
    floorPlansLength: Array.isArray(floorPlans) ? floorPlans.length : 0,
    floorPlan0Keys: getObjectKeys(firstFloorPlan),
    floorPlan0VolumesType: getValueType(firstFloorVolumes),
    floorPlan0VolumesLength: Array.isArray(firstFloorVolumes) ? firstFloorVolumes.length : 0,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Extraction géométrique
// ─────────────────────────────────────────────────────────────────────────────

function extractPolygonPoints(b: RawBuilding, sourceName: string): FootprintPoint[] {
  if (!Array.isArray(b.points) || b.points.length < 3) return [];
  const validPts: FootprintPoint[] = (b.points as unknown[]).filter(isValidPoint);
  if (validPts.length >= 3) {
    console.log(
      `[MMZ][Footprint] Polygone détecté via points depuis ${sourceName} — ${validPts.length} points valides` +
      (validPts.length < b.points.length ? ` (${b.points.length - validPts.length} point(s) ignoré(s))` : ""),
    );
    return validPts;
  }
  console.warn(`[MMZ][Footprint] Tableau points insuffisant dans ${sourceName}`, { total: b.points.length, valides: validPts.length });
  return [];
}

function extractPolygonPointsFromFallbackPaths(b: RawBuilding, sourceName: string): { points: FootprintPoint[]; testedPaths: string[] } {
  const pathSpecs: Array<{ label: string; path: string[] }> = [
    { label: "polygon", path: ["polygon"] },
    { label: "footprint", path: ["footprint"] },
    { label: "outline", path: ["outline"] },
    { label: "vertices", path: ["vertices"] },
    { label: "corners", path: ["corners"] },
    { label: "shape.points", path: ["shape", "points"] },
    { label: "shape.vertices", path: ["shape", "vertices"] },
    { label: "geometry.points", path: ["geometry", "points"] },
    { label: "geometry.vertices", path: ["geometry", "vertices"] },
    { label: "geometry.polygon", path: ["geometry", "polygon"] },
    { label: "rect.polygonLocal", path: ["rect", "polygonLocal"] },
    { label: "footprint.polygonLocal", path: ["footprint", "polygonLocal"] },
    { label: "floorPlans[0].points", path: ["floorPlans", "0", "points"] },
    { label: "floorPlans[0].polygon", path: ["floorPlans", "0", "polygon"] },
    { label: "levels[0].points", path: ["levels", "0", "points"] },
    { label: "levels[0].polygon", path: ["levels", "0", "polygon"] },
  ];
  const testedPaths = pathSpecs.map((spec) => spec.label);
  for (const spec of pathSpecs) {
    const candidate = getNested(b, spec.path);
    const points = tryExtractPointArray(candidate);
    if (points.length >= 3) {
      console.log(`[MMZ][Footprint] Polygone détecté via ${spec.label} depuis ${sourceName}`, { count: points.length });
      return { points, testedPaths };
    }
    if (Array.isArray(candidate)) {
      console.log(`[MMZ][Footprint] Chemin testé ${spec.label} depuis ${sourceName} — insuffisant`, { total: candidate.length, validCount: candidate.filter(isValidPoint).length });
    }
  }
  return { points: [], testedPaths };
}

function extractPointsFromOrientedRectPaths(b: RawBuilding, sourceName: string): { points: FootprintPoint[]; testedPaths: string[] } {
  const pathSpecs: Array<{ label: string; path: string[] }> = [
    { label: "rect", path: ["rect"] },
    { label: "geometry.rect", path: ["geometry", "rect"] },
    { label: "shape.rect", path: ["shape", "rect"] },
    { label: "floorPlans[0].rect", path: ["floorPlans", "0", "rect"] },
    { label: "levels[0].rect", path: ["levels", "0", "rect"] },
  ];
  const testedPaths = pathSpecs.map((spec) => spec.label);
  for (const spec of pathSpecs) {
    const candidate = getNested(b, spec.path);
    const rect = tryExtractOrientedRect(candidate);
    if (!rect) continue;
    const pts = rectCornersFromOrientedRect(rect);
    if (pts.length >= 4) {
      console.log(`[MMZ][Footprint] OrientedRect détecté via ${spec.label} depuis ${sourceName}`, { width: rect.width, depth: rect.depth, rotationDeg: rect.rotationDeg });
      return { points: pts, testedPaths };
    }
  }
  return { points: [], testedPaths };
}

function buildGridUnionContourFromAxisRects(rects: AxisRect[]): FootprintPoint[] {
  if (!rects.length) return [];
  const xs = Array.from(new Set(rects.flatMap((r) => [roundCoord(r.minX), roundCoord(r.maxX)]))).sort((a, b) => a - b);
  const ys = Array.from(new Set(rects.flatMap((r) => [roundCoord(r.minY), roundCoord(r.maxY)]))).sort((a, b) => a - b);
  if (xs.length < 2 || ys.length < 2) return [];

  const cellKey = (ix: number, iy: number): string => `${ix}|${iy}`;
  const occupied = new Set<string>();
  for (let ix = 0; ix < xs.length - 1; ix += 1) {
    const cx = (xs[ix] + xs[ix + 1]) / 2;
    for (let iy = 0; iy < ys.length - 1; iy += 1) {
      const cy = (ys[iy] + ys[iy + 1]) / 2;
      if (rects.some((r) => cx > r.minX - 1e-9 && cx < r.maxX + 1e-9 && cy > r.minY - 1e-9 && cy < r.maxY + 1e-9)) {
        occupied.add(cellKey(ix, iy));
      }
    }
  }
  if (!occupied.size) return [];

  const segments: Segment[] = [];
  function hasCell(ix: number, iy: number): boolean { return occupied.has(cellKey(ix, iy)); }

  for (let ix = 0; ix < xs.length - 1; ix += 1) {
    for (let iy = 0; iy < ys.length - 1; iy += 1) {
      if (!hasCell(ix, iy)) continue;
      const x0 = xs[ix], x1 = xs[ix + 1], y0 = ys[iy], y1 = ys[iy + 1];
      if (!hasCell(ix, iy - 1)) segments.push({ start: { x: x0, y: y0 }, end: { x: x1, y: y0 } });
      if (!hasCell(ix + 1, iy)) segments.push({ start: { x: x1, y: y0 }, end: { x: x1, y: y1 } });
      if (!hasCell(ix, iy + 1)) segments.push({ start: { x: x1, y: y1 }, end: { x: x0, y: y1 } });
      if (!hasCell(ix - 1, iy)) segments.push({ start: { x: x0, y: y1 }, end: { x: x0, y: y0 } });
    }
  }
  if (!segments.length) return [];

  const nextByStart = new Map<string, FootprintPoint[]>();
  for (const seg of segments) {
    const key = pointKey(seg.start);
    const existing = nextByStart.get(key) ?? [];
    existing.push(seg.end);
    nextByStart.set(key, existing);
  }

  const visited = new Set<string>();
  function segKey(a: FootprintPoint, b: FootprintPoint): string { return `${pointKey(a)}->${pointKey(b)}`; }

  const loops: FootprintPoint[][] = [];
  for (const seg of segments) {
    const start = seg.start;
    const firstEnd = seg.end;
    const firstSegKey = segKey(start, firstEnd);
    if (visited.has(firstSegKey)) continue;
    const loop: FootprintPoint[] = [start];
    let current = start;
    let next = firstEnd;
    visited.add(firstSegKey);
    let guard = 0;
    while (guard < 10000) {
      guard += 1;
      loop.push(next);
      if (pointKey(next) === pointKey(start)) { loop.pop(); break; }
      current = next;
      const candidates = nextByStart.get(pointKey(current)) ?? [];
      const unused = candidates.find((c) => !visited.has(segKey(current, c)));
      if (!unused) break;
      visited.add(segKey(current, unused));
      next = unused;
    }
    const cleaned = simplifyCollinear(loop);
    if (cleaned.length >= 3) loops.push(cleaned);
  }
  if (!loops.length) return [];

  let bestLoop = loops[0];
  let bestArea = Math.abs(polygonSignedArea(bestLoop));
  for (let i = 1; i < loops.length; i += 1) {
    const area = Math.abs(polygonSignedArea(loops[i]));
    if (area > bestArea) { bestLoop = loops[i]; bestArea = area; }
  }
  return bestLoop;
}

function tryExtractVolumePolygonLocal(volume: unknown, baseRotationDeg: number): FootprintPoint[] {
  if (!isRecord(volume)) return [];
  const polygonLocal = getNested(volume, ["footprint", "polygonLocal"]) ?? getNested(volume, ["polygonLocal"]);
  const rect = tryExtractOrientedRect(volume.rect);
  if (!rect) return [];
  const localPts = tryExtractPointArray(polygonLocal);
  if (localPts.length < 3) return [];
  return localPts.map((p) => {
    const rotated = rotatePoint(p, rect.rotationDeg);
    return { x: rect.center.x + rotated.x, y: rect.center.y + rotated.y };
  }).map((p) => convertWorldToLocal(p, baseRotationDeg));
}

function extractPointsFromVolumeRectsExactUnion(
  b: RawBuilding,
  sourceName: string,
): { points: FootprintPoint[]; testedPaths: string[] } {
  const pathSpecs: Array<{ label: string; path: string[] }> = [
    { label: "floorPlans[0].volumes", path: ["floorPlans", "0", "volumes"] },
    { label: "volumes", path: ["volumes"] },
    { label: "geometry.volumes", path: ["geometry", "volumes"] },
    { label: "shape.volumes", path: ["shape", "volumes"] },
    { label: "levels[0].volumes", path: ["levels", "0", "volumes"] },
  ];
  const testedPaths = pathSpecs.map((spec) => spec.label);

  for (const spec of pathSpecs) {
    const candidate = getNested(b, spec.path);
    if (!Array.isArray(candidate) || candidate.length === 0) continue;

    const rects: OrientedRectLike[] = [];
    for (const volume of candidate) {
      if (!isRecord(volume)) continue;
      const rect = tryExtractOrientedRect(volume.rect);
      if (rect) rects.push(rect);
    }

    if (!rects.length) {
      console.log(`[MMZ][Footprint] Chemin testé ${spec.label} depuis ${sourceName} — volumes sans rect exploitable`, { totalVolumes: candidate.length });
      continue;
    }

    const baseRotationDeg = rects[0].rotationDeg;
    const rotationSpreadDeg = Math.max(...rects.map((r) => angleDeltaDeg(r.rotationDeg, baseRotationDeg)));

    // V5.3 : au lieu de prendre rects[0] comme base, on teste chaque rotation
    // unique comme base candidate et on garde celle qui rend le plus de volumes
    // orthogonaux. Cela résout le cas des bâtiments en biais sur la parcelle
    // où le premier volume a une rotation différente de la majorité.
    function findBestOrthogonalBase(rects: OrientedRectLike[]): {
      bestBase: number;
      allOrthogonal: boolean;
      orthogonalCount: number;
    } {
      const uniqueRotations = Array.from(new Set(rects.map((r) => roundCoord(r.rotationDeg, 100))));
      let bestBase = rects[0].rotationDeg;
      let bestCount = 0;
      let bestAllOrtho = false;

      for (const candidateBase of uniqueRotations) {
        let orthoCount = 0;
        let allOrtho = true;
        for (const r of rects) {
          const delta = angleDeltaDeg(r.rotationDeg, candidateBase);
          const isOrtho = delta <= 1.0 || Math.abs(delta - 90) <= 1.0 || Math.abs(delta - 180) <= 1.0;
          if (isOrtho) {
            orthoCount += 1;
          } else {
            allOrtho = false;
          }
        }
        if (orthoCount > bestCount || (orthoCount === bestCount && allOrtho && !bestAllOrtho)) {
          bestBase = candidateBase;
          bestCount = orthoCount;
          bestAllOrtho = allOrtho;
        }
      }

      return { bestBase, allOrthogonal: bestAllOrtho, orthogonalCount: bestCount };
    }

    const { bestBase, allOrthogonal, orthogonalCount } = findBestOrthogonalBase(rects);
    const effectiveBaseRotationDeg = bestBase;
    const effectiveSpreadDeg = Math.max(...rects.map((r) => angleDeltaDeg(r.rotationDeg, effectiveBaseRotationDeg)));

    if (effectiveBaseRotationDeg !== baseRotationDeg) {
      console.log(
        `[MMZ][Footprint] V5.3 — rotation de base corrigée : ${roundCoord(baseRotationDeg)}° → ${roundCoord(effectiveBaseRotationDeg)}° (${orthogonalCount}/${rects.length} volumes orthogonaux)`,
      );
    }

    if (allOrthogonal) {
      const axisRects: AxisRect[] = [];
      let polygonLocalCount = 0;

      for (let i = 0; i < candidate.length; i += 1) {
        const volume = candidate[i];
        if (!isRecord(volume)) continue;

        const fromPolygonLocal = tryExtractVolumePolygonLocal(volume, effectiveBaseRotationDeg);
        if (fromPolygonLocal.length >= 3) {
          polygonLocalCount += 1;
          const xs = fromPolygonLocal.map((p) => p.x);
          const ys = fromPolygonLocal.map((p) => p.y);
          axisRects.push({ minX: roundCoord(Math.min(...xs)), maxX: roundCoord(Math.max(...xs)), minY: roundCoord(Math.min(...ys)), maxY: roundCoord(Math.max(...ys)) });
          continue;
        }

        const rect = tryExtractOrientedRect(volume.rect);
        if (!rect) continue;

        // V5.1 : si le volume est tourné de ~90° par rapport à la base,
        // ses axes width/depth sont permutés dans le repère local.
        const delta = angleDeltaDeg(rect.rotationDeg, effectiveBaseRotationDeg);
        const needsSwap = Math.abs(delta - 90) <= 1.0;
        const localW = needsSwap ? rect.depth : rect.width;
        const localD = needsSwap ? rect.width : rect.depth;

        const centerLocal = convertWorldToLocal(rect.center, effectiveBaseRotationDeg);
        axisRects.push({
          minX: roundCoord(centerLocal.x - localW / 2),
          maxX: roundCoord(centerLocal.x + localW / 2),
          minY: roundCoord(centerLocal.y - localD / 2),
          maxY: roundCoord(centerLocal.y + localD / 2),
        });
      }

      const localContour = buildGridUnionContourFromAxisRects(axisRects);
      if (localContour.length >= 3) {
        const worldContour = localContour.map((p) => convertLocalToWorld(p, effectiveBaseRotationDeg));
        const simplified = simplifyCollinear(dedupePoints(worldContour));

        if (simplified.length >= 3) {
          console.log(
            `[MMZ][Footprint] Emprise exacte reconstruite via ${spec.label} depuis ${sourceName}`,
            {
              volumesCount: candidate.length,
              exploitableRects: axisRects.length,
              polygonLocalCount,
              baseRotationDeg: roundCoord(effectiveBaseRotationDeg),
              rotationSpreadDeg: roundCoord(effectiveSpreadDeg, 10000),
              orthogonal: effectiveSpreadDeg > 0.5,
              contourPoints: simplified.length,
            },
          );
          return { points: simplified, testedPaths };
        }
      }

      console.log(`[MMZ][Footprint] Union exacte impossible via ${spec.label} depuis ${sourceName}`, {
        volumesCount: candidate.length, exploitableRects: axisRects.length,
        baseRotationDeg: roundCoord(effectiveBaseRotationDeg), rotationSpreadDeg: roundCoord(effectiveSpreadDeg, 10000),
      });
    }

    // Fallback si rotations non orthogonales — convex hull des coins
    const rawPoints = rects.flatMap((r) => rectCornersFromOrientedRect(r));
    const deduped = dedupePoints(rawPoints);
    if (deduped.length >= 3) {
      const hull = convexHull(deduped);
      const simplified = simplifyCollinear(hull);
      console.log(
        `[MMZ][Footprint] Volumes détectés via ${spec.label} depuis ${sourceName} — rotations non orthogonales — convex hull`,
        { volumesCount: candidate.length, exploitableRects: rects.length, baseRotationDeg: roundCoord(baseRotationDeg), rotationSpreadDeg: roundCoord(rotationSpreadDeg, 10000), rawPoints: deduped.length, hullPoints: simplified.length },
      );
      return { points: simplified, testedPaths };
    }

    console.log(`[MMZ][Footprint] Chemin testé ${spec.label} depuis ${sourceName} — volumes non exploitables`, { totalVolumes: candidate.length, exploitableRects: rects.length });
  }

  return { points: [], testedPaths };
}

function extractRectanglePoints(b: RawBuilding, sourceName: string): FootprintPoint[] {
  if (!isFiniteNumber(b.x) || !isFiniteNumber(b.y) || !isFiniteNumber(b.width) || !isFiniteNumber(b.height)) return [];
  if (b.width <= 0 || b.height <= 0) {
    console.warn(`[MMZ][Footprint] Rectangle ignoré dans ${sourceName} — dimensions non positives`, { width: b.width, height: b.height });
    return [];
  }
  console.log(`[MMZ][Footprint] Rectangle fallback utilisé depuis ${sourceName} — x:${b.x} y:${b.y} w:${b.width} h:${b.height}` + (isFiniteNumber(b.rotation) && b.rotation !== 0 ? ` (rotation:${b.rotation}° ignorée)` : ""));
  return buildRectanglePoints(b.x, b.y, b.width, b.height);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fonction principale
// ─────────────────────────────────────────────────────────────────────────────

export function extractFootprintFrom2D(buildingId: string): FootprintPoint[] {
  try {
    if (typeof buildingId !== "string" || buildingId.trim().length === 0) {
      console.warn("[MMZ][Footprint] buildingId invalide reçu", { buildingId });
      return [];
    }

    const sources = getCandidateSources();
    const totalAcrossSources = sources.reduce((sum, source) => sum + source.buildings.length, 0);

    if (totalAcrossSources === 0) {
      console.warn("[MMZ][Footprint] Aucune source bâtiment exploitable disponible");
      return [];
    }

    const found = findBuildingInSources(buildingId, sources);
    if (!found) return [];

    const { source, building } = found;
    logBuildingGeometryInspection(building, source);

    // CAS 1 — Polygone historique direct
    const polygonPts = extractPolygonPoints(building, source);
    if (polygonPts.length >= 3) return simplifyCollinear(dedupePoints(polygonPts));

    // CAS 2 — Polygones fallback via chemins alternatifs
    const fallbackPolygon = extractPolygonPointsFromFallbackPaths(building, source);
    if (fallbackPolygon.points.length >= 3) return simplifyCollinear(dedupePoints(fallbackPolygon.points));

    // CAS 3 — Structure V4 réelle : volumes -> union exacte -> contour réel
    const exactFromVolumes = extractPointsFromVolumeRectsExactUnion(building, source);
    if (exactFromVolumes.points.length >= 3) return simplifyCollinear(dedupePoints(exactFromVolumes.points));

    // CAS 4 — OrientedRect direct
    const orientedRectPoints = extractPointsFromOrientedRectPaths(building, source);
    if (orientedRectPoints.points.length >= 4) return simplifyCollinear(dedupePoints(orientedRectPoints.points));

    // CAS 5 — Rectangle legacy axis-aligned
    const rectPts = extractRectanglePoints(building, source);
    if (rectPts.length >= 4) return simplifyCollinear(dedupePoints(rectPts));

    console.warn("[MMZ][Footprint] Impossible d'extraire une emprise valide", {
      id: building.id, source, keys: Object.keys(building),
      testedPaths: ["points", ...fallbackPolygon.testedPaths, ...exactFromVolumes.testedPaths, "rect", "geometry.rect", "shape.rect", "floorPlans[0].rect", "levels[0].rect", "x/y/width/height"],
    });
    return [];
  } catch (err) {
    console.error("[MMZ][Footprint] Erreur inattendue lors de l'extraction :", err);
    return [];
  }
}