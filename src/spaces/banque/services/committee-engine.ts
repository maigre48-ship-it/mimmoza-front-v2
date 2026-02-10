// FILE: src/spaces/banque/services/committee-engine.ts

import type {
  BanqueDossier,
  CompletenessResult,
  Condition,
  DecisionDraft,
  RiskLevel,
  Verdict,
} from "../types";
import type { RequiredDocument } from "../config/required-documents";

// ============================================================================
// 1. COMPLÉTUDE
// ============================================================================

/**
 * Calcule la complétude du dossier par rapport aux documents requis.
 *
 * Un document est considéré "fourni" s'il existe dans dossier.documents
 * avec status === "fourni". Les documents "non_applicable" ne comptent
 * ni dans le total ni dans les manquants.
 */
export function computeCompleteness(
  dossier: BanqueDossier,
  requiredDocs: RequiredDocument[],
): CompletenessResult {
  const providedIds = new Set(
    dossier.documents
      .filter((d) => d.status === "fourni")
      .map((d) => d.id),
  );

  const naIds = new Set(
    dossier.documents
      .filter((d) => d.status === "non_applicable")
      .map((d) => d.id),
  );

  const applicable = requiredDocs.filter((r) => !naIds.has(r.id));
  const missing = applicable.filter((r) => !providedIds.has(r.id));

  const total = applicable.length;
  const provided = total - missing.length;
  const percentage = total > 0 ? Math.round((provided / total) * 100) : 0;

  return {
    total,
    provided,
    missing: missing.map((m) => m.label),
    percentage,
  };
}

// ============================================================================
// 2. LTV (Loan-to-Value)
// ============================================================================

/**
 * Calcule le LTV à partir de montants bruts.
 * Retourne un ratio entre 0 et +∞, ou null si les données sont invalides.
 */
export function computeLtv(
  montantDemande: number,
  valeurGarantie: number,
): number | null {
  if (!Number.isFinite(montantDemande) || montantDemande <= 0) return null;
  if (!Number.isFinite(valeurGarantie) || valeurGarantie <= 0) return null;
  return Math.round((montantDemande / valeurGarantie) * 10000) / 10000;
}

/**
 * Calcule le LTV à partir du dossier.
 * La valeur de garantie est la somme des montants de toutes les garanties.
 * Si aucune garantie, utilise valeurProjet comme fallback.
 */
export function computeLtvFromDossier(dossier: BanqueDossier): number | null {
  const totalGaranties = dossier.guarantees.reduce(
    (sum, g) => sum + (Number.isFinite(g.montant) ? g.montant : 0),
    0,
  );
  const valeurGarantie = totalGaranties > 0 ? totalGaranties : dossier.valeurProjet;
  return computeLtv(dossier.montantDemande, valeurGarantie);
}

// ============================================================================
// 3. RISK LEVEL
// ============================================================================

/**
 * Évalue le niveau de risque global du dossier.
 *
 * Règles :
 * - LTV null                        → "inconnu"
 * - LTV ≤ 0.60 + ≥1 garantie       → "faible"
 * - LTV ≤ 0.60 + 0 garantie        → "moyen"
 * - 0.60 < LTV ≤ 0.80              → "moyen"
 * - 0.80 < LTV ≤ 1.00              → "eleve"
 * - LTV > 1.00                      → "eleve"
 *
 * Multiplicateurs aggravants :
 * - 0 garanties avec LTV > 0.60     → +1 cran
 * - montantDemande <= 0             → "inconnu"
 */
export function computeRiskLevel(
  dossier: BanqueDossier,
  ltv: number | null,
): RiskLevel {
  if (ltv === null) return "inconnu";
  if (dossier.montantDemande <= 0) return "inconnu";

  const hasGuarantees = dossier.guarantees.length > 0;

  // Base level from LTV
  let level: RiskLevel;
  if (ltv <= 0.6) {
    level = hasGuarantees ? "faible" : "moyen";
  } else if (ltv <= 0.8) {
    level = "moyen";
  } else {
    level = "eleve";
  }

  // Aggravation : pas de garantie avec LTV > 0.60
  if (!hasGuarantees && ltv > 0.6) {
    level = "eleve";
  }

  return level;
}

