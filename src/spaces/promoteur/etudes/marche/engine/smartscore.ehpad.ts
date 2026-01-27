// src/spaces/promoteur/etudes/marche/engine/smartscore.ehpad.ts

import type { InseeData, EHPADData, ServiceProche } from "../types/market.types";
import type { ScoreComponent, SmartScoreResult } from "../types/smartscore.types";
import { computeSmartScore } from "./smartscore.base";
import { clamp, scoreFromRange, weightedMean, roundScore } from "../utils/score.utils";

/**
 * Entrée SmartScore EHPAD
 * - On réutilise tes structures existantes (INSEE + FINESS/OSM déjà normalisé en EHPADData)
 * - servicesSante: passe market.services_ruraux (ou urbain) si dispo
 */
export interface EhpadSmartScoreInput {
  insee?: InseeData | null;
  ehpad?: EHPADData | null;
  servicesSante?: Record<string, ServiceProche> | null;

  /**
   * Optionnel: type de zone si tu as déjà un flag (urbain/rural) ou densité proxy.
   * Si absent, on déduit légèrement via insee.densite.
   */
  zoneTypeHint?: "urbain" | "periurbain" | "rural";
}

function safeNumber(n: any): number | null {
  const x = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(x) ? x : null;
}

function boolScore(isOk: boolean | null | undefined, ok = 100, nok = 0): number {
  if (isOk == null) return 0;
  return isOk ? ok : nok;
}

/**
 * Déduit un type de zone simple
 */
function inferZoneType(insee?: InseeData | null, hint?: EhpadSmartScoreInput["zoneTypeHint"]) {
  if (hint) return hint;
  const dens = safeNumber((insee as any)?.densite);
  if (dens == null) return "periurbain";
  if (dens >= 3000) return "urbain";
  if (dens <= 300) return "rural";
  return "periurbain";
}

/**
 * Sous-score DÉMOGRAPHIE / DÉPENDANCE (0..100)
 * Variables INSEE utilisées (si présentes):
 * - pct_plus_75, pct_plus_85, evolution_75_plus_5ans, population
 */
function computeDemographieScore(insee?: InseeData | null): { score: number; details: any; notes: string[] } {
  const notes: string[] = [];
  const pop = safeNumber((insee as any)?.population);
  const pct75 = safeNumber((insee as any)?.pct_plus_75);
  const pct85 = safeNumber((insee as any)?.pct_plus_85);
  const evol75_5 = safeNumber((insee as any)?.evolution_75_plus_5ans);

  // % 75+ : 6% (faible) -> 0 ; 14% (fort) -> 100
  const s75 = scoreFromRange(pct75 ?? null, 6, 14, true);
  // % 85+ : 1% -> 0 ; 4% -> 100
  const s85 = scoreFromRange(pct85 ?? null, 1, 4, true);
  // évolution 75+ sur 5 ans : -5% -> 0 ; +15% -> 100
  const sEvol = scoreFromRange(evol75_5 ?? null, -5, 15, true);

  // taille de marché (population) : <5k -> 0 ; >50k -> 100
  const sPop = scoreFromRange(pop ?? null, 5000, 50000, true);

  const score = weightedMean([
    { score: s75, weight: 0.45 },
    { score: s85, weight: 0.25 },
    { score: sEvol, weight: 0.20 },
    { score: sPop, weight: 0.10 },
  ]);

  if (pct75 != null) notes.push(`Part 75+ : ${roundScore(pct75, 1)}%`);
  if (pct85 != null) notes.push(`Part 85+ : ${roundScore(pct85, 1)}%`);
  if (evol75_5 != null) notes.push(`Évol. 75+ /5 ans : ${roundScore(evol75_5, 1)}%`);
  if (pop != null) notes.push(`Population : ${Math.round(pop).toLocaleString("fr-FR")}`);

  return {
    score: roundScore(score, 0),
    details: { pct75, pct85, evol75_5: evol75_5, population: pop },
    notes,
  };
}

