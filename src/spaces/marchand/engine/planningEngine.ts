// src/spaces/marchand/engine/planningEngine.ts
// =============================================================================
// MOTEUR DE PLANIFICATION D'OPÉRATION — déterministe, modulaire, extensible.
//
// Génère un planning réaliste par phase (Études → Vente), avec :
//   - durées calculées par phase (cadences, pas un simple jours/m²)
//   - dépendances finish-to-start ET démarrages en parallèle (commercialisation)
//   - chemin critique
//   - durée totale + date de livraison estimée
//
// Aucune IA. Entièrement déterministe. Aucune dépendance externe.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

export const OperationType = {
  Rafraichissement:        "rafraichissement",
  RehabilitationLegere:    "rehabilitation_legere",
  RehabilitationLourde:    "rehabilitation_lourde",
  RestructurationComplete: "restructuration_complete",
  ConstructionNeuve:       "construction_neuve",
} as const;
export type OperationType = (typeof OperationType)[keyof typeof OperationType];

export const Complexity = {
  Simple:        "simple",
  Standard:      "standard",
  Contraint:     "contraint",
  TresContraint: "tres_contraint",
} as const;
export type Complexity = (typeof Complexity)[keyof typeof Complexity];

export type PhaseId =
  | "etudes"
  | "administratif"
  | "consultation"
  | "travaux"
  | "reception"
  | "commercialisation"
  | "vente";

