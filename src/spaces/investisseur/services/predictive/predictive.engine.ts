import type {
  PredictiveAnalysisSnapshot,
  PredictiveDataSource,
  PredictiveDriver,
  PredictiveEngineInput,
  PredictiveFiscalite,
  PredictiveGeorisques,
  PredictiveMarketRegime,
  PredictivePlu,
  PredictivePoint,
} from "./predictive.types";

// ── Helpers ────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function deptFromCp(cp: string): number {
  return parseInt(cp.slice(0, 2), 10) || 75;
}

function norm100(v: number | undefined): number | undefined {
  if (v == null || !Number.isFinite(v)) return undefined;
  if (v >= 0 && v <= 1) return Math.round(v * 100);
  return clamp(Math.round(v), 0, 100);
}

// ── V2 : DPE adjustment ────────────────────────────────────────────────────
// Décote/surcote appliquée au spot prix en fonction de la classe énergétique.
// Source : études notariales + impact réglementation RE2020 / interdictions location.

function resolveDpeAdjustment(dpe?: string): {
  factor: number;
  label: string;
  hasDpe: boolean;
} {
  if (!dpe) return { factor: 0, label: "DPE non renseigné", hasDpe: false };
  switch (dpe.toUpperCase()) {
    case "A": return { factor: 0.06, label: "Classe A — surcote énergétique +6%", hasDpe: true };
    case "B": return { factor: 0.03, label: "Classe B — légère surcote +3%", hasDpe: true };
    case "C": return { factor: 0.00, label: "Classe C — référence neutre", hasDpe: true };
    case "D": return { factor: -0.03, label: "Classe D — décote légère -3%", hasDpe: true };
    case "E": return { factor: -0.07, label: "Classe E — décote significative -7%", hasDpe: true };
    case "F": return { factor: -0.12, label: "Classe F — passoire thermique -12%", hasDpe: true };
    case "G": return { factor: -0.18, label: "Classe G — passoire thermique -18%", hasDpe: true };
    default:  return { factor: 0, label: `DPE ${dpe} — non reconnu`, hasDpe: false };
  }
}

// ── V2 : Géorisques adjustment ────────────────────────────────────────────
// Décote cumulée plafonnée à -15%.

function resolveGeorisquesAdjustment(georisques?: PredictiveGeorisques): {
  factor: number;
  risques: string[];
  hasData: boolean;
} {
  if (!georisques) return { factor: 0, risques: [], hasData: false };

  let factor = 0;
  const risques: string[] = [];

  if (georisques.inondation) {
    factor -= 0.07;
    risques.push("inondation (-7%)");
  }
  if (georisques.sismique != null && georisques.sismique >= 3) {
    const deduction = georisques.sismique >= 4 ? 0.05 : 0.03;
    factor -= deduction;
    risques.push(`sismicité zone ${georisques.sismique} (-${deduction * 100}%)`);
  }
  if (georisques.retraitGonflement) {
    factor -= 0.02;
    risques.push("retrait argileux (-2%)");
  }
  if (georisques.mouvementTerrain) {
    factor -= 0.04;
    risques.push("mouvement de terrain (-4%)");
  }
  if (georisques.cavites) {
    factor -= 0.03;
    risques.push("cavités souterraines (-3%)");
  }
  if (georisques.radon != null && georisques.radon >= 3) {
    factor -= 0.01;
    risques.push("radon potentiel élevé (-1%)");
  }

  // Plafond cumulé à -15%
  factor = Math.max(factor, -0.15);

  return { factor, risques, hasData: true };
}

// ── V2 : PLU adjustment ───────────────────────────────────────────────────
// Affecte la valeur foncière (pondéré à 25% sur le spot bâti).

function resolvePluAdjustment(plu?: PredictivePlu): {
  factor: number;
  label: string;
  hasData: boolean;
} {
  if (!plu?.zone) return { factor: 0, label: "PLU non renseigné", hasData: false };

  const zone = plu.zone.toUpperCase().trim();
  const cosBonus = plu.cos != null && plu.cos >= 1 ? 0.02 : 0;

  if (/^UA/.test(zone) || /^UB/.test(zone)) {
    return { factor: 0.08, label: `Zone ${plu.zone} — urbaine dense, fort potentiel constructible (+8%)`, hasData: true };
  }
  if (/^U/.test(zone) && !/^AU/.test(zone)) {
    return { factor: 0.04 + cosBonus, label: `Zone ${plu.zone} — constructible (+${Math.round((0.04 + cosBonus) * 100)}%)`, hasData: true };
  }
  if (/^AU/.test(zone)) {
    return { factor: 0.03, label: `Zone ${plu.zone} — à urbaniser (+3%)`, hasData: true };
  }
  if (/^[NA]/.test(zone)) {
    return { factor: -0.02, label: `Zone ${plu.zone} — non constructible (-2%)`, hasData: true };
  }

  return { factor: 0, label: `Zone ${plu.zone}`, hasData: true };
}

// ── V2 : Fiscalité ────────────────────────────────────────────────────────
// Retourne un bonus/malus en points de marge (impact sur rendement net).

