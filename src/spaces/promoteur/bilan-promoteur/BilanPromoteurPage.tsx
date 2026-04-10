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

const GRAD_PRO = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
const ACCENT_PRO = "#5247b8";

function n(v: unknown, fallback = 0): number { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function pct(v: unknown, fallback = 0): number { const x = n(v, fallback); if (x < 0) return 0; if (x > 100) return 100; return x; }
function eur(v: number): string { try { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v); } catch { return `${Math.round(v)} €`; } }
function m2(v: number): string { return `${Math.round(v)} m²`; }
function safeAreaM2(feat: Feature<Geometry> | null | undefined): number { if (!feat?.geometry) return 0; try { return turf.area(feat as turf.AllGeoJSON); } catch { return 0; } }
function sumAreas(fc?: FeatureCollection<Geometry> | null): number { if (!fc?.features || !Array.isArray(fc.features)) return 0; return fc.features.reduce((acc, f) => acc + safeAreaM2(f as Feature<Geometry>), 0); }

type BuildingKind = "INDIVIDUEL" | "COLLECTIF";
type FloorsSpec = { aboveGroundFloors: number; groundFloorHeightM: number; typicalFloorHeightM: number; };
type Assumptions = { salePriceEurM2Hab: number; commercialisationPct: number; coefVendable: number; landPriceEur: number; notaryFeesPct: number; acquisitionTaxesPct: number; worksCostEurM2Sdp: number; vrdPct: number; extPct: number; contingencyPct: number; surveyorEur: number; geotechEur: number; moePct: number; betPct: number; spsCtOpcEur: number; insuranceDoPct: number; miscEur: number; marketingPctCa: number; marketingFixedEur: number; financingRatePct: number; financingFeesEur: number; taxeAmenagementEurM2Sdp: number; };
type Line = { section: string; label: string; valueEur: number; kind?: "subtotal" | "total"; hint?: string; };

const COEF_SDP = 1.0;
const COEF_HABITABLE_COLLECTIF = 0.82;
const COEF_HABITABLE_INDIVIDUEL = 0.9;

const DEFAULT_ASSUMPTIONS: Assumptions = {
  salePriceEurM2Hab: 5200, commercialisationPct: 100, coefVendable: 1.0, landPriceEur: NaN,
  notaryFeesPct: 7.5, acquisitionTaxesPct: 0, worksCostEurM2Sdp: 1800, vrdPct: 6, extPct: 3,
  contingencyPct: 3, surveyorEur: 6000, geotechEur: 12000, moePct: 10, betPct: 3,
  spsCtOpcEur: 15000, insuranceDoPct: 2, miscEur: 8000, marketingPctCa: 2, marketingFixedEur: 0,
  financingRatePct: 4, financingFeesEur: 8000, taxeAmenagementEurM2Sdp: 80,
};

