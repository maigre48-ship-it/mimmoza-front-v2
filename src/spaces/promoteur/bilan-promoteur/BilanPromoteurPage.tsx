// src/spaces/promoteur/bilan-promoteur/BilanPromoteurPage.tsx
// Pro forma v3.7 — moteur de faisabilité foncière
//   • V3.7 : foncier max admissible EXACT (résolution dichotomique), charge foncière
//     marché (€/m² SDP), score marché renforcé (prix/transactions/concurrence/absorption),
//     planning opération + durée, TRI promoteur, scoreRentabilité enrichi du TRI,
//     score global détaillé, lecture promoteur premium, persistance étendue.
//   • V3.6 : foncier max admissible + charge foncière, marge cible, coefficient régional
//     configurable, ascenseurs (coeff hauteur), sous-sol, score décomposé.
//   • V3.4 : prix unitaires travaux auto depuis la géométrie (deriveConstructionCosts).
//   • V3.3 : métré Massing 3D (SDP/logements via store programme), chiffrage détaillé.
//
// v3.2 — forfaits éditables + bridge réhab "consume-once".
// v3.1 — surfaceRehabM2 : champ surface en mode Réhabilitation.

import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PromoteurSynthesePage } from "../pages/PromoteurSynthesePage";
import type { Implantation2DSnapshot } from "../plan2d/implantation2d.snapshot";
import {
  totalEmpriseM2 as snapTotalEmprise,
  totalSdpM2 as snapTotalSdp,
} from "../plan2d/implantation2d.snapshot";
import type { PromoteurRawInput } from "../services/promoteurSynthese.types";
import {
  HeroGhostButton,
  HeroPrimaryButton,
  PromoteurPageHero,
} from "../shared/components/PromoteurPageHero";
import { ACCENT_PRO } from "../shared/promoteurDesign.tokens";
import { getSnapshot, patchModule } from "../shared/promoteurSnapshot.store";
import { usePromoteurStudy } from "../shared/usePromoteurStudy";
import {
  PROGRAMME_EVENT,
  resolvedNbLogements,
  usePromoteurProgrammeStore,
} from "../store/promoteurProgramme.store";
import { usePromoteurProjectStore } from "../store/promoteurProject.store";
import { MASSING_METRICS_EVENT, readMassingMetrics, type MassingMetrics } from "../terrain3d/massingBilanBridge";
import { deriveConstructionCosts } from "../terrain3d/massingConstructionCosts";

// ── Clés localStorage ─────────────────────────────────────────────────────────
export const SYNTHESE_RAW_KEY = "mimmoza.promoteur.synthese.rawInput.v1";
const LS_MARKET_STUDY         = "synthesis_market_study";

/** Bridge depuis PromoteurSimulationTravauxPage */
const BILAN_TRAVAUX_KEY   = "mimmoza.promoteur.bilan.travaux.v1";
const BILAN_TRAVAUX_EVENT = "mimmoza:promoteur-bilan-travaux-updated";

interface BilanTravauxBridgePayload {
  totalWithBuffer: number;
  totalHT: number;
  bufferPct: number;
  mode: "simple" | "expert";
  /** Surface totale réhabilitée (m²) transmise depuis la simulation */
  surfaceTotaleM2: number;
  updatedAt: string;
}

function bilanLandPriceKey(id: string)   { return `mimmoza.bilan.land_price_eur.${id}`; }
function bilanAssumptionsKey(id: string) { return `mimmoza.bilan.assumptions.${id}`; }
function terrassementKey(id: string)     { return `mimmoza.terrassement.export.${id}`; }

function n(v: unknown, fallback = 0): number { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function pct(v: unknown, fallback = 0): number { const x = n(v, fallback); if (x < 0) return 0; if (x > 100) return 100; return x; }
function clamp(x: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, x)); }
function eur(v: number): string { try { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v); } catch { return `${Math.round(v)} €`; } }
function m2(v: number): string { return `${Math.round(v)} m²`; }
function safeAreaM2(feat: Feature<Geometry> | null | undefined): number { if (!feat?.geometry) return 0; try { return turf.area(feat as turf.AllGeoJSON); } catch { return 0; } }
function sumAreas(fc?: FeatureCollection<Geometry> | null): number { if (!fc?.features || !Array.isArray(fc.features)) return 0; return fc.features.reduce((acc, f) => acc + safeAreaM2(f as Feature<Geometry>), 0); }

// ── Coefficient régional de construction (table configurable). ──────────────────
const REGION_CONSTRUCTION_FACTORS: { depts: string[]; factor: number; label: string }[] = [
  { depts: ["75", "92", "93", "94"], factor: 1.15, label: "Île-de-France dense" },
  { depts: ["77", "78", "91", "95"], factor: 1.10, label: "Grande couronne IDF" },
  { depts: ["06", "13"], factor: 1.10, label: "PACA tendu" },
  { depts: ["69"], factor: 1.08, label: "Métropole lyonnaise" },
  { depts: ["33", "31", "44", "59", "35", "67"], factor: 1.05, label: "Grandes métropoles" },
];
function regionConstructionFactor(dept?: string | null): { factor: number; label: string } {
  if (dept) {
    for (const r of REGION_CONSTRUCTION_FACTORS) if (r.depts.includes(dept)) return { factor: r.factor, label: r.label };
  }
  return { factor: 1.0, label: "Moyenne nationale" };
}

// ── Ascenseurs — coût base × coefficient de hauteur. ────────────────────────────
function ascenseurHeightCoef(levelsCount: number): number {
  const rPlus = Math.max(0, Math.round(levelsCount) - 1); // levelsCount inclut le RDC → R+rPlus
  if (rPlus <= 2) return 1;     // R+0 à R+2
  if (rPlus <= 4) return 1.2;   // R+3 à R+4
  if (rPlus <= 7) return 1.45;  // R+5 à R+7
  return 1.8;                   // R+8 et plus
}
function computeAscenseurCost(nbAscenseurs: number, levelsCount: number, baseCost: number): number {
  return Math.max(0, nbAscenseurs) * Math.max(0, baseCost) * ascenseurHeightCoef(levelsCount);
}

type BuildingKind = "INDIVIDUEL" | "COLLECTIF";
type FloorsSpec   = { aboveGroundFloors: number; groundFloorHeightM: number; typicalFloorHeightM: number; };

// ── Assumptions ───────────────────────────────────────────────────────────────
type Assumptions = {
  salePriceEurM2Hab: number; commercialisationPct: number; coefVendable: number;
  landPriceEur: number; notaryFeesPct: number; acquisitionTaxesPct: number;
  worksCostEurM2Sdp: number; vrdPct: number; extPct: number; contingencyPct: number;
  surveyorEur: number; geotechEur: number; moePct: number; betPct: number;
  spsCtOpcEur: number; insuranceDoPct: number; miscEur: number;
  marketingPctCa: number; marketingFixedEur: number;
  financingRatePct: number; financingFeesEur: number; taxeAmenagementEurM2Sdp: number;
  terrassementEur: number;
  // Chiffrage détaillé depuis le métré Massing 3D (prix unitaires éditables).
  structureCostEurM2Sdp: number;   // gros œuvre / structure (remplace le forfait quand massing)
  facadeCostEurM2: number;         // ravalement / ITE
  roofTerrasseCostEurM2: number;   // étanchéité
  roofPenteCostEurM2: number;      // charpente + couverture
  balconyCostEurM2: number;        // dalles de balcon
  windowUnitCostEur: number;       // menuiserie à l'unité
  foundationCostEurM2Emprise: number; // fondations €/m² d'emprise
  soilType: "normal" | "argileux" | "pieux"; // nature du sol → multiplicateur fondations
  parkingType: "surface" | "aerien" | "sous_sol"; // type de parking
  parkingCostPerPlace: number;        // € HT par place
  /** true = prix construction calculés auto depuis la géométrie ; false = personnalisés */
  autoCosts: boolean;
  /** Montant travaux depuis simulation réhabilitation (0 = non défini) */
  travauxRehabTotal: number;
  /** true = utiliser travauxRehabTotal et surfaceRehabM2 */
  rehabMode: boolean;
  /** Surface SDP réhabilitée (m²) — transmise depuis la simulation ou saisie manuelle */
  surfaceRehabM2: number;
  /** Marge cible promoteur (%) — base du foncier max admissible */
  targetMarginPct: number;
  /** Ascenseurs — coût base × coeff hauteur */
  nbAscenseurs: number;
  ascenseurBaseCostEur: number;
  /** Sous-sol */
  nbSousSols: number;
  surfaceSousSolM2: number;
  coutSousSolEurM2: number;
  /** Planning opération (ÉV.4) — en mois */
  dureeAcquisitionMois: number;
  dureePermisMois: number;
  dureePurgeMois: number;
  dureeTravauxMois: number;
  dureeCommercialisationMois: number;
  /** Marge de sécurité appliquée au foncier max → prix terrain conseillé (ÉV.1) */
  margeSecuriteFoncierPct: number;
};

type Line = { section: string; label: string; valueEur: number; kind?: "subtotal" | "total"; hint?: string; };

const COEF_SDP = 1.0;
const COEF_HABITABLE_COLLECTIF  = 0.82;
const COEF_HABITABLE_INDIVIDUEL = 0.9;

const DEFAULT_ASSUMPTIONS: Assumptions = {
  salePriceEurM2Hab: 5200, commercialisationPct: 100, coefVendable: 1.0, landPriceEur: NaN,
  notaryFeesPct: 7.5, acquisitionTaxesPct: 0, worksCostEurM2Sdp: 1800, vrdPct: 6, extPct: 3,
  contingencyPct: 3, surveyorEur: 6000, geotechEur: 12000, moePct: 10, betPct: 3,
  spsCtOpcEur: 15000, insuranceDoPct: 2, miscEur: 8000, marketingPctCa: 2, marketingFixedEur: 0,
  financingRatePct: 4, financingFeesEur: 8000, taxeAmenagementEurM2Sdp: 80,
  terrassementEur: 0,
  structureCostEurM2Sdp: 1100, facadeCostEurM2: 180, roofTerrasseCostEurM2: 180,
  roofPenteCostEurM2: 220, balconyCostEurM2: 600, windowUnitCostEur: 650,
  foundationCostEurM2Emprise: 290, soilType: "normal",
  parkingType: "surface", parkingCostPerPlace: 3000,
  autoCosts: true,
  travauxRehabTotal: 0,
  rehabMode: false,
  surfaceRehabM2: 0,
  targetMarginPct: 18,
  nbAscenseurs: 0, ascenseurBaseCostEur: 70000,
  nbSousSols: 0, surfaceSousSolM2: 0, coutSousSolEurM2: 1100,
  dureeAcquisitionMois: 3, dureePermisMois: 6, dureePurgeMois: 3, dureeTravauxMois: 18, dureeCommercialisationMois: 24,
  margeSecuriteFoncierPct: 15,
};

// Multiplicateur fondations selon la nature du sol.
const SOIL_MULT: Record<Assumptions["soilType"], number> = { normal: 1, argileux: 1.45, pieux: 2.3 };
const SOIL_LABEL: Record<Assumptions["soilType"], string> = { normal: "sol normal", argileux: "sol argileux", pieux: "pieux" };

// Coût par place selon le type de parking (€ HT/place).
const PARKING_COST: Record<Assumptions["parkingType"], number> = { surface: 3000, aerien: 12000, sous_sol: 22000 };
const PARKING_LABEL: Record<Assumptions["parkingType"], string> = { surface: "surface / enrobé", aerien: "aérien", sous_sol: "sous-sol" };
const M2_PAR_PLACE = 25; // emprise moyenne d'une place (repli si nb non saisi)

// ── computeProForma (NE PAS MODIFIER) ───────────────────────────────────────────
//  Le coefficient régional (regionFactor) ne s'applique QU'aux coûts de
//  construction principaux : forfait €/m² SDP et gros œuvre Massing.
function computeProForma(
  ass: Assumptions,
  sdpEstimatedM2: number,
  surfaceVendableM2: number,
  massing: MassingMetrics | null = null,
  worksMultiplier = 1,
  regionFactor = 1,
  levelsCount = 1,
) {
  const useRehab   = ass.rehabMode && ass.travauxRehabTotal > 0;
  const useMassing = !ass.rehabMode && !!massing && massing.totaux.sdpM2 > 0;

  // Chiffrage détaillé depuis le métré Massing 3D (quantités) × prix unitaires.
  const structureCost    = useMassing ? sdpEstimatedM2 * n(ass.structureCostEurM2Sdp, 0) * regionFactor : 0;
  const facadeCost       = useMassing ? massing!.totaux.surfaceFacadeNetteM2 * n(ass.facadeCostEurM2, 0) : 0;
  const roofTerrasseCost = useMassing ? massing!.totaux.surfaceToitureTerrasseM2 * n(ass.roofTerrasseCostEurM2, 0) : 0;
  const roofPenteCost    = useMassing ? massing!.totaux.surfaceToiturePenteM2 * n(ass.roofPenteCostEurM2, 0) : 0;
  const balconyCost      = useMassing ? massing!.totaux.surfaceBalconsM2 * n(ass.balconyCostEurM2, 0) : 0;
  const menuiserieCost   = useMassing ? massing!.totaux.nbMenuiseries * n(ass.windowUnitCostEur, 0) : 0;
  const foundationCost   = useMassing ? massing!.totaux.empriseSolM2 * n(ass.foundationCostEurM2Emprise, 0) * (SOIL_MULT[ass.soilType] ?? 1) : 0;
  const massingTravaux   = structureCost + foundationCost + facadeCost + roofTerrasseCost + roofPenteCost + balconyCost + menuiserieCost;

  const travauxBaseRaw = useRehab
    ? n(ass.travauxRehabTotal, 0)
    : useMassing
      ? massingTravaux
      : sdpEstimatedM2 * n(ass.worksCostEurM2Sdp, 0) * regionFactor;
  const travauxBase = travauxBaseRaw * worksMultiplier;

  // Coûts directs — non soumis au coefficient régional ni aux % (VRD/MOE/BET/aléas),
  // mais stressés comme des travaux (worksMultiplier) pour le scénario +5 %.
  const ascenseursCost = computeAscenseurCost(n(ass.nbAscenseurs, 0), levelsCount, n(ass.ascenseurBaseCostEur, 0)) * worksMultiplier;
  const sousSolCost    = n(ass.nbSousSols, 0) * n(ass.surfaceSousSolM2, 0) * n(ass.coutSousSolEurM2, 0) * worksMultiplier;

  const caLogements  = surfaceVendableM2 * n(ass.salePriceEurM2Hab, 0) * (pct(ass.commercialisationPct, 100) / 100);
  const caTotal      = caLogements;
  const foncier      = n(ass.landPriceEur, 0);
  const fraisNotaire = foncier * (pct(ass.notaryFeesPct, 7.5) / 100);
  const taxesAcq     = foncier * (pct(ass.acquisitionTaxesPct, 0) / 100);
  const totalFoncier = foncier + fraisNotaire + taxesAcq;
  const surveyor     = n(ass.surveyorEur, 0);
  const geotech      = n(ass.geotechEur, 0);
  const moe          = travauxBase * (pct(ass.moePct, 10) / 100);
  const bet          = travauxBase * (pct(ass.betPct, 3) / 100);
  const spsCtOpc     = n(ass.spsCtOpcEur, 0);
  const insuranceDo  = travauxBase * (pct(ass.insuranceDoPct, 2) / 100);
  const misc         = n(ass.miscEur, 0);
  const totalEtudes  = surveyor + geotech + moe + bet + spsCtOpc + insuranceDo + misc;
  const vrd          = travauxBase * (pct(ass.vrdPct, 6) / 100);
  const ext          = travauxBase * (pct(ass.extPct, 3) / 100);
  const aleas        = travauxBase * (pct(ass.contingencyPct, 3) / 100);
  const totalTravaux = travauxBase + vrd + ext + aleas + ascenseursCost + sousSolCost;
  const taxeAmenagement = sdpEstimatedM2 * n(ass.taxeAmenagementEurM2Sdp, 0);
  const totalTaxes   = taxeAmenagement;
  const marketingPct = caTotal * (pct(ass.marketingPctCa, 2) / 100);
  const marketingFixed = n(ass.marketingFixedEur, 0);
  const totalCom     = marketingPct + marketingFixed;
  const baseFin      = totalFoncier + 0.5 * totalTravaux;
  const intercalaires = baseFin * (pct(ass.financingRatePct, 4) / 100);
  const fraisFin     = n(ass.financingFeesEur, 0);
  const totalFin     = intercalaires + fraisFin;
  const coutTotal    = totalFoncier + totalEtudes + totalTravaux + totalTaxes + totalCom + totalFin;
  const marge        = caTotal - coutTotal;
  const margePct     = caTotal > 0 ? (marge / caTotal) * 100 : 0;
  const coutRevientEurM2Hab = surfaceVendableM2 > 0 ? coutTotal / surfaceVendableM2 : 0;
  const coutRevientEurM2Sdp = sdpEstimatedM2    > 0 ? coutTotal / sdpEstimatedM2    : 0;
  const travauxEurM2Sdp = sdpEstimatedM2 > 0 ? travauxBase / sdpEstimatedM2 : 0;
  return {
    useRehab, useMassing, travauxBase, travauxEurM2Sdp,
    structureCost, foundationCost, facadeCost, roofTerrasseCost, roofPenteCost, balconyCost, menuiserieCost,
    ascenseursCost, sousSolCost,
    caLogements, caTotal, foncier, fraisNotaire, taxesAcq, totalFoncier,
    surveyor, geotech, moe, bet, spsCtOpc, insuranceDo, misc, totalEtudes,
    vrd, ext, aleas, totalTravaux, taxeAmenagement, totalTaxes,
    marketingPct, marketingFixed, totalCom, intercalaires, fraisFin, totalFin,
    coutTotal, marge, margePct, coutRevientEurM2Hab, coutRevientEurM2Sdp,
  };
}

