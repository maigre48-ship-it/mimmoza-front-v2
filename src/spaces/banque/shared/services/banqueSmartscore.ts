/**
 * banqueSmartscore.ts
 * ═══════════════════════════════════════════════════════════════════
 * SmartScore Banque — Moteur de scoring déterministe & explicable.
 *
 * ✅ Score 0-100 stable (mêmes entrées => même sortie)
 * ✅ Pénalités si data manquante + justification
 * ✅ Pondérations configurables (WEIGHTS unique)
 * ✅ Résultat compatible avec patchSmartScore() du store existant
 * ✅ Zero dépendance externe — module pur
 *
 * Usage :
 *   import { computeBankSmartScore } from '../shared/services/banqueSmartscore';
 *   const result = computeBankSmartScore(input);
 *   patchSmartScore(dossierId, result);   // ← store existant
 *   patchRiskAnalysis(dossierId, buildRiskAnalysisPatch(result));
 *
 * @version 2.0.0
 */

// ════════════════════════════════════════════════════════════════════
// §1 — TYPES PUBLICS
// ════════════════════════════════════════════════════════════════════

/** Les 6 axes de scoring */
export type SubscoreName =
  | "marche"
  | "risques"
  | "reglementaire"
  | "finance"
  | "delai"
  | "completude";

export interface SubscoreDetail {
  name: SubscoreName;
  label: string;
  rawScore: number;       // 0-100 avant pondération
  weight: number;         // 0-1
  weightedScore: number;  // rawScore × weight
  hasData: boolean;
  details: string[];
}

export interface Penalty {
  code: string;
  label: string;
  points: number;         // pts retirés (positif)
  reason: string;
}

export interface ScoreHistoryEntry {
  score: number;
  grade: string;
  computedAt: string;
  inputHash: string;
}

export type SmartScoreGrade = "A" | "B" | "C" | "D" | "E";
export type SmartScoreVerdict = "GO" | "GO SOUS CONDITIONS" | "NO GO";

/**
 * Résultat complet du SmartScore.
 * Compatible avec patchSmartScore() du banqueSnapshot.store.
 */
export interface SmartScoreResult {
  score: number;
  grade: SmartScoreGrade;
  verdict: SmartScoreVerdict;
  subscores: SubscoreDetail[];
  explanations: string[];
  penalties: Penalty[];
  missingData: string[];
  blockers: string[];
  scoreHistory: ScoreHistoryEntry[];
  computedAt: string;
  inputHash: string;
  engineVersion: string;
}

// ════════════════════════════════════════════════════════════════════
// §2 — INPUT : données lues depuis le snapshot
// ════════════════════════════════════════════════════════════════════
//
// Interface volontairement loose (tout optionnel).
// Le hook useSmartScore se charge de mapper le snapshot vers cette structure.
//

export interface SmartScoreInput {
  /** Origination / infos projet */
  origination?: {
    montantDemande?: number;
    dureeEnMois?: number;
    typeProjet?: string;
    commune?: string;
    surfaceTerrain?: number;
    surfaceSDP?: number;
  };

  /** Marché (DVF, INSEE…) */
  market?: {
    tensionMarche?: "forte" | "modérée" | "faible" | string;
    tauxVacance?: number;
    evolutionPrix12m?: number;
    delaiVenteMoyen?: number;
    prixM2Median?: number;
    verdict?: string;
  };

  /** Risques (Géorisques…) */
  risks?: {
    globalLevel?: "faible" | "modéré" | "élevé" | "très élevé" | string;
    presentCount?: number;
    unknownCount?: number;
    absentCount?: number;
    totalCategories?: number;
    blockers?: string[];
    items?: Array<{
      categorie: string;
      niveau: string;
      label: string;
    }>;
  };

  /** Réglementaire (PLU, permis…) */
  regulatory?: {
    pluConforme?: boolean | "unknown";
    permisDepose?: boolean;
    permisObtenu?: boolean;
    recoursPurge?: boolean;
    avisABF?: "favorable" | "réservé" | "défavorable" | "non_requis" | string;
    servitudes?: string[];
  };