function resolveFiscalImpact(
  fiscalite?: PredictiveFiscalite,
  rendementBrut?: number
): { bonus: number; label: string; hasData: boolean } {
  if (!fiscalite?.regime) return { bonus: 0, label: "Fiscalité non renseignée", hasData: false };

  const tmi = fiscalite.tauxMarginalImposition ?? 30;

  switch (fiscalite.regime) {
    case "lmnp_reel":
      // Amortissements permettent de neutraliser l'imposition sur plusieurs années
      return { bonus: 15, label: `LMNP réel — amortissements, fiscalité neutralisée (TMI ${tmi}%)`, hasData: true };

    case "lmnp_micro": {
      // Abattement 50%, rentable si TMI ≤ 30
      const efficace = tmi <= 30;
      return {
        bonus: efficace ? 8 : 3,
        label: `LMNP micro-BIC — abattement 50%, ${efficace ? "efficace" : "limité"} à TMI ${tmi}%`,
        hasData: true,
      };
    }

    case "pinel":
      // Réduction d'impôt sur prix de revient (neuf)
      return { bonus: 20, label: "Pinel — réduction impôt sur investissement neuf", hasData: true };

    case "nu": {
      // Revenus fonciers : imposition lourde selon TMI
      const impact = tmi >= 41 ? -10 : tmi >= 30 ? -5 : 0;
      return {
        bonus: impact,
        label: `Location nue — revenus fonciers, TMI ${tmi}% (${impact <= -5 ? "impact négatif" : "neutre"})`,
        hasData: true,
      };
    }

    case "sci_ir":
      return { bonus: -3, label: `SCI à l'IR — transparence fiscale, impact TMI ${tmi}%`, hasData: true };

    case "sci_is":
      // Taux IS 15%/25% souvent favorable pour capitalisation
      return { bonus: 10, label: "SCI à l'IS — taux IS favorable, réinvestissement possible", hasData: true };

    default:
      return { bonus: 0, label: `Régime ${fiscalite.regime}`, hasData: true };
  }
}

// ── Spot price : DVF réel > acquisition fallback — V2 avec corrections ────
// DPE + Géorisques ajustent le spot. PLU pondéré à 25% (valeur foncière).

function resolveSpotPsm(input: PredictiveEngineInput): {
  spotPsm: number;
  rawSpotPsm: number;
  source: "dvf" | "acquisition";
  confidence: number;
} {
  const dvfMedian = input.dvf?.prixM2Median;
  const source: "dvf" | "acquisition" = dvfMedian != null && dvfMedian > 0 ? "dvf" : "acquisition";
  const rawPsm =
    source === "dvf"
      ? Math.round(dvfMedian!)
      : input.surfaceM2 > 0
      ? Math.round(input.acquisitionPrice / input.surfaceM2)
      : 0;
  const confidence = source === "dvf" ? 85 : 55;

  // Corrections V2
  const { factor: dpeFactor }        = resolveDpeAdjustment(input.dpe);
  const { factor: georisquesFactor } = resolveGeorisquesAdjustment(input.georisques);
  const { factor: pluFactor }        = resolvePluAdjustment(input.plu);

  // PLU pondéré à 25% (bâti existant ≠ terrain nu)
  const totalAdjustment = dpeFactor + georisquesFactor + pluFactor * 0.25;
  const spotPsm = Math.round(rawPsm * (1 + totalAdjustment));

  return { spotPsm, rawSpotPsm: rawPsm, source, confidence };
}

// ── Market regime ────────────────────────────────────────────────────────
// V2 : la démographie dégrade le régime si territoire en décroissance.

function resolveRegime(input: PredictiveEngineInput): PredictiveMarketRegime {
  const scores = input.marketScores;
  if (!scores?.global) {
    const dept = deptFromCp(input.codePostal);
    if ([75, 92, 69, 31, 33].includes(dept)) return "hausse";
    if ([93, 94, 78, 44, 67, 59, 34, 6, 13].includes(dept)) return "reprise";
    return "plateau";
  }
  const g = norm100(scores.global) ?? 50;

  // V2 : démographie faible tire le régime vers le bas
  const demo = input.demographieScore;
  if (demo != null && demo < 30 && g < 65) {
    if (g >= 60) return "plateau";
    if (g >= 40) return "correction";
  }

  if (g >= 75) return "hausse";
  if (g >= 60) return "reprise";
  if (g >= 40) return "plateau";
  return "correction";
}

// ── Market scores ─────────────────────────────────────────────────────────
// V2 : loyer médian enrichit la liquidité, géorisques dégradent le riskScore.

function resolveMarketScores(input: PredictiveEngineInput): {
  pressureScore: number;
  liquidityScore: number;
  riskScore: number;
} {
  const ms  = input.marketScores;
  const dept = deptFromCp(input.codePostal);

  const pressureScore = norm100(ms?.demande)
    ?? norm100(ms?.global)
    ?? clamp(Math.round(60 + (dept <= 75 ? 20 : dept <= 69 ? 10 : 0)), 30, 95);

  let liquidityScore = norm100(ms?.liquidite)
    ?? norm100(ms?.demande)
    ?? clamp(Math.round(55 + (dept <= 92 ? 15 : 0)), 25, 95);

  // Loyer médian disponible → ancrage locatif fiable → bonus liquidité
  if (input.loyerMedianZone && input.loyerMedianZone > 0) {
    liquidityScore = clamp(liquidityScore + 5, 25, 98);
  }

  const baseRisk = norm100(ms?.pressionRisque)
    ?? norm100(ms?.environnement)
    ?? clamp(Math.round(100 - pressureScore * 0.5 - liquidityScore * 0.2), 15, 75);

  // Géorisques : chaque risque identifié pénalise le riskScore de 5 pts
  const { risques } = resolveGeorisquesAdjustment(input.georisques);
  const riskScore = clamp(baseRisk + risques.length * 5, 15, 92);

  return { pressureScore, liquidityScore, riskScore };
}

