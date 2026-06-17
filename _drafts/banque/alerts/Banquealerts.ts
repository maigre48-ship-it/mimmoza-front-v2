/**
 * banqueAlerts.ts
 *
 * Moteur d'alertes déterministe pour l'espace Banque Mimmoza.
 *
 * Lit les données produites par : Risques / Documents / Garanties / Comité / SmartScore
 * et génère des alertes persistées dans le snapshot banque (localStorage).
 *
 * Principes :
 *  - Déterministe : même snapshot → mêmes alertes (pas de random, pas de Date.now instable)
 *  - alertId stable = `${ruleKey}::${dossierId}` → pas d'alertes fantômes
 *  - Sévérités : critical | high | medium | low | info
 *  - Les alertes existantes conservent leur createdAt (upsert)
 *  - acknowledgedAt est préservé si l'alerte est toujours active
 */

/* ============================================================
   Types
   ============================================================ */

export type AlertSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface BanqueAlert {
  /** Stable ID: `${ruleKey}::${dossierId}` */
  id: string;
  dossierId: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  /** Clé de la règle qui a déclenché l'alerte */
  ruleKey: string;
  createdAt: string;   // ISO
  updatedAt: string;   // ISO
  /** Set par l'utilisateur, préservé tant que l'alerte est active */
  acknowledgedAt?: string; // ISO
}

export interface AlertRuleThresholds {
  /** SmartScore : alerte si le score courant est inférieur à ce seuil */
  scoreMin: number;
  /** SmartScore : alerte si le score a chuté de plus de X points vs. précédent */
  scoreDrop: number;
  /** Complétude documentaire minimum (0-100) */
  completenessMin: number;
  /** Nombre max de documents manquants obligatoires */
  missingDocsMax: number;
  /** Niveau de risque global qui déclenche une alerte */
  riskLevelHigh: string[];
  /** Délai max (jours) sans mise à jour du dossier */
  delayMaxDays: number;
  /** Ratio LTV max (%) */
  ltvMax: number;
  /** Ratio DSCR min */
  dscrMin: number;
  /** Taux de pré-commercialisation minimum (%) */
  preCommercialisationMin: number;
}

/** Données d'un dossier tel que lu dans le snapshot */
export interface DossierData {
  id: string;
  nom: string;
  emprunteur?: string;
  montant?: number;
  updatedAt?: string;
  smartScore?: {
    current?: number;
    previous?: number;
    trend?: "up" | "down" | "stable";
  };
  documents?: {
    completeness?: number; // 0-100
    missing?: string[];
    total?: number;
    validated?: number;
  };
  risques?: {
    globalLevel?: string; // "faible" | "modéré" | "élevé" | "très élevé"
    present?: number;
    unknown?: number;
    categories?: string[];
  };
  garanties?: {
    ltv?: number;  // en %
    dscr?: number;
    suretesReelles?: boolean;
    suretesPersonnelles?: boolean;
    assurances?: boolean;
  };
  comite?: {
    status?: "pending" | "approved" | "conditionalApproval" | "rejected" | "deferred";
    conditions?: string[];
    dateDecision?: string;
    conditionsMet?: number;
    conditionsTotal?: number;
  };
  monitoring?: {
    preCommercialisation?: number; // %
    avancementTravaux?: number;   // %
    derniereVisite?: string;      // ISO date
    alerts?: BanqueAlert[];
  };
}

export interface BanqueSnapshot {
  updatedAt: string;
  version: string;
  dossiersById: Record<string, DossierData>;
}

/* ============================================================
   Thresholds par défaut (configurables)
   ============================================================ */

export const DEFAULT_THRESHOLDS: AlertRuleThresholds = {
  scoreMin: 40,
  scoreDrop: 15,
  completenessMin: 80,
  missingDocsMax: 2,
  riskLevelHigh: ["élevé", "très élevé"],
  delayMaxDays: 30,
  ltvMax: 80,
  dscrMin: 1.2,
  preCommercialisationMin: 30,
};

/* ============================================================
   Rule definitions
   ============================================================ */

interface AlertRuleContext {
  dossier: DossierData;
  thresholds: AlertRuleThresholds;
  now: string; // ISO timestamp passé en paramètre pour déterminisme
}

interface AlertRuleDef {
  key: string;
  evaluate: (ctx: AlertRuleContext) => { fire: boolean; severity: AlertSeverity; title: string; message: string } | null;
}

