// src/spaces/promoteur/plan2d/programSync.ts
// ─────────────────────────────────────────────────────────────────────────────
// Modèle « Programmation = source de vérité ».
//   QUOI (surface, niveaux, nom) vit dans mix.batiments[] (programme store).
//   OÙ (position, forme à surface constante) vit dans les Building2D (editor2d).
// Ce module contient la logique PURE d'appariement/diff par `programmeBatimentId`
// (créer les manquants, supprimer les orphelins, mettre à jour les existants —
// SANS toucher aux positions déjà posées), plus les conversions niveaux↔floors.
// ─────────────────────────────────────────────────────────────────────────────

import { genId } from "./editor2d.geometry";
import type {
  Building2D,
  BuildingVolume2D,
  FloorPlan2D,
  OrientedRect,
  Point2D,
} from "./editor2d.types";
import type { ProgrammeBatiment, ProgrammeMix } from "../store/promoteurProgramme.store";

// ── Coefficient d'habitabilité (SDP géométrique déduite de la saisie) ────────
// SDP géométrique = Σ (emprise × niveaux × COEF_SDP_HAB). Même coefficient que le
// chiffrage collectif (cf. BilanPromoteurPage / computeBuildingMeta).
export const COEF_SDP_HAB = 0.82;

/** SDP géométrique DÉDUITE du programme (ne vient plus du Massing). */
export function sdpGeometriqueDerive(mix: ProgrammeMix): number {
  return mix.batiments.reduce(
    (sum, b) => sum + Math.max(0, b.empriseSolM2 || 0) * Math.max(1, b.niveaux || 1) * COEF_SDP_HAB,
    0,
  );
}

// ── Conversions niveaux ↔ floorsAboveGround (±1 centralisé) ───────────────────
// niveaux = nombre total de niveaux hors-sol (RDC compris) ; floorsAboveGround =
// nombre d'étages AU-DESSUS du RDC. niveaux = floors + 1.
export function niveauxToFloors(niveaux: number): number {
  return Math.max(0, Math.round(niveaux || 1) - 1);
}
export function floorsToNiveaux(floors: number): number {
  return Math.max(1, Math.round(floors || 0) + 1);
}

// ── Spec d'un bâtiment à matérialiser en 2D ───────────────────────────────────
export interface ProgramBuildingSpec {
  programmeBatimentId: string;
  label: string;
  floors: number;
  areaM2: number;
}

export function specsFromMix(mix: ProgrammeMix): ProgramBuildingSpec[] {
  return mix.batiments.map((b) => ({
    programmeBatimentId: b.id,
    label: b.nom,
    floors: niveauxToFloors(b.niveaux),
    areaM2: Math.max(0, b.empriseSolM2 || 0),
  }));
}

// ── Géométrie interne ─────────────────────────────────────────────────────────

/** Met à l'échelle les volumes d'un bâtiment autour d'un centre (facteurs kx, ky). */
function scaleFloorPlans(
  floorPlans: FloorPlan2D[],
  center: Point2D,
  kx: number,
  ky: number,
): FloorPlan2D[] {
  return (floorPlans ?? []).map((fp) => ({
    ...fp,
    volumes: fp.volumes.map((v) => {
      const relX = v.rect.center.x - center.x;
      const relY = v.rect.center.y - center.y;
      return {
        ...v,
        rect: {
          ...v.rect,
          center: { x: center.x + relX * kx, y: center.y + relY * ky },
          width: v.rect.width * kx,
          depth: v.rect.depth * ky,
        },
      };
    }),
  }));
}