// ── Forecast rates V2 ────────────────────────────────────────────────────
// Horizons étendus 36m / 60m.
// Ajustements : démographie, Sitadel, DPE long-terme (décote réglementaire).

function resolveForecastRates(input: PredictiveEngineInput): {
  rate6: number; rate12: number; rate18: number; rate24: number;
  rate36: number; rate60: number;
  rateSource: "dvf_evolution" | "market_scores" | "heuristic";
} {
  // 1) Base annualRate
  let annualRate: number;
  let rateSource: "dvf_evolution" | "market_scores" | "heuristic";

  const dvfEvol = input.dvf?.evolutionPctAnnuelle;
  const g = norm100(input.marketScores?.global);

  if (dvfEvol != null && Number.isFinite(dvfEvol)) {
    annualRate = dvfEvol / 100;
    rateSource = "dvf_evolution";
  } else if (g != null) {
    // Score 0-100 → taux annuel entre -3% et +8%
    annualRate = ((g - 40) / 60) * 0.08;
    rateSource = "market_scores";
  } else {
    const dept = deptFromCp(input.codePostal);
    annualRate = [75, 92].includes(dept) ? 0.035
      : [69, 31, 33, 44, 67, 59, 34, 6, 13, 93, 94].includes(dept) ? 0.025
      : 0.015;
    rateSource = "heuristic";
  }

  // 2) V2 — Ajustements structurels sur annualRate

  // Démographie : -1% à +1% sur le taux annuel
  if (input.demographieScore != null) {
    annualRate += ((input.demographieScore - 50) / 50) * 0.01;
  }

  // Sitadel : forte construction = pression baissière sur les prix futurs
  if (input.sitadelConcurrence != null) {
    annualRate -= ((input.sitadelConcurrence - 50) / 100) * 0.005;
  }

  // 3) DPE : les passoires ont une décote croissante sur les horizons longs
  //    (interdictions progressives de location + obligation de rénovation)
  const { factor: dpeFactor } = resolveDpeAdjustment(input.dpe);
  const dpePenaltyLongTerm = dpeFactor < 0 ? Math.abs(dpeFactor) * 0.1 : 0;

  return {
    rate6:  annualRate * 0.5,
    rate12: annualRate,
    rate18: annualRate * 1.40 - dpePenaltyLongTerm * 0.5,
    rate24: annualRate * 1.75 - dpePenaltyLongTerm * 1.0,
    rate36: annualRate * 2.50 - dpePenaltyLongTerm * 2.0,
    rate60: annualRate * 3.80 - dpePenaltyLongTerm * 4.0,
    rateSource,
  };
}

// ── Build forecast point ──────────────────────────────────────────────────
// V2 : décroissance de confiance ralentie (1.5 pt/mois au lieu de 2).

function buildPoint(
  spotPsm: number,
  surface: number,
  rate: number,
  months: number,
  baseConfidence: number
): PredictivePoint {
  const projected = spotPsm * (1 + rate);
  return {
    pricePerSqm:     Math.round(projected),
    marketValue:     Math.round(projected * surface),
    deltaPercent:    parseFloat((rate * 100).toFixed(1)),
    confidenceScore: clamp(Math.round(baseConfidence - months * 1.5), 25, 95),
  };
}

// ── Drivers V2 ───────────────────────────────────────────────────────────

