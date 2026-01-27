// src/spaces/promoteur/etudes/marche/engine/smartscore.etudiant.ts

import type { InseeData } from "../types/market.types";
import type { ScoreComponent, SmartScoreResult } from "../types/smartscore.types";
import { computeSmartScore } from "./smartscore.base";
import { scoreFromRange, weightedMean, roundScore, clamp } from "../utils/score.utils";

export interface EtudiantSmartScoreInput {
  insee?: InseeData | null;
  mesr?: any;       // ex: students_total, students_evolution
  campuses?: any[]; // ex: [{name, distance_km}]
  competition?: any; // ex: residences_count, units_total
  bpe?: any;
  prices?: any;
}

function safe(n: any): number | null {
  const x = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(x) ? x : null;
}

function demande(mesr?: any) {
  const students = safe(mesr?.students_total ?? mesr?.etudiants_total);
  const evol = safe(mesr?.students_evolution ?? mesr?.evolution_etudiants);

  const sStu = scoreFromRange(students, 2000, 40000, true);
  const sEvol = scoreFromRange(evol, -5, 12, true);

  return { score: roundScore(weightedMean([{ score: sStu, weight: 0.7 }, { score: sEvol, weight: 0.3 }]), 0), details: { students, evol } };
}

function accessCampus(campuses?: any[]) {
  if (!Array.isArray(campuses) || campuses.length === 0) return { score: 0, details: { available: false } };

  const best = campuses
    .map((c) => safe(c?.distance_km))
    .filter((d) => d != null)
    .sort((a, b) => (a as number) - (b as number))[0] as number | undefined;

  // 0km -> 100 ; 2km -> 80 ; 5km -> 50 ; 10km -> 20
  const s = best == null ? 0 : clamp(100 - (best / 10) * 80, 0, 100);
  return { score: roundScore(s, 0), details: { best_distance_km: best } };
}

function offre(competition?: any, mesr?: any) {
  const units = safe(competition?.units_total ?? competition?.logements_total);
  const resCount = safe(competition?.residences_count ?? competition?.count);
  const students = safe(mesr?.students_total ?? mesr?.etudiants_total);

  // ratio unités/étudiants (taux équipement) : 3% -> 100 (sous-équipé => bon), 8% -> 60, 15% -> 0
  let ratio = null as number | null;
  if (units != null && students != null && students > 0) ratio = (units / students) * 100;

  let sRatio = 50;
  if (ratio != null) {
    if (ratio <= 3) sRatio = 100;
    else if (ratio >= 15) sRatio = 0;
    else sRatio = clamp(100 - ((ratio - 3) / (15 - 3)) * 100, 0, 100);
  }

  // concurrence brute : beaucoup de résidences => baisse
  const sCount =
    resCount == null ? 50 :
    resCount <= 2 ? 85 :
    resCount <= 5 ? 60 :
    resCount <= 10 ? 35 : 15;

  return { score: roundScore(weightedMean([{ score: sRatio, weight: 0.65 }, { score: sCount, weight: 0.35 }]), 0), details: { units, resCount, ratio_pct: ratio } };
}

function services(bpe?: any) {
  if (!bpe) return { score: 50, details: { available: false } };
  const commerces = safe(bpe?.nb_commerces);
  const transport = safe(bpe?.nb_transport ?? bpe?.transport_score); // fallback si tu as un score
  const loisirs = safe(bpe?.nb_sport_culture);

  const s = weightedMean([
    { score: scoreFromRange(commerces, 10, 80, true), weight: 0.45 },
    { score: transport != null ? scoreFromRange(transport, 10, 80, true) : 50, weight: 0.25 },
    { score: scoreFromRange(loisirs, 3, 40, true), weight: 0.30 },
  ]);
  return { score: roundScore(s, 0), details: { commerces, transport, loisirs } };
}

export function computeEtudiantSmartScore(input: EtudiantSmartScoreInput): SmartScoreResult {
  const sDemande = demande(input.mesr);
  const sOffre = offre(input.competition, input.mesr);
  const sAccess = accessCampus(input.campuses);
  const sServ = services(input.bpe);

  const sMarche = input.prices?.median_eur_m2 != null
    ? roundScore(scoreFromRange(safe(input.prices.median_eur_m2), 1800, 4500, true), 0)
    : 50;

  const components: ScoreComponent[] = [
    { key: "demographie", label: "Demande étudiante", weight: 0.35, score: sDemande.score, details: sDemande.details },
    { key: "concurrence", label: "Offre existante", weight: 0.25, score: sOffre.score, details: sOffre.details },
    { key: "accessibilite", label: "Accessibilité campus", weight: 0.20, score: sAccess.score, details: sAccess.details },
    { key: "services", label: "Services & vie étudiante", weight: 0.10, score: sServ.score, details: sServ.details },
    { key: "marche", label: "Marché immobilier (proxy)", weight: 0.10, score: sMarche, details: { median_eur_m2: safe(input.prices?.median_eur_m2) } },
  ];

  const opportunities: string[] = [];
  const risks: string[] = [];
  const recommendations: string[] = [];

  if (sDemande.score >= 70) opportunities.push("Demande étudiante structurée et dynamique.");
  if (sOffre.score >= 70) opportunities.push("Sous-équipement potentiel en logements étudiants.");
  if (sAccess.score < 45) risks.push("Accessibilité campus insuffisante (distance/transport).");
  if (sOffre.score < 30) risks.push("Marché potentiellement saturé en résidences étudiantes.");

  recommendations.push("Cibler proximité campus et mobilité (TC) comme critère n°1.");
  recommendations.push("Positionner l’offre (T1/T2, services inclus) selon concurrence locale.");
  recommendations.push("Sécuriser partenariats écoles/gestionnaires pour remplissage.");

  return computeSmartScore("residence_etudiante", components, {
    version: "smartscore-etudiant-v1",
    opportunities,
    risks,
    recommendations,
  });
}
