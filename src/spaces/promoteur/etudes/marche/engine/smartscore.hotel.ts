// src/spaces/promoteur/etudes/marche/engine/smartscore.hotel.ts

import type { InseeData } from "../types/market.types";
import type { ScoreComponent, SmartScoreResult } from "../types/smartscore.types";
import { computeSmartScore } from "./smartscore.base";
import { scoreFromRange, weightedMean, roundScore } from "../utils/score.utils";

export interface HotelSmartScoreInput {
  insee?: InseeData | null;
  tourisme?: any; // ex: nuites, flux_touristique, saisonnalite
  offre?: any;    // ex: hotels_count, chambres_total
  access?: any;   // ex: gare_distance_km, aeroport_distance_km, tc_score
  economie?: any; // ex: emplois, entreprises
}

function safe(n: any): number | null {
  const x = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(x) ? x : null;
}

function attractiviteTouristique(tourisme?: any) {
  const nuites = safe(tourisme?.nuites ?? tourisme?.nuitees);
  const evol = safe(tourisme?.evolution_pct);
  const scoreN = scoreFromRange(nuites, 20000, 400000, true);
  const scoreE = evol != null ? scoreFromRange(evol, -10, 10, true) : 50;

  return { score: roundScore(weightedMean([{ score: scoreN, weight: 0.75 }, { score: scoreE, weight: 0.25 }]), 0), details: { nuites, evol } };
}

function offreHoteliere(offre?: any) {
  const hotels = safe(offre?.hotels_count);
  const chambres = safe(offre?.chambres_total);

  // plus d’offre => concurrence, mais indique aussi un marché
  // hôtels: 0->30, 10->80, 40->100
  const sH = hotels != null ? scoreFromRange(hotels, 0, 40, true) : 50;
  // chambres: 0->30, 300->80, 1500->100
  const sC = chambres != null ? scoreFromRange(chambres, 0, 1500, true) : 50;

  return { score: roundScore(weightedMean([{ score: sH, weight: 0.45 }, { score: sC, weight: 0.55 }]), 0), details: { hotels, chambres } };
}

function accessibilite(access?: any) {
  const gare = safe(access?.gare_distance_km);
  const aeroport = safe(access?.aeroport_distance_km);
  const tc = safe(access?.tc_score);

  const sG = gare != null ? scoreFromRange(gare, 0, 20, false) : 50;
  const sA = aeroport != null ? scoreFromRange(aeroport, 0, 50, false) : 50;
  const sTc = tc != null ? tc : 50;

  return { score: roundScore(weightedMean([{ score: sG, weight: 0.40 }, { score: sA, weight: 0.30 }, { score: sTc, weight: 0.30 }]), 0), details: { gare, aeroport, tc } };
}

function economie(economie?: any, insee?: InseeData | null) {
  const emplois = safe(economie?.emplois);
  const pop = safe((insee as any)?.population);
  const rev = safe((insee as any)?.revenu_median);

  const sEmp = scoreFromRange(emplois ?? pop, 8000, 180000, true);
  const sRev = scoreFromRange(rev, 18000, 42000, true);

  return { score: roundScore(weightedMean([{ score: sEmp, weight: 0.6 }, { score: sRev, weight: 0.4 }]), 0), details: { emplois, pop, rev } };
}

function saisonnalite(tourisme?: any) {
  const saison = safe(tourisme?.saisonnalite_index); // 0..100 (si dispo)
  // Si pas dispo, neutre 50. Plus saisonnier => score baisse.
  const score = saison != null ? roundScore(scoreFromRange(saison, 20, 80, false), 0) : 50;
  return { score, details: { saisonnalite_index: saison } };
}

export function computeHotelSmartScore(input: HotelSmartScoreInput): SmartScoreResult {
  const sTour = attractiviteTouristique(input.tourisme);
  const sOffre = offreHoteliere(input.offre);
  const sAcc = accessibilite(input.access);
  const sEco = economie(input.economie, input.insee);
  const sSais = saisonnalite(input.tourisme);

  const components: ScoreComponent[] = [
    { key: "tourisme", label: "Attractivité touristique", weight: 0.35, score: sTour.score, details: sTour.details },
    { key: "concurrence", label: "Offre hôtelière", weight: 0.25, score: sOffre.score, details: sOffre.details },
    { key: "accessibilite", label: "Accessibilité", weight: 0.20, score: sAcc.score, details: sAcc.details },
    { key: "emploi", label: "Activité économique", weight: 0.10, score: sEco.score, details: sEco.details },
    { key: "marche", label: "Saisonnalité", weight: 0.10, score: sSais.score, details: sSais.details },
  ];

  const opportunities: string[] = [];
  const risks: string[] = [];
  const recommendations: string[] = [];

  if (sTour.score >= 70) opportunities.push("Attractivité touristique favorable.");
  if (sAcc.score >= 70) opportunities.push("Bonne accessibilité (gare/aéroport/TC).");
  if (sSais.score < 40) risks.push("Risque de forte saisonnalité (taux d’occupation variable).");
  if (sOffre.score < 35) risks.push("Marché concurrentiel et offre hôtelière déjà dense.");

  recommendations.push("Définir le mix clientèle (affaires/loisir) et la gamme (éco/mid/premium).");
  recommendations.push("Valider la saisonnalité via données locales (événements, flux).");
  recommendations.push("Benchmark concurrence (prix, étoiles, avis) si possible.");

  return computeSmartScore("hotel", components, {
    version: "smartscore-hotel-v1",
    opportunities,
    risks,
    recommendations,
  });
}