function buildDrivers(input: PredictiveEngineInput): PredictiveDriver[] {
  const ms   = input.marketScores;
  const dvf  = input.dvf;
  const bpe  = input.bpe;
  const dept = deptFromCp(input.codePostal);
  const drivers: PredictiveDriver[] = [];

  // ── DVF ────────────────────────────────────────────────────────────────

  if (dvf?.nbTransactions != null) {
    const active = dvf.nbTransactions >= 50;
    drivers.push({
      key: "dvf_volume",
      label: "Volume DVF",
      direction: active ? "positive" : "negative",
      impact: active ? 70 : 55,
      description: active
        ? `${dvf.nbTransactions} transactions récentes — marché actif, bonne liquidité.`
        : `${dvf.nbTransactions} transactions récentes — marché peu liquide, délai de vente allongé.`,
    });
  }

  if (dvf?.evolutionPctAnnuelle != null) {
    const evol = dvf.evolutionPctAnnuelle;
    drivers.push({
      key: "dvf_evolution",
      label: "Tendance prix DVF",
      direction: evol > 1 ? "positive" : evol < -1 ? "negative" : "neutral",
      impact: clamp(Math.round(Math.abs(evol) * 10), 20, 80),
      description: `Évolution annuelle des prix : ${evol >= 0 ? "+" : ""}${evol.toFixed(1)}% (source DVF).`,
    });
  }

  if (dvf?.prixM2Median != null && input.surfaceM2 > 0) {
    const acqPsm  = input.acquisitionPrice / input.surfaceM2;
    const ecartPct = ((dvf.prixM2Median - acqPsm) / acqPsm) * 100;
    if (Math.abs(ecartPct) > 3) {
      drivers.push({
        key: "dvf_ecart_prix",
        label: "Écart prix vs marché DVF",
        direction: ecartPct > 0 ? "positive" : "negative",
        impact: clamp(Math.round(Math.abs(ecartPct) * 3), 25, 85),
        description: ecartPct > 0
          ? `Prix d'achat ${Math.abs(ecartPct).toFixed(0)}% sous le marché DVF — potentiel de plus-value.`
          : `Prix d'achat ${Math.abs(ecartPct).toFixed(0)}% au-dessus du marché DVF — marge comprimée.`,
      });
    }
  }

  // ── V2 : DPE ───────────────────────────────────────────────────────────

  const { factor: dpeFactor, label: dpeLabel, hasDpe } = resolveDpeAdjustment(input.dpe);
  if (hasDpe) {
    const dpeClass = input.dpe!.toUpperCase();
    const isPassoire = ["F", "G"].includes(dpeClass);
    drivers.push({
      key: "dpe",
      label: `DPE Classe ${dpeClass} — Performance énergétique`,
      direction: dpeFactor > 0 ? "positive" : dpeFactor < -0.05 ? "negative" : "neutral",
      impact: clamp(Math.round(Math.abs(dpeFactor) * 200), 15, 85),
      description: isPassoire
        ? `${dpeLabel}. Obligations de rénovation post-2025 (interdiction location classe G) — impact fort sur valorisation et liquidité.`
        : `${dpeLabel}.`,
    });
  }

  // ── V2 : Géorisques ────────────────────────────────────────────────────

  const { factor: georisquesFactor, risques, hasData: hasGeorisques } = resolveGeorisquesAdjustment(input.georisques);
  if (hasGeorisques) {
    if (risques.length > 0) {
      drivers.push({
        key: "georisques",
        label: "Exposition aux risques naturels",
        direction: "negative",
        impact: clamp(Math.round(Math.abs(georisquesFactor) * 200), 20, 80),
        description: `Risques identifiés : ${risques.join(", ")}. Décote marché appliquée : ${Math.round(Math.abs(georisquesFactor) * 100)}%.`,
      });
    } else {
      drivers.push({
        key: "georisques",
        label: "Exposition aux risques naturels",
        direction: "positive",
        impact: 25,
        description: "Aucun risque naturel majeur identifié — facteur de sécurité pour l'acquéreur.",
      });
    }
  }

  // ── V2 : PLU ───────────────────────────────────────────────────────────

  const { factor: pluFactor, label: pluLabel, hasData: hasPlu } = resolvePluAdjustment(input.plu);
  if (hasPlu) {
    drivers.push({
      key: "plu",
      label: `PLU — Zone ${input.plu!.zone}`,
      direction: pluFactor > 0 ? "positive" : pluFactor < 0 ? "negative" : "neutral",
      impact: clamp(Math.round(Math.abs(pluFactor) * 150), 15, 75),
      description:
        pluLabel +
        (input.plu?.hauteurMax ? ` Hauteur max : ${input.plu.hauteurMax} m.` : "") +
        (input.plu?.cos ? ` COS : ${input.plu.cos}.` : ""),
    });
  }

  // ── V2 : Loyer médian ─────────────────────────────────────────────────

  if (input.loyerMedianZone && input.loyerMedianZone > 0 && input.surfaceM2 > 0) {
    const loyerAnnuel     = input.loyerMedianZone * 12 * input.surfaceM2;
    const totalCostLocal  = input.acquisitionPrice + (input.travauxEstime ?? 0) + (input.fraisAnnexes ?? 0);
    const rdtTheorique    = totalCostLocal > 0 ? (loyerAnnuel / totalCostLocal) * 100 : 0;
    const rdtExistant     = input.rentabilite?.rendementBrut;

    drivers.push({
      key: "loyer_median",
      label: "Loyer médian de zone",
      direction: rdtTheorique >= 5 ? "positive" : rdtTheorique >= 3 ? "neutral" : "negative",
      impact: clamp(Math.round(rdtTheorique * 8), 20, 75),
      description: rdtExistant != null
        ? `Loyer médian ${input.loyerMedianZone} €/m²/mois → rendement théorique ${rdtTheorique.toFixed(1)}% vs ${rdtExistant.toFixed(1)}% calculé.`
        : `Loyer médian de zone : ${input.loyerMedianZone} €/m²/mois → rendement brut théorique : ${rdtTheorique.toFixed(1)}%.`,
    });
  }

  // ── V2 : Démographie ──────────────────────────────────────────────────

  if (input.demographieScore != null) {
    const demo = clamp(Math.round(input.demographieScore), 0, 100);
    drivers.push({
      key: "demographie",
      label: "Dynamique démographique",
      direction: demo >= 60 ? "positive" : demo >= 40 ? "neutral" : "negative",
      impact: clamp(Math.round(demo * 0.6), 15, 60),
      description:
        demo >= 70
          ? `Score démographie ${demo}/100 — croissance de population soutenue, attractivité territoriale forte.`
          : demo >= 50
          ? `Score démographie ${demo}/100 — évolution démographique stable.`
          : `Score démographie ${demo}/100 — décroissance ou stagnation — risque sur la demande long terme.`,
    });
  }

  // ── V2 : Sitadel / concurrence future ─────────────────────────────────

  if (input.sitadelConcurrence != null) {
    const sitadel       = clamp(Math.round(input.sitadelConcurrence), 0, 100);
    const isHighPressure = sitadel >= 65;
    const isLowPressure  = sitadel <= 35;
    drivers.push({
      key: "sitadel_concurrence",
      label: "Concurrence constructive (Sitadel)",
      direction: isHighPressure ? "negative" : isLowPressure ? "positive" : "neutral",
      impact: clamp(Math.round(Math.abs(sitadel - 50) * 0.8), 10, 55),
      description: isHighPressure
        ? `Score Sitadel ${sitadel}/100 — forte activité constructive, risque de concurrence accrue sur les prix futurs.`
        : isLowPressure
        ? `Score Sitadel ${sitadel}/100 — peu de nouvelles constructions, offre contrainte — soutien aux prix.`
        : `Score Sitadel ${sitadel}/100 — pression constructive modérée.`,
    });
  }

  // ── V2 : Fiscalité ────────────────────────────────────────────────────

  const { bonus: fiscalBonus, label: fiscalLabel, hasData: hasFiscal } = resolveFiscalImpact(
    input.fiscalite,
    input.rentabilite?.rendementBrut
  );
  if (hasFiscal) {
    drivers.push({
      key: "fiscalite",
      label: "Régime fiscal",
      direction: fiscalBonus >= 10 ? "positive" : fiscalBonus >= 0 ? "neutral" : "negative",
      impact: clamp(Math.abs(fiscalBonus) + 15, 15, 70),
      description: fiscalLabel,
    });
  }

  // ── Scores marché ─────────────────────────────────────────────────────

  if (ms?.demande != null) {
    const d = norm100(ms.demande) ?? 50;
    drivers.push({
      key: "demande_marche",
      label: "Demande locative / achat",
      direction: d >= 65 ? "positive" : d >= 40 ? "neutral" : "negative",
      impact: clamp(d, 20, 85),
      description: `Score demande : ${d}/100 — ${d >= 65 ? "forte pression, délais courts" : d >= 40 ? "demande standard" : "demande faible, risque vacance"}.`,
    });
  }

  if (ms?.offre != null) {
    const o = norm100(ms.offre) ?? 50;
    drivers.push({
      key: "offre_marche",
      label: "Tension offre",
      direction: o >= 60 ? "positive" : o >= 40 ? "neutral" : "negative",
      impact: clamp(o, 20, 75),
      description: `Score offre : ${o}/100 — ${o >= 60 ? "offre restreinte, soutient les prix" : "offre suffisante"}.`,
    });
  }

  // ── BPE ───────────────────────────────────────────────────────────────

  if (bpe?.score != null) {
    const b = norm100(bpe.score) ?? 50;
    drivers.push({
      key: "bpe_equipements",
      label: "Équipements & cadre de vie",
      direction: b >= 60 ? "positive" : b >= 40 ? "neutral" : "negative",
      impact: clamp(Math.round(b * 0.7), 15, 60),
      description: `BPE Score ${b}/100 — ${b >= 60 ? "cadre de vie attractif" : "équipements limités"}.`,
    });
  }

  // ── Travaux ───────────────────────────────────────────────────────────

  if (input.travauxEstime && input.travauxEstime > 1000) {
    const travauxPct = input.travauxEstime / input.acquisitionPrice;
    const fmtTravaux = input.travauxEstime.toLocaleString("fr-FR") + " €";
    drivers.push({
      key: "travaux",
      label: "Travaux de valorisation",
      direction: "positive",
      impact: clamp(Math.round(travauxPct * 180), 20, 75),
      description: `Budget travaux : ${fmtTravaux} (${Math.round(travauxPct * 100)}% du prix d'achat) — source : Exécution › Simulation.`,
    });
  }

  // ── BCE / Crédit ──────────────────────────────────────────────────────

  const ecb = input.ecbAnalysis;
  if (ecb) {
    const trendLabel = ecb.trend === "hausse" ? "en hausse" : ecb.trend === "baisse" ? "en baisse" : "stables";
    drivers.push({
      key: "pression_credit_bce",
      label: `Pression crédit BCE — ${ecb.pressureLabel}`,
      direction: ecb.pressureScore >= 60 ? "positive" : ecb.pressureScore >= 40 ? "neutral" : "negative",
      impact: Math.round(100 - ecb.pressureScore * 0.6),
      description: ecb.interpretation,
    });
  } else if (input.tauxBcePct != null) {
    const taux     = input.tauxBcePct;
    const isHigh   = taux >= 3;
    const isMedium = taux >= 2;
    drivers.push({
      key: "pression_credit_bce",
      label: `Pression crédit BCE — refi ${taux.toFixed(1)}%`,
      direction: isHigh ? "negative" : isMedium ? "neutral" : "positive",
      impact: isHigh ? 65 : isMedium ? 45 : 30,
      description: isHigh
        ? `Taux de refinancement à ${taux.toFixed(1)}% — freine la capacité d'emprunt et pèse sur la demande.`
        : isMedium
        ? `Taux de refinancement à ${taux.toFixed(1)}% — impact modéré sur la solvabilité.`
        : `Taux de refinancement à ${taux.toFixed(1)}% — conditions favorables, soutien à la demande.`,
    });
  }

  // ── Emploi local (fallback si pas de scores ni démographie) ──────────

  if (!ms?.demande && input.demographieScore == null) {
    const dynamique = [75, 92, 69, 31, 44, 67, 59, 13].includes(dept);
    drivers.push({
      key: "emploi_local",
      label: "Bassin d'emploi",
      direction: dynamique ? "positive" : "neutral",
      impact: dynamique ? 50 : 30,
      description: dynamique ? "Bassin d'emploi dynamique — attractivité forte." : "Bassin d'emploi standard.",
    });
  }

  return drivers.sort((a, b) => b.impact - a.impact);
}

