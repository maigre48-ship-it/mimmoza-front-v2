// src/spaces/promoteur/etudes/marche/engine/smartscore.senior.ts

import type { InseeData } from "../types/market.types";
import type { ScoreComponent, SmartScoreResult } from "../types/smartscore.types";
import { computeSmartScore } from "./smartscore.base";
import { scoreFromRange, weightedMean, roundScore } from "../utils/score.utils";

export interface SeniorSmartScoreInput {
  insee?: InseeData | null;
  competition?: any; // résidences seniors count/capacity si dispo
  bpe?: any;
  services?: any;
}

function safe(n: any): number | null {
  const x = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(x) ? x : null;
}

function demographieSenior(insee?: InseeData | null) {
  const pct65 = safe((insee as any)?.pct_plus_65);
  const pct75 = safe((insee as any)?.pct_plus_75);
  const evol75 = safe((insee as any)?.evolution_75_plus_5ans);
  const pop = safe((insee as any)?.population);

  const s65 = scoreFromRange(pct65, 12, 25, true);
  const s75 = scoreFromRange(pct75, 6, 15, true);
  const sE = scoreFromRange(evol75, -5, 15, true);
  const sPop = scoreFromRange(pop, 5000, 80000, true);

  const score = weightedMean([
    { score: s75, weight: 0.45 },
    { score: s65, weight: 0.20 },
    { score: sE, weight: 0.20 },
    { score: sPop, weight: 0.15 },
  ]);

  return { score: roundScore(score, 0), details: { pct65, pct75, evol75, pop } };
}

function solvabilite(insee?: InseeData | null) {
  const rev = safe((insee as any)?.revenu_median);
  const prop = safe((insee as any)?.pct_proprietaires ?? (insee as any)?.pct_proprietaire);

  const sRev = scoreFromRange(rev, 18000, 42000, true);
  const sProp = scoreFromRange(prop, 40, 70, true);

  return { score: roundScore(weightedMean([{ score: sRev, weight: 0.7 }, { score: sProp, weight: 0.3 }]), 0), details: { rev, prop } };
}

function offre(competition?: any) {
  const count = safe(competition?.count ?? competition?.residences_count) ?? 0;
  // 0->100, 2->75, 5->45, 10->15
  const s =
    count <= 0 ? 100 :
    count <= 2 ? 75 :
    count <= 5 ? 45 :
    count <= 10 ? 15 : 5;
  return { score: s, details: { count } };
}

function servicesScore(bpe?: any) {
  if (!bpe) return { score: 50, details: { available: false } };
  const commerces = safe(bpe?.nb_commerces);
  const sante = safe(bpe?.nb_sante);
  const serv = safe(bpe?.nb_services);

  const score = weightedMean([
    { score: scoreFromRange(commerces, 8, 70, true), weight: 0.35 },
    { score: scoreFromRange(sante, 3, 40, true), weight: 0.45 },
    { score: scoreFromRange(serv, 8, 80, true), weight: 0.20 },
  ]);

  return { score: roundScore(score, 0), details: { commerces, sante, serv } };
}

export function computeSeniorSmartScore(input: SeniorSmartScoreInput): SmartScoreResult {
  const sDemog = demographieSenior(input.insee);
  const sSolv = solvabilite(input.insee);
  const sOffre = offre(input.competition);
  const sServ = servicesScore(input.bpe);

  const components: ScoreComponent[] = [
    { key: "demographie", label: "Démographie seniors", weight: 0.35, score: sDemog.score, details: sDemog.details },
    { key: "solvabilite", label: "Solvabilité", weight: 0.20, score: sSolv.score, details: sSolv.details },
    { key: "concurrence", label: "Offre existante", weight: 0.20, score: sOffre.score, details: sOffre.details },
    { key: "services", label: "Services & cadre de vie", weight: 0.15, score: sServ.score, details: sServ.details },
    { key: "accessibilite", label: "Accessibilité (proxy)", weight: 0.10, score: roundScore((sServ.score + sSolv.score) / 2, 0), details: {} },
  ];

  const opportunities: string[] = [];
  const risks: string[] = [];
  const recommendations: string[] = [];

  if (sDemog.score >= 70) opportunities.push("Vieillissement favorable et demande potentielle.");
  if (sOffre.score >= 70) opportunities.push("Offre seniors limitée, opportunité de positionnement.");
  if (sSolv.score < 45) risks.push("Solvabilité locale potentiellement insuffisante pour une offre premium.");
  if (sServ.score < 45) risks.push("Services / santé insuffisants pour une résidence seniors attractive.");

  recommendations.push("Positionner l’offre (services, animation, sécurité) selon solvabilité locale.");
  recommendations.push("Optimiser proximité commerces + santé (pharmacie, médecins).");
  recommendations.push("Étudier un mix produit (T1/T2) adapté aux seniors autonomes.");

  return computeSmartScore("residence_senior", components, {
    version: "smartscore-senior-v1",
    opportunities,
    risks,
    recommendations,
  });
}
