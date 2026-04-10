// src/spaces/promoteur/plan2d/scenarioGenerator.ts
// Moteur de génération des 3 scénarios d'implantation.
//
// Chaque scénario produit ses propres buildings + parkings distincts.
// La géométrie est dérivée du plan courant par transformations :
//   balanced      → plan tel quel (référence)
//   max_potential → empreintes +5%, étages +1, parking optimisé
//   secured       → empreintes -8%, étages -1, volumes secondaires retirés
//
// Containment : si parcelPolygon est fourni, chaque rect est clampé
// à l'intérieur de la parcelle avant l'évaluation.

import type { Building2D, Parking2D, OrientedRect } from './editor2d.types';
import type { Point2D }                             from './editor2d.types';
import type {
  ImplantationScenarioFull,
  ScenarioFinancialAssumptions,
}                                                    from './scenarioGenerator.types';
import {
  DEFAULT_FINANCIAL_ASSUMPTIONS,
  DEFAULT_FINANCIAL_ASSUMPTIONS as DEF_ASSUM,
}                                                    from './scenarioGenerator.types';
import { genId, computeParkingSlots, rectCorners }   from './editor2d.geometry';
import { evaluateScenario }                          from './scenarioEvaluation';
import type { FloorPlan2D, BuildingVolume2D }        from './buildingProgram.types';

// ─── GÉOMÉTRIE PARCELLE ───────────────────────────────────────────────

function isPointInPolygon(pt: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonCentroid(poly: Point2D[]): Point2D {
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
    y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
  };
}

function allCornersInParcel(rect: OrientedRect, parcel: Point2D[]): boolean {
  return rectCorners(rect).every((c) => isPointInPolygon(c, parcel));
}

function clampRectToParcel(rect: OrientedRect, parcel: Point2D[]): OrientedRect {
  if (!parcel.length || allCornersInParcel(rect, parcel)) return rect;

  const centroid  = polygonCentroid(parcel);
  const MAX_STEPS = 30;

  let best = rect;
  for (let step = 1; step <= MAX_STEPS; step++) {
    const t  = step / MAX_STEPS;
    const cx = rect.center.x + (centroid.x - rect.center.x) * t;
    const cy = rect.center.y + (centroid.y - rect.center.y) * t;
    const candidate: OrientedRect = { ...rect, center: { x: cx, y: cy } };
    best = candidate;
    if (allCornersInParcel(candidate, parcel)) return candidate;
  }

  for (let s = 0.95; s >= 0.30; s -= 0.05) {
    const candidate: OrientedRect = {
      ...best,
      width: rect.width * s,
      depth: rect.depth * s,
    };
    if (allCornersInParcel(candidate, parcel)) return candidate;
  }

  return { ...rect, center: centroid };
}

function clampVariantToParcel(
  buildings: Building2D[],
  parkings:  Parking2D[],
  parcel:    Point2D[],
): { buildings: Building2D[]; parkings: Parking2D[] } {
  return {
    buildings: buildings.map((b) => ({ ...b, rect: clampRectToParcel(b.rect, parcel) })),
    parkings:  parkings.map((p) => ({ ...p, rect: clampRectToParcel(p.rect, parcel) })),
  };
}

// ─── HELPERS DE TRANSFORMATION ────────────────────────────────────────

function cloneRect(r: OrientedRect, scale = 1): OrientedRect {
  return {
    center:      { x: r.center.x, y: r.center.y },
    width:       r.width  * scale,
    depth:       r.depth  * scale,
    rotationDeg: r.rotationDeg,
  };
}

function cloneVolume(v: BuildingVolume2D, scale = 1): BuildingVolume2D {
  return { ...v, id: genId(), rect: cloneRect(v.rect, scale) };
}

function cloneFloorPlan(fp: FloorPlan2D, scale = 1): FloorPlan2D {
  return {
    ...fp,
    id:      genId(),
    volumes: fp.volumes.map((v) => cloneVolume(v, scale)),
  };
}

function cloneBuilding(b: Building2D, opts: {
  scale?:           number;
  floorsDelta?:     number;
  removeSecondary?: boolean;
} = {}): Building2D {
  const { scale = 1, floorsDelta = 0, removeSecondary = false } = opts;

  const newFloorPlans = (b.floorPlans ?? []).map((fp) => {
    const vols = removeSecondary
      ? fp.volumes.filter((v) => v.role === 'main' || v.role === 'connector')
      : fp.volumes;
    return cloneFloorPlan({ ...fp, volumes: vols }, scale);
  });

  const baseFloors = b.floorsAboveGround ?? 0;
  const nextFloors = Math.max(0, baseFloors + floorsDelta);

  return {
    ...b,
    id:                genId(),
    rect:              cloneRect(b.rect, scale),
    volumes:           [],
    floorPlans:        newFloorPlans,
    floorsAboveGround: nextFloors,
    balconies:         [],
    loggias:           [],
    terraces:          [],
  };
}