/**
 * Sous-score OFFRE & LITS (0..100)
 * Basé sur:
 * - densite_lits_1000_seniors (si dispo)
 * - count concurrence (plus il y a d’établissements, plus concurrence forte)
 * - capacite connue / totale connue
 *
 * Logique:
 * - si densité lits faible => opportunité => score élevé
 * - si densité lits très élevée => saturation => score faible
 */
function computeOffreLitsScore(ehpad?: EHPADData | null): { score: number; details: any; notes: string[] } {
  const notes: string[] = [];
  const count = safeNumber((ehpad as any)?.count) ?? 0;
  const dens = safeNumber((ehpad as any)?.analyse_concurrence?.densite_lits_1000_seniors);
  const capTot = safeNumber((ehpad as any)?.analyse_concurrence?.capacite_totale);

  // Densité lits /1000 seniors :
  // <70 = sous-équipé => 100
  // 100 = neutre => ~60
  // >130 = sur-équipé => 0
  let sDens = 50;
  if (dens != null) {
    if (dens <= 70) sDens = 100;
    else if (dens >= 130) sDens = 0;
    else sDens = clamp(100 - ((dens - 70) / (130 - 70)) * 100, 0, 100);
  } else {
    // pas de densité => on se rabat sur le nombre d'établissements (proxy concurrence)
    // 0 -> 100, 3 -> 70, 6 -> 40, 10+ -> 10
    const c = count;
    if (c <= 0) sDens = 100;
    else if (c <= 3) sDens = 70;
    else if (c <= 6) sDens = 40;
    else if (c <= 10) sDens = 20;
    else sDens = 10;
  }

  // Concurrence brute via count (plus c’est élevé, plus le score baisse)
  // 0 -> 100 ; 3 -> 70 ; 6 -> 45 ; 12 -> 20
  const sCount =
    count <= 0 ? 100 :
    count <= 3 ? 70 :
    count <= 6 ? 45 :
    count <= 12 ? 20 : 10;

  // Capacité totale connue (si on a des lits) : plus la capacité connue est élevée, plus concurrence potentielle => score baisse légèrement
  // 0 -> neutral ; 300 -> -10 ; 800 -> -25 (plafonné)
  let capPenalty = 0;
  if (capTot != null && capTot > 0) {
    capPenalty = clamp((capTot / 800) * 25, 0, 25);
  }

  const scoreBase = weightedMean([
    { score: sDens, weight: 0.65 },
    { score: sCount, weight: 0.35 },
  ]);

  const score = clamp(scoreBase - capPenalty, 0, 100);

  if (dens != null) notes.push(`Densité : ${roundScore(dens, 0)} lits / 1000 seniors`);
  notes.push(`Concurrence : ${count} établissement(s)`);
  if (capTot != null) notes.push(`Capacité connue totale : ${Math.round(capTot)} lits`);

  return {
    score: roundScore(score, 0),
    details: { count, densite_lits_1000_seniors: dens, capacite_totale: capTot, capPenalty },
    notes,
  };
}

/**
 * Sous-score SANTÉ / ACCESSIBILITÉ (0..100)
 * On utilise les services proches si disponibles.
 * Critères proxy:
 * - hôpital/clinique
 * - urgences
 * - médecins
 * - pharmacie
 *
 * Chaque item: présence + distance.
 */