// ── Data sources tracking V2 ─────────────────────────────────────────────

function trackSources(input: PredictiveEngineInput, rateSource: string): PredictiveDataSource[] {
  const { risques } = resolveGeorisquesAdjustment(input.georisques);

  return [
    // ── Existants ──────────────────────────────────────────────────────
    {
      key: "dvf_median",
      label: "DVF — prix médian /m²",
      available: input.dvf?.prixM2Median != null,
      detail: input.dvf?.prixM2Median ? `${input.dvf.prixM2Median.toLocaleString("fr-FR")} €/m²` : undefined,
    },
    {
      key: "dvf_transactions",
      label: "DVF — volume transactions",
      available: input.dvf?.nbTransactions != null,
      detail: input.dvf?.nbTransactions ? `${input.dvf.nbTransactions} transactions` : undefined,
    },
    {
      key: "dvf_evolution",
      label: "DVF — évolution annuelle",
      available: input.dvf?.evolutionPctAnnuelle != null,
      detail: input.dvf?.evolutionPctAnnuelle != null
        ? `${input.dvf.evolutionPctAnnuelle >= 0 ? "+" : ""}${input.dvf.evolutionPctAnnuelle.toFixed(1)}%`
        : undefined,
    },
    {
      key: "market_scores",
      label: "Scores marché (étude)",
      available: input.marketScores?.global != null,
      detail: input.marketScores?.global != null
        ? `Score global ${norm100(input.marketScores.global)}/100`
        : undefined,
    },
    {
      key: "bpe",
      label: "BPE — équipements locaux",
      available: input.bpe?.score != null,
    },
    {
      key: "rentabilite",
      label: "Rentabilité calculée",
      available:
        input.rentabilite?.rendementBrut != null ||
        input.rentabilite?.margeBrute != null ||
        input.rentabilite?.margeBrutePct != null,
      detail: input.rentabilite?.rendementBrut != null
        ? `Rdt brut ${input.rentabilite.rendementBrut.toFixed(1)}%`
        : input.rentabilite?.margeBrutePct != null
        ? `Marge brute ${input.rentabilite.margeBrutePct.toFixed(1)}%`
        : input.rentabilite?.margeBrute != null
        ? `Marge ${input.rentabilite.margeBrute.toLocaleString("fr-FR")} €`
        : undefined,
    },
    {
      key: "forecast_source",
      label: "Source projection",
      available: true,
      detail: rateSource === "dvf_evolution" ? "Tendance DVF réelle"
        : rateSource === "market_scores" ? "Scores marché"
        : "Heuristique locale",
    },
    {
      key: "taux_bce",
      label: "Pression crédit BCE",
      available: input.ecbAnalysis != null || input.tauxBcePct != null,
      detail: input.ecbAnalysis
        ? `${input.ecbAnalysis.pressureLabel} (${input.ecbAnalysis.refinancingRate.toFixed(2)}%, ${input.ecbAnalysis.source === "ecb" ? "API ECB" : "fallback"})`
        : input.tauxBcePct != null ? `${input.tauxBcePct.toFixed(1)}%` : undefined,
    },
    {
      key: "travaux",
      label: "Budget travaux (Simulation)",
      available: input.travauxEstime != null && input.travauxEstime > 1000,
      detail: input.travauxEstime != null && input.travauxEstime > 1000
        ? `${input.travauxEstime.toLocaleString("fr-FR")} €`
        : undefined,
    },
    // ── V2 ─────────────────────────────────────────────────────────────
    {
      key: "dpe",
      label: "DPE — Performance énergétique",
      available: input.dpe != null,
      detail: input.dpe ? `Classe ${input.dpe.toUpperCase()}` : undefined,
    },
    {
      key: "georisques",
      label: "Géorisques",
      available: input.georisques != null,
      detail: input.georisques
        ? risques.length > 0 ? `${risques.length} risque(s) identifié(s)` : "Aucun risque majeur"
        : undefined,
    },
    {
      key: "plu",
      label: "PLU — Zonage",
      available: input.plu?.zone != null,
      detail: input.plu?.zone ? `Zone ${input.plu.zone}` : undefined,
    },
    {
      key: "loyer_median",
      label: "Loyer médian de zone",
      available: input.loyerMedianZone != null,
      detail: input.loyerMedianZone != null ? `${input.loyerMedianZone} €/m²/mois` : undefined,
    },
    {
      key: "demographie",
      label: "Score démographie INSEE",
      available: input.demographieScore != null,
      detail: input.demographieScore != null ? `${Math.round(input.demographieScore)}/100` : undefined,
    },
    {
      key: "sitadel",
      label: "Sitadel — concurrence constructive",
      available: input.sitadelConcurrence != null,
      detail: input.sitadelConcurrence != null ? `${Math.round(input.sitadelConcurrence)}/100` : undefined,
    },
    {
      key: "fiscalite",
      label: "Régime fiscal",
      available: input.fiscalite?.regime != null,
      detail: input.fiscalite?.regime,
    },
    {
      key: "horizon_detention",
      label: "Horizon de détention",
      available: input.horizonDetention != null,
      detail: input.horizonDetention != null ? `${input.horizonDetention} mois` : undefined,
    },
  ];
}