const RULES: AlertRuleDef[] = [
  // ─── SmartScore ───────────────────────────────────────────
  {
    key: "score_below_min",
    evaluate: ({ dossier, thresholds }) => {
      const score = dossier.smartScore?.current;
      if (score == null) return null;
      if (score >= thresholds.scoreMin) return null;
      return {
        fire: true,
        severity: score < 25 ? "critical" : "high",
        title: "SmartScore critique",
        message: `Score ${score}/100 (seuil : ${thresholds.scoreMin}). Dossier « ${dossier.nom} » nécessite une revue immédiate.`,
      };
    },
  },
  {
    key: "score_drop",
    evaluate: ({ dossier, thresholds }) => {
      const { current, previous } = dossier.smartScore ?? {};
      if (current == null || previous == null) return null;
      const drop = previous - current;
      if (drop < thresholds.scoreDrop) return null;
      return {
        fire: true,
        severity: drop >= 25 ? "critical" : "high",
        title: "Chute du SmartScore",
        message: `Score passé de ${previous} à ${current} (−${drop} pts) pour « ${dossier.nom} ».`,
      };
    },
  },

  // ─── Documents ────────────────────────────────────────────
  {
    key: "docs_completeness_low",
    evaluate: ({ dossier, thresholds }) => {
      const pct = dossier.documents?.completeness;
      if (pct == null) return null;
      if (pct >= thresholds.completenessMin) return null;
      return {
        fire: true,
        severity: pct < 50 ? "high" : "medium",
        title: "Complétude documentaire insuffisante",
        message: `${pct}% de documents validés (min : ${thresholds.completenessMin}%) pour « ${dossier.nom} ».`,
      };
    },
  },
  {
    key: "docs_missing_critical",
    evaluate: ({ dossier, thresholds }) => {
      const missing = dossier.documents?.missing ?? [];
      if (missing.length <= thresholds.missingDocsMax) return null;
      return {
        fire: true,
        severity: missing.length > 5 ? "high" : "medium",
        title: "Documents obligatoires manquants",
        message: `${missing.length} doc(s) manquant(s) : ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""} — dossier « ${dossier.nom} ».`,
      };
    },
  },

  // ─── Risques ──────────────────────────────────────────────
  {
    key: "risk_level_high",
    evaluate: ({ dossier, thresholds }) => {
      const level = dossier.risques?.globalLevel;
      if (!level) return null;
      if (!thresholds.riskLevelHigh.includes(level)) return null;
      const isCritical = level === "très élevé";
      return {
        fire: true,
        severity: isCritical ? "critical" : "high",
        title: `Niveau de risque ${level}`,
        message: `Analyse de risques — niveau global « ${level} » (${dossier.risques?.present ?? "?"} risque(s) identifié(s)) pour « ${dossier.nom} ».`,
      };
    },
  },
  {
    key: "risk_unknown_high",
    evaluate: ({ dossier }) => {
      const unknown = dossier.risques?.unknown ?? 0;
      if (unknown < 3) return null;
      return {
        fire: true,
        severity: "medium",
        title: "Risques non évalués",
        message: `${unknown} catégorie(s) de risque non évaluée(s) pour « ${dossier.nom} ». Analyse incomplète.`,
      };
    },
  },

  // ─── Garanties ────────────────────────────────────────────
  {
    key: "ltv_exceeded",
    evaluate: ({ dossier, thresholds }) => {
      const ltv = dossier.garanties?.ltv;
      if (ltv == null) return null;
      if (ltv <= thresholds.ltvMax) return null;
      return {
        fire: true,
        severity: ltv > 90 ? "critical" : "high",
        title: "LTV dépassé",
        message: `LTV à ${ltv.toFixed(1)}% (max : ${thresholds.ltvMax}%) pour « ${dossier.nom} ».`,
      };
    },
  },
  {
    key: "dscr_low",
    evaluate: ({ dossier, thresholds }) => {
      const dscr = dossier.garanties?.dscr;
      if (dscr == null) return null;
      if (dscr >= thresholds.dscrMin) return null;
      return {
        fire: true,
        severity: dscr < 1.0 ? "critical" : "high",
        title: "DSCR insuffisant",
        message: `DSCR à ${dscr.toFixed(2)} (min : ${thresholds.dscrMin}) pour « ${dossier.nom} ». Capacité de remboursement fragile.`,
      };
    },
  },
  {
    key: "no_suretes",
    evaluate: ({ dossier }) => {
      const g = dossier.garanties;
      if (!g) return null;
      if (g.suretesReelles || g.suretesPersonnelles) return null;
      // Si on a des données garanties mais aucune sûreté
      if (g.ltv != null || g.dscr != null) {
        return {
          fire: true,
          severity: "high",
          title: "Aucune sûreté constituée",
          message: `Dossier « ${dossier.nom} » : ni sûreté réelle ni sûreté personnelle constituée.`,
        };
      }
      return null;
    },
  },

  // ─── Comité ───────────────────────────────────────────────
  {
    key: "comite_conditions_pending",
    evaluate: ({ dossier }) => {
      const c = dossier.comite;
      if (!c || c.status !== "conditionalApproval") return null;
      const met = c.conditionsMet ?? 0;
      const total = c.conditionsTotal ?? 0;
      if (total === 0 || met >= total) return null;
      const remaining = total - met;
      return {
        fire: true,
        severity: remaining > 3 ? "high" : "medium",
        title: "Conditions suspensives en attente",
        message: `${remaining}/${total} condition(s) non levée(s) pour « ${dossier.nom} ».`,
      };
    },
  },
  {
    key: "comite_rejected",
    evaluate: ({ dossier }) => {
      if (dossier.comite?.status !== "rejected") return null;
      return {
        fire: true,
        severity: "critical",
        title: "Dossier rejeté par le comité",
        message: `Le comité a rejeté le dossier « ${dossier.nom} ». Action corrective requise.`,
      };
    },
  },

  // ─── Monitoring / Délai ────────────────────────────────────
  {
    key: "dossier_stale",
    evaluate: ({ dossier, thresholds, now }) => {
      const lastUpdate = dossier.updatedAt;
      if (!lastUpdate) return null;
      const diffMs = new Date(now).getTime() - new Date(lastUpdate).getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays < thresholds.delayMaxDays) return null;
      return {
        fire: true,
        severity: diffDays > 60 ? "high" : "medium",
        title: "Dossier sans mise à jour",
        message: `Dossier « ${dossier.nom} » non mis à jour depuis ${Math.round(diffDays)} jours (seuil : ${thresholds.delayMaxDays}j).`,
      };
    },
  },
  {
    key: "pre_commercialisation_low",
    evaluate: ({ dossier, thresholds }) => {
      const pct = dossier.monitoring?.preCommercialisation;
      if (pct == null) return null;
      if (pct >= thresholds.preCommercialisationMin) return null;
      return {
        fire: true,
        severity: pct < 10 ? "high" : "medium",
        title: "Pré-commercialisation faible",
        message: `${pct}% de pré-commercialisation (min attendu : ${thresholds.preCommercialisationMin}%) pour « ${dossier.nom} ».`,
      };
    },
  },
];