  /** Finance (analyse manuelle + bilan) */
  finance?: {
    scoreCreditGlobal?: number;
    ratioLTV?: number;
    ratioDSCR?: number;
    margePct?: number;
    tauxPreCommercialisation?: number;
    tauxEndettement?: number;
    fondsPropresPct?: number;
    triProjet?: number;
    chiffreAffairesPrev?: number;
    margeBrutePrev?: number;
    garanties?: Array<{
      type: string;
      couverturePct?: number;
      montant?: number;
    }>;
  };

  /** Délai / calendrier */
  timeline?: {
    dureeTravaux?: number;
    retardEstime?: number;
    phaseCourante?: string;
    jalonsRespectes?: boolean;
  };

  /** Complétude documentaire */
  completeness?: {
    documentsPresents?: string[];
    documentsManquants?: string[];
    totalDocumentsRequis?: number;
    etudeMarche?: boolean;
    etudeRisques?: boolean;
    bilanPromotion?: boolean;
    planMasse?: boolean;
    etudeGeotechnique?: boolean;
  };

  /** Historique de scores précédent (pour append) */
  previousScoreHistory?: ScoreHistoryEntry[];
}

// ════════════════════════════════════════════════════════════════════
// §3 — PONDÉRATIONS — POINT UNIQUE DE CONFIGURATION
// ════════════════════════════════════════════════════════════════════
//
// ☛ Modifier ICI pour ajuster le scoring.
//   Somme des weights = 1.0 obligatoire.
//

export const WEIGHTS: Record<SubscoreName, { weight: number; label: string }> = {
  marche:        { weight: 0.20, label: "Étude de Marché" },
  risques:       { weight: 0.20, label: "Analyse des Risques" },
  reglementaire: { weight: 0.15, label: "Conformité Réglementaire" },
  finance:       { weight: 0.25, label: "Solidité Financière" },
  delai:         { weight: 0.10, label: "Respect des Délais" },
  completude:    { weight: 0.10, label: "Complétude du Dossier" },
};

/** Score par défaut quand un axe n'a aucune donnée */
const DEFAULT_MISSING_SCORE = 35;

/** Pénalité (pts) par axe totalement manquant */
const PENALTY_PER_MISSING_AXIS = 5;

/** Seuils de grade */
const GRADE_THRESHOLDS: Array<{ min: number; grade: SmartScoreGrade }> = [
  { min: 80, grade: "A" },
  { min: 65, grade: "B" },
  { min: 50, grade: "C" },
  { min: 35, grade: "D" },
  { min: 0,  grade: "E" },
];

/** Seuils de verdict */
const VERDICT_THRESHOLDS: Array<{ min: number; verdict: SmartScoreVerdict }> = [
  { min: 65, verdict: "GO" },
  { min: 45, verdict: "GO SOUS CONDITIONS" },
  { min: 0,  verdict: "NO GO" },
];

const ENGINE_VERSION = "2.0.0";

// ════════════════════════════════════════════════════════════════════
// §4 — FONCTIONS DE SCORING PAR AXE
// ════════════════════════════════════════════════════════════════════

type AxisResult = { score: number; hasData: boolean; details: string[] };

function scoreMarche(input: SmartScoreInput): AxisResult {
  const m = input.market;
  if (!m || isEmptyObj(m)) {
    return { score: DEFAULT_MISSING_SCORE, hasData: false, details: ["Aucune donnée marché disponible"] };
  }

  let score = 50;
  const details: string[] = [];

  if (m.tensionMarche && m.tensionMarche !== "unknown") {
    const map: Record<string, number> = { forte: 25, modérée: 10, faible: -15 };
    const d = map[m.tensionMarche] ?? 0;
    score += d;
    details.push(`Tension marché ${m.tensionMarche} (${fmt(d)})`);
  }

  if (m.tauxVacance != null) {
    if (m.tauxVacance < 5)        { score += 15; details.push(`Vacance faible ${m.tauxVacance}% (+15)`); }
    else if (m.tauxVacance < 10)  { score += 5;  details.push(`Vacance modérée ${m.tauxVacance}% (+5)`); }
    else if (m.tauxVacance < 15)  { score -= 5;  details.push(`Vacance élevée ${m.tauxVacance}% (-5)`); }
    else                          { score -= 15; details.push(`Vacance critique ${m.tauxVacance}% (-15)`); }
  }

  if (m.evolutionPrix12m != null) {
    if (m.evolutionPrix12m > 3)       { score += 10; details.push(`Prix hausse ${m.evolutionPrix12m}% (+10)`); }
    else if (m.evolutionPrix12m > 0)  { score += 5;  details.push(`Prix stables ${m.evolutionPrix12m}% (+5)`); }
    else if (m.evolutionPrix12m > -3) { score -= 5;  details.push(`Prix baisse légère ${m.evolutionPrix12m}% (-5)`); }
    else                              { score -= 15; details.push(`Prix forte baisse ${m.evolutionPrix12m}% (-15)`); }
  }

  if (m.delaiVenteMoyen != null) {
    if (m.delaiVenteMoyen < 90)       { score += 10; details.push(`Vente rapide ${m.delaiVenteMoyen}j (+10)`); }
    else if (m.delaiVenteMoyen < 180) { /* neutre */ }
    else                              { score -= 10; details.push(`Vente lente ${m.delaiVenteMoyen}j (-10)`); }
  }

  if (m.verdict) {
    const map: Record<string, number> = { favorable: 5, neutre: 0, défavorable: -10 };
    const d = map[m.verdict] ?? 0;
    if (d) { score += d; details.push(`Verdict marché: ${m.verdict} (${fmt(d)})`); }
  }

  return { score: clamp(score), hasData: true, details };
}