function computeSanteAccessScore(services?: Record<string, ServiceProche> | null): { score: number; details: any; notes: string[] } {
  const notes: string[] = [];
  if (!services) return { score: 0, details: { available: false }, notes: ["Services santé indisponibles"] };

  const hosp = services.hopital_proche || (services as any).hospital_proche || (services as any).hopital;
  const urg = (services as any).urgences_proches || (services as any).urgences || null;
  const med = services.medecin_proche || (services as any).medecins_proches || null;
  const pharm = services.pharmacie_proche || null;

  const distKm = (x: any) => {
    if (!x) return null;
    const d = safeNumber((x as any).distance_km);
    if (d != null) return d;
    const dm = safeNumber((x as any).distance_m);
    return dm != null ? dm / 1000 : null;
  };

  // Distance scoring: 0km -> 100 ; 5km -> 60 ; 15km -> 20 ; 30km -> 0
  const sHosp = hosp ? clamp(100 - (scoreFromRange(distKm(hosp), 0, 30, true)), 0, 100) : 0;
  const sPharm = pharm ? clamp(100 - (scoreFromRange(distKm(pharm), 0, 10, true)), 0, 100) : 0;
  const sMed = med ? clamp(100 - (scoreFromRange(distKm(med), 0, 10, true)), 0, 100) : 0;

  // urgences = bonus si présent à moins de 20km
  const urgD = distKm(urg);
  const sUrg = urg ? (urgD != null ? (urgD <= 20 ? 80 : 40) : 50) : 0;

  // présence brute (si pas de distance renseignée)
  const pHosp = boolScore(!!hosp, 80, 0);
  const pPharm = boolScore(!!pharm, 70, 0);
  const pMed = boolScore(!!med, 70, 0);

  // fusion distance+présence
  const score = weightedMean([
    { score: hosp ? Math.max(sHosp, pHosp) : 0, weight: 0.40 },
    { score: med ? Math.max(sMed, pMed) : 0, weight: 0.25 },
    { score: pharm ? Math.max(sPharm, pPharm) : 0, weight: 0.20 },
    { score: urg ? sUrg : 0, weight: 0.15 },
  ]);

  if (hosp) notes.push(`Hôpital/clinique : ${distKm(hosp)?.toFixed(1) ?? "—"} km`);
  if (med) notes.push(`Médecin : ${distKm(med)?.toFixed(1) ?? "—"} km`);
  if (pharm) notes.push(`Pharmacie : ${distKm(pharm)?.toFixed(1) ?? "—"} km`);
  if (urg) notes.push(`Urgences : ${urgD?.toFixed(1) ?? "—"} km`);

  return {
    score: roundScore(score, 0),
    details: {
      has_hospital: !!hosp,
      has_medecin: !!med,
      has_pharmacie: !!pharm,
      has_urgences: !!urg,
    },
    notes,
  };
}

/**
 * Sous-score SOLVABILITÉ (0..100)
 * Proxy: revenu median + taux de pauvreté + chômage si dispo.
 */
function computeSolvabiliteScore(insee?: InseeData | null): { score: number; details: any; notes: string[] } {
  const notes: string[] = [];

  const revenu = safeNumber((insee as any)?.revenu_median);
  const pauvrete = safeNumber((insee as any)?.pct_sous_seuil_pauvrete ?? (insee as any)?.taux_pauvrete);
  const chomage = safeNumber((insee as any)?.taux_chomage);

  // Revenu médian: 18k -> 0 ; 28k -> 70 ; 40k -> 100
  const sRev = scoreFromRange(revenu ?? null, 18000, 40000, true);
  // Pauvreté: 25% -> 0 ; 15% -> 60 ; 8% -> 100 (lower is better)
  const sPauv = pauvrete != null ? scoreFromRange(pauvrete, 8, 25, false) : 50;
  // Chômage: 14% -> 0 ; 9% -> 60 ; 4% -> 100 (lower is better)
  const sChom = chomage != null ? scoreFromRange(chomage, 4, 14, false) : 50;

  const score = weightedMean([
    { score: sRev, weight: 0.55 },
    { score: sPauv, weight: 0.25 },
    { score: sChom, weight: 0.20 },
  ]);

  if (revenu != null) notes.push(`Revenu médian : ${Math.round(revenu).toLocaleString("fr-FR")} €/an`);
  if (pauvrete != null) notes.push(`Pauvreté : ${roundScore(pauvrete, 1)}%`);
  if (chomage != null) notes.push(`Chômage : ${roundScore(chomage, 1)}%`);

  return { score: roundScore(score, 0), details: { revenu, pauvrete, chomage }, notes };
}

/**
 * Sous-score ENVIRONNEMENT (0..100)
 * Proxy simple: zoneType + densité
 * (faible poids sur EHPAD)
 */
