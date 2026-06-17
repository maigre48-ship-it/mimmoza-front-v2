// massingToBilan.ts — dérivation métré : modèle Massing 3D → quantités pour le Bilan
// ─────────────────────────────────────────────────────────────────────────────
// Module PUR (aucune dépendance THREE / React) : prend les bâtiments du massing
// et renvoie un métré complet (surfaces, façade, toiture, balcons, menuiseries,
// logements + typologie). Le Bilan Promoteur applique ensuite SES prix unitaires
// sur ces quantités → séparation nette : ici on ne calcule que des QUANTITÉS,
// jamais des euros (les prix vivent dans le bilan).
//
// Conventions reprises de massingScene.types :
//   • footprint.points en WGS84 (lon/lat) si |lon| ≤ 180 → conversion m via
//     111 000 m/deg et cos(latitude). Sinon points déjà en mètres (scène).
//   • niveaux = totalLevelsCount(levels) ; hauteur = totalHeightM(levels).
//
// Tous les coefficients d'estimation sont des constantes nommées en tête de
// fichier → faciles à ajuster (ils pilotent un métré "verrouillé" recalculé à
// chaque modif du massing).
// ─────────────────────────────────────────────────────────────────────────────

import {
  type MassingBuildingModel,
  totalLevelsCount,
  totalHeightM,
} from "./massingScene.types";

// ─── Coefficients d'estimation (ajustables) ───────────────────────────────────

/** Part de SDP retirée par retrait d'étage (setback). */
const SETBACK_SDP_LOSS = 0.04;
/** Réduction d'emprise du dernier niveau (toiture) par retrait. */
const SETBACK_ROOF_LOSS = 0.10;
/** SHAB / SDP (circulations, murs, gaines). */
const COEF_SHAB_SDP = 0.88;
/** Taille moyenne d'un logement (m² SHAB) pour l'estimation du nombre de lots. */
const TAILLE_MOY_LOGEMENT_M2 = 55;
/** Répartition typologique par défaut (somme = 1). */
const TYPO_MIX = { T1: 0.15, T2: 0.40, T3: 0.35, T4: 0.10 };
/** Taux de vitrage par défaut si non déductible des ouvertures. */
const TAUX_VITRAGE_DEFAUT = 0.18;

// ─── Sortie ───────────────────────────────────────────────────────────────────

export type RoofKind = "terrasse" | "pente";

export interface BatimentMetrics {
  id:                string;
  name:              string;
  niveaux:           number;   // R+N inclus (RDC compté)
  empriseSolM2:      number;   // emprise au sol (RDC)
  sdpM2:             number;   // surface de plancher (avec abattement setbacks)
  shabM2:            number;   // surface habitable estimée
  surfaceFacadeM2:   number;   // périmètre × hauteur (brut)
  surfaceFacadeNetteM2: number;// façade hors vitrage (ravalement / ITE)
  roofType:          RoofKind;
  surfaceToitureM2:  number;   // surface réelle de couverture (rampante si pente)
  surfaceBalconsM2:  number;   // surface de dalles de balcon
  nbMenuiseries:     number;   // fenêtres + portes
  nbLogements:       number;   // estimation
}

export interface MassingMetrics {
  parBatiment: BatimentMetrics[];
  totaux: {
    nbBatiments:               number;
    empriseSolM2:              number;
    sdpM2:                     number;
    shabM2:                    number;
    surfaceFacadeM2:           number;
    surfaceFacadeNetteM2:      number;
    surfaceToitureTerrasseM2:  number;
    surfaceToiturePenteM2:     number;
    surfaceBalconsM2:          number;
    nbMenuiseries:             number;
    nbLogements:               number;
  };
  typologie: { T1: number; T2: number; T3: number; T4: number };
  ratios: {
    terrainM2?:  number;   // si fourni en option
    cesEmprise?: number;   // emprise sol / terrain (Coefficient d'Emprise au Sol)
    densiteSdp?: number;   // SDP / terrain
  };
}

export interface DeriveOptions {
  /** Surface de terrain (m²) pour les ratios CES / densité (optionnel). */
  parcelAreaM2?: number;
}

// ─── Géométrie footprint (deg² → m²) ──────────────────────────────────────────

