/**
 * sourcingSmartScore.engine.ts
 * ─────────────────────────────────────────────────────────────────────
 * Moteur SmartScore — Module MARCHAND uniquement.
 *
 * v2.0.0-marchand-recalibrated
 *
 * Pondération 6 piliers :
 *   Marge & Cushion         30 %
 *   Prix vs Médiane DVF     20 %
 *   Risque opérationnel     15 %
 *   Liquidité & sortie      15 %
 *   Robustesse planning     10 %
 *   Qualité données         10 %
 *
 * Règles structurelles :
 *   - margeBrute < 12 % → pilier marge cap 60, global cap 75,
 *     flag underMarginThreshold = true
 *   - Pénalité asymétrique sous-seuil : delta × 3 (max 15 pts)
 *   - Pénalité données incomplètes : (70 - completeness) × 0.2
 *   - Anti-score artificiel : pas de 100 si marge < 15 % OU compl < 80 %
 *
 * Classification :
 *   85–100  Premium deal
 *   75–84   Solide
 *   60–74   Exécutable
 *   45–59   Fragile
 *   < 45    À éviter
 *
 * Exports inchangés : computeSourcingSmartScore, SOURCING_SMARTSCORE_KEY,
 *                     ENGINE_VERSION
 * ─────────────────────────────────────────────────────────────────────
 */

// ─── Constants ───────────────────────────────────────────────────────

export const SOURCING_SMARTSCORE_KEY = "mimmoza.sourcing.smartscore.v1";
export const ENGINE_VERSION = "v2.0.0-marchand-recalibrated";

const SEUIL_MIMMOZA_MARGE = 12; // %
const MARGIN_PILLAR_CAP_UNDER_THRESHOLD = 60;
const GLOBAL_CAP_UNDER_THRESHOLD = 75;
const PENALTY_MULTIPLIER = 3;
const PENALTY_MAX = 15;
const DATA_PENALTY_THRESHOLD = 70; // % completeness
const DATA_PENALTY_FACTOR = 0.2;

// ─── Types ───────────────────────────────────────────────────────────

export interface ScoringPillar {
  key: string;
  label: string;
  score: number;   // 0–100 (normalized per pillar)
  weight: number;   // 0–1
  details: string[];
}

export interface SmartScoreResult {
  score: number;             // 0–100
  rawScore: number;          // before caps & penalties
  grade: string;             // "Premium deal" | "Solide" | …
  verdict: "GO" | "WATCH" | "NO_GO";
  pillars: ScoringPillar[];
  underMarginThreshold: boolean;
  margeBrute: number | null;
  completeness: number;      // 0–100
  penalties: PenaltyEntry[];
  caps: string[];
  engineVersion: string;
}

interface PenaltyEntry {
  label: string;
  points: number;
}

// ─── FormState (read from localStorage) ──────────────────────────────

interface SourcingFormState {
  price?: string;
  surface?: string;
  prixRevente?: string;
  codePostal?: string;
  ville?: string;
  rueProche?: string;
  titre?: string;
  floor?: string;
  elevator?: string;
  commerces?: string;
  transport?: string;
  dvfPrixM2Median?: string;
  dvfNbComparables?: string;
  dvfTendance?: string;
  travauxEstimes?: string;
  fraisNotaire?: string;
  fraisAgence?: string;
  dureeTravaux?: string;
  delaiRevente?: string;
  loyerEstime?: string;
  dpe?: string;
  risquesIdentifies?: string;
  // Margin can be pre-computed or we derive it
  margeBrute?: string;
  // Marchand snapshot overlay (injected by Sourcing.tsx)
  [key: string]: string | undefined;
}

// ─── Snapshot overlay (from Marchand snapshot if available) ──────────