function scoreRisques(input: SmartScoreInput): AxisResult {
  const r = input.risks;
  if (!r || isEmptyObj(r)) {
    return { score: DEFAULT_MISSING_SCORE, hasData: false, details: ["Aucune donnée risques disponible"] };
  }

  let score = 80;
  const details: string[] = [];

  if (r.globalLevel && r.globalLevel !== "unknown") {
    const map: Record<string, number> = { faible: 0, modéré: -15, élevé: -30, "très élevé": -50 };
    const d = map[r.globalLevel] ?? 0;
    score += d;
    details.push(`Niveau global: ${r.globalLevel} (${d}pts)`);
  } else if (r.globalLevel === "unknown") {
    score -= 10;
    details.push("Niveau global inconnu (-10)");
  }

  if (r.presentCount != null && r.totalCategories) {
    const ratio = r.presentCount / r.totalCategories;
    if (ratio > 0.3)       { score -= 15; details.push(`${r.presentCount}/${r.totalCategories} risques présents (-15)`); }
    else if (ratio > 0.15) { score -= 5;  details.push(`${r.presentCount}/${r.totalCategories} risques présents (-5)`); }
    else                   { details.push(`${r.presentCount}/${r.totalCategories} risques présents (OK)`); }
  }

  if (r.unknownCount != null && r.unknownCount > 0) {
    const pen = Math.min(r.unknownCount * 3, 15);
    score -= pen;
    details.push(`${r.unknownCount} risque(s) non évalué(s) (-${pen})`);
  }

  if (r.blockers && r.blockers.length > 0) {
    score -= 30;
    details.push(`BLOCKER: ${r.blockers.join(", ")} (-30)`);
  }

  return { score: clamp(score), hasData: true, details };
}

function scoreReglementaire(input: SmartScoreInput): AxisResult {
  const reg = input.regulatory;
  if (!reg || isEmptyObj(reg)) {
    return { score: DEFAULT_MISSING_SCORE, hasData: false, details: ["Aucune donnée réglementaire"] };
  }

  let score = 50;
  const details: string[] = [];

  if (reg.pluConforme === true)        { score += 20; details.push("PLU conforme (+20)"); }
  else if (reg.pluConforme === false)  { score -= 25; details.push("PLU non conforme (-25)"); }
  else                                 { score -= 5;  details.push("PLU inconnu (-5)"); }

  if (reg.permisObtenu)      { score += 25; details.push("PC obtenu (+25)"); }
  else if (reg.permisDepose) { score += 10; details.push("PC déposé (+10)"); }
  else                       { score -= 5;  details.push("PC non déposé (-5)"); }

  if (reg.recoursPurge)                     { score += 10; details.push("Recours purgé (+10)"); }
  else if (reg.permisObtenu)                { score -= 5;  details.push("Recours non purgé (-5)"); }

  if (reg.avisABF && reg.avisABF !== "non_requis" && reg.avisABF !== "unknown") {
    const map: Record<string, number> = { favorable: 5, réservé: -5, défavorable: -15 };
    const d = map[reg.avisABF] ?? 0;
    if (d) { score += d; details.push(`ABF: ${reg.avisABF} (${fmt(d)})`); }
  }

  if (reg.servitudes && reg.servitudes.length > 2) {
    score -= 5;
    details.push(`${reg.servitudes.length} servitudes (-5)`);
  }

  return { score: clamp(score), hasData: true, details };
}

