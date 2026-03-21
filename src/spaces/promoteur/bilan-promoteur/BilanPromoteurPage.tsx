// src/spaces/promoteur/bilan-promoteur/BilanPromoteurPage.tsx
// Pro forma v2 — avec surface vendable, lecture promoteur, sensibilité

import React, { useMemo, useState, useEffect } from "react";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useSearchParams } from "react-router-dom";
import { usePromoteurProjectStore } from "../store/promoteurProject.store";
import { patchModule } from "../shared/promoteurSnapshot.store";
import { usePromoteurStudy } from "../shared/usePromoteurStudy";
import type { PromoteurBilanData } from "../shared/promoteurStudy.types";
import { PromoteurSynthesePage } from "../pages/PromoteurSynthesePage";

// ─── Design tokens ───────────────────────────────────────────────────────────
const GRAD_PRO = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
const ACCENT_PRO = "#5247b8";

// -------------------------------
// Helpers
// -------------------------------
function n(v: unknown, fallback = 0): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function pct(v: unknown, fallback = 0): number {
  const x = n(v, fallback);
  if (x < 0) return 0;
  if (x > 100) return 100;
  return x;
}

function eur(v: number): string {
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${Math.round(v)} €`;
  }
}

function m2(v: number): string {
  return `${Math.round(v)} m²`;
}

function safeAreaM2(feat: Feature<Geometry> | null | undefined): number {
  if (!feat?.geometry) return 0;
  try {
    return turf.area(feat as turf.AllGeoJSON);
  } catch {
    return 0;
  }
}

function sumAreas(fc?: FeatureCollection<Geometry> | null): number {
  if (!fc?.features || !Array.isArray(fc.features)) return 0;
  return fc.features.reduce((acc, f) => acc + safeAreaM2(f as Feature<Geometry>), 0);
}

// -------------------------------
// Types
// -------------------------------
type BuildingKind = "INDIVIDUEL" | "COLLECTIF";

type FloorsSpec = {
  aboveGroundFloors: number;
  groundFloorHeightM: number;
  typicalFloorHeightM: number;
};

type Assumptions = {
  salePriceEurM2Hab: number;
  commercialisationPct: number;
  coefVendable: number;
  landPriceEur: number;
  notaryFeesPct: number;
  acquisitionTaxesPct: number;
  worksCostEurM2Sdp: number;
  vrdPct: number;
  extPct: number;
  contingencyPct: number;
  surveyorEur: number;
  geotechEur: number;
  moePct: number;
  betPct: number;
  spsCtOpcEur: number;
  insuranceDoPct: number;
  miscEur: number;
  marketingPctCa: number;
  marketingFixedEur: number;
  financingRatePct: number;
  financingFeesEur: number;
  taxeAmenagementEurM2Sdp: number;
};

type Line = {
  section: string;
  label: string;
  valueEur: number;
  kind?: "subtotal" | "total";
  hint?: string;
};

// -------------------------------
// Coefficients
// -------------------------------
const COEF_SDP = 1.0;
const COEF_HABITABLE_COLLECTIF = 0.82;
const COEF_HABITABLE_INDIVIDUEL = 0.9;

// -------------------------------
// Default assumptions
// -------------------------------
const DEFAULT_ASSUMPTIONS: Assumptions = {
  salePriceEurM2Hab: 5200,
  commercialisationPct: 100,
  coefVendable: 1.0,
  landPriceEur: 0,
  notaryFeesPct: 7.5,
  acquisitionTaxesPct: 0,
  worksCostEurM2Sdp: 1800,
  vrdPct: 6,
  extPct: 3,
  contingencyPct: 3,
  surveyorEur: 6000,
  geotechEur: 12000,
  moePct: 10,
  betPct: 3,
  spsCtOpcEur: 15000,
  insuranceDoPct: 2,
  miscEur: 8000,
  marketingPctCa: 2,
  marketingFixedEur: 0,
  financingRatePct: 4,
  financingFeesEur: 8000,
  taxeAmenagementEurM2Sdp: 80,
};

// -------------------------------
// Pro forma calculation function (reusable for sensitivity)
// -------------------------------
function computeProForma(
  ass: Assumptions,
  sdpEstimatedM2: number,
  surfaceVendableM2: number
) {
  const caLogements =
    surfaceVendableM2 *
    n(ass.salePriceEurM2Hab, 0) *
    (pct(ass.commercialisationPct, 100) / 100);
  const caTotal = caLogements;

  const foncier = n(ass.landPriceEur, 0);
  const fraisNotaire = foncier * (pct(ass.notaryFeesPct, 7.5) / 100);
  const taxesAcq = foncier * (pct(ass.acquisitionTaxesPct, 0) / 100);
  const totalFoncier = foncier + fraisNotaire + taxesAcq;

  const travauxBase = sdpEstimatedM2 * n(ass.worksCostEurM2Sdp, 0);
  const surveyor = n(ass.surveyorEur, 0);
  const geotech = n(ass.geotechEur, 0);
  const moe = travauxBase * (pct(ass.moePct, 10) / 100);
  const bet = travauxBase * (pct(ass.betPct, 3) / 100);
  const spsCtOpc = n(ass.spsCtOpcEur, 0);
  const insuranceDo = travauxBase * (pct(ass.insuranceDoPct, 2) / 100);
  const misc = n(ass.miscEur, 0);
  const totalEtudes = surveyor + geotech + moe + bet + spsCtOpc + insuranceDo + misc;

  const vrd = travauxBase * (pct(ass.vrdPct, 6) / 100);
  const ext = travauxBase * (pct(ass.extPct, 3) / 100);
  const aleas = travauxBase * (pct(ass.contingencyPct, 3) / 100);
  const totalTravaux = travauxBase + vrd + ext + aleas;

  const taxeAmenagement = sdpEstimatedM2 * n(ass.taxeAmenagementEurM2Sdp, 0);
  const totalTaxes = taxeAmenagement;

  const marketingPct = caTotal * (pct(ass.marketingPctCa, 2) / 100);
  const marketingFixed = n(ass.marketingFixedEur, 0);
  const totalCom = marketingPct + marketingFixed;

  const baseFin = totalFoncier + 0.5 * totalTravaux;
  const intercalaires = baseFin * (pct(ass.financingRatePct, 4) / 100);
  const fraisFin = n(ass.financingFeesEur, 0);
  const totalFin = intercalaires + fraisFin;

  const coutTotal =
    totalFoncier + totalEtudes + totalTravaux + totalTaxes + totalCom + totalFin;
  const marge = caTotal - coutTotal;
  const margePct = caTotal > 0 ? (marge / caTotal) * 100 : 0;
  const coutRevientEurM2Hab =
    surfaceVendableM2 > 0 ? coutTotal / surfaceVendableM2 : 0;
  const coutRevientEurM2Sdp = sdpEstimatedM2 > 0 ? coutTotal / sdpEstimatedM2 : 0;

  return {
    caLogements, caTotal, foncier, fraisNotaire, taxesAcq, totalFoncier,
    travauxBase, surveyor, geotech, moe, bet, spsCtOpc, insuranceDo, misc, totalEtudes,
    vrd, ext, aleas, totalTravaux, taxeAmenagement, totalTaxes,
    marketingPct, marketingFixed, totalCom, intercalaires, fraisFin, totalFin,
    coutTotal, marge, margePct, coutRevientEurM2Hab, coutRevientEurM2Sdp,
  };
}

// -------------------------------
// Main component
// -------------------------------
export const BilanPromoteurPage: React.FC = () => {
  const buildings = usePromoteurProjectStore((s) => s.buildings);
  const parkings = usePromoteurProjectStore((s) => s.parkings);

  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");
  const { study, loadState, patchBilan } = usePromoteurStudy(studyId);

  const footprintBuildingsM2 = useMemo(() => sumAreas(buildings), [buildings]);
  const footprintParkingsM2 = useMemo(() => sumAreas(parkings), [parkings]);

  const [activeTab, setActiveTab] = useState<"bilan" | "synthese">("bilan");
  const [buildingKind, setBuildingKind] = useState<BuildingKind>("COLLECTIF");
  const [floorsSpec, setFloorsSpec] = useState<FloorsSpec>({
    aboveGroundFloors: 1,
    groundFloorHeightM: 2.8,
    typicalFloorHeightM: 2.7,
  });
  const [nbLogements, setNbLogements] = useState<number>(1);
  const [ass, setAss] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);

  useEffect(() => {
    if (loadState !== "ready" || !study) return;
    const f = study.foncier;
    if (f?.surface_m2 && f.surface_m2 > 0) { /* debug */ }
    if (study.evaluation?.cout_foncier) {
      setAss((prev) => ({ ...prev, landPriceEur: study.evaluation!.cout_foncier! }));
    }
    if (study.marche?.prix_m2_neuf) {
      setAss((prev) => ({ ...prev, salePriceEurM2Hab: study.marche!.prix_m2_neuf! }));
    }
  }, [loadState, study]);

  const levelsCount = useMemo(
    () => 1 + Math.max(0, Math.floor(n(floorsSpec.aboveGroundFloors, 0))),
    [floorsSpec.aboveGroundFloors]
  );

  const totalHeightM = useMemo(
    () =>
      n(floorsSpec.groundFloorHeightM, 2.8) +
      Math.max(0, Math.floor(n(floorsSpec.aboveGroundFloors, 0))) *
        n(floorsSpec.typicalFloorHeightM, 2.7),
    [floorsSpec]
  );

  const coefHab =
    buildingKind === "INDIVIDUEL" ? COEF_HABITABLE_INDIVIDUEL : COEF_HABITABLE_COLLECTIF;

  const sdpEstimatedM2 = useMemo(
    () => footprintBuildingsM2 * levelsCount * COEF_SDP,
    [footprintBuildingsM2, levelsCount]
  );

  const habitableEstimatedM2 = useMemo(
    () => sdpEstimatedM2 * coefHab,
    [sdpEstimatedM2, coefHab]
  );

  const surfaceVendableM2 = useMemo(
    () => habitableEstimatedM2 * n(ass.coefVendable, 1),
    [habitableEstimatedM2, ass.coefVendable]
  );

  const computed = useMemo(() => {
    const pf = computeProForma(ass, sdpEstimatedM2, surfaceVendableM2);
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

    lines.push({ section: "C) TRAVAUX", label: "Travaux principaux", valueEur: pf.travauxBase, hint: `${m2(sdpEstimatedM2)} × ${ass.worksCostEurM2Sdp} €/m² SDP` });
    lines.push({ section: "C) TRAVAUX", label: "VRD / raccordements", valueEur: pf.vrd, hint: `${ass.vrdPct.toFixed(1)}% travaux` });
    lines.push({ section: "C) TRAVAUX", label: "Aménagements extérieurs", valueEur: pf.ext, hint: `${ass.extPct.toFixed(1)}% travaux` });
    lines.push({ section: "C) TRAVAUX", label: "Aléas travaux", valueEur: pf.aleas, hint: `${ass.contingencyPct.toFixed(1)}% travaux` });
    lines.push({ section: "C) TRAVAUX", label: "Total travaux", valueEur: pf.totalTravaux, kind: "subtotal" });

    lines.push({ section: "D) TAXES", label: "Taxe d'aménagement", valueEur: pf.taxeAmenagement, hint: `${ass.taxeAmenagementEurM2Sdp} €/m² SDP` });
    lines.push({ section: "D) TAXES", label: "Total taxes", valueEur: pf.totalTaxes, kind: "subtotal" });

    lines.push({ section: "E) COMMERCIALISATION", label: "Commercialisation (% CA)", valueEur: pf.marketingPct, hint: `${ass.marketingPctCa.toFixed(1)}%` });
    lines.push({ section: "E) COMMERCIALISATION", label: "Commercialisation (forfait)", valueEur: pf.marketingFixed, hint: "option" });
    lines.push({ section: "E) COMMERCIALISATION", label: "Total commercialisation", valueEur: pf.totalCom, kind: "subtotal" });

    lines.push({ section: "F) FINANCEMENT", label: "Intérêts intercalaires", valueEur: pf.intercalaires, hint: `${ass.financingRatePct.toFixed(1)}% × (foncier + 0.5×travaux)` });
    lines.push({ section: "F) FINANCEMENT", label: "Frais dossier / garanties", valueEur: pf.fraisFin, hint: "forfait" });
    lines.push({ section: "F) FINANCEMENT", label: "Total financement", valueEur: pf.totalFin, kind: "subtotal" });

    lines.push({ section: "TOTAL", label: "COÛT TOTAL OPÉRATION", valueEur: pf.coutTotal, kind: "total" });
    lines.push({ section: "TOTAL", label: "MARGE BRUTE", valueEur: pf.marge, kind: "total" });

    const notes: string[] = [];
    if (footprintBuildingsM2 <= 0) notes.push("Aucun bâtiment dessiné en Implantation 2D : SDP/Habitable = 0. Retournez sur Implantation 2D et dessinez au moins un bâtiment.");
    if (ass.salePriceEurM2Hab <= 0) notes.push("Prix de vente €/m² non renseigné : CA = 0.");
    if (ass.landPriceEur <= 0) notes.push("Foncier non renseigné : le bilan est incomplet.");

    const safeNbLogements = nbLogements > 0 ? nbLogements : 1;
    const prixParLogement = pf.caTotal / safeNbLogements;
    const coutParLogement = pf.coutTotal / safeNbLogements;
    const margeParLogement = pf.marge / safeNbLogements;

    return { ...pf, lines, notes, prixParLogement, coutParLogement, margeParLogement };
  }, [ass, footprintBuildingsM2, sdpEstimatedM2, surfaceVendableM2, nbLogements]);

  const lecturePromoteur = useMemo(() => {
    const insights: string[] = [];
    if (computed.margePct >= 20) insights.push("✅ Marge confortable (≥ 20%)");
    else if (computed.margePct >= 12) insights.push("⚠️ Marge moyenne (12-20%) : prudence sur les hypothèses");
    else if (computed.margePct > 0) insights.push("🔴 Marge faible (< 12%) : risque élevé");
    else insights.push("🔴 Marge négative : opération non viable en l'état");
    if (surfaceVendableM2 > 0 && surfaceVendableM2 < 150) insights.push("📏 Petite opération (< 150 m² vendable) : frais fixes proportionnellement élevés");
    if (computed.coutRevientEurM2Hab > 0 && ass.salePriceEurM2Hab > 0) {
      const ratio = computed.coutRevientEurM2Hab / ass.salePriceEurM2Hab;
      if (ratio > 0.7) insights.push("⚠️ Risque de compression de marge : coût de revient élevé vs prix");
    }
    if (ass.landPriceEur <= 0) insights.push("📋 Foncier non renseigné : bilan incomplet");
    if (footprintBuildingsM2 <= 0) insights.push("🏗️ Aucun bâtiment dessiné : surfaces à 0");
    return insights;
  }, [computed, surfaceVendableM2, ass.salePriceEurM2Hab, ass.landPriceEur, footprintBuildingsM2]);

  const sensitivity = useMemo(() => {
    const assA: Assumptions = { ...ass, worksCostEurM2Sdp: ass.worksCostEurM2Sdp * 1.05 };
    const pfA = computeProForma(assA, sdpEstimatedM2, surfaceVendableM2);
    const assB: Assumptions = { ...ass, salePriceEurM2Hab: ass.salePriceEurM2Hab * 0.95 };
    const pfB = computeProForma(assB, sdpEstimatedM2, surfaceVendableM2);
    return {
      base: { marge: computed.marge, margePct: computed.margePct },
      scenarioA: { label: "+5% coût travaux", marge: pfA.marge, margePct: pfA.margePct, deltaMarge: pfA.marge - computed.marge, deltaPct: pfA.margePct - computed.margePct },
      scenarioB: { label: "-5% prix de vente", marge: pfB.marge, margePct: pfB.margePct, deltaMarge: pfB.marge - computed.marge, deltaPct: pfB.margePct - computed.margePct },
    };
  }, [ass, sdpEstimatedM2, surfaceVendableM2, computed.marge, computed.margePct]);

  useEffect(() => {
    try {
      const ok = surfaceVendableM2 > 0 && computed.caTotal > 0;
      patchModule("bilan", {
        ok,
        marge_pct: computed.margePct,
        tri_pct: undefined,
        ca: computed.caTotal,
        summary: `Marge ${computed.margePct.toFixed(1)}% · CA ${Math.round(computed.caTotal).toLocaleString("fr-FR")}€ · Coût ${Math.round(computed.coutTotal).toLocaleString("fr-FR")}€ · Vendable ${Math.round(surfaceVendableM2)} m²`,
        data: {
          assumptions: ass,
          kpis: { caTotal: computed.caTotal, coutTotal: computed.coutTotal, marge: computed.marge, margePct: computed.margePct, coutRevientEurM2Hab: computed.coutRevientEurM2Hab, coutRevientEurM2Sdp: computed.coutRevientEurM2Sdp },
          surfaces: { footprintBuildingsM2, footprintParkingsM2, sdpEstimatedM2, habitableEstimatedM2, surfaceVendableM2 },
          params: { buildingKind, floorsSpec, nbLogements, levelsCount, totalHeightM },
          lines: computed.lines,
          notes: computed.notes,
          sensitivity,
        },
      });

      if (studyId && surfaceVendableM2 > 0 && computed.caTotal > 0) {
        const bilanPayload: PromoteurBilanData = {
          prix_revient_total:   computed.coutTotal,
          ca_previsionnel:      computed.caTotal,
          marge_nette:          computed.marge,
          taux_marge_nette_pct: computed.margePct,
          fonds_propres:        null,
          credit_promotion:     null,
          taux_credit_pct:      ass.financingRatePct,
          duree_mois:           null,
          roi_pct:              null,
          tri_pct:              null,
          ai_narrative:         null,
          ai_generated_at:      null,
          notes:                computed.notes.join(" | ") || null,
          done:                 true,
        };
        patchBilan(bilanPayload).catch((e) =>
          console.warn("[BilanPromoteurPage] patchBilan failed:", e)
        );
      }
    } catch (err) {
      console.warn("[BilanPromoteurPage] Erreur persistance snapshot:", err);
    }
  }, [
    computed, ass, surfaceVendableM2, footprintBuildingsM2, footprintParkingsM2,
    sdpEstimatedM2, habitableEstimatedM2, buildingKind, floorsSpec, nbLogements,
    levelsCount, totalHeightM, sensitivity, studyId, patchBilan,
  ]);

  const grouped = useMemo(() => {
    const map = new Map<string, Line[]>();
    for (const l of computed.lines) {
      if (!map.has(l.section)) map.set(l.section, []);
      map.get(l.section)!.push(l);
    }
    return map;
  }, [computed.lines]);

  const scrollToStressTest = () => {
    document.getElementById("stress-test")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleExportExcel = async () => {
    try {
      const XLSX = await import("xlsx");
      const now = new Date();
      const pad = (num: number) => num.toString().padStart(2, "0");
      const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
      const filename = `bilan-promoteur-${dateStr}.xlsx`;
      const wb = XLSX.utils.book_new();

      const syntheseData = [
        { KPI: "CA total", Valeur: computed.caTotal },
        { KPI: "Coût total", Valeur: computed.coutTotal },
        { KPI: "Marge brute", Valeur: computed.marge },
        { KPI: "Taux marge (%)", Valeur: computed.margePct },
        { KPI: "Coût revient (€/m² vend.)", Valeur: computed.coutRevientEurM2Hab },
        { KPI: "Coût revient (€/m² SDP)", Valeur: computed.coutRevientEurM2Sdp },
        { KPI: "Empreinte bâtiments (m²)", Valeur: footprintBuildingsM2 },
        { KPI: "Empreinte parkings (m²)", Valeur: footprintParkingsM2 },
        { KPI: "SDP estimée (m²)", Valeur: sdpEstimatedM2 },
        { KPI: "Habitable estimée (m²)", Valeur: habitableEstimatedM2 },
        { KPI: "Vendable estimée (m²)", Valeur: surfaceVendableM2 },
        { KPI: "Nb logements", Valeur: nbLogements },
        { KPI: "Type bâtiment", Valeur: buildingKind },
        { KPI: "Niveaux (R+N)", Valeur: floorsSpec.aboveGroundFloors },
        { KPI: "Hauteur totale (m)", Valeur: totalHeightM },
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(syntheseData), "Synthese");

      const hypothesesData = [
        { Cle: "Prix vente (€/m² vend.)", Valeur: ass.salePriceEurM2Hab },
        { Cle: "Commercialisation (%)", Valeur: ass.commercialisationPct },
        { Cle: "Coef vendable", Valeur: ass.coefVendable },
        { Cle: "Foncier (€)", Valeur: ass.landPriceEur },
        { Cle: "Notaire (%)", Valeur: ass.notaryFeesPct },
        { Cle: "Taxes acquisition (%)", Valeur: ass.acquisitionTaxesPct },
        { Cle: "Travaux (€/m² SDP)", Valeur: ass.worksCostEurM2Sdp },
        { Cle: "VRD (%)", Valeur: ass.vrdPct },
        { Cle: "Ext. (%)", Valeur: ass.extPct },
        { Cle: "Aléas (%)", Valeur: ass.contingencyPct },
        { Cle: "Géomètre (€)", Valeur: ass.surveyorEur },
        { Cle: "Géotechnique (€)", Valeur: ass.geotechEur },
        { Cle: "MOE (%)", Valeur: ass.moePct },
        { Cle: "BET (%)", Valeur: ass.betPct },
        { Cle: "SPS/CT/OPC (€)", Valeur: ass.spsCtOpcEur },
        { Cle: "Assurance DO (%)", Valeur: ass.insuranceDoPct },
        { Cle: "Divers montage (€)", Valeur: ass.miscEur },
        { Cle: "Comm. (% CA)", Valeur: ass.marketingPctCa },
        { Cle: "Comm. forfait (€)", Valeur: ass.marketingFixedEur },
        { Cle: "Taux financement (%)", Valeur: ass.financingRatePct },
        { Cle: "Frais dossier (€)", Valeur: ass.financingFeesEur },
        { Cle: "Taxe aménag. (€/m² SDP)", Valeur: ass.taxeAmenagementEurM2Sdp },
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hypothesesData), "Hypotheses");

      const bilanData = computed.lines.map((l) => ({ Section: l.section, Libelle: l.label, Indication: l.hint ?? "", MontantEUR: l.valueEur }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bilanData), "BilanDetaille");

      XLSX.writeFile(wb, filename);
    } catch (error) {
      console.error("Export Excel error:", error);
      window.alert("Export Excel impossible");
    }
  };

  // ─── Helpers visuels ─────────────────────────────────────────────────────
  const isEmpty = footprintBuildingsM2 <= 0;
  const margeColor = computed.marge >= 0 ? "#16a34a" : "#dc2626";
  const margePctColor = computed.margePct >= 15 ? "#16a34a" : computed.margePct >= 8 ? "#ea580c" : "#dc2626";

  // ── KPI card ─────────────────────────────────────────────────────────────
  const kpiCard: React.CSSProperties = {
    background: "white",
    borderRadius: 14,
    padding: "14px 16px 16px",
    border: "1px solid #e8edf4",
    boxShadow: "0 2px 8px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.04)",
    borderTop: `3px solid ${ACCENT_PRO}`,
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  };

  const kpiLabel: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: 4,
  };

  const kpiSub: React.CSSProperties = {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 4,
    lineHeight: 1.4,
  };

  const card: React.CSSProperties = {
    background: "white",
    borderRadius: 16,
    padding: 16,
    border: "1px solid #e8edf4",
    boxShadow: "0 2px 8px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.04)",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    color: "#0f172a",
    marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #cbd5e1",
    background: "white",
    color: "#0f172a",
    fontSize: 13,
    boxSizing: "border-box",
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 900,
    color: "#64748b",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };

  const updateAss = <K extends keyof Assumptions>(key: K, value: Assumptions[K]) => {
    setAss((s) => ({ ...s, [key]: value }));
  };

  const hasStoreData = buildings && buildings.features && buildings.features.length > 0;

  // ── studyData pour PromoteurSynthesePage ─────────────────────────────────
  const synthesisPropData = useMemo(() => ({
    foncier: {
      adresse:           study?.foncier?.adresse_complete ?? undefined,
      commune:           study?.foncier?.commune ?? undefined,
      codePostal:        study?.foncier?.code_postal ?? undefined,
      departement:       study?.foncier?.departement ?? undefined,
      surfaceTerrain:    study?.foncier?.surface_m2 ?? undefined,
      prixAcquisition:   ass.landPriceEur > 0 ? ass.landPriceEur : undefined,
      fraisNotaire:      computed.fraisNotaire > 0 ? computed.fraisNotaire : undefined,
      pollutionDetectee: false,
    },
    plu: {
      zone:        study?.plu?.zone_plu ?? undefined,
      cub:         study?.plu?.cos ?? undefined,
      hauteurMax:  study?.plu?.hauteur_max ?? undefined,
      pleineTerre: study?.plu?.pleine_terre_pct ?? undefined,
    },
    conception: {
      surfacePlancher: sdpEstimatedM2 > 0 ? sdpEstimatedM2 : undefined,
      nbLogements:     nbLogements > 0 ? nbLogements : undefined,
      nbNiveaux:       levelsCount > 0 ? levelsCount : undefined,
      hauteurProjet:   totalHeightM > 0 ? totalHeightM : undefined,
      empriseBatie:    footprintBuildingsM2 > 0 ? footprintBuildingsM2 : undefined,
      programmeType:   buildingKind === "COLLECTIF"
        ? "Résidentiel collectif libre"
        : "Résidentiel individuel",
    },
    marche: {
      prixNeufM2:          study?.marche?.prix_m2_neuf ?? ass.salePriceEurM2Hab,
      prixAncienM2:        study?.marche?.prix_m2_ancien ?? undefined,
      nbTransactionsDvf:   study?.marche?.nb_transactions ?? undefined,
      prixMoyenDvf:        study?.marche?.prix_moyen_dvf ?? undefined,
      offreConcurrente:    study?.marche?.nb_programmes_concurrents ?? undefined,
      absorptionMensuelle: study?.marche?.absorption_mensuelle ?? undefined,
    },
    risques: {
      risquesIdentifies: [] as [],
      zonageRisque: study?.risques?.zonage_risque ?? undefined,
    },
    evaluation: {
      prixVenteM2:       ass.salePriceEurM2Hab > 0 ? ass.salePriceEurM2Hab : undefined,
      prixVenteTotal:    computed.caTotal > 0 ? computed.caTotal : undefined,
      nbLogementsLibres: nbLogements > 0 ? nbLogements : undefined,
    },
    bilan: {
      coutFoncier:            computed.totalFoncier > 0 ? computed.totalFoncier : undefined,
      coutTravaux:            computed.totalTravaux > 0 ? computed.totalTravaux : undefined,
      coutTravauxM2:          ass.worksCostEurM2Sdp > 0 ? ass.worksCostEurM2Sdp : undefined,
      fraisFinanciers:        computed.totalFin > 0 ? computed.totalFin : undefined,
      fraisCommercialisation: computed.totalCom > 0 ? computed.totalCom : undefined,
      fraisGestion:           computed.totalEtudes > 0 ? computed.totalEtudes : undefined,
      chiffreAffaires:        computed.caTotal > 0 ? computed.caTotal : undefined,
      margeNette:             computed.marge,
      margeNettePercent:      computed.margePct,
      trnRendement:           computed.caTotal > 0
        ? (computed.marge / computed.coutTotal) * 100
        : 0,
      fondsPropres:    undefined,
      creditPromoteur: undefined,
    },
  }), [
    study, ass, computed, sdpEstimatedM2, nbLogements, levelsCount,
    totalHeightM, footprintBuildingsM2, buildingKind,
  ]);

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 45%, #eef2ff 100%)",
        minHeight: "100vh",
        padding: 24,
        color: "#0f172a",
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>

        {/* ── Bannière dégradé Promoteur › Bilan ── */}
        <div style={{
          background: GRAD_PRO,
          borderRadius: 14,
          padding: "20px 24px",
          marginBottom: 16,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>
              Promoteur › Bilan
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>
              Bilan Promoteur
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
              Pro forma détaillé — basé sur l'implantation 2D et des hypothèses ajustables.
            </div>

            {/* ── Onglets ── */}
            <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
              {([
                ["bilan", "📊 Bilan pro forma"],
                ["synthese", "📄 Synthèse & Export"],
              ] as const).map(([tab, tabLabel]) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "6px 16px",
                    borderRadius: 20,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                    transition: "all 0.15s",
                    background: activeTab === tab ? "white" : "rgba(255,255,255,0.18)",
                    color: activeTab === tab ? ACCENT_PRO : "rgba(255,255,255,0.85)",
                    boxShadow: activeTab === tab ? "0 2px 8px rgba(0,0,0,0.15)" : "none",
                  }}
                >
                  {tabLabel}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, marginTop: 4 }}>
            {study?.foncier?.commune_insee && (
              <div style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.85)",
                background: "rgba(255,255,255,0.15)",
                borderRadius: 8,
                padding: "6px 12px",
                fontWeight: 600,
              }}>
                INSEE {study.foncier.commune_insee}
              </div>
            )}
            {activeTab === "bilan" && (
              <button
                onClick={handleExportExcel}
                style={{
                  padding: "9px 18px",
                  borderRadius: 10,
                  border: "none",
                  background: "white",
                  color: ACCENT_PRO,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Exporter Excel
              </button>
            )}
          </div>
        </div>

        {/* ── Contenu conditionnel par onglet ── */}
        {activeTab === "synthese" ? (
          <PromoteurSynthesePage studyData={synthesisPropData} />
        ) : (
          <>
            {/* ── Bandeau avertissement : aucun bâtiment dessiné ── */}
            {isEmpty && (
              <div style={{
                marginBottom: 16,
                padding: "12px 18px",
                background: "#fffbeb",
                border: "1px solid #fde68a",
                borderLeft: "4px solid #f59e0b",
                borderRadius: 12,
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                fontSize: 13,
                color: "#78350f",
              }}>
                <span style={{ fontSize: 16, marginTop: 1, flexShrink: 0 }}>⚠️</span>
                <div style={{ lineHeight: 1.55 }}>
                  <strong>Aucun bâtiment dessiné</strong> — le coût de{" "}
                  {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(computed.coutTotal)}{" "}
                  affiché correspond uniquement aux <strong>forfaits fixes</strong> (géomètre, géotechnique, SPS/CT/OPC, divers, frais dossier).
                  Le CA et la marge seront calculés une fois les bâtiments dessinés en <strong>Implantation 2D</strong>.
                </div>
              </div>
            )}

            {/* ── KPIs row 1 ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 10 }}>

              <div style={kpiCard}>
                <div style={kpiLabel}>CA total</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: isEmpty ? "#94a3b8" : "#0f172a" }}>
                  {eur(computed.caTotal)}
                </div>
                <div style={kpiSub}>Vendable × Prix × Comm.</div>
              </div>

              <div style={kpiCard}>
                <div style={kpiLabel}>Coût total</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>
                  {eur(computed.coutTotal)}
                </div>
                <div style={kpiSub}>Foncier + Études + Travaux…</div>
              </div>

              <div style={kpiCard}>
                <div style={kpiLabel}>Marge brute</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: isEmpty ? "#94a3b8" : margeColor }}>
                  {eur(computed.marge)}
                </div>
                <div style={kpiSub}>{computed.margePct.toFixed(1)}% du CA</div>
              </div>

              <div style={kpiCard}>
                <div style={kpiLabel}>Coût revient</div>
                <div style={{ fontSize: 17, fontWeight: 900, color: isEmpty ? "#94a3b8" : "#0f172a", lineHeight: 1.2 }}>
                  {Math.round(computed.coutRevientEurM2Hab)} €/m² vend.
                </div>
                <div style={kpiSub}>{Math.round(computed.coutRevientEurM2Sdp)} €/m² SDP</div>
              </div>

              <div style={kpiCard}>
                <div style={kpiLabel}>Taux marge</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: isEmpty ? "#94a3b8" : margePctColor }}>
                  {computed.margePct.toFixed(1)} %
                </div>
                <div style={kpiSub}>Marge / CA</div>
              </div>

              <div style={kpiCard}>
                <div style={kpiLabel}>📉 Stress test</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 2 }}>
                  <div style={{ background: "#f8fafc", borderRadius: 8, padding: "6px 8px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", marginBottom: 2 }}>+5% travaux</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: sensitivity.scenarioA.marge >= 0 ? "#166534" : "#991b1b" }}>
                        {eur(sensitivity.scenarioA.marge)}
                      </span>
                      <span style={{ fontSize: 10, color: sensitivity.scenarioA.deltaPct < 0 ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
                        {sensitivity.scenarioA.deltaPct >= 0 ? "+" : ""}{sensitivity.scenarioA.deltaPct.toFixed(1)} pts
                      </span>
                    </div>
                  </div>
                  <div style={{ background: "#f8fafc", borderRadius: 8, padding: "6px 8px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", marginBottom: 2 }}>−5% prix vente</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: sensitivity.scenarioB.marge >= 0 ? "#166534" : "#991b1b" }}>
                        {eur(sensitivity.scenarioB.marge)}
                      </span>
                      <span style={{ fontSize: 10, color: sensitivity.scenarioB.deltaPct < 0 ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
                        {sensitivity.scenarioB.deltaPct >= 0 ? "+" : ""}{sensitivity.scenarioB.deltaPct.toFixed(1)} pts
                      </span>
                    </div>
                  </div>
                </div>
                <div
                  onClick={scrollToStressTest}
                  style={{ fontSize: 11, color: ACCENT_PRO, marginTop: 6, textDecoration: "underline", cursor: "pointer" }}
                >
                  Voir le détail ↓
                </div>
              </div>
            </div>

            {/* ── KPIs row 2 — Par logement ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
              <div style={kpiCard}>
                <div style={kpiLabel}>Prix moyen / logement</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: isEmpty ? "#94a3b8" : "#0f172a" }}>
                  {eur(computed.prixParLogement)}
                </div>
                <div style={kpiSub}>CA ÷ {nbLogements} logement{nbLogements > 1 ? "s" : ""}</div>
              </div>
              <div style={kpiCard}>
                <div style={kpiLabel}>Coût / logement</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a" }}>
                  {eur(computed.coutParLogement)}
                </div>
                <div style={kpiSub}>Coût total ÷ {nbLogements} logement{nbLogements > 1 ? "s" : ""}</div>
              </div>
              <div style={kpiCard}>
                <div style={kpiLabel}>Marge / logement</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: isEmpty ? "#94a3b8" : (computed.margeParLogement >= 0 ? "#16a34a" : "#dc2626") }}>
                  {eur(computed.margeParLogement)}
                </div>
                <div style={kpiSub}>Marge ÷ {nbLogements} logement{nbLogements > 1 ? "s" : ""}</div>
              </div>
            </div>

            {/* ── Lecture Promoteur ── */}
            <div style={{
              ...card,
              marginBottom: 12,
              borderLeft: `4px solid ${ACCENT_PRO}`,
              background: "linear-gradient(135deg, #fafafe, #f4f3ff)",
            }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, color: ACCENT_PRO, display: "flex", alignItems: "center", gap: 6 }}>
                <span>📊</span> Lecture promoteur
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "#334155", lineHeight: 1.75 }}>
                {lecturePromoteur.map((insight, i) => (
                  <li key={i}>{insight}</li>
                ))}
              </ul>
            </div>

            {/* ── Sensibilité (Stress test) ── */}
            <div id="stress-test" style={{ ...card, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                <span>📉</span> Sensibilité — Stress test
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ background: "#fffbeb", borderRadius: 12, padding: "14px 16px", border: "1px solid #fcd34d" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#92400e", marginBottom: 10 }}>
                    {sensitivity.scenarioA.label}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#78350f" }}>Marge</span>
                      <strong style={{ color: sensitivity.scenarioA.marge >= 0 ? "#166534" : "#991b1b" }}>{eur(sensitivity.scenarioA.marge)}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#78350f" }}>Taux marge</span>
                      <strong>{sensitivity.scenarioA.margePct.toFixed(1)} %</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #fde68a", paddingTop: 8 }}>
                      <span style={{ color: "#78350f", fontSize: 12 }}>Delta vs base</span>
                      <strong style={{ color: sensitivity.scenarioA.deltaMarge < 0 ? "#dc2626" : "#16a34a", fontSize: 12 }}>
                        {sensitivity.scenarioA.deltaMarge >= 0 ? "+" : ""}{eur(sensitivity.scenarioA.deltaMarge)}{" "}
                        ({sensitivity.scenarioA.deltaPct >= 0 ? "+" : ""}{sensitivity.scenarioA.deltaPct.toFixed(1)} pts)
                      </strong>
                    </div>
                  </div>
                </div>
                <div style={{ background: "#fff1f2", borderRadius: 12, padding: "14px 16px", border: "1px solid #fecaca" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#991b1b", marginBottom: 10 }}>
                    {sensitivity.scenarioB.label}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#7f1d1d" }}>Marge</span>
                      <strong style={{ color: sensitivity.scenarioB.marge >= 0 ? "#166534" : "#991b1b" }}>{eur(sensitivity.scenarioB.marge)}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#7f1d1d" }}>Taux marge</span>
                      <strong>{sensitivity.scenarioB.margePct.toFixed(1)} %</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #fecaca", paddingTop: 8 }}>
                      <span style={{ color: "#7f1d1d", fontSize: 12 }}>Delta vs base</span>
                      <strong style={{ color: sensitivity.scenarioB.deltaMarge < 0 ? "#dc2626" : "#16a34a", fontSize: 12 }}>
                        {sensitivity.scenarioB.deltaMarge >= 0 ? "+" : ""}{eur(sensitivity.scenarioB.deltaMarge)}{" "}
                        ({sensitivity.scenarioB.deltaPct >= 0 ? "+" : ""}{sensitivity.scenarioB.deltaPct.toFixed(1)} pts)
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: "#94a3b8" }}>
                Ces scénarios évaluent la résilience de l'opération face aux aléas du marché.
              </div>
            </div>

            {/* ── Sources implantation ── */}
            <div style={{ ...card, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#64748b" }}>📐</span> Données sources — Implantation 2D
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
                {[
                  { label: "Empreinte bâtiments", value: m2(footprintBuildingsM2), highlight: footprintBuildingsM2 > 0 },
                  { label: "Empreinte parkings",  value: m2(footprintParkingsM2),  highlight: false },
                  { label: "Niveaux",             value: `R+${floorsSpec.aboveGroundFloors} (${levelsCount} niv.)`, highlight: false },
                  { label: "SDP estimée",         value: m2(sdpEstimatedM2),        highlight: sdpEstimatedM2 > 0 },
                  { label: "Habitable estimée",   value: m2(habitableEstimatedM2),  highlight: habitableEstimatedM2 > 0 },
                  { label: "Vendable estimée",    value: m2(surfaceVendableM2),     highlight: true },
                ].map((item, i) => (
                  <div key={i} style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 12px", border: "1px solid #e8edf4" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: item.highlight ? ACCENT_PRO : (isEmpty ? "#94a3b8" : "#0f172a") }}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: hasStoreData ? "#16a34a" : "#f59e0b", fontWeight: 600 }}>
                {hasStoreData
                  ? `✓ Données récupérées depuis Implantation 2D (${nbLogements} logements, type ${buildingKind})`
                  : "⚠️ Aucun bâtiment dans le store — retournez sur Implantation 2D."}
              </div>
            </div>

            {/* ── Paramètres projet + Hypothèses ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Paramètres projet</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={labelStyle}>Type bâtiment</div>
                    <select style={inputStyle} value={buildingKind} onChange={(e) => setBuildingKind(e.target.value as BuildingKind)}>
                      <option value="COLLECTIF">Collectif</option>
                      <option value="INDIVIDUEL">Individuel</option>
                    </select>
                  </div>
                  <div>
                    <div style={labelStyle}>Étages (R+N)</div>
                    <input style={inputStyle} type="number" min={0} max={40} value={floorsSpec.aboveGroundFloors} onChange={(e) => setFloorsSpec((f) => ({ ...f, aboveGroundFloors: Math.max(0, Number(e.target.value) || 0) }))} />
                  </div>
                  <div>
                    <div style={labelStyle}>Hauteur RDC (m)</div>
                    <input style={inputStyle} type="number" step="0.1" value={floorsSpec.groundFloorHeightM} onChange={(e) => setFloorsSpec((f) => ({ ...f, groundFloorHeightM: Number(e.target.value) || 2.8 }))} />
                  </div>
                  <div>
                    <div style={labelStyle}>Hauteur étage (m)</div>
                    <input style={inputStyle} type="number" step="0.1" value={floorsSpec.typicalFloorHeightM} onChange={(e) => setFloorsSpec((f) => ({ ...f, typicalFloorHeightM: Number(e.target.value) || 2.7 }))} />
                  </div>
                  <div>
                    <div style={labelStyle}>Nb logements</div>
                    <input style={inputStyle} type="number" min={1} max={500} value={nbLogements} onChange={(e) => setNbLogements(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} />
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>
                  Hauteur totale estimée : <b>{totalHeightM.toFixed(1)} m</b>
                </div>
              </div>

              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Hypothèses</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                  <div>
                    <div style={labelStyle}>Prix vente (€/m² vend.)</div>
                    <input style={inputStyle} type="number" value={ass.salePriceEurM2Hab} onChange={(e) => updateAss("salePriceEurM2Hab", Number(e.target.value) || 0)} />
                  </div>
                  <div>
                    <div style={labelStyle}>Commercialisation (%)</div>
                    <input style={inputStyle} type="number" value={ass.commercialisationPct} onChange={(e) => updateAss("commercialisationPct", pct(e.target.value, 100))} />
                  </div>
                  <div>
                    <div style={labelStyle}>Coef vendable</div>
                    <input style={inputStyle} type="number" step="0.01" min={0.8} max={1.2} value={ass.coefVendable} onChange={(e) => updateAss("coefVendable", Math.min(1.2, Math.max(0.8, Number(e.target.value) || 1)))} />
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>Vendable = Habitable × coef</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Foncier (€)</div>
                    <input style={inputStyle} type="number" value={ass.landPriceEur} onChange={(e) => updateAss("landPriceEur", Number(e.target.value) || 0)} />
                  </div>
                  <div>
                    <div style={labelStyle}>Notaire (%)</div>
                    <input style={inputStyle} type="number" value={ass.notaryFeesPct} onChange={(e) => updateAss("notaryFeesPct", pct(e.target.value, 7.5))} />
                  </div>
                  <div>
                    <div style={labelStyle}>Taxes acquisition (%)</div>
                    <input style={inputStyle} type="number" value={ass.acquisitionTaxesPct} onChange={(e) => updateAss("acquisitionTaxesPct", pct(e.target.value, 0))} />
                  </div>
                  <div>
                    <div style={labelStyle}>Travaux (€/m² SDP)</div>
                    <input style={inputStyle} type="number" value={ass.worksCostEurM2Sdp} onChange={(e) => updateAss("worksCostEurM2Sdp", Number(e.target.value) || 0)} />
                  </div>
                  <div>
                    <div style={labelStyle}>VRD (%)</div>
                    <input style={inputStyle} type="number" value={ass.vrdPct} onChange={(e) => updateAss("vrdPct", pct(e.target.value, 6))} />
                  </div>
                  <div>
                    <div style={labelStyle}>Ext. (%)</div>
                    <input style={inputStyle} type="number" value={ass.extPct} onChange={(e) => updateAss("extPct", pct(e.target.value, 3))} />
                  </div>
                  <div>
                    <div style={labelStyle}>Aléas (%)</div>
                    <input style={inputStyle} type="number" value={ass.contingencyPct} onChange={(e) => updateAss("contingencyPct", pct(e.target.value, 3))} />
                  </div>
                  <div>
                    <div style={labelStyle}>MOE (%)</div>
                    <input style={inputStyle} type="number" value={ass.moePct} onChange={(e) => updateAss("moePct", pct(e.target.value, 10))} />
                  </div>
                  <div>
                    <div style={labelStyle}>BET (%)</div>
                    <input style={inputStyle} type="number" value={ass.betPct} onChange={(e) => updateAss("betPct", pct(e.target.value, 3))} />
                  </div>
                  <div>
                    <div style={labelStyle}>DO (%)</div>
                    <input style={inputStyle} type="number" value={ass.insuranceDoPct} onChange={(e) => updateAss("insuranceDoPct", pct(e.target.value, 2))} />
                  </div>
                  <div>
                    <div style={labelStyle}>Comm. (% CA)</div>
                    <input style={inputStyle} type="number" value={ass.marketingPctCa} onChange={(e) => updateAss("marketingPctCa", pct(e.target.value, 2))} />
                  </div>
                  <div>
                    <div style={labelStyle}>Taux financement (%)</div>
                    <input style={inputStyle} type="number" value={ass.financingRatePct} onChange={(e) => updateAss("financingRatePct", pct(e.target.value, 4))} />
                  </div>
                  <div>
                    <div style={labelStyle}>Frais dossier (€)</div>
                    <input style={inputStyle} type="number" value={ass.financingFeesEur} onChange={(e) => updateAss("financingFeesEur", Number(e.target.value) || 0)} />
                  </div>
                  <div>
                    <div style={labelStyle}>Taxe aménag. (€/m² SDP)</div>
                    <input style={inputStyle} type="number" value={ass.taxeAmenagementEurM2Sdp} onChange={(e) => updateAss("taxeAmenagementEurM2Sdp", Number(e.target.value) || 0)} />
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: "#94a3b8" }}>
                  Hypothèses simplifiées (v2). TVA, phasage, annexes et cashflow seront ajoutés prochainement.
                </div>
              </div>
            </div>

            {/* ── Bilan détaillé ── */}
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Bilan détaillé</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {Array.from(grouped.entries()).map(([section, lines]) => (
                  <div key={section}>
                    <div style={{ ...sectionTitle, marginBottom: 6 }}>{section}</div>
                    <div style={{ border: "1px solid #e8edf4", borderRadius: 12, overflow: "hidden" }}>
                      {lines.map((l, idx) => {
                        const isSubtotal = l.kind === "subtotal";
                        const isTotal = l.kind === "total";
                        const isNegative = l.valueEur < 0;
                        return (
                          <div
                            key={idx}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 180px 160px",
                              gap: 12,
                              padding: "9px 14px",
                              borderTop: idx === 0 ? "none" : `1px solid ${isTotal ? "rgba(255,255,255,0.08)" : "#f1f5f9"}`,
                              background: isTotal ? "#1e293b" : isSubtotal ? "#f1f5f9" : "white",
                              color: isTotal ? "white" : isNegative ? "#dc2626" : "#0f172a",
                              fontWeight: isTotal ? 900 : isSubtotal ? 700 : 500,
                              alignItems: "center",
                              fontSize: 13,
                            }}
                          >
                            <div>{l.label}</div>
                            <div style={{ fontSize: 11, color: isTotal ? "rgba(255,255,255,0.5)" : "#94a3b8", textAlign: "right" }}>
                              {l.hint ?? ""}
                            </div>
                            <div style={{ textAlign: "right", fontWeight: isTotal || isSubtotal ? 900 : 600 }}>
                              {eur(l.valueEur)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Notes ── */}
            {computed.notes.length > 0 && (
              <div style={{ ...card, marginTop: 12, borderLeft: "4px solid #f59e0b", background: "#fffbeb" }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: "#92400e" }}>Notes</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#78350f", fontSize: 13, lineHeight: 1.7 }}>
                  {computed.notes.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
};

export default BilanPromoteurPage;