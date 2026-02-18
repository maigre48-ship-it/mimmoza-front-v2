import type {
  QualificationInput,
  QualificationResult,
  QualificationDecision,
} from "./qualification.types";

export function computeQualification(
  input: QualificationInput
): QualificationResult {
  const {
    prixAchat,
    fraisNotairePct,
    budgetTravaux,
    fraisDivers,
    prixReventeEstime,
    dureeMois,
    apport,
  } = input;

  const fraisNotaire = prixAchat * (fraisNotairePct / 100);
  const coutTotalOperation =
    prixAchat + fraisNotaire + budgetTravaux + fraisDivers;

  const margeBrute = prixReventeEstime - coutTotalOperation;

  const margePct =
    coutTotalOperation > 0 ? (margeBrute / coutTotalOperation) * 100 : 0;

  const roi = apport > 0 ? (margeBrute / apport) * 100 : 0;

  const tri =
    coutTotalOperation > 0 && dureeMois > 0
      ? (margeBrute / coutTotalOperation) * (12 / dureeMois) * 100
      : 0;

  const raisons: string[] = [];
  let decision: QualificationDecision;

  const margeOk = margePct >= 15;
  const margeBruteOk = margeBrute >= 30_000;
  const triOk = tri >= 20;

  const margeReserve = margePct >= 10 && margePct < 15;
  const triReserve = tri >= 15 && tri < 20;

  if (margeOk && margeBruteOk && triOk) {
    decision = "GO";
    raisons.push(`Marge ${margePct.toFixed(1)}% ≥ 15%`);
    raisons.push(`Marge brute ${fmtN(margeBrute)} € ≥ 30 000 €`);
    raisons.push(`TRI ${tri.toFixed(1)}% ≥ 20%`);
  } else if (margeReserve || triReserve) {
    decision = "GO_AVEC_RESERVES";
    if (margeReserve) {
      raisons.push(`Marge ${margePct.toFixed(1)}% entre 10% et 15%`);
    }
    if (triReserve) {
      raisons.push(`TRI ${tri.toFixed(1)}% entre 15% et 20%`);
    }
    if (!margeBruteOk) {
      raisons.push(`Marge brute ${fmtN(margeBrute)} € < 30 000 €`);
    }
    if (!margeOk && !margeReserve) {
      raisons.push(`Marge ${margePct.toFixed(1)}% < 10%`);
    }
    if (!triOk && !triReserve) {
      raisons.push(`TRI ${tri.toFixed(1)}% < 15%`);
    }
  } else {
    decision = "NO_GO";
    if (margePct < 10) {
      raisons.push(`Marge ${margePct.toFixed(1)}% < 10%`);
    }
    if (margeBrute < 30_000) {
      raisons.push(`Marge brute ${fmtN(margeBrute)} € < 30 000 €`);
    }
    if (tri < 15) {
      raisons.push(`TRI ${tri.toFixed(1)}% < 15%`);
    }
    if (margeBrute <= 0) {
      raisons.push("Opération déficitaire");
    }
  }

  return {
    coutTotalOperation: r2(coutTotalOperation),
    fraisNotaire: r2(fraisNotaire),
    margeBrute: r2(margeBrute),
    margePct: r2(margePct),
    roi: r2(roi),
    tri: r2(tri),
    decision,
    raisons,
    computedAt: new Date().toISOString(),
  };
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

function fmtN(v: number): string {
  return Math.round(v).toLocaleString("fr-FR");
}