function scoreFinance(input: SmartScoreInput): AxisResult {
  const f = input.finance;
  if (!f || isEmptyObj(f)) {
    return { score: DEFAULT_MISSING_SCORE, hasData: false, details: ["Aucune donnée financière"] };
  }

  let score = 50;
  const details: string[] = [];

  // Marge
  if (f.margePct != null) {
    if (f.margePct >= 15)      { score += 20; details.push(`Marge ${f.margePct.toFixed(1)}% excellente (+20)`); }
    else if (f.margePct >= 10) { score += 10; details.push(`Marge ${f.margePct.toFixed(1)}% correcte (+10)`); }
    else if (f.margePct >= 5)  { /* neutre */ }
    else                       { score -= 15; details.push(`Marge ${f.margePct.toFixed(1)}% insuffisante (-15)`); }
  }

  // LTV
  if (f.ratioLTV != null) {
    if (f.ratioLTV <= 60)      { score += 15; details.push(`LTV ${f.ratioLTV}% faible (+15)`); }
    else if (f.ratioLTV <= 75) { score += 5;  details.push(`LTV ${f.ratioLTV}% acceptable (+5)`); }
    else if (f.ratioLTV <= 85) { score -= 5;  details.push(`LTV ${f.ratioLTV}% élevé (-5)`); }
    else                       { score -= 15; details.push(`LTV ${f.ratioLTV}% excessif (-15)`); }
  }

  // DSCR
  if (f.ratioDSCR != null) {
    if (f.ratioDSCR >= 1.5)    { score += 10; details.push(`DSCR ${f.ratioDSCR.toFixed(2)} solide (+10)`); }
    else if (f.ratioDSCR >= 1.2) { score += 5; details.push(`DSCR ${f.ratioDSCR.toFixed(2)} acceptable (+5)`); }
    else if (f.ratioDSCR >= 1.0) { score -= 5; details.push(`DSCR ${f.ratioDSCR.toFixed(2)} juste (-5)`); }
    else                       { score -= 15; details.push(`DSCR ${f.ratioDSCR.toFixed(2)} insuffisant (-15)`); }
  }

  // Pré-commercialisation
  if (f.tauxPreCommercialisation != null) {
    if (f.tauxPreCommercialisation >= 50) { score += 15; details.push(`Pré-co ${f.tauxPreCommercialisation}% (+15)`); }
    else if (f.tauxPreCommercialisation >= 30) { score += 5; details.push(`Pré-co ${f.tauxPreCommercialisation}% (+5)`); }
    else { score -= 5; details.push(`Pré-co ${f.tauxPreCommercialisation}% insuffisante (-5)`); }
  }

  // Taux endettement
  if (f.tauxEndettement != null) {
    if (f.tauxEndettement <= 30)      { score += 10; details.push(`Endettement ${f.tauxEndettement}% sain (+10)`); }
    else if (f.tauxEndettement <= 50) { /* neutre */ }
    else                              { score -= 10; details.push(`Endettement ${f.tauxEndettement}% élevé (-10)`); }
  }

  // Fonds propres
  if (f.fondsPropresPct != null) {
    if (f.fondsPropresPct >= 30) { score += 10; details.push(`FP ${f.fondsPropresPct}% solides (+10)`); }
    else if (f.fondsPropresPct >= 15) { score += 5; details.push(`FP ${f.fondsPropresPct}% corrects (+5)`); }
    else { score -= 10; details.push(`FP ${f.fondsPropresPct}% insuffisants (-10)`); }
  }

  // Garanties
  if (f.garanties && f.garanties.length > 0) {
    const totalCouv = f.garanties.reduce((s, g) => s + (g.couverturePct ?? 0), 0);
    if (totalCouv >= 100) { score += 10; details.push(`Garanties ${totalCouv}% (+10)`); }
    else if (totalCouv >= 80) { score += 5; details.push(`Garanties ${totalCouv}% (+5)`); }
    else { score -= 5; details.push(`Garanties ${totalCouv}% insuffisantes (-5)`); }
  }

  // Score global manuel (pris en compte si présent)
  if (f.scoreCreditGlobal != null) {
    const delta = Math.round((f.scoreCreditGlobal - 50) * 0.15);
    score += delta;
    details.push(`Score crédit analyste: ${f.scoreCreditGlobal}/100 (${fmt(delta)})`);
  }

  return { score: clamp(score), hasData: true, details };
}

