// =============================================================
// Mimmoza · Opportunity Engine — Service (V1)
// Scoring DÉTERMINISTE, sans IA, sans valeur de marché inventée.
// Branchable plus tard : StreamEstate / DVF / valuation / risques / mobilité.
// =============================================================

import { resolvePluContext } from '../plu/pluRegistry.service';
import type { ResolvePluContextResult } from '../plu/pluEngine.types';
import type {
  OpportunityConfidence,
  OpportunityInput,
  OpportunityPillarKey,
  OpportunityRecommendation,
  OpportunityRecommendationAction,
  OpportunityResult,
  OpportunityRiskFlag,
  OpportunityScoreBreakdown,
  OpportunitySignal,
} from './opportunityEngine.types';

// -------------------------------------------------------------
// Configuration
// -------------------------------------------------------------

const PILLAR_LABELS: Record<OpportunityPillarKey, string> = {
  market_discount: 'Décote marché',
  location: 'Localisation',
  liquidity: 'Liquidité',
  risk: 'Risque',
  rentability: 'Rentabilité locative',
  future_potential: 'Potentiel rénovation',
  promoteur_potential: 'Potentiel promoteur',
};

/** Poids par stratégie (somme = 1 par stratégie). */
const STRATEGY_WEIGHTS: Record<
  OpportunityInput['strategy'],
  Record<OpportunityPillarKey, number>
> = {
  investisseur: {
    market_discount: 0.3,
    location: 0.15,
    liquidity: 0.15,
    risk: 0.15,
    rentability: 0.25,
    future_potential: 0,
    promoteur_potential: 0,
  },
  rehabilitateur: {
    market_discount: 0.26,
    location: 0.16,
    liquidity: 0.16,
    risk: 0.22,
    rentability: 0,
    future_potential: 0.2,
    promoteur_potential: 0,
  },
  promoteur: {
    market_discount: 0.18,
    location: 0.18,
    liquidity: 0.06,
    risk: 0.18,
    rentability: 0,
    future_potential: 0,
    promoteur_potential: 0.4,
  },
};

const REHAB_KEYWORDS = [
  'travaux',
  'à rénover',
  'a renover',
  'fort potentiel',
  'rénovation',
  'renovation',
  'plateau',
  'division',
];

// -------------------------------------------------------------
// Résultat interne d'un pilier
// -------------------------------------------------------------

interface PillarComputation {
  score: number | null;
  available: boolean;
  rationale: string;
  signals: OpportunitySignal[];
  riskFlags: OpportunityRiskFlag[];
}

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR')} €`;
}

function confidenceLabel(c: OpportunityConfidence): string {
  return c === 'high' ? 'élevée' : c === 'medium' ? 'moyenne' : 'faible';
}

// -------------------------------------------------------------
// Piliers
// -------------------------------------------------------------

/**
 * Décote marché : compare le prix/m² de l'annonce à la médiane DVF de la zone.
 * Barème asymétrique (surcote punie ~2× plus vite que la décote n'est récompensée).
 */
// Bornes de plausibilité du prix/m² habitable (France). Hors de cette plage,
// la valeur est presque sûrement une erreur source (loyer publié comme prix,
// parking/cave, prix partiel, coquille) -> on ne dérive pas de métrique dessus.
const PRICE_M2_MIN_PLAUSIBLE = 400;
const PRICE_M2_MAX_PLAUSIBLE = 60000;

function isImplausiblePriceM2(pm2: number | null): boolean {
  return pm2 != null && (pm2 < PRICE_M2_MIN_PLAUSIBLE || pm2 > PRICE_M2_MAX_PLAUSIBLE);
}

