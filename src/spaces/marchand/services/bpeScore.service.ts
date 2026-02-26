/**
 * bpeScore.service.ts
 * ─────────────────────────────────────────────────────────────────────
 * Scoring BPE (Base Permanente des Équipements) — Marchand (Mimmoza)
 *
 * Objectif:
 *  - Produire un score stable 0..100
 *  - Exploitable par SmartScore / OpportunityScore / IA export
 *  - Robuste aux données partielles
 *
 * Modèle:
 *  - Pour chaque catégorie: score = wQ * scoreQuantité + wP * scoreProximité
 *  - scoreQuantité: fonction saturante (logistique douce) basée sur "targets"
 *  - scoreProximité: courbe continue (exp/gauss) selon distance moyenne (m)
 *  - Agrégation: somme pondérée des catégories
 *  - Robustesse: renormalisation sur les catégories effectivement présentes
 */

export type ProjectType = "logement" | "commerce" | "bureau" | "ehpad" | "hotel";

export type BpeCategoryKey =
  | "supermarche"
  | "pharmacie"
  | "restaurant"
  | "transport"
  | "ecole"
  | "sante";

export interface BpeCategoryData {
  /**
   * Nombre d'équipements (dans un rayon cohérent avec ton back: ex 1–2km).
   * Doit être >= 0.
   */
  count: number;
  /**
   * Distance moyenne (mètres) aux équipements détectés.
   * null/undefined si non calculé.
   */
  distanceAvg?: number | null;
}

export interface BpeInput {
  projectType: ProjectType;
  /**
   * Catégories disponibles.
   * Si une catégorie est absente → non utilisée dans l'agrégation.
   */
  categories: Partial<Record<BpeCategoryKey, BpeCategoryData>>;
}

export interface BpeCategoryBreakdown {
  available: boolean; // catégorie présente dans l'input
  weight: number; // poids de catégorie (0..1)
  weightNormalized: number; // poids renormalisé (0..1 sur le sous-ensemble dispo)
  targets: { good: number; excellent: number }; // cibles quantité
  distance: {
    good: number; // distance "bonne" (m)
    ok: number; // distance "acceptable" (m)
    bad: number; // distance "mauvaise" (m)
  };
  quantity: {
    count: number;
    score: number; // 0..100
  };
  proximity: {
    distanceAvg: number | null;
    score: number; // 0..100
  };
  combined: {
    wQuantity: number; // pondération interne quantité
    wProximity: number; // pondération interne proximité
    score: number; // 0..100
    contribution: number; // contribution pondérée au score total (0..100)
  };
}

