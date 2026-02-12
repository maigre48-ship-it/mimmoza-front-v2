// ============================================================================
// manualOperationAdapter.ts
// src/spaces/banque/adapters/manualOperationAdapter.ts
//
// Construit un OperationSummary à partir des champs existants du BanqueDossier.
// C'est le path "saisie manuelle" — Banque fonctionne SANS adapter externe.
// Produit aussi la liste missing[] pour transparence du score.
// ============================================================================

import type {
  OperationSummary,
  OperationProfile,
  MissingDataItem,
  MissingSeverity,
  OperationProject,
  OperationBudget,
  OperationFinancing,
  OperationRevenues,
  OperationKpis,
} from "../types/operationSummary.types";

// ── Helpers ──

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function addMissing(
  list: MissingDataItem[],
  key: string,
  label: string,
  severity: MissingSeverity,
  value: unknown
): void {
  if (value === undefined || value === null || value === "") {
    list.push({ key, label, severity });
  }
}

// ── Profile detection heuristic ──

function detectProfile(dossier: any): OperationProfile {
  // If already set via emprunteur or origination
  const explicit =
    dossier?.operation?.meta?.profile ??
    dossier?.emprunteur?.profileBanque ??
    dossier?.origination?.profileBanque;
  if (explicit && ["particulier", "marchand", "promoteur", "entreprise"].includes(explicit)) {
    return explicit as OperationProfile;
  }

  // Heuristic from projectType (legacy field from committee-workflow)
  const pt = (dossier?.projectType ?? dossier?.origination?.typeProjet ?? "").toLowerCase();
  if (pt === "promotion" || pt === "promoteur") return "promoteur";
  if (pt === "marchand" || pt === "marchand_de_biens") return "marchand";
  if (pt === "baseline" || pt === "particulier") return "particulier";

  // Heuristic from emprunteur type
  const empType = dossier?.emprunteur?.type;
  if (empType === "personne_morale") return "entreprise";
  if (empType === "personne_physique") return "particulier";

  return "particulier"; // safe default
}

// ── Required fields per profile (for missing[] computation) ──

interface RequiredField {
  key: string;
  label: string;
  severity: MissingSeverity;
  extract: (d: any) => unknown;
}

function getRequiredFields(profile: OperationProfile): RequiredField[] {
  const common: RequiredField[] = [
    { key: "project.address", label: "Adresse du bien", severity: "warn", extract: d => d?.origination?.adresseProjet },
    { key: "budget.purchasePrice", label: "Prix d'achat", severity: "blocker", extract: d => d?.origination?.montantProjet ?? d?.origination?.prixAchat },
    { key: "financing.loanAmount", label: "Montant du prêt", severity: "blocker", extract: d => d?.origination?.montantDemande },
    { key: "financing.loanDurationMonths", label: "Durée du prêt", severity: "warn", extract: d => d?.origination?.duree },
  ];

  const profileSpecific: Record<OperationProfile, RequiredField[]> = {
    particulier: [
      { key: "emprunteur.identite", label: "Identité emprunteur", severity: "warn", extract: d => d?.emprunteur?.nom ?? d?.sponsor },
      { key: "revenues.rentAnnual", label: "Revenus annuels", severity: "warn", extract: d => d?.origination?.revenusAnnuels },
    ],
    marchand: [
      { key: "budget.worksBudget", label: "Budget travaux", severity: "warn", extract: d => d?.origination?.budgetTravaux },
      { key: "revenues.exitValue", label: "Valeur de revente", severity: "blocker", extract: d => d?.origination?.valeurRevente },
      { key: "project.surfaceM2", label: "Surface (m²)", severity: "warn", extract: d => d?.origination?.surfaceM2 },
    ],
    promoteur: [
      { key: "budget.worksBudget", label: "Budget construction", severity: "blocker", extract: d => d?.origination?.budgetTravaux ?? d?.origination?.coutConstruction },
      { key: "budget.landCost", label: "Coût foncier", severity: "warn", extract: d => d?.origination?.coutFoncier },
      { key: "revenues.exitValue", label: "CA prévisionnel", severity: "blocker", extract: d => d?.origination?.chiffreAffaires ?? d?.origination?.valeurRevente },
      { key: "project.lots", label: "Nombre de lots", severity: "info", extract: d => d?.origination?.nombreLots },
      { key: "project.surfaceM2", label: "Surface (m²)", severity: "warn", extract: d => d?.origination?.surfaceM2 },
    ],
    entreprise: [
      { key: "emprunteur.siren", label: "SIREN entreprise", severity: "warn", extract: d => d?.emprunteur?.siren },
      { key: "revenues.revenueTotal", label: "CA annuel", severity: "warn", extract: d => d?.origination?.chiffreAffaires },
      { key: "budget.totalCost", label: "Coût total investissement", severity: "blocker", extract: d => d?.origination?.coutTotal },
    ],
  };

  return [...common, ...(profileSpecific[profile] ?? [])];
}

