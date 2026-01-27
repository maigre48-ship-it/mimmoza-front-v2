// src/spaces/promoteur/etudes/marche/engine/smartscore.bureaux.ts

import type { InseeData } from "../types/market.types";
import type { ScoreComponent, SmartScoreResult } from "../types/smartscore.types";
import { computeSmartScore } from "./smartscore.base";
import { scoreFromRange, weightedMean, roundScore } from "../utils/score.utils";

export interface BureauxSmartScoreInput {
  insee?: InseeData | null;
  emploi?: any;       // ex: emplois, actifs
  access?: any;       // ex: gare_distance, autoroute_distance, tc_score
  offre?: any;        // ex: bureaux_count, vacance_estimee
  bpe?: any;
}

function safe(n: any): number | null {
  const x = typeof n === "number" ? n : parseFloat(String(n));
  return Number.isFinite(x) ? x : null;
}

function bassinEmploi(insee?: InseeData | null, emploi?: any) {
  const actifs = safe(emploi?.actifs ?? (insee as any)?.population_active);
  const pop = safe((insee as any)?.population);
  const chom = safe((insee as any)?.taux_chomage);

  const sAct = scoreFromRange(actifs ?? pop, 8000, 120000, true);
  const sChom = chom != null ? scoreFromRange(chom, 4, 14, false) : 50;

  return { score: roundScore(weightedMean([{ score: sAct, weight: 0.75 }, { score: sChom, weight: 0.25 }]), 0), details: { actifs, pop, chom } };
}

function accessibilite(access?: any) {
  const gare = safe(access?.gare_distance_km);
  const autoroute = safe(access?.autoroute_distance_km);
  const tc = safe(access?.tc_score);

  const sGare = gare != null ? scoreFromRange(gare, 0, 15, false) : 50;
  const sAuto = autoroute != null ? scoreFromRange(autoroute, 0, 12, false) : 50;
  const sTc = tc != null ? tc : 50;

  return { score: roundScore(weightedMean([{ score: sGare, weight: 0.40 }, { score: sAuto, weight: 0.30 }, { score: sTc, weight: 0.30 }]), 0), details: { gare, autoroute, tc } };
}

function offreTertiaire(offre?: any) {
  const vac = safe(offre?.vacance_pct);
  const count = safe(offre?.bureaux_count);

  // Vacance: 12%->0 ; 7%->60 ; 4%->100 (lower better)
  const sVac = vac != null ? scoreFromRange(vac, 4, 12, false) : 50;
  // Count: 0->30 (petit marché), 30->80, 150->100
  const sCount = count != null ? scoreFromRange(count, 0, 150, true) : 50;

  return { score: roundScore(weightedMean([{ score: sVac, weight: 0.65 }, { score: sCount, weight: 0.35 }]), 0), details: { vac, count } };
}

function services(bpe?: any) {
  if (!bpe) return { score: 50, details: { available: false } };
  const serv = safe(bpe?.nb_services);
  const commerces = safe(bpe?.nb_commerces);

  return {
    score: roundScore(weightedMean([
      { score: scoreFromRange(serv, 10, 100, true), weight: 0.55 },
      { score: scoreFromRange(commerces, 10, 80, true), weight: 0.45 },
    ]), 0),
    details: { serv, commerces },
  };
}

export function computeBureauxSmartScore(input: BureauxSmartScoreInput): SmartScoreResult {
  const sEmp = bassinEmploi(input.insee, input.emploi);
  const sAcc = accessibilite(input.access);
  const sOffre = offreTertiaire(input.offre);
  const sServ = services(input.bpe);

  const components: ScoreComponent[] = [
    { key: "emploi", label: "Bassin d’emploi", weight: 0.30, score: sEmp.score, details: sEmp.details },
    { key: "accessibilite", label: "Accessibilité", weight: 0.25, score: sAcc.score, details: sAcc.details },
    { key: "concurrence", label: "Offre tertiaire (vacance)", weight: 0.20, score: sOffre.score, details: sOffre.details },
    { key: "marche", label: "Dynamique économique (proxy)", weight: 0.15, score: roundScore((sEmp.score + sAcc.score) / 2, 0), details: {} },
    { key: "services", label: "Services (restauration/commerces)", weight: 0.10, score: sServ.score, details: sServ.details },
  ];

  const opportunities: string[] = [];
  const risks: string[] = [];
  const recommendations: string[] = [];

  if (sEmp.score >= 70) opportunities.push("Bassin d’emploi porteur.");
  if (sAcc.score >= 70) opportunities.push("Accessibilité favorable pour bureaux.");
  if (sOffre.score < 40) risks.push("Risque de vacance tertiaire / marché moins dynamique.");
  if (sServ.score < 45) risks.push("Manque de services de proximité pour salariés.");

  recommendations.push("Prioriser proximité TC/gare + accès routiers.");
  recommendations.push("Positionner l’offre (flex/coworking) si marché traditionnel saturé.");
  recommendations.push("Valider la demande via typologie entreprises locales (SIRENE) si disponible.");

  return computeSmartScore("bureaux", components, {
    version: "smartscore-bureaux-v1",
    opportunities,
    risks,
    recommendations,
  });
}