export interface BpeScoreResult {
  score: number; // 0..100
  coveragePct: number; // % de poids couvert par les catégories présentes
  breakdown: Record<BpeCategoryKey, BpeCategoryBreakdown>;
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Utils                                                                       */
/* ──────────────────────────────────────────────────────────────────────────── */

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function safeNumber(n: unknown): number | null {
  if (typeof n !== "number") return null;
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Score quantité: saturant, stable, sans paliers brusques.
 *
 * good/excellent définissent l'échelle.
 * - count = 0 -> proche de 0
 * - count = good -> ~70
 * - count = excellent -> ~90-95
 *
 * Courbe: logistique douce autour de good.
 */
function scoreQuantity(count: number, good: number, excellent: number): number {
  const c = Math.max(0, count);
  const g = Math.max(1, good);
  const e = Math.max(g + 1, excellent);

  // Normalisation sur une échelle logique:
  // x = c / g  => x=1 autour de "good"
  const x = c / g;

  // logistique: 0..1
  // k règle la pente; x0 centre vers 1 ("good")
  const k = 2.2;
  const x0 = 1.0;
  const logistic = 1 / (1 + Math.exp(-k * (x - x0)));

  // On mappe pour que x=1 (good) ~70
  // et qu'on atteigne ~95 vers excellent.
  // Ajustement par un facteur basé sur e/g.
  const stretch = Math.log((e / g) + 1); // > 0

  // On "boost" un peu quand x dépasse excellent/g
  const boost = Math.min(1, Math.log((c + 1) / (e + 1) + 1) / (stretch || 1));

  // Base score (0..92 environ) + petit boost (0..8)
  const base = logistic * 92;
  const extra = clamp(boost * 8, 0, 8);

  return clamp(base + extra, 0, 100);
}

/**
 * Score proximité: courbe continue basée sur la distance moyenne (m).
 *
 * - <= good : ~95-100
 * - good..ok : décroissance douce
 * - ok..bad : décroissance plus rapide
 * - >= bad : tend vers 0-10
 *
 * On utilise une combinaison exp pour éviter les ruptures.
 */
function scoreProximity(
  distanceAvg: number | null,
  good: number,
  ok: number,
  bad: number
): number {
  const d = distanceAvg == null ? null : Math.max(0, distanceAvg);

  if (d == null) return 0;

  const g = Math.max(50, good);
  const o = Math.max(g + 50, ok);
  const b = Math.max(o + 100, bad);

  if (d <= g) {
    // très bon, on récompense légèrement la très grande proximité
    const t = d / g; // 0..1
    return clamp(100 - 5 * t, 90, 100);
  }

  if (d <= o) {
    // zone acceptable: décroissance douce
    const t = (d - g) / (o - g); // 0..1
    const s = 90 * Math.exp(-1.2 * t); // ~90 -> ~27
    return clamp(s, 25, 90);
  }

  if (d <= b) {
    // zone mauvaise: décroissance plus rapide
    const t = (d - o) / (b - o); // 0..1
    const s = 25 * Math.exp(-2.0 * t); // ~25 -> ~3.4
    return clamp(s, 0, 25);
  }

  return 0;
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Configuration scoring                                                       */
/* ──────────────────────────────────────────────────────────────────────────── */

type CategorySpec = {
  weight: number; // poids catégorie global 0..1 (par type projet)
  targets: { good: number; excellent: number };
  distance: { good: number; ok: number; bad: number };
  mix: { wQuantity: number; wProximity: number }; // doit faire 1
};

type ProjectSpec = Record<BpeCategoryKey, CategorySpec>;

function normalizeMix(mix: { wQuantity: number; wProximity: number }) {
  const q = Math.max(0, mix.wQuantity);
  const p = Math.max(0, mix.wProximity);
  const sum = q + p;
  if (sum <= 0) return { wQuantity: 0.5, wProximity: 0.5 };
  return { wQuantity: q / sum, wProximity: p / sum };
}

/**
 * Specs calibrées “génériques” (à affiner plus tard avec data),
 * mais déjà crédibles et stables.
 *
 * Hypothèse: le back calcule count dans un rayon ~1–2 km.
 * Les distances “good/ok/bad” sont en mètres.
 */
const SPECS: Record<ProjectType, ProjectSpec> = {
  logement: {
    supermarche: {
      weight: 0.22,
      targets: { good: 2, excellent: 4 },
      distance: { good: 400, ok: 900, bad: 1800 },
      mix: { wQuantity: 0.55, wProximity: 0.45 },
    },
    pharmacie: {
      weight: 0.14,
      targets: { good: 1, excellent: 3 },
      distance: { good: 350, ok: 850, bad: 1600 },
      mix: { wQuantity: 0.45, wProximity: 0.55 },
    },
    restaurant: {
      weight: 0.10,
      targets: { good: 4, excellent: 10 },
      distance: { good: 500, ok: 1100, bad: 2200 },
      mix: { wQuantity: 0.60, wProximity: 0.40 },
    },
    transport: {
      weight: 0.20,
      targets: { good: 2, excellent: 5 },
      distance: { good: 450, ok: 1000, bad: 2000 },
      mix: { wQuantity: 0.45, wProximity: 0.55 },
    },
    ecole: {
      weight: 0.14,
      targets: { good: 1, excellent: 2 },
      distance: { good: 650, ok: 1400, bad: 2600 },
      mix: { wQuantity: 0.50, wProximity: 0.50 },
    },
    sante: {
      weight: 0.20,
      targets: { good: 2, excellent: 5 },
      distance: { good: 700, ok: 1500, bad: 2800 },
      mix: { wQuantity: 0.60, wProximity: 0.40 },
    },
  },

  commerce: {
    supermarche: {
      weight: 0.12,
      targets: { good: 2, excellent: 4 },
      distance: { good: 450, ok: 1000, bad: 2000 },
      mix: { wQuantity: 0.55, wProximity: 0.45 },
    },
    pharmacie: {
      weight: 0.06,
      targets: { good: 1, excellent: 2 },
      distance: { good: 400, ok: 900, bad: 1800 },
      mix: { wQuantity: 0.40, wProximity: 0.60 },
    },
    restaurant: {
      weight: 0.22,
      targets: { good: 6, excellent: 14 },
      distance: { good: 450, ok: 1000, bad: 2000 },
      mix: { wQuantity: 0.70, wProximity: 0.30 },
    },
    transport: {
      weight: 0.26,
      targets: { good: 3, excellent: 7 },
      distance: { good: 500, ok: 1100, bad: 2200 },
      mix: { wQuantity: 0.45, wProximity: 0.55 },
    },
    ecole: {
      weight: 0.04,
      targets: { good: 1, excellent: 2 },
      distance: { good: 900, ok: 1800, bad: 3200 },
      mix: { wQuantity: 0.30, wProximity: 0.70 },
    },
    sante: {
      weight: 0.30,
      targets: { good: 2, excellent: 5 },
      distance: { good: 800, ok: 1700, bad: 3000 },
      mix: { wQuantity: 0.65, wProximity: 0.35 },
    },
  },

  bureau: {
    supermarche: {
      weight: 0.08,
      targets: { good: 2, excellent: 4 },
      distance: { good: 600, ok: 1200, bad: 2400 },
      mix: { wQuantity: 0.55, wProximity: 0.45 },
    },
    pharmacie: {
      weight: 0.08,
      targets: { good: 1, excellent: 2 },
      distance: { good: 500, ok: 1100, bad: 2200 },
      mix: { wQuantity: 0.40, wProximity: 0.60 },
    },
    restaurant: {
      weight: 0.20,
      targets: { good: 8, excellent: 18 },
      distance: { good: 450, ok: 1000, bad: 2000 },
      mix: { wQuantity: 0.70, wProximity: 0.30 },
    },
    transport: {
      weight: 0.38,
      targets: { good: 3, excellent: 8 },
      distance: { good: 500, ok: 1000, bad: 1900 },
      mix: { wQuantity: 0.40, wProximity: 0.60 },
    },
    ecole: {
      weight: 0.06,
      targets: { good: 1, excellent: 2 },
      distance: { good: 900, ok: 1700, bad: 3200 },
      mix: { wQuantity: 0.30, wProximity: 0.70 },
    },
    sante: {
      weight: 0.20,
      targets: { good: 2, excellent: 4 },
      distance: { good: 900, ok: 1800, bad: 3200 },
      mix: { wQuantity: 0.60, wProximity: 0.40 },
    },
  },

  ehpad: {
    supermarche: {
      weight: 0.08,
      targets: { good: 1, excellent: 3 },
      distance: { good: 600, ok: 1200, bad: 2500 },
      mix: { wQuantity: 0.45, wProximity: 0.55 },
    },
    pharmacie: {
      weight: 0.22,
      targets: { good: 1, excellent: 3 },
      distance: { good: 350, ok: 800, bad: 1600 },
      mix: { wQuantity: 0.35, wProximity: 0.65 },
    },
    restaurant: {
      weight: 0.05,
      targets: { good: 3, excellent: 8 },
      distance: { good: 700, ok: 1500, bad: 2800 },
      mix: { wQuantity: 0.55, wProximity: 0.45 },
    },
    transport: {
      weight: 0.10,
      targets: { good: 1, excellent: 3 },
      distance: { good: 600, ok: 1200, bad: 2200 },
      mix: { wQuantity: 0.40, wProximity: 0.60 },
    },
    ecole: {
      weight: 0.05,
      targets: { good: 1, excellent: 2 },
      distance: { good: 1000, ok: 2000, bad: 3500 },
      mix: { wQuantity: 0.30, wProximity: 0.70 },
    },
    sante: {
      weight: 0.50,
      targets: { good: 3, excellent: 7 },
      distance: { good: 700, ok: 1400, bad: 2600 },
      mix: { wQuantity: 0.55, wProximity: 0.45 },
    },
  },

  hotel: {
    supermarche: {
      weight: 0.06,
      targets: { good: 2, excellent: 4 },
      distance: { good: 700, ok: 1400, bad: 2600 },
      mix: { wQuantity: 0.55, wProximity: 0.45 },
    },
    pharmacie: {
      weight: 0.05,
      targets: { good: 1, excellent: 2 },
      distance: { good: 600, ok: 1200, bad: 2400 },
      mix: { wQuantity: 0.35, wProximity: 0.65 },
    },
    restaurant: {
      weight: 0.26,
      targets: { good: 10, excellent: 22 },
      distance: { good: 500, ok: 1100, bad: 2200 },
      mix: { wQuantity: 0.70, wProximity: 0.30 },
    },
    transport: {
      weight: 0.38,
      targets: { good: 3, excellent: 8 },
      distance: { good: 550, ok: 1100, bad: 2100 },
      mix: { wQuantity: 0.40, wProximity: 0.60 },
    },
    ecole: {
      weight: 0.03,
      targets: { good: 1, excellent: 2 },
      distance: { good: 1200, ok: 2400, bad: 4000 },
      mix: { wQuantity: 0.25, wProximity: 0.75 },
    },
    sante: {
      weight: 0.22,
      targets: { good: 2, excellent: 5 },
      distance: { good: 900, ok: 1800, bad: 3200 },
      mix: { wQuantity: 0.60, wProximity: 0.40 },
    },
  },
};

/* ──────────────────────────────────────────────────────────────────────────── */
/* Public API                                                                  */
/* ──────────────────────────────────────────────────────────────────────────── */

export function computeBpeScore(input: BpeInput): BpeScoreResult {
  const spec = SPECS[input.projectType];
  const breakdown = {} as Record<BpeCategoryKey, BpeCategoryBreakdown>;

  // Calcul des poids disponibles (catégorie présente ET données cohérentes)
  let availableWeightSum = 0;

  const keys = Object.keys(spec) as BpeCategoryKey[];
  for (const key of keys) {
    const cat = input.categories[key];
    const available = !!cat && typeof cat.count === "number";

    const w = spec[key].weight;
    if (available && w > 0) {
      availableWeightSum += w;
    }
  }

  const coveragePct = clamp(availableWeightSum * 100, 0, 100);

  // Si rien n'est dispo, score = 0 (et breakdown explicite)
  if (availableWeightSum <= 0) {
    for (const key of keys) {
      const s = spec[key];
      const mix = normalizeMix(s.mix);
      breakdown[key] = {
        available: false,
        weight: s.weight,
        weightNormalized: 0,
        targets: s.targets,
        distance: s.distance,
        quantity: { count: 0, score: 0 },
        proximity: { distanceAvg: null, score: 0 },
        combined: {
          wQuantity: mix.wQuantity,
          wProximity: mix.wProximity,
          score: 0,
          contribution: 0,
        },
      };
    }
    return { score: 0, coveragePct, breakdown };
  }

  // Agrégation pondérée renormalisée sur les catégories dispo
  let total = 0;

  for (const key of keys) {
    const s = spec[key];
    const mix = normalizeMix(s.mix);

    const cat = input.categories[key];
    const available = !!cat && typeof cat.count === "number";

    const count = available ? Math.max(0, cat!.count) : 0;
    const dist =
      available ? (safeNumber(cat!.distanceAvg) ?? null) : null;

    const qScore = available
      ? scoreQuantity(count, s.targets.good, s.targets.excellent)
      : 0;

    const pScore = available
      ? scoreProximity(dist, s.distance.good, s.distance.ok, s.distance.bad)
      : 0;

    const combined = available
      ? clamp(mix.wQuantity * qScore + mix.wProximity * pScore, 0, 100)
      : 0;

    const wNorm = available ? s.weight / availableWeightSum : 0;
    const contribution = combined * wNorm;

    total += contribution;

    breakdown[key] = {
      available,
      weight: s.weight,
      weightNormalized: wNorm,
      targets: s.targets,
      distance: s.distance,
      quantity: { count, score: Math.round(qScore) },
      proximity: { distanceAvg: dist, score: Math.round(pScore) },
      combined: {
        wQuantity: mix.wQuantity,
        wProximity: mix.wProximity,
        score: Math.round(combined),
        contribution: Math.round(contribution),
      },
    };
  }

  return {
    score: Math.round(clamp(total, 0, 100)),
    coveragePct: Math.round(coveragePct),
    breakdown,
  };
}