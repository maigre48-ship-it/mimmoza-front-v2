/**
 * strategyEngine.ts
 * ─────────────────────────────────────────────────────────────────────
 * Moteur de calcul pour l'analyse de rentabilité investisseur.
 *
 * Points clés:
 * - Mensualité amortissable avec différé
 * - Capital restant dû (CRD) à une date donnée
 * - Flux equity annuels (t=0 apport+frais, t=1..N cashflow, t=N revente-CRD)
 * - VAN (NPV) et TRI (IRR) equity
 * - Taux d'actualisation recommandé = riskFree + primes
 * - Stress tests: Base/Stress/Cash
 * - Négociation: prix max, zone sécurité, seuil danger
 * - Auto-génération de 3 scénarios selon stratégie/régime
 *
 * Pas de logique dans le JSX: tout est ici.
 * ─────────────────────────────────────────────────────────────────────
 */

import type {
  Scenario,
  ScenarioResults,
  StressTestResults,
  DealInputs,
  NegotiationResult,
  StrategyType,
  FiscalRegime,
  ScenarioComparison,
} from "../types/strategy.types";

// ─── Safe number helper ─────────────────────────────────────────────

/** Coerce to finite number, fallback to defaultVal (0) if NaN/undefined/null/Infinity */
function safeNum(v: unknown, defaultVal = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return defaultVal;
}

// ─────────────────────────────────────────────────────────────────────
// Fiscalité (v1.1 simplifiée mais cohérente avec la déductibilité)
// ─────────────────────────────────────────────────────────────────────
// Hypothèses v1.1:
// - Taux d'impôt unique par défaut (30%) : à rendre paramétrable ensuite
// - LMNP Micro: base imposable = (loyers encaissés) * 50% (abattement 50%)
// - LMNP Réel: base imposable = loyers encaissés - charges - intérêts - assurance
//   (PAS de déduction du remboursement de capital)
// - Défiscalisation: traité comme LMNP Réel (v1.1 neutre)
const DEFAULT_TAX_RATE_PCT = 30;

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, safeNum(v)));
}

function computeTaxLocationV11(opts: {
  regime: FiscalRegime;
  loyersEncaisses: number; // net de vacance (≈ loyers réellement perçus)
  chargesHorsCredit: number; // charges annuelles (copro/TF/PNO…)
  interets: number; // intérêts payés sur l'année
  assuranceEmprunteur: number; // assurance payée sur l'année
  taxRatePct?: number;
}): { baseImposable: number; impot: number } {
  const rate = clampPct(opts.taxRatePct ?? DEFAULT_TAX_RATE_PCT) / 100;

  const loyers = Math.max(0, safeNum(opts.loyersEncaisses));
  const charges = Math.max(0, safeNum(opts.chargesHorsCredit));
  const interets = Math.max(0, safeNum(opts.interets));
  const assurance = Math.max(0, safeNum(opts.assuranceEmprunteur));

  let base = 0;

  if (opts.regime === "lmnp_micro") {
    // Micro-BIC: abattement 50% sur recettes
    base = loyers * 0.5;
  } else {
    // lmnp_reel / defiscalisation (v1.1): résultat fiscal simplifié
    base = loyers - charges - interets - assurance;
    base = Math.max(0, base);
  }

  const impot = Math.max(0, base * rate);
  return { baseImposable: base, impot };
}

// ─── Helpers financiers ──────────────────────────────────────────────

/** Mensualité d'un prêt amortissable (hors différé) */
export function computeMensualite(
  capital: number,
  tauxAnnuel: number,
  dureeMois: number,
  assurancePct: number
): number {
  capital = safeNum(capital);
  tauxAnnuel = safeNum(tauxAnnuel);
  dureeMois = safeNum(dureeMois);
  assurancePct = safeNum(assurancePct);

  if (capital <= 0 || dureeMois <= 0) return 0;
  const r = tauxAnnuel / 100 / 12;
  const assuranceMensuelle = (capital * assurancePct) / 100 / 12;

  if (r === 0) return capital / dureeMois + assuranceMensuelle;

  const mensualiteHorsAssurance =
    (capital * r * Math.pow(1 + r, dureeMois)) /
    (Math.pow(1 + r, dureeMois) - 1);

  return safeNum(mensualiteHorsAssurance + assuranceMensuelle);
}