/** Redimensionne un bâtiment pour atteindre `area` (échelle UNIFORME → aspect préservé). */
function scaleBuildingToArea(b: Building2D, area: number): Building2D {
  if (area <= 0) return { ...b, lockedAreaM2: area };
  const cur = b.rect.width * b.rect.depth;
  if (cur <= 0.0001) {
    // ⚠️ Rect dégénéré (bâtiment créé sans emprise, puis renseigné) : on ne peut
    // PAS se contenter de redimensionner le rect — l'éditeur calcule ses surfaces
    // depuis les volumes du RDC (cf. hasValidRdcContent), restés à 0×0. Le plan
    // masse affichait « 0 m² » sur un bâtiment pourtant dimensionné.
    // On reconstruit donc le plan RDC à la bonne taille.
    const s = Math.sqrt(area);
    const rect: OrientedRect = { ...b.rect, width: s, depth: s };
    const rdc: BuildingVolume2D = { id: genId(), rect, role: "main" };
    return {
      ...b,
      rect,
      floorPlans: [{
        id: genId(), levelIndex: 0, label: "RDC",
        volumes: [rdc], balconies: [], loggias: [], terraces: [],
      }],
      lockedAreaM2: area,
    };
  }
  const k = Math.sqrt(area / cur); // uniforme : conserve l'aspect ET le centre
  const rect: OrientedRect = { ...b.rect, width: b.rect.width * k, depth: b.rect.depth * k };

  // ⚠️ Volumes RDC dégénérés : scaleFloorPlans les multiplie par k — or 0 × k = 0.
  // Un bâtiment créé sans emprise (volume 0×0) puis dimensionné gardait donc un
  // RDC vide à jamais : le rect existait, mais le plan masse affichait « 0 m² »
  // (l'éditeur somme les volumes du RDC, pas le rect — cf. hasValidRdcContent).
  const rdcArea = (b.floorPlans ?? [])
    .find((fp) => fp.levelIndex === 0)?.volumes
    .reduce((s, v) => s + v.rect.width * v.rect.depth, 0) ?? 0;

  if (rdcArea <= 0.0001) {
    const s = Math.sqrt(area);
    const squareRect: OrientedRect = { ...b.rect, width: s, depth: s };
    const rdc: BuildingVolume2D = { id: genId(), rect: squareRect, role: "main" };
    return {
      ...b,
      rect: squareRect,
      floorPlans: [{
        id: genId(), levelIndex: 0, label: "RDC",
        volumes: [rdc], balconies: [], loggias: [], terraces: [],
      }],
      lockedAreaM2: area,
    };
  }

  return {
    ...b,
    rect,
    floorPlans: scaleFloorPlans(b.floorPlans, b.rect.center, k, k),
    lockedAreaM2: area,
  };
}

/** Crée un Building2D carré (√emprise) au centre fourni, avec cascade pour les suivants. */
export function makeProgramBuilding(
  spec: ProgramBuildingSpec,
  anchor: Point2D,
  index: number,
): Building2D {
  // ⚠️ Emprise non renseignée (0) → PAS de rectangle de 1 m² : `Math.max(1, 0)`
  // fabriquait un carré fantôme de 1×1 sur le plan masse, illisible et faux.
  // On dessine un rect DÉGÉNÉRÉ (0×0), que le diff traite comme « à placer » :
  // le bâtiment existe dans le programme, mais n'a pas encore de forme.
  const side = spec.areaM2 > 0 ? Math.sqrt(spec.areaM2) : 0;
  const off = index * Math.max(side, 8) * 1.3; // cascade même sans surface
  const rect: OrientedRect = {
    center: { x: anchor.x + off, y: anchor.y + off },
    width: side,
    depth: side,
    rotationDeg: 0,
  };
  const rdc: BuildingVolume2D = { id: genId(), rect, role: "main" };
  const floorPlan: FloorPlan2D = {
    id: genId(),
    levelIndex: 0,
    label: "RDC",
    volumes: [rdc],
    balconies: [],
    loggias: [],
    terraces: [],
  };
  return {
    id: genId(),
    kind: "building",
    rect,
    label: spec.label,
    floorPlans: [floorPlan],
    floorsAboveGround: spec.floors,
    groundFloorHeightM: 3.0,
    typicalFloorHeightM: 2.8,
    roofType: "flat",
    balconies: [],
    loggias: [],
    terraces: [],
    volumes: [],
    programmeBatimentId: spec.programmeBatimentId,
    lockedAreaM2: spec.areaM2,
  };
}