const M_PER_DEG = 111_000;

function looksGeographic(points: [number, number][]): boolean {
  if (!points.length) return false;
  return Math.abs(points[0][0]) <= 180 && Math.abs(points[0][1]) <= 90;
}

function avgLatRad(points: [number, number][]): number {
  const lat = points.reduce((s, p) => s + p[1], 0) / points.length;
  return (lat * Math.PI) / 180;
}

function footprintAreaM2(points: [number, number][]): number {
  if (points.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    a += points[i][0] * points[j][1] - points[j][0] * points[i][1];
  }
  const areaUnits = Math.abs(a) / 2;
  if (looksGeographic(points)) {
    return areaUnits * M_PER_DEG * M_PER_DEG * Math.cos(avgLatRad(points));
  }
  return areaUnits;
}

function footprintPerimeterM(points: [number, number][]): number {
  if (points.length < 2) return 0;
  const geo = looksGeographic(points);
  const cosLat = geo ? Math.cos(avgLatRad(points)) : 1;
  let per = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    let dx = points[j][0] - points[i][0];
    let dz = points[j][1] - points[i][1];
    if (geo) { dx *= M_PER_DEG * cosLat; dz *= M_PER_DEG; }
    per += Math.hypot(dx, dz);
  }
  return per;
}

// ─── Dérivation par bâtiment ──────────────────────────────────────────────────

function deriveBuilding(b: MassingBuildingModel): BatimentMetrics {
  const pts        = b.footprint.points;
  const niveaux    = Math.max(1, totalLevelsCount(b.levels));
  const hauteurM   = Math.max(2.5, totalHeightM(b.levels));
  const emprise    = footprintAreaM2(pts);
  const perimetre  = footprintPerimeterM(pts);
  const setbacks   = Math.max(0, b.style?.numSetbacks ?? 0);

  // SDP : Σ planchers, abattue d'un coefficient de retrait global.
  const setbackCoef = Math.max(0.5, 1 - SETBACK_SDP_LOSS * setbacks);
  const sdp   = emprise * niveaux * setbackCoef;
  const shab  = sdp * COEF_SHAB_SDP;

  // Façade : périmètre × hauteur, puis abattement vitrage.
  const tauxVitrage = clamp01(
    (b.style?.openings?.enabled ? (b.style?.windowRatio ?? TAUX_VITRAGE_DEFAUT) : 0) || 0,
  );
  const facadeBrute = perimetre * hauteurM;
  const facadeNette = facadeBrute * (1 - tauxVitrage);

  // Toiture : terrasse (plate) = emprise du dernier niveau ;
  // pente = emprise rampante (÷ cos(pente)). roofConfig absent → terrasse.
  const rc       = b.style?.roofConfig;
  const isPente  = rc?.shape === "gable" || rc?.shape === "hip";
  const roofType: RoofKind = isPente ? "pente" : "terrasse";
  const empriseTop = emprise * Math.max(0.5, 1 - SETBACK_ROOF_LOSS * setbacks);
  let surfaceToiture = empriseTop;
  if (isPente) {
    const slope = Math.max(5, Math.min(60, rc?.slopeDeg ?? 30));
    surfaceToiture = empriseTop / Math.cos((slope * Math.PI) / 180);
  }

  // Balcons : selon le mode.
  const surfaceBalcons = balconyAreaM2(b, niveaux, perimetre);

  // Menuiseries : grille d'ouvertures.
  const { nbFenetres, nbPortes } = openingsCount(b, niveaux, pts.length);
  const nbMenuiseries = nbFenetres + nbPortes;

  // Logements.
  const nbLogements = Math.max(0, Math.round(shab / TAILLE_MOY_LOGEMENT_M2));

  return {
    id:   b.id,
    name: b.name,
    niveaux,
    empriseSolM2:         round(emprise),
    sdpM2:                round(sdp),
    shabM2:               round(shab),
    surfaceFacadeM2:      round(facadeBrute),
    surfaceFacadeNetteM2: round(facadeNette),
    roofType,
    surfaceToitureM2:     round(surfaceToiture),
    surfaceBalconsM2:     round(surfaceBalcons),
    nbMenuiseries,
    nbLogements,
  };
}

// ─── Sous-calculs ─────────────────────────────────────────────────────────────