/* ============================================================
   Helpers
   ============================================================ */

/** Génère un alertId stable et déterministe */
function makeAlertId(ruleKey: string, dossierId: string): string {
  return `${ruleKey}::${dossierId}`;
}

/** Index les alertes existantes par id pour lookup O(1) */
function indexExistingAlerts(alerts: BanqueAlert[]): Map<string, BanqueAlert> {
  const map = new Map<string, BanqueAlert>();
  for (const a of alerts) {
    map.set(a.id, a);
  }
  return map;
}

/* ============================================================
   Core engine
   ============================================================ */

export interface RunAlertsOptions {
  thresholds?: Partial<AlertRuleThresholds>;
  /** Timestamp ISO pour le calcul (déterminisme en tests). Défaut: new Date().toISOString() */
  now?: string;
  /** Filtrer sur des ruleKeys spécifiques (utile pour re-run partiel) */
  onlyRules?: string[];
}

/**
 * Évalue toutes les règles sur tous les dossiers du snapshot.
 * Retourne un nouveau snapshot avec les alertes patchées par dossier.
 *
 * ⚠️ Fonction pure : ne mute pas le snapshot d'entrée.
 */
export function runAlerts(
  snapshot: BanqueSnapshot,
  options: RunAlertsOptions = {}
): BanqueSnapshot {
  const now = options.now ?? new Date().toISOString();
  const thresholds: AlertRuleThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...options.thresholds,
  };

  const activeRules = options.onlyRules
    ? RULES.filter((r) => options.onlyRules!.includes(r.key))
    : RULES;

  const newDossiers: Record<string, DossierData> = {};

  for (const [dossierId, dossier] of Object.entries(snapshot.dossiersById)) {
    const existingAlerts = indexExistingAlerts(
      dossier.monitoring?.alerts ?? []
    );

    const newAlerts: BanqueAlert[] = [];

    for (const rule of activeRules) {
      const result = rule.evaluate({ dossier, thresholds, now });
      const alertId = makeAlertId(rule.key, dossierId);

      if (result && result.fire) {
        const existing = existingAlerts.get(alertId);
        newAlerts.push({
          id: alertId,
          dossierId,
          severity: result.severity,
          title: result.title,
          message: result.message,
          ruleKey: rule.key,
          // Préserver createdAt si l'alerte existait déjà
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          // Préserver acknowledgedAt si l'utilisateur l'a déjà acquittée
          acknowledgedAt: existing?.acknowledgedAt,
        });
      }
      // Si result est null ou fire=false → l'alerte disparaît (résolue)
    }

    // Si onlyRules est spécifié, préserver les alertes des règles non évaluées
    if (options.onlyRules) {
      const evaluatedKeys = new Set(activeRules.map((r) => r.key));
      const preserved = (dossier.monitoring?.alerts ?? []).filter(
        (a) => !evaluatedKeys.has(a.ruleKey)
      );
      newAlerts.push(...preserved);
    }

    // Tri stable : critical > high > medium > low > info, puis par createdAt
    const severityOrder: Record<AlertSeverity, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
      info: 4,
    };
    newAlerts.sort((a, b) => {
      const diff = severityOrder[a.severity] - severityOrder[b.severity];
      if (diff !== 0) return diff;
      return a.createdAt.localeCompare(b.createdAt);
    });

    newDossiers[dossierId] = {
      ...dossier,
      monitoring: {
        ...dossier.monitoring,
        alerts: newAlerts,
      },
    };
  }

  return {
    ...snapshot,
    updatedAt: now,
    dossiersById: newDossiers,
  };
}