// ─────────────────────────────────────────────────────────────────────────────
// PARAMÈTRES D'ENTRÉE
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanningInputs {
  /** Surface concernée en m² (SDP pour du neuf, surface travaux sinon). */
  surface: number;
  /** Type d'opération → pilote la cadence de la phase Travaux. */
  operationType: OperationType;
  /** Niveau de contrainte global → coefficients multiplicateurs. */
  complexity: Complexity;

  /** Nombre d'équipes travaillant en parallèle sur le chantier (défaut 1). */
  teams?: number;
  /** Nombre de niveaux (R+n). Ajoute de la coordination. Défaut 1. */
  levels?: number;
  /** Présence d'un sous-sol (terrassement, étanchéité…). Défaut false. */
  hasBasement?: boolean;
  /** Installation d'un ascenseur (lot long + démarches). Défaut false. */
  hasElevator?: boolean;

  // — Démarches administratives (déduites du type si non fournies) —
  requiresPC?: boolean;            // permis de construire
  requiresDP?: boolean;            // déclaration préalable
  permisModificatif?: boolean;

  // — Overrides avancés (tous optionnels) —
  /** Cadence m²/jour/équipe. Écrase la valeur par défaut du type d'opération. */
  cadenceOverride?: number;
  /** Ratio d'avancement des travaux déclenchant la commercialisation (0–1). */
  commercialisationStartRatio?: number;
  /** Date de démarrage (jour 0). Si fournie, calcule les dates réelles. */
  startDate?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// RÉSULTAT
// ─────────────────────────────────────────────────────────────────────────────

export interface PhaseResult {
  id: PhaseId;
  label: string;
  startDay: number;
  duration: number;
  endDay: number;
  parallel: boolean;
  /** Phase dont la fin (ou l'avancement) conditionne le début de celle-ci. */
  driver: PhaseId | null;
  /** Dates réelles si `startDate` a été fournie en entrée. */
  startDate?: Date;
  endDate?: Date;
}

export interface PlanningResult {
  totalDays: number;
  criticalPath: PhaseId[];
  phases: PhaseResult[];
  estimatedDeliveryDate?: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLES DE RÉFÉRENCE (calibrables)
// ─────────────────────────────────────────────────────────────────────────────

/** Cadence de production, en m²/jour/équipe. */
const CADENCE_M2_PER_DAY: Record<OperationType, number> = {
  [OperationType.Rafraichissement]:        7,
  [OperationType.RehabilitationLegere]:    5,
  [OperationType.RehabilitationLourde]:    3,
  [OperationType.RestructurationComplete]: 2,
  [OperationType.ConstructionNeuve]:       15, // SDP/jour, à calibrer par typologie
};

/** Base "Études" en jours, selon l'ampleur de l'opération. */
const ETUDES_BASE: Record<OperationType, number> = {
  [OperationType.Rafraichissement]:        3,
  [OperationType.RehabilitationLegere]:    4,
  [OperationType.RehabilitationLourde]:    6,
  [OperationType.RestructurationComplete]: 8,
  [OperationType.ConstructionNeuve]:       10,
};

/** Coefficients multiplicateurs par niveau de complexité. */
const COMPLEXITY_COEF: Record<Complexity, { etudes: number; travaux: number; reception: number; admin: number }> = {
  [Complexity.Simple]:        { etudes: 1.00, travaux: 1.00, reception: 1.00, admin: 1.00 },
  [Complexity.Standard]:      { etudes: 1.10, travaux: 1.10, reception: 1.10, admin: 1.05 },
  [Complexity.Contraint]:     { etudes: 1.20, travaux: 1.20, reception: 1.20, admin: 1.15 },
  [Complexity.TresContraint]: { etudes: 1.35, travaux: 1.35, reception: 1.35, admin: 1.30 },
};

const PHASE_LABELS: Record<PhaseId, string> = {
  etudes:            "Études",
  administratif:     "Administratif",
  consultation:      "Consultation entreprises",
  travaux:           "Travaux",
  reception:         "Réception",
  commercialisation: "Commercialisation",
  vente:             "Vente",
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const positive = (v: number | undefined, fallback: number) =>
  typeof v === "number" && isFinite(v) && v > 0 ? v : fallback;

/** Démarches par défaut selon le type d'opération. */
function defaultAdminFlags(t: OperationType) {
  const heavy = t === OperationType.ConstructionNeuve || t === OperationType.RestructurationComplete;
  return {
    requiresPC: heavy,
    requiresDP: !heavy && t !== OperationType.Rafraichissement,
    permisModificatif: false,
  };
}

/** Ratio de déclenchement de la commercialisation par défaut, selon le type. */
function defaultCommercialisationRatio(t: OperationType): number {
  // Le neuf se commercialise tôt (VEFA) ; la réhab plutôt en fin de chantier.
  return t === OperationType.ConstructionNeuve ? 0.4 : 0.8;
}

// ─────────────────────────────────────────────────────────────────────────────
// CALCUL DES DURÉES PAR PHASE
// ─────────────────────────────────────────────────────────────────────────────

function computeDurations(inp: PlanningInputs): Record<PhaseId, number> {
  const surface = Math.max(0, inp.surface);
  const teams   = positive(inp.teams, 1);
  const levels  = positive(inp.levels, 1);
  const coef    = COMPLEXITY_COEF[inp.complexity];
  const admin   = { ...defaultAdminFlags(inp.operationType), ...pickAdmin(inp) };

  // 1) ÉTUDES — quasi indépendant de la surface, sensible à l'ampleur + complexité.
  const etudes = clamp(
    Math.round(ETUDES_BASE[inp.operationType] * coef.etudes * (1 + 0.05 * (levels - 1))),
    3, 20,
  );

  // 2) ADMINISTRATIF — base 5 j + démarches.
  let administratif = 5;
  if (admin.requiresPC)        administratif += 20;
  if (admin.requiresDP)        administratif += 8;
  if (admin.permisModificatif) administratif += 10;
  if (inp.hasElevator)         administratif += 5; // autorisations / lot spécifique
  administratif = Math.round(administratif * coef.admin);

  // 3) CONSULTATION ENTREPRISES — base 10 j (7–15), sensible à la complexité.
  const consultation = clamp(Math.round(10 * coef.etudes), 7, 20);

  // 4) TRAVAUX — cœur du planning, par cadence, pas par jours/m².
  const cadence = positive(inp.cadenceOverride, CADENCE_M2_PER_DAY[inp.operationType]);
  let travaux = surface > 0 ? surface / (cadence * teams) : 0;
  travaux *= coef.travaux;
  travaux *= 1 + 0.05 * (levels - 1);      // coordination multi-niveaux
  if (inp.hasBasement) travaux *= 1.15;    // terrassement / étanchéité
  if (inp.hasElevator) travaux += 10;      // pose ascenseur (lot long)
  travaux = Math.max(1, Math.ceil(travaux));

  // 5) RÉCEPTION — base 5 j, sensible à la complexité (réserves).
  const reception = clamp(Math.round(5 * coef.reception), 3, 15);

  // 6) COMMERCIALISATION — proportionnelle mais plafonnée [20 ; 60].
  const commercialisation = clamp(Math.round(surface * 0.3), 20, 60);

  // 7) VENTE — durée fixe (délais de signature).
  const vente = 7;

  return { etudes, administratif, consultation, travaux, reception, commercialisation, vente };
}

function pickAdmin(inp: PlanningInputs) {
  const out: Partial<ReturnType<typeof defaultAdminFlags>> = {};
  if (typeof inp.requiresPC === "boolean")        out.requiresPC = inp.requiresPC;
  if (typeof inp.requiresDP === "boolean")        out.requiresDP = inp.requiresDP;
  if (typeof inp.permisModificatif === "boolean") out.permisModificatif = inp.permisModificatif;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDONNANCEMENT (DAG)
// ─────────────────────────────────────────────────────────────────────────────
// Chaque phase déclare ses contraintes de début :
//   - FS (finish-to-start) : start ≥ fin(dep)
//   - SS-ratio             : start ≥ début(dep) + ratio × durée(dep)  (parallélisme)
// Le "driver" retenu = la contrainte la plus tardive → sert au chemin critique.

interface Constraint { on: PhaseId; kind: "FS" | "SS"; ratio?: number; }

function schedule(
  durations: Record<PhaseId, number>,
  constraints: Record<PhaseId, Constraint[]>,
  order: PhaseId[],
): Record<PhaseId, { start: number; end: number; driver: PhaseId | null }> {
  const sched: Record<string, { start: number; end: number; driver: PhaseId | null }> = {};

  for (const id of order) {
    let start = 0;
    let driver: PhaseId | null = null;

    for (const c of constraints[id] ?? []) {
      const dep = sched[c.on];
      if (!dep) continue;
      const candidate =
        c.kind === "FS"
          ? dep.end
          : dep.start + (c.ratio ?? 0) * durations[c.on];
      if (candidate > start) {
        start = candidate;
        driver = c.on;
      }
    }

    const startDay = Math.round(start);
    sched[id] = { start: startDay, end: startDay + durations[id], driver };
  }

  return sched as Record<PhaseId, { start: number; end: number; driver: PhaseId | null }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOTEUR PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export function computePlanning(inp: PlanningInputs): PlanningResult {
  const durations = computeDurations(inp);
  const ratio = clamp(
    positive(inp.commercialisationStartRatio, defaultCommercialisationRatio(inp.operationType)),
    0, 1,
  );

  // Graphe de dépendances.
  const constraints: Record<PhaseId, Constraint[]> = {
    etudes:            [],
    administratif:     [{ on: "etudes", kind: "FS" }],
    consultation:      [{ on: "administratif", kind: "FS" }],
    travaux:           [{ on: "consultation", kind: "FS" }],
    reception:         [{ on: "travaux", kind: "FS" }],
    // Démarre pendant les travaux (parallèle), à `ratio` d'avancement.
    commercialisation: [{ on: "travaux", kind: "SS", ratio }],
    // La vente attend la fin de la réception ET de la commercialisation.
    vente:             [{ on: "reception", kind: "FS" }, { on: "commercialisation", kind: "FS" }],
  };

  const order: PhaseId[] = [
    "etudes", "administratif", "consultation", "travaux",
    "reception", "commercialisation", "vente",
  ];

  const sched = schedule(durations, constraints, order);

  const parallelPhases = new Set<PhaseId>(["commercialisation"]);

  const phases: PhaseResult[] = order.map((id) => {
    const s = sched[id];
    const res: PhaseResult = {
      id,
      label: PHASE_LABELS[id],
      startDay: s.start,
      duration: durations[id],
      endDay: s.end,
      parallel: parallelPhases.has(id),
      driver: s.driver,
    };
    if (inp.startDate) {
      res.startDate = addDays(inp.startDate, s.start);
      res.endDate = addDays(inp.startDate, s.end);
    }
    return res;
  });

  // Durée totale = fin de la dernière phase.
  const totalDays = phases.reduce((max, p) => Math.max(max, p.endDay), 0);

  // Chemin critique : on part de la phase qui termine le plus tard,
  // puis on remonte les "drivers".
  const criticalPath = buildCriticalPath(phases, totalDays);

  return {
    totalDays,
    criticalPath,
    phases,
    estimatedDeliveryDate: inp.startDate ? addDays(inp.startDate, totalDays) : undefined,
  };
}

function buildCriticalPath(phases: PhaseResult[], totalDays: number): PhaseId[] {
  const byId = new Map<PhaseId, PhaseResult>(phases.map((p) => [p.id, p]));
  let current: PhaseResult | undefined = phases
    .filter((p) => p.endDay === totalDays)
    .sort((a, b) => a.startDay - b.startDay)[0];

  const path: PhaseId[] = [];
  const seen = new Set<PhaseId>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.id);
    current = current.driver ? byId.get(current.driver) ?? undefined : undefined;
  }
  return path;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + Math.round(days));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADAPTATEUR — mappe la sortie de "Simulation Travaux" vers les inputs du moteur.
// (À ajuster selon ce que la page persiste réellement dans le snapshot.)
// ─────────────────────────────────────────────────────────────────────────────

/** Niveau de rénovation tel qu'affiché dans Simulation → type d'opération. */
/** RenovationLevel de Simulation ("refresh|standard|heavy|full") → type d'opération. */
export function operationTypeFromRenovLevel(
  level: "refresh" | "standard" | "heavy" | "full",
): OperationType {
  switch (level) {
    case "refresh":  return OperationType.Rafraichissement;
    case "standard": return OperationType.RehabilitationLegere;
    case "heavy":    return OperationType.RehabilitationLourde;
    case "full":     return OperationType.RestructurationComplete;
    default:         return OperationType.RehabilitationLegere;
  }
}

/** Curseur de complexité chantier (0–4) → enum Complexity. */
export function complexityFromSlider(slider: number): Complexity {
  if (slider <= 1) return Complexity.Simple;
  if (slider === 2) return Complexity.Standard;
  if (slider === 3) return Complexity.Contraint;
  return Complexity.TresContraint;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXEMPLES (sanity check — à supprimer ou déplacer en test)
// ─────────────────────────────────────────────────────────────────────────────
//
// Réno légère 10 m² :
//   computePlanning({ surface: 10, operationType: OperationType.RehabilitationLegere,
//                     complexity: Complexity.Simple })
//   → travaux ≈ 2 j, totalDays ≈ 40 j (dominé par admin+conso+commercialisation mini).
//
// Réno complète 200 m² :
//   computePlanning({ surface: 200, operationType: OperationType.RestructurationComplete,
//                     complexity: Complexity.Contraint })
//   → travaux ≈ 120 j, totalDays ≈ 150+ j.
//
// La durée n'est plus jamais identique entre ces deux cas.