function scoreDelai(input: SmartScoreInput): AxisResult {
  const t = input.timeline;
  if (!t || isEmptyObj(t)) {
    return { score: DEFAULT_MISSING_SCORE, hasData: false, details: ["Aucune donnée calendrier"] };
  }

  let score = 70;
  const details: string[] = [];

  if (t.retardEstime != null) {
    if (t.retardEstime === 0)      { score += 15; details.push("Aucun retard (+15)"); }
    else if (t.retardEstime <= 3)  { score -= 5;  details.push(`Retard ${t.retardEstime} mois (-5)`); }
    else if (t.retardEstime <= 6)  { score -= 15; details.push(`Retard ${t.retardEstime} mois (-15)`); }
    else                           { score -= 30; details.push(`Retard critique ${t.retardEstime} mois (-30)`); }
  }

  if (t.jalonsRespectes === true)  { score += 10; details.push("Jalons OK (+10)"); }
  else if (t.jalonsRespectes === false) { score -= 10; details.push("Jalons non respectés (-10)"); }

  if (t.dureeTravaux != null) {
    if (t.dureeTravaux > 36)      { score -= 10; details.push(`Travaux longs ${t.dureeTravaux}m (-10)`); }
    else if (t.dureeTravaux > 24) { score -= 5;  details.push(`Travaux ${t.dureeTravaux}m (-5)`); }
  }

  if (t.phaseCourante) {
    const map: Record<string, number> = { montage: 0, instruction: 5, travaux: 10, livraison: 15 };
    const d = map[t.phaseCourante] ?? 0;
    if (d > 0) { score += d; details.push(`Phase: ${t.phaseCourante} (+${d})`); }
  }

  return { score: clamp(score), hasData: true, details };
}

function scoreCompletude(input: SmartScoreInput): AxisResult {
  const c = input.completeness;
  if (!c || isEmptyObj(c)) {
    return { score: DEFAULT_MISSING_SCORE, hasData: false, details: ["Aucune info complétude"] };
  }

  const details: string[] = [];

  // Ratio documents
  let docScore = 50;
  if (c.totalDocumentsRequis && c.documentsPresents) {
    const ratio = c.documentsPresents.length / c.totalDocumentsRequis;
    docScore = Math.round(ratio * 100);
    details.push(`Documents: ${c.documentsPresents.length}/${c.totalDocumentsRequis} (${Math.round(ratio * 100)}%)`);
  }
  if (c.documentsManquants && c.documentsManquants.length > 0) {
    details.push(`Manquants: ${c.documentsManquants.slice(0, 3).join(", ")}${c.documentsManquants.length > 3 ? "…" : ""}`);
  }

  // Études réalisées
  const etudes: Array<[boolean | undefined, string]> = [
    [c.etudeMarche, "Marché"],
    [c.etudeRisques, "Risques"],
    [c.bilanPromotion, "Bilan"],
    [c.planMasse, "Plan masse"],
    [c.etudeGeotechnique, "Géotech"],
  ];
  const done = etudes.filter(([v]) => v === true).length;
  const etudesBonus = Math.round((done / etudes.length) * 30);
  details.push(`Études: ${done}/${etudes.length} (+${etudesBonus})`);

  const score = clamp(Math.round(docScore * 0.7 + etudesBonus));
  return { score, hasData: true, details };
}

// ════════════════════════════════════════════════════════════════════
// §5 — MOTEUR PRINCIPAL
// ════════════════════════════════════════════════════════════════════

/**
 * Calcule le SmartScore bancaire.
 * ✅ Déterministe : mêmes inputs => même output (sauf computedAt).
 */