// ── ÉV.1 — Foncier max admissible EXACT (résolution dichotomique). ──────────────
//  On cherche le prix de foncier X tel que marge(X) = marge cible, en réutilisant
//  computeProForma (non modifié) avec landPriceEur surchargé. La marge décroît de
//  façon monotone avec X → la dichotomie converge. Tolérance : 1 €.
function computeFoncierMaxAdmissible(args: {
  ass: Assumptions; sdpEstimatedM2: number; surfaceVendableM2: number;
  massing: MassingMetrics | null; regionFactor: number; levelsCount: number;
  terrassementEur: number; parkingCost: number; targetMarginPct: number;
}): number {
  const { ass, sdpEstimatedM2, surfaceVendableM2, massing, regionFactor, levelsCount, terrassementEur, parkingCost, targetMarginPct } = args;
  const t = pct(targetMarginPct, 18) / 100;
  const caRef = computeProForma(ass, sdpEstimatedM2, surfaceVendableM2, massing, 1, regionFactor, levelsCount).caTotal;
  if (!(caRef > 0)) return 0;
  const margeCible = caRef * t;

  // marge nette pour un prix de foncier x (terrassement + parking ajoutés hors computeProForma).
  const margeAt = (x: number): number => {
    const pf = computeProForma({ ...ass, landPriceEur: x }, sdpEstimatedM2, surfaceVendableM2, massing, 1, regionFactor, levelsCount);
    return pf.caTotal - (pf.coutTotal + terrassementEur + parkingCost);
  };

  // Si même à 0 € de foncier la marge cible n'est pas atteinte → 0 (projet non finançable).
  if (margeAt(0) - margeCible <= 0) return 0;
  // Si même à X = CA la marge reste ≥ cible (cas théorique) → borne haute.
  if (margeAt(caRef) - margeCible >= 0) return Math.round(caRef);

  let lo = 0, hi = caRef;
  for (let i = 0; i < 80 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2;
    const f = margeAt(mid) - margeCible;
    if (f > 0) lo = mid; else hi = mid; // marge décroissante : si surplus, on peut payer plus cher
  }
  return Math.round((lo + hi) / 2);
}

function readTerrassementFromStorage(studyId: string | null): { eur: number; hint: string } {
  if (!studyId) return { eur: 0, hint: "" };
  try {
    const raw = localStorage.getItem(terrassementKey(studyId)); if (!raw) return { eur: 0, hint: "" };
    const data = JSON.parse(raw); if (!(data?.totalCout > 0)) return { eur: 0, hint: "" };
    const hint = [`Δ ${data.maxDeltaM?.toFixed(1) ?? "?"}m`, `pente ${data.maxSlopeDeg?.toFixed(1) ?? "?"}°`, data.slopeWarning === "fort" ? "⚠ pente forte" : null].filter(Boolean).join(" · ");
    return { eur: Math.round(data.totalCout / 100) * 100, hint };
  } catch { return { eur: 0, hint: "" }; }
}