function computeEnvironnementScore(insee?: InseeData | null, hint?: EhpadSmartScoreInput["zoneTypeHint"]) {
  const notes: string[] = [];
  const zone = inferZoneType(insee, hint);
  const dens = safeNumber((insee as any)?.densite);

  // EHPAD: périurbain/urbain = généralement bien (accès), rural = dépend plus des services
  let base = 60;
  if (zone === "urbain") base = 70;
  if (zone === "periurbain") base = 65;
  if (zone === "rural") base = 55;

  // Ajustement densité
  // très dense >6000 => -5 (nuisances)
  // très faible <100 => -5 (isolement)
  let adj = 0;
  if (dens != null) {
    if (dens > 6000) adj -= 5;
    if (dens < 100) adj -= 5;
  }

  const score = clamp(base + adj, 0, 100);
  notes.push(`Zone : ${zone}`);
  if (dens != null) notes.push(`Densité : ${Math.round(dens)} hab./km²`);

  return { score: roundScore(score, 0), details: { zone, densite: dens }, notes };
}

/**
 * Fonction principale
 * Pondérations EHPAD (alignées avec la stratégie qu'on a définie)
 * - Démographie dépendance : 40%
 * - Offre & lits : 30%
 * - Santé / access : 15%
 * - Solvabilité : 10%
 * - Environnement : 5%
 */
export function computeEhpadSmartScore(input: EhpadSmartScoreInput): SmartScoreResult {
  const demog = computeDemographieScore(input.insee);
  const offre = computeOffreLitsScore(input.ehpad);
  const sante = computeSanteAccessScore(input.servicesSante ?? null);
  const solv = computeSolvabiliteScore(input.insee);
  const env = computeEnvironnementScore(input.insee, input.zoneTypeHint);

  const components: ScoreComponent[] = [
    { key: "demographie", label: "Démographie & dépendance", weight: 0.40, score: demog.score, details: demog.details },
    { key: "concurrence", label: "Offre & lits", weight: 0.30, score: offre.score, details: offre.details },
    { key: "sante", label: "Accès santé", weight: 0.15, score: sante.score, details: sante.details },
    { key: "solvabilite", label: "Solvabilité", weight: 0.10, score: solv.score, details: solv.details },
    { key: "services", label: "Environnement", weight: 0.05, score: env.score, details: env.details },
  ];

  // Opportunités / Risques / Recos (simples et utiles)
  const opportunities: string[] = [];
  const risks: string[] = [];
  const recommendations: string[] = [];

  const dens = safeNumber((input.ehpad as any)?.analyse_concurrence?.densite_lits_1000_seniors);
  const count = safeNumber((input.ehpad as any)?.count) ?? 0;
  const pct75 = safeNumber((input.insee as any)?.pct_plus_75);

  if (pct75 != null && pct75 >= 12) opportunities.push("Forte proportion de seniors (75+), demande structurelle potentielle.");
  if (dens != null && dens < 80) opportunities.push("Zone sous-équipée en lits (densité < 80 lits/1000 seniors).");
  if (count <= 2) opportunities.push("Concurrence directe limitée dans le rayon d’analyse.");

  if (dens != null && dens > 120) risks.push("Zone potentiellement sur-équipée (densité élevée de lits).");
  if (count >= 8) risks.push("Concurrence forte (nombre d’établissements élevé).");
  if (sante.score < 45) risks.push("Accès santé perfectible (hôpital/médecins/pharmacie éloignés ou manquants).");

  recommendations.push("Valider l’opportunité via une analyse ARS (autorisations, besoins territoriaux) avant engagement.");
  recommendations.push("Positionner l’offre (gamme, unités spécialisées, accueil Alzheimer) pour différenciation.");
  recommendations.push("Sécuriser l’accessibilité (urgence, hôpital, pharmacie) et les partenariats médicaux de proximité.");

  return computeSmartScore("ehpad", components, {
    version: "smartscore-ehpad-v1",
    opportunities,
    risks,
    recommendations,
  });
}