export function computeMarketDiscountScore(input: OpportunityInput): PillarComputation {
  const signals: OpportunitySignal[] = [];
  const ref = input.marketRefPriceM2 ?? null;
  const price = input.askingPrice;
  const area = input.livingArea ?? null;
  const pm2 = price != null && area != null && area > 0 ? price / area : null;

  if (pm2 != null) {
    signals.push({
      code: 'PRICE_PER_SQM',
      label: 'Prix au m² habitable',
      detail: fmtEur(pm2) + '/m²',
      severity: 'info',
    });
  }

  // Garde-fou : prix/m² aberrant -> décote non fiable, on ne calcule pas.
  if (isImplausiblePriceM2(pm2)) {
    signals.push({
      code: 'PRICE_IMPLAUSIBLE',
      label: 'Prix au m² incohérent — décote non calculée',
      detail: 'Donnée source probablement erronée (loyer, parking, prix partiel).',
      severity: 'warning',
    });
    return {
      score: null,
      available: false,
      rationale: 'Décote non calculée : prix au m² incohérent (donnée source suspecte).',
      signals,
      riskFlags: [],
    };
  }

  if (ref == null || ref <= 0 || pm2 == null) {
    if (ref == null) {
      signals.push({
        code: 'MARKET_DATA_PENDING',
        label: 'Référence DVF indisponible pour la zone',
        severity: 'info',
      });
    }
    return {
      score: null,
      available: false,
      rationale: 'Décote non calculable (référence DVF ou prix/m² manquant).',
      signals,
      riskFlags: [],
    };
  }

  const delta = (pm2 - ref) / ref; // > 0 = surcote, < 0 = décote
  let score: number;
  if (delta <= 0) {
    score = 60 + Math.min(35, -delta * 100 * 1.75);
  } else {
    score = 60 - Math.min(50, delta * 100 * 2.5);
  }

  const sample = input.marketSampleSize ?? 0;
  if (sample > 0 && sample < 5) {
    // Peu de comparables -> on ramène vers le neutre.
    score = 60 + (score - 60) * 0.5;
  }
  score = clamp(Math.round(score), 0, 100);

  const pct = Math.round(delta * 100);
  signals.push({
    code: delta <= 0 ? 'MARKET_DISCOUNT' : 'MARKET_PREMIUM',
    label: delta <= 0 ? `Sous le marché de ${Math.abs(pct)}%` : `Au-dessus du marché de ${pct}%`,
    detail: `réf. DVF ${fmtEur(ref)}/m²${sample ? ` · ${sample} ventes` : ''}`,
    severity: delta <= -0.05 ? 'positive' : delta >= 0.05 ? 'warning' : 'info',
  });

  return {
    score,
    available: true,
    rationale: `Décote/surcote vs médiane DVF de la zone${sample ? ` (${sample} ventes)` : ''}.`,
    signals,
    riskFlags: [],
  };
}

/**
 * Localisation : score de mobilité GTFS (commune) si disponible.
 * Sinon "en attente" (mobilité/INSEE/BPE non résolus pour cette annonce).
 */
export function computeLocationScore(input: OpportunityInput): PillarComputation {
  const mobility = input.mobilityScore;
  if (typeof mobility === 'number' && Number.isFinite(mobility)) {
    return {
      score: clamp(Math.round(mobility), 0, 100),
      available: true,
      rationale: 'Mobilité GTFS de la commune (rail, réseau urbain, bassin d’emploi, multimodalité).',
      signals: [],
      riskFlags: [],
    };
  }

  const hasGeo = Boolean(
    (input.codeInsee && input.codeInsee.trim()) ||
      (input.latitude != null && input.longitude != null),
  );

  return {
    score: null,
    available: false,
    rationale: hasGeo
      ? 'Score de mobilité indisponible pour cette zone (GTFS non résolu).'
      : 'Localisation insuffisante (INSEE/coordonnées absents).',
    signals: [],
    riskFlags: [],
  };
}

/** Liquidité : heuristique déterministe (type de bien + surface). */
export function computeLiquidityScore(input: OpportunityInput): PillarComputation {
  const base: Record<OpportunityInput['assetType'], number> = {
    appartement: 75,
    maison: 70,
    immeuble: 55,
    local: 45,
    terrain: 50,
    unknown: 40,
  };

  let score = base[input.assetType];

  if (input.assetType === 'appartement' || input.assetType === 'maison') {
    const a = input.livingArea ?? null;
    if (a != null) {
      if (a >= 30 && a <= 120) score += 10;
      else if (a > 200) score -= 10;
    }
  }

  if (input.assetType === 'terrain') {
    const l = input.landArea ?? null;
    if (l != null) {
      if (l >= 300 && l <= 2000) score += 5;
      else if (l > 5000) score -= 10;
    }
  }

  return {
    score: clamp(score, 0, 100),
    available: true,
    rationale: `Liquidité estimée selon le type de bien (${input.assetType}) et la surface.`,
    signals: [],
    riskFlags: [],
  };
}