function computeProForma(ass: Assumptions, sdpEstimatedM2: number, surfaceVendableM2: number) {
  const caLogements = surfaceVendableM2 * n(ass.salePriceEurM2Hab, 0) * (pct(ass.commercialisationPct, 100) / 100);
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
  const coutTotal = totalFoncier + totalEtudes + totalTravaux + totalTaxes + totalCom + totalFin;
  const marge = caTotal - coutTotal;
  const margePct = caTotal > 0 ? (marge / caTotal) * 100 : 0;
  const coutRevientEurM2Hab = surfaceVendableM2 > 0 ? coutTotal / surfaceVendableM2 : 0;
  const coutRevientEurM2Sdp = sdpEstimatedM2 > 0 ? coutTotal / sdpEstimatedM2 : 0;
  return { caLogements, caTotal, foncier, fraisNotaire, taxesAcq, totalFoncier, travauxBase, surveyor, geotech, moe, bet, spsCtOpc, insuranceDo, misc, totalEtudes, vrd, ext, aleas, totalTravaux, taxeAmenagement, totalTaxes, marketingPct, marketingFixed, totalCom, intercalaires, fraisFin, totalFin, coutTotal, marge, margePct, coutRevientEurM2Hab, coutRevientEurM2Sdp };
}

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
  const [floorsSpec, setFloorsSpec] = useState<FloorsSpec>({ aboveGroundFloors: 1, groundFloorHeightM: 2.8, typicalFloorHeightM: 2.7 });
  const [nbLogements, setNbLogements] = useState<number>(1);
  const [ass, setAss] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [synthesisSaved, setSynthesisSaved] = useState(false);

  useEffect(() => {
    if (loadState !== "ready" || !study) return;
    if (study.evaluation?.cout_foncier) setAss((prev) => ({ ...prev, landPriceEur: study.evaluation!.cout_foncier! }));
    if (study.marche?.prix_m2_neuf) setAss((prev) => ({ ...prev, salePriceEurM2Hab: study.marche!.prix_m2_neuf! }));
  }, [loadState, study]);

  const levelsCount = useMemo(() => 1 + Math.max(0, Math.floor(n(floorsSpec.aboveGroundFloors, 0))), [floorsSpec.aboveGroundFloors]);
  const totalHeightM = useMemo(() => n(floorsSpec.groundFloorHeightM, 2.8) + Math.max(0, Math.floor(n(floorsSpec.aboveGroundFloors, 0))) * n(floorsSpec.typicalFloorHeightM, 2.7), [floorsSpec]);
  const coefHab = buildingKind === "INDIVIDUEL" ? COEF_HABITABLE_INDIVIDUEL : COEF_HABITABLE_COLLECTIF;
  const sdpEstimatedM2 = useMemo(() => footprintBuildingsM2 * levelsCount * COEF_SDP, [footprintBuildingsM2, levelsCount]);
  const habitableEstimatedM2 = useMemo(() => sdpEstimatedM2 * coefHab, [sdpEstimatedM2, coefHab]);
  const surfaceVendableM2 = useMemo(() => habitableEstimatedM2 * n(ass.coefVendable, 1), [habitableEstimatedM2, ass.coefVendable]);

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
    if (footprintBuildingsM2 <= 0) notes.push("Aucun bâtiment dessiné en Implantation 2D : SDP/Habitable = 0.");
    if (ass.salePriceEurM2Hab <= 0) notes.push("Prix de vente €/m² non renseigné : CA = 0.");
    if (!n(ass.landPriceEur, 0)) notes.push("Foncier non renseigné : le bilan est incomplet.");
    const safeNbLogements = nbLogements > 0 ? nbLogements : 1;
    return { ...pf, lines, notes, prixParLogement: pf.caTotal / safeNbLogements, coutParLogement: pf.coutTotal / safeNbLogements, margeParLogement: pf.marge / safeNbLogements };
  }, [ass, footprintBuildingsM2, sdpEstimatedM2, surfaceVendableM2, nbLogements]);

  const lecturePromoteur = useMemo(() => {
    const insights: string[] = [];
    if (computed.margePct >= 20) insights.push("✅ Marge confortable (≥ 20%)");
    else if (computed.margePct >= 12) insights.push("⚠️ Marge moyenne (12-20%) : prudence sur les hypothèses");
    else if (computed.margePct > 0) insights.push("🔴 Marge faible (< 12%) : risque élevé");
    else insights.push("🔴 Marge négative : opération non viable en l'état");
    if (surfaceVendableM2 > 0 && surfaceVendableM2 < 150) insights.push("📏 Petite opération (< 150 m² vendable) : frais fixes proportionnellement élevés");
    if (computed.coutRevientEurM2Hab > 0 && ass.salePriceEurM2Hab > 0 && computed.coutRevientEurM2Hab / ass.salePriceEurM2Hab > 0.7) insights.push("⚠️ Risque de compression de marge : coût de revient élevé vs prix");
    if (!n(ass.landPriceEur, 0)) insights.push("📋 Foncier non renseigné : bilan incomplet");
    if (footprintBuildingsM2 <= 0) insights.push("🏗️ Aucun bâtiment dessiné : surfaces à 0");
    return insights;
  }, [computed, surfaceVendableM2, ass.salePriceEurM2Hab, ass.landPriceEur, footprintBuildingsM2]);

  const sensitivity = useMemo(() => {
    const pfA = computeProForma({ ...ass, worksCostEurM2Sdp: ass.worksCostEurM2Sdp * 1.05 }, sdpEstimatedM2, surfaceVendableM2);
    const pfB = computeProForma({ ...ass, salePriceEurM2Hab: ass.salePriceEurM2Hab * 0.95 }, sdpEstimatedM2, surfaceVendableM2);
    return {
      base: { marge: computed.marge, margePct: computed.margePct },
      scenarioA: { label: "+5% coût travaux", marge: pfA.marge, margePct: pfA.margePct, deltaMarge: pfA.marge - computed.marge, deltaPct: pfA.margePct - computed.margePct },
      scenarioB: { label: "-5% prix de vente", marge: pfB.marge, margePct: pfB.margePct, deltaMarge: pfB.marge - computed.marge, deltaPct: pfB.margePct - computed.margePct },
    };
  }, [ass, sdpEstimatedM2, surfaceVendableM2, computed.marge, computed.margePct]);

  useEffect(() => {
    try {
      const ok = surfaceVendableM2 > 0 && computed.caTotal > 0;
      patchModule("bilan", { ok, marge_pct: computed.margePct, ca: computed.caTotal, summary: `Marge ${computed.margePct.toFixed(1)}% · CA ${Math.round(computed.caTotal).toLocaleString("fr-FR")}€ · Vendable ${Math.round(surfaceVendableM2)} m²`, data: { assumptions: ass, kpis: { caTotal: computed.caTotal, coutTotal: computed.coutTotal, marge: computed.marge, margePct: computed.margePct }, surfaces: { footprintBuildingsM2, footprintParkingsM2, sdpEstimatedM2, habitableEstimatedM2, surfaceVendableM2 }, params: { buildingKind, floorsSpec, nbLogements, levelsCount, totalHeightM }, lines: computed.lines, notes: computed.notes, sensitivity } });
      if (studyId && surfaceVendableM2 > 0 && computed.caTotal > 0) {
        patchBilan({ prix_revient_total: computed.coutTotal, ca_previsionnel: computed.caTotal, marge_nette: computed.marge, taux_marge_nette_pct: computed.margePct, fonds_propres: null, credit_promotion: null, taux_credit_pct: ass.financingRatePct, duree_mois: null, roi_pct: null, tri_pct: null, ai_narrative: null, ai_generated_at: null, notes: computed.notes.join(" | ") || null, done: true }).catch((e) => console.warn("[BilanPromoteurPage] patchBilan failed:", e));
      }
    } catch (err) { console.warn("[BilanPromoteurPage] Erreur persistance:", err); }
  }, [computed, ass, surfaceVendableM2, footprintBuildingsM2, footprintParkingsM2, sdpEstimatedM2, habitableEstimatedM2, buildingKind, floorsSpec, nbLogements, levelsCount, totalHeightM, sensitivity, studyId, patchBilan]);

  const grouped = useMemo(() => {
    const map = new Map<string, Line[]>();
    for (const l of computed.lines) { if (!map.has(l.section)) map.set(l.section, []); map.get(l.section)!.push(l); }
    return map;
  }, [computed.lines]);

  const scrollToStressTest = () => document.getElementById("stress-test")?.scrollIntoView({ behavior: "smooth", block: "start" });

  // ── Export Excel professionnel (ExcelJS avec couleurs) ────────────────────
  const handleExportExcel = async () => {
    try {
      const ExcelJS = await import("exceljs");
      const now = new Date();
      const pad = (x: number) => x.toString().padStart(2, "0");
      const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const communeName = study?.foncier?.commune ?? "Projet";
      const fmtE = (v: number) => (Number.isFinite(v) ? Math.round(v) : 0);
      const TVA = 0.20;

      const wb = new ExcelJS.Workbook();
      wb.creator = "Mimmoza";
      const ws = wb.addWorksheet("Bilan Détaillé");

      ws.columns = [
        { width: 2 }, { width: 42 }, { width: 14 }, { width: 10 },
        { width: 12 }, { width: 18 }, { width: 14 }, { width: 18 }, { width: 34 },
      ];

      type ExcelFill = ExcelJS.Fill;
      const solidFill = (hex: string): ExcelFill => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + hex } });
      const FMT_EUR = '# ##0 "€";(# ##0 "€");"-"';

      const styleCell = (cell: ExcelJS.Cell, opts: { bold?: boolean; color?: string; bg?: string; size?: number; italic?: boolean; align?: "left" | "center" | "right"; numFmt?: string }) => {
        cell.font = { name: "Arial", size: opts.size ?? 9, bold: opts.bold ?? false, italic: opts.italic ?? false, color: { argb: "FF" + (opts.color ?? "000000") } };
        if (opts.bg) cell.fill = solidFill(opts.bg);
        cell.alignment = { vertical: "middle", horizontal: opts.align ?? "left" };
        if (opts.numFmt) cell.numFmt = opts.numFmt;
      };

      const addSection = (title: string) => {
        ws.addRow([]);
        const r = ws.addRow(["", title]);
        r.height = 18;
        ws.mergeCells(`B${r.number}:I${r.number}`);
        styleCell(r.getCell("B"), { bold: true, color: "FFFFFF", bg: "5247B8", size: 10 });
        for (const col of ["C","D","E","F","G","H","I"]) r.getCell(col).fill = solidFill("5247B8");
      };

      const addDataLine = (label: string, qty: string, unit: string, taux: string, ht: number, tva: number, note = "", rowNum: number) => {
        const bg = rowNum % 2 === 0 ? "F8F7FE" : "FFFFFF";
        const r = ws.addRow(["", `  ${label}`, qty, unit, taux, fmtE(ht), fmtE(tva), fmtE(ht + tva), note]);
        r.height = 15;
        for (const [col, al] of [["B","left"],["C","center"],["D","center"],["E","center"],["F","right"],["G","right"],["H","right"],["I","left"]] as [string, "left"|"center"|"right"][]) {
          const c = r.getCell(col);
          styleCell(c, { bg, align: al });
          if (["F","G","H"].includes(col) && typeof c.value === "number") c.numFmt = FMT_EUR;
        }
      };

      const addSubtotal = (label: string, ht: number, tva: number) => {
        const r = ws.addRow(["", label, "", "", "", fmtE(ht), fmtE(tva), fmtE(ht + tva), ""]);
        r.height = 17;
        for (const col of ["B","C","D","E","F","G","H","I"]) {
          const c = r.getCell(col);
          styleCell(c, { bold: true, color: "5247B8", bg: "E8E4F7", align: ["F","G","H"].includes(col) ? "right" : "left" });
          if (["F","G","H"].includes(col) && typeof c.value === "number") c.numFmt = FMT_EUR;
          c.border = { bottom: { style: "medium", color: { argb: "FF5247B8" } } };
        }
      };

      const addTotalRow = (label: string, ht: number, tva: number, bg = "1E293B") => {
        ws.addRow([]);
        const r = ws.addRow(["", label, "", "", "", fmtE(ht), fmtE(tva), fmtE(ht + tva), ""]);
        r.height = 22;
        ws.mergeCells(`B${r.number}:E${r.number}`);
        for (const col of ["B","C","D","E","F","G","H","I"]) {
          const c = r.getCell(col);
          styleCell(c, { bold: true, color: "FFFFFF", bg, size: 11, align: ["F","G","H"].includes(col) ? "right" : "left" });
          if (["F","G","H"].includes(col) && typeof c.value === "number") c.numFmt = FMT_EUR;
        }
      };

      // En-tête
      const r1 = ws.addRow(["", "BILAN PROMOTEUR — PRO FORMA"]);
      r1.height = 30;
      ws.mergeCells("B1:I1");
      styleCell(r1.getCell("B"), { bold: true, color: "FFFFFF", bg: "2D2D6B", size: 14, align: "center" });
      for (const col of ["C","D","E","F","G","H","I"]) r1.getCell(col).fill = solidFill("2D2D6B");

      const r2 = ws.addRow(["", `Commune : ${communeName}   |   Date : ${new Date().toLocaleDateString("fr-FR")}   |   Mimmoza`]);
      r2.height = 16;
      ws.mergeCells("B2:I2");
      styleCell(r2.getCell("B"), { italic: true, color: "94A3B8", bg: "F4F3FF", align: "center", size: 9 });
      for (const col of ["C","D","E","F","G","H","I"]) r2.getCell(col).fill = solidFill("F4F3FF");

      ws.addRow([]);
      const rh = ws.addRow(["", "POSTE", "Qté / Surface", "Unité", "% / Taux", "Montant HT (€)", "TVA (€)", "Montant TTC (€)", "Notes"]);
      rh.height = 18;
      for (const [col, al] of [["B","left"],["C","center"],["D","center"],["E","center"],["F","right"],["G","right"],["H","right"],["I","left"]] as [string,"left"|"center"|"right"][]) {
        styleCell(rh.getCell(col), { bold: true, color: "FFFFFF", bg: "5247B8", align: al });
      }

      let li = 0;
      addSection("1. FONCIER");
      addDataLine("Terrain", m2(sdpEstimatedM2), "m² SDP", "", computed.foncier, 0, "Prix d'acquisition", ++li);
      addDataLine("Frais acte notaire", "", "", `${ass.notaryFeesPct.toFixed(1)}%`, computed.fraisNotaire, 0, "", ++li);
      addDataLine("Droits / taxes acquisition", "", "", `${ass.acquisitionTaxesPct.toFixed(1)}%`, computed.taxesAcq, 0, "", ++li);
      addDataLine("Géomètre", "", "forfait", "", computed.surveyor, computed.surveyor * TVA, "", ++li);
      addDataLine("Sondage sol / géotechnique", "", "forfait", "", computed.geotech, computed.geotech * TVA, "", ++li);
      addSubtotal("TOTAL FONCIER", computed.totalFoncier, (computed.surveyor + computed.geotech) * TVA);

      addSection("2. TAXES");
      addDataLine("Taxe d'aménagement (TA)", m2(sdpEstimatedM2), "m² SDP", `${ass.taxeAmenagementEurM2Sdp} €/m²`, computed.taxeAmenagement, 0, "", ++li);
      addSubtotal("TOTAL TAXES", computed.taxeAmenagement, 0);

      addSection("3. TRAVAUX");
      const tvaTrav = computed.totalTravaux * TVA;
      addDataLine("Travaux principaux", m2(sdpEstimatedM2), "m² SDP", `${ass.worksCostEurM2Sdp} €/m²`, computed.travauxBase, computed.travauxBase * TVA, "", ++li);
      addDataLine("VRD / raccordements", "", "", `${ass.vrdPct.toFixed(1)}%`, computed.vrd, computed.vrd * TVA, "", ++li);
      addDataLine("Aménagements extérieurs", "", "", `${ass.extPct.toFixed(1)}%`, computed.ext, computed.ext * TVA, "", ++li);
      addDataLine("Aléas / imprévus", "", "", `${ass.contingencyPct.toFixed(1)}%`, computed.aleas, computed.aleas * TVA, "", ++li);
      addSubtotal("TOTAL TRAVAUX", computed.totalTravaux, tvaTrav);

      addSection("4. HONORAIRES & MONTAGE");
      const tvaEtudes = (computed.moe + computed.bet + computed.spsCtOpc + computed.misc) * TVA;
      addDataLine("MOE / Architecte", "", "", `${ass.moePct.toFixed(1)}% coût bât.`, computed.moe, computed.moe * TVA, "", ++li);
      addDataLine("BET", "", "", `${ass.betPct.toFixed(1)}% coût bât.`, computed.bet, computed.bet * TVA, "", ++li);
      addDataLine("SPS / CT / OPC", "", "forfait", "", computed.spsCtOpc, computed.spsCtOpc * TVA, "", ++li);
      addDataLine("Assurance DO", "", "", `${ass.insuranceDoPct.toFixed(1)}% trav.TTC`, computed.insuranceDo, 0, "", ++li);
      addDataLine("Divers montage", "", "forfait", "", computed.misc, computed.misc * TVA, "", ++li);
      addSubtotal("TOTAL HONORAIRES", computed.totalEtudes, tvaEtudes);

      addSection("5. COMMERCIALISATION");
      const tvaCom = (computed.marketingPct + computed.marketingFixed) * TVA;
      addDataLine("Honoraires ventes (% CA)", "", "", `${ass.marketingPctCa.toFixed(1)}% CA HT`, computed.marketingPct, computed.marketingPct * TVA, "", ++li);
      addDataLine("Publicité / forfait", "", "", "", computed.marketingFixed, computed.marketingFixed * TVA, "", ++li);
      addSubtotal("TOTAL COMMERCIALISATION", computed.totalCom, tvaCom);

      addSection("6. FRAIS FINANCIERS");
      addDataLine("Intérêts intercalaires", "", "", `${ass.financingRatePct.toFixed(1)}%`, computed.intercalaires, 0, `${ass.financingRatePct.toFixed(1)}% × (foncier + 0.5×travaux)`, ++li);
      addDataLine("GFA / Garantie livraison", "", "", "", 0, 0, "", ++li);
      addDataLine("Frais dossier", "", "forfait", "", computed.fraisFin, 0, "", ++li);
      addSubtotal("TOTAL FRAIS FINANCIERS", computed.totalFin, 0);

      const tvaTotal = (computed.surveyor + computed.geotech) * TVA + tvaTrav + tvaEtudes + tvaCom;
      addTotalRow("💰  PRIX DE REVIENT TOTAL", computed.coutTotal, tvaTotal);

      addSection("RECETTES PRÉVISIONNELLES");
      addDataLine("Ventes logements", m2(surfaceVendableM2), "m² vend.", `${ass.salePriceEurM2Hab} €/m²`, computed.caTotal, computed.caTotal * 0.055 / 1.055, "TVA 5,5%", ++li);

      ws.addRow([]);
      const rCA = ws.addRow(["", "CA TOTAL TTC", "", "", "", fmtE(computed.caTotal), "", fmtE(computed.caTotal), ""]);
      rCA.height = 20;
      ws.mergeCells(`B${rCA.number}:E${rCA.number}`);
      for (const col of ["B","C","D","E","F","G","H","I"]) {
        const c = rCA.getCell(col);
        styleCell(c, { bold: true, color: "FFFFFF", bg: "166534", size: 10, align: ["F","G","H"].includes(col) ? "right" : "left" });
        if (["F","H"].includes(col) && typeof c.value === "number") c.numFmt = FMT_EUR;
      }

      ws.addRow([]);
      const rMarge = ws.addRow(["", "MARGE BRUTE  (CA − Prix de Revient TTC)", "", "", "", "", "", fmtE(computed.marge), ""]);
      rMarge.height = 24;
      ws.mergeCells(`B${rMarge.number}:G${rMarge.number}`);
      for (const col of ["B","C","D","E","F","G","H","I"]) {
        const c = rMarge.getCell(col);
        styleCell(c, { bold: true, color: "FFFFFF", bg: "4F46E5", size: 11, align: col === "H" ? "right" : "left" });
        if (col === "H" && typeof c.value === "number") c.numFmt = FMT_EUR;
      }

      const rTaux = ws.addRow(["", `Taux de marge : ${computed.margePct.toFixed(1)}%`, "", "", "", "", "", "", `Coût revient : ${Math.round(computed.coutRevientEurM2Hab)} €/m² vend.`]);
      rTaux.height = 16;
      ws.mergeCells(`B${rTaux.number}:G${rTaux.number}`);
      styleCell(rTaux.getCell("B"), { bold: true, color: "5247B8", bg: "EDE9FE", size: 10 });
      for (const col of ["C","D","E","F","G","H","I"]) rTaux.getCell(col).fill = solidFill("EDE9FE");

      ws.addRow([]);
      const rST = ws.addRow(["", "SENSIBILITÉ — STRESS TEST"]);
      rST.height = 17;
      ws.mergeCells(`B${rST.number}:I${rST.number}`);
      styleCell(rST.getCell("B"), { bold: true, color: "FFFFFF", bg: "5247B8", size: 10 });
      for (const col of ["C","D","E","F","G","H","I"]) rST.getCell(col).fill = solidFill("5247B8");

      const rSTH = ws.addRow(["", "Scénario", "Marge (€)", "Taux marge", "Delta marge (€)", "Delta (pts)"]);
      rSTH.height = 15;
      for (const col of ["B","C","D","E","F"]) styleCell(rSTH.getCell(col), { bold: true, color: "FFFFFF", bg: "334155", size: 9 });

      [
        ["Base", fmtE(sensitivity.base.marge), `${sensitivity.base.margePct.toFixed(1)}%`, "", ""],
        [sensitivity.scenarioA.label, fmtE(sensitivity.scenarioA.marge), `${sensitivity.scenarioA.margePct.toFixed(1)}%`, fmtE(sensitivity.scenarioA.deltaMarge), `${sensitivity.scenarioA.deltaPct.toFixed(1)} pts`],
        [sensitivity.scenarioB.label, fmtE(sensitivity.scenarioB.marge), `${sensitivity.scenarioB.margePct.toFixed(1)}%`, fmtE(sensitivity.scenarioB.deltaMarge), `${sensitivity.scenarioB.deltaPct.toFixed(1)} pts`],
      ].forEach((rowData, i) => {
        const r = ws.addRow(["", ...rowData]);
        r.height = 15;
        const bg = i % 2 === 0 ? "F8F7FE" : "FFFFFF";
        for (const col of ["B","C","D","E","F"]) styleCell(r.getCell(col), { bg, size: 9 });
      });

      // Feuille Hypothèses
      const ws2 = wb.addWorksheet("Hypothèses");
      ws2.columns = [{ width: 2 }, { width: 36 }, { width: 20 }];

      const addHypSection = (title: string) => {
        ws2.addRow([]);
        const r = ws2.addRow(["", title, ""]);
        r.height = 17;
        ws2.mergeCells(`B${r.number}:C${r.number}`);
        styleCell(r.getCell("B"), { bold: true, color: "FFFFFF", bg: "5247B8", size: 9 });
        r.getCell("C").fill = solidFill("5247B8");
      };

      let hIdx = 0;
      const addHypLine = (label: string, value: string | number) => {
        const bg = (++hIdx) % 2 === 0 ? "F8F7FE" : "FFFFFF";
        const r = ws2.addRow(["", label, value]);
        r.height = 15;
        styleCell(r.getCell("B"), { bg, size: 9 });
        styleCell(r.getCell("C"), { bold: true, color: "0000FF", bg: "FFFDE7", size: 9, align: "right" });
      };

      addHypSection("SURFACES & PROGRAMME");
      addHypLine("SDP estimée (m²)", fmtE(sdpEstimatedM2));
      addHypLine("Surface habitable estimée (m²)", fmtE(habitableEstimatedM2));
      addHypLine("Surface vendable estimée (m²)", fmtE(surfaceVendableM2));
      addHypLine("Nombre de logements", nbLogements);
      addHypLine("Type de bâtiment", buildingKind);
      addHypLine("Niveaux (R+N)", floorsSpec.aboveGroundFloors);
      addHypSection("PRIX DE VENTE");
      addHypLine("Prix vente €/m² vendable", ass.salePriceEurM2Hab);
      addHypLine("% commercialisation", `${ass.commercialisationPct}%`);
      addHypLine("Coefficient vendable", ass.coefVendable);
      addHypSection("FONCIER");
      addHypLine("Prix d'acquisition (€)", fmtE(n(ass.landPriceEur, 0)));
      addHypLine("Frais notaire (%)", `${ass.notaryFeesPct.toFixed(1)}%`);
      addHypLine("Taxe aménagement (€/m² SDP)", ass.taxeAmenagementEurM2Sdp);
      addHypSection("CONSTRUCTION");
      addHypLine("Travaux (€/m² SDP)", ass.worksCostEurM2Sdp);
      addHypLine("VRD (%)", `${ass.vrdPct.toFixed(1)}%`);
      addHypLine("Aménagements ext. (%)", `${ass.extPct.toFixed(1)}%`);
      addHypLine("Aléas (%)", `${ass.contingencyPct.toFixed(1)}%`);
      addHypSection("HONORAIRES");
      addHypLine("MOE + OPC (% coût bât.)", `${ass.moePct.toFixed(1)}%`);
      addHypLine("BET (%)", `${ass.betPct.toFixed(1)}%`);
      addHypLine("Assurance DO (%)", `${ass.insuranceDoPct.toFixed(1)}%`);
      addHypSection("FINANCEMENT");
      addHypLine("Taux de financement (%)", `${ass.financingRatePct.toFixed(1)}%`);
      addHypLine("Frais dossier (€)", ass.financingFeesEur);

      // Feuille KPIs
      const ws3 = wb.addWorksheet("KPIs Récap");
      ws3.columns = [{ width: 2 }, { width: 34 }, { width: 20 }];
      const rKH = ws3.addRow(["", "KPI", "Valeur"]);
      rKH.height = 17;
      for (const col of ["B","C"]) styleCell(rKH.getCell(col), { bold: true, color: "FFFFFF", bg: "5247B8", size: 9, align: col === "C" ? "right" : "left" });

      ([
        ["CA total (€)", fmtE(computed.caTotal)],
        ["Coût total (€)", fmtE(computed.coutTotal)],
        ["Marge brute (€)", fmtE(computed.marge)],
        ["Taux de marge (%)", `${computed.margePct.toFixed(1)}%`],
        ["Coût revient (€/m² vendable)", fmtE(computed.coutRevientEurM2Hab)],
        ["", ""],
        ["Vendable estimée (m²)", fmtE(surfaceVendableM2)],
        ["Nb logements", nbLogements],
        ["", ""],
        ["Prix moyen / logement (€)", fmtE(computed.prixParLogement)],
        ["Coût / logement (€)", fmtE(computed.coutParLogement)],
        ["Marge / logement (€)", fmtE(computed.margeParLogement)],
        ["", ""],
        ["Stress +5% travaux", `${sensitivity.scenarioA.margePct.toFixed(1)}% (${sensitivity.scenarioA.deltaPct.toFixed(1)} pts)`],
        ["Stress −5% prix vente", `${sensitivity.scenarioB.margePct.toFixed(1)}% (${sensitivity.scenarioB.deltaPct.toFixed(1)} pts)`],
      ] as [string, string | number][]).forEach(([label, value], i) => {
        const r = ws3.addRow(["", label, value]);
        r.height = 15;
        const bg = i % 2 === 0 ? "F8F7FE" : "FFFFFF";
        styleCell(r.getCell("B"), { bg, size: 9 });
        styleCell(r.getCell("C"), { bold: true, bg, size: 9, align: "right" });
      });

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bilan-promoteur-${communeName}-${dateStr}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);

    } catch (error) {
      console.error("Export Excel error:", error);
      window.alert("Export Excel impossible : " + String(error));
    }
  };

  const handleSaveForSynthesis = () => {
    patchModule("bilan", { ok: true, validated: true, marge_pct: computed.margePct, ca: computed.caTotal, summary: `Marge ${computed.margePct.toFixed(1)}% · CA ${eur(computed.caTotal)} · ${m2(surfaceVendableM2)} vendable`, data: { assumptions: ass, kpis: { caTotal: computed.caTotal, coutTotal: computed.coutTotal, marge: computed.marge, margePct: computed.margePct }, surfaces: { surfaceVendableM2, sdpEstimatedM2 }, notes: computed.notes, sensitivity } });
    setSynthesisSaved(true);
    setTimeout(() => setSynthesisSaved(false), 3000);
  };

  const isEmpty = footprintBuildingsM2 <= 0;
  const foncierVide = !n(ass.landPriceEur, 0);
  const margeColor = computed.marge >= 0 ? "#16a34a" : "#dc2626";
  const margePctColor = computed.margePct >= 15 ? "#16a34a" : computed.margePct >= 8 ? "#ea580c" : "#dc2626";
  const kpiCard: React.CSSProperties = { background: "white", borderRadius: 14, padding: "14px 16px 16px", border: "1px solid #e8edf4", boxShadow: "0 2px 8px rgba(15,23,42,0.05)", borderTop: `3px solid ${ACCENT_PRO}`, display: "flex", flexDirection: "column" as const, gap: 2 };
  const kpiLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 4 };
  const kpiSub: React.CSSProperties = { fontSize: 11, color: "#94a3b8", marginTop: 4, lineHeight: 1.4 };
  const card: React.CSSProperties = { background: "white", borderRadius: 16, padding: 16, border: "1px solid #e8edf4", boxShadow: "0 2px 8px rgba(15,23,42,0.05)" };
  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 6 };
  const inputStyle: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #cbd5e1", background: "white", color: "#0f172a", fontSize: 13, boxSizing: "border-box" as const };
  const sectionTitle: React.CSSProperties = { fontSize: 11, fontWeight: 900, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" as const };
  const updateAss = <K extends keyof Assumptions>(key: K, value: Assumptions[K]) => setAss((s) => ({ ...s, [key]: value }));
  const hasStoreData = buildings && buildings.features && buildings.features.length > 0;

  const synthesisPropData = useMemo(() => ({
    foncier: { adresse: study?.foncier?.adresse_complete ?? undefined, commune: study?.foncier?.commune ?? undefined, codePostal: study?.foncier?.code_postal ?? undefined, departement: study?.foncier?.departement ?? undefined, surfaceTerrain: study?.foncier?.surface_m2 ?? undefined, prixAcquisition: n(ass.landPriceEur, 0) > 0 ? n(ass.landPriceEur, 0) : undefined, fraisNotaire: computed.fraisNotaire > 0 ? computed.fraisNotaire : undefined, pollutionDetectee: false },
    plu: { zone: study?.plu?.zone_plu ?? undefined, cub: study?.plu?.cos ?? undefined, hauteurMax: study?.plu?.hauteur_max ?? undefined, pleineTerre: study?.plu?.pleine_terre_pct ?? undefined },
    conception: { surfacePlancher: sdpEstimatedM2 > 0 ? sdpEstimatedM2 : undefined, nbLogements: nbLogements > 0 ? nbLogements : undefined, nbNiveaux: levelsCount > 0 ? levelsCount : undefined, hauteurProjet: totalHeightM > 0 ? totalHeightM : undefined, empriseBatie: footprintBuildingsM2 > 0 ? footprintBuildingsM2 : undefined, programmeType: buildingKind === "COLLECTIF" ? "Résidentiel collectif libre" : "Résidentiel individuel" },
    marche: { prixNeufM2: study?.marche?.prix_m2_neuf ?? ass.salePriceEurM2Hab, prixAncienM2: study?.marche?.prix_m2_ancien ?? undefined, nbTransactionsDvf: study?.marche?.nb_transactions ?? undefined, prixMoyenDvf: study?.marche?.prix_moyen_dvf ?? undefined, offreConcurrente: study?.marche?.nb_programmes_concurrents ?? undefined, absorptionMensuelle: study?.marche?.absorption_mensuelle ?? undefined },
    risques: { risquesIdentifies: [] as [], zonageRisque: study?.risques?.zonage_risque ?? undefined },
    evaluation: { prixVenteM2: ass.salePriceEurM2Hab > 0 ? ass.salePriceEurM2Hab : undefined, prixVenteTotal: computed.caTotal > 0 ? computed.caTotal : undefined, nbLogementsLibres: nbLogements > 0 ? nbLogements : undefined },
    bilan: { coutFoncier: computed.totalFoncier > 0 ? computed.totalFoncier : undefined, coutTravaux: computed.totalTravaux > 0 ? computed.totalTravaux : undefined, coutTravauxM2: ass.worksCostEurM2Sdp > 0 ? ass.worksCostEurM2Sdp : undefined, fraisFinanciers: computed.totalFin > 0 ? computed.totalFin : undefined, fraisCommercialisation: computed.totalCom > 0 ? computed.totalCom : undefined, fraisGestion: computed.totalEtudes > 0 ? computed.totalEtudes : undefined, chiffreAffaires: computed.caTotal > 0 ? computed.caTotal : undefined, margeNette: computed.marge, margeNettePercent: computed.margePct, trnRendement: computed.caTotal > 0 ? (computed.marge / computed.coutTotal) * 100 : 0, fondsPropres: undefined, creditPromoteur: undefined },
  }), [study, ass, computed, sdpEstimatedM2, nbLogements, levelsCount, totalHeightM, footprintBuildingsM2, buildingKind]);

  return (
    <div style={{ background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 45%, #eef2ff 100%)", minHeight: "100vh", padding: 24, color: "#0f172a", fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>

        <div style={{ background: GRAD_PRO, borderRadius: 14, padding: "20px 24px", marginBottom: 16, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>Promoteur › Bilan</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>Bilan Promoteur</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>Pro forma détaillé — basé sur l'implantation 2D et des hypothèses ajustables.</div>
            <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
              {([["bilan", "📊 Bilan pro forma"], ["synthese", "📄 Synthèse & Export"]] as const).map(([tab, tabLabel]) => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: "6px 16px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, background: activeTab === tab ? "white" : "rgba(255,255,255,0.18)", color: activeTab === tab ? ACCENT_PRO : "rgba(255,255,255,0.85)", boxShadow: activeTab === tab ? "0 2px 8px rgba(0,0,0,0.15)" : "none" }}>
                  {tabLabel}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, marginTop: 4 }}>
            {study?.foncier?.commune_insee && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", background: "rgba(255,255,255,0.15)", borderRadius: 8, padding: "6px 12px", fontWeight: 600 }}>INSEE {study.foncier.commune_insee}</div>
            )}
            {activeTab === "bilan" && (
              <button onClick={handleSaveForSynthesis} style={{ padding: "9px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.4)", background: synthesisSaved ? "rgba(16,185,129,0.35)" : "rgba(255,255,255,0.15)", color: "white", fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                {synthesisSaved ? "✓ Enregistré" : "📌 Utiliser dans la synthèse"}
              </button>
            )}
            {activeTab === "bilan" && (
              <button onClick={handleExportExcel} style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: "white", color: ACCENT_PRO, fontWeight: 600, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Exporter Excel
              </button>
            )}
          </div>
        </div>

        {activeTab === "synthese" ? (
          <PromoteurSynthesePage studyData={synthesisPropData} />
        ) : (
          <>
            {isEmpty && (
              <div style={{ marginBottom: 16, padding: "12px 18px", background: "#fffbeb", border: "1px solid #fde68a", borderLeft: "4px solid #f59e0b", borderRadius: 12, display: "flex", alignItems: "flex-start", gap: 12, fontSize: 13, color: "#78350f" }}>
                <span style={{ fontSize: 16, marginTop: 1, flexShrink: 0 }}>⚠️</span>
                <div><strong>Aucun bâtiment dessiné</strong> — retournez sur <strong>Implantation 2D</strong> pour dessiner au moins un bâtiment.</div>
              </div>
            )}
            {foncierVide && (
              <div style={{ marginBottom: 16, padding: "12px 18px", background: "#fffbeb", border: "1px solid #fde68a", borderLeft: "4px solid #f59e0b", borderRadius: 12, display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: "#78350f" }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>🏠</span>
                <div><strong>Prix du foncier non renseigné</strong> — saisissez-le dans les Hypothèses (champ <em>Foncier €</em>) pour compléter le bilan.</div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 10 }}>
              <div style={kpiCard}><div style={kpiLabel}>CA total</div><div style={{ fontSize: 22, fontWeight: 900, color: isEmpty ? "#94a3b8" : "#0f172a" }}>{eur(computed.caTotal)}</div><div style={kpiSub}>Vendable × Prix × Comm.</div></div>
              <div style={kpiCard}><div style={kpiLabel}>Coût total</div><div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>{eur(computed.coutTotal)}</div><div style={kpiSub}>Foncier + Études + Travaux…</div></div>
              <div style={kpiCard}><div style={kpiLabel}>Marge brute</div><div style={{ fontSize: 22, fontWeight: 900, color: isEmpty ? "#94a3b8" : margeColor }}>{eur(computed.marge)}</div><div style={kpiSub}>{computed.margePct.toFixed(1)}% du CA</div></div>
              <div style={kpiCard}><div style={kpiLabel}>Coût revient</div><div style={{ fontSize: 17, fontWeight: 900, color: isEmpty ? "#94a3b8" : "#0f172a", lineHeight: 1.2 }}>{Math.round(computed.coutRevientEurM2Hab)} €/m² vend.</div><div style={kpiSub}>{Math.round(computed.coutRevientEurM2Sdp)} €/m² SDP</div></div>
              <div style={kpiCard}><div style={kpiLabel}>Taux marge</div><div style={{ fontSize: 22, fontWeight: 900, color: isEmpty ? "#94a3b8" : margePctColor }}>{computed.margePct.toFixed(1)} %</div><div style={kpiSub}>Marge / CA</div></div>
              <div style={kpiCard}>
                <div style={kpiLabel}>📉 Stress test</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 2 }}>
                  {[sensitivity.scenarioA, sensitivity.scenarioB].map((sc) => (
                    <div key={sc.label} style={{ background: "#f8fafc", borderRadius: 8, padding: "6px 8px" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", marginBottom: 2 }}>{sc.label}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
              {[
                { label: "Prix moyen / logement", value: eur(computed.prixParLogement), color: isEmpty ? "#94a3b8" : "#0f172a" },
                { label: "Coût / logement", value: eur(computed.coutParLogement), color: "#0f172a" },
                { label: "Marge / logement", value: eur(computed.margeParLogement), color: isEmpty ? "#94a3b8" : (computed.margeParLogement >= 0 ? "#16a34a" : "#dc2626") },
              ].map((k) => (
                <div key={k.label} style={kpiCard}><div style={kpiLabel}>{k.label}</div><div style={{ fontSize: 20, fontWeight: 900, color: k.color }}>{k.value}</div><div style={kpiSub}>÷ {nbLogements} logement{nbLogements > 1 ? "s" : ""}</div></div>
              ))}
            </div>

            <div style={{ ...card, marginBottom: 12, borderLeft: `4px solid ${ACCENT_PRO}`, background: "linear-gradient(135deg, #fafafe, #f4f3ff)" }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, color: ACCENT_PRO, display: "flex", alignItems: "center", gap: 6 }}><span>📊</span> Lecture promoteur</div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "#334155", lineHeight: 1.75 }}>
                {lecturePromoteur.map((insight, i) => <li key={i}>{insight}</li>)}
              </ul>
            </div>

            <div id="stress-test" style={{ ...card, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><span>📉</span> Sensibilité — Stress test</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[
                  { sc: sensitivity.scenarioA, bg: "#fffbeb", border: "#fcd34d", color: "#92400e", sep: "#fde68a" },
                  { sc: sensitivity.scenarioB, bg: "#fff1f2", border: "#fecaca", color: "#991b1b", sep: "#fecaca" },
                ].map(({ sc, bg, border, color, sep }) => (
                  <div key={sc.label} style={{ background: bg, borderRadius: 12, padding: "14px 16px", border: `1px solid ${border}` }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color, marginBottom: 10 }}>{sc.label}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color }}>Marge</span><strong style={{ color: sc.marge >= 0 ? "#166534" : "#991b1b" }}>{eur(sc.marge)}</strong></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color }}>Taux marge</span><strong>{sc.margePct.toFixed(1)} %</strong></div>
                      <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${sep}`, paddingTop: 8 }}>
                        <span style={{ color, fontSize: 12 }}>Delta vs base</span>
                        <strong style={{ color: sc.deltaMarge < 0 ? "#dc2626" : "#16a34a", fontSize: 12 }}>{sc.deltaMarge >= 0 ? "+" : ""}{eur(sc.deltaMarge)} ({sc.deltaPct >= 0 ? "+" : ""}{sc.deltaPct.toFixed(1)} pts)</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: "#94a3b8" }}>Ces scénarios évaluent la résilience de l'opération face aux aléas du marché.</div>
            </div>

            <div style={{ ...card, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: "#64748b" }}>📐</span> Données sources — Implantation 2D</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
                {[
                  { label: "Empreinte bâtiments", value: m2(footprintBuildingsM2), highlight: footprintBuildingsM2 > 0 },
                  { label: "Empreinte parkings", value: m2(footprintParkingsM2), highlight: false },
                  { label: "Niveaux", value: `R+${floorsSpec.aboveGroundFloors} (${levelsCount} niv.)`, highlight: false },
                  { label: "SDP estimée", value: m2(sdpEstimatedM2), highlight: sdpEstimatedM2 > 0 },
                  { label: "Habitable estimée", value: m2(habitableEstimatedM2), highlight: habitableEstimatedM2 > 0 },
                  { label: "Vendable estimée", value: m2(surfaceVendableM2), highlight: true },
                ].map((item, i) => (
                  <div key={i} style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 12px", border: "1px solid #e8edf4" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: item.highlight ? ACCENT_PRO : (isEmpty ? "#94a3b8" : "#0f172a") }}>{item.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: hasStoreData ? "#16a34a" : "#f59e0b", fontWeight: 600 }}>
                {hasStoreData ? `✓ Données récupérées depuis Implantation 2D (${nbLogements} logements, type ${buildingKind})` : "⚠️ Aucun bâtiment dans le store — retournez sur Implantation 2D."}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Paramètres projet</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[
                    { label: "Type bâtiment", node: <select style={inputStyle} value={buildingKind} onChange={(e) => setBuildingKind(e.target.value as BuildingKind)}><option value="COLLECTIF">Collectif</option><option value="INDIVIDUEL">Individuel</option></select> },
                    { label: "Étages (R+N)", node: <input style={inputStyle} type="number" min={0} max={40} value={floorsSpec.aboveGroundFloors} onChange={(e) => setFloorsSpec((f) => ({ ...f, aboveGroundFloors: Math.max(0, Number(e.target.value) || 0) }))} /> },
                    { label: "Hauteur RDC (m)", node: <input style={inputStyle} type="number" step="0.1" value={floorsSpec.groundFloorHeightM} onChange={(e) => setFloorsSpec((f) => ({ ...f, groundFloorHeightM: Number(e.target.value) || 2.8 }))} /> },
                    { label: "Hauteur étage (m)", node: <input style={inputStyle} type="number" step="0.1" value={floorsSpec.typicalFloorHeightM} onChange={(e) => setFloorsSpec((f) => ({ ...f, typicalFloorHeightM: Number(e.target.value) || 2.7 }))} /> },
                    { label: "Nb logements", node: <input style={inputStyle} type="number" min={1} max={500} value={nbLogements} onChange={(e) => setNbLogements(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} /> },
                  ].map(({ label, node }) => (
                    <div key={label}><div style={labelStyle}>{label}</div>{node}</div>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>Hauteur totale estimée : <b>{totalHeightM.toFixed(1)} m</b></div>
              </div>

              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Hypothèses</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                  <div><div style={labelStyle}>Prix vente (€/m² vend.)</div><input style={inputStyle} type="number" value={ass.salePriceEurM2Hab} onChange={(e) => updateAss("salePriceEurM2Hab", Number(e.target.value) || 0)} /></div>
                  <div><div style={labelStyle}>Commercialisation (%)</div><input style={inputStyle} type="number" value={ass.commercialisationPct} onChange={(e) => updateAss("commercialisationPct", pct(e.target.value, 100))} /></div>
                  <div><div style={labelStyle}>Coef vendable</div><input style={inputStyle} type="number" step="0.01" min={0.8} max={1.2} value={ass.coefVendable} onChange={(e) => updateAss("coefVendable", Math.min(1.2, Math.max(0.8, Number(e.target.value) || 1)))} /><div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>Vendable = Habitable × coef</div></div>
                  <div>
                    <div style={labelStyle}>Foncier (€)</div>
                    <input style={inputStyle} type="number" placeholder="ex: 450 000" value={isNaN(ass.landPriceEur) ? "" : ass.landPriceEur} onChange={(e) => updateAss("landPriceEur", e.target.value === "" ? NaN : Number(e.target.value))} />
                  </div>
                  <div><div style={labelStyle}>Notaire (%)</div><input style={inputStyle} type="number" value={ass.notaryFeesPct} onChange={(e) => updateAss("notaryFeesPct", pct(e.target.value, 7.5))} /></div>
                  <div><div style={labelStyle}>Taxes acquisition (%)</div><input style={inputStyle} type="number" value={ass.acquisitionTaxesPct} onChange={(e) => updateAss("acquisitionTaxesPct", pct(e.target.value, 0))} /></div>
                  <div><div style={labelStyle}>Travaux (€/m² SDP)</div><input style={inputStyle} type="number" value={ass.worksCostEurM2Sdp} onChange={(e) => updateAss("worksCostEurM2Sdp", Number(e.target.value) || 0)} /></div>
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
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: "#94a3b8" }}>Hypothèses simplifiées (v2). TVA, phasage, annexes et cashflow seront ajoutés prochainement.</div>
              </div>
            </div>

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
                          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 180px 160px", gap: 12, padding: "9px 14px", borderTop: idx === 0 ? "none" : `1px solid ${isTotal ? "rgba(255,255,255,0.08)" : "#f1f5f9"}`, background: isTotal ? "#1e293b" : isSubtotal ? "#f1f5f9" : "white", color: isTotal ? "white" : isNegative ? "#dc2626" : "#0f172a", fontWeight: isTotal ? 900 : isSubtotal ? 700 : 500, alignItems: "center", fontSize: 13 }}>
                            <div>{l.label}</div>
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
                <ul style={{ margin: 0, paddingLeft: 18, color: "#78350f", fontSize: 13, lineHeight: 1.7 }}>
                  {computed.notes.map((x, i) => <li key={i}>{x}</li>)}
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