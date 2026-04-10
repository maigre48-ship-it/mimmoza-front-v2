// src/spaces/promoteur/plan2d/plan.plu.rules.ts

import type { PluRules, PluMetricSet, PluRuleResult, PluRuleStatus } from "./plan.plu.types";

// ─── THRESHOLD HELPERS ────────────────────────────────────────────────

/**
 * How close to a limit (as a fraction) before the status becomes LIMITE.
 * e.g., 0.10 → within 10 % of the limit = LIMITE.
 *
 * Each rule can override this default.
 */
const LIMITE_MARGIN = 0.10;

/**
 * Returns CONFORME / LIMITE / BLOQUANT for a "lower is better" metric
 * (setback, where the rule is a *minimum* threshold).
 *
 * value < limit             → BLOQUANT
 * value < limit × (1 + margin) → LIMITE   (too close to the boundary)
 * value >= limit × (1 + margin) → CONFORME
 */
function statusForMin(value: number, limit: number, margin = LIMITE_MARGIN): PluRuleStatus {
  if (value < limit) return "BLOQUANT";
  if (value < limit * (1 + margin)) return "LIMITE";
  return "CONFORME";
}

/**
 * Returns CONFORME / LIMITE / BLOQUANT for an "upper bound" metric
 * (height, coverage, where the rule is a *maximum* threshold).
 *
 * value > limit              → BLOQUANT
 * value > limit × (1 − margin) → LIMITE   (approaching the ceiling)
 * value <= limit × (1 − margin) → CONFORME
 */
function statusForMax(value: number, limit: number, margin = LIMITE_MARGIN): PluRuleStatus {
  if (value > limit) return "BLOQUANT";
  if (value > limit * (1 - margin)) return "LIMITE";
  return "CONFORME";
}

// ─── FORMATTING HELPERS ───────────────────────────────────────────────

function fmtM(v: number): string  { return `${v.toFixed(1)} m`; }
function fmtPct(v: number): string { return `${(v * 100).toFixed(1)} %`; }
function fmtN(v: number): string  { return String(Math.round(v)); }

// ─── RULE: SETBACK ────────────────────────────────────────────────────

/**
 * Art. 6–7 — Implantation par rapport aux limites séparatives et voies.
 *
 * Measures the minimum distance from any building vertex to any parcel edge.
 * Returns null when the rule is not defined in the PLU.
 */
export function checkSetbackRule(
  metrics: PluMetricSet,
  rules: PluRules,
): PluRuleResult | null {
  if (rules.minSetbackMeters == null) return null;

  const limit  = rules.minSetbackMeters;
  const value  = metrics.minDistanceToParcelEdgeM;
  const status = statusForMin(value, limit);

  const messages: Record<PluRuleStatus, string> = {
    CONFORME:  `Recul suffisant — distance minimale ${fmtM(value)} (seuil : ${fmtM(limit)}).`,
    LIMITE:    `Recul marginal — distance minimale ${fmtM(value)}, proche du seuil requis de ${fmtM(limit)}.`,
    BLOQUANT:  `Recul insuffisant — distance minimale ${fmtM(value)} inférieure au seuil requis de ${fmtM(limit)}.`,
  };

  return {
    key:     "setback",
    label:   "Recul par rapport aux limites",
    status,
    message: messages[status],
    value:   Math.round(value * 100) / 100,
    limit,
    unit:    "m",
  };
}

// ─── RULE: HEIGHT ─────────────────────────────────────────────────────

/**
 * Art. 10 — Hauteur maximale des constructions.
 *
 * Compares the estimated maximum building height to the PLU ceiling.
 * Returns null when no height rule is defined or when all buildings have
 * no level data (estimatedHeight = 0 — ambiguous, skip rather than flag).
 */
export function checkHeightRule(
  metrics: PluMetricSet,
  rules: PluRules,
): PluRuleResult | null {
  if (rules.maxHeightMeters == null) return null;
  if (metrics.estimatedHeightM <= 0) return null; // no height data — skip

  const limit  = rules.maxHeightMeters;
  const value  = metrics.estimatedHeightM;
  const status = statusForMax(value, limit);

  const messages: Record<PluRuleStatus, string> = {
    CONFORME: `Hauteur conforme — ${fmtM(value)} (plafond : ${fmtM(limit)}).`,
    LIMITE:   `Hauteur proche du plafond — ${fmtM(value)} sur ${fmtM(limit)} autorisés.`,
    BLOQUANT: `Hauteur dépassée — ${fmtM(value)} dépasse le plafond de ${fmtM(limit)}.`,
  };

  return {
    key:     "height",
    label:   "Hauteur maximale",
    status,
    message: messages[status],
    value:   Math.round(value * 100) / 100,
    limit,
    unit:    "m",
  };
}