interface MarchandDealOverlay {
  prixAchat?: number;
  surfaceM2?: number;
  prixReventeCible?: number;
  travauxEstimes?: number;
  fraisNotaire?: number;
  fraisAgence?: number;
  margeBrute?: number;
  dvfPrixM2Median?: number;
  dvfNbComparables?: number;
  transportScore?: number;
  bpeScore?: number;
  hasMetroTrain?: boolean;
  dureeTravaux?: number;
  delaiRevente?: number;
  loyerEstime?: number;
  dpe?: string;
  risquesCount?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function safeNum(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function parseBool(v: unknown): boolean | null {
  if (v === true || v === "true" || v === "1" || v === "oui") return true;
  if (v === false || v === "false" || v === "0" || v === "non") return false;
  return null;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function readFormState(): SourcingFormState {
  try {
    const raw = localStorage.getItem(SOURCING_SMARTSCORE_KEY);
    if (!raw) return {};
    return (JSON.parse(raw) as any)?.formState ?? {};
  } catch {
    return {};
  }
}

function readDealOverlay(): MarchandDealOverlay | null {
  try {
    const raw = localStorage.getItem(SOURCING_SMARTSCORE_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as any)?.dealOverlay ?? null;
  } catch {
    return null;
  }
}

// ─── Derived inputs ──────────────────────────────────────────────────

interface DerivedInputs {
  prixAchat: number | undefined;
  surface: number | undefined;
  prixM2: number | undefined;
  prixRevente: number | undefined;
  travauxEstimes: number | undefined;
  fraisNotaire: number | undefined;
  fraisAgence: number | undefined;
  margeBrute: number | undefined;      // in %
  dvfMedian: number | undefined;
  dvfN: number | undefined;
  dvfTendance: string | undefined;
  floor: number | undefined;
  elevator: boolean | null;
  commerces: boolean | null;
  transport: boolean | null;
  transportScore: number | undefined;
  bpeScore: number | undefined;
  hasMetroTrain: boolean | null;
  dureeTravaux: number | undefined;
  delaiRevente: number | undefined;
  loyerEstime: number | undefined;
  dpe: string | undefined;
  risquesCount: number | undefined;
}

function deriveInputs(fs: SourcingFormState, ov: MarchandDealOverlay | null): DerivedInputs {
  const prixAchat = safeNum(fs.price) ?? ov?.prixAchat;
  const surface = safeNum(fs.surface) ?? ov?.surfaceM2;
  const prixM2 = (prixAchat && surface && surface > 0) ? prixAchat / surface : undefined;
  const prixRevente = safeNum(fs.prixRevente) ?? ov?.prixReventeCible;
  const travauxEstimes = safeNum(fs.travauxEstimes) ?? ov?.travauxEstimes;
  const fraisNotaire = safeNum(fs.fraisNotaire) ?? ov?.fraisNotaire;
  const fraisAgence = safeNum(fs.fraisAgence) ?? ov?.fraisAgence;

  // Margin computation
  let margeBrute = safeNum(fs.margeBrute) ?? ov?.margeBrute;
  if (margeBrute == null && prixAchat && prixRevente && prixAchat > 0) {
    const coutTotal = prixAchat + (travauxEstimes ?? 0) + (fraisNotaire ?? 0) + (fraisAgence ?? 0);
    if (coutTotal > 0) {
      margeBrute = ((prixRevente - coutTotal) / coutTotal) * 100;
    }
  }

  return {
    prixAchat,
    surface,
    prixM2,
    prixRevente,
    travauxEstimes,
    fraisNotaire,
    fraisAgence,
    margeBrute,
    dvfMedian: safeNum(fs.dvfPrixM2Median) ?? ov?.dvfPrixM2Median,
    dvfN: safeNum(fs.dvfNbComparables) ?? ov?.dvfNbComparables,
    dvfTendance: fs.dvfTendance,
    floor: safeNum(fs.floor),
    elevator: parseBool(fs.elevator),
    commerces: parseBool(fs.commerces),
    transport: parseBool(fs.transport),
    transportScore: ov?.transportScore,
    bpeScore: ov?.bpeScore,
    hasMetroTrain: ov?.hasMetroTrain ?? null,
    dureeTravaux: safeNum(fs.dureeTravaux) ?? ov?.dureeTravaux,
    delaiRevente: safeNum(fs.delaiRevente) ?? ov?.delaiRevente,
    loyerEstime: safeNum(fs.loyerEstime) ?? ov?.loyerEstime,
    dpe: fs.dpe ?? ov?.dpe,
    risquesCount: safeNum(fs.risquesIdentifies) ?? ov?.risquesCount,
  };
}

// ─── Completeness ────────────────────────────────────────────────────

function computeCompleteness(inp: DerivedInputs): number {
  const fields: [string, unknown][] = [
    ["prixAchat", inp.prixAchat],
    ["surface", inp.surface],
    ["prixRevente", inp.prixRevente],
    ["travauxEstimes", inp.travauxEstimes],
    ["dvfMedian", inp.dvfMedian],
    ["dvfN", inp.dvfN],
    ["floor", inp.floor],
    ["elevator", inp.elevator],
    ["transport", inp.transport],
    ["dureeTravaux", inp.dureeTravaux],
    ["delaiRevente", inp.delaiRevente],
    ["dpe", inp.dpe],
  ];

  let filled = 0;
  for (const [, val] of fields) {
    if (val != null && val !== "" && val !== false) filled++;
    // false is a valid value for boolean fields
    if (val === false) filled++;
  }

  // Special: booleans where null means "unknown"
  return Math.round((filled / fields.length) * 100);
}

// ═══════════════════════════════════════════════════════════════════
// PILLAR 1 — Marge & Cushion (30 %)
// ═══════════════════════════════════════════════════════════════════

function scoreMargeCushion(inp: DerivedInputs): ScoringPillar {
  const details: string[] = [];
  let score = 50; // neutral default

  if (inp.margeBrute != null) {
    const m = inp.margeBrute;
    details.push(`Marge brute : ${m.toFixed(1)} % (seuil Mimmoza : ${SEUIL_MIMMOZA_MARGE} %)`);

    if (m >= 25) { score = 95; details.push("Marge excellente."); }
    else if (m >= 20) { score = 88; details.push("Marge très confortable."); }
    else if (m >= 16) { score = 80; details.push("Marge solide."); }
    else if (m >= SEUIL_MIMMOZA_MARGE) { score = 70; details.push("Marge au seuil — attention au cushion."); }
    else if (m >= 10) { score = 55; details.push("Marge SOUS le seuil Mimmoza."); }
    else if (m >= 5) { score = 35; details.push("Marge fragile — risque élevé."); }
    else if (m >= 0) { score = 15; details.push("Marge quasi nulle."); }
    else { score = 5; details.push("Marge NÉGATIVE — deal non viable."); }

    // Under-threshold cap on this pillar
    if (m < SEUIL_MIMMOZA_MARGE) {
      score = Math.min(score, MARGIN_PILLAR_CAP_UNDER_THRESHOLD);
      details.push(`⚠️ Marge < ${SEUIL_MIMMOZA_MARGE}% → pilier plafonné à ${MARGIN_PILLAR_CAP_UNDER_THRESHOLD}/100.`);
    }

    // Cushion analysis: if travaux known
    if (inp.travauxEstimes != null && inp.prixAchat != null && inp.prixAchat > 0) {
      const travauxPct = (inp.travauxEstimes / inp.prixAchat) * 100;
      if (travauxPct > 30) {
        score = Math.max(score - 10, 0);
        details.push(`Travaux ${travauxPct.toFixed(0)}% du prix d'achat → cushion réduit (-10).`);
      } else if (travauxPct > 20) {
        score = Math.max(score - 5, 0);
        details.push(`Travaux ${travauxPct.toFixed(0)}% du prix → attention au cushion (-5).`);
      }
    }
  } else {
    score = 40;
    details.push("Marge brute non calculable (prix revente ou coûts manquants).");
  }

  return { key: "marge_cushion", label: "Marge & Cushion", score: clamp(score, 0, 100), weight: 0.30, details };
}

// ═══════════════════════════════════════════════════════════════════
// PILLAR 2 — Prix vs Médiane DVF (20 %)
// ═══════════════════════════════════════════════════════════════════

function scorePrixVsDvf(inp: DerivedInputs): ScoringPillar {
  const details: string[] = [];
  let score = 50;

  if (inp.prixM2 != null && inp.dvfMedian != null && inp.dvfMedian > 0) {
    const deltaPct = ((inp.prixM2 / inp.dvfMedian) - 1) * 100;
    details.push(`Prix/m² bien : ${Math.round(inp.prixM2)} €`);
    details.push(`Médiane DVF : ${Math.round(inp.dvfMedian)} € (n=${inp.dvfN ?? "?"})`);
    details.push(`Décote/Surcote : ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)} %`);

    // Map deltaPct → score
    if (deltaPct <= -30) score = 95;
    else if (deltaPct <= -20) score = 88;
    else if (deltaPct <= -10) score = 75;
    else if (deltaPct <= -5) score = 65;
    else if (deltaPct <= 0) score = 55;
    else if (deltaPct <= 5) score = 45;
    else if (deltaPct <= 10) score = 35;
    else if (deltaPct <= 20) score = 20;
    else if (deltaPct <= 30) score = 10;
    else score = 5;

    // Low comparables → attenuate toward neutral
    if (inp.dvfN != null && inp.dvfN < 5) {
      const neutral = 50;
      score = Math.round(neutral + (score - neutral) * 0.5);
      details.push(`Peu de comparables (${inp.dvfN}) → score atténué.`);
    }
  } else if (inp.prixM2 != null) {
    score = 45;
    details.push("DVF indisponible → score atténué (pas de référence marché).");
  } else {
    score = 35;
    details.push("Prix/m² non calculable et DVF indisponible.");
  }

  return { key: "prix_dvf", label: "Prix vs Médiane DVF", score: clamp(score, 0, 100), weight: 0.20, details };
}

// ═══════════════════════════════════════════════════════════════════
// PILLAR 3 — Risque opérationnel (15 %)
// ═══════════════════════════════════════════════════════════════════

function scoreRisqueOperationnel(inp: DerivedInputs): ScoringPillar {
  const details: string[] = [];
  let score = 65; // neutral-optimistic

  // DPE risk
  if (inp.dpe) {
    const dpeUpper = inp.dpe.toUpperCase();
    if (dpeUpper === "F" || dpeUpper === "G") {
      score -= 15;
      details.push(`DPE ${dpeUpper} → risque rénovation énergétique obligatoire (-15).`);
    } else if (dpeUpper === "E") {
      score -= 8;
      details.push(`DPE ${dpeUpper} → rénovation probable (-8).`);
    } else if (dpeUpper === "A" || dpeUpper === "B") {
      score += 5;
      details.push(`DPE ${dpeUpper} → bon état énergétique (+5).`);
    }
  } else {
    details.push("DPE inconnu — risque non évalué.");
  }

  // Floor / elevator risk
  if (inp.floor != null) {
    if (inp.floor >= 5 && inp.elevator === false) {
      score -= 12;
      details.push(`Étage ${inp.floor} SANS ascenseur → risque logistique fort (-12).`);
    } else if (inp.floor >= 4 && inp.elevator === false) {
      score -= 7;
      details.push(`Étage ${inp.floor} sans ascenseur → risque logistique (-7).`);
    } else if (inp.floor >= 3 && inp.elevator === false) {
      score -= 4;
      details.push(`Étage ${inp.floor} sans ascenseur → risque léger (-4).`);
    } else if (inp.floor === 0) {
      score -= 2;
      details.push("RDC → risque vis-à-vis/bruit (-2).");
    }
  }

  // Travaux ratio risk
  if (inp.travauxEstimes != null && inp.prixAchat != null && inp.prixAchat > 0) {
    const ratio = (inp.travauxEstimes / inp.prixAchat) * 100;
    if (ratio > 40) {
      score -= 15;
      details.push(`Travaux > 40% du prix → risque dépassement majeur (-15).`);
    } else if (ratio > 25) {
      score -= 8;
      details.push(`Travaux ${ratio.toFixed(0)}% du prix → risque dépassement (-8).`);
    }
  }

  // Identified risks count
  if (inp.risquesCount != null && inp.risquesCount > 0) {
    const penalty = Math.min(inp.risquesCount * 3, 12);
    score -= penalty;
    details.push(`${inp.risquesCount} risque(s) identifié(s) (-${penalty}).`);
  }

  return { key: "risque_operationnel", label: "Risque opérationnel", score: clamp(score, 0, 100), weight: 0.15, details };
}

// ═══════════════════════════════════════════════════════════════════
// PILLAR 4 — Liquidité & Sortie (15 %)
// ═══════════════════════════════════════════════════════════════════

function scoreLiquiditeSortie(inp: DerivedInputs): ScoringPillar {
  const details: string[] = [];
  let score = 55;

  // Transport quality → liquidity proxy
  if (inp.transportScore != null) {
    if (inp.transportScore >= 70) {
      score += 15;
      details.push(`Transport score ${inp.transportScore}/100 → bonne liquidité (+15).`);
    } else if (inp.transportScore >= 40) {
      score += 5;
      details.push(`Transport score ${inp.transportScore}/100 → liquidité correcte (+5).`);
    } else {
      score -= 5;
      details.push(`Transport score ${inp.transportScore}/100 → liquidité limitée (-5).`);
    }
  } else if (inp.transport === true || inp.hasMetroTrain === true) {
    score += 10;
    details.push("Transport à proximité → liquidité favorable (+10).");
  } else if (inp.transport === false) {
    score -= 8;
    details.push("Pas de transport proche → liquidité réduite (-8).");
  }

  // Commerces → attractiveness
  if (inp.bpeScore != null) {
    if (inp.bpeScore >= 60) {
      score += 8;
      details.push(`BPE score ${inp.bpeScore}/100 → quartier équipé (+8).`);
    } else if (inp.bpeScore < 30) {
      score -= 5;
      details.push(`BPE score ${inp.bpeScore}/100 → quartier peu équipé (-5).`);
    }
  } else if (inp.commerces === true) {
    score += 5;
    details.push("Commerces à proximité (+5).");
  } else if (inp.commerces === false) {
    score -= 3;
    details.push("Pas de commerces proches (-3).");
  }

  // DVF volume → market depth
  if (inp.dvfN != null) {
    if (inp.dvfN >= 30) {
      score += 10;
      details.push(`${inp.dvfN} transactions DVF → marché liquide (+10).`);
    } else if (inp.dvfN >= 15) {
      score += 5;
      details.push(`${inp.dvfN} transactions DVF → liquidité correcte (+5).`);
    } else if (inp.dvfN < 5) {
      score -= 8;
      details.push(`Seulement ${inp.dvfN} transactions DVF → marché peu liquide (-8).`);
    }
  }

  // Delai revente
  if (inp.delaiRevente != null) {
    if (inp.delaiRevente > 18) {
      score -= 10;
      details.push(`Délai revente ${inp.delaiRevente} mois → sortie lente (-10).`);
    } else if (inp.delaiRevente > 12) {
      score -= 5;
      details.push(`Délai revente ${inp.delaiRevente} mois → attention (-5).`);
    } else if (inp.delaiRevente <= 6) {
      score += 5;
      details.push(`Délai revente ${inp.delaiRevente} mois → sortie rapide (+5).`);
    }
  }

  return { key: "liquidite_sortie", label: "Liquidité & sortie", score: clamp(score, 0, 100), weight: 0.15, details };
}

// ═══════════════════════════════════════════════════════════════════
// PILLAR 5 — Robustesse planning / durées (10 %)
// ═══════════════════════════════════════════════════════════════════

function scoreRobustessePlanning(inp: DerivedInputs): ScoringPillar {
  const details: string[] = [];
  let score = 55;

  if (inp.dureeTravaux != null) {
    if (inp.dureeTravaux <= 3) {
      score += 15;
      details.push(`Travaux ${inp.dureeTravaux} mois → planning serré mais rapide (+15).`);
    } else if (inp.dureeTravaux <= 6) {
      score += 8;
      details.push(`Travaux ${inp.dureeTravaux} mois → raisonnable (+8).`);
    } else if (inp.dureeTravaux <= 12) {
      score -= 3;
      details.push(`Travaux ${inp.dureeTravaux} mois → durée notable (-3).`);
    } else {
      score -= 12;
      details.push(`Travaux ${inp.dureeTravaux} mois → risque de dérapage élevé (-12).`);
    }
  } else {
    score -= 5;
    details.push("Durée travaux non renseignée (-5).");
  }

  // Total cycle = travaux + revente
  if (inp.dureeTravaux != null && inp.delaiRevente != null) {
    const totalCycle = inp.dureeTravaux + inp.delaiRevente;
    if (totalCycle > 24) {
      score -= 10;
      details.push(`Cycle total ${totalCycle} mois → immobilisation longue (-10).`);
    } else if (totalCycle > 18) {
      score -= 5;
      details.push(`Cycle total ${totalCycle} mois → attention (-5).`);
    } else if (totalCycle <= 9) {
      score += 10;
      details.push(`Cycle total ${totalCycle} mois → rotation rapide (+10).`);
    }
  }

  // Loyer pendant détention?
  if (inp.loyerEstime != null && inp.loyerEstime > 0) {
    score += 5;
    details.push(`Loyer estimé ${Math.round(inp.loyerEstime)} €/mois → portage réduit (+5).`);
  }

  return { key: "robustesse_planning", label: "Robustesse planning", score: clamp(score, 0, 100), weight: 0.10, details };
}

// ═══════════════════════════════════════════════════════════════════
// PILLAR 6 — Qualité & complétude données (10 %)
// ═══════════════════════════════════════════════════════════════════

function scoreQualiteDonnees(inp: DerivedInputs, completeness: number): ScoringPillar {
  const details: string[] = [];

  // Direct mapping: completeness → pillar score
  let score = completeness;

  if (completeness >= 90) {
    details.push(`Complétude ${completeness}% → données exhaustives.`);
  } else if (completeness >= 70) {
    details.push(`Complétude ${completeness}% → données suffisantes.`);
  } else if (completeness >= 50) {
    details.push(`Complétude ${completeness}% → données partielles.`);
    score = Math.min(score, 60);
  } else {
    details.push(`Complétude ${completeness}% → données insuffisantes.`);
    score = Math.min(score, 40);
  }

  // DVF availability bonus
  if (inp.dvfMedian != null && inp.dvfN != null && inp.dvfN >= 5) {
    score += 5;
    details.push("Référence DVF disponible (+5).");
  }

  return { key: "qualite_donnees", label: "Qualité données", score: clamp(score, 0, 100), weight: 0.10, details };
}

// ═══════════════════════════════════════════════════════════════════
// GRADE & VERDICT
// ═══════════════════════════════════════════════════════════════════

function gradeFromScore(score: number): string {
  if (score >= 85) return "Premium deal";
  if (score >= 75) return "Solide";
  if (score >= 60) return "Exécutable";
  if (score >= 45) return "Fragile";
  return "À éviter";
}

function verdictFromScore(score: number): "GO" | "WATCH" | "NO_GO" {
  if (score >= 70) return "GO";
  if (score >= 50) return "WATCH";
  return "NO_GO";
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPUTATION
// ═══════════════════════════════════════════════════════════════════

export function computeSourcingSmartScore(): SmartScoreResult {
  const formState = readFormState();
  const overlay = readDealOverlay();
  const inp = deriveInputs(formState, overlay);
  const completeness = computeCompleteness(inp);

  console.log("[SmartScore:Marchand] Inputs:", {
    prixAchat: inp.prixAchat,
    surface: inp.surface,
    margeBrute: inp.margeBrute?.toFixed(1),
    dvfMedian: inp.dvfMedian,
    completeness,
  });

  // ── 1. Compute all pillars ──────────────────────────────────────
  const pillars: ScoringPillar[] = [
    scoreMargeCushion(inp),
    scorePrixVsDvf(inp),
    scoreRisqueOperationnel(inp),
    scoreLiquiditeSortie(inp),
    scoreRobustessePlanning(inp),
    scoreQualiteDonnees(inp, completeness),
  ];

  // ── 2. Weighted average ─────────────────────────────────────────
  let rawScore = 0;
  for (const p of pillars) {
    rawScore += p.score * p.weight;
  }
  rawScore = Math.round(rawScore);

  // ── 3. Apply penalties & caps ───────────────────────────────────
  let finalScore = rawScore;
  const penalties: PenaltyEntry[] = [];
  const caps: string[] = [];

  const underMarginThreshold = inp.margeBrute != null && inp.margeBrute < SEUIL_MIMMOZA_MARGE;

  // 3a) Asymmetric margin penalty
  if (underMarginThreshold && inp.margeBrute != null) {
    const delta = SEUIL_MIMMOZA_MARGE - inp.margeBrute;
    const penalty = Math.min(Math.round(delta * PENALTY_MULTIPLIER), PENALTY_MAX);
    if (penalty > 0) {
      finalScore -= penalty;
      penalties.push({
        label: `Pénalité marge sous-seuil (delta ${delta.toFixed(1)}% × ${PENALTY_MULTIPLIER})`,
        points: penalty,
      });
    }
  }

  // 3b) Data incompleteness penalty
  if (completeness < DATA_PENALTY_THRESHOLD) {
    const dataPenalty = Math.round((DATA_PENALTY_THRESHOLD - completeness) * DATA_PENALTY_FACTOR * 10) / 10;
    if (dataPenalty > 0) {
      finalScore -= Math.round(dataPenalty);
      penalties.push({
        label: `Pénalité données incomplètes (${completeness}%)`,
        points: Math.round(dataPenalty),
      });
    }
  }

  // 3c) Global cap under margin threshold
  if (underMarginThreshold) {
    if (finalScore > GLOBAL_CAP_UNDER_THRESHOLD) {
      caps.push(`Plafonné à ${GLOBAL_CAP_UNDER_THRESHOLD}/100 (marge < ${SEUIL_MIMMOZA_MARGE}%).`);
      finalScore = GLOBAL_CAP_UNDER_THRESHOLD;
    }
  }

  // 3d) Anti-artificial 100 rule
  if (finalScore >= 100) {
    const margeOk = inp.margeBrute != null && inp.margeBrute >= 15;
    const dataOk = completeness >= 80;
    if (!margeOk || !dataOk) {
      finalScore = 99;
      caps.push("Score 100 interdit : marge < 15% ou complétude < 80%.");
    }
  }

  finalScore = clamp(finalScore, 0, 100);

  // ── 4. Build result ─────────────────────────────────────────────
  const result: SmartScoreResult = {
    score: finalScore,
    rawScore,
    grade: gradeFromScore(finalScore),
    verdict: verdictFromScore(finalScore),
    pillars,
    underMarginThreshold,
    margeBrute: inp.margeBrute ?? null,
    completeness,
    penalties,
    caps,
    engineVersion: ENGINE_VERSION,
  };

  console.log("[SmartScore:Marchand] Result:", {
    raw: rawScore,
    final: finalScore,
    grade: result.grade,
    underMarginThreshold,
    penalties: penalties.length,
    caps: caps.length,
  });

  return result;
}

// ─── Default export for backward compatibility ───────────────────────

export default computeSourcingSmartScore;