// ════════════════════════════════════════════════════════════════════
// MAIN BUILDER
// ════════════════════════════════════════════════════════════════════

export function buildOperationSummaryFromDossier(dossier: any): OperationSummary {
  const profile = detectProfile(dossier);
  const orig = dossier?.origination ?? {};
  const emp = dossier?.emprunteur ?? {};
  const missing: MissingDataItem[] = [];

  // ── Project ──
  const project: OperationProject = {
    label: str(dossier?.label) ?? str(orig?.nomProjet),
    operationType: str(orig?.typeOperation) as any,
    assetType: str(orig?.typeActif ?? orig?.typeBien ?? orig?.typeProjet) as any,
    address: str(orig?.adresseProjet),
    communeInsee: str(orig?.communeInsee ?? orig?.codeInsee),
    departement: str(orig?.departement),
    lat: num(orig?.lat ?? orig?.latitude),
    lng: num(orig?.lng ?? orig?.longitude),
    surfaceM2: num(orig?.surfaceM2 ?? orig?.surface),
    surfaceTerrain: num(orig?.surfaceTerrain),
    lots: num(orig?.nombreLots ?? orig?.lots),
    etages: num(orig?.etages),
    anneeConstruction: num(orig?.anneeConstruction),
    dpe: str(orig?.dpe),
    description: str(orig?.description ?? orig?.notes),
  };

  // ── Budget ──
  const purchasePrice = num(orig?.montantProjet ?? orig?.prixAchat);
  const notaryFees = num(orig?.fraisNotaire);
  const worksBudget = num(orig?.budgetTravaux ?? orig?.coutConstruction);
  const softCosts = num(orig?.honoraires ?? orig?.softCosts);
  const holdingCosts = num(orig?.fraisPortage ?? orig?.interetsIntercalaires);
  const contingency = num(orig?.aleas ?? orig?.provision);
  const landCost = num(orig?.coutFoncier);
  const constructionCost = num(orig?.coutConstruction);

  // Compute totalCost if not explicitly set
const rawTotal = num(orig?.coutTotal);

let computedTotal: number | undefined;

if (rawTotal !== undefined && rawTotal !== null) {
  computedTotal = rawTotal;
} else {
  const sum = [
    purchasePrice,
    notaryFees,
    worksBudget,
    softCosts,
    holdingCosts,
    contingency,
  ]
    .filter((v): v is number => v !== undefined)
    .reduce((s, v) => s + v, 0);

  computedTotal = sum > 0 ? sum : undefined;
}

const budget: OperationBudget = {
  purchasePrice,
  notaryFees,
  worksBudget,
  softCosts,
  holdingCosts,
  contingency,
  landCost,
  constructionCost,
  totalCost: computedTotal,
  costPerSqm:
    computedTotal && project.surfaceM2
      ? Math.round(computedTotal / project.surfaceM2)
      : undefined,
};

  // ── Financing ──
  const loanAmount = num(orig?.montantDemande);
  const financing: OperationFinancing = {
    loanAmount,
    loanDurationMonths: num(orig?.duree ?? orig?.dureeMois),
    loanType: str(orig?.typePret) as any,
    interestRate: num(orig?.tauxInteret ?? orig?.taux),
    equity: num(orig?.apportPersonnel ?? orig?.fonds_propres),
    apportPersonnel: num(orig?.apportPersonnel),
    insuranceCost: num(orig?.coutAssurance),
  };

  // ── Revenues ──
  const exitValue = num(orig?.valeurRevente ?? orig?.prixRevente ?? orig?.chiffreAffaires);
  const rentAnnual = num(orig?.loyerAnnuel ?? orig?.revenusAnnuels ?? orig?.revenusLocatifs);
  const revenues: OperationRevenues = {
    strategy: str(orig?.strategie ?? orig?.strategieSortie) as any,
    exitValue,
    rentAnnual,
    rentPerSqm:
      rentAnnual && project.surfaceM2
        ? Math.round(rentAnnual / project.surfaceM2)
        : undefined,
    occupancyRate: num(orig?.tauxOccupation),
    revenueTotal: num(orig?.chiffreAffaires),
  };

  // ── KPIs (auto-compute what we can) ──
  const kpis: OperationKpis = {};

  // LTV
  if (loanAmount && exitValue && exitValue > 0) {
    kpis.ltv = Math.round((loanAmount / exitValue) * 100);
  } else if (loanAmount && purchasePrice && purchasePrice > 0) {
    kpis.ltv = Math.round((loanAmount / purchasePrice) * 100);
  }

  // LTC
  if (loanAmount && computedTotal && computedTotal > 0) {
    kpis.ltc = Math.round((loanAmount / computedTotal) * 100);
  }

  // Margin (promoteur/marchand: (exit - cost) / cost)
  if (exitValue && computedTotal && computedTotal > 0) {
    kpis.margin = Math.round(((exitValue - computedTotal) / computedTotal) * 100);
    kpis.marginNet = kpis.margin; // simplified — same for now
  }

  // ROI
  const equity = financing.equity ?? financing.apportPersonnel;
  if (exitValue && computedTotal && equity && equity > 0) {
    kpis.roi = Math.round(((exitValue - computedTotal) / equity) * 100);
  }

  // Yield (investissement locatif)
  if (rentAnnual && purchasePrice && purchasePrice > 0) {
    kpis.yieldGross = Math.round((rentAnnual / purchasePrice) * 1000) / 10; // 1 décimale
  }

  // Cash-on-cash
  if (rentAnnual && equity && equity > 0) {
    kpis.cashOnCash = Math.round((rentAnnual / equity) * 1000) / 10;
  }

  // ── Missing data ──
  const required = getRequiredFields(profile);
  for (const field of required) {
    const value = field.extract(dossier);
    addMissing(missing, field.key, field.label, field.severity, value);
  }

  // Additional missing from guarantees/documents
  const garTotal = num(dossier?.garanties?.couvertureTotale);
  if (!garTotal || garTotal <= 0) {
    addMissing(missing, "garanties.couvertureTotale", "Couverture garanties", "warn", garTotal);
  }
  const docComp = num(dossier?.documents?.completude);
  if (!docComp || docComp < 50) {
    addMissing(missing, "documents.completude", "Complétude documentaire", "warn", docComp);
  }

  return {
    meta: {
      profile,
      createdAt: new Date().toISOString(),
      source: "manual",
    },
    project,
    budget,
    financing,
    revenues,
    kpis,
    missing,
  };
}

// ════════════════════════════════════════════════════════════════════
// Merge: combine manual operation with enriched data (market/risk)
// without losing manual inputs
// ════════════════════════════════════════════════════════════════════

export function mergeOperationWithEnriched(
  manual: OperationSummary,
  enriched: Partial<OperationSummary>
): OperationSummary {
  return {
    ...manual,
    meta: {
      ...manual.meta,
      ...enriched.meta,
      updatedAt: new Date().toISOString(),
      source: "enriched",
    },
    project: { ...manual.project, ...enriched.project },
    budget: { ...manual.budget, ...enriched.budget },
    financing: { ...manual.financing, ...enriched.financing },
    revenues: { ...manual.revenues, ...enriched.revenues },
    market: { ...(manual.market ?? {}), ...(enriched.market ?? {}) },
    risks: { ...(manual.risks ?? {}), ...(enriched.risks ?? {}) },
    kpis: { ...manual.kpis, ...enriched.kpis },
    // Re-compute missing from enriched (replaces manual missing)
    missing: enriched.missing ?? manual.missing,
  };
}