/* ============================================================
   Snapshot persistence (localStorage)
   ============================================================ */

const STORAGE_KEY = "mimmoza.banque.snapshot.v1";
const SNAPSHOT_VERSION = "1.0.0";

/** Lit le snapshot banque depuis localStorage */
export function readBanqueSnapshot(): BanqueSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptySnapshot();
    const parsed = JSON.parse(raw) as BanqueSnapshot;
    return parsed;
  } catch (e) {
    console.warn("[banqueAlerts] Failed to read snapshot:", e);
    return createEmptySnapshot();
  }
}

/** Écrit le snapshot banque dans localStorage */
export function writeBanqueSnapshot(snapshot: BanqueSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.error("[banqueAlerts] Failed to write snapshot:", e);
  }
}

/** Crée un snapshot vide */
export function createEmptySnapshot(): BanqueSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    version: SNAPSHOT_VERSION,
    dossiersById: {},
  };
}

/** Patch un dossier dans le snapshot (merge) */
export function patchDossier(
  dossierId: string,
  patch: Partial<DossierData>
): BanqueSnapshot {
  const snap = readBanqueSnapshot();
  const existing = snap.dossiersById[dossierId] ?? { id: dossierId, nom: dossierId };
  snap.dossiersById[dossierId] = {
    ...existing,
    ...patch,
    id: dossierId,
    updatedAt: new Date().toISOString(),
  };
  snap.updatedAt = new Date().toISOString();
  writeBanqueSnapshot(snap);
  return snap;
}

/* ============================================================
   High-level API
   ============================================================ */

/**
 * Lit le snapshot, exécute runAlerts, persiste le résultat.
 * C'est le point d'entrée principal appelé par les pages.
 */
export function runAndPersistAlerts(
  options: RunAlertsOptions = {}
): BanqueSnapshot {
  const snapshot = readBanqueSnapshot();
  const updated = runAlerts(snapshot, options);
  writeBanqueSnapshot(updated);
  return updated;
}

/**
 * Acquitte une alerte (l'utilisateur a vu et accepté).
 * Ne supprime pas l'alerte, juste pose un acknowledgedAt.
 */
export function acknowledgeAlert(
  dossierId: string,
  alertId: string
): BanqueSnapshot {
  const snap = readBanqueSnapshot();
  const dossier = snap.dossiersById[dossierId];
  if (!dossier?.monitoring?.alerts) return snap;

  const now = new Date().toISOString();
  dossier.monitoring.alerts = dossier.monitoring.alerts.map((a) =>
    a.id === alertId ? { ...a, acknowledgedAt: now, updatedAt: now } : a
  );
  snap.updatedAt = now;
  writeBanqueSnapshot(snap);
  return snap;
}

/**
 * Retourne toutes les alertes de tous les dossiers, aplaties.
 */
export function getAllAlerts(snapshot?: BanqueSnapshot): BanqueAlert[] {
  const snap = snapshot ?? readBanqueSnapshot();
  const all: BanqueAlert[] = [];
  for (const dossier of Object.values(snap.dossiersById)) {
    if (dossier.monitoring?.alerts) {
      all.push(...dossier.monitoring.alerts);
    }
  }
  return all;
}