// ============================================================================
// 4. SUGGESTED CONDITIONS
// ============================================================================

let _conditionIdCounter = 0;
function nextConditionId(): string {
  _conditionIdCounter += 1;
  return `cond-auto-${_conditionIdCounter}`;
}

/** Remet le compteur — utile pour les tests déterministes. */
export function resetConditionIdCounter(): void {
  _conditionIdCounter = 0;
}

/**
 * Génère automatiquement des conditions suspensives basées sur l'état du dossier.
 */
export function suggestConditions(
  dossier: BanqueDossier,
  requiredDocs: RequiredDocument[],
  ltv: number | null,
  riskLevel: RiskLevel,
): Condition[] {
  const conditions: Condition[] = [];

  // ── Documents manquants ───────────────────────────────────────────────
  const providedIds = new Set(
    dossier.documents.filter((d) => d.status === "fourni").map((d) => d.id),
  );
  const naIds = new Set(
    dossier.documents.filter((d) => d.status === "non_applicable").map((d) => d.id),
  );

  const missingDocs = requiredDocs.filter(
    (r) => !providedIds.has(r.id) && !naIds.has(r.id),
  );

  if (missingDocs.length > 0 && missingDocs.length <= 5) {
    for (const doc of missingDocs) {
      conditions.push({
        id: nextConditionId(),
        text: `Fournir le document : ${doc.label}`,
        source: "auto",
        met: false,
      });
    }
  } else if (missingDocs.length > 5) {
    conditions.push({
      id: nextConditionId(),
      text: `Fournir les ${missingDocs.length} documents manquants avant instruction`,
      source: "auto",
      met: false,
    });
  }

  // ── Garanties ─────────────────────────────────────────────────────────
  if (dossier.guarantees.length === 0) {
    conditions.push({
      id: nextConditionId(),
      text: "Constitution d'au moins une garantie (hypothèque, caution, nantissement…)",
      source: "auto",
      met: false,
    });
  }

  // ── LTV élevé ─────────────────────────────────────────────────────────
  if (ltv !== null && ltv > 0.8) {
    conditions.push({
      id: nextConditionId(),
      text: `LTV de ${(ltv * 100).toFixed(1)}% — obtenir un apport supplémentaire ou une garantie complémentaire pour ramener le LTV sous 80%`,
      source: "auto",
      met: false,
    });
  }

  // ── Risque élevé ──────────────────────────────────────────────────────
  if (riskLevel === "eleve") {
    conditions.push({
      id: nextConditionId(),
      text: "Niveau de risque élevé — exiger une caution personnelle du dirigeant ou un nantissement complémentaire",
      source: "auto",
      met: false,
    });
  }

  // ── Promotion : pré-commercialisation ─────────────────────────────────
  if (dossier.projectType === "promotion") {
    const hasPreco = dossier.documents.some(
      (d) => d.id === "promo-13" && d.status === "fourni",
    );
    if (!hasPreco) {
      conditions.push({
        id: nextConditionId(),
        text: "Atteindre un taux de pré-commercialisation ≥ 40% avant premier déblocage",
        source: "auto",
        met: false,
      });
    }
  }

  // ── Marchand : planning ───────────────────────────────────────────────
  if (dossier.projectType === "marchand") {
    const hasPlanning = dossier.documents.some(
      (d) => d.id === "march-15" && d.status === "fourni",
    );
    if (!hasPlanning) {
      conditions.push({
        id: nextConditionId(),
        text: "Fournir un planning prévisionnel détaillé (acquisition → travaux → revente)",
        source: "auto",
        met: false,
      });
    }
  }

  return conditions;
}

// ============================================================================
// 5. DECISION DRAFT
// ============================================================================

