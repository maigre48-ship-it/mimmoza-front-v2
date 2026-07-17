// src/spaces/promoteur/plan2d/plan.plu.types.ts
// PATCH V1.1 : unitsEstimated — distingue logements SAISIS et logements ESTIMÉS
// PATCH V1.2 : assumedUnitSizeM2 — trace l'hypothèse de surface/logement retenue

// ─── STATUS ───────────────────────────────────────────────────────────

/**
 * Three-level compliance status for PLU rules.
 *
 * CONFORME  — clearly compliant (within the comfortable zone)
 * LIMITE    — close to threshold, marginal compliance — warrants attention
 * BLOQUANT  — rule is violated — project cannot proceed as-is
 *
 * Severity order: CONFORME < LIMITE < BLOQUANT
 */
export type PluRuleStatus = "CONFORME" | "LIMITE" | "BLOQUANT";

/** Maps status → numeric weight for aggregation. */
export const PLU_STATUS_WEIGHT: Record<PluRuleStatus, number> = {
  CONFORME: 0,
  LIMITE:   1,
  BLOQUANT: 2,
};

// ─── RULES INPUT ──────────────────────────────────────────────────────

/**
 * Normalized PLU constraints extracted from the local PLU document.
 *
 * All fields are optional so the engine gracefully skips rules whose
 * data has not been captured. Future articles can be added here without
 * changing the engine's public API.
 *
 * ⚠️ Un champ à `undefined` = LA ZONE N'IMPOSE PAS CETTE RÈGLE (le checker
 * renvoie null, la règle disparaît du rapport). À ne jamais confondre avec 0,
 * qui serait le seuil le plus sévère possible : une zone sans CES mappée à 0
 * rendrait tout projet non conforme, et mappée à 1 afficherait « CES max 100 % »
 * — une règle inventée. Cf. mapStudyPlu (Implantation2DPage).
 *
 * Extensibility roadmap (add fields here):
 *   frontageMinMeters?      — minimum road frontage (art. 6)
 *   maxFloorAreaRatio?      — COS / SHON ratio       (art. 14)
 *   minOpenSpaceRatio?      — planted open space ratio
 *   maxUnitsPerHectare?     — density cap
 *   prospectRatio?          — H/2 view-angle rule
 *   parkingRatioByUse?      — per-usage parking breakdown
 */
export interface PluRules {
  /** Minimum setback from any parcel boundary (metres). Art. 6–7. */
  minSetbackMeters?: number;
  /** Maximum ridge or flat-roof height (metres). Art. 10. */
  maxHeightMeters?: number;
  /** Maximum ratio of built footprint to parcel area (0–1). Art. 9. */
  maxCoverageRatio?: number;
  /** Required parking spaces per residential unit. Art. 12. */
  parkingSpacesPerUnit?: number;
}

// ─── METRICS ─────────────────────────────────────────────────────────

/**
 * Project metrics computed from geometry + building programme.
 * Passed to rule-checkers as a pure data bundle.
 */
export interface PluMetricSet {
  /** Total built footprint area (m²) — sum of all building polygons. */
  footprintAreaM2: number;
  /** Parcel area (m²). */
  parcelAreaM2: number;
  /** footprintAreaM2 / parcelAreaM2. */
  coverageRatio: number;
  /** Estimated maximum height of any building (m). */
  estimatedHeightM: number;
  /** Minimum distance from any building vertex to any parcel edge (m). */
  minDistanceToParcelEdgeM: number;
  /** Computed required parking spaces (sum over all buildings). */
  requiredParkingSpaces: number;
  /** Parking spaces actually provided (from editor or manual input). */
  providedParkingSpaces: number;
  /** Number of residential units in the project. */
  totalUnits: number;
  /**
   * V1.1 — true si `totalUnits` est une ESTIMATION (SDP / assumedUnitSizeM2) et
   * non une saisie utilisateur.
   *
   * ⚠️ Une règle fondée dessus ne doit JAMAIS être BLOQUANTE : on ne bloque pas
   * un projet sur une hypothèse que l'utilisateur n'a pas formulée. Un simple
   * rectangle de 79 m² produisait « 1 logement → 2 places requises → BLOQUANT »,
   * contredit à l'écran par le panneau scénario (« stationnement non évalué »).
   * Cf. checkParkingRule, qui plafonne à LIMITE quand ce flag est vrai.
   */
  unitsEstimated: boolean;
  /**
   * V1.2 — Surface moyenne/logement réellement utilisée par l'estimation (m²).
   * Permet d'annoncer l'hypothèse dans les messages plutôt que de coder « 60 »
   * en dur dans le libellé. Non significatif si `unitsEstimated` est false.
   */
  assumedUnitSizeM2: number;
}

// ─── RULE RESULT ──────────────────────────────────────────────────────

/**
 * Result of a single rule evaluation.
 *
 * Extensibility: add `articleRef?: string` for legal article mapping,
 * `recommendation?: string` for automated suggestions, etc.
 */
export interface PluRuleResult {
  /** Machine key — stable across locales, used for sorting/filtering. */
  key: string;
  /** Human label shown in the UI. */
  label: string;
  status: PluRuleStatus;
  /** Business-readable explanation of the compliance decision. */
  message: string;
  /** Measured value (the actual project metric). */
  value?: number;
  /** Rule threshold/limit for display in comparison tables. */
  limit?: number;
  /** Unit suffix for display (e.g. "m", "m²", "%"). */
  unit?: string;
}

// ─── ENGINE RESULT ────────────────────────────────────────────────────

/**
 * Aggregated output of a full PLU check pass.
 *
 * Consumers (UI panels, PDF export, scoring) should use `globalStatus`
 * for top-level gating and `rules` for per-article drill-down.
 */
export interface PluEngineResult {
  metrics: PluMetricSet;
  /** One entry per evaluated rule (rules with undefined thresholds are omitted). */
  rules: PluRuleResult[];
  /** Worst status across all evaluated rules. */
  globalStatus: PluRuleStatus;
  /** Messages from BLOQUANT rules — for summary banners and export. */
  blockingIssues: string[];
}