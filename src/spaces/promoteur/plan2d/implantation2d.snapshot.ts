// src/spaces/promoteur/plan2d/implantation2d.snapshot.ts
// Bridge Implantation 2D → PromoteurSnapshot
//
// Ce module est la source de vérité pour la sérialisation des bâtiments
// dessinés dans l'éditeur 2D vers le snapshot Promoteur (localStorage + Supabase).
//
// Usage :
//   const snap = buildImplantation2DForPromoteurSnapshot(storeBuildings);
//   patchModule("implantation2d", snap);
//
// Contrat de données : cohérent avec masterScenario.service et le tooltip
// canvas (même filtre hasValidRdcContent appliqué en amont).

import type { Building2D } from "./editor2d.types";
import { rectCorners }     from "./editor2d.geometry";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES EXPORTÉS
// ─────────────────────────────────────────────────────────────────────────────

export interface Implantation2DBuilding {
  id:             string;
  name:           string;
  /** Footprint polygonal dans le repère parcelleLocal (Y-down, mètres). */
  footprint:      Array<{ x: number; y: number }>;
  /** Surface de l'empreinte au sol (m²). */
  empriseM2:      number;
  /** Nombre de niveaux habitables (RDC inclus). */
  levels:         number;
  heightRdcM:     number;
  heightTypicalM: number;
  totalHeightM:   number;
  roofType:       string;
  /** Surface de plancher (SDP) tous niveaux (m²). */
  sdpM2:          number;
  /** Surface habitable/vendable estimée (m²). */
  vendableM2:     number;
}

export interface Implantation2DSnapshot {
  buildings: Implantation2DBuilding[];
  updatedAt: string; // ISO 8601
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────

/** Ratio SDP utile / emprise brute (circulation, gaines, structure). */
const COEFF_SDP_EMPRISE_UTILISE = 0.90;

/** Ratio vendable / SDP (couloirs communs, cage d'escalier, locaux techniques). */
const RATIO_VENDABLE_SDP = 0.82;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS PRIVÉS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcule la SDP (Surface de Plancher) d'un bâtiment.
 *
 * Priorité :
 *   1. floorPlans V4+ : somme des surfaces de chaque volume sur chaque niveau
 *   2. volumes legacy (pre-V4)
 *   3. Fallback géométrique : emprise × niveaux × coeff
 */
function computeSdpM2(b: Building2D): number {
  if (b.floorPlans && b.floorPlans.length > 0) {
    return b.floorPlans.reduce((totalFloor, fp) => {
      const floorArea = fp.volumes.reduce((sum, v) => {
        if (v.role === "connector") return sum;
        return sum + v.rect.width * v.rect.depth;
      }, 0);
      return totalFloor + floorArea;
    }, 0);
  }

  if (b.volumes && b.volumes.length > 0) {
    const nLevels    = 1 + (b.floorsAboveGround ?? b.levels ?? 0);
    const groundArea = b.volumes.reduce((sum, v) => {
      if (v.role === "connector") return sum;
      return sum + v.rect.width * v.rect.depth;
    }, 0);
    return groundArea * nLevels;
  }

  // Pure rect fallback
  const emprise = b.rect.width * b.rect.depth;
  const nLevels = 1 + (b.floorsAboveGround ?? b.levels ?? 0);
  return emprise * COEFF_SDP_EMPRISE_UTILISE * nLevels;
}

/**
 * Calcule la hauteur totale du bâtiment (RDC + étages, hors toiture).
 */
function computeTotalHeightM(b: Building2D): number {
  const rdcH     = b.groundFloorHeightM  ?? 3.0;
  const typicalH = b.typicalFloorHeightM ?? 2.8;
  const nFloors  = b.floorsAboveGround   ?? b.levels ?? 0;
  return rdcH + typicalH * nFloors;
}

/**
 * Extrait le footprint polygonal du rectangle orienté.
 * Repère parcelleLocal (Y-down, mètres) — aucune transformation supplémentaire.
 */
function computeFootprint(b: Building2D): Array<{ x: number; y: number }> {
  return rectCorners(b.rect).map(p => ({ x: p.x, y: p.y }));
}

// ─────────────────────────────────────────────────────────────────────────────
// MAPPING PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convertit un tableau de Building2D (déjà filtrés par hasValidRdcContent)
 * en Implantation2DSnapshot persistable.
 *
 * @param buildings - bâtiments validés (RDC réel requis, filtrés en amont)
 */
export function buildImplantation2DForPromoteurSnapshot(
  buildings: Building2D[],
): Implantation2DSnapshot {
  const mapped: Implantation2DBuilding[] = buildings.map(b => {
    const emprise    = b.rect.width * b.rect.depth;
    const nLevels    = 1 + (b.floorsAboveGround ?? b.levels ?? 0);
    const rdcH       = b.groundFloorHeightM  ?? 3.0;
    const typicalH   = b.typicalFloorHeightM ?? 2.8;
    const sdpM2      = computeSdpM2(b);
    const vendableM2 = sdpM2 * RATIO_VENDABLE_SDP;
    const totalH     = computeTotalHeightM(b);

    return {
      id:             b.id,
      name:           b.label ?? `Bâtiment ${b.id.slice(-4)}`,
      footprint:      computeFootprint(b),
      empriseM2:      Math.round(emprise   * 100) / 100,
      levels:         nLevels,
      heightRdcM:     rdcH,
      heightTypicalM: typicalH,
      totalHeightM:   Math.round(totalH    * 100) / 100,
      roofType:       (b as any).roofType  ?? "flat",
      sdpM2:          Math.round(sdpM2     * 100) / 100,
      vendableM2:     Math.round(vendableM2 * 100) / 100,
    };
  });

  return {
    buildings: mapped,
    updatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS CONSOMMATEURS (lecture côté Bilan / Évaluation)
// ─────────────────────────────────────────────────────────────────────────────

/** Somme vendableM2 de tous les bâtiments. */
export function totalVendableM2(snap: Implantation2DSnapshot): number {
  return snap.buildings.reduce((s, b) => s + b.vendableM2, 0);
}

/** Somme sdpM2 de tous les bâtiments. */
export function totalSdpM2(snap: Implantation2DSnapshot): number {
  return snap.buildings.reduce((s, b) => s + b.sdpM2, 0);
}

/** Somme empriseM2 de tous les bâtiments. */
export function totalEmpriseM2(snap: Implantation2DSnapshot): number {
  return snap.buildings.reduce((s, b) => s + b.empriseM2, 0);
}