/** Mensualité pendant le différé (intérêts seuls + assurance) */
export function computeMensualiteDiffere(
  capital: number,
  tauxAnnuel: number,
  assurancePct: number
): number {
  capital = safeNum(capital);
  tauxAnnuel = safeNum(tauxAnnuel);
  assurancePct = safeNum(assurancePct);

  if (capital <= 0) return 0;
  const interets = (capital * tauxAnnuel) / 100 / 12;
  const assurance = (capital * assurancePct) / 100 / 12;
  return safeNum(interets + assurance);
}

/** Capital restant dû après N mois d'amortissement */
export function computeCRD(
  capital: number,
  tauxAnnuel: number,
  dureeMois: number,
  moisEcoules: number
): number {
  capital = safeNum(capital);
  tauxAnnuel = safeNum(tauxAnnuel);
  dureeMois = safeNum(dureeMois);
  moisEcoules = safeNum(moisEcoules);

  if (capital <= 0 || dureeMois <= 0) return 0;
  const r = tauxAnnuel / 100 / 12;
  if (r === 0) return Math.max(0, capital * (1 - moisEcoules / dureeMois));

  const crd =
    capital *
    (Math.pow(1 + r, dureeMois) - Math.pow(1 + r, moisEcoules)) /
    (Math.pow(1 + r, dureeMois) - 1);

  return Math.max(0, safeNum(crd));
}

// ─── NPV / IRR ──────────────────────────────────────────────────────

/** VAN (NPV) d'une série de flux annuels, taux en % */
export function computeNPV(flows: number[], ratePct: number): number {
  const r = safeNum(ratePct) / 100;
  const result = flows.reduce(
    (sum, cf, t) => sum + safeNum(cf) / Math.pow(1 + r, t),
    0
  );
  return safeNum(result);
}

/** TRI (IRR) par bisection. Retourne null si non convergent. */
export function computeIRR(
  flows: number[],
  minRate = -0.99,
  maxRate = 5.0,
  tolerance = 1e-7,
  maxIter = 200
): number | null {
  // Sanitize flows
  const safeFlows = flows.map((f) => safeNum(f));

  // Vérification basique: au moins un flux positif et un négatif
  const hasPositive = safeFlows.some((f) => f > 0);
  const hasNegative = safeFlows.some((f) => f < 0);
  if (!hasPositive || !hasNegative) return null;

  let lo = minRate;
  let hi = maxRate;

  const npvAt = (rate: number) =>
    safeFlows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + rate, t), 0);

  let npvLo = npvAt(lo);
  let npvHi = npvAt(hi);

  // Si même signe, pas de racine dans l'intervalle
  if (npvLo * npvHi > 0) return null;

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npvAt(mid);

    if (Math.abs(npvMid) < tolerance || (hi - lo) / 2 < tolerance) {
      const result = mid * 100; // retourner en %
      return safeNum(result, null) as number | null;
    }

    if (npvMid * npvLo < 0) {
      hi = mid;
      npvHi = npvMid;
    } else {
      lo = mid;
      npvLo = npvMid;
    }
  }

  const result = ((lo + hi) / 2) * 100;
  return safeNum(result, null) as number | null;
}

// ─── Calcul de scénario complet ─────────────────────────────────────

