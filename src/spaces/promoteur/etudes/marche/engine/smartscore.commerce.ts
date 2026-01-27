// src/spaces/promoteur/etudes/marche/engine/smartscore.commerce.ts

import type { InseeData } from "../types/market.types";
import type { ScoreComponent, SmartScoreResult } from "../types/smartscore.types";
import { computeSmartScore } from "./smartscore.base";
import { scoreFromRange, weightedMean, roundScore, clamp } from "../utils/score.utils";

export interface CommerceSmartScoreInput {
  insee?: InseeData | null;
  bpe?: any;
  access?: any; // visibilité/axes/parking proxy si dispo
  concurrence?: any; // commerces_count, vacance_proxy
  revenus?: any;
}

function safe(n: any): number | null {
  const x = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(x) ? x : null;
}

function chalandise(insee?: InseeData | null) {
  const pop = safe((insee as any)?.population);
  const dens = safe((insee as any)?.densite);
  const evol5 = safe((insee as any)?.evolution_pop_5ans);

  const sPop = scoreFromRange(pop, 3000, 120000, true);
  const sDens = dens != null ? scoreFromRange(dens, 200, 12000, true) : 50;
  const sE = scoreFromRange(evol5, -5, 10, true);

  return { score: roundScore(weightedMean([{ score: sPop, weight: 0.55 }, { score: sDens, weight: 0.25 }, { score: sE, weight: 0.20 }]), 0), details: { pop, dens, evol5 } };
}

function fluxAccess(access?: any, bpe?: any) {
  // proxies: stationnement, transport, commerces
  const parking = safe(access?.parking_score);
  const tc = safe(access?.tc_score);
  const commerces = safe(bpe?.nb_commerces);

  const sParking = parking != null ? parking : 50;
  const sTc = tc != null ? tc : 50;
  const sCom = commerces != null ? scoreFromRange(commerces, 10, 120, true) : 50;

  return { score: roundScore(weightedMean([{ score: sParking, weight: 0.35 }, { score: sTc, weight: 0.25 }, { score: sCom, weight: 0.40 }]), 0), details: { parking, tc, commerces } };
}

function offreConcurrence(concurrence?: any, bpe?: any) {
  const nb = safe(concurrence?.commerces_count ?? bpe?.nb_commerces);
  const vac = safe(concurrence?.vacance_pct);

  // Concurrence: trop de commerces proches peut saturer mais aussi prouver flux => on vise un optimum
  // 20 -> 50 ; 60 -> 100 ; 140 -> 50 (cloche simple)
  let sNb = 50;
  if (nb != null) {
    if (nb <= 20) sNb = 50;
    else if (nb <= 60) sNb = 50 + ((nb - 20) / (60 - 20)) * 50;
    else if (nb <= 140) sNb = 100 - ((nb - 60) / (140 - 60)) * 50;
    else sNb = 50;
  }

  // Vacance: 15%->0 ; 8%->60 ; 4%->100
  const sVac = vac != null ? scoreFromRange(vac, 4, 15, false) : 50;

  return { score: roundScore(weightedMean([{ score: sNb, weight: 0.55 }, { score: sVac, weight: 0.45 }]), 0), details: { nb, vac } };
}

function pouvoirAchat(insee?: InseeData | null) {
  const rev = safe((insee as any)?.revenu_median);
  const score = roundScore(scoreFromRange(rev, 18000, 42000, true), 0);
  return { score, details: { revenu_median: rev } };
}

export function computeCommerceSmartScore(input: CommerceSmartScoreInput): SmartScoreResult {
  const sChal = chalandise(input.insee);
  const sFlux = fluxAccess(input.access, input.bpe);
  const sOffre = offreConcurrence(input.concurrence, input.bpe);
  const sPA = pouvoirAchat(input.insee);

  const components: ScoreComponent[] = [
    { key: "demographie", label: "Chalandise", weight: 0.35, score: sChal.score, details: sChal.details },
    { key: "accessibilite", label: "Flux & accessibilité", weight: 0.25, score: sFlux.score, details: sFlux.details },
    { key: "concurrence", label: "Offre existante", weight: 0.20, score: sOffre.score, details: sOffre.details },
    { key: "solvabilite", label: "Pouvoir d’achat", weight: 0.10, score: sPA.score, details: sPA.details },
    { key: "services", label: "Attractivité zone (proxy)", weight: 0.10, score: roundScore(clamp((sFlux.score + sChal.score) / 2, 0, 100), 0), details: {} },
  ];

  const opportunities: string[] = [];
  const risks: string[] = [];
  const recommendations: string[] = [];

  if (sChal.score >= 70) opportunities.push("Zone de chalandise favorable.");
  if (sFlux.score >= 70) opportunities.push("Accessibilité/flux favorables (parking/TC/centralité).");
  if (sOffre.score < 40) risks.push("Risque de saturation concurrentielle ou vacance commerciale élevée.");
  if (sPA.score < 45) risks.push("Pouvoir d’achat local limité pour certains concepts.");

  recommendations.push("Définir clairement la typologie (alimentaire / services / restauration) et la zone de flux.");
  recommendations.push("Valider la visibilité, le stationnement et l’accessibilité avant engagement.");
  recommendations.push("Bench concurrentiel terrain (enseignes, vacance, loyers) si possible.");

  return computeSmartScore("commerce", components, {
    version: "smartscore-commerce-v1",
    opportunities,
    risks,
    recommendations,
  });
}
