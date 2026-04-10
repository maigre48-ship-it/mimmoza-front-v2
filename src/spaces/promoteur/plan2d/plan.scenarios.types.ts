// src/spaces/promoteur/plan2d/plan.scenarios.types.ts
//
// Modèle "light" destiné au panneau UI et aux composants de comparaison.
// Toujours dérivé de ImplantationScenarioFull via toImplantationScenario().
// Ne jamais construire manuellement depuis une source partielle.

import type { PlanBuilding }                    from "./plan.types";
import type { ImplantationScenarioFull }        from "./scenarioGenerator.types";
import type { ScenarioScoreResult }             from "./plan.scenarioScore.types";
import type { ScenarioRecommendationLayer }     from "./plan.scenarioNotes.types";

// ─── MÉTRIQUES ────────────────────────────────────────────────────────

export interface ImplantationScenarioMetrics {
  totalFootprintM2: number;
  coverageRatio:    number;   // cesPct ∈ [0, 1]
  buildingCount:    number;
  blockingCount:    number;   // 1 si BLOQUANT, 0 sinon
  limitedCount:     number;   // 1 si LIMITE, 0 sinon
  /** Places de parking réellement fournies (= slotCount agrégé des Parking2D). */
  parkingProvided:  number;
  /** Places requises selon le programme (0 si nbLogements non défini). */
  parkingRequired:  number;
}

// ─── STATUT ───────────────────────────────────────────────────────────

export type ScenarioStatus = "CONFORME" | "LIMITE" | "BLOQUANT";

// ─── SCÉNARIO LIGHT ───────────────────────────────────────────────────

export interface ImplantationScenario {
  id:              string;
  label:           string;
  description?:    string;
  /**
   * Bâtiments en géométrie PlanBuilding (pour rendu canvas/SVG).
   * Dérivés depuis ImplantationScenarioFull.
   * Ne pas utiliser pour les calculs métier — utiliser ImplantationScenarioFull.
   */
  buildings:            readonly PlanBuilding[];
  metrics:              ImplantationScenarioMetrics;
  globalStatus:         ScenarioStatus;
  recommendation:       string;
  recommended?:         boolean;
  active?:              boolean;
  /** Score global 0–100 (scoreGlobal de ImplantationScenarioFull). */
  scoreOverall?:        number;
  /** Score détaillé calculé par applyScenarioScores(). Absent sur les scénarios bruts. */
  score?:               ScenarioScoreResult;
  /** Couche de recommandation structurée. */
  recommendationLayer?: ScenarioRecommendationLayer;
}

// ─── COMPARAISON ──────────────────────────────────────────────────────

export interface ScenarioComparison {
  parcelAreaM2:          number;
  scenarios:             ImplantationScenario[];
  activeScenarioId:      string | null;
  recommendedScenarioId: string | null;
}

// ─── SEUILS CES (miroir de exportScenarioComparisonPdf.ts) ────────────
// Si ces seuils changent, mettre à jour les deux fichiers.

const CES_WARN  = 0.46;
const CES_BLOCK = 0.54;

// ─── DÉRIVATION DU STATUT ─────────────────────────────────────────────

function deriveStatus(s: ImplantationScenarioFull): ScenarioStatus {
  // Le déficit parking ne bloque que si le programme est défini.
  const parkingMissing = s.nbLogements !== undefined && s.parkingProvided < s.parkingRequired;
  const cesExceeded    = s.cesPct > CES_BLOCK;
  if (!s.isConforme && (parkingMissing || cesExceeded)) return "BLOQUANT";
  if (!s.isConforme)                                     return "LIMITE";
  if (s.cesPct > CES_WARN)                               return "LIMITE";
  return "CONFORME";
}

// ─── ADAPTATEUR OFFICIEL ──────────────────────────────────────────────
//
// Seule fonction autorisée à créer un ImplantationScenario depuis un
// ImplantationScenarioFull. Garantit la cohérence entre le panneau UI
// et le PDF d'export.
//
// Le champ buildings est délibérément vide : PlanBuilding utilise une
// géométrie GeoJSON (plan.mapper.ts) incompatible avec Building2D.
// Les consommateurs UI qui ont besoin du rendu canvas doivent conserver
// la référence à ImplantationScenarioFull directement.

export function toImplantationScenario(
  full: ImplantationScenarioFull,
  opts: { active?: boolean; recommended?: boolean } = {},
): ImplantationScenario {
  const globalStatus = deriveStatus(full);

  const metrics: ImplantationScenarioMetrics = {
    totalFootprintM2: full.empriseM2,
    coverageRatio:    full.cesPct,
    buildingCount:    full.buildingCount,
    blockingCount:    globalStatus === "BLOQUANT" ? 1 : 0,
    limitedCount:     globalStatus === "LIMITE"   ? 1 : 0,
    parkingProvided:  full.parkingProvided,
    parkingRequired:  full.parkingRequired,
  };

  return {
    id:             full.id,
    label:          full.title,
    description:    full.description,
    buildings:      [],   // voir commentaire ci-dessus
    metrics,
    globalStatus,
    recommendation: full.description,
    recommended:    opts.recommended,
    active:         opts.active,
    scoreOverall:   full.scoreGlobal,
  };
}

/**
 * Convertit un tableau de ImplantationScenarioFull en ScenarioComparison,
 * prêt à l'affichage dans le panneau de droite.
 * Le meilleur score global est désigné scénario recommandé si aucun
 * recommendedId explicite n'est fourni.
 */
export function toScenarioComparison(
  fulls:            ImplantationScenarioFull[],
  parcelAreaM2:     number,
  activeScenarioId: string | null,
  recommendedId?:   string | null,
): ScenarioComparison {
  const sorted = [...fulls].sort((a, b) => b.scoreGlobal - a.scoreGlobal);
  const recId  = recommendedId ?? sorted[0]?.id ?? null;

  return {
    parcelAreaM2,
    activeScenarioId,
    recommendedScenarioId: recId,
    scenarios: fulls.map((f) =>
      toImplantationScenario(f, {
        active:      f.id === activeScenarioId,
        recommended: f.id === recId,
      }),
    ),
  };
}