function balconyAreaM2(b: MassingBuildingModel, niveaux: number, perimetre: number): number {
  const bc = b.style?.balconies;
  if (!bc?.enabled || bc.mode === "none" || bc.mode === "french") return 0;

  const fromFloor = Math.max(0, bc.fromFloor ?? 1);
  const etages    = Math.max(0, niveaux - fromFloor);
  if (etages <= 0) return 0;

  const depthM = (bc.depthFrac ?? 0.4) * (b.levels.typicalFloorHeightM ?? 2.8);

  // Périmètre concerné : toutes les arêtes, ou sous-ensemble si edges fourni.
  // (approximation : on prend le périmètre total ; un sous-ensemble réduirait
  //  proportionnellement, négligé en V1.)
  const lineaire = perimetre;

  if (bc.mode === "continuous") {
    return lineaire * depthM * etages;
  }
  // perBay : balcons isolés ≈ moitié du linéaire couvert.
  return lineaire * 0.5 * depthM * etages;
}

function openingsCount(
  b: MassingBuildingModel, niveaux: number, nbAretes: number,
): { nbFenetres: number; nbPortes: number } {
  const oc = b.style?.openings;
  if (!oc?.enabled) return { nbFenetres: 0, nbPortes: 0 };
  const baysPerEdge = Math.max(0, oc.baysPerEdge ?? 4);
  const nbFenetres  = baysPerEdge * Math.max(3, nbAretes) * niveaux;
  const nbPortes    = oc.door ? 1 : 0;
  return { nbFenetres, nbPortes };
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
function round(x: number): number { return Math.round(x); }

// ─── Point d'entrée ───────────────────────────────────────────────────────────

export function deriveMassingMetrics(
  buildings: MassingBuildingModel[],
  opts: DeriveOptions = {},
): MassingMetrics {
  const visibles = (buildings ?? []).filter(b => b && b.visible !== false);
  const parBatiment = visibles.map(deriveBuilding);

  const sum = (sel: (m: BatimentMetrics) => number) =>
    parBatiment.reduce((s, m) => s + sel(m), 0);

  const totaux = {
    nbBatiments:              parBatiment.length,
    empriseSolM2:             round(sum(m => m.empriseSolM2)),
    sdpM2:                    round(sum(m => m.sdpM2)),
    shabM2:                   round(sum(m => m.shabM2)),
    surfaceFacadeM2:          round(sum(m => m.surfaceFacadeM2)),
    surfaceFacadeNetteM2:     round(sum(m => m.surfaceFacadeNetteM2)),
    surfaceToitureTerrasseM2: round(sum(m => m.roofType === "terrasse" ? m.surfaceToitureM2 : 0)),
    surfaceToiturePenteM2:    round(sum(m => m.roofType === "pente"    ? m.surfaceToitureM2 : 0)),
    surfaceBalconsM2:         round(sum(m => m.surfaceBalconsM2)),
    nbMenuiseries:            sum(m => m.nbMenuiseries),
    nbLogements:              sum(m => m.nbLogements),
  };

  // Typologie : on répartit le nombre total de logements selon le mix.
  const nl = totaux.nbLogements;
  const typologie = {
    T1: Math.round(nl * TYPO_MIX.T1),
    T2: Math.round(nl * TYPO_MIX.T2),
    T3: Math.round(nl * TYPO_MIX.T3),
    T4: Math.round(nl * TYPO_MIX.T4),
  };
  // Réajuste le reliquat d'arrondi sur le T2 (le plus gros poste).
  const diff = nl - (typologie.T1 + typologie.T2 + typologie.T3 + typologie.T4);
  typologie.T2 = Math.max(0, typologie.T2 + diff);

  const ratios: MassingMetrics["ratios"] = {};
  if (opts.parcelAreaM2 && opts.parcelAreaM2 > 0) {
    ratios.terrainM2  = round(opts.parcelAreaM2);
    ratios.cesEmprise = +(totaux.empriseSolM2 / opts.parcelAreaM2).toFixed(3);
    ratios.densiteSdp = +(totaux.sdpM2 / opts.parcelAreaM2).toFixed(3);
  }

  return { parBatiment, totaux, typologie, ratios };
}