// ── DIFF : programme → bâtiments 2D (par programmeBatimentId) ──────────────────
export interface SyncResult {
  next: Building2D[];
  created: number;
  deleted: number;
}

/**
 * Réconcilie les bâtiments 2D avec le programme, par clé stable :
 *   - existant lié → MAJ (label, floors, emprise ; rescale si l'emprise a changé),
 *     POSITION ET ROTATION PRÉSERVÉES ;
 *   - spec sans bâtiment → CRÉATION (carré, cascade au centre `anchor`) ;
 *   - bâtiment lié à une spec disparue → SUPPRESSION (orphelin).
 * Les bâtiments SANS clé (keyless) sont laissés tels quels (la migration les
 * appariera en amont — ils ne devraient plus exister après migration).
 */
export function syncProgramToBuildings(
  specs: ProgramBuildingSpec[],
  buildings: Building2D[],
  anchor: Point2D,
): SyncResult {
  const byKey = new Map<string, Building2D>();
  for (const b of buildings) if (b.programmeBatimentId) byKey.set(b.programmeBatimentId, b);
  const specKeys = new Set(specs.map((s) => s.programmeBatimentId));

  const next: Building2D[] = [];
  let created = 0;
  let newIndex = 0;

  for (const s of specs) {
    const existing = byKey.get(s.programmeBatimentId);
    if (existing) {
      const currentArea = existing.lockedAreaM2 ?? existing.rect.width * existing.rect.depth;
      let b: Building2D = { ...existing, label: s.label, floorsAboveGround: s.floors };
      if (Math.abs(currentArea - s.areaM2) > 0.01) {
        b = scaleBuildingToArea(b, s.areaM2); // position/rotation préservées
      } else {
        b.lockedAreaM2 = s.areaM2;
      }
      next.push(b);
    } else {
      next.push(makeProgramBuilding(s, anchor, newIndex++));
      created++;
    }
  }

  const deleted = buildings.filter(
    (b) => b.programmeBatimentId && !specKeys.has(b.programmeBatimentId),
  ).length;

  // keyless : conservés tels quels (migration attendue en amont).
  for (const b of buildings) if (!b.programmeBatimentId) next.push(b);

  return { next, created, deleted };
}

// ── MIGRATION : bâtiments 2D keyless → programme ──────────────────────────────
export interface OrphanImport {
  buildingId: string;
  nom: string;
  niveaux: number;
  empriseSolM2: number;
}

/** Extrait, pour chaque Building2D sans clé, la spec à importer dans le programme. */
export function orphanImportsFromBuildings(buildings: Building2D[]): OrphanImport[] {
  return buildings
    .filter((b) => !b.programmeBatimentId)
    .map((b) => ({
      buildingId: b.id,
      nom: b.label || "Bâtiment importé",
      niveaux: floorsToNiveaux(b.floorsAboveGround),
      empriseSolM2: Math.max(0, Math.round(b.rect.width * b.rect.depth)),
    }));
}

/** Applique une clé programme à un bâtiment (post-import). */
export function keyBuilding(building: Building2D, programmeBatimentId: string, empriseSolM2: number): Building2D {
  return { ...building, programmeBatimentId, lockedAreaM2: empriseSolM2 };
}

/** Centre de placement par défaut : centroïde des bâtiments existants, sinon origine. */
export function defaultAnchor(buildings: Building2D[]): { anchor: Point2D; fromExisting: boolean } {
  const positioned = buildings.filter((b) => b.rect.width * b.rect.depth > 0.1);
  if (positioned.length === 0) return { anchor: { x: 0, y: 0 }, fromExisting: false };
  const cx = positioned.reduce((s, b) => s + b.rect.center.x, 0) / positioned.length;
  const cy = positioned.reduce((s, b) => s + b.rect.center.y, 0) / positioned.length;
  return { anchor: { x: cx, y: cy }, fromExisting: true };
}
