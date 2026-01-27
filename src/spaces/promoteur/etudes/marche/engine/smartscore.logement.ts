// src/spaces/promoteur/etudes/marche/engine/smartscore.logement.ts

import type { InseeData } from "../types/market.types";
import type { ScoreComponent, SmartScoreResult } from "../types/smartscore.types";
import { computeSmartScore } from "./smartscore.base";
import { scoreFromRange, weightedMean, roundScore, clamp } from "../utils/score.utils";

export interface LogementSmartScoreInput {
  insee?: InseeData | null;
  prices?: any; // DVF agrégé si dispo (median_eur_m2, evolution_1an, q1/q3...)
  transactions?: any; // DVF (count, ...)
  bpe?: any; // équipements si dispo
  zoneTypeHint?: "urbain" | "periurbain" | "rural";
}

function safe(n: any): number | null {
  const x = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(x) ? x : null;
}

function inferZone(insee?: InseeData | null, hint?: LogementSmartScoreInput["zoneTypeHint"]) {
  if (hint) return hint;
  const d = safe((insee as any)?.densite);
  if (d == null) return "periurbain";
  if (d >= 3000) return "urbain";
  if (d <= 300) return "rural";
  return "periurbain";
}

function demographie(insee?: InseeData | null) {
  const pop = safe((insee as any)?.population);
  const evol5 = safe((insee as any)?.evolution_pop_5ans);
  const dens = safe((insee as any)?.densite);
  const pct25_39 = safe((insee as any)?.pct_25_39);
  const pct30_44 = safe((insee as any)?.pct_30_44);

  const sPop = scoreFromRange(pop, 5000, 80000, true);
  const sEvol = scoreFromRange(evol5, -5, 10, true);
  const sJeunes = scoreFromRange((pct30_44 ?? pct25_39) ?? null, 10, 25, true);
  const sDens = dens != null ? clamp(scoreFromRange(dens, 100, 8000, true), 0, 100) : 50;

  const score = weightedMean([
    { score: sEvol, weight: 0.35 },
    { score: sJeunes, weight: 0.30 },
    { score: sPop, weight: 0.25 },
    { score: sDens, weight: 0.10 },
  ]);

  return { score: roundScore(score, 0), details: { pop, evol5, dens, pct30_44, pct25_39 } };
}

function marche(prices?: any, transactions?: any) {
  const med = safe(prices?.median_eur_m2);
  const evol1 = safe(prices?.evolution_1an);
  const txCount = safe(transactions?.count);

  // Volume transactions: 50 -> 0 ; 400 -> 100
  const sTx = scoreFromRange(txCount, 50, 400, true);
  // Evolution 1 an: -10 -> 0 ; +8 -> 100
  const sEvol = scoreFromRange(evol1, -10, 8, true);
  // Prix médian: on évite l’excès (trop cher = risque), on vise “zone solvable”
  // 1800 -> 40 ; 3500 -> 100 ; 7000 -> 40 (courbe en cloche simplifiée)
  let sPrice = 50;
  if (med != null) {
    if (med <= 1800) sPrice = 40;
    else if (med <= 3500) sPrice = 40 + ((med - 1800) / (3500 - 1800)) * 60;
    else if (med <= 7000) sPrice = 100 - ((med - 3500) / (7000 - 3500)) * 60;
    else sPrice = 40;
  }

  const score = weightedMean([
    { score: sTx, weight: 0.40 },
    { score: sEvol, weight: 0.35 },
    { score: sPrice, weight: 0.25 },
  ]);

  return { score: roundScore(score, 0), details: { median_eur_m2: med, evolution_1an: evol1, transactions: txCount } };
}

function services(bpe?: any, zone?: string) {
  if (!bpe) return { score: 50, details: { available: false } };

  const commerces = safe(bpe?.nb_commerces);
  const sante = safe(bpe?.nb_sante);
  const enseign = safe(bpe?.nb_enseignement);
  const serv = safe(bpe?.nb_services);

  // Score simple par densité d’équipements (capé)
  const s = clamp(
    (scoreFromRange(commerces, 5, 60, true) * 0.30) +
    (scoreFromRange(sante, 3, 40, true) * 0.30) +
    (scoreFromRange(enseign, 2, 20, true) * 0.20) +
    (scoreFromRange(serv, 5, 80, true) * 0.20),
    0, 100
  );

  // Ajustement rural : on tolère moins d’équipements
  const adj = zone === "rural" ? +10 : 0;

  return { score: roundScore(clamp(s + adj, 0, 100), 0), details: { commerces, sante, enseign, services: serv } };
}

export function computeLogementSmartScore(input: LogementSmartScoreInput): SmartScoreResult {
  const zone = inferZone(input.insee, input.zoneTypeHint);

  const sDemog = demographie(input.insee);
  const sMarche = marche(input.prices, input.transactions);
  const sServ = services(input.bpe, zone);

  // Concurrence logement: on n’a pas de pipeline “permis/programmes” ici => proxy via pression marché
  const sConc = roundScore(
    weightedMean([
      { score: sMarche.score, weight: 0.6 },
      { score: sDemog.score, weight: 0.4 },
    ]),
    0
  );

  const components: ScoreComponent[] = [
    { key: "demographie", label: "Démographie & ménages", weight: 0.30, score: sDemog.score, details: sDemog.details },
    { key: "marche", label: "Marché immobilier (DVF)", weight: 0.25, score: sMarche.score, details: sMarche.details },
    { key: "concurrence", label: "Offre & concurrence (proxy)", weight: 0.20, score: sConc, details: {} },
    { key: "services", label: "Services & équipements", weight: 0.15, score: sServ.score, details: sServ.details },
    { key: "accessibilite", label: "Dynamique territoriale (proxy)", weight: 0.10, score: roundScore((sDemog.score + sMarche.score) / 2, 0), details: { zone } },
  ];

  const opportunities: string[] = [];
  const risks: string[] = [];
  const recommendations: string[] = [];

  const evol5 = safe((input.insee as any)?.evolution_pop_5ans);
  if (evol5 != null && evol5 > 2) opportunities.push("Croissance démographique favorable à l’absorption.");
  if (sServ.score >= 70) opportunities.push("Bon niveau d’équipements pour soutenir la demande.");
  if (sMarche.score < 45) risks.push("Marché peu liquide ou dynamique DVF faible.");
  if (zone === "rural") risks.push("Risque de demande plus diffuse (commercialisation plus longue).");

  recommendations.push("Affiner la typologie produit (T2/T3/T4) selon structure des ménages.");
  recommendations.push("Caler le positionnement prix sur les comparables DVF récents.");
  recommendations.push("Vérifier pipeline offre future (permis, programmes) pour éviter saturation.");

  return computeSmartScore("logement", components, {
    version: "smartscore-logement-v1",
    opportunities,
    risks,
    recommendations,
  });
}