/**
 * Stats rapides pour le dashboard.
 */
export function getAlertStats(snapshot?: BanqueSnapshot): {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  unacknowledged: number;
} {
  const alerts = getAllAlerts(snapshot);
  return {
    total: alerts.length,
    critical: alerts.filter((a) => a.severity === "critical").length,
    high: alerts.filter((a) => a.severity === "high").length,
    medium: alerts.filter((a) => a.severity === "medium").length,
    low: alerts.filter((a) => a.severity === "low").length,
    info: alerts.filter((a) => a.severity === "info").length,
    unacknowledged: alerts.filter((a) => !a.acknowledgedAt).length,
  };
}

/**
 * Liste des ruleKeys disponibles (pour UI filtres).
 */
export function getAvailableRuleKeys(): { key: string; label: string }[] {
  return RULES.map((r) => ({
    key: r.key,
    label: ruleKeyLabels[r.key] ?? r.key,
  }));
}

const ruleKeyLabels: Record<string, string> = {
  score_below_min: "SmartScore bas",
  score_drop: "Chute SmartScore",
  docs_completeness_low: "Complétude docs",
  docs_missing_critical: "Docs manquants",
  risk_level_high: "Risque élevé",
  risk_unknown_high: "Risques non évalués",
  ltv_exceeded: "LTV dépassé",
  dscr_low: "DSCR faible",
  no_suretes: "Pas de sûretés",
  comite_conditions_pending: "Conditions suspensives",
  comite_rejected: "Rejet comité",
  dossier_stale: "Dossier inactif",
  pre_commercialisation_low: "Pré-commercialisation",
};

/* ============================================================
   Mock data (dev/demo)
   ============================================================ */

export function seedDemoDossiers(): BanqueSnapshot {
  const snap = createEmptySnapshot();
  snap.dossiersById = {
    "DOS-2026-001": {
      id: "DOS-2026-001",
      nom: "Résidence Les Ormes — Lyon 3e",
      emprunteur: "SCI Les Ormes",
      montant: 4_200_000,
      updatedAt: "2026-01-15T10:00:00Z",
      smartScore: { current: 72, previous: 78, trend: "down" },
      documents: { completeness: 85, missing: ["Permis de construire"], total: 12, validated: 10 },
      risques: { globalLevel: "modéré", present: 3, unknown: 1, categories: ["inondation", "séisme", "radon"] },
      garanties: { ltv: 65, dscr: 1.35, suretesReelles: true, suretesPersonnelles: false, assurances: true },
      comite: { status: "conditionalApproval", conditionsMet: 2, conditionsTotal: 4, dateDecision: "2026-01-10" },
      monitoring: { preCommercialisation: 45, avancementTravaux: 20 },
    },
    "DOS-2026-002": {
      id: "DOS-2026-002",
      nom: "Parc Activités Bron",
      emprunteur: "SARL Bron Invest",
      montant: 8_500_000,
      updatedAt: "2025-11-01T09:00:00Z",
      smartScore: { current: 35, previous: 62, trend: "down" },
      documents: { completeness: 45, missing: ["Étude de sol", "Permis", "Bail commercial", "K-bis"], total: 15, validated: 7 },
      risques: { globalLevel: "élevé", present: 5, unknown: 3, categories: ["inondation", "pollution", "séisme", "mouvement terrain", "cavités"] },
      garanties: { ltv: 88, dscr: 0.95, suretesReelles: false, suretesPersonnelles: false, assurances: false },
      comite: { status: "rejected", dateDecision: "2025-12-20" },
      monitoring: { preCommercialisation: 8, avancementTravaux: 0 },
    },
    "DOS-2026-003": {
      id: "DOS-2026-003",
      nom: "Villa Prestige Annecy",
      emprunteur: "M. Dupont",
      montant: 1_200_000,
      updatedAt: "2026-02-01T14:00:00Z",
      smartScore: { current: 88, previous: 85, trend: "up" },
      documents: { completeness: 95, missing: [], total: 8, validated: 8 },
      risques: { globalLevel: "faible", present: 1, unknown: 0, categories: ["séisme"] },
      garanties: { ltv: 55, dscr: 1.8, suretesReelles: true, suretesPersonnelles: true, assurances: true },
      comite: { status: "approved", conditionsMet: 3, conditionsTotal: 3, dateDecision: "2026-01-28" },
      monitoring: { preCommercialisation: 100, avancementTravaux: 60 },
    },
  };

  // Run alerts puis persiste
  const withAlerts = runAlerts(snap);
  writeBanqueSnapshot(withAlerts);
  return withAlerts;
}