export function computeScenarioResults(
  deal: DealInputs,
  scenario: Scenario,
  riskFreeRate: number
): ScenarioResults {
  const N = scenario.dureeAnnees;
  const fin = scenario.financement;

  // ── Normalize deal inputs with fallback resolution ──
  const d = deal as any;
  const prixAchat = safeNum(deal.prixAchat);
  const fraisNotaire = safeNum(deal.fraisNotaire);
  const fraisAgence = safeNum(deal.fraisAgence);
  const montantTravaux = safeNum(deal.montantTravaux ?? d.travaux ?? d.travauxEstimes);
  const loyerMensuelBrut = safeNum(deal.loyerMensuelBrut ?? d.loyerMensuel ?? d.loyerEstime);
  const chargesAnnuelles = safeNum(
    deal.chargesAnnuelles ??
      (d.chargesMensuelles != null ? d.chargesMensuelles * 12 : undefined) ??
      (d.chargesEstimees != null ? d.chargesEstimees * 12 : undefined)
  );
  const vacanceLocativePct = safeNum(deal.vacanceLocativePct, 5);
  const prixReventeEstime = safeNum(deal.prixReventeEstime || prixAchat);

  // ── Coût total
  const coutTotal = prixAchat + fraisNotaire + fraisAgence + montantTravaux;

  if (coutTotal <= 0) {
    return {
      scenarioId: scenario.id,
      discountRate: 0,
      triEquity: null,
      vanEquity: 0,
      cashFlowCumule: 0,
      multipleCapital: 0,
      fluxEquity: [],
      mensualite: 0,
      crdSortie: 0,
      verdict: "insuffisant",
    };
  }

  // ── Financement
  const apportPct = safeNum(fin.apportPct, 20);
  const apport = coutTotal * (apportPct / 100);
  const capitalEmprunte = coutTotal - apport;

  const dureeMoisPret = safeNum(fin.dureeMois, 240);
  const differeMois = safeNum(fin.differeMois);
  const moisAmort = Math.max(1, dureeMoisPret - differeMois);
  const tauxNominal = safeNum(fin.tauxNominal, 3.5);
  const assurancePct = safeNum(fin.assurancePct, 0.34);

  const mensualiteAmort = computeMensualite(capitalEmprunte, tauxNominal, moisAmort, assurancePct);
  const mensualiteDiffere = computeMensualiteDiffere(capitalEmprunte, tauxNominal, assurancePct);

  // ── Discount rate
  const discountRate =
    scenario.discountRateMode === "auto"
      ? safeNum(riskFreeRate) +
        safeNum(scenario.primeRisqueScenario) +
        safeNum(scenario.primeIlliquidite) +
        safeNum(scenario.primeLevier)
      : safeNum(scenario.discountRateManual, 8);

  // ── Construire flux equity annuels
  const flows: number[] = [];
  flows.push(-apport);

  // CRD à la sortie
  const moisTotalEcoules = N * 12;
  const moisAmortEcoules = Math.max(0, moisTotalEcoules - differeMois);
  const crdSortie =
    moisAmortEcoules >= moisAmort
      ? 0
      : computeCRD(capitalEmprunte, tauxNominal, moisAmort, moisAmortEcoules);

  // ───────────────────────────────────────────────────────────────────
  // Simulation crédit mois par mois (pour intérêts/assurance déductibles)
  // ───────────────────────────────────────────────────────────────────
  const rMensuel = tauxNominal / 100 / 12;
  const assuranceMensuelleConst = (capitalEmprunte * assurancePct) / 100 / 12;

  let principalRestant = capitalEmprunte;
  let monthCursor = 0; // 0..N*12-1

  // t=1 à t=N
  for (let t = 1; t <= N; t++) {
    const moisDebut = (t - 1) * 12;
    const moisFin = t * 12;

    let chargeCredit = 0;
    let interetsAnnee = 0;
    let assuranceAnnee = 0;

    for (let m = moisDebut; m < moisFin; m++) {
      // synchronise le curseur au cas où
      monthCursor = m;

      // assurance (approx constante sur capital initial, volontairement simple)
      const assur = Math.max(0, assuranceMensuelleConst);
      assuranceAnnee += assur;

      if (m < differeMois) {
        // différé: intérêts seuls + assurance, principal constant
        const interets = Math.max(0, principalRestant * rMensuel);
        interetsAnnee += interets;

        chargeCredit += mensualiteDiffere;
      } else if (m - differeMois < moisAmort) {
        // amort: mensualité incl assurance (via computeMensualite)
        const interets = Math.max(0, principalRestant * rMensuel);
        interetsAnnee += interets;

        // Mensualité amortissable inclut assuranceMensuelleConst (selon computeMensualite)
        const payment = mensualiteAmort;

        // part capital = payment - intérêts - assurance
        const capitalRemb = Math.max(0, payment - interets - assur);
        principalRestant = Math.max(0, principalRestant - capitalRemb);

        chargeCredit += payment;
      } else {
        // prêt terminé
      }
    }

    if (scenario.strategy === "location") {
      // Loyers avec inflation et vacance
      const loyerAnnuelBrut =
        loyerMensuelBrut * 12 * Math.pow(1 + safeNum(scenario.inflationLoyers) / 100, t);

      const vacance = loyerAnnuelBrut * (vacanceLocativePct / 100);
      const loyersEncaisses = loyerAnnuelBrut - vacance; // recettes "réelles"

      // Charges hors crédit
      const charges =
        chargesAnnuelles * Math.pow(1 + safeNum(scenario.inflationTravaux) / 100, t);

      // Impôt v1.1 selon régime
      const { impot } = computeTaxLocationV11({
        regime: scenario.fiscalRegime,
        loyersEncaisses,
        chargesHorsCredit: charges,
        interets: interetsAnnee,
        assuranceEmprunteur: assuranceAnnee,
        taxRatePct: DEFAULT_TAX_RATE_PCT,
      });

      // Cashflow net (on retire bien la mensualité complète, car c'est ce qui sort en trésorerie)
      const cashflowAnnuelNet = loyersEncaisses - charges - chargeCredit - impot;

      if (t < N) {
        flows.push(safeNum(cashflowAnnuelNet));
      } else {
        const prixRevente =
          prixReventeEstime * Math.pow(1 + safeNum(scenario.inflationMarche) / 100, N);
        flows.push(safeNum(cashflowAnnuelNet + prixRevente - crdSortie));
      }
    } else {
      // Stratégie REVENTE: pas de loyers, juste charges + crédit
      const charges =
        chargesAnnuelles * Math.pow(1 + safeNum(scenario.inflationTravaux) / 100, t);
      const cashflowAnnuel = -charges - chargeCredit;

      if (t < N) {
        flows.push(safeNum(cashflowAnnuel));
      } else {
        const travauxInflated =
          montantTravaux * Math.pow(1 + safeNum(scenario.inflationTravaux) / 100, N);
        const prixRevente =
          (prixReventeEstime + travauxInflated * 0.3) *
          Math.pow(1 + safeNum(scenario.inflationMarche) / 100, N);
        flows.push(safeNum(cashflowAnnuel + prixRevente - crdSortie));
      }
    }
  }

  // ── Calculs agrégés
  const vanEquity = computeNPV(flows, discountRate);
  const triEquity = computeIRR(flows);

  const cashFlowCumule = safeNum(flows.reduce((sum, f) => sum + f, 0));
  const totalInvesti = Math.abs(flows[0]);
  const totalRecu = flows.slice(1).reduce((s, f) => s + Math.max(0, f), 0);
  const multipleCapital = totalInvesti > 0 ? safeNum(totalRecu / totalInvesti) : 0;

  // ── Verdict
  let verdict: ScenarioResults["verdict"] = "insuffisant";
  if (triEquity !== null) {
    if (triEquity >= discountRate + 3) verdict = "excellent";
    else if (triEquity >= discountRate) verdict = "bon";
    else if (triEquity >= discountRate - 2) verdict = "acceptable";
  } else if (vanEquity > 0) {
    verdict = "acceptable";
  }

  return {
    scenarioId: scenario.id,
    discountRate: safeNum(discountRate),
    triEquity,
    vanEquity: safeNum(vanEquity),
    cashFlowCumule,
    multipleCapital,
    fluxEquity: flows,
    mensualite: safeNum(mensualiteAmort),
    crdSortie: safeNum(crdSortie),
    verdict,
  };
}