// ─── RULE: COVERAGE (CES) ─────────────────────────────────────────────

/**
 * Art. 9 — Coefficient d'Emprise au Sol (CES).
 *
 * Ratio of total built footprint to parcel area.
 * Returns null when the rule is not defined.
 */
export function checkCoverageRule(
  metrics: PluMetricSet,
  rules: PluRules,
): PluRuleResult | null {
  if (rules.maxCoverageRatio == null) return null;

  const limit  = rules.maxCoverageRatio;
  const value  = metrics.coverageRatio;
  const status = statusForMax(value, limit);

  const pctValue = fmtPct(value);
  const pctLimit = fmtPct(limit);

  const messages: Record<PluRuleStatus, string> = {
    CONFORME: `Emprise au sol conforme — ${pctValue} (CES max : ${pctLimit}).`,
    LIMITE:   `Emprise au sol proche du maximum — ${pctValue} sur ${pctLimit} autorisés.`,
    BLOQUANT: `Emprise au sol dépassée — ${pctValue} excède le CES maximum de ${pctLimit}.`,
  };

  return {
    key:     "coverage",
    label:   "Coefficient d'Emprise au Sol (CES)",
    status,
    message: messages[status],
    value:   Math.round(value * 1000) / 1000,
    limit,
    unit:    "%",
  };
}

// ─── RULE: PARKING ────────────────────────────────────────────────────

/**
 * Art. 12 — Stationnement.
 *
 * Compares provided parking spaces to the computed requirement.
 *
 * Status logic:
 *   BLOQUANT — shortfall of more than one space (project clearly deficient)
 *   LIMITE   — exactly meeting the minimum (no surplus buffer)
 *   CONFORME — surplus of at least one space beyond the requirement
 *
 * Returns null when the rule is not defined or when there are no
 * residential units (no parking obligation for pure service buildings).
 */
export function checkParkingRule(
  metrics: PluMetricSet,
  rules: PluRules,
): PluRuleResult | null {
  if (rules.parkingSpacesPerUnit == null) return null;
  if (metrics.requiredParkingSpaces === 0) return null; // no obligation

  const required = metrics.requiredParkingSpaces;
  const provided = metrics.providedParkingSpaces;
  const deficit  = required - provided;

  let status: PluRuleStatus;
  if (provided < required) {
    status = "BLOQUANT";
  } else if (provided === required) {
    status = "LIMITE"; // meets the exact minimum, no margin
  } else {
    status = "CONFORME";
  }

  const messages: Record<PluRuleStatus, string> = {
    CONFORME: `Stationnement conforme — ${fmtN(provided)} places fournies pour ${fmtN(required)} requises.`,
    LIMITE:   `Stationnement au strict minimum — ${fmtN(provided)} place(s) pour ${fmtN(required)} requises, sans marge.`,
    BLOQUANT: `Stationnement insuffisant — ${fmtN(provided)} place(s) fournies, ${fmtN(deficit)} manquante(s) (${fmtN(required)} requises).`,
  };

  return {
    key:     "parking",
    label:   "Stationnement (Art. 12)",
    status,
    message: messages[status],
    value:   provided,
    limit:   required,
    unit:    "places",
  };
}

// ─── REGISTRY ─────────────────────────────────────────────────────────

/**
 * Ordered list of all registered rule-checkers.
 *
 * Extensibility: add new checker functions here — the engine picks them up
 * automatically without requiring any other code change.
 */
export type RuleChecker = (
  metrics: PluMetricSet,
  rules: PluRules,
) => PluRuleResult | null;

export const ALL_RULE_CHECKERS: readonly RuleChecker[] = [
  checkSetbackRule,
  checkHeightRule,
  checkCoverageRule,
  checkParkingRule,
  // Future: checkFrontageRule, checkProspectRule, checkOpenSpaceRule …
] as const;