// ── ConflictBanner ────────────────────────────────────────────────────────────
const ConflictBanner: React.FC<{ rehabTotal: number; onUseNeuf: () => void; onUseRehab: () => void }> = ({ rehabTotal, onUseNeuf, onUseRehab }) => (
  <div style={{ marginBottom: 16, padding: "16px 20px", background: "#fff7ed", border: "2px solid #f97316", borderLeft: "6px solid #ea580c", borderRadius: 14 }}>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
      <span style={{ fontSize: 26, flexShrink: 0 }}>⚠️</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#9a3412", marginBottom: 6 }}>Conflit de sources détecté</div>
        <p style={{ fontSize: 13, color: "#7c2d12", lineHeight: 1.6, margin: "0 0 14px" }}>
          Des <strong>bâtiments dessinés en Conception</strong> (Implantation 2D) <em>et</em> un <strong>total de Réhabilitation</strong> ({eur(rehabTotal)}) issu de la Simulation Travaux sont présents simultanément. Choisissez le mode de votre opération.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={onUseNeuf} style={{ padding: "9px 18px", borderRadius: 10, border: "2px solid #7c3aed", background: "#ede9fe", color: "#4c1d95", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>🏗 Programme neuf — Implantation 2D</button>
          <button type="button" onClick={onUseRehab} style={{ padding: "9px 18px", borderRadius: 10, border: "2px solid #7c3aed", background: ACCENT_PRO, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>🔧 Réhabilitation — Simulation Travaux</button>
        </div>
      </div>
    </div>
  </div>
);

const RehabBanner: React.FC<{ rehabTotal: number; surfaceM2: number; onClear: () => void }> = ({ rehabTotal, surfaceM2, onClear }) => (
  <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(82,71,184,0.06)", border: "1px solid rgba(82,71,184,0.3)", borderLeft: `4px solid ${ACCENT_PRO}`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
    <div style={{ fontSize: 13, color: ACCENT_PRO, fontWeight: 600 }}>
      🔧 <strong>Mode Réhabilitation actif</strong> — Travaux : {eur(rehabTotal)}{surfaceM2 > 0 ? ` · ${Math.round(surfaceM2)} m²` : " — ⚠️ Renseignez la surface ci-dessous"}
    </div>
    <button type="button" onClick={onClear}
      style={{ padding: "5px 12px", borderRadius: 8, border: `1px solid ${ACCENT_PRO}`, background: "#fff", color: ACCENT_PRO, fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
      ✕ Effacer / Mode neuf
    </button>
  </div>
);

// ── Page ─────────────────────────────────────────────────────────────────────
export const BilanPromoteurPage: React.FC = () => {
  const buildings = usePromoteurProjectStore((s) => s.buildings);
  const parkings  = usePromoteurProjectStore((s) => s.parkings);
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");
  const { study, loadState, patchBilan } = usePromoteurStudy(studyId);

  const prevStudyIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (prevStudyIdRef.current !== null && prevStudyIdRef.current !== studyId) {
      usePromoteurProjectStore.getState().clearImplantation();
    }
    prevStudyIdRef.current = studyId;
  }, [studyId]);

  const footprintBuildingsM2Raw = useMemo(() => sumAreas(buildings), [buildings]);
  const footprintParkingsM2     = useMemo(() => sumAreas(parkings),  [parkings]);

  const [snap2d,           setSnap2d]           = useState<Implantation2DSnapshot | null>(null);
  const [terrassementHint, setTerrassementHint] = useState<string>("");
  const [activeTab,        setActiveTab]        = useState<"bilan" | "synthese">("bilan");
  const [buildingKind,     setBuildingKind]     = useState<BuildingKind>("COLLECTIF");
  const [floorsSpec,       setFloorsSpec]       = useState<FloorsSpec>({ aboveGroundFloors: 1, groundFloorHeightM: 2.8, typicalFloorHeightM: 2.7 });
  const [nbLogements,      setNbLogements]      = useState<number>(1);
  const [synthesisSaved,   setSynthesisSaved]   = useState(false);
  const [ass,              setAss]              = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const hydratedRef = useRef(false);
  const [massing, setMassing] = useState<MassingMetrics | null>(null);

  // ── Hydratation ────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    hydratedRef.current = false;
    if (!studyId) { setAss(DEFAULT_ASSUMPTIONS); setTerrassementHint(""); hydratedRef.current = true; return; }
    try {
      const rawAss = localStorage.getItem(bilanAssumptionsKey(studyId));
      if (rawAss) {
        const saved = JSON.parse(rawAss) as Partial<Assumptions>;
        const merged: Assumptions = { ...DEFAULT_ASSUMPTIONS, ...saved };
        if (merged.landPriceEur === null || merged.landPriceEur === undefined) {
          const rawPrice = localStorage.getItem(bilanLandPriceKey(studyId));
          const price = rawPrice ? Number(rawPrice) : NaN;
          merged.landPriceEur = Number.isFinite(price) && price > 0 ? price : NaN;
        } else if (!Number.isFinite(merged.landPriceEur)) { merged.landPriceEur = NaN; }
        setAss(merged);
      } else {
        const rawPrice = localStorage.getItem(bilanLandPriceKey(studyId));
        const price = rawPrice ? Number(rawPrice) : NaN;
        setAss(Number.isFinite(price) && price > 0 ? { ...DEFAULT_ASSUMPTIONS, landPriceEur: price } : DEFAULT_ASSUMPTIONS);
      }
    } catch { setAss(DEFAULT_ASSUMPTIONS); }
    const terr = readTerrassementFromStorage(studyId);
    setTerrassementHint(terr.hint);
    hydratedRef.current = true;
  }, [studyId]);

  // ── Bridge simulation travaux → bilan (handoff "consume-once") ─────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BILAN_TRAVAUX_KEY);
      if (raw) {
        try { localStorage.removeItem(BILAN_TRAVAUX_KEY); } catch { /* */ }
        const payload = JSON.parse(raw) as BilanTravauxBridgePayload;
        if (payload.totalWithBuffer > 0) {
          setAss((prev) => {
            if (prev.travauxRehabTotal === 0) {
              return {
                ...prev,
                travauxRehabTotal: payload.totalWithBuffer,
                surfaceRehabM2: payload.surfaceTotaleM2 > 0 ? payload.surfaceTotaleM2 : prev.surfaceRehabM2,
                rehabMode: true,
              };
            }
            return prev;
          });
        }
      }
    } catch { /* silencieux */ }

    function onTravauxUpdated(e: Event) {
      const payload = (e as CustomEvent<BilanTravauxBridgePayload>).detail;
      if (payload.totalWithBuffer > 0) {
        setAss((prev) => ({
          ...prev,
          travauxRehabTotal: payload.totalWithBuffer,
          surfaceRehabM2: payload.surfaceTotaleM2 > 0 ? payload.surfaceTotaleM2 : prev.surfaceRehabM2,
          rehabMode: true,
        }));
      }
    }
    window.addEventListener(BILAN_TRAVAUX_EVENT, onTravauxUpdated);
    return () => window.removeEventListener(BILAN_TRAVAUX_EVENT, onTravauxUpdated);
  }, []);

  // ── Persistance ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hydratedRef.current || !studyId) return;
    try {
      localStorage.setItem(bilanAssumptionsKey(studyId), JSON.stringify(ass));
      if (Number.isFinite(ass.landPriceEur) && ass.landPriceEur > 0) {
        localStorage.setItem(bilanLandPriceKey(studyId), String(ass.landPriceEur));
      }
    } catch (e) { console.warn("[BilanPromoteur] persistance échouée:", e); }
  }, [ass, studyId]);

  // ── Actions conflit / mode ─────────────────────────────────────────────────
  const activateNeufMode  = () => setAss((p) => ({ ...p, rehabMode: false }));
  const activateRehabMode = () => setAss((p) => ({ ...p, rehabMode: true }));
  const clearRehabMode    = () => {
    setAss((p) => ({ ...p, travauxRehabTotal: 0, surfaceRehabM2: 0, rehabMode: false }));
    try { localStorage.removeItem(BILAN_TRAVAUX_KEY); } catch { /* */ }
  };

  // ── Commune ───────────────────────────────────────────────────────────────
  const [communeNom, setCommuneNom] = useState<string | null>(null);
  const [codePostal, setCodePostal] = useState<string | null>(null);
  useEffect(() => {
    const insee = study?.foncier?.commune_insee;
    if (!insee || communeNom) return;
    let cancelled = false;
    fetch(`https://geo.api.gouv.fr/communes/${insee}?fields=nom,codesPostaux`, { signal: AbortSignal.timeout(5000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (cancelled || !data) return; if (data.nom) setCommuneNom(data.nom); if (data.codesPostaux?.[0]) setCodePostal(data.codesPostaux[0]); })
      .catch(() => { /* silencieux */ });
    return () => { cancelled = true; };
  }, [study?.foncier?.commune_insee, communeNom]);

  // ── Terrassement ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!studyId) return;
    const apply = () => {
      const t = readTerrassementFromStorage(studyId);
      if (t.eur > 0) { setAss(prev => prev.terrassementEur === 0 ? { ...prev, terrassementEur: t.eur } : prev); setTerrassementHint(t.hint); }
      else { setAss(prev => prev.terrassementEur > 0 ? { ...prev, terrassementEur: 0 } : prev); setTerrassementHint(""); }
    };
    apply();
    window.addEventListener("focus", apply);
    return () => window.removeEventListener("focus", apply);
  }, [studyId]);

  // ── Bridge Massing 3D → Bilan (mount + focus + event live) ──────────────────
  useEffect(() => {
    if (!studyId) { setMassing(null); return; }
    const apply = () => {
      const snap = readMassingMetrics(studyId);
      setMassing(snap ? snap.metrics : null);
    };
    apply();
    window.addEventListener("focus", apply);
    window.addEventListener(MASSING_METRICS_EVENT, apply as EventListener);
    return () => {
      window.removeEventListener("focus", apply);
      window.removeEventListener(MASSING_METRICS_EVENT, apply as EventListener);
    };
  }, [studyId]);

  // ── Store programme : la typologie Programmation fait foi sur le nb de logements. ──
  const programmeEnvelope = usePromoteurProgrammeStore((s) => s.envelope);
  const programmeMix       = usePromoteurProgrammeStore((s) => s.mix);
  const loadProgramme      = usePromoteurProgrammeStore((s) => s.loadStudy);
  const reloadProgramme    = usePromoteurProgrammeStore((s) => s.reloadFromStorage);

  useEffect(() => { loadProgramme(studyId); }, [studyId, loadProgramme]);

  useEffect(() => {
    const onProg = () => reloadProgramme();
    window.addEventListener(PROGRAMME_EVENT, onProg);
    window.addEventListener("focus", onProg);
    return () => {
      window.removeEventListener(PROGRAMME_EVENT, onProg);
      window.removeEventListener("focus", onProg);
    };
  }, [reloadProgramme]);

  const resolvedLogements = useMemo(
    () => resolvedNbLogements(programmeEnvelope, programmeMix),
    [programmeEnvelope, programmeMix],
  );

  useEffect(() => {
    if (ass.rehabMode) return;
    if (resolvedLogements.value > 0) setNbLogements(resolvedLogements.value);
  }, [resolvedLogements, ass.rehabMode]);

  // ── Coefficient régional — déduit du département INSEE via la table. ──
  const regionInfo = useMemo(() => {
    const fsnap = (getSnapshot()?.foncier as { communeInsee?: string } | null) ?? null;
    let sessionInsee: string | undefined;
    try { sessionInsee = localStorage.getItem("mimmoza.session.commune_insee") ?? undefined; } catch { sessionInsee = undefined; }
    const insee = study?.foncier?.commune_insee ?? fsnap?.communeInsee ?? sessionInsee ?? undefined;
    const dept = insee ? insee.slice(0, 2) : undefined;
    return { dept, ...regionConstructionFactor(dept) };
  }, [study?.foncier?.commune_insee]);

  // ── Auto-prix construction : dérivés de la géométrie (nb niveaux). ──────────
  const derivedCosts = useMemo(
    () => (massing && !ass.rehabMode ? deriveConstructionCosts(massing) : null),
    [massing, ass.rehabMode],
  );

  useEffect(() => {
    if (ass.rehabMode || !ass.autoCosts || !derivedCosts) return;
    setAss((prev) => {
      if (
        prev.structureCostEurM2Sdp === derivedCosts.structureCostEurM2Sdp &&
        prev.facadeCostEurM2 === derivedCosts.facadeCostEurM2 &&
        prev.roofTerrasseCostEurM2 === derivedCosts.roofTerrasseCostEurM2 &&
        prev.roofPenteCostEurM2 === derivedCosts.roofPenteCostEurM2 &&
        prev.balconyCostEurM2 === derivedCosts.balconyCostEurM2 &&
        prev.windowUnitCostEur === derivedCosts.windowUnitCostEur &&
        prev.foundationCostEurM2Emprise === derivedCosts.foundationCostEurM2Emprise
      ) return prev;
      return {
        ...prev,
        structureCostEurM2Sdp: derivedCosts.structureCostEurM2Sdp,
        facadeCostEurM2:        derivedCosts.facadeCostEurM2,
        roofTerrasseCostEurM2:  derivedCosts.roofTerrasseCostEurM2,
        roofPenteCostEurM2:     derivedCosts.roofPenteCostEurM2,
        balconyCostEurM2:       derivedCosts.balconyCostEurM2,
        windowUnitCostEur:      derivedCosts.windowUnitCostEur,
        foundationCostEurM2Emprise: derivedCosts.foundationCostEurM2Emprise,
      };
    });
  }, [derivedCosts, ass.autoCosts, ass.rehabMode]);

  // ── Snap 2D ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const fromStudy = (study as any)?.implantation2d as Implantation2DSnapshot | undefined;
    if (fromStudy?.buildings?.length) { setSnap2d(fromStudy); return; }
    const fromSnapshot = getSnapshot()?.implantation2d as Implantation2DSnapshot | undefined;
    if (fromSnapshot?.buildings?.length) { setSnap2d(fromSnapshot); return; }
    setSnap2d(null);
  }, [study, studyId]);

  useEffect(() => {
    if (loadState !== "ready" || !study) return;
    if (study.evaluation?.cout_foncier) setAss((prev) => { if (Number.isFinite(prev.landPriceEur) && prev.landPriceEur > 0) return prev; return { ...prev, landPriceEur: study.evaluation!.cout_foncier! }; });
    if (study.marche?.prix_m2_neuf) setAss((prev) => ({ ...prev, salePriceEurM2Hab: study.marche!.prix_m2_neuf! }));
  }, [loadState, study]);

  // ── Surfaces ──────────────────────────────────────────────────────────────
  const footprintBuildingsM2 = footprintBuildingsM2Raw > 0 ? footprintBuildingsM2Raw : (snap2d ? snapTotalEmprise(snap2d) : 0);
  const sdpFromSnap          = snap2d ? snapTotalSdp(snap2d) : 0;
  const levelsCount  = useMemo(() => 1 + Math.max(0, Math.floor(n(floorsSpec.aboveGroundFloors, 0))), [floorsSpec.aboveGroundFloors]);
  const totalHeightM = useMemo(() => n(floorsSpec.groundFloorHeightM, 2.8) + Math.max(0, Math.floor(n(floorsSpec.aboveGroundFloors, 0))) * n(floorsSpec.typicalFloorHeightM, 2.7), [floorsSpec]);
  const coefHab      = buildingKind === "INDIVIDUEL" ? 0.9 : 0.82;

  const sdpEstimatedM2 = useMemo(() => {
    if (ass.rehabMode && ass.surfaceRehabM2 > 0) return ass.surfaceRehabM2;
    if (massing && !ass.rehabMode && massing.totaux.sdpM2 > 0) return massing.totaux.sdpM2;
    if (footprintBuildingsM2Raw <= 0 && sdpFromSnap > 0) return sdpFromSnap;
    return footprintBuildingsM2 * levelsCount * 1.0;
  }, [ass.rehabMode, ass.surfaceRehabM2, massing, footprintBuildingsM2Raw, footprintBuildingsM2, levelsCount, sdpFromSnap]);

  const habitableEstimatedM2 = useMemo(() => sdpEstimatedM2 * coefHab, [sdpEstimatedM2, coefHab]);
  const surfaceVendableM2    = useMemo(() => habitableEstimatedM2 * n(ass.coefVendable, 1), [habitableEstimatedM2, ass.coefVendable]);

  // Nb de logements issu de la typologie Massing 3D (somme T1..T5).
  const nbLogementsFromTypologie = useMemo(() => {
    if (!massing?.typologie) return 0;
    return (
      Number(massing.typologie.T1 ?? 0) +
      Number(massing.typologie.T2 ?? 0) +
      Number(massing.typologie.T3 ?? 0) +
      Number(massing.typologie.T4 ?? 0) +
      Number((massing.typologie as any).T5 ?? 0)
    );
  }, [massing]);

  // Source de vérité : quand le Massing est connecté et que la typologie donne un total,
  // c'est elle qui fait foi (sinon, le state nbLogements / la programmation).
  const nbLogementsEffectif =
    !!massing && !ass.rehabMode && nbLogementsFromTypologie > 0
      ? nbLogementsFromTypologie
      : nbLogements;

  const hasConceptionData = footprintBuildingsM2 > 0 || sdpFromSnap > 0;
  const hasRehabData      = ass.travauxRehabTotal > 0;
  const realConflict      = hasConceptionData && hasRehabData;

  const marcheFromLS = useMemo(() => { try { const raw = localStorage.getItem(LS_MARKET_STUDY); if (!raw) return null; const p = JSON.parse(raw); return p?.data?.market ?? null; } catch { return null; } }, []);  
  const risquesFromSnap = useMemo(() => { try { const snap = getSnapshot() as any; return snap?.risks?.data ?? null; } catch { return null; } }, []);  

  // ── Computed ──────────────────────────────────────────────────────────────
  const computed = useMemo(() => {
    const pf = computeProForma(ass, sdpEstimatedM2, surfaceVendableM2, massing, 1, regionInfo.factor, levelsCount);
    const pfCoutTotal    = pf.coutTotal + ass.terrassementEur;
    const pfMarge        = pf.caTotal - pfCoutTotal;
    const pfMargePct     = pf.caTotal > 0 ? (pfMarge / pf.caTotal) * 100 : 0;
    const pfCoutRevM2Hab = surfaceVendableM2 > 0 ? pfCoutTotal / surfaceVendableM2 : 0;
    const pfCoutRevM2Sdp = sdpEstimatedM2    > 0 ? pfCoutTotal / sdpEstimatedM2    : 0;
    const nbParkingsEff = programmeMix.nbParkings > 0
      ? programmeMix.nbParkings
      : (footprintParkingsM2 > 0 ? Math.max(1, Math.round(footprintParkingsM2 / M2_PAR_PLACE)) : 0);
    const parkingCost = nbParkingsEff * n(ass.parkingCostPerPlace, 0);
    const pfTotalTravaux = pf.totalTravaux + ass.terrassementEur + parkingCost;

    const lines: Line[] = [];
    lines.push({ section: "RECETTES", label: "CA logements", valueEur: pf.caLogements, hint: `${m2(surfaceVendableM2)} × ${ass.salePriceEurM2Hab} €/m²` });
    lines.push({ section: "RECETTES", label: "CA TOTAL", valueEur: pf.caTotal, kind: "subtotal" });
    lines.push({ section: "A) FONCIER", label: "Prix foncier", valueEur: pf.foncier });
    lines.push({ section: "A) FONCIER", label: "Frais notaire", valueEur: pf.fraisNotaire, hint: `${ass.notaryFeesPct.toFixed(1)}%` });
    lines.push({ section: "A) FONCIER", label: "Droits / taxes acquisition", valueEur: pf.taxesAcq, hint: `${ass.acquisitionTaxesPct.toFixed(1)}%` });
    lines.push({ section: "A) FONCIER", label: "Total foncier", valueEur: pf.totalFoncier, kind: "subtotal" });
    lines.push({ section: "B) ÉTUDES & MONTAGE", label: "Géomètre", valueEur: pf.surveyor, hint: "forfait" });
    lines.push({ section: "B) ÉTUDES & MONTAGE", label: "Géotechnique", valueEur: pf.geotech, hint: "forfait" });
    lines.push({ section: "B) ÉTUDES & MONTAGE", label: "MOE / Architecte", valueEur: pf.moe, hint: `${ass.moePct.toFixed(1)}% travaux` });
    lines.push({ section: "B) ÉTUDES & MONTAGE", label: "BET", valueEur: pf.bet, hint: `${ass.betPct.toFixed(1)}% travaux` });
    lines.push({ section: "B) ÉTUDES & MONTAGE", label: "SPS / CT / OPC", valueEur: pf.spsCtOpc, hint: "forfait" });
    lines.push({ section: "B) ÉTUDES & MONTAGE", label: "Assurance DO", valueEur: pf.insuranceDo, hint: `${ass.insuranceDoPct.toFixed(1)}% travaux` });
    lines.push({ section: "B) ÉTUDES & MONTAGE", label: "Divers montage", valueEur: pf.misc, hint: "forfait" });
    lines.push({ section: "B) ÉTUDES & MONTAGE", label: "Total études & montage", valueEur: pf.totalEtudes, kind: "subtotal" });
    if (pf.useRehab) {
      lines.push({ section: "C) TRAVAUX", label: "🔧 Travaux réhabilitation (simulation)", valueEur: pf.travauxBase, hint: `${m2(ass.surfaceRehabM2)} · total + buffer` });
    } else if (pf.useMassing && massing) {
      lines.push({ section: "C) TRAVAUX", label: "Gros œuvre / structure", valueEur: pf.structureCost, hint: `${m2(sdpEstimatedM2)} × ${ass.structureCostEurM2Sdp} €/m² SDP${regionInfo.factor !== 1 ? ` · rég. ×${regionInfo.factor.toFixed(2)}` : ""}` });
      if (pf.foundationCost > 0)   lines.push({ section: "C) TRAVAUX", label: "Fondations", valueEur: pf.foundationCost, hint: `${m2(massing.totaux.empriseSolM2)} emprise × ${ass.foundationCostEurM2Emprise} €/m²${ass.soilType !== "normal" ? ` · ${SOIL_LABEL[ass.soilType]} ×${SOIL_MULT[ass.soilType]}` : ""}` });
      if (pf.facadeCost > 0)       lines.push({ section: "C) TRAVAUX", label: "Façade (ravalement / ITE)", valueEur: pf.facadeCost, hint: `${m2(massing.totaux.surfaceFacadeNetteM2)} × ${ass.facadeCostEurM2} €/m²` });
      if (pf.roofTerrasseCost > 0) lines.push({ section: "C) TRAVAUX", label: "Toiture terrasse (étanchéité)", valueEur: pf.roofTerrasseCost, hint: `${m2(massing.totaux.surfaceToitureTerrasseM2)} × ${ass.roofTerrasseCostEurM2} €/m²` });
      if (pf.roofPenteCost > 0)    lines.push({ section: "C) TRAVAUX", label: "Toiture pente (charpente + couverture)", valueEur: pf.roofPenteCost, hint: `${m2(massing.totaux.surfaceToiturePenteM2)} × ${ass.roofPenteCostEurM2} €/m²` });
      if (pf.balconyCost > 0)      lines.push({ section: "C) TRAVAUX", label: "Balcons", valueEur: pf.balconyCost, hint: `${m2(massing.totaux.surfaceBalconsM2)} × ${ass.balconyCostEurM2} €/m²` });
      if (pf.menuiserieCost > 0)   lines.push({ section: "C) TRAVAUX", label: "Menuiseries", valueEur: pf.menuiserieCost, hint: `${massing.totaux.nbMenuiseries} u × ${ass.windowUnitCostEur} €` });
    } else {
      lines.push({ section: "C) TRAVAUX", label: "Travaux principaux", valueEur: pf.travauxBase, hint: `${m2(sdpEstimatedM2)} × ${ass.worksCostEurM2Sdp} €/m² SDP${regionInfo.factor !== 1 ? ` · rég. ×${regionInfo.factor.toFixed(2)}` : ""}` });
    }
    lines.push({ section: "C) TRAVAUX", label: "VRD / raccordements", valueEur: pf.vrd, hint: `${ass.vrdPct.toFixed(1)}% travaux` });
    if (ass.terrassementEur > 0) lines.push({ section: "C) TRAVAUX", label: "Terrassement / nivellement", valueEur: ass.terrassementEur, hint: terrassementHint || "Massing 3D" });
    if (parkingCost > 0) lines.push({ section: "C) TRAVAUX", label: "Parking", valueEur: parkingCost, hint: `${nbParkingsEff} pl × ${ass.parkingCostPerPlace} € · ${PARKING_LABEL[ass.parkingType]}` });
    if (pf.ascenseursCost > 0) {
      const coef = ascenseurHeightCoef(levelsCount);
      lines.push({ section: "C) TRAVAUX", label: "Ascenseurs", valueEur: pf.ascenseursCost, hint: `${n(ass.nbAscenseurs, 0)} u × ${n(ass.ascenseurBaseCostEur, 0).toLocaleString("fr-FR")} € · coeff hauteur ×${coef}` });
    }
    if (pf.sousSolCost > 0) lines.push({ section: "C) TRAVAUX", label: "Sous-sol", valueEur: pf.sousSolCost, hint: `${m2(n(ass.surfaceSousSolM2, 0))}/niv. × ${n(ass.nbSousSols, 0)} niveaux × ${n(ass.coutSousSolEurM2, 0)} €/m²` });
    lines.push({ section: "C) TRAVAUX", label: "Aménagements extérieurs", valueEur: pf.ext, hint: `${ass.extPct.toFixed(1)}% travaux` });
    lines.push({ section: "C) TRAVAUX", label: "Aléas travaux", valueEur: pf.aleas, hint: `${ass.contingencyPct.toFixed(1)}% travaux` });
    lines.push({ section: "C) TRAVAUX", label: "Total travaux", valueEur: pfTotalTravaux, kind: "subtotal" });
    if (sdpEstimatedM2 > 0) lines.push({ section: "C) TRAVAUX", label: "↳ Prix moyen travaux", valueEur: Math.round(pfTotalTravaux / sdpEstimatedM2), hint: "€/m² SDP — indicatif (tous lots)" });
    lines.push({ section: "D) TAXES", label: "Taxe d'aménagement", valueEur: pf.taxeAmenagement, hint: `${ass.taxeAmenagementEurM2Sdp} €/m² SDP` });
    lines.push({ section: "D) TAXES", label: "Total taxes", valueEur: pf.totalTaxes, kind: "subtotal" });
    lines.push({ section: "E) COMMERCIALISATION", label: "Commercialisation (% CA)", valueEur: pf.marketingPct, hint: `${ass.marketingPctCa.toFixed(1)}%` });
    lines.push({ section: "E) COMMERCIALISATION", label: "Commercialisation (forfait)", valueEur: pf.marketingFixed, hint: "option" });
    lines.push({ section: "E) COMMERCIALISATION", label: "Total commercialisation", valueEur: pf.totalCom, kind: "subtotal" });
    lines.push({ section: "F) FINANCEMENT", label: "Intérêts intercalaires", valueEur: pf.intercalaires, hint: `${ass.financingRatePct.toFixed(1)}% × (foncier + 0.5×travaux)` });
    lines.push({ section: "F) FINANCEMENT", label: "Frais dossier / garanties", valueEur: pf.fraisFin, hint: "forfait" });
    lines.push({ section: "F) FINANCEMENT", label: "Total financement", valueEur: pf.totalFin, kind: "subtotal" });
    lines.push({ section: "TOTAL", label: "COÛT TOTAL OPÉRATION", valueEur: pfCoutTotal, kind: "total" });
    lines.push({ section: "TOTAL", label: "MARGE BRUTE", valueEur: pfMarge, kind: "total" });

    const notes: string[] = [];
    if (sdpEstimatedM2 <= 0) notes.push("Surface SDP = 0 : renseignez la surface réhabilitée.");
    if (ass.salePriceEurM2Hab <= 0) notes.push("Prix de vente €/m² non renseigné : CA = 0.");
    if (!n(ass.landPriceEur, 0)) notes.push("Foncier non renseigné : le bilan est incomplet.");
    if (ass.terrassementEur > 0) notes.push(`Terrassement intégré : ${eur(ass.terrassementEur)} HT (${terrassementHint}).`);
    if (pf.useRehab) notes.push(`Mode Réhabilitation — Travaux = ${eur(pf.travauxBase)} · Surface = ${m2(ass.surfaceRehabM2)}.`);
    if (massing && !ass.rehabMode) notes.push(`Métré piloté par le Massing 3D — SDP ${m2(massing.totaux.sdpM2)} · ${nbLogementsEffectif} logement(s).`);
    if (pf.useMassing && ass.autoCosts && derivedCosts) notes.push(`Prix construction auto — ${derivedCosts.basis}.`);
    if (regionInfo.factor !== 1) notes.push(`Coefficient régional ×${regionInfo.factor.toFixed(2)} (${regionInfo.label}) appliqué aux coûts de construction principaux.`);

    const safeNb = nbLogementsEffectif > 0 ? nbLogementsEffectif : 1;
    return {
      ...pf, coutTotal: pfCoutTotal, marge: pfMarge, margePct: pfMargePct,
      coutRevientEurM2Hab: pfCoutRevM2Hab, coutRevientEurM2Sdp: pfCoutRevM2Sdp,
      totalTravaux: pfTotalTravaux, lines, notes,
      travauxEurM2Sdp: sdpEstimatedM2 > 0 ? pfTotalTravaux / sdpEstimatedM2 : 0,
      parkingCost, nbParkingsEff,
      prixParLogement: pf.caTotal / safeNb,
      coutParLogement: pfCoutTotal / safeNb,
      margeParLogement: pfMarge / safeNb,
    };
  }, [ass, sdpEstimatedM2, surfaceVendableM2, nbLogementsEffectif, terrassementHint, massing, derivedCosts, programmeMix, footprintParkingsM2, regionInfo, levelsCount]);

  // ── Stress test (sensibilité) ───────────────────────────────────────────────
  const sensitivity = useMemo(() => {
    const pfA = computeProForma(ass, sdpEstimatedM2, surfaceVendableM2, massing, 1.05, regionInfo.factor, levelsCount);
    const pfB = computeProForma({ ...ass, salePriceEurM2Hab: ass.salePriceEurM2Hab * 0.95 }, sdpEstimatedM2, surfaceVendableM2, massing, 1, regionInfo.factor, levelsCount);
    const terr = ass.terrassementEur;
    return {
      base: { marge: computed.marge, margePct: computed.margePct },
      scenarioA: { label: "+5% coût travaux",  marge: pfA.caTotal - pfA.coutTotal - terr, margePct: pfA.caTotal > 0 ? ((pfA.caTotal - pfA.coutTotal - terr) / pfA.caTotal) * 100 : 0, deltaMarge: (pfA.caTotal - pfA.coutTotal - terr) - computed.marge, deltaPct: (pfA.caTotal > 0 ? ((pfA.caTotal - pfA.coutTotal - terr) / pfA.caTotal) * 100 : 0) - computed.margePct },
      scenarioB: { label: "-5% prix de vente", marge: pfB.caTotal - pfB.coutTotal - terr, margePct: pfB.caTotal > 0 ? ((pfB.caTotal - pfB.coutTotal - terr) / pfB.caTotal) * 100 : 0, deltaMarge: (pfB.caTotal - pfB.coutTotal - terr) - computed.marge, deltaPct: (pfB.caTotal > 0 ? ((pfB.caTotal - pfB.coutTotal - terr) / pfB.caTotal) * 100 : 0) - computed.margePct },
    };
  }, [ass, sdpEstimatedM2, surfaceVendableM2, computed.marge, computed.margePct, massing, regionInfo, levelsCount]);

  // ── Faisabilité foncière : foncier max exact, charge foncière marché, planning, TRI, scores ──
  const feasibility = useMemo(() => {
    const CA   = computed.caTotal;
    const tPct = pct(ass.targetMarginPct, 18);

    // ── ÉV.1 — Foncier max admissible EXACT (dichotomie). ──
    const foncierMaxExact = computeFoncierMaxAdmissible({
      ass, sdpEstimatedM2, surfaceVendableM2, massing,
      regionFactor: regionInfo.factor, levelsCount,
      terrassementEur: ass.terrassementEur, parkingCost: computed.parkingCost, targetMarginPct: tPct,
    });
    const foncierMax    = foncierMaxExact;
    const foncierActuel = n(ass.landPriceEur, 0);
    const foncierEcart  = foncierMax - foncierActuel; // >0 = marge de négociation, <0 = surpayé
    const margeCibleEur = CA * (tPct / 100);

    const chargeFonciereActuelleEurM2Sdp = sdpEstimatedM2 > 0 ? foncierActuel / sdpEstimatedM2 : 0;
    const chargeFonciereMaxEurM2Sdp      = sdpEstimatedM2 > 0 ? foncierMax / sdpEstimatedM2    : 0;

    // ── ÉV.2 — Charge foncière marché (≈ 15 % du prix de vente de marché). ──
    const marketPriceRef =
      study?.marche?.prix_m2_neuf ??
      (marcheFromLS?.prices?.median_eur_m2 ?? null) ??
      study?.marche?.prix_moyen_dvf ??
      (marcheFromLS?.dvf?.prix_m2_median ?? null);
    const chargeFonciereMarcheEurM2Sdp = marketPriceRef && marketPriceRef > 0 ? marketPriceRef * 0.15 : null;
    let chargeMarchePositionPct: number | null = null;
    let chargeMarcheComment: string | null = null;
    if (chargeFonciereMarcheEurM2Sdp && chargeFonciereMarcheEurM2Sdp > 0 && chargeFonciereActuelleEurM2Sdp > 0) {
      chargeMarchePositionPct = (chargeFonciereActuelleEurM2Sdp / chargeFonciereMarcheEurM2Sdp - 1) * 100;
      chargeMarcheComment = chargeMarchePositionPct > 5
        ? "Charge foncière supérieure au marché local"
        : chargeMarchePositionPct < -5
          ? "Charge foncière inférieure au marché local"
          : "Charge foncière cohérente avec le marché";
    }

    const margeReellePct = computed.margePct;
    const margeCiblePct  = tPct;
    const margeEcartPts   = margeReellePct - margeCiblePct;
    const margeRatio      = margeCiblePct > 0 ? margeReellePct / margeCiblePct : 0;
    const margeColor = margeReellePct >= margeCiblePct ? "#16a34a" : margeRatio >= 0.8 ? "#ea580c" : "#dc2626";

    // ── ÉV.4 — Planning opération. ──
    const dureeChantier = n(ass.dureeAcquisitionMois, 3) + n(ass.dureePermisMois, 6) + n(ass.dureePurgeMois, 3) + n(ass.dureeTravauxMois, 18);
    const dureeOperationMois = Math.round(Math.max(dureeChantier, n(ass.dureeCommercialisationMois, 24)));
    const { label: dureeLabel, color: dureeColor } =
      dureeOperationMois < 24 ? { label: "Rapide",   color: "#16a34a" } :
      dureeOperationMois <= 36 ? { label: "Standard", color: "#ca8a04" } :
                                 { label: "Long",     color: "#ea580c" };

    // ── ÉV.5 — TRI promoteur (fonds propres estimés à 30 % du coût total). ──
    const fondsPropres = 0.3 * computed.coutTotal;
    const years = dureeOperationMois > 0 ? dureeOperationMois / 12 : 1;
    let triPromoteurPct: number;
    if (fondsPropres > 0) {
      const finalVal = fondsPropres + computed.marge;
      triPromoteurPct = finalVal <= 0 ? -100 : (Math.pow(finalVal / fondsPropres, 1 / years) - 1) * 100;
    } else triPromoteurPct = 0;
    const { label: triLabel, color: triColor } =
      triPromoteurPct > 20 ? { label: "Excellent", color: "#15803d" } :
      triPromoteurPct >= 15 ? { label: "Bon",      color: "#16a34a" } :
      triPromoteurPct >= 10 ? { label: "Moyen",    color: "#ca8a04" } :
                              { label: "Faible",   color: "#dc2626" };

    // ── ÉV.6 — scoreRentabilite /100 : marge 40 + foncier 30 + stress 20 + TRI 10. ──
    const margeSub = margeCiblePct > 0 ? clamp(40 * (margeReellePct / margeCiblePct), 0, 40) : (margeReellePct > 0 ? 40 : 0);
    let foncierSub: number;
    if (foncierActuel <= 0) foncierSub = 20;                        // non renseigné → neutre
    else if (foncierMax <= 0) foncierSub = 0;                       // cible inatteignable
    else foncierSub = clamp(30 * (2 - foncierActuel / foncierMax), 0, 30); // ≤max→30, +100%→0
    const stressMpct = sensitivity.scenarioA.margePct;
    const stressSub  = margeCiblePct > 0 ? clamp(20 * (stressMpct / margeCiblePct), 0, 20) : (stressMpct >= 0 ? 20 : 0);
    const triSub     = clamp(10 * (triPromoteurPct / 20), 0, 10);   // 20 % → 10 pts
    const scoreRentabilite = Math.round(clamp(margeSub + foncierSub + stressSub + triSub, 0, 100));

    // ── ÉV.3 — scoreMarche /100 : prix 40 + transactions 20 + concurrence 20 + absorption 20. ──
    //  Chaque composante absente prend une valeur neutre (la moitié) → 50/100 si tout absent.
    const nbTx        = study?.marche?.nb_transactions ?? (marcheFromLS?.dvf?.nb_transactions ?? null);
    const concurrence = study?.marche?.nb_programmes_concurrents ?? null;
    const absorption  = study?.marche?.absorption_mensuelle ?? null;

    const hasPrix = !!(marketPriceRef && marketPriceRef > 0 && ass.salePriceEurM2Hab > 0);
    const hasTx   = !!(nbTx && nbTx > 0);
    const hasConc = concurrence !== null && concurrence !== undefined;
    const hasAbs  = absorption !== null && absorption !== undefined;

    const prixSub = hasPrix ? clamp(40 * (1 - 2 * (ass.salePriceEurM2Hab / (marketPriceRef as number) - 1)), 0, 40) : 20; // ≤marché→40, +50%→0
    const txSub   = hasTx   ? clamp(((nbTx as number) / 50) * 20, 0, 20) : 10;                                            // 50 tx → 20
    const concSub = hasConc ? clamp(20 - (concurrence as number) * 2, 0, 20) : 10;                                        // 0 concurrent → 20
    const absSub  = hasAbs  ? clamp((absorption as number) * 4, 0, 20) : 10;                                              // 5 logts/mois → 20
    const scoreMarche = Math.round(clamp(prixSub + txSub + concSub + absSub, 0, 100));
    const marketInsufficient = !hasPrix && !hasTx && !hasConc && !hasAbs;
    const marketParts = { prix: Math.round(prixSub), transactions: Math.round(txSub), concurrence: Math.round(concSub), absorption: Math.round(absSub) };

    // ── scoreRisque /100 : risquesFromSnap si dispo ; neutre 50 sinon. ──
    let scoreRisque: number; let riskInsufficient = false;
    const cats = (risquesFromSnap?.categories ?? []) as Array<{ level?: string }>;
    const globalRisk = risquesFromSnap?.scores?.global;
    if (Array.isArray(cats) && cats.length > 0) {
      const flagged = cats.filter((c) => c.level && c.level !== "nul" && c.level !== "inconnu");
      const fort = flagged.filter((c) => c.level === "fort" || c.level === "élevé" || c.level === "tres_fort").length;
      scoreRisque = Math.round(clamp(100 - flagged.length * 12 - fort * 10, 0, 100));
    } else if (typeof globalRisk === "number") {
      scoreRisque = Math.round(clamp(globalRisk, 0, 100));
    } else { scoreRisque = 50; riskInsufficient = true; }

    // ── ÉV.7 — scoreGlobal = rentabilité 50 % · marché 30 % · risque 20 %. ──
    const scoreGlobal = Math.round(clamp(scoreRentabilite * 0.5 + scoreMarche * 0.3 + scoreRisque * 0.2, 0, 100));
    const { label, color } =
      scoreGlobal >= 90 ? { label: "Excellent", color: "#15803d" } :
      scoreGlobal >= 75 ? { label: "Bon",       color: "#16a34a" } :
      scoreGlobal >= 60 ? { label: "Moyen",     color: "#ca8a04" } :
      scoreGlobal >= 40 ? { label: "Fragile",   color: "#ea580c" } :
                          { label: "À éviter",  color: "#dc2626" };

    // ── ÉV.1 — Prix terrain conseillé (marge de sécurité sur le foncier max). ──
    const margeSecuriteFoncierPct = pct(ass.margeSecuriteFoncierPct, 15);
    const foncierConseille = Math.round(foncierMaxExact * (1 - margeSecuriteFoncierPct / 100));

    // ── ÉV.3 (polish) — Prix cible d'acquisition. ──
    const prixVendeurActuel    = foncierActuel;                 // 0 si non renseigné
    const prixTerrainConseille = foncierConseille;
    const prixTerrainMax       = foncierMaxExact;
    const negociationCible     = prixVendeurActuel > 0 ? prixVendeurActuel - prixTerrainConseille : 0;
    const negociationComment   = prixVendeurActuel <= 0
      ? "Prix vendeur non renseigné"
      : negociationCible > 0
        ? `Négociation cible : -${eur(negociationCible)}`
        : "Prix vendeur inférieur au prix conseillé";

    // ── ÉV.1 (polish) — SmartScore Urbanisme renforcé /25. ──
    //  Zone 10 + Hauteur 5 + Densité 5 + Contraintes/OAP 5. Optional chaining, neutre si absent.
    const plu = study?.plu ?? null;
    const zone = (plu?.zone_plu ?? "").toString().toUpperCase();
    const hauteurMaxPlu = n(plu?.hauteur_max, 0);
    const cosPlu = n(plu?.cos, 0);
    const hasPlu = !!(zone || hauteurMaxPlu > 0 || cosPlu > 0);

    // Zone PLU (10)
    const zoneSub = zone
      ? (zone.startsWith("U") ? 10 : zone.startsWith("AU") ? 7 : (zone.startsWith("N") || zone.startsWith("A")) ? 2 : 5)
      : 5; // inconnue → 5
    // Hauteur (5) : projet vs hauteur max PLU
    let hauteurSub: number;
    if (hauteurMaxPlu > 0 && totalHeightM > 0) {
      const ratioH = totalHeightM / hauteurMaxPlu;
      hauteurSub = ratioH <= 1 ? 5 : ratioH <= 1.1 ? 2 : 0;
    } else hauteurSub = 2.5; // hauteur inconnue
    // Densité / constructibilité (5) : cohérence CES/COS/SDP
    let densiteSub: number;
    const cesMass = (massing?.ratios?.cesEmprise ?? null);
    if (cosPlu > 0) {
      densiteSub = clamp((cosPlu / 2) * 5, 0, 5);           // COS ~2 → plein pot
    } else if (cesMass != null) {
      densiteSub = clamp(cesMass * 8, 0, 5);                // CES ~0.6 → ~4.8
    } else if (sdpEstimatedM2 > 0) {
      densiteSub = 3.5;                                      // SDP exploitable sans réf. PLU
    } else densiteSub = 2.5;                                 // données absentes
    // Contraintes / OAP (5)
    const oapFlag = !!((plu as any)?.oap || (plu as any)?.oap_detectee || (plu as any)?.servitudes_fortes);
    const riskFlagged = Array.isArray(risquesFromSnap?.categories)
      ? (risquesFromSnap.categories as Array<{ level?: string }>).filter((c) => c.level && c.level !== "nul" && c.level !== "inconnu").length
      : null;
    let contraintesSub: number;
    if (oapFlag || (riskFlagged != null && riskFlagged >= 3)) contraintesSub = 2;      // contraintes fortes
    else if (riskFlagged != null && riskFlagged >= 1) contraintesSub = 3.5;            // contraintes moyennes
    else if (riskFlagged === 0 || hasPlu) contraintesSub = 5;                          // aucune contrainte connue
    else contraintesSub = 2.5;                                                          // données absentes
    const smartScoreUrbanisme   = Math.round(clamp(zoneSub + hauteurSub + densiteSub + contraintesSub, 0, 25));

    const smartScoreMarche      = Math.round(clamp(scoreMarche * 0.25, 0, 25));
    const smartScoreRentabilite = Math.round(clamp(scoreRentabilite * 0.25, 0, 25));
    const smartScoreRisques     = Math.round(clamp(scoreRisque * 0.25, 0, 25));
    const smartScorePromoteur   = Math.round(clamp(smartScoreUrbanisme + smartScoreMarche + smartScoreRentabilite + smartScoreRisques, 0, 100));
    const { label: smartLabel, color: smartColor } =
      smartScorePromoteur >= 90 ? { label: "Excellent", color: "#15803d" } :
      smartScorePromoteur >= 75 ? { label: "Très bon",  color: "#16a34a" } :
      smartScorePromoteur >= 60 ? { label: "Bon",       color: "#ca8a04" } :
      smartScorePromoteur >= 40 ? { label: "Moyen",     color: "#ea580c" } :
                                  { label: "Faible",    color: "#dc2626" };

    // ── ÉV.2 — Decision Score /100 (pondéré) + garde-fous. ──
    const mPct = margeReellePct, tri = triPromoteurPct;
    const decisionScore = Math.round(clamp(
      scoreRentabilite * 0.40 + scoreMarche * 0.20 + (smartScoreUrbanisme * 4) * 0.20 + scoreRisque * 0.20,
      0, 100,
    ));
    const foncierDepasse = foncierActuel > 0 && foncierActuel > foncierMaxExact;
    const foncierOk      = foncierActuel <= 0 || foncierActuel <= foncierMaxExact;

    let decisionPromoteur: "GO" | "GO_CONDITIONS" | "NO_GO";
    const noGoForce = mPct < 5 || tri < 5 || scoreRisque < 25;
    const condForce = (mPct >= 5 && mPct < 8) || (tri >= 5 && tri < 8) || foncierDepasse;
    const goEligible = mPct >= 8 && tri >= 8 && foncierOk;
    if (noGoForce) decisionPromoteur = "NO_GO";
    else if (condForce) decisionPromoteur = "GO_CONDITIONS";
    else if (decisionScore >= 70 && goEligible) decisionPromoteur = "GO";
    else if (decisionScore >= 40) decisionPromoteur = "GO_CONDITIONS";
    else decisionPromoteur = "NO_GO";
    const decisionLabel = decisionPromoteur === "GO" ? "GO" : decisionPromoteur === "GO_CONDITIONS" ? "GO SOUS CONDITIONS" : "NO GO";
    const decisionColor = decisionPromoteur === "GO" ? "#16a34a" : decisionPromoteur === "GO_CONDITIONS" ? "#ea580c" : "#dc2626";
    let decisionReason: string;
    if (decisionPromoteur === "NO_GO") {
      const causes: string[] = [];
      if (mPct < 5) causes.push(`marge ${mPct.toFixed(1)}% < 5%`);
      if (tri < 5) causes.push(`TRI ${tri.toFixed(1)}% < 5%`);
      if (scoreRisque < 25) causes.push(`risques ${scoreRisque} < 25`);
      if (decisionScore < 40) causes.push(`decision score ${decisionScore} < 40`);
      decisionReason = causes.length ? `Opération à écarter (${causes.join(" · ")}).` : `Opération à écarter (decision score ${decisionScore}).`;
    } else if (decisionPromoteur === "GO") {
      decisionReason = `Critères réunis : marge ${mPct.toFixed(1)}% ≥ 8%, TRI ${tri.toFixed(1)}% ≥ 8%, foncier dans l'enveloppe, decision score ${decisionScore} ≥ 70.`;
    } else {
      const flags: string[] = [];
      if (mPct >= 5 && mPct < 8) flags.push(`marge ${mPct.toFixed(1)}%`);
      if (tri >= 5 && tri < 8) flags.push(`TRI ${tri.toFixed(1)}%`);
      if (foncierDepasse) flags.push("foncier > max admissible");
      decisionReason = `Viable sous conditions (decision score ${decisionScore})${flags.length ? ` — points de vigilance : ${flags.join(" · ")}` : " — renforcer le poste le plus faible avant engagement"}.`;
    }

    // ── ÉV.4 — Rang du projet. ──
    const { rank: projectRank, color: projectRankColor } =
      smartScorePromoteur >= 90 && decisionScore >= 85 ? { rank: "A+", color: "#15803d" } :
      smartScorePromoteur >= 80 && decisionScore >= 75 ? { rank: "A",  color: "#16a34a" } :
      smartScorePromoteur >= 70 && decisionScore >= 65 ? { rank: "B",  color: "#ea580c" } :
      smartScorePromoteur >= 55 && decisionScore >= 50 ? { rank: "C",  color: "#c2410c" } :
                                                          { rank: "D",  color: "#dc2626" };

    return {
      targetMarginPct: tPct, margeCibleEur,
      foncierActuel, foncierMax, foncierMaxExact, foncierEcart,
      margeSecuriteFoncierPct, foncierConseille,
      prixVendeurActuel, prixTerrainConseille, prixTerrainMax, negociationCible, negociationComment,
      chargeFonciereActuelleEurM2Sdp, chargeFonciereMaxEurM2Sdp,
      chargeFonciereMarcheEurM2Sdp, chargeMarchePositionPct, chargeMarcheComment,
      margeReellePct, margeCiblePct, margeEcartPts, margeColor,
      dureeOperationMois, dureeLabel, dureeColor,
      triPromoteurPct, triLabel, triColor, fondsPropres,
      scoreGlobal, scoreRentabilite, scoreMarche, scoreRisque,
      marketInsufficient, riskInsufficient, marketParts,
      decisionScore, decisionPromoteur, decisionLabel, decisionColor, decisionReason,
      projectRank, projectRankColor,
      smartScorePromoteur, smartScoreUrbanisme, smartScoreMarche, smartScoreRentabilite, smartScoreRisques,
      smartLabel, smartColor, hasPlu,
      label, color,
    };
  }, [computed.caTotal, computed.coutTotal, computed.marge, computed.margePct, computed.parkingCost, ass, sdpEstimatedM2, surfaceVendableM2, totalHeightM, massing, regionInfo, levelsCount, sensitivity, study?.marche, study?.plu, marcheFromLS, risquesFromSnap]);

  // ── rawInput synthèse ─────────────────────────────────────────────────────
  const synthesisRawInput = useMemo((): PromoteurRawInput => {
    const fsnap = getSnapshot()?.foncier as { communeInsee?: string; surfaceM2?: number; } | null ?? null;
    const sessionInsee  = (() => { try { return localStorage.getItem("mimmoza.session.commune_insee") ?? undefined; } catch { return undefined; } })();
    const sessionSurfM2 = (() => { try { const v = localStorage.getItem("mimmoza.session.surface_m2"); return v ? Number(v) : undefined; } catch { return undefined; } })();
    const inseeCode = study?.foncier?.commune_insee ?? fsnap?.communeInsee ?? sessionInsee ?? undefined;
    const dept = inseeCode ? inseeCode.slice(0, 2) : undefined;
    const surfTerrain = study?.foncier?.surface_m2 ?? fsnap?.surfaceM2 ?? sessionSurfM2 ?? undefined;
    const communeLabel = communeNom ?? (study?.foncier as any)?.commune ?? inseeCode ?? undefined;
    const cpLabel = codePostal ?? (study?.foncier as any)?.code_postal ?? undefined;
    const prixFoncierBrut = n(ass.landPriceEur, 0);
    const dvfLS = marcheFromLS?.dvf ?? null; const pricesLS = marcheFromLS?.prices ?? null; const transactionsLS = marcheFromLS?.transactions ?? null;
    const riskCategories = risquesFromSnap?.categories ?? []; const riskData = risquesFromSnap?.data ?? null; const riskMeta = risquesFromSnap?.meta ?? null; const riskScoreGlobal = risquesFromSnap?.scores?.global ?? null;
    const risquesIdentifies: string[] = riskCategories.filter((c: any) => c.level !== 'nul' && c.level !== 'inconnu').map((c: any) => `${c.name} (${c.level})`);
    const zonageRisque = study?.risques?.zonage_risque ?? (riskData?.inondation?.zone_inondable ? `Zone inondable — ${riskData.inondation.type_zone || 'type inconnu'}` : undefined) ?? (riskData?.seisme?.zone != null ? `Zone sismique ${riskData.seisme.zone}` : undefined) ?? (riskMeta?.commune_nom ? `${riskMeta.commune_nom} — risques analysés` : undefined) ?? undefined;
    return {
      foncier: { adresse: (study?.foncier as any)?.adresse_complete ?? undefined, commune: communeLabel, codePostal: cpLabel, departement: (study?.foncier as any)?.departement ?? dept ?? undefined, surfaceTerrain: surfTerrain ?? undefined, prixAcquisition: prixFoncierBrut > 0 ? prixFoncierBrut : undefined, fraisNotaire: computed.fraisNotaire > 0 ? computed.fraisNotaire : undefined, pollutionDetectee: (riskData?.sis?.count ?? 0) > 0 },
      plu: { zone: study?.plu?.zone_plu ?? undefined, cub: study?.plu?.cos ?? undefined, hauteurMax: study?.plu?.hauteur_max ?? undefined, pleineTerre: study?.plu?.pleine_terre_pct ?? undefined },
      conception: { surfacePlancher: sdpEstimatedM2 > 0 ? sdpEstimatedM2 : undefined, nbLogements: nbLogementsEffectif > 0 ? nbLogementsEffectif : undefined, nbNiveaux: levelsCount > 0 ? levelsCount : undefined, hauteurProjet: totalHeightM > 0 ? totalHeightM : undefined, empriseBatie: footprintBuildingsM2 > 0 ? footprintBuildingsM2 : undefined, programmeType: ass.rehabMode ? "Réhabilitation" : buildingKind === "COLLECTIF" ? "Résidentiel collectif libre" : "Résidentiel individuel" },
      marche: { prixNeufM2: study?.marche?.prix_m2_neuf ?? (pricesLS?.median_eur_m2 > 0 ? pricesLS.median_eur_m2 : undefined) ?? (ass.salePriceEurM2Hab > 0 ? ass.salePriceEurM2Hab : undefined), prixAncienM2: study?.marche?.prix_m2_ancien ?? (dvfLS?.prix_m2_median > 0 ? dvfLS.prix_m2_median : undefined) ?? undefined, nbTransactionsDvf: study?.marche?.nb_transactions ?? (dvfLS?.nb_transactions > 0 ? dvfLS.nb_transactions : undefined) ?? (transactionsLS?.count > 0 ? transactionsLS.count : undefined) ?? undefined, prixMoyenDvf: study?.marche?.prix_moyen_dvf ?? (dvfLS?.prix_m2_moyen > 0 ? dvfLS.prix_m2_moyen : undefined) ?? (pricesLS?.mean_eur_m2 > 0 ? pricesLS.mean_eur_m2 : undefined) ?? undefined, offreConcurrente: study?.marche?.nb_programmes_concurrents ?? undefined, absorptionMensuelle: study?.marche?.absorption_mensuelle ?? undefined },
      risques: { risquesIdentifies, zonageRisque, scoreGlobal: riskScoreGlobal ?? undefined, nbCatnat: riskData?.gaspar?.catnat_count ?? undefined, nbSeveso: riskData?.icpe ? (riskData.icpe.seveso_haut_count ?? 0) + (riskData.icpe.seveso_bas_count ?? 0) : undefined, pprCount: riskData?.gaspar?.ppr_count ?? undefined, classeRadon: riskData?.radon?.classe_potentiel ?? undefined } as any,
      evaluation: { prixVenteM2: ass.salePriceEurM2Hab > 0 ? ass.salePriceEurM2Hab : undefined, prixVenteTotal: computed.caTotal > 0 ? computed.caTotal : undefined, nbLogementsLibres: nbLogementsEffectif > 0 ? nbLogementsEffectif : undefined },
      bilan: { coutFoncier: prixFoncierBrut > 0 ? prixFoncierBrut : undefined, coutTravaux: computed.totalTravaux > 0 ? computed.totalTravaux : undefined, coutTravauxM2: ass.rehabMode ? undefined : (ass.worksCostEurM2Sdp > 0 ? ass.worksCostEurM2Sdp : undefined), fraisFinanciers: computed.totalFin > 0 ? computed.totalFin : undefined, fraisCommercialisation: computed.totalCom > 0 ? computed.totalCom : undefined, fraisGestion: computed.totalEtudes > 0 ? computed.totalEtudes : undefined, chiffreAffaires: computed.caTotal > 0 ? computed.caTotal : undefined, margeNette: computed.marge, margeNettePercent: computed.margePct, trnRendement: computed.caTotal > 0 && computed.coutTotal > 0 ? (computed.marge / computed.coutTotal) * 100 : undefined, fondsPropres: undefined, creditPromoteur: undefined },
    };
  }, [study, ass, computed, sdpEstimatedM2, nbLogementsEffectif, levelsCount, totalHeightM, footprintBuildingsM2, buildingKind, communeNom, codePostal, marcheFromLS, risquesFromSnap]);

  useEffect(() => {
    if (!(computed.caTotal > 0)) return;
    try { localStorage.setItem(SYNTHESE_RAW_KEY, JSON.stringify(synthesisRawInput)); } catch (e) { console.warn("[Bilan→Synthese] failed:", e); }
  }, [synthesisRawInput, computed.caTotal]);

  useEffect(() => {
    try {
      const ok = surfaceVendableM2 > 0 && computed.caTotal > 0;
      patchModule("bilan", {
        ok, marge_pct: computed.margePct, ca: computed.caTotal,
        summary: `Marge ${computed.margePct.toFixed(1)}% · CA ${Math.round(computed.caTotal).toLocaleString("fr-FR")}€ · TRI ${feasibility.triPromoteurPct.toFixed(1)}% · Score ${feasibility.scoreGlobal}/100`,
        data: {
          assumptions: ass,
          kpis: { caTotal: computed.caTotal, coutTotal: computed.coutTotal, marge: computed.marge, margePct: computed.margePct },
          surfaces: { footprintBuildingsM2, footprintParkingsM2, sdpEstimatedM2, habitableEstimatedM2, surfaceVendableM2 },
          params: { buildingKind, floorsSpec, nbLogements: nbLogementsEffectif, levelsCount, totalHeightM },
          massingMetrics: massing ?? undefined,
          rehabMode: ass.rehabMode, travauxRehabTotal: ass.travauxRehabTotal, surfaceRehabM2: ass.surfaceRehabM2,
          lines: computed.lines, notes: computed.notes, sensitivity,
          // ── Faisabilité foncière (ÉV.9) ──
          targetMarginPct: feasibility.targetMarginPct,
          foncierMax: feasibility.foncierMax,
          foncierMaxExact: feasibility.foncierMaxExact,
          foncierEcart: feasibility.foncierEcart,
          chargeFonciereActuelleEurM2Sdp: feasibility.chargeFonciereActuelleEurM2Sdp,
          chargeFonciereMaxEurM2Sdp: feasibility.chargeFonciereMaxEurM2Sdp,
          chargeFonciereMarcheEurM2Sdp: feasibility.chargeFonciereMarcheEurM2Sdp,
          triPromoteurPct: feasibility.triPromoteurPct,
          dureeOperationMois: feasibility.dureeOperationMois,
          scoreGlobal: feasibility.scoreGlobal,
          scoreRentabilite: feasibility.scoreRentabilite,
          scoreMarche: feasibility.scoreMarche,
          scoreRisque: feasibility.scoreRisque,
          foncierConseille: feasibility.foncierConseille,
          decisionPromoteur: feasibility.decisionPromoteur,
          decisionColor: feasibility.decisionColor,
          decisionScore: feasibility.decisionScore,
          projectRank: feasibility.projectRank,
          prixVendeurActuel: feasibility.prixVendeurActuel,
          prixTerrainConseille: feasibility.prixTerrainConseille,
          prixTerrainMax: feasibility.prixTerrainMax,
          negociationCible: feasibility.negociationCible,
          smartScorePromoteur: feasibility.smartScorePromoteur,
          smartScoreUrbanisme: feasibility.smartScoreUrbanisme,
          smartScoreMarche: feasibility.smartScoreMarche,
          smartScoreRentabilite: feasibility.smartScoreRentabilite,
          smartScoreRisques: feasibility.smartScoreRisques,
          ascenseursCost: computed.ascenseursCost,
          sousSolCost: computed.sousSolCost,
          regionFactor: regionInfo.factor,
          feasibility,
        },
      });
      if (studyId && surfaceVendableM2 > 0 && computed.caTotal > 0) {
        patchBilan({ prix_revient_total: computed.coutTotal, ca_previsionnel: computed.caTotal, marge_nette: computed.marge, taux_marge_nette_pct: computed.margePct, fonds_propres: Math.round(feasibility.fondsPropres) || null, credit_promotion: null, taux_credit_pct: ass.financingRatePct, duree_mois: feasibility.dureeOperationMois || null, roi_pct: null, tri_pct: Number.isFinite(feasibility.triPromoteurPct) ? Number(feasibility.triPromoteurPct.toFixed(1)) : null, ai_narrative: null, ai_generated_at: null, notes: computed.notes.join(" | ") || null, done: true }).catch((e) => console.warn("[BilanPromoteurPage] patchBilan failed:", e));
      }
    } catch (err) { console.warn("[BilanPromoteurPage] Erreur persistance:", err); }
  }, [computed, ass, surfaceVendableM2, footprintBuildingsM2, footprintParkingsM2, sdpEstimatedM2, habitableEstimatedM2, buildingKind, floorsSpec, nbLogementsEffectif, levelsCount, totalHeightM, sensitivity, feasibility, regionInfo, studyId, patchBilan, terrassementHint, massing]);

  // ── UI ────────────────────────────────────────────────────────────────────
  const grouped = useMemo(() => { const map = new Map<string, Line[]>(); for (const l of computed.lines) { if (!map.has(l.section)) map.set(l.section, []); map.get(l.section)!.push(l); } return map; }, [computed.lines]);
  const handleSaveForSynthesis = () => { patchModule("bilan", { ok: true, validated: true }); setSynthesisSaved(true); setTimeout(() => setSynthesisSaved(false), 3000); };
  const scrollToStressTest = () => document.getElementById("stress-test")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const updateAss = <K extends keyof Assumptions>(key: K, value: Assumptions[K]) => setAss((s) => ({ ...s, [key]: value }));

  // Bascule auto ↔ personnalisé pour le chiffrage construction.
  const enableAutoCosts  = () => setAss((s) => ({ ...s, autoCosts: true }));
  const enableManualCosts = () => setAss((s) => ({ ...s, autoCosts: false }));

  const massingLocked = !!massing && !ass.rehabMode;
  const missingRehab = ass.rehabMode && ass.surfaceRehabM2 <= 0;
  const isEmpty      = sdpEstimatedM2 <= 0;
  const foncierVide  = !n(ass.landPriceEur, 0);
  const margeColor   = computed.marge >= 0 ? "#16a34a" : "#dc2626";
  const margePctColor = computed.margePct >= 15 ? "#16a34a" : computed.margePct >= 8 ? "#ea580c" : "#dc2626";
  const hasStoreData  = (buildings?.features?.length ?? 0) > 0 || (snap2d?.buildings?.length ?? 0) > 0;

  const kpiCard: React.CSSProperties      = { background: "white", borderRadius: 14, padding: "14px 16px 16px", border: "1px solid #e8edf4", boxShadow: "0 2px 8px rgba(15,23,42,0.05)", borderTop: `3px solid ${ACCENT_PRO}`, display: "flex", flexDirection: "column" as const, gap: 2 };
  const kpiLabel: React.CSSProperties     = { fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 4 };
  const kpiSub: React.CSSProperties       = { fontSize: 11, color: "#94a3b8", marginTop: 4, lineHeight: 1.4 };
  const card: React.CSSProperties         = { background: "white", borderRadius: 16, padding: 16, border: "1px solid #e8edf4", boxShadow: "0 2px 8px rgba(15,23,42,0.05)" };
  const labelStyle: React.CSSProperties   = { fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 6 };
  const inputStyle: React.CSSProperties   = { width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #cbd5e1", background: "white", color: "#0f172a", fontSize: 13, boxSizing: "border-box" as const };
  const inputLocked: React.CSSProperties  = { ...inputStyle, background: "#f1f5f9", color: "#64748b" };
  const sectionTitle: React.CSSProperties = { fontSize: 11, fontWeight: 900, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" as const };

  const lecturePromoteur = useMemo(() => {
    const ins: string[] = [];
    if (massingLocked) ins.push(`🏗 Métré Massing 3D connecté — SDP ${m2(massing!.totaux.sdpM2)} · ${nbLogementsEffectif} logement(s)`);
    if (massingLocked && ass.autoCosts && derivedCosts) ins.push(`⚙️ Prix construction auto — ${derivedCosts.basis}`);
    if (ass.rehabMode) ins.push(`🔧 Mode Réhabilitation — Travaux = ${eur(ass.travauxRehabTotal)} · Surface = ${m2(ass.surfaceRehabM2)}`);
    if (computed.margePct >= 20) ins.push("✅ Marge confortable (≥ 20%)");
    else if (computed.margePct >= 12) ins.push("⚠️ Marge moyenne (12-20%)");
    else if (computed.margePct > 0) ins.push("🔴 Marge faible (< 12%) — risque élevé");
    else ins.push("🔴 Marge négative — opération non viable en l'état");
    if (missingRehab) ins.push("⚠️ Surface réhabilitée non renseignée → CA = 0");
    if (foncierVide) ins.push("📋 Foncier non renseigné : bilan incomplet");
    if (ass.terrassementEur > 0) ins.push(`🏗 Terrassement : ${eur(ass.terrassementEur)} HT intégré`);

    // Marge vs cible
    if (feasibility.margeEcartPts >= 0)
      ins.push(`✅ La marge (${feasibility.margeReellePct.toFixed(1)}%) dépasse l'objectif promoteur de ${feasibility.margeCiblePct.toFixed(0)}% (+${feasibility.margeEcartPts.toFixed(1)} pts).`);
    else
      ins.push(`⚠️ La marge (${feasibility.margeReellePct.toFixed(1)}%) est sous l'objectif de ${feasibility.margeCiblePct.toFixed(0)}% (${feasibility.margeEcartPts.toFixed(1)} pts).`);

    // Foncier max exact
    if (feasibility.foncierActuel > 0) {
      if (feasibility.foncierEcart >= 0)
        ins.push(`💰 Le foncier est inférieur de ${eur(feasibility.foncierEcart)} au maximum admissible (${eur(feasibility.foncierMaxExact)}) — calcul exact par résolution itérative.`);
      else
        ins.push(`🔴 Terrain surpayé de ${eur(Math.abs(feasibility.foncierEcart))} vs le maximum admissible (${eur(feasibility.foncierMaxExact)}) — calcul exact par résolution itérative.`);
    } else if (feasibility.foncierMaxExact > 0) {
      ins.push(`💡 Foncier max admissible pour ${feasibility.margeCiblePct.toFixed(0)}% de marge : ${eur(feasibility.foncierMaxExact)} — calcul exact par résolution itérative.`);
    }

    // Charge foncière vs marché
    if (feasibility.chargeFonciereMarcheEurM2Sdp != null && feasibility.chargeMarcheComment) {
      const pos = feasibility.chargeMarchePositionPct ?? 0;
      ins.push(`📐 Charge foncière ${Math.round(feasibility.chargeFonciereActuelleEurM2Sdp)} €/m² SDP vs marché ${Math.round(feasibility.chargeFonciereMarcheEurM2Sdp)} €/m² SDP (${pos >= 0 ? "+" : ""}${pos.toFixed(0)} %) — ${feasibility.chargeMarcheComment}.`);
    } else {
      ins.push(`📐 Charge foncière actuelle : ${Math.round(feasibility.chargeFonciereActuelleEurM2Sdp)} €/m² SDP vs max ${Math.round(feasibility.chargeFonciereMaxEurM2Sdp)} €/m² SDP.`);
    }

    // Durée opération
    ins.push(`📅 La durée prévisionnelle est de ${feasibility.dureeOperationMois} mois (${feasibility.dureeLabel}).`);

    // TRI
    ins.push(`💹 Le TRI promoteur estimé est de ${feasibility.triPromoteurPct.toFixed(1)} % (${feasibility.triLabel}).`);

    // Coefficient régional
    if (regionInfo.factor !== 1)
      ins.push(`🗺 Coefficient régional ×${regionInfo.factor.toFixed(2)} (${regionInfo.label}) appliqué aux coûts de construction principaux.`);

    // Ascenseurs / sous-sol
    if (computed.ascenseursCost > 0) ins.push(`🛗 Ascenseurs : ${eur(computed.ascenseursCost)} HT (coeff hauteur ×${ascenseurHeightCoef(levelsCount)}).`);
    if (computed.sousSolCost > 0)    ins.push(`🅿 Sous-sol : ${eur(computed.sousSolCost)} HT (${n(ass.nbSousSols, 0)} niveau(x) × ${m2(n(ass.surfaceSousSolM2, 0))}).`);

    // Résilience stress test
    if (sensitivity.scenarioA.marge >= 0)
      ins.push(`🛡 Le projet reste rentable avec +5% de coûts travaux (marge ${eur(sensitivity.scenarioA.marge)}).`);
    else
      ins.push(`⚠️ Une hausse de 5% des coûts travaux rend l'opération déficitaire.`);

    // Score global + détail
    ins.push(`🎯 Score faisabilité : ${feasibility.scoreGlobal}/100 — ${feasibility.label} (rentabilité ${feasibility.scoreRentabilite} · marché ${feasibility.scoreMarche}${feasibility.marketInsufficient ? " ⚠ données insuffisantes" : ""} · risques ${feasibility.scoreRisque}${feasibility.riskInsufficient ? " ⚠ données insuffisantes" : ""} · TRI ${feasibility.triPromoteurPct.toFixed(1)} %).`);

    // ── ÉV.5 — Décision Promoteur premium ──
    ins.push(`🤝 Prix vendeur : ${feasibility.prixVendeurActuel > 0 ? eur(feasibility.prixVendeurActuel) : "non renseigné"}.`);
    ins.push(`🤝 Prix conseillé : ${eur(feasibility.prixTerrainConseille)} (marge de sécurité ${feasibility.margeSecuriteFoncierPct.toFixed(0)} %).`);
    ins.push(`🤝 Prix maximum admissible : ${eur(feasibility.prixTerrainMax)}.`);
    if (feasibility.prixVendeurActuel > 0) {
      ins.push(feasibility.negociationCible > 0
        ? `🧮 Négociation cible : -${eur(feasibility.negociationCible)}.`
        : `🧮 Prix vendeur inférieur au prix conseillé — pas de négociation requise.`);
    }
    ins.push(`⭐ Le projet obtient un SmartScore Promoteur de ${feasibility.smartScorePromoteur}/100 — ${feasibility.smartLabel} (urbanisme ${feasibility.smartScoreUrbanisme}/25${feasibility.hasPlu ? "" : " ⚠"} · marché ${feasibility.smartScoreMarche}/25 · rentabilité ${feasibility.smartScoreRentabilite}/25 · risques ${feasibility.smartScoreRisques}/25).`);
    ins.push(`📈 Decision Score : ${feasibility.decisionScore}/100.`);
    ins.push(`🏅 Rang projet : ${feasibility.projectRank}.`);
    ins.push(`🚦 Décision finale : ${feasibility.decisionLabel}. ${feasibility.decisionReason}`);

    return ins;
  }, [computed, ass, missingRehab, foncierVide, massingLocked, massing, nbLogementsEffectif, derivedCosts, feasibility, sensitivity, regionInfo, levelsCount]);

  const handleExportExcel = async () => {
    try {
      const ExcelJS = await import("exceljs");
      const now = new Date(); const pad = (x: number) => x.toString().padStart(2, "0");
      const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const communeName = (study?.foncier as any)?.commune ?? study?.foncier?.commune_insee ?? "Projet";
      const fmtE = (v: number) => (Number.isFinite(v) ? Math.round(v) : 0); const TVA = 0.20;
      const wb = new ExcelJS.Workbook(); wb.creator = "Mimmoza";
      const ws = wb.addWorksheet("Bilan"); ws.columns = [{ width: 2 }, { width: 42 }, { width: 14 }, { width: 10 }, { width: 12 }, { width: 18 }, { width: 14 }, { width: 18 }, { width: 34 }];
      type ExcelFill = ExcelJS.Fill;
      const solidFill = (hex: string): ExcelFill => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + hex } });
      const FMT_EUR = '# ##0 "€";(# ##0 "€");"-"';
      const sC = (cell: ExcelJS.Cell, opts: { bold?: boolean; color?: string; bg?: string; size?: number; italic?: boolean; align?: "left"|"center"|"right"; numFmt?: string }) => { cell.font = { name: "Arial", size: opts.size ?? 9, bold: opts.bold ?? false, italic: opts.italic ?? false, color: { argb: "FF" + (opts.color ?? "000000") } }; if (opts.bg) cell.fill = solidFill(opts.bg); cell.alignment = { vertical: "middle", horizontal: opts.align ?? "left" }; if (opts.numFmt) cell.numFmt = opts.numFmt; };
      const r1 = ws.addRow(["", `BILAN PROMOTEUR — ${ass.rehabMode ? "RÉHABILITATION" : "PROGRAMME NEUF"}`]); r1.height = 30; ws.mergeCells("B1:I1"); sC(r1.getCell("B"), { bold: true, color: "FFFFFF", bg: "2D2D6B", size: 14, align: "center" }); for (const col of ["C","D","E","F","G","H","I"]) r1.getCell(col).fill = solidFill("2D2D6B");
      const r2 = ws.addRow(["", `${communeName}   |   ${new Date().toLocaleDateString("fr-FR")}   |   Mimmoza`]); r2.height = 16; ws.mergeCells("B2:I2"); sC(r2.getCell("B"), { italic: true, color: "94A3B8", bg: "F4F3FF", align: "center", size: 9 }); for (const col of ["C","D","E","F","G","H","I"]) r2.getCell(col).fill = solidFill("F4F3FF");
      ws.addRow([]); const rh = ws.addRow(["", "POSTE", "", "", "", "Montant HT (€)", "TVA (€)", "Montant TTC (€)", "Notes"]); rh.height = 18;
      for (const [col, al] of [["B","left"],["C","center"],["F","right"],["G","right"],["H","right"],["I","left"]] as [string,"left"|"center"|"right"][]) sC(rh.getCell(col), { bold: true, color: "FFFFFF", bg: "5247B8", align: al });
      let li = 0;
      for (const [section, lines] of Array.from(grouped.entries())) {
        ws.addRow([]); const rs = ws.addRow(["", section]); rs.height = 18; ws.mergeCells(`B${rs.number}:I${rs.number}`); sC(rs.getCell("B"), { bold: true, color: "FFFFFF", bg: "5247B8", size: 10 }); for (const col of ["C","D","E","F","G","H","I"]) rs.getCell(col).fill = solidFill("5247B8");
        for (const l of lines) {
          const bg = l.kind === "total" ? "1E293B" : l.kind === "subtotal" ? "E8E4F7" : li % 2 === 0 ? "F8F7FE" : "FFFFFF"; li++;
          const r = ws.addRow(["", l.label, "", "", l.hint ?? "", fmtE(l.valueEur), 0, fmtE(l.valueEur), ""]); r.height = l.kind ? 18 : 15;
          for (const col of ["B","F","H"]) { const c = r.getCell(col); sC(c, { bold: !!l.kind, color: l.kind === "total" ? "FFFFFF" : l.kind === "subtotal" ? "5247B8" : "000000", bg, align: ["F","H"].includes(col) ? "right" : "left" }); if (["F","H"].includes(col) && typeof c.value === "number") c.numFmt = FMT_EUR; }
        }
      }
      const buffer = await wb.xlsx.writeBuffer(); const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `bilan-${communeName}-${dateStr}.xlsx`; a.click(); URL.revokeObjectURL(url);
    } catch (error) { console.error("Export Excel error:", error); window.alert("Export Excel impossible : " + String(error)); }
  };

  return (
    <div style={{ color: "#0f172a", fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div>

        {/* Bannière */}
        <div style={{ marginBottom: 16 }}>
  <PromoteurPageHero
    badge="Promoteur · Bilan"
    title={`Bilan Promoteur${ass.rehabMode && ass.travauxRehabTotal > 0 ? " — Réhabilitation" : hasConceptionData ? " — Programme neuf" : ""}`}
    metaLines={[
      { text: "Pro forma détaillé — basé sur l'implantation 2D et des hypothèses ajustables." },
      ...(study?.foncier?.commune_insee ? [{ text: `INSEE ${study.foncier.commune_insee}` }] : []),
    ]}
    statCards={computed.caTotal > 0 ? [
      { label: "Marge brute", value: `${computed.margePct.toFixed(1)} %`, tone: "indigo" as const },
      { label: "CA total", value: `${Math.round(computed.caTotal / 1000)} k€`, tone: "emerald" as const },
    ] : undefined}
    actions={
      <>
        {([["bilan", "📊 Bilan pro forma"], ["synthese", "📄 Synthèse & Export"]] as const).map(([tab, tabLabel]) => (
          activeTab === tab
            ? <HeroPrimaryButton key={tab} onClick={() => setActiveTab(tab)}>{tabLabel}</HeroPrimaryButton>
            : <HeroGhostButton key={tab} onClick={() => setActiveTab(tab)}>{tabLabel}</HeroGhostButton>
        ))}
        {activeTab === "bilan" && (
          <HeroPrimaryButton onClick={handleSaveForSynthesis}>
            {synthesisSaved ? "✓ Enregistré" : "📌 Utiliser dans la synthèse"}
          </HeroPrimaryButton>
        )}
        {activeTab === "bilan" && (
          <HeroGhostButton onClick={handleExportExcel}>⬇ Exporter Excel</HeroGhostButton>
        )}
      </>
    }
  />
</div>

        {activeTab === "synthese" ? <PromoteurSynthesePage rawInputOverride={synthesisRawInput} /> : (
          <>
            {realConflict && <ConflictBanner rehabTotal={ass.travauxRehabTotal} onUseNeuf={activateNeufMode} onUseRehab={activateRehabMode} />}
            {!realConflict && ass.rehabMode && ass.travauxRehabTotal > 0 && <RehabBanner rehabTotal={ass.travauxRehabTotal} surfaceM2={ass.surfaceRehabM2} onClear={clearRehabMode} />}

            {missingRehab && !realConflict && (
              <div style={{ marginBottom: 16, padding: "12px 18px", background: "#fef2f2", border: "1px solid #fecaca", borderLeft: "4px solid #dc2626", borderRadius: 12, fontSize: 13, color: "#991b1b" }}>
                📐 <strong>Surface réhabilitée non renseignée</strong> — Le CA est à 0. Saisissez la surface dans le champ "Surface SDP réhabilitée" ci-dessous, ou relancez la simulation depuis <strong>Rénovation → Simulation travaux</strong>.
              </div>
            )}

            {foncierVide && <div style={{ marginBottom: 16, padding: "12px 18px", background: "#fffbeb", border: "1px solid #fde68a", borderLeft: "4px solid #f59e0b", borderRadius: 12, fontSize: 13, color: "#78350f" }}>🏠 <strong>Foncier non renseigné</strong> — saisissez-le dans les Hypothèses.</div>}
            {ass.terrassementEur > 0 && <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(82,71,184,0.06)", border: "1px solid rgba(82,71,184,0.2)", borderLeft: `4px solid ${ACCENT_PRO}`, borderRadius: 12, fontSize: 12, color: ACCENT_PRO, display: "flex", alignItems: "center", gap: 8 }}>🏗 <strong>Terrassement Massing 3D</strong> — {eur(ass.terrassementEur)} HT · {terrassementHint}</div>}
            {marcheFromLS && <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderLeft: "4px solid #10b981", borderRadius: 12, fontSize: 12, color: "#065f46", display: "flex", alignItems: "center", gap: 8 }}>📊 <strong>Données marché</strong> — {marcheFromLS.dvf?.nb_transactions ?? '?'} transactions DVF</div>}

            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 10 }}>
              <div style={kpiCard}><div style={kpiLabel}>CA total</div><div style={{ fontSize: 22, fontWeight: 900, color: isEmpty ? "#94a3b8" : "#0f172a" }}>{eur(computed.caTotal)}</div><div style={kpiSub}>Vendable × Prix × Comm.</div></div>
              <div style={kpiCard}><div style={kpiLabel}>Coût total</div><div style={{ fontSize: 22, fontWeight: 900 }}>{eur(computed.coutTotal)}</div><div style={kpiSub}>{ass.rehabMode ? "Réhab + Foncier + …" : "Foncier + Études + Travaux"}</div></div>
              <div style={kpiCard}><div style={kpiLabel}>Marge brute</div><div style={{ fontSize: 22, fontWeight: 900, color: margeColor }}>{eur(computed.marge)}</div><div style={kpiSub}>{computed.margePct.toFixed(1)}% du CA</div></div>
              <div style={kpiCard}><div style={kpiLabel}>Coût revient</div><div style={{ fontSize: 17, fontWeight: 900, lineHeight: 1.2 }}>{Math.round(computed.coutRevientEurM2Hab)} €/m² vend.</div><div style={kpiSub}>{Math.round(computed.coutRevientEurM2Sdp)} €/m² SDP</div></div>
              <div style={kpiCard}><div style={kpiLabel}>Taux marge</div><div style={{ fontSize: 22, fontWeight: 900, color: margePctColor }}>{computed.margePct.toFixed(1)} %</div><div style={kpiSub}>Marge / CA</div></div>
              <div style={kpiCard}>
                <div style={kpiLabel}>📉 Stress test</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 2 }}>
                  {[sensitivity.scenarioA, sensitivity.scenarioB].map((sc) => (
                    <div key={sc.label} style={{ background: "#f8fafc", borderRadius: 8, padding: "6px 8px" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", marginBottom: 2 }}>{sc.label}</div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: sc.marge >= 0 ? "#166534" : "#991b1b" }}>{eur(sc.marge)}</span>
                        <span style={{ fontSize: 10, color: sc.deltaPct < 0 ? "#dc2626" : "#16a34a", fontWeight: 700 }}>{sc.deltaPct >= 0 ? "+" : ""}{sc.deltaPct.toFixed(1)} pts</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div onClick={scrollToStressTest} style={{ fontSize: 11, color: ACCENT_PRO, marginTop: 6, textDecoration: "underline", cursor: "pointer" }}>Voir le détail ↓</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
              {[{ label: "Prix moyen / logement", value: eur(computed.prixParLogement), color: "#0f172a" }, { label: "Coût / logement", value: eur(computed.coutParLogement), color: "#0f172a" }, { label: "Marge / logement", value: eur(computed.margeParLogement), color: computed.margeParLogement >= 0 ? "#16a34a" : "#dc2626" }].map((k) => (
                <div key={k.label} style={kpiCard}><div style={kpiLabel}>{k.label}</div><div style={{ fontSize: 20, fontWeight: 900, color: k.color }}>{k.value}</div><div style={kpiSub}>÷ {nbLogementsEffectif} logement{nbLogementsEffectif > 1 ? "s" : ""}</div></div>
              ))}
            </div>

            {/* ── Faisabilité foncière — ligne 1 : foncier max · charge foncière · marge cible · score ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
              <div style={{ ...kpiCard, borderTop: `3px solid ${ACCENT_PRO}` }}>
                <div style={kpiLabel}>💰 Foncier max admissible</div>
                <div style={{ fontSize: 19, fontWeight: 900, color: "#0f172a" }}>{eur(feasibility.foncierMaxExact)}</div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  Actuel : <b>{feasibility.foncierActuel > 0 ? eur(feasibility.foncierActuel) : "—"}</b> · calcul exact
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, marginTop: 2, color: feasibility.foncierEcart >= 0 ? "#16a34a" : "#dc2626" }}>
                  {feasibility.foncierActuel > 0
                    ? (feasibility.foncierEcart >= 0 ? `Marge de négociation : +${eur(feasibility.foncierEcart)}` : `Terrain surpayé : ${eur(feasibility.foncierEcart)}`)
                    : `Cible ${feasibility.margeCiblePct.toFixed(0)}%`}
                </div>
              </div>

              <div style={{ ...kpiCard, borderTop: `3px solid ${ACCENT_PRO}` }}>
                <div style={kpiLabel}>📐 Charge foncière</div>
                <div style={{ fontSize: 17, fontWeight: 900, color: "#0f172a", lineHeight: 1.3 }}>{Math.round(feasibility.chargeFonciereActuelleEurM2Sdp)} <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>€/m² SDP</span></div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                  Max : <b>{Math.round(feasibility.chargeFonciereMaxEurM2Sdp)}</b> · Marché : <b>{feasibility.chargeFonciereMarcheEurM2Sdp != null ? Math.round(feasibility.chargeFonciereMarcheEurM2Sdp) : "—"}</b> €/m²
                </div>
                {feasibility.chargeMarchePositionPct != null && (
                  <div style={{ fontSize: 12, fontWeight: 800, marginTop: 3, color: feasibility.chargeMarchePositionPct > 5 ? "#dc2626" : feasibility.chargeMarchePositionPct < -5 ? "#16a34a" : "#ca8a04" }}>
                    {feasibility.chargeMarchePositionPct >= 0 ? "+" : ""}{feasibility.chargeMarchePositionPct.toFixed(0)} % vs marché
                  </div>
                )}
                {feasibility.chargeMarcheComment && <div style={kpiSub}>{feasibility.chargeMarcheComment}</div>}
              </div>

              <div style={{ ...kpiCard, borderTop: `3px solid ${feasibility.margeColor}` }}>
                <div style={kpiLabel}>🎯 Marge réelle / cible</div>
                <div style={{ fontSize: 19, fontWeight: 900, color: feasibility.margeColor }}>
                  {feasibility.margeReellePct.toFixed(1)} %{" "}
                  <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700 }}>/ {feasibility.margeCiblePct.toFixed(0)} %</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, marginTop: 6, color: feasibility.margeColor }}>
                  Écart : {feasibility.margeEcartPts >= 0 ? "+" : ""}{feasibility.margeEcartPts.toFixed(1)} pts
                </div>
                <div style={kpiSub}>{feasibility.margeEcartPts >= 0 ? "Objectif atteint" : "Sous l'objectif"}</div>
              </div>

              <div style={{ ...kpiCard, borderTop: `3px solid ${feasibility.color}` }}>
                <div style={kpiLabel}>📊 Score faisabilité</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <div style={{ fontSize: 26, fontWeight: 900, color: feasibility.color }}>{feasibility.scoreGlobal}</div>
                  <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700 }}>/ 100</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: feasibility.color, marginLeft: "auto" }}>{feasibility.label}</div>
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6, lineHeight: 1.4 }}>
                  Rentab. {feasibility.scoreRentabilite} · Marché {feasibility.scoreMarche}{feasibility.marketInsufficient ? " ⚠" : ""} · Risques {feasibility.scoreRisque}{feasibility.riskInsufficient ? " ⚠" : ""} · TRI {feasibility.triPromoteurPct.toFixed(1)} %
                </div>
                {(feasibility.marketInsufficient || feasibility.riskInsufficient) && (
                  <div style={{ fontSize: 10, color: "#ca8a04", marginTop: 2 }}>⚠ données insuffisantes (score neutre 50)</div>
                )}
              </div>
            </div>

            {/* ── Faisabilité foncière — ligne 2 : durée opération · TRI · détail score marché ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
              <div style={{ ...kpiCard, borderTop: `3px solid ${feasibility.dureeColor}` }}>
                <div style={kpiLabel}>📅 Durée opération</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: feasibility.dureeColor }}>{feasibility.dureeOperationMois} <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700 }}>mois</span> <span style={{ fontSize: 13, fontWeight: 800, color: feasibility.dureeColor }}>· {feasibility.dureeLabel}</span></div>
                <div style={kpiSub}>max(acquisition + permis + purge + travaux ; commercialisation)</div>
              </div>

              <div style={{ ...kpiCard, borderTop: `3px solid ${feasibility.triColor}` }}>
                <div style={kpiLabel}>💹 TRI Promoteur</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: feasibility.triColor }}>{feasibility.triPromoteurPct.toFixed(1)} % <span style={{ fontSize: 13, fontWeight: 800, color: feasibility.triColor }}>· {feasibility.triLabel}</span></div>
                <div style={kpiSub}>Fonds propres estimés {eur(feasibility.fondsPropres)} (30 % du coût) · {(feasibility.dureeOperationMois / 12).toFixed(1)} an(s)</div>
              </div>

              <div style={{ ...kpiCard, borderTop: `3px solid ${ACCENT_PRO}` }}>
                <div style={kpiLabel}>🛒 Score marché — détail</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>{feasibility.scoreMarche}<span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700 }}>/100</span></div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>
                  Prix {feasibility.marketParts.prix}/40 · Transactions {feasibility.marketParts.transactions}/20 · Concurrence {feasibility.marketParts.concurrence}/20 · Absorption {feasibility.marketParts.absorption}/20
                </div>
              </div>
            </div>

            {/* ── Décision Promoteur — prix terrain conseillé · GO/NO-GO · SmartScore (ÉV.7) ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
              <div style={{ ...kpiCard, borderTop: `3px solid ${ACCENT_PRO}` }}>
                <div style={kpiLabel}>🤝 Prix terrain conseillé</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a" }}>{eur(feasibility.prixTerrainConseille)}</div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>
                  {feasibility.prixVendeurActuel > 0 && <>Prix vendeur : <b>{eur(feasibility.prixVendeurActuel)}</b><br /></>}
                  Prix max : <b>{eur(feasibility.prixTerrainMax)}</b>
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, marginTop: 3, color: feasibility.prixVendeurActuel <= 0 ? "#64748b" : feasibility.negociationCible > 0 ? "#dc2626" : "#16a34a" }}>
                  {feasibility.negociationComment}
                </div>
              </div>

              <div style={{ ...kpiCard, borderTop: `3px solid ${feasibility.decisionColor}`, background: feasibility.decisionColor + "0d" }}>
                <div style={kpiLabel}>🚦 Décision promoteur</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: feasibility.decisionColor }}>{feasibility.decisionLabel}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: feasibility.decisionColor, marginLeft: "auto" }}>{feasibility.decisionScore}/100</div>
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, lineHeight: 1.4 }}>{feasibility.decisionReason}</div>
              </div>

              <div style={{ ...kpiCard, borderTop: `3px solid ${feasibility.smartColor}` }}>
                <div style={kpiLabel}>⭐ SmartScore Promoteur</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <div style={{ fontSize: 26, fontWeight: 900, color: feasibility.smartColor }}>{feasibility.smartScorePromoteur}</div>
                  <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700 }}>/ 100</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: feasibility.smartColor }}>{feasibility.smartLabel}</div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: feasibility.projectRankColor, marginLeft: "auto", background: feasibility.projectRankColor + "1a", borderRadius: 6, padding: "1px 8px" }}>Rang {feasibility.projectRank}</div>
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6, lineHeight: 1.4 }}>
                  Urbanisme {feasibility.smartScoreUrbanisme}/25{feasibility.hasPlu ? "" : " ⚠"} · Marché {feasibility.smartScoreMarche}/25 · Rentab. {feasibility.smartScoreRentabilite}/25 · Risques {feasibility.smartScoreRisques}/25
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>Total : {feasibility.smartScorePromoteur}/100</div>
              </div>
            </div>

            {/* Lecture promoteur */}
            <div style={{ ...card, marginBottom: 12, borderLeft: `4px solid ${ACCENT_PRO}`, background: "linear-gradient(135deg, #fafafe, #f4f3ff)" }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, color: ACCENT_PRO }}>📊 Lecture promoteur</div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "#334155", lineHeight: 1.75 }}>{lecturePromoteur.map((i, idx) => <li key={idx}>{i}</li>)}</ul>
            </div>

            {/* Métré Massing 3D */}
            {massingLocked && (
              <div style={{ ...card, marginBottom: 12, borderLeft: `4px solid ${ACCENT_PRO}` }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, color: ACCENT_PRO, display: "flex", alignItems: "center", gap: 8 }}>
                  🏗 Métré Massing 3D
                  <span style={{ fontSize: 10, fontWeight: 700, color: ACCENT_PRO, background: ACCENT_PRO + "18", borderRadius: 4, padding: "1px 6px" }}>auto · verrouillé</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                  {([
                    ["Bâtiments", String(massing!.totaux.nbBatiments)],
                    ["Emprise sol", m2(massing!.totaux.empriseSolM2)],
                    ["SDP", m2(massing!.totaux.sdpM2)],
                    ["SHAB est.", m2(massing!.totaux.shabM2)],
                    ["Façade", m2(massing!.totaux.surfaceFacadeM2)],
                    ["Toiture terrasse", m2(massing!.totaux.surfaceToitureTerrasseM2)],
                    ["Toiture pente", m2(massing!.totaux.surfaceToiturePenteM2)],
                    ["Balcons", m2(massing!.totaux.surfaceBalconsM2)],
                    ["Menuiseries", `${massing!.totaux.nbMenuiseries} u`],
                    ["Prix moyen travaux", `${Math.round(computed.travauxEurM2Sdp)} €/m² SDP`],
                    ["Logements", String(nbLogementsEffectif)],
                    ["Typologie", `T1:${massing!.typologie.T1} · T2:${massing!.typologie.T2} · T3:${massing!.typologie.T3} · T4:${massing!.typologie.T4}`],
                    ...(massing!.ratios.cesEmprise != null ? [["CES", massing!.ratios.cesEmprise.toFixed(2)]] as [string, string][] : []),
                  ] as [string, string][]).map(([l, v]) => (
                    <div key={l} style={{ background: "#f8fafc", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>{l}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 8 }}>
                  SDP, logements et chiffrage des travaux (gros œuvre, façade, toiture, balcons, menuiseries) sont pilotés automatiquement par le Massing 3D. Les prix unitaires restent personnalisables dans les Hypothèses.
                </div>
              </div>
            )}

            {/* Stress test */}
            <div id="stress-test" style={{ ...card, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>📉 Sensibilité — Stress test</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[{ sc: sensitivity.scenarioA, bg: "#fffbeb", border: "#fcd34d", color: "#92400e", sep: "#fde68a" }, { sc: sensitivity.scenarioB, bg: "#fff1f2", border: "#fecaca", color: "#991b1b", sep: "#fecaca" }].map(({ sc, bg, border, color, sep }) => (
                  <div key={sc.label} style={{ background: bg, borderRadius: 12, padding: "14px 16px", border: `1px solid ${border}` }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color, marginBottom: 10 }}>{sc.label}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color }}>Marge</span><strong style={{ color: sc.marge >= 0 ? "#166534" : "#991b1b" }}>{eur(sc.marge)}</strong></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color }}>Taux marge</span><strong>{sc.margePct.toFixed(1)} %</strong></div>
                      <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${sep}`, paddingTop: 8 }}><span style={{ color, fontSize: 12 }}>Delta vs base</span><strong style={{ color: sc.deltaMarge < 0 ? "#dc2626" : "#16a34a", fontSize: 12 }}>{sc.deltaMarge >= 0 ? "+" : ""}{eur(sc.deltaMarge)} ({sc.deltaPct >= 0 ? "+" : ""}{sc.deltaPct.toFixed(1)} pts)</strong></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Paramètres + Hypothèses */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Paramètres projet</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[
                    { label: "Type bâtiment",    node: <select style={inputStyle} value={buildingKind} onChange={(e) => setBuildingKind(e.target.value as BuildingKind)}><option value="COLLECTIF">Collectif</option><option value="INDIVIDUEL">Individuel</option></select> },
                    { label: "Étages (R+N)",      node: <input style={inputStyle} type="number" min={0} max={40} value={floorsSpec.aboveGroundFloors} onChange={(e) => setFloorsSpec((f) => ({ ...f, aboveGroundFloors: Math.max(0, Number(e.target.value) || 0) }))} /> },
                    { label: "Hauteur RDC (m)",   node: <input style={inputStyle} type="number" step="0.1" value={floorsSpec.groundFloorHeightM} onChange={(e) => setFloorsSpec((f) => ({ ...f, groundFloorHeightM: Number(e.target.value) || 2.8 }))} /> },
                    { label: "Hauteur étage (m)", node: <input style={inputStyle} type="number" step="0.1" value={floorsSpec.typicalFloorHeightM} onChange={(e) => setFloorsSpec((f) => ({ ...f, typicalFloorHeightM: Number(e.target.value) || 2.7 }))} /> },
                    { label: resolvedLogements.source === "programmation" ? "Nb logements 🔒 programmation"
                           : massingLocked ? "Nb logements 🔒 massing estimé"
                           : "Nb logements",
                      node: <input style={resolvedLogements.source !== "none" ? inputLocked : inputStyle} type="number" min={1} max={500} disabled={resolvedLogements.source !== "none"} value={nbLogements} onChange={(e) => setNbLogements(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} /> },
                  ].map(({ label, node }) => <div key={label}><div style={labelStyle}>{label}</div>{node}</div>)}
                </div>

                {ass.rehabMode && (
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f1f5f9" }}>
                    <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6, color: missingRehab ? "#dc2626" : "#0f172a" }}>
                      📐 Surface SDP réhabilitée (m²)
                      {missingRehab && <span style={{ fontSize: 10, color: "#dc2626", fontWeight: 600 }}>⚠ requis</span>}
                    </div>
                    <input
                      style={{ ...inputStyle, border: `2px solid ${missingRehab ? "#dc2626" : ACCENT_PRO}`, background: missingRehab ? "#fff5f5" : "#faf5ff" }}
                      type="number" min={0}
                      placeholder="Ex : 650 — surface totale réhabilitée en m²"
                      value={ass.surfaceRehabM2 === 0 ? "" : ass.surfaceRehabM2}
                      onChange={(e) => updateAss("surfaceRehabM2", Math.max(0, Number(e.target.value) || 0))}
                    />
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                      Pré-rempli depuis la Simulation Travaux. Surface vendable estimée = {m2(surfaceVendableM2)} ({(coefHab * 100).toFixed(0)}% × {n(ass.coefVendable, 1).toFixed(2)})
                    </div>
                  </div>
                )}

                {/* ── Planning opération (ÉV.4) ── */}
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f1f5f9" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 8 }}>Planning opération (mois)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div><div style={labelStyle}>Acquisition</div><input style={inputStyle} type="number" min={0} step={1} value={ass.dureeAcquisitionMois} onChange={(e) => updateAss("dureeAcquisitionMois", Math.max(0, Number(e.target.value) || 0))} /></div>
                    <div><div style={labelStyle}>Permis</div><input style={inputStyle} type="number" min={0} step={1} value={ass.dureePermisMois} onChange={(e) => updateAss("dureePermisMois", Math.max(0, Number(e.target.value) || 0))} /></div>
                    <div><div style={labelStyle}>Purge recours</div><input style={inputStyle} type="number" min={0} step={1} value={ass.dureePurgeMois} onChange={(e) => updateAss("dureePurgeMois", Math.max(0, Number(e.target.value) || 0))} /></div>
                    <div><div style={labelStyle}>Travaux</div><input style={inputStyle} type="number" min={0} step={1} value={ass.dureeTravauxMois} onChange={(e) => updateAss("dureeTravauxMois", Math.max(0, Number(e.target.value) || 0))} /></div>
                    <div style={{ gridColumn: "1 / -1" }}><div style={labelStyle}>Commercialisation</div><input style={inputStyle} type="number" min={0} step={1} value={ass.dureeCommercialisationMois} onChange={(e) => updateAss("dureeCommercialisationMois", Math.max(0, Number(e.target.value) || 0))} /></div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: feasibility.dureeColor, fontWeight: 700 }}>Durée opération : {feasibility.dureeOperationMois} mois · {feasibility.dureeLabel}</div>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>Hauteur estimée : <b>{totalHeightM.toFixed(1)} m</b></div>
              </div>

              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Hypothèses</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                  <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: regionInfo.factor !== 1 ? "rgba(82,71,184,0.08)" : "#f8fafc", border: `1px solid ${regionInfo.factor !== 1 ? ACCENT_PRO + "33" : "#e8edf4"}`, borderRadius: 10, padding: "8px 12px" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: regionInfo.factor !== 1 ? ACCENT_PRO : "#64748b" }}>🗺 Coefficient régional (construction principale)</span>
                    <span style={{ fontSize: 14, fontWeight: 900, color: regionInfo.factor !== 1 ? ACCENT_PRO : "#0f172a" }}>×{regionInfo.factor.toFixed(2)} — {regionInfo.label}{regionInfo.dept ? ` (${regionInfo.dept})` : ""}</span>
                  </div>
                  <div><div style={labelStyle}>Prix vente (€/m² vend.)</div><input style={inputStyle} type="number" value={ass.salePriceEurM2Hab} onChange={(e) => updateAss("salePriceEurM2Hab", Number(e.target.value) || 0)} /></div>
                  <div><div style={labelStyle}>Commercialisation (%)</div><input style={inputStyle} type="number" value={ass.commercialisationPct} onChange={(e) => updateAss("commercialisationPct", pct(e.target.value, 100))} /></div>
                  <div><div style={labelStyle}>Coef vendable</div><input style={inputStyle} type="number" step="0.01" min={0.8} max={1.2} value={ass.coefVendable} onChange={(e) => updateAss("coefVendable", Math.min(1.2, Math.max(0.8, Number(e.target.value) || 1)))} /></div>
                  <div><div style={labelStyle}>Foncier (€)</div><input style={inputStyle} type="number" placeholder="ex: 450 000" value={Number.isFinite(ass.landPriceEur) ? ass.landPriceEur : ""} onChange={(e) => updateAss("landPriceEur", e.target.value === "" ? NaN : Number(e.target.value))} /></div>
                  <div><div style={labelStyle}>Notaire (%)</div><input style={inputStyle} type="number" value={ass.notaryFeesPct} onChange={(e) => updateAss("notaryFeesPct", pct(e.target.value, 7.5))} /></div>
                  <div><div style={labelStyle}>Taxes acquisition (%)</div><input style={inputStyle} type="number" value={ass.acquisitionTaxesPct} onChange={(e) => updateAss("acquisitionTaxesPct", pct(e.target.value, 0))} /></div>
                  <div><div style={labelStyle}>🎯 Marge cible (%)</div><input style={inputStyle} type="number" min={0} max={60} value={ass.targetMarginPct} onChange={(e) => updateAss("targetMarginPct", pct(e.target.value, 18))} /></div>
                  <div><div style={labelStyle}>🛡 Marge sécurité foncier (%)</div><input style={inputStyle} type="number" min={0} max={50} value={ass.margeSecuriteFoncierPct} onChange={(e) => updateAss("margeSecuriteFoncierPct", pct(e.target.value, 15))} /></div>
                  {ass.rehabMode ? (
                    <div style={{ gridColumn: "span 2" }}>
                      <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
                        🔧 Travaux réhabilitation (€ HT)
                        <span style={{ fontSize: 10, color: ACCENT_PRO, background: ACCENT_PRO + "18", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>Simulation</span>
                      </div>
                      <input style={{ ...inputStyle, borderColor: ACCENT_PRO, background: "#faf5ff" }} type="number" value={ass.travauxRehabTotal} onChange={(e) => updateAss("travauxRehabTotal", Number(e.target.value) || 0)} />
                    </div>
                  ) : massingLocked ? (
                    <>
                      <div style={{ gridColumn: "1 / -1", marginTop: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: ACCENT_PRO, letterSpacing: "0.04em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                          Chiffrage travaux détaillé
                          <span style={{ fontSize: 10, fontWeight: 700, color: ACCENT_PRO, background: ACCENT_PRO + "18", borderRadius: 4, padding: "1px 6px" }}>quantités 🔒 Massing</span>
                        </div>
                        {/* Toggle Auto / Personnalisé */}
                        <div style={{ display: "flex", gap: 4, background: "#f1f5f9", borderRadius: 8, padding: 2 }}>
                          <button type="button" onClick={enableAutoCosts}
                            style={{ padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700,
                              background: ass.autoCosts ? ACCENT_PRO : "transparent", color: ass.autoCosts ? "#fff" : "#64748b" }}>
                            ⚙️ Auto
                          </button>
                          <button type="button" onClick={enableManualCosts}
                            style={{ padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700,
                              background: !ass.autoCosts ? ACCENT_PRO : "transparent", color: !ass.autoCosts ? "#fff" : "#64748b" }}>
                            ✏️ Personnaliser
                          </button>
                        </div>
                      </div>
                      {ass.autoCosts && derivedCosts && (
                        <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "#64748b", background: "rgba(82,71,184,0.05)", borderRadius: 8, padding: "6px 10px", marginBottom: 2 }}>
                          📐 Prix calculés depuis la géométrie — <strong>{derivedCosts.basis}</strong>{derivedCosts.facadeMultPct !== 0 ? `, façade ${derivedCosts.facadeMultPct >= 0 ? "+" : ""}${derivedCosts.facadeMultPct} %` : ""}. Passe en « Personnaliser » pour ajuster.
                        </div>
                      )}
                      {/* Prix moyen travaux — bandeau indicatif, toujours visible quand massing connecté */}
                      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: ACCENT_PRO + "12", border: `1px solid ${ACCENT_PRO}33`, borderRadius: 10, padding: "10px 14px", marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: ACCENT_PRO }}>💶 Prix moyen travaux (tous lots)</span>
                        <span style={{ fontSize: 20, fontWeight: 900, color: ACCENT_PRO }}>{Math.round(computed.travauxEurM2Sdp).toLocaleString("fr-FR")} €/m² SDP</span>
                      </div>
                      <div><div style={labelStyle}>Gros œuvre (€/m² SDP)</div><input style={ass.autoCosts ? inputLocked : inputStyle} type="number" min={0} step={50} disabled={ass.autoCosts} value={ass.structureCostEurM2Sdp} onChange={(e) => updateAss("structureCostEurM2Sdp", Number(e.target.value) || 0)} /></div>
                      <div><div style={labelStyle}>Fondations (€/m² emprise)</div><input style={ass.autoCosts ? inputLocked : inputStyle} type="number" min={0} step={10} disabled={ass.autoCosts} value={ass.foundationCostEurM2Emprise} onChange={(e) => updateAss("foundationCostEurM2Emprise", Number(e.target.value) || 0)} /></div>
                      <div><div style={labelStyle}>Nature du sol</div><select style={inputStyle} value={ass.soilType} onChange={(e) => updateAss("soilType", e.target.value as Assumptions["soilType"])}><option value="normal">Normal (×1)</option><option value="argileux">Argileux (×1.45)</option><option value="pieux">Pieux nécessaires (×2.3)</option></select></div>
                      <div><div style={labelStyle}>Façade (€/m²)</div><input style={ass.autoCosts ? inputLocked : inputStyle} type="number" min={0} step={10} disabled={ass.autoCosts} value={ass.facadeCostEurM2} onChange={(e) => updateAss("facadeCostEurM2", Number(e.target.value) || 0)} /></div>
                      <div><div style={labelStyle}>Toiture terrasse (€/m²)</div><input style={ass.autoCosts ? inputLocked : inputStyle} type="number" min={0} step={10} disabled={ass.autoCosts} value={ass.roofTerrasseCostEurM2} onChange={(e) => updateAss("roofTerrasseCostEurM2", Number(e.target.value) || 0)} /></div>
                      <div><div style={labelStyle}>Toiture pente (€/m²)</div><input style={ass.autoCosts ? inputLocked : inputStyle} type="number" min={0} step={10} disabled={ass.autoCosts} value={ass.roofPenteCostEurM2} onChange={(e) => updateAss("roofPenteCostEurM2", Number(e.target.value) || 0)} /></div>
                      <div><div style={labelStyle}>Balcons (€/m²)</div><input style={ass.autoCosts ? inputLocked : inputStyle} type="number" min={0} step={50} disabled={ass.autoCosts} value={ass.balconyCostEurM2} onChange={(e) => updateAss("balconyCostEurM2", Number(e.target.value) || 0)} /></div>
                      <div><div style={labelStyle}>Menuiseries (€/u)</div><input style={ass.autoCosts ? inputLocked : inputStyle} type="number" min={0} step={50} disabled={ass.autoCosts} value={ass.windowUnitCostEur} onChange={(e) => updateAss("windowUnitCostEur", Number(e.target.value) || 0)} /></div>
                    </>
                  ) : (
                    <div style={{ gridColumn: "span 2" }}>
                      <div style={labelStyle}>Travaux (€/m² SDP)</div>
                      <input style={inputStyle} type="number" value={ass.worksCostEurM2Sdp} onChange={(e) => updateAss("worksCostEurM2Sdp", Number(e.target.value) || 0)} />
                    </div>
                  )}
                  <div><div style={labelStyle}>VRD (%)</div><input style={inputStyle} type="number" value={ass.vrdPct} onChange={(e) => updateAss("vrdPct", pct(e.target.value, 6))} /></div>
                  <div><div style={labelStyle}>Ext. (%)</div><input style={inputStyle} type="number" value={ass.extPct} onChange={(e) => updateAss("extPct", pct(e.target.value, 3))} /></div>
                  <div><div style={labelStyle}>Aléas (%)</div><input style={inputStyle} type="number" value={ass.contingencyPct} onChange={(e) => updateAss("contingencyPct", pct(e.target.value, 3))} /></div>
                  <div><div style={labelStyle}>MOE (%)</div><input style={inputStyle} type="number" value={ass.moePct} onChange={(e) => updateAss("moePct", pct(e.target.value, 10))} /></div>
                  <div><div style={labelStyle}>BET (%)</div><input style={inputStyle} type="number" value={ass.betPct} onChange={(e) => updateAss("betPct", pct(e.target.value, 3))} /></div>
                  <div><div style={labelStyle}>DO (%)</div><input style={inputStyle} type="number" value={ass.insuranceDoPct} onChange={(e) => updateAss("insuranceDoPct", pct(e.target.value, 2))} /></div>
                  <div><div style={labelStyle}>Comm. (% CA)</div><input style={inputStyle} type="number" value={ass.marketingPctCa} onChange={(e) => updateAss("marketingPctCa", pct(e.target.value, 2))} /></div>
                  <div><div style={labelStyle}>Taux financement (%)</div><input style={inputStyle} type="number" value={ass.financingRatePct} onChange={(e) => updateAss("financingRatePct", pct(e.target.value, 4))} /></div>
                  <div><div style={labelStyle}>Frais dossier (€)</div><input style={inputStyle} type="number" value={ass.financingFeesEur} onChange={(e) => updateAss("financingFeesEur", Number(e.target.value) || 0)} /></div>
                  <div><div style={labelStyle}>Taxe aménag. (€/m² SDP)</div><input style={inputStyle} type="number" value={ass.taxeAmenagementEurM2Sdp} onChange={(e) => updateAss("taxeAmenagementEurM2Sdp", Number(e.target.value) || 0)} /></div>

                  <div style={{ gridColumn: "1 / -1", marginTop: 4, fontSize: 11, fontWeight: 800, color: "#64748b", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Forfaits (€)
                  </div>
                  <div><div style={labelStyle}>Géomètre (€)</div><input style={inputStyle} type="number" min={0} step={500} value={ass.surveyorEur} onChange={(e) => updateAss("surveyorEur", Number(e.target.value) || 0)} /></div>
                  <div><div style={labelStyle}>Géotechnique (€)</div><input style={inputStyle} type="number" min={0} step={500} value={ass.geotechEur} onChange={(e) => updateAss("geotechEur", Number(e.target.value) || 0)} /></div>
                  <div><div style={labelStyle}>SPS / CT / OPC (€)</div><input style={inputStyle} type="number" min={0} step={500} value={ass.spsCtOpcEur} onChange={(e) => updateAss("spsCtOpcEur", Number(e.target.value) || 0)} /></div>
                  <div><div style={labelStyle}>Divers montage (€)</div><input style={inputStyle} type="number" min={0} step={500} value={ass.miscEur} onChange={(e) => updateAss("miscEur", Number(e.target.value) || 0)} /></div>
                  <div><div style={labelStyle}>Commercialisation forfait (€)</div><input style={inputStyle} type="number" min={0} step={500} value={ass.marketingFixedEur} onChange={(e) => updateAss("marketingFixedEur", Number(e.target.value) || 0)} /></div>

                  <div style={{ gridColumn: "span 2" }}>
                    <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
                      Terrassement / nivellement (€ HT)
                      {terrassementHint && <span style={{ fontSize: 10, color: ACCENT_PRO, background: ACCENT_PRO + "18", borderRadius: 4, padding: "1px 6px" }}>🏗 Massing 3D</span>}
                    </div>
                    <input style={inputStyle} type="number" min={0} step={500} placeholder="0" value={ass.terrassementEur === 0 ? "" : ass.terrassementEur} onChange={(e) => updateAss("terrassementEur", Number(e.target.value) || 0)} />
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>Déblais/remblais selon le relief. Les fondations sont chiffrées séparément ci-dessus.</div>
                  </div>

                  {/* ── Équipements & infrastructure ── */}
                  <div style={{ gridColumn: "1 / -1", marginTop: 4, fontSize: 11, fontWeight: 800, color: "#64748b", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    Équipements & infrastructure
                  </div>
                  <div><div style={labelStyle}>Nb ascenseurs</div><input style={inputStyle} type="number" min={0} step={1} value={ass.nbAscenseurs} onChange={(e) => updateAss("nbAscenseurs", Math.max(0, Math.floor(Number(e.target.value) || 0)))} /></div>
                  <div>
                    <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
                      Coût base ascenseur (€)
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>×{ascenseurHeightCoef(levelsCount)} hauteur</span>
                    </div>
                    <input style={inputStyle} type="number" min={0} step={1000} value={ass.ascenseurBaseCostEur} onChange={(e) => updateAss("ascenseurBaseCostEur", Number(e.target.value) || 0)} />
                  </div>
                  <div><div style={labelStyle}>Nb niveaux sous-sol</div><input style={inputStyle} type="number" min={0} step={1} value={ass.nbSousSols} onChange={(e) => updateAss("nbSousSols", Math.max(0, Math.floor(Number(e.target.value) || 0)))} /></div>
                  <div><div style={labelStyle}>Surface sous-sol (m²/niv.)</div><input style={inputStyle} type="number" min={0} step={10} value={ass.surfaceSousSolM2} onChange={(e) => updateAss("surfaceSousSolM2", Math.max(0, Number(e.target.value) || 0))} /></div>
                  <div><div style={labelStyle}>Coût sous-sol (€/m²)</div><input style={inputStyle} type="number" min={0} step={10} value={ass.coutSousSolEurM2} onChange={(e) => updateAss("coutSousSolEurM2", Number(e.target.value) || 0)} /></div>

                  {/* ── Parking ── */}
                  <div>
                    <div style={labelStyle}>Type de parking</div>
                    <select style={inputStyle} value={ass.parkingType}
                      onChange={(e) => { const t = e.target.value as Assumptions["parkingType"]; setAss((s) => ({ ...s, parkingType: t, parkingCostPerPlace: PARKING_COST[t] })); }}>
                      <option value="surface">Surface / enrobé</option>
                      <option value="aerien">Aérien (silo)</option>
                      <option value="sous_sol">Sous-sol</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
                      Parking (€/place)
                      <span style={{ fontSize: 10, color: "#94a3b8" }}>{computed.nbParkingsEff} pl.</span>
                    </div>
                    <input style={inputStyle} type="number" min={0} step={500} value={ass.parkingCostPerPlace} onChange={(e) => updateAss("parkingCostPerPlace", Number(e.target.value) || 0)} />
                  </div>
                </div>
              </div>
            </div>

            {/* Bilan détaillé */}
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Bilan détaillé</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {Array.from(grouped.entries()).map(([section, lines]) => (
                  <div key={section}>
                    <div style={{ ...sectionTitle, marginBottom: 6 }}>{section}</div>
                    <div style={{ border: "1px solid #e8edf4", borderRadius: 12, overflow: "hidden" }}>
                      {lines.map((l, idx) => {
                        const isSubtotal = l.kind === "subtotal"; const isTotal = l.kind === "total"; const isNegative = l.valueEur < 0; const isRehab = l.label.startsWith("🔧");
                        return (
                          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 180px 160px", gap: 12, padding: "9px 14px", borderTop: idx === 0 ? "none" : `1px solid ${isTotal ? "rgba(255,255,255,0.08)" : "#f1f5f9"}`, background: isTotal ? "#1e293b" : isSubtotal ? "#f1f5f9" : isRehab ? "rgba(82,71,184,0.04)" : "white", color: isTotal ? "white" : isNegative ? "#dc2626" : "#0f172a", fontWeight: isTotal ? 900 : isSubtotal ? 700 : 500, alignItems: "center", fontSize: 13 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {isRehab && <span style={{ fontSize: 11, background: "rgba(82,71,184,0.1)", color: ACCENT_PRO, borderRadius: 4, padding: "1px 5px", fontWeight: 700, flexShrink: 0 }}>Réhab</span>}
                              {l.label}
                            </div>
                            <div style={{ fontSize: 11, color: isTotal ? "rgba(255,255,255,0.5)" : "#94a3b8", textAlign: "right" }}>{l.hint ?? ""}</div>
                            <div style={{ textAlign: "right", fontWeight: isTotal || isSubtotal ? 900 : 600 }}>{eur(l.valueEur)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {computed.notes.length > 0 && (
              <div style={{ ...card, marginTop: 12, borderLeft: "4px solid #f59e0b", background: "#fffbeb" }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: "#92400e" }}>Notes</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#78350f", fontSize: 13, lineHeight: 1.7 }}>{computed.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default BilanPromoteurPage;