// ─── Stress tests ───────────────────────────────────────────────────

export function computeStressTests(
  deal: DealInputs,
  scenario: Scenario,
  riskFreeRate: number
): StressTestResults {
  const base = computeScenarioResults(deal, scenario, riskFreeRate);

  // Stress: travaux +15%, revente -8%, taux +1.5pts
  const stressScenario: Scenario = {
    ...scenario,
    id: scenario.id + "_stress",
    financement: {
      ...scenario.financement,
      tauxNominal: scenario.financement.tauxNominal + 1.5,
    },
  };
  const stressDeal: DealInputs = {
    ...deal,
    montantTravaux: safeNum(deal.montantTravaux) * 1.15,
    prixReventeEstime: safeNum(deal.prixReventeEstime || deal.prixAchat) * 0.92,
  };
  const stress = computeScenarioResults(stressDeal, stressScenario, riskFreeRate);

  // Cash: stress + vacance +5pts + charges +10%
  const cashDeal: DealInputs = {
    ...stressDeal,
    vacanceLocativePct: safeNum(deal.vacanceLocativePct) + 5,
    chargesAnnuelles: safeNum(deal.chargesAnnuelles) * 1.1,
  };
  const cash = computeScenarioResults(cashDeal, stressScenario, riskFreeRate);

  return { base, stress, cash };
}