export function computeBankSmartScore(input: SmartScoreInput): SmartScoreResult {
  const computedAt = new Date().toISOString();
  const inputHash = deterministicHash(input);

  const axisComputors: Record<SubscoreName, (i: SmartScoreInput) => AxisResult> = {
    marche: scoreMarche,
    risques: scoreRisques,
    reglementaire: scoreReglementaire,
    finance: scoreFinance,
    delai: scoreDelai,
    completude: scoreCompletude,
  };

  const subscores: SubscoreDetail[] = [];
  const penalties: Penalty[] = [];
  const missingData: string[] = [];
  const explanations: string[] = [];
  const blockers: string[] = [];

  let totalWeightedScore = 0;

  for (const [name, computor] of Object.entries(axisComputors) as Array<[SubscoreName, (i: SmartScoreInput) => AxisResult]>) {
    const cfg = WEIGHTS[name];
    const result = computor(input);

    const sub: SubscoreDetail = {
      name,
      label: cfg.label,
      rawScore: result.score,
      weight: cfg.weight,
      weightedScore: round2(result.score * cfg.weight),
      hasData: result.hasData,
      details: result.details,
    };

    subscores.push(sub);
    totalWeightedScore += sub.weightedScore;

    if (!result.hasData) {
      missingData.push(name);
      penalties.push({
        code: `MISSING_${name.toUpperCase()}`,
        label: `${cfg.label} — données absentes`,
        points: PENALTY_PER_MISSING_AXIS,
        reason: `Score par défaut ${DEFAULT_MISSING_SCORE}/100 + pénalité -${PENALTY_PER_MISSING_AXIS}pts.`,
      });
      explanations.push(`⚠️ ${cfg.label}: données manquantes → défaut ${DEFAULT_MISSING_SCORE}/100`);
    } else {
      explanations.push(`${cfg.label}: ${result.score}/100 — ${result.details[0] ?? ""}`);
    }
  }

  // Pénalités
  const totalPenalty = penalties.reduce((s, p) => s + p.points, 0);
  const finalScore = clamp(Math.round(totalWeightedScore) - totalPenalty);

  // Blockers
  const riskSub = subscores.find(s => s.name === "risques");
  const finSub = subscores.find(s => s.name === "finance");
  if (riskSub && riskSub.rawScore < 25) blockers.push("Risques critiques (score < 25)");
  if (finSub && finSub.rawScore < 25) blockers.push("Finance insuffisante (score < 25)");
  if (input.risks?.blockers?.length) {
    blockers.push(...input.risks.blockers.map(b => `Risque rédhibitoire: ${b}`));
  }
  if (input.regulatory?.pluConforme === false) blockers.push("PLU non conforme");

  const hasBlockers = blockers.length > 0;

  // Grade
  const grade = GRADE_THRESHOLDS.find(t => finalScore >= t.min)!.grade;

  // Verdict
  let verdict = VERDICT_THRESHOLDS.find(t => finalScore >= t.min)!.verdict;
  if (hasBlockers && verdict === "GO") verdict = "GO SOUS CONDITIONS";
  if (hasBlockers && blockers.some(b => b.includes("rédhibitoire") || b.includes("non conforme"))) {
    verdict = "NO GO";
  }

  // Historique
  const scoreHistory = appendScoreHistory(input.previousScoreHistory, {
    score: finalScore, grade, computedAt, inputHash,
  });

  // Résumé en tête
  explanations.unshift(
    `Score final: ${finalScore}/100 (${grade}) — ${verdict}` +
    (totalPenalty > 0 ? ` — Pénalités: -${totalPenalty}pts` : "")
  );

  return {
    score: finalScore,
    grade,
    verdict,
    subscores,
    explanations,
    penalties,
    missingData,
    blockers,
    scoreHistory,
    computedAt,
    inputHash,
    engineVersion: ENGINE_VERSION,
  };
}

// ════════════════════════════════════════════════════════════════════
// §6 — HELPERS PUBLICS (Snapshot, Monitoring, Comité)
// ════════════════════════════════════════════════════════════════════

