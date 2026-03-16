/**
 * loanCost.ts
 * ─────────────────────────────────────────────────────────────────────
 * Calcul du coût réel du crédit immobilier (hors fiscalité).
 *
 * Formule mensualité (hors assurance) :
 *   M = P * (r*(1+r)^n) / ((1+r)^n - 1)
 *   avec r = taux_annuel_nominal / 12, n = années * 12
 *
 * Cas taux = 0 : remboursement linéaire (M = P/n).
 * ─────────────────────────────────────────────────────────────────────
 */

export interface LoanInput {
  /** Capital emprunté en euros */
  principal: number;
  /** Taux nominal annuel en % (ex: 3.5 pour 3,5%) */
  annualRateNominalPct: number;
  /** Durée du prêt en années */
  years: number;
  /** Taux assurance annuel en % du capital (ex: 0.36) — optionnel */
  annualInsuranceRatePct?: number;
  /** Frais initiaux totaux en euros (dossier + garantie + courtier) — optionnel */
  upfrontFeesEur?: number;
}

export interface LoanCostBreakdown {
  /** Nombre de mensualités */
  months: number;
  /** Mensualité hors assurance, en euros */
  monthlyPaymentExclInsurance: number;
  /** Total des intérêts versés sur la durée, en euros */
  totalInterest: number;
  /** Mensualité assurance en euros, null si non renseignée */
  monthlyInsurance: number | null;
  /** Total assurance sur la durée, en euros, null si non renseignée */
  totalInsurance: number | null;
  /** Frais initiaux (dossier + garantie + courtier), en euros */
  upfrontFees: number;
  /** Coût total du crédit = intérêts + assurance (si dispo) + frais */
  totalCostOfCredit: number;
  /** Total remboursé = capital + coût total du crédit */
  totalRepaidAllIn: number;
  /** Avertissements ou notes de calcul */
  notes: string[];
}

export function computeLoanCost(input: LoanInput): LoanCostBreakdown {
  const {
    principal,
    annualRateNominalPct,
    years,
    annualInsuranceRatePct,
    upfrontFeesEur,
  } = input;

  const notes: string[] = [];
  const n = Math.round(years * 12);
  const r = annualRateNominalPct / 100 / 12;

  if (principal <= 0) {
    notes.push("Capital ≤ 0 — résultats non significatifs.");
  }
  if (n <= 0) {
    notes.push("Durée ≤ 0 — résultats non significatifs.");
  }

  // ── Mensualité ────────────────────────────────────────────────────
  let monthlyPaymentExclInsurance: number;

  if (r === 0 || !Number.isFinite(r)) {
    // Taux nul → amortissement linéaire
    monthlyPaymentExclInsurance = n > 0 ? principal / n : 0;
    notes.push("Taux 0 % — remboursement linéaire appliqué.");
  } else {
    const factor = Math.pow(1 + r, n);
    monthlyPaymentExclInsurance = (principal * (r * factor)) / (factor - 1);
  }

  // ── Intérêts totaux ───────────────────────────────────────────────
  const totalInterest = Math.max(0, monthlyPaymentExclInsurance * n - principal);

  // ── Assurance ─────────────────────────────────────────────────────
  let monthlyInsurance: number | null = null;
  let totalInsurance: number | null = null;

  if (
    annualInsuranceRatePct != null &&
    Number.isFinite(annualInsuranceRatePct) &&
    annualInsuranceRatePct > 0
  ) {
    monthlyInsurance = (principal * (annualInsuranceRatePct / 100)) / 12;
    totalInsurance = monthlyInsurance * n;
  }

  // ── Frais initiaux ────────────────────────────────────────────────
  const upfrontFees =
    upfrontFeesEur != null && Number.isFinite(upfrontFeesEur) && upfrontFeesEur > 0
      ? upfrontFeesEur
      : 0;

  // ── Coût total ────────────────────────────────────────────────────
  const totalCostOfCredit =
    totalInterest + (totalInsurance ?? 0) + upfrontFees;

  const totalRepaidAllIn = principal + totalCostOfCredit;

  return {
    months: n,
    monthlyPaymentExclInsurance,
    totalInterest,
    monthlyInsurance,
    totalInsurance,
    upfrontFees,
    totalCostOfCredit,
    totalRepaidAllIn,
    notes,
  };
}