/**
 * Construit un projet de décision automatique (GO / GO sous conditions / NO GO).
 *
 * Logique :
 * - NO GO si :
 *     • complétude < 30%
 *     • LTV > 1.0 (financement supérieur à la valeur)
 *     • risque élevé ET aucune garantie ET complétude < 50%
 * - GO sous conditions si :
 *     • des conditions auto existent
 *     • 30% ≤ complétude < 100%
 *     • risque moyen ou élevé
 * - GO si :
 *     • complétude = 100%
 *     • risque faible ou moyen
 *     • pas de condition non satisfaite
 */
export function buildDecisionDraft(
  dossier: BanqueDossier,
  completeness: CompletenessResult,
  ltv: number | null,
  riskLevel: RiskLevel,
  suggestedConditions: Condition[],
): DecisionDraft {
  const motivations: string[] = [];
  let verdict: Verdict;
  let confidence: number;

  const pct = completeness.percentage;
  const nbConditions = suggestedConditions.length;
  const unmetConditions = suggestedConditions.filter((c) => !c.met).length;

  // ── NO GO checks ──────────────────────────────────────────────────────

  if (pct < 30) {
    verdict = "NO_GO";
    motivations.push(`Complétude insuffisante (${pct}%). Le dossier est trop incomplet pour être instruit.`);
    confidence = 0.9;
    return { verdict, motivation: motivations.join(" "), confidence, suggestedConditions };
  }

  if (ltv !== null && ltv > 1.0) {
    verdict = "NO_GO";
    motivations.push(
      `LTV de ${(ltv * 100).toFixed(1)}% : le montant demandé dépasse la valeur des garanties/projet. Financement non envisageable en l'état.`,
    );
    confidence = 0.95;
    return { verdict, motivation: motivations.join(" "), confidence, suggestedConditions };
  }

  if (riskLevel === "eleve" && dossier.guarantees.length === 0 && pct < 50) {
    verdict = "NO_GO";
    motivations.push(
      "Risque élevé combiné à l'absence totale de garanties et un dossier incomplet. Financement refusé.",
    );
    confidence = 0.85;
    return { verdict, motivation: motivations.join(" "), confidence, suggestedConditions };
  }

  // ── GO checks ─────────────────────────────────────────────────────────

  if (
    pct === 100 &&
    unmetConditions === 0 &&
    (riskLevel === "faible" || riskLevel === "moyen") &&
    ltv !== null &&
    ltv <= 0.8
  ) {
    verdict = "GO";
    motivations.push("Dossier complet.");

    if (riskLevel === "faible") {
      motivations.push("Risque faible, garanties satisfaisantes.");
      confidence = 0.95;
    } else {
      motivations.push("Risque modéré mais acceptable au vu des garanties.");
      confidence = 0.8;
    }

    if (ltv !== null) {
      motivations.push(`LTV de ${(ltv * 100).toFixed(1)}%.`);
    }

    return { verdict, motivation: motivations.join(" "), confidence, suggestedConditions };
  }

  // ── GO SOUS CONDITIONS (default) ──────────────────────────────────────

  verdict = "GO_SOUS_CONDITIONS";

  if (pct < 100) {
    motivations.push(`Complétude à ${pct}% — ${completeness.missing.length} document(s) manquant(s).`);
  }

  if (ltv !== null) {
    motivations.push(`LTV de ${(ltv * 100).toFixed(1)}%.`);
  }

  if (riskLevel === "eleve") {
    motivations.push("Niveau de risque élevé — conditions renforcées nécessaires.");
  } else if (riskLevel === "moyen") {
    motivations.push("Risque modéré.");
  } else if (riskLevel === "inconnu") {
    motivations.push("Données insuffisantes pour évaluer le risque précisément.");
  }

  if (nbConditions > 0) {
    motivations.push(`${nbConditions} condition(s) suspensive(s) à satisfaire.`);
  }

  // Confidence heuristic
  if (pct >= 80 && (riskLevel === "faible" || riskLevel === "moyen")) {
    confidence = 0.75;
  } else if (pct >= 50) {
    confidence = 0.55;
  } else {
    confidence = 0.4;
  }

  return {
    verdict,
    motivation: motivations.join(" "),
    confidence,
    suggestedConditions,
  };
}