/** Construit le patch pour patchRiskAnalysis() du store. */
export function buildRiskAnalysisPatch(result: SmartScoreResult) {
  const riskSub = result.subscores.find(s => s.name === "risques");
  return {
    globalLevel: riskSub?.rawScore != null
      ? (riskSub.rawScore >= 70 ? "faible" : riskSub.rawScore >= 45 ? "modéré" : "élevé")
      : "unknown",
    summary: riskSub?.details.join(" · ") ?? "Non évalué",
    scoreRisque: riskSub?.rawScore ?? 0,
    lastComputedAt: result.computedAt,
  };
}

/** Ajoute une entrée sans doublon (même inputHash). */
export function appendScoreHistory(
  current: ScoreHistoryEntry[] | undefined,
  entry: ScoreHistoryEntry,
  maxEntries = 50,
): ScoreHistoryEntry[] {
  const h = [...(current ?? [])];
  if (h.length > 0 && h[h.length - 1].inputHash === entry.inputHash) return h;
  h.push(entry);
  return h.length > maxEntries ? h.slice(h.length - maxEntries) : h;
}

/**
 * Détecte une baisse de score ≥ threshold.
 * Retourne null si pas de baisse significative.
 */
export function detectScoreDrop(
  history: ScoreHistoryEntry[] | undefined,
  threshold = 10,
): { previousScore: number; currentScore: number; drop: number } | null {
  if (!history || history.length < 2) return null;
  const curr = history[history.length - 1];
  const prev = history[history.length - 2];
  const drop = prev.score - curr.score;
  return drop >= threshold ? { previousScore: prev.score, currentScore: curr.score, drop } : null;
}

/**
 * Score moyen sur un tableau de résultats SmartScore.
 * Retourne 0 si aucun résultat.
 */
export function computeAverageScore(results: Array<SmartScoreResult | null | undefined>): number {
  const valid = results.filter((r): r is SmartScoreResult => r != null && typeof r.score === "number");
  if (valid.length === 0) return 0;
  return round2(valid.reduce((s, r) => s + r.score, 0) / valid.length);
}

/**
 * Payload comité : résumé structuré + justification.
 */
export function buildComitePayload(result: SmartScoreResult, dossierLabel?: string) {
  return {
    label: dossierLabel ?? "—",
    score: result.score,
    grade: result.grade,
    verdict: result.verdict,
    subscoreSummary: result.subscores.map(s => ({
      axis: s.label,
      score: s.rawScore,
      weight: s.weight,
      hasData: s.hasData,
    })),
    missingData: result.missingData,
    blockers: result.blockers,
    explanations: result.explanations,
    whyVerdict: buildVerdictText(result),
  };
}

// ════════════════════════════════════════════════════════════════════
// §7 — UTILITAIRES INTERNES
// ════════════════════════════════════════════════════════════════════

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function fmt(d: number): string {
  return d > 0 ? `+${d}` : `${d}`;
}

function isEmptyObj(o: Record<string, unknown>): boolean {
  return Object.values(o).every(v => v == null || v === "" || v === "unknown");
}

/** Hash déterministe (pas crypto, juste détection changements). */
function deterministicHash(obj: unknown): string {
  const str = stableStringify(obj);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h).toString(36).padStart(8, "0");
}

function stableStringify(obj: unknown): string {
  if (obj == null) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const rec = obj as Record<string, unknown>;
  return "{" + Object.keys(rec).sort().map(k => JSON.stringify(k) + ":" + stableStringify(rec[k])).join(",") + "}";
}

function buildVerdictText(ss: SmartScoreResult): string {
  const lines: string[] = [];
  lines.push(`Score ${ss.score}/100 (${ss.grade}), verdict: ${ss.verdict}.`);

  const forts = ss.subscores.filter(s => s.hasData && s.rawScore >= 70);
  if (forts.length) lines.push(`Points forts : ${forts.map(s => `${s.label} (${s.rawScore})`).join(", ")}.`);

  const faibles = ss.subscores.filter(s => s.hasData && s.rawScore < 45);
  if (faibles.length) lines.push(`Vigilance : ${faibles.map(s => `${s.label} (${s.rawScore})`).join(", ")}.`);

  if (ss.missingData.length) {
    const pen = ss.penalties.reduce((s, p) => s + p.points, 0);
    lines.push(`Données manquantes : ${ss.missingData.join(", ")} (pénalité -${pen}pts).`);
  }

  if (ss.blockers.length) lines.push(`⛔ Blockers : ${ss.blockers.join(" ; ")}.`);

  return lines.join("\n");
}