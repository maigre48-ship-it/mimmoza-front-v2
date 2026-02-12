// ============================================================================
// banqueRatios.ts — Calcul des ratios crédit
// ✅ Dual interface: DossierPage (montantPret/duree) + AnalysePage (loanAmount/durationMonths)
// ✅ Dual field names: FR (coutAcquisition…) + EN (purchasePrice…)
// ✅ Taux lu depuis budget.rateAnnualPct | annualRatePct param (fallback 3.5)
// ✅ LTV depuis bien.valeurEstimee OU garanties.valeurBien OU garanties.couvertureTotale
// ============================================================================

const DEFAULT_RATE_PCT = 3.5;

// ── Input types (tolerant) ──

export interface BudgetInput {
  // FR names (DossierPage)
  coutAcquisition?: number;
  coutTravaux?: number;
  frais?: number;
  apportPersonnel?: number;
  rateAnnualPct?: number;
  // EN names (AnalysePage / enrichment)
  purchasePrice?: number;
  works?: number;
  fees?: number;
  equity?: number;
  [key: string]: unknown;
}

export interface RevenusInput {
  // FR names
  revenusMensuels?: number;
  loyersMensuels?: number;
  chargesExistantes?: number;
  // EN names
  incomeMonthlyNet?: number;
  rentMonthly?: number;
  vacancyRatePct?: number;
  mode?: string;
  [key: string]: unknown;
}

export interface GarantiesInput {
  valeurBien?: number;
  couvertureTotale?: number;
  [key: string]: unknown;
}

export interface BienInput {
  valeurEstimee?: number;
  [key: string]: unknown;
}

export interface RatiosResult {
  mensualite: number;
  coutTotal: number;
  /** Alias for AnalysePage compat */
  cost: number;
  ltv: number | null;
  ltc: number | null;
  dsti: number | null;
  dscr: number | null;
  annualRatePct: number;
}

// ── Helpers ──

/** Resolve a value from FR name first, then EN name */
function pick(a: number | undefined, b: number | undefined): number {
  return Number(a) || Number(b) || 0;
}

// ── Public API ──

/**
 * Calcule la mensualité d'un prêt amortissable (formule actuarielle).
 */
export function computeMensualite(
  montant: number,
  dureeMois: number,
  annualRatePct: number
): number {
  if (montant <= 0 || dureeMois <= 0) return 0;
  if (annualRatePct <= 0) return montant / dureeMois;
  const r = annualRatePct / 100 / 12;
  return (montant * r) / (1 - Math.pow(1 + r, -dureeMois));
}

/**
 * Calcule l'ensemble des ratios crédit.
 *
 * Accepts BOTH calling conventions:
 *   - DossierPage style:  { montantPret, duree, budget, revenus, garanties, bien }
 *   - AnalysePage style:  { loanAmount, durationMonths, annualRatePct, budget, revenus, garanties }
 */
export function computeRatios(params: {
  // DossierPage params
  montantPret?: number;
  duree?: number;
  // AnalysePage params
  loanAmount?: number;
  durationMonths?: number;
  annualRatePct?: number;
  // Data
  garanties?: GarantiesInput;
  budget?: BudgetInput;
  revenus?: RevenusInput;
  bien?: BienInput;
}): RatiosResult {
  const {
    garanties = {},
    budget = {},
    revenus = {},
    bien,
  } = params;

  // ── Resolve loan params (FR priority, then EN) ──
  const montantPret = params.montantPret || params.loanAmount || 0;
  const duree = params.duree || params.durationMonths || 0;

  // Taux : param > budget field > default
  const annualRatePct =
    params.annualRatePct ??
    budget.rateAnnualPct ??
    DEFAULT_RATE_PCT;

  // ── Mensualité ──
  const mensualite = computeMensualite(montantPret, duree, annualRatePct);

  // ── Coût total (FR fields priority, then EN) ──
  const acquisition = pick(budget.coutAcquisition, budget.purchasePrice);
  const travaux = pick(budget.coutTravaux, budget.works);
  const frais = pick(budget.frais, budget.fees);
  const coutTotal = acquisition + travaux + frais;

  // ── LTV = prêt / valeur du bien ──
  // Priority: bien.valeurEstimee > garanties.valeurBien > garanties.couvertureTotale
  const valeurBien =
    bien?.valeurEstimee ||
    garanties.valeurBien ||
    garanties.couvertureTotale ||
    0;
  const ltv = valeurBien > 0 ? montantPret / valeurBien : null;

  // ── LTC = prêt / coût total ──
  const ltc = coutTotal > 0 ? montantPret / coutTotal : null;

  // ── DSTI = (charges + mensualité) / revenus ──
  const revenusMensuels = pick(revenus.revenusMensuels, revenus.incomeMonthlyNet);
  const chargesExistantes = revenus.chargesExistantes ?? 0;
  const dsti =
    revenusMensuels > 0
      ? (chargesExistantes + mensualite) / revenusMensuels
      : null;

  // ── DSCR = loyers / mensualité ──
  const loyersMensuels = pick(revenus.loyersMensuels, revenus.rentMonthly);
  const dscr =
    mensualite > 0 && loyersMensuels > 0
      ? loyersMensuels / mensualite
      : null;

  return {
    mensualite,
    coutTotal,
    cost: coutTotal, // alias for AnalysePage compat
    ltv,
    ltc,
    dsti,
    dscr,
    annualRatePct,
  };
}