function cloneParking(p: Parking2D, scale = 1): Parking2D {
  const newRect = cloneRect(p.rect, scale);
  return {
    ...p,
    id:        genId(),
    rect:      newRect,
    slotCount: computeParkingSlots(
      newRect.width, newRect.depth,
      p.slotWidth       ?? 2.5,
      p.slotDepth       ?? 5.0,
      p.driveAisleWidth ?? 6.0,
    ),
  };
}

// ─── 3 VARIANTES ──────────────────────────────────────────────────────

function makeBalanced(buildings: Building2D[], parkings: Parking2D[]) {
  return {
    buildings: buildings.map((b) => cloneBuilding(b)),
    parkings:  parkings.map((p)  => cloneParking(p)),
  };
}

function makeMaxPotential(buildings: Building2D[], parkings: Parking2D[]) {
  return {
    buildings: buildings.map((b) => cloneBuilding(b, { scale: 1.05, floorsDelta: 1 })),
    parkings:  parkings.map((p)  => cloneParking(p, 1.08)),
  };
}

function makeSecured(buildings: Building2D[], parkings: Parking2D[], nbLogements?: number) {
  let currentBuildings = buildings.map((b) =>
    cloneBuilding(b, { scale: 0.92, floorsDelta: -1, removeSecondary: false }),
  );
  const clonedParkings = parkings.map((p) => cloneParking(p, 1.0));

  const sortByVolumeDesc = (arr: Building2D[]) =>
    [...arr].sort((a, b2) => {
      const areaA = a.rect.width * a.rect.depth * Math.max(1, (a.floorsAboveGround ?? 0) + 1);
      const areaB = b2.rect.width * b2.rect.depth * Math.max(1, (b2.floorsAboveGround ?? 0) + 1);
      return areaB - areaA;
    });

  while (currentBuildings.length > 1) {
    if (nbLogements !== undefined) {
      const evalPreview = evaluateScenario({
        key:          'secured',
        buildings:    currentBuildings,
        parkings:     clonedParkings,
        parcelAreaM2: 1,
        assumptions:  DEF_ASSUM,
        nbLogements,
      });
      if (evalPreview.parkingProvided >= evalPreview.parkingRequired) break;
    }
    const sorted = sortByVolumeDesc(currentBuildings);
    currentBuildings = currentBuildings.filter((b) => b.id !== sorted[sorted.length - 1].id);
  }

  return { buildings: currentBuildings, parkings: clonedParkings };
}

// ─── API PRINCIPALE ───────────────────────────────────────────────────

export interface GenerateScenariosParams {
  buildings:      Building2D[];
  parkings:       Parking2D[];
  parcelAreaM2:   number;
  parcelPolygon?: Point2D[];
  assumptions?:   ScenarioFinancialAssumptions;
  nbLogements?:          number;
  surfaceMoyLogementM2?: number;
}

export function generateScenarios({
  buildings,
  parkings,
  parcelAreaM2,
  parcelPolygon,
  assumptions = DEFAULT_FINANCIAL_ASSUMPTIONS,
  nbLogements,
  surfaceMoyLogementM2,
}: GenerateScenariosParams): ImplantationScenarioFull[] {

  let bal  = makeBalanced(buildings, parkings);
  let maxP = makeMaxPotential(buildings, parkings);
  let sec  = makeSecured(buildings, parkings, nbLogements);

  if (parcelPolygon && parcelPolygon.length >= 3) {
    bal  = clampVariantToParcel(bal.buildings,  bal.parkings,  parcelPolygon);
    maxP = clampVariantToParcel(maxP.buildings, maxP.parkings, parcelPolygon);
    sec  = clampVariantToParcel(sec.buildings,  sec.parkings,  parcelPolygon);
  }

  const prog = { nbLogements, surfaceMoyLogementM2 };

  const balEval = evaluateScenario({
    key: 'balanced', buildings: bal.buildings, parkings: bal.parkings,
    parcelAreaM2, assumptions, ...prog,
  });
  const maxEval = evaluateScenario({
    key: 'max_potential', buildings: maxP.buildings, parkings: maxP.parkings,
    parcelAreaM2, assumptions,
    refEmprise: balEval.empriseM2, refParkingProvided: balEval.parkingProvided,
    ...prog,
  });
  const secEval = evaluateScenario({
    key: 'secured', buildings: sec.buildings, parkings: sec.parkings,
    parcelAreaM2, assumptions,
    refEmprise: balEval.empriseM2, refParkingProvided: balEval.parkingProvided,
    ...prog,
  });

  (balEval as any).deltaEmprisePct   = 0;
  (balEval as any).deltaParkingCount = 0;

  return [balEval, maxEval, secEval];
}