// ─── Taux d'actualisation recommandé ────────────────────────────────

export function computeRecommendedDiscountRate(
  riskFreeRate: number,
  scenario: Scenario
): number {
  return (
    safeNum(riskFreeRate) +
    safeNum(scenario.primeRisqueScenario) +
    safeNum(scenario.primeIlliquidite) +
    safeNum(scenario.primeLevier)
  );
}

// ─── Négociation ────────────────────────────────────────────────────

export function computeNegotiation(
  deal: DealInputs,
  scenario: Scenario,
  riskFreeRate: number
): NegotiationResult {
  const results = computeScenarioResults(deal, scenario, riskFreeRate);
  const prixAchat = safeNum(deal.prixAchat);

  // Prix max = prix actuel + VAN (si VAN > 0, on peut payer plus)
  const prixMaxRecommande = prixAchat + results.vanEquity;
  const zoneSecurity = prixMaxRecommande * 0.95;
  const seuilDanger = prixMaxRecommande * 1.05;
  const margeNego =
    prixAchat > 0 ? ((prixMaxRecommande - prixAchat) / prixAchat) * 100 : 0;

  return {
    prixMaxRecommande: Math.round(safeNum(prixMaxRecommande)),
    zoneSecurity: Math.round(safeNum(zoneSecurity)),
    seuilDanger: Math.round(safeNum(seuilDanger)),
    margeNego: Math.round(safeNum(margeNego) * 10) / 10,
  };
}

// ─── Comparaison scénarios ──────────────────────────────────────────

export function buildScenarioComparisons(
  results: ScenarioResults[],
  scenarios: Scenario[]
): ScenarioComparison[] {
  return results.map((r) => {
    const sc = scenarios.find((s) => s.id === r.scenarioId);
    return {
      scenarioId: r.scenarioId,
      name: sc?.name ?? r.scenarioId,
      triEquity: r.triEquity,
      vanEquity: r.vanEquity,
      discountRate: r.discountRate,
      verdict: r.verdict,
    };
  });
}

// ─── Auto-génération de 3 scénarios ─────────────────────────────────

let scenarioCounter = 0;

function nextId(): string {
  scenarioCounter++;
  return `sc-${Date.now()}-${scenarioCounter}`;
}

export function generateDefaultScenarios(strategy: StrategyType, regime: FiscalRegime): Scenario[] {
  const base: Omit<Scenario, "id" | "name" | "dureeAnnees" | "inflationMarche"> = {
    strategy,
    fiscalRegime: regime,
    inflationLoyers: 2.0,
    inflationTravaux: 2.5,
    financement: {
      apportPct: 20,
      tauxNominal: 3.5,
      dureeMois: 240,
      assurancePct: 0.34,
      differeMois: 0,
    },
    discountRateMode: "auto",
    discountRateManual: 8,
    primeRisqueScenario: 2.0,
    primeIlliquidite: 1.5,
    primeLevier: 1.0,
  };

  if (strategy === "revente") {
    return [
      {
        ...base,
        id: nextId(),
        name: "Revente rapide",
        dureeAnnees: 2,
        inflationMarche: 3.0,
        primeRisqueScenario: 3.0,
        financement: { ...base.financement, apportPct: 30, dureeMois: 120 },
      },
      {
        ...base,
        id: nextId(),
        name: "Revente moyen terme",
        dureeAnnees: 5,
        inflationMarche: 2.0,
        primeRisqueScenario: 2.0,
      },
      {
        ...base,
        id: nextId(),
        name: "Revente prudente",
        dureeAnnees: 7,
        inflationMarche: 1.0,
        primeRisqueScenario: 1.5,
        primeIlliquidite: 2.0,
      },
    ];
  }

  // Location
  return [
    {
      ...base,
      id: nextId(),
      name: "Location optimiste",
      dureeAnnees: 10,
      inflationMarche: 2.5,
      inflationLoyers: 2.5,
      primeRisqueScenario: 1.5,
    },
    {
      ...base,
      id: nextId(),
      name: "Location base",
      dureeAnnees: 15,
      inflationMarche: 1.5,
      inflationLoyers: 2.0,
      primeRisqueScenario: 2.0,
    },
    {
      ...base,
      id: nextId(),
      name: "Location prudente",
      dureeAnnees: 20,
      inflationMarche: 1.0,
      inflationLoyers: 1.5,
      primeRisqueScenario: 2.5,
      primeIlliquidite: 2.0,
    },
  ];
}

// ─── Helpers format ─────────────────────────────────────────────────

export function formatEuro(val: number): string {
  if (!Number.isFinite(val)) return "— €";
  return val.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

export function formatPct(val: number | null, decimals = 1): string {
  if (val === null || !Number.isFinite(val)) return "N/A";
  return `${val.toFixed(decimals)} %`;
}

// ─── Map snapshot to DealInputs ─────────────────────────────────────

export function mapSnapshotToDealInputs(snapshot: any): DealInputs {
  const p = snapshot?.propertyDraft ?? {};
  const price = safeNum(p.prixAchat ?? p.prix ?? p.price, 200000);
  const surface = safeNum(p.surfaceM2 ?? p.surface ?? p.surfaceHabitable, 50);

  return {
    dealId: snapshot?.dealId ?? snapshot?.id ?? "D-draft",
    label: p.label ?? p.titre ?? p.address ?? "Bien en analyse",
    address: p.address ?? p.adresse ?? "",
    prixAchat: price,
    fraisNotaire: safeNum(p.fraisNotaire, Math.round(price * 0.078)),
    fraisAgence: safeNum(p.fraisAgence),
    montantTravaux: safeNum(p.montantTravaux ?? p.travaux),
    loyerMensuelBrut: safeNum(p.loyerMensuelBrut ?? p.loyerBrut ?? p.loyer),
    chargesAnnuelles: safeNum(
      p.chargesAnnuelles ??
        (safeNum(p.chargesCopro) + safeNum(p.taxeFonciere) + safeNum(p.assurancePNO))
    ),
    vacanceLocativePct: safeNum(p.vacanceLocativePct, 5),
    prixReventeEstime: safeNum(p.prixReventeEstime, price),
    surfaceM2: surface,
    dpeNote: p.dpeNote ?? p.dpe ?? "D",
  };
}