/** Risque : 100 = risque faible. Pénalise l'incomplétude et l'incohérence. */
export function computeRiskScore(
  input: OpportunityInput,
  pluContext?: ResolvePluContextResult,
): PillarComputation {
  let score = 100;
  const riskFlags: OpportunityRiskFlag[] = [];

  if (input.askingPrice == null) {
    score -= 25;
    riskFlags.push({ code: 'MISSING_PRICE', label: 'Prix demandé manquant' });
  }

  if (input.livingArea == null && input.landArea == null) {
    score -= 20;
    riskFlags.push({ code: 'MISSING_AREA', label: 'Aucune surface renseignée' });
  }

  if (input.assetType === 'unknown') {
    score -= 10;
    riskFlags.push({ code: 'UNKNOWN_ASSET_TYPE', label: 'Type de bien non précisé' });
  }

  if (input.askingPrice != null && input.livingArea != null && input.livingArea > 0) {
    const ppsqm = input.askingPrice / input.livingArea;
    if (ppsqm > 20000) {
      score -= 10;
      riskFlags.push({
        code: 'PRICE_OUTLIER_HIGH',
        label: 'Prix au m² très élevé',
        detail: fmtEur(ppsqm) + '/m²',
      });
    } else if (ppsqm < 300) {
      score -= 10;
      riskFlags.push({
        code: 'PRICE_OUTLIER_LOW',
        label: 'Prix au m² anormalement bas',
        detail: fmtEur(ppsqm) + '/m²',
      });
    }
  }

  if (pluContext && pluContext.pluStatus === 'PLU_FAILED') {
    score -= 5;
    riskFlags.push({ code: 'PLU_FAILED', label: 'Échec de résolution PLU' });
  }

  return {
    score: clamp(score, 0, 100),
    available: true,
    rationale: 'Score de risque (100 = risque faible) basé sur la complétude et la cohérence des données.',
    signals: [],
    riskFlags,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rentabilité locative — loyer de marché départemental → rendement brut.
// Barème €/m²/mois (moyennes Clameur/SeLoger). Cohérent avec SmartScore.
// Repli national 11 €/m². À remplacer par un observatoire des loyers plus tard.
// ─────────────────────────────────────────────────────────────────────────────
const LOYER_MEDIAN_PAR_DEPT: Record<string, number> = {
  '75': 30.0, '92': 22.0, '93': 18.0, '94': 18.5, '77': 14.0, '78': 16.0,
  '91': 14.0, '95': 14.5, '69': 14.5, '13': 14.0, '33': 13.0, '31': 12.5,
  '44': 12.5, '59': 12.0, '67': 12.5, '06': 17.0, '34': 13.5, '35': 11.5,
  '38': 11.0, '76': 11.0, '83': 13.0, '54': 10.5, '57': 10.0, '63': 10.5,
  '45': 10.5, '37': 11.0, '49': 10.5, '29': 10.0, '56': 10.0, '14': 10.5,
  '21': 10.5, '25': 10.0, '68': 10.5, '87': 9.0, '86': 9.5, '17': 10.5,
  '64': 11.0, '66': 10.5, '30': 10.5, '84': 10.0,
};
const LOYER_MEDIAN_NATIONAL = 11.0;

/** Rentabilité locative : pertinent pour les biens habitables (pas les terrains). */
export function computeRentabilityScore(input: OpportunityInput): PillarComputation {
  const signals: OpportunitySignal[] = [];
  const price = input.askingPrice;
  const area = input.livingArea ?? null;

  // Non applicable sans surface habitable (ex. terrain) ou sans prix.
  if (price == null || price <= 0 || area == null || area <= 0) {
    return {
      score: null,
      available: false,
      rationale: 'Rentabilité non calculable (prix ou surface habitable manquant).',
      signals,
      riskFlags: [],
    };
  }

  // Garde-fou : prix/m² aberrant -> rendement non fiable, on ne calcule pas.
  if (isImplausiblePriceM2(price / area)) {
    signals.push({
      code: 'PRICE_IMPLAUSIBLE',
      label: 'Prix au m² incohérent — rendement non calculé',
      detail: 'Donnée source probablement erronée (loyer, parking, prix partiel).',
      severity: 'warning',
    });
    return {
      score: null,
      available: false,
      rationale: 'Rentabilité non calculée : prix au m² incohérent (donnée source suspecte).',
      signals,
      riskFlags: [],
    };
  }

  const dept = (input.postalCode ?? '').trim().slice(0, 2);
  const deptRent = dept ? LOYER_MEDIAN_PAR_DEPT[dept] : undefined;
  const loyerM2 = deptRent ?? LOYER_MEDIAN_NATIONAL;
  const source = deptRent != null ? 'departement' : 'national';

  const loyerMensuel = Math.round(loyerM2 * area);
  const loyerAnnuel = loyerMensuel * 12;
  const grossYield = Math.round((loyerAnnuel / price) * 1000) / 10; // %
  // Rendement net indicatif (charges, taxe foncière, vacance ~ -25 %).
  const netYieldIndic = Math.round(grossYield * 0.75 * 10) / 10;

  let score: number;
  if (grossYield >= 8) score = 95;
  else if (grossYield >= 7) score = 85;
  else if (grossYield >= 5) score = 70;
  else if (grossYield >= 4) score = 55;
  else if (grossYield >= 3) score = 40;
  else if (grossYield >= 2) score = 25;
  else score = 10;

  signals.push({
    code: 'RENT_ESTIMATE',
    label: `Loyer estimé ~${fmtEur(loyerMensuel)}/mois`,
    detail: `${loyerM2.toFixed(1)} €/m²/mois (barème ${source})`,
    severity: 'info',
  });
  signals.push({
    code: 'GROSS_YIELD',
    label: `Rendement brut ${grossYield.toFixed(1)}%`,
    detail: `net indicatif ~${netYieldIndic.toFixed(1)}%`,
    severity: grossYield >= 5 ? 'positive' : grossYield < 3 ? 'warning' : 'info',
  });

  const sourceNote =
    source === 'national'
      ? ' (loyer au barème national, département non couvert)'
      : ' (loyer au barème départemental)';

  return {
    score: clamp(score, 0, 100),
    available: true,
    rationale: `Rendement brut estimé : loyer de marché × surface vs prix demandé${sourceNote}.`,
    signals,
    riskFlags: [],
  };
}

/** Potentiel rénovation : indices de la description + contexte PLU. */
export function computeFuturePotentialScore(
  input: OpportunityInput,
  pluContext?: ResolvePluContextResult,
): PillarComputation {
  const signals: OpportunitySignal[] = [];
  const desc = (input.description ?? '').trim().toLowerCase();
  const hasDescription = desc.length > 0;

  // Sans description ni contexte PLU : aucune base d'évaluation -> en attente.
  if (!hasDescription && !pluContext) {
    return {
      score: null,
      available: false,
      rationale: 'Potentiel non évaluable (description de l’annonce indisponible).',
      signals,
      riskFlags: [],
    };
  }

  let score = 50;

  const matched = unique(REHAB_KEYWORDS.filter((k) => desc.includes(k)));
  if (matched.length > 0) {
    score += Math.min(30, matched.length * 12);
    signals.push({
      code: 'REHAB_POTENTIAL',
      label: 'Potentiel travaux / réhabilitation détecté',
      detail: `Mots-clés : ${matched.join(', ')}`,
      severity: 'positive',
    });
  }

  if (pluContext) {
    if (pluContext.pluStatus === 'PLU_READY') {
      score += 10;
      signals.push({ code: 'PLU_READY', label: 'Contexte PLU disponible', severity: 'positive' });
    } else if (pluContext.pluStatus === 'PLU_PENDING') {
      signals.push({
        code: 'PLU_PENDING',
        label: 'Contexte PLU non disponible',
        detail: pluContext.reason,
        severity: 'info',
      });
    } else if (pluContext.pluStatus === 'PLU_OUTDATED') {
      signals.push({ code: 'PLU_OUTDATED', label: 'PLU potentiellement périmé', severity: 'warning' });
    }
  }

  return {
    score: clamp(score, 0, 100),
    available: true,
    rationale: 'Potentiel rénovation basé sur les indices de la description (et le contexte PLU).',
    signals,
    riskFlags: [],
  };
}

/** Potentiel promoteur : surface terrain + type + charge foncière (PLU en couche 2). */
export function computePromoteurPotentialScore(input: OpportunityInput): PillarComputation {
  const signals: OpportunitySignal[] = [];
  const riskFlags: OpportunityRiskFlag[] = [];
  const land = input.landArea ?? null;

  let score: number;
  if (land == null) {
    score = 20;
    riskFlags.push({
      code: 'NO_LAND_AREA',
      label: 'Surface terrain absente',
      detail: 'Pénalise le potentiel promoteur.',
    });
  } else if (land >= 1000) {
    score = 90;
    signals.push({
      code: 'LARGE_LAND',
      label: 'Grand terrain',
      detail: `${land.toLocaleString('fr-FR')} m²`,
      severity: 'positive',
    });
  } else if (land >= 500) {
    score = 75;
  } else if (land >= 300) {
    score = 60;
  } else if (land >= 150) {
    score = 45;
  } else {
    score = 30;
  }

  if (input.assetType === 'maison' && land != null && land >= 500) {
    score = clamp(score + 8, 0, 100);
    signals.push({ code: 'HOUSE_LARGE_PLOT', label: 'Maison sur grand terrain', severity: 'positive' });
  }

  if (input.assetType === 'terrain' && land != null && land >= 300) {
    score = clamp(score + 5, 0, 100);
    signals.push({ code: 'BUILDABLE_PLOT', label: 'Terrain à fort potentiel', severity: 'positive' });
  }

  // ── Charge foncière brute (prix / surface terrain). Métrique promoteur clé.
  const price = input.askingPrice;
  if (price != null && price > 0 && land != null && land > 0) {
    const chargeFonciere = Math.round(price / land); // €/m² de terrain
    signals.push({
      code: 'CHARGE_FONCIERE',
      label: `Charge foncière ${fmtEur(chargeFonciere)}/m² terrain`,
      detail: 'Prix ÷ surface terrain',
      severity: 'info',
    });

    // Si on a la référence DVF habitable de la zone, on estime la marge foncière :
    // un foncier bien inférieur au prix de revente/m² habitable laisse de la marge.
    const dvfM2 = input.marketRefPriceM2 ?? null;
    if (dvfM2 != null && dvfM2 > 0) {
      const ratio = chargeFonciere / dvfM2; // <1 = foncier sous la valeur habitable
      if (ratio <= 0.3) {
        score = clamp(score + 10, 0, 100);
        signals.push({
          code: 'LAND_MARGIN_HIGH',
          label: 'Charge foncière faible vs valeur de revente',
          detail: `≈ ${Math.round(ratio * 100)}% du prix habitable DVF`,
          severity: 'positive',
        });
      } else if (ratio >= 0.7) {
        score = clamp(score - 12, 0, 100);
        signals.push({
          code: 'LAND_MARGIN_LOW',
          label: 'Charge foncière élevée vs valeur de revente',
          detail: `≈ ${Math.round(ratio * 100)}% du prix habitable DVF`,
          severity: 'warning',
        });
      }
    }
  }

  // PLU : non résolu au scan (pas de parcelle). Renvoyé vers l'analyse approfondie.
  signals.push({
    code: 'PLU_DEFERRED',
    label: 'Faisabilité PLU à confirmer en analyse approfondie',
    detail: 'Zonage et règles (hauteur/emprise/SDP) à vérifier sur la parcelle réelle',
    severity: 'info',
  });

  const available = input.strategy === 'promoteur';

  return {
    score: clamp(score, 0, 100),
    available,
    rationale:
      'Potentiel promoteur : surface terrain, type de bien et charge foncière (PLU à confirmer en analyse approfondie).',
    signals: available ? signals : [],
    riskFlags: available ? riskFlags : [],
  };
}

// -------------------------------------------------------------
// Orchestration
// -------------------------------------------------------------

export async function computeOpportunity(
  input: OpportunityInput,
  options?: { resolvePlu?: boolean },
): Promise<OpportunityResult> {
  // 1) Contexte PLU si code INSEE disponible. Jamais bloquant, et désactivable
  //    (ex. scan en masse tant qu'aucun PLU n'est indexé).
  const shouldResolvePlu = options?.resolvePlu ?? true;
  let pluContext: ResolvePluContextResult | undefined;
  if (shouldResolvePlu && input.codeInsee && input.codeInsee.trim()) {
    try {
      pluContext = await resolvePluContext({
        codeInsee: input.codeInsee.trim(),
        parcelId: input.parcelId,
        address: input.address,
      });
    } catch {
      pluContext = undefined;
    }
  }

  // 2) Piliers.
  const pillars: Record<OpportunityPillarKey, PillarComputation> = {
    market_discount: computeMarketDiscountScore(input),
    location: computeLocationScore(input),
    liquidity: computeLiquidityScore(input),
    risk: computeRiskScore(input, pluContext),
    rentability: computeRentabilityScore(input),
    future_potential: computeFuturePotentialScore(input, pluContext),
    promoteur_potential: computePromoteurPotentialScore(input),
  };

  const weights = STRATEGY_WEIGHTS[input.strategy];
  const pillarKeys = Object.keys(pillars) as OpportunityPillarKey[];

  // 3) Agrégation pondérée sur les piliers contributifs.
  let weightedSum = 0;
  let weightUsed = 0;
  for (const key of pillarKeys) {
    const p = pillars[key];
    const w = weights[key];
    if (p.available && p.score != null && w > 0) {
      weightedSum += p.score * w;
      weightUsed += w;
    }
  }
  let scoreTotal = weightUsed > 0 ? weightedSum / weightUsed : 0;

  // 4) Breakdown.
  const breakdown: OpportunityScoreBreakdown = pillarKeys
    .filter((key) => weights[key] > 0)
    .map((key) => {
      const p = pillars[key];
      const w = weights[key];
      return {
        key,
        label: PILLAR_LABELS[key],
        score: p.score,
        weight: w,
        available: p.available && w > 0,
        rationale: p.rationale,
      };
    });

  // 5) Signaux & risques agrégés.
  const signals: OpportunitySignal[] = [];
  const riskFlags: OpportunityRiskFlag[] = [];
  for (const key of pillarKeys) {
    signals.push(...pillars[key].signals);
    riskFlags.push(...pillars[key].riskFlags);
  }

  // Signal PLU_PENDING si INSEE fourni mais résolution indisponible.
  if (input.codeInsee && input.codeInsee.trim() && !pluContext) {
    signals.push({
      code: 'PLU_PENDING',
      label: 'Contexte PLU non disponible',
      detail: 'Résolution PLU indisponible',
      severity: 'info',
    });
  }

  // Dédoublonnage des signaux par code (garde le premier).
  const dedupedSignals = signals.filter(
    (s, i, arr) => arr.findIndex((x) => x.code === s.code) === i,
  );

  // 6) Pénalité données clés manquantes.
  const missingCore =
    input.askingPrice == null || (input.livingArea == null && input.landArea == null);
  if (missingCore) {
    scoreTotal *= 0.7;
    if (!riskFlags.some((r) => r.code === 'MISSING_PRICE' || r.code === 'MISSING_AREA')) {
      riskFlags.push({ code: 'MISSING_CORE_DATA', label: 'Données clés manquantes (prix/surface)' });
    }
  }
  scoreTotal = Math.round(clamp(scoreTotal, 0, 100));

  // 7) Confiance (émerge de la couverture des piliers).
  let confidence: OpportunityConfidence;
  if (missingCore || weightUsed < 0.5) confidence = 'low';
  else if (weightUsed < 0.8) confidence = 'medium';
  else confidence = 'high';

  // 8) Assemblage.
  const result: OpportunityResult = {
    input,
    scoreTotal,
    scoreLabel: getOpportunityScoreLabel(scoreTotal),
    recommendation: {
      action: 'WATCH',
      headline: '',
      rationale: [],
      nextSteps: [],
    },
    breakdown,
    signals: dedupedSignals,
    riskFlags,
    pluContext,
    confidence,
    computedAt: new Date().toISOString(),
  };

  result.recommendation = buildOpportunityRecommendation(result);
  return result;
}

// -------------------------------------------------------------
// Recommandation & label
// -------------------------------------------------------------

function recommendationHeadline(action: OpportunityRecommendationAction): string {
  switch (action) {
    case 'GO':
      return 'Opportunité à étudier en priorité';
    case 'GO_CONDITIONAL':
      return 'Opportunité intéressante sous conditions';
    case 'WATCH':
      return 'À surveiller / compléter avant décision';
    case 'PASS':
    default:
      return 'Opportunité peu prioritaire en l’état';
  }
}

export function buildOpportunityRecommendation(result: OpportunityResult): OpportunityRecommendation {
  const { scoreTotal, confidence, riskFlags, input } = result;

  let action: OpportunityRecommendationAction;
  if (scoreTotal >= 65 && confidence !== 'low') action = 'GO';
  else if (scoreTotal >= 50) action = confidence === 'low' ? 'WATCH' : 'GO_CONDITIONAL';
  else if (scoreTotal >= 35) action = 'WATCH';
  else action = 'PASS';

  const rationale: string[] = [
    `Score global ${scoreTotal}/100 (${result.scoreLabel.toLowerCase()}).`,
    `Niveau de confiance : ${confidenceLabel(confidence)}.`,
  ];
  if (riskFlags.length > 0) {
    rationale.push(`${riskFlags.length} point(s) de vigilance identifié(s).`);
  }

  const nextSteps: string[] = [];

  // Complétude des données.
  if (confidence === 'low') {
    nextSteps.push('Compléter les données manquantes (prix, surface) pour fiabiliser le score.');
  }

  // Position marché (décote/surcote) -> action concrète.
  const marketSignal = result.signals.find(
    (s) => s.code === 'MARKET_PREMIUM' || s.code === 'MARKET_DISCOUNT',
  );
  if (marketSignal?.code === 'MARKET_PREMIUM') {
    nextSteps.push(`Négocier le prix : ${marketSignal.label.toLowerCase()} (réf. DVF).`);
  } else if (marketSignal?.code === 'MARKET_DISCOUNT') {
    nextSteps.push('Vérifier ce qui explique la décote (état, étage, DPE, exposition).');
  }

  // Action spécifique à la stratégie.
  if (input.strategy === 'promoteur') {
    nextSteps.push('Vérifier la constructibilité (PLU/OAP) et lancer le bilan promoteur.');
  } else if (input.strategy === 'rehabilitateur') {
    nextSteps.push('Chiffrer les travaux et estimer la valeur après rénovation.');
  } else {
    const yieldSignal = result.signals.find((s) => s.code === 'GROSS_YIELD');
    if (yieldSignal) {
      nextSteps.push(`Affiner le rendement (${yieldSignal.label.toLowerCase()}) avec le loyer réel et les charges.`);
    } else {
      nextSteps.push('Estimer le loyer de marché et calculer le rendement net.');
    }
  }

  // Action de qualification, toujours utile.
  nextSteps.push('Contacter l’annonce : demander DPE, charges et diagnostics.');

  return { action, headline: recommendationHeadline(action), rationale, nextSteps };
}

export function getOpportunityScoreLabel(score: number): string {
  if (score >= 80) return 'Excellente opportunité';
  if (score >= 65) return 'Bonne opportunité';
  if (score >= 50) return 'Opportunité moyenne';
  if (score >= 35) return 'Opportunité faible';
  return 'Opportunité très faible';
}