// ── Utilitaire : valeur au bon horizon ────────────────────────────────────

function getScenarioAtHorizon(obj: Record<string, number>, months: number): number {
  if (months <= 6)  return obj.horizon6m;
  if (months <= 12) return obj.horizon12m;
  if (months <= 18) return obj.horizon18m;
  if (months <= 24) return obj.horizon24m;
  if (months <= 36 && obj.horizon36m) return obj.horizon36m;
  if (obj.horizon60m) return obj.horizon60m;
  return obj.horizon24m;
}

// ── Engine principal V2 ───────────────────────────────────────────────────

export function computePredictiveSnapshot(
  input: PredictiveEngineInput
): PredictiveAnalysisSnapshot {
  const {
    surfaceM2,
    acquisitionPrice,
    travauxEstime = 0,
    fraisAnnexes = 0,
  } = input;

  const totalCost       = acquisitionPrice + travauxEstime + fraisAnnexes;
  const horizonDetention = input.horizonDetention ?? 12;

  // ── Spot ───────────────────────────────────────────────────────────────
  const { spotPsm, rawSpotPsm, source: spotSource, confidence: spotBaseConf } = resolveSpotPsm(input);
  const marketValue = Math.round(spotPsm * surfaceM2);

  const rangePct  = spotSource === "dvf" ? 0.05 : 0.08;
  const rangeLow  = Math.round(marketValue * (1 - rangePct));
  const rangeHigh = Math.round(marketValue * (1 + rangePct));

  // Confidence enrichie V2 (max 98)
  let confidenceBonus = 0;
  if (input.dvf?.prixM2Median)                              confidenceBonus += 8;
  if (input.dvf?.nbTransactions && input.dvf.nbTransactions >= 30) confidenceBonus += 5;
  if (input.marketScores?.global)                           confidenceBonus += 5;
  if (input.bpe?.score)                                     confidenceBonus += 2;
  if (input.dpe)                                            confidenceBonus += 3;
  if (input.georisques)                                     confidenceBonus += 3;
  if (input.plu?.zone)                                      confidenceBonus += 4;
  if (input.loyerMedianZone)                                confidenceBonus += 3;
  if (input.demographieScore != null)                       confidenceBonus += 2;
  if (input.sitadelConcurrence != null)                     confidenceBonus += 2;
  if (input.fiscalite?.regime)                              confidenceBonus += 2;
  const spotConfidence = clamp(spotBaseConf + confidenceBonus, 30, 98);

  // ── Market ─────────────────────────────────────────────────────────────
  const regime = resolveRegime(input);
  const { pressureScore, liquidityScore, riskScore } = resolveMarketScores(input);

  // ── Forecast ───────────────────────────────────────────────────────────
  const { rate6, rate12, rate18, rate24, rate36, rate60, rateSource } = resolveForecastRates(input);
  const forecastConf = rateSource === "dvf_evolution" ? 82
    : rateSource === "market_scores" ? 72
    : 58;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const forecast: any = {
    horizon6m:  buildPoint(spotPsm, surfaceM2, rate6,  6,  forecastConf),
    horizon12m: buildPoint(spotPsm, surfaceM2, rate12, 12, forecastConf),
    horizon18m: buildPoint(spotPsm, surfaceM2, rate18, 18, forecastConf),
    horizon24m: buildPoint(spotPsm, surfaceM2, rate24, 24, forecastConf),
  };
  if (horizonDetention >= 36) {
    forecast.horizon36m = buildPoint(spotPsm, surfaceM2, rate36, 36, forecastConf);
  }
  if (horizonDetention >= 60) {
    forecast.horizon60m = buildPoint(spotPsm, surfaceM2, rate60, 60, forecastConf);
  }

  // ── Scénarios ──────────────────────────────────────────────────────────
  const stressFactor = rateSource === "dvf_evolution" ? 0.6 : 0.8;
  const optimFactor  = rateSource === "dvf_evolution" ? 1.4 : 1.6;

  const sv = (rate: number, factor: number) =>
    Math.round(spotPsm * (1 + rate * factor) * surfaceM2);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scenarios: any = {
    prudent: {
      horizon6m:  sv(rate6,  -stressFactor),
      horizon12m: sv(rate12, -stressFactor),
      horizon18m: sv(rate18, -stressFactor),
      horizon24m: sv(rate24, -stressFactor),
    },
    central: {
      horizon6m:  forecast.horizon6m.marketValue,
      horizon12m: forecast.horizon12m.marketValue,
      horizon18m: forecast.horizon18m.marketValue,
      horizon24m: forecast.horizon24m.marketValue,
    },
    optimistic: {
      horizon6m:  sv(rate6,  optimFactor),
      horizon12m: sv(rate12, optimFactor),
      horizon18m: sv(rate18, optimFactor),
      horizon24m: sv(rate24, optimFactor),
    },
  };
  if (horizonDetention >= 36) {
    scenarios.prudent.horizon36m    = sv(rate36, -stressFactor);
    scenarios.central.horizon36m    = forecast.horizon36m.marketValue;
    scenarios.optimistic.horizon36m = sv(rate36, optimFactor);
  }
  if (horizonDetention >= 60) {
    scenarios.prudent.horizon60m    = sv(rate60, -stressFactor);
    scenarios.central.horizon60m    = forecast.horizon60m.marketValue;
    scenarios.optimistic.horizon60m = sv(rate60, optimFactor);
  }

  // ── Operation impact ───────────────────────────────────────────────────
  const resaleCible = input.rentabilite?.prixReventeCible;

  const target6  = resaleCible && resaleCible > 0 ? Math.round(resaleCible * (1 + rate6  * 0.3)) : scenarios.central.horizon6m;
  const target12 = resaleCible && resaleCible > 0 ? resaleCible                                   : scenarios.central.horizon12m;
  const target18 = resaleCible && resaleCible > 0 ? Math.round(resaleCible * (1 + rate18 * 0.2)) : scenarios.central.horizon18m;
  const target24 = resaleCible && resaleCible > 0 ? Math.round(resaleCible * (1 + rate24 * 0.3)) : scenarios.central.horizon24m;

  const targetHorizon = getScenarioAtHorizon(scenarios.central, horizonDetention);

  const marginPct = (resale: number) => totalCost > 0 ? ((resale - totalCost) / totalCost) * 100 : 0;

  // V2 : marge nette ajustée de l'impact fiscal
  const { bonus: fiscalBonus } = resolveFiscalImpact(input.fiscalite, input.rentabilite?.rendementBrut);
  const fiscalMultiplier   = 1 + fiscalBonus / 100;
  const projectedMargin    = parseFloat(marginPct(target12).toFixed(1));
  const projectedNetProfit = Math.round((target12 - totalCost) * fiscalMultiplier);
  const stressDownside     = parseFloat((((scenarios.prudent.horizon12m - totalCost) / totalCost) * 100).toFixed(1));
  const marginAtHorizon    = parseFloat(marginPct(targetHorizon).toFixed(1));

  const operationImpact = {
    targetResale6m:        target6,
    targetResale12m:       target12,
    targetResale18m:       target18,
    targetResale24m:       target24,
    projectedMargin,
    projectedNetProfit,
    breakEvenPrice:        totalCost,
    stressDownsidePercent: stressDownside,
  };

  // ── Drivers & sources ──────────────────────────────────────────────────
  const drivers    = buildDrivers(input);
  const dataSources = trackSources(input, rateSource);

  // ── Summary V2 ─────────────────────────────────────────────────────────
  const nbRealSources = dataSources.filter((s) => s.available).length;
  const dataQualityNote =
    nbRealSources >= 9
      ? "Analyse enrichie — données réelles complètes (DVF, scores marché, DPE, Géorisques, PLU, loyer médian, démographie, Sitadel)."
      : nbRealSources >= 6
      ? "Analyse basée sur des données réelles (DVF, scores marché, BPE + enrichissements V2)."
      : nbRealSources >= 3
      ? "Analyse partiellement alimentée par des données réelles."
      : "Analyse principalement heuristique — lancer l'étude Marché/Risques pour enrichir.";

  // Notes contextuelles
  const dpeNote =
    input.dpe && ["F", "G"].includes(input.dpe.toUpperCase())
      ? ` ⚠️ Passoire thermique (DPE ${input.dpe.toUpperCase()}) — rénovation obligatoire, décote appliquée.`
      : "";

  const { risques: risquesListe } = resolveGeorisquesAdjustment(input.georisques);
  const georisquesNote =
    risquesListe.length > 0 ? ` Risques naturels : ${risquesListe.join(", ")}.` : "";

  const horizonNote =
    horizonDetention !== 12 ? ` Analyse calibrée sur un horizon de ${horizonDetention} mois.` : "";

  // Marge de référence = celle sur l'horizon de détention choisi
  const refMargin = horizonDetention !== 12 ? marginAtHorizon : projectedMargin;

  let verdict: string;
  let explanation: string;

  if (refMargin >= 12) {
    verdict = "Opportunité favorable — marge projetée confortable.";
    explanation = `La projection centrale à ${horizonDetention} mois affiche une marge de ${refMargin}% sur le coût total (${totalCost.toLocaleString("fr-FR")} €). Marché en régime « ${regime} ».${dpeNote}${georisquesNote}${horizonNote} ${dataQualityNote}`;
  } else if (refMargin >= 5) {
    verdict = "Opération viable — marge serrée, vigilance requise.";
    explanation = `Marge projetée à ${horizonDetention} mois : ${refMargin}%. Stress downside : ${stressDownside}%.${dpeNote}${georisquesNote}${horizonNote} ${dataQualityNote}`;
  } else if (refMargin >= 0) {
    verdict = "Opération tendue — marge faible, négociation recommandée.";
    explanation = `Marge projetée à ${horizonDetention} mois : ${refMargin}%. En scénario prudent, stress de ${stressDownside}%. Envisager une renégociation du prix ou une optimisation des travaux.${dpeNote}${georisquesNote}${horizonNote} ${dataQualityNote}`;
  } else {
    verdict = "Opération défavorable — risque de perte.";
    explanation = `Marge projetée négative (${refMargin}%). Le prix d'achat est supérieur aux projections de marché.${dpeNote}${georisquesNote}${horizonNote} ${dataQualityNote}`;
  }

  return {
    assetId:    undefined,
    generatedAt: new Date().toISOString(),
    spot:   { pricePerSqm: spotPsm, marketValue, rangeLow, rangeHigh, confidenceScore: spotConfidence },
    market: { regime, pressureScore, liquidityScore, riskScore },
    forecast,
    scenarios,
    drivers,
    operationImpact,
    summary: { verdict, explanation },
    dataSources,
  };
}