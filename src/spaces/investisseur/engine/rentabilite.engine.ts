// src/spaces/investisseur/engine/rentabilite.engine.ts

import type {
  RentabiliteInput,
  RentabiliteResult,
  RentabiliteScenarios,
  RentabiliteStressTests,
  RentabiliteDecision,
  RentabiliteFormStrings,
  RegimeFiscalLocation,
} from "../types/rentabilite.types";

/* ------------------------------------------------------------------ */
/*  Parsing                                                            */
/* ------------------------------------------------------------------ */

/** Parse a French-formatted number string: strips spaces, €, %, replaces , with . */
export function parseNumberFR(raw: string): number {
  if (!raw || typeof raw !== "string") return 0;
  const cleaned = raw
    .replace(/\s/g, "")
    .replace(/€/g, "")
    .replace(/%/g, "")
    .replace(/,/g, ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function formToInput(form: RentabiliteFormStrings): RentabiliteInput {
  return {
    strategy: form.strategy,
    prixAchat: parseNumberFR(form.prixAchat),
    fraisNotairePct: parseNumberFR(form.fraisNotairePct),
    budgetTravaux: parseNumberFR(form.budgetTravaux),
    fraisDivers: parseNumberFR(form.fraisDivers),
    dureeMois: parseNumberFR(form.dureeMois),
    surface: parseNumberFR(form.surface),
    prixReventeCible: parseNumberFR(form.prixReventeCible),

    loyerMensuel: parseNumberFR(form.loyerMensuel),
    chargesMensuelles: parseNumberFR(form.chargesMensuelles),
    taxeFoncieresAnnuelle: parseNumberFR(form.taxeFoncieresAnnuelle),

    regimeFiscalLocation: form.regimeFiscalLocation,

    tmiPct: parseNumberFR(form.tmiPct),
    taxFlatPct: parseNumberFR(form.taxFlatPct),
    useFlatTax: form.useFlatTax,

    apport: parseNumberFR(form.apport),

    // v1: defaults constants (paramétrables plus tard si besoin)
    abattementMicroBicPct: 50,
    abattementMicroFoncierPct: 30,
  };
}

/* ------------------------------------------------------------------ */
/*  Core compute                                                       */
/* ------------------------------------------------------------------ */

function computeTaxableBaseLocation(
  regime: RegimeFiscalLocation,
  revenuNetAvantImpots: number,
  abattementMicroBicPct: number,
  abattementMicroFoncierPct: number
): number {
  if (revenuNetAvantImpots <= 0) return 0;

  const abatBic = Math.max(0, Math.min(100, abattementMicroBicPct)) / 100;
  const abatFoncier = Math.max(0, Math.min(100, abattementMicroFoncierPct)) / 100;

  switch (regime) {
    case "LMNP_MICRO_BIC":
      return revenuNetAvantImpots * (1 - abatBic);
    case "NU_MICRO_FONCIER":
      return revenuNetAvantImpots * (1 - abatFoncier);
    case "LMNP_REEL_SIMPLIFIE":
    case "NU_REEL_SIMPLIFIE":
    default:
      // v1: pas d'amortissements, base = net avant impôts
      return revenuNetAvantImpots;
  }
}

function computeOne(input: RentabiliteInput): RentabiliteResult {
  const {
    strategy,
    prixAchat,
    fraisNotairePct,
    budgetTravaux,
    fraisDivers,
    dureeMois,
    prixReventeCible,
    loyerMensuel,
    chargesMensuelles,
    taxeFoncieresAnnuelle,
    tmiPct,
    taxFlatPct,
    useFlatTax,
    apport,
    regimeFiscalLocation,
    abattementMicroBicPct = 50,
    abattementMicroFoncierPct = 30,
  } = input;

  const fraisNotaire = prixAchat * (fraisNotairePct / 100);
  const coutTotal = prixAchat + fraisNotaire + budgetTravaux + fraisDivers;

  let margeBrute = 0;
  let margePct = 0;
  let roiPct = 0;
  let triPct = 0;
  let cashflowMensuel = 0;
  let rendementBrutPct = 0;

  let revenuNetAvantImpotsAnnuel: number | undefined = undefined;
  let baseImposableAnnuel: number | undefined = undefined;
  let impotAnnuel: number | undefined = undefined;

  const reasons: string[] = [];

  if (strategy === "revente") {
    margeBrute = prixReventeCible - coutTotal;
    margePct = coutTotal > 0 ? (margeBrute / coutTotal) * 100 : 0;
    roiPct = apport > 0 ? (margeBrute / apport) * 100 : 0;
    triPct =
      coutTotal > 0 && dureeMois > 0
        ? (margeBrute / coutTotal) * (12 / dureeMois) * 100
        : 0;
  } else {
    // Location
    const revenuAnnuel = loyerMensuel * 12;
    const chargesAnnuel = chargesMensuelles * 12 + taxeFoncieresAnnuelle;

    revenuNetAvantImpotsAnnuel = revenuAnnuel - chargesAnnuel;

    const regime: RegimeFiscalLocation = regimeFiscalLocation ?? "LMNP_MICRO_BIC";
    baseImposableAnnuel = computeTaxableBaseLocation(
      regime,
      revenuNetAvantImpotsAnnuel,
      abattementMicroBicPct,
      abattementMicroFoncierPct
    );

    const tauxImpot = useFlatTax ? taxFlatPct / 100 : tmiPct / 100;
    impotAnnuel = Math.max(0, baseImposableAnnuel * tauxImpot);

    cashflowMensuel = (revenuNetAvantImpotsAnnuel - impotAnnuel) / 12;
    rendementBrutPct = prixAchat > 0 ? (revenuAnnuel / prixAchat) * 100 : 0;

    // If prixReventeCible is set, compute marge too
    if (prixReventeCible > 0) {
      margeBrute = prixReventeCible - coutTotal;
      margePct = coutTotal > 0 ? (margeBrute / coutTotal) * 100 : 0;
      roiPct = apport > 0 ? (margeBrute / apport) * 100 : 0;
      triPct =
        coutTotal > 0 && dureeMois > 0
          ? (margeBrute / coutTotal) * (12 / dureeMois) * 100
          : 0;
    }
  }

  const decision = computeDecision(
    strategy,
    margePct,
    margeBrute,
    triPct,
    cashflowMensuel,
    rendementBrutPct,
    reasons
  );

  return {
    fraisNotaire: round2(fraisNotaire),
    coutTotal: round2(coutTotal),
    margeBrute: round2(margeBrute),
    margePct: round2(margePct),
    roiPct: round2(roiPct),
    triPct: round2(triPct),
    cashflowMensuel: round2(cashflowMensuel),
    rendementBrutPct: round2(rendementBrutPct),

    revenuNetAvantImpotsAnnuel:
      revenuNetAvantImpotsAnnuel === undefined ? undefined : round2(revenuNetAvantImpotsAnnuel),
    baseImposableAnnuel: baseImposableAnnuel === undefined ? undefined : round2(baseImposableAnnuel),
    impotAnnuel: impotAnnuel === undefined ? undefined : round2(impotAnnuel),

    decision,
    reasons,
  };
}

function computeDecision(
  strategy: string,
  margePct: number,
  margeBrute: number,
  triPct: number,
  cashflowMensuel: number,
  rendementBrutPct: number,
  reasons: string[]
): RentabiliteDecision {
  if (strategy === "revente") {
    if (margePct >= 15 && margeBrute >= 30000 && triPct >= 20) {
      reasons.push("Marge ≥ 15 %", "Marge brute ≥ 30 000 €", "TRI ≥ 20 %");
      return "GO";
    }
    if ((margePct >= 10 && margePct < 15) || (triPct >= 15 && triPct < 20)) {
      if (margePct >= 10 && margePct < 15) reasons.push("Marge entre 10-15 %");
      if (triPct >= 15 && triPct < 20) reasons.push("TRI entre 15-20 %");
      return "GO_AVEC_RESERVES";
    }
    if (margePct < 10) reasons.push("Marge < 10 %");
    if (margeBrute < 30000) reasons.push("Marge brute < 30 000 €");
    if (triPct < 15) reasons.push("TRI < 15 %");
    return "NO_GO";
  }

  // Location
  if (cashflowMensuel >= 0 && rendementBrutPct >= 5) {
    reasons.push("Cashflow positif", "Rendement brut ≥ 5 %");
    return "GO";
  }
  if (cashflowMensuel >= 0 && rendementBrutPct < 5) {
    reasons.push("Cashflow positif", "Rendement brut < 5 %");
    return "GO_AVEC_RESERVES";
  }
  if (cashflowMensuel < 0) reasons.push("Cashflow négatif");
  if (rendementBrutPct < 5) reasons.push("Rendement brut < 5 %");
  return "NO_GO";
}

/* ------------------------------------------------------------------ */
/*  Scenarios & stress tests                                           */
/* ------------------------------------------------------------------ */

export function computeScenarios(input: RentabiliteInput): RentabiliteScenarios {
  const base = computeOne(input);

  const optimiste = computeOne({
    ...input,
    prixReventeCible: input.prixReventeCible * 1.03,
    budgetTravaux: input.budgetTravaux * 0.95,
  });

  const pessimiste = computeOne({
    ...input,
    prixReventeCible: input.prixReventeCible * 0.95,
    budgetTravaux: input.budgetTravaux * 1.10,
  });

  return { base, optimiste, pessimiste };
}

export function computeStressTests(input: RentabiliteInput): RentabiliteStressTests {
  const reventeMoins5 = computeOne({
    ...input,
    prixReventeCible: input.prixReventeCible * 0.95,
  });

  const travauxPlus10 = computeOne({
    ...input,
    budgetTravaux: input.budgetTravaux * 1.10,
  });

  return { reventeMoins5, travauxPlus10 };
}

export function computeAll(input: RentabiliteInput) {
  const scenarios = computeScenarios(input);
  const stressTests = computeStressTests(input);
  return { scenarios, stressTests };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatEUR(n: number): string {
  return n.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

export function formatPct(n: number): string {
  return `${n.toFixed(2)} %`;
}