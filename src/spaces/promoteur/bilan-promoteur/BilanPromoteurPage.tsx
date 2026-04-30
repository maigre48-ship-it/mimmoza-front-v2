// src/spaces/promoteur/bilan-promoteur/BilanPromoteurPage.tsx
// Pro forma v2.9 — Fix isolation par studyId
// - Hypothèses scopées par studyId (plus de fuite foncier/terrassement entre projets)
// - Reset du store GeoJSON global au changement d'étude
// - Marché depuis synthesis_market_study · risques depuis snapshot

import React, { useMemo, useState, useEffect, useLayoutEffect, useRef } from "react";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useSearchParams } from "react-router-dom";
import { usePromoteurProjectStore } from "../store/promoteurProject.store";
import { patchModule, getSnapshot } from "../shared/promoteurSnapshot.store";
import { usePromoteurStudy } from "../shared/usePromoteurStudy";
import { PromoteurSynthesePage } from "../pages/PromoteurSynthesePage";
import type { PromoteurRawInput } from "../services/promoteurSynthese.types";
import type { Implantation2DSnapshot } from "../plan2d/implantation2d.snapshot";
import {
  totalEmpriseM2 as snapTotalEmprise,
  totalSdpM2    as snapTotalSdp,
} from "../plan2d/implantation2d.snapshot";

// ── Clés localStorage ─────────────────────────────────────────────────────────
export const SYNTHESE_RAW_KEY  = "mimmoza.promoteur.synthese.rawInput.v1";
// Clé écrite par MarketStudyPage ("Utiliser pour la synthèse")
const LS_MARKET_STUDY          = "synthesis_market_study";

// Scoping par étude : toutes les clés qui contenaient des hypothèses doivent
// être isolées par studyId, sinon elles fuient d'un projet à l'autre.
function bilanLandPriceKey(studyId: string): string {
  return `mimmoza.bilan.land_price_eur.${studyId}`;
}
function bilanAssumptionsKey(studyId: string): string {
  return `mimmoza.bilan.assumptions.${studyId}`;
}
function terrassementKey(studyId: string): string {
  return `mimmoza.terrassement.export.${studyId}`;
}

const GRAD_PRO   = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
const ACCENT_PRO = "#5247b8";

function n(v: unknown, fallback = 0): number { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function pct(v: unknown, fallback = 0): number { const x = n(v, fallback); if (x < 0) return 0; if (x > 100) return 100; return x; }
function eur(v: number): string { try { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v); } catch { return `${Math.round(v)} €`; } }
function m2(v: number): string { return `${Math.round(v)} m²`; }
function safeAreaM2(feat: Feature<Geometry> | null | undefined): number { if (!feat?.geometry) return 0; try { return turf.area(feat as turf.AllGeoJSON); } catch { return 0; } }
function sumAreas(fc?: FeatureCollection<Geometry> | null): number { if (!fc?.features || !Array.isArray(fc.features)) return 0; return fc.features.reduce((acc, f) => acc + safeAreaM2(f as Feature<Geometry>), 0); }

type BuildingKind = "INDIVIDUEL" | "COLLECTIF";
type FloorsSpec   = { aboveGroundFloors: number; groundFloorHeightM: number; typicalFloorHeightM: number; };
type Assumptions  = {
  salePriceEurM2Hab: number; commercialisationPct: number; coefVendable: number;
  landPriceEur: number; notaryFeesPct: number; acquisitionTaxesPct: number;
  worksCostEurM2Sdp: number; vrdPct: number; extPct: number; contingencyPct: number;
  surveyorEur: number; geotechEur: number; moePct: number; betPct: number;
  spsCtOpcEur: number; insuranceDoPct: number; miscEur: number;
  marketingPctCa: number; marketingFixedEur: number;
  financingRatePct: number; financingFeesEur: number; taxeAmenagementEurM2Sdp: number;
  terrassementEur: number;
};
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
  terrassementEur: 0,
};

function computeProForma(ass: Assumptions, sdpEstimatedM2: number, surfaceVendableM2: number) {
  const caLogements  = surfaceVendableM2 * n(ass.salePriceEurM2Hab, 0) * (pct(ass.commercialisationPct, 100) / 100);
  const caTotal      = caLogements;
  const foncier      = n(ass.landPriceEur, 0);
  const fraisNotaire = foncier * (pct(ass.notaryFeesPct, 7.5) / 100);
  const taxesAcq     = foncier * (pct(ass.acquisitionTaxesPct, 0) / 100);
  const totalFoncier = foncier + fraisNotaire + taxesAcq;
  const travauxBase  = sdpEstimatedM2 * n(ass.worksCostEurM2Sdp, 0);
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
  const totalTravaux = travauxBase + vrd + ext + aleas;
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
  return {
    caLogements, caTotal, foncier, fraisNotaire, taxesAcq, totalFoncier,
    travauxBase, surveyor, geotech, moe, bet, spsCtOpc, insuranceDo, misc, totalEtudes,
    vrd, ext, aleas, totalTravaux, taxeAmenagement, totalTaxes,
    marketingPct, marketingFixed, totalCom, intercalaires, fraisFin, totalFin,
    coutTotal, marge, margePct, coutRevientEurM2Hab, coutRevientEurM2Sdp,
  };
}

function readTerrassementFromStorage(studyId: string | null): { eur: number; hint: string } {
  if (!studyId) return { eur: 0, hint: "" };
  try {
    const raw  = localStorage.getItem(terrassementKey(studyId));
    if (!raw) return { eur: 0, hint: "" };
    const data = JSON.parse(raw);
    if (!(data?.totalCout > 0)) return { eur: 0, hint: "" };
    const hint = [`Δ ${data.maxDeltaM?.toFixed(1) ?? "?"}m`, `pente ${data.maxSlopeDeg?.toFixed(1) ?? "?"}°`, data.slopeWarning === "fort" ? "⚠ pente forte" : null].filter(Boolean).join(" · ");
    return { eur: Math.round(data.totalCout / 100) * 100, hint };
  } catch { return { eur: 0, hint: "" }; }
}

export const BilanPromoteurPage: React.FC = () => {
  const buildings = usePromoteurProjectStore((s) => s.buildings);
  const parkings  = usePromoteurProjectStore((s) => s.parkings);
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");
  const { study, loadState, patchBilan } = usePromoteurStudy(studyId);

  // ── FIX : Reset GeoJSON du store global quand on change d'étude ───────────
  // usePromoteurProjectStore est persisté sous une clé GLOBALE → il garde
  // les bâtiments de l'ancien projet. On force un reset au changement de studyId,
  // et on laisse Implantation2DPage ré-hydrater depuis sa propre clé scopée.
  const prevStudyIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (prevStudyIdRef.current !== null && prevStudyIdRef.current !== studyId) {
      usePromoteurProjectStore.getState().clearImplantation();
      console.debug("[BilanPromoteur] store GeoJSON reset (changement étude)", {
        from: prevStudyIdRef.current,
        to: studyId,
      });
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

  // ── FIX : hypothèses scopées par studyId ─────────────────────────────────
  // On part toujours des DEFAULTS, puis useLayoutEffect hydrate depuis la clé
  // scopée par studyId. hydratedRef bloque l'auto-save pendant la phase d'hydration.
  const [ass, setAss] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const hydratedRef = useRef(false);

  useLayoutEffect(() => {
    hydratedRef.current = false;

    if (!studyId) {
      setAss(DEFAULT_ASSUMPTIONS);
      setTerrassementHint("");
      hydratedRef.current = true;
      return;
    }

    try {
      const rawAss = localStorage.getItem(bilanAssumptionsKey(studyId));
      if (rawAss) {
        const saved = JSON.parse(rawAss) as Partial<Assumptions>;
        // JSON.stringify(NaN) → "null" : on restaure NaN depuis null pour
        // que l'input (isNaN-gated) soit bien contrôlé en "vide" et pas en null.
        const merged: Assumptions = { ...DEFAULT_ASSUMPTIONS, ...saved };
        if (merged.landPriceEur === null || merged.landPriceEur === undefined) {
          // Tenter de récupérer depuis la clé dédiée land_price_eur avant de tomber à NaN
          const rawPrice = localStorage.getItem(bilanLandPriceKey(studyId));
          const price = rawPrice ? Number(rawPrice) : NaN;
          merged.landPriceEur = Number.isFinite(price) && price > 0 ? price : NaN;
        } else if (!Number.isFinite(merged.landPriceEur)) {
          merged.landPriceEur = NaN;
        }
        setAss(merged);
      } else {
        const rawPrice = localStorage.getItem(bilanLandPriceKey(studyId));
        const price = rawPrice ? Number(rawPrice) : NaN;
        setAss(
          Number.isFinite(price) && price > 0
            ? { ...DEFAULT_ASSUMPTIONS, landPriceEur: price }
            : DEFAULT_ASSUMPTIONS,
        );
      }
    } catch {
      setAss(DEFAULT_ASSUMPTIONS);
    }

    const terr = readTerrassementFromStorage(studyId);
    setTerrassementHint(terr.hint);

    hydratedRef.current = true;
    console.debug("[BilanPromoteur] hypothèses hydratées", { studyId });
  }, [studyId]);

  // ── Persistance hypothèses complètes (scopées par studyId) ───────────────
  // La clé standalone mimmoza.bilan.land_price_eur.<studyId> sert de source
  // de vérité prioritaire à l'hydratation : elle survit aux JSON.stringify(NaN).
  useEffect(() => {
    if (!hydratedRef.current || !studyId) return;
    try {
      // On sauve ass tel quel dans assumptions (JSON convertira NaN en null,
      // l'hydratation sait gérer ça). Mais on maintient AUSSI la clé dédiée
      // comme source fiable si landPriceEur est valide.
      localStorage.setItem(bilanAssumptionsKey(studyId), JSON.stringify(ass));
      if (Number.isFinite(ass.landPriceEur) && ass.landPriceEur > 0) {
        localStorage.setItem(bilanLandPriceKey(studyId), String(ass.landPriceEur));
      }
      // Ne PAS supprimer la clé dédiée automatiquement : l'utilisateur n'a
      // peut-être pas vidé le champ volontairement. Si vraiment on veut la
      // supprimer, il faut un bouton explicite. Ici on la laisse comme backup.
    } catch (e) {
      console.warn("[BilanPromoteur] persistance hypothèses échouée:", e);
    }
  }, [ass, studyId]);

  // ── Résolution nom commune depuis code INSEE ──────────────────────────────
  const [communeNom, setCommuneNom] = useState<string | null>(null);
  const [codePostal, setCodePostal] = useState<string | null>(null);

  useEffect(() => {
    const insee = study?.foncier?.commune_insee;
    if (!insee || communeNom) return;
    let cancelled = false;
    fetch(`https://geo.api.gouv.fr/communes/${insee}?fields=nom,codesPostaux`, {
      signal: AbortSignal.timeout(5000),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return;
        if (data.nom) setCommuneNom(data.nom);
        if (data.codesPostaux?.[0]) setCodePostal(data.codesPostaux[0]);
      })
      .catch(() => { /* silencieux */ });
    return () => { cancelled = true; };
  }, [study?.foncier?.commune_insee, communeNom]);

  // ── Synchronisation terrassement depuis Massing 3D (scopée par study) ────
  useEffect(() => {
    if (!studyId) return;
    const apply = () => {
      const t = readTerrassementFromStorage(studyId);
      if (t.eur > 0) {
        setAss(prev => prev.terrassementEur === 0 ? { ...prev, terrassementEur: t.eur } : prev);
        setTerrassementHint(t.hint);
      } else {
        setAss(prev => prev.terrassementEur > 0 ? { ...prev, terrassementEur: 0 } : prev);
        setTerrassementHint("");
      }
    };
    apply();
    window.addEventListener("focus", apply);
    return () => window.removeEventListener("focus", apply);
  }, [studyId]);

  useEffect(() => {
    const fromStudy = (study as any)?.implantation2d as Implantation2DSnapshot | undefined;
    if (fromStudy?.buildings?.length) { setSnap2d(fromStudy); return; }
    const fromSnapshot = getSnapshot()?.implantation2d as Implantation2DSnapshot | undefined;
    if (fromSnapshot?.buildings?.length) { setSnap2d(fromSnapshot); return; }
    setSnap2d(null);
  }, [study, studyId]);

  useEffect(() => {
    if (loadState !== "ready" || !study) return;
    if (study.evaluation?.cout_foncier) {
      setAss((prev) => {
        if (Number.isFinite(prev.landPriceEur) && prev.landPriceEur > 0) return prev;
        return { ...prev, landPriceEur: study.evaluation!.cout_foncier! };
      });
    }
    if (study.marche?.prix_m2_neuf) setAss((prev) => ({ ...prev, salePriceEurM2Hab: study.marche!.prix_m2_neuf! }));
  }, [loadState, study]);

  const footprintBuildingsM2 = footprintBuildingsM2Raw > 0 ? footprintBuildingsM2Raw : (snap2d ? snapTotalEmprise(snap2d) : 0);
  const sdpFromSnap          = snap2d ? snapTotalSdp(snap2d) : 0;

  const levelsCount  = useMemo(() => 1 + Math.max(0, Math.floor(n(floorsSpec.aboveGroundFloors, 0))), [floorsSpec.aboveGroundFloors]);
  const totalHeightM = useMemo(() => n(floorsSpec.groundFloorHeightM, 2.8) + Math.max(0, Math.floor(n(floorsSpec.aboveGroundFloors, 0))) * n(floorsSpec.typicalFloorHeightM, 2.7), [floorsSpec]);
  const coefHab = buildingKind === "INDIVIDUEL" ? COEF_HABITABLE_INDIVIDUEL : COEF_HABITABLE_COLLECTIF;

  const sdpEstimatedM2 = useMemo(() => {
    if (footprintBuildingsM2Raw <= 0 && sdpFromSnap > 0) return sdpFromSnap;
    return footprintBuildingsM2 * levelsCount * COEF_SDP;
  }, [footprintBuildingsM2Raw, footprintBuildingsM2, levelsCount, sdpFromSnap]);

  const habitableEstimatedM2 = useMemo(() => sdpEstimatedM2 * coefHab, [sdpEstimatedM2, coefHab]);
  const surfaceVendableM2    = useMemo(() => habitableEstimatedM2 * n(ass.coefVendable, 1), [habitableEstimatedM2, ass.coefVendable]);

  const computed = useMemo(() => {
    const pf = computeProForma(ass, sdpEstimatedM2, surfaceVendableM2);
    const pfCoutTotal    = pf.coutTotal + ass.terrassementEur;
    const pfMarge        = pf.caTotal - pfCoutTotal;
    const pfMargePct     = pf.caTotal > 0 ? (pfMarge / pf.caTotal) * 100 : 0;
    const pfCoutRevM2Hab = surfaceVendableM2 > 0 ? pfCoutTotal / surfaceVendableM2 : 0;
    const pfCoutRevM2Sdp = sdpEstimatedM2    > 0 ? pfCoutTotal / sdpEstimatedM2    : 0;
    const pfTotalTravaux = pf.totalTravaux + ass.terrassementEur;

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
    if (ass.terrassementEur > 0) lines.push({ section: "C) TRAVAUX", label: "Terrassement & fondations", valueEur: ass.terrassementEur, hint: terrassementHint || "Massing 3D" });
    lines.push({ section: "C) TRAVAUX", label: "Aménagements extérieurs", valueEur: pf.ext, hint: `${ass.extPct.toFixed(1)}% travaux` });
    lines.push({ section: "C) TRAVAUX", label: "Aléas travaux", valueEur: pf.aleas, hint: `${ass.contingencyPct.toFixed(1)}% travaux` });
    lines.push({ section: "C) TRAVAUX", label: "Total travaux", valueEur: pfTotalTravaux, kind: "subtotal" });
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
    if (footprintBuildingsM2 <= 0) notes.push("Aucun bâtiment dessiné en Implantation 2D : SDP/Habitable = 0.");
    if (ass.salePriceEurM2Hab <= 0) notes.push("Prix de vente €/m² non renseigné : CA = 0.");
    if (!n(ass.landPriceEur, 0)) notes.push("Foncier non renseigné : le bilan est incomplet.");
    if (ass.terrassementEur > 0) notes.push(`Terrassement intégré depuis Massing 3D : ${eur(ass.terrassementEur)} HT (${terrassementHint}).`);

    const safeNbLogements = nbLogements > 0 ? nbLogements : 1;
    return {
      ...pf, coutTotal: pfCoutTotal, marge: pfMarge, margePct: pfMargePct,
      coutRevientEurM2Hab: pfCoutRevM2Hab, coutRevientEurM2Sdp: pfCoutRevM2Sdp,
      totalTravaux: pfTotalTravaux, lines, notes,
      prixParLogement: pf.caTotal / safeNbLogements,
      coutParLogement: pfCoutTotal / safeNbLogements,
      margeParLogement: pfMarge / safeNbLogements,
    };
  }, [ass, footprintBuildingsM2, sdpEstimatedM2, surfaceVendableM2, nbLogements, terrassementHint]);

  const sensitivity = useMemo(() => {
    const pfA = computeProForma({ ...ass, worksCostEurM2Sdp: ass.worksCostEurM2Sdp * 1.05 }, sdpEstimatedM2, surfaceVendableM2);
    const pfB = computeProForma({ ...ass, salePriceEurM2Hab: ass.salePriceEurM2Hab * 0.95 }, sdpEstimatedM2, surfaceVendableM2);
    const terr = ass.terrassementEur;
    return {
      base: { marge: computed.marge, margePct: computed.margePct },
      scenarioA: { label: "+5% coût travaux",  marge: pfA.caTotal - pfA.coutTotal - terr, margePct: pfA.caTotal > 0 ? ((pfA.caTotal - pfA.coutTotal - terr) / pfA.caTotal) * 100 : 0, deltaMarge: (pfA.caTotal - pfA.coutTotal - terr) - computed.marge, deltaPct: (pfA.caTotal > 0 ? ((pfA.caTotal - pfA.coutTotal - terr) / pfA.caTotal) * 100 : 0) - computed.margePct },
      scenarioB: { label: "-5% prix de vente", marge: pfB.caTotal - pfB.coutTotal - terr, margePct: pfB.caTotal > 0 ? ((pfB.caTotal - pfB.coutTotal - terr) / pfB.caTotal) * 100 : 0, deltaMarge: (pfB.caTotal - pfB.coutTotal - terr) - computed.marge, deltaPct: (pfB.caTotal > 0 ? ((pfB.caTotal - pfB.coutTotal - terr) / pfB.caTotal) * 100 : 0) - computed.margePct },
    };
  }, [ass, sdpEstimatedM2, surfaceVendableM2, computed.marge, computed.margePct]);

  // ── FIX MARCHÉ : lecture depuis synthesis_market_study (MarketStudyPage) ──
  const marcheFromLS = useMemo(() => {
    try {
      const raw = localStorage.getItem(LS_MARKET_STUDY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.data?.market ?? null;
    } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── FIX RISQUES : lecture depuis snapshot (RisquesPage → patchModule) ────
  const risquesFromSnap = useMemo(() => {
    try {
      const snap = getSnapshot() as any;
      return snap?.risks?.data ?? null;
    } catch { return null; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── rawInput synthèse ─────────────────────────────────────────────────────
  const synthesisRawInput = useMemo((): PromoteurRawInput => {
    const fsnap = getSnapshot()?.foncier as { communeInsee?: string; surfaceM2?: number; } | null ?? null;
    const sessionInsee  = (() => { try { return localStorage.getItem("mimmoza.session.commune_insee") ?? undefined; } catch { return undefined; } })();
    const sessionSurfM2 = (() => { try { const v = localStorage.getItem("mimmoza.session.surface_m2"); return v ? Number(v) : undefined; } catch { return undefined; } })();
    const inseeCode   = study?.foncier?.commune_insee ?? fsnap?.communeInsee ?? sessionInsee ?? undefined;
    const dept        = inseeCode ? inseeCode.slice(0, 2) : undefined;
    const surfTerrain = study?.foncier?.surface_m2 ?? fsnap?.surfaceM2 ?? sessionSurfM2 ?? undefined;
    const communeLabel = communeNom ?? (study?.foncier as any)?.commune ?? inseeCode ?? undefined;
    const cpLabel      = codePostal ?? (study?.foncier as any)?.code_postal ?? undefined;

    const prixFoncierBrut = n(ass.landPriceEur, 0);

    const dvfLS = marcheFromLS?.dvf ?? null;
    const pricesLS = marcheFromLS?.prices ?? null;
    const transactionsLS = marcheFromLS?.transactions ?? null;
    const inseeLS = marcheFromLS?.insee ?? null;

    const riskCategories = risquesFromSnap?.categories ?? [];
    const riskData       = risquesFromSnap?.data ?? null;
    const riskMeta       = risquesFromSnap?.meta ?? null;
    const riskScoreGlobal = risquesFromSnap?.scores?.global ?? null;

    const risquesIdentifies: string[] = riskCategories
      .filter((c: any) => c.level !== 'nul' && c.level !== 'inconnu')
      .map((c: any) => `${c.name} (${c.level})`);

    const zonageRisque = study?.risques?.zonage_risque
      ?? (riskData?.inondation?.zone_inondable ? `Zone inondable — ${riskData.inondation.type_zone || 'type inconnu'}` : undefined)
      ?? (riskData?.seisme?.zone != null ? `Zone sismique ${riskData.seisme.zone}` : undefined)
      ?? (riskMeta?.commune_nom ? `${riskMeta.commune_nom} — risques analysés` : undefined)
      ?? undefined;

    return {
      foncier: {
        adresse:           (study?.foncier as any)?.adresse_complete ?? undefined,
        commune:           communeLabel,
        codePostal:        cpLabel,
        departement:       (study?.foncier as any)?.departement ?? dept ?? undefined,
        surfaceTerrain:    surfTerrain ?? undefined,
        prixAcquisition:   prixFoncierBrut > 0 ? prixFoncierBrut : undefined,
        fraisNotaire:      computed.fraisNotaire > 0 ? computed.fraisNotaire : undefined,
        pollutionDetectee: (riskData?.sis?.count ?? 0) > 0,
      },
      plu: {
        zone:        study?.plu?.zone_plu   ?? undefined,
        cub:         study?.plu?.cos         ?? undefined,
        hauteurMax:  study?.plu?.hauteur_max ?? undefined,
        pleineTerre: study?.plu?.pleine_terre_pct ?? undefined,
      },
      conception: {
        surfacePlancher: sdpEstimatedM2       > 0 ? sdpEstimatedM2       : undefined,
        nbLogements:     nbLogements          > 0 ? nbLogements          : undefined,
        nbNiveaux:       levelsCount          > 0 ? levelsCount          : undefined,
        hauteurProjet:   totalHeightM         > 0 ? totalHeightM         : undefined,
        empriseBatie:    footprintBuildingsM2 > 0 ? footprintBuildingsM2 : undefined,
        programmeType:   buildingKind === "COLLECTIF" ? "Résidentiel collectif libre" : "Résidentiel individuel",
      },
      marche: {
        prixNeufM2:
          study?.marche?.prix_m2_neuf
          ?? (pricesLS?.median_eur_m2 > 0 ? pricesLS.median_eur_m2 : undefined)
          ?? (ass.salePriceEurM2Hab > 0 ? ass.salePriceEurM2Hab : undefined),
        prixAncienM2:
          study?.marche?.prix_m2_ancien
          ?? (dvfLS?.prix_m2_median > 0 ? dvfLS.prix_m2_median : undefined)
          ?? undefined,
        nbTransactionsDvf:
          study?.marche?.nb_transactions
          ?? (dvfLS?.nb_transactions > 0 ? dvfLS.nb_transactions : undefined)
          ?? (transactionsLS?.count > 0 ? transactionsLS.count : undefined)
          ?? undefined,
        prixMoyenDvf:
          study?.marche?.prix_moyen_dvf
          ?? (dvfLS?.prix_m2_moyen > 0 ? dvfLS.prix_m2_moyen : undefined)
          ?? (pricesLS?.mean_eur_m2 > 0 ? pricesLS.mean_eur_m2 : undefined)
          ?? undefined,
        offreConcurrente:
          study?.marche?.nb_programmes_concurrents
          ?? undefined,
        absorptionMensuelle:
          study?.marche?.absorption_mensuelle
          ?? undefined,
      },
      risques: {
        risquesIdentifies,
        zonageRisque,
        scoreGlobal:  riskScoreGlobal ?? undefined,
        nbCatnat:     riskData?.gaspar?.catnat_count ?? undefined,
        nbSeveso:     riskData?.icpe
                        ? (riskData.icpe.seveso_haut_count ?? 0) + (riskData.icpe.seveso_bas_count ?? 0)
                        : undefined,
        pprCount:     riskData?.gaspar?.ppr_count ?? undefined,
        classeRadon:  riskData?.radon?.classe_potentiel ?? undefined,
      } as any,
      evaluation: {
        prixVenteM2:       ass.salePriceEurM2Hab > 0 ? ass.salePriceEurM2Hab : undefined,
        prixVenteTotal:    computed.caTotal       > 0 ? computed.caTotal       : undefined,
        nbLogementsLibres: nbLogements            > 0 ? nbLogements            : undefined,
      },
      bilan: {
        coutFoncier:            prixFoncierBrut        > 0 ? prixFoncierBrut        : undefined,
        coutTravaux:            computed.totalTravaux  > 0 ? computed.totalTravaux  : undefined,
        coutTravauxM2:          ass.worksCostEurM2Sdp  > 0 ? ass.worksCostEurM2Sdp  : undefined,
        fraisFinanciers:        computed.totalFin      > 0 ? computed.totalFin      : undefined,
        fraisCommercialisation: computed.totalCom      > 0 ? computed.totalCom      : undefined,
        fraisGestion:           computed.totalEtudes   > 0 ? computed.totalEtudes   : undefined,
        chiffreAffaires:        computed.caTotal       > 0 ? computed.caTotal       : undefined,
        margeNette:             computed.marge,
        margeNettePercent:      computed.margePct,
        trnRendement:           computed.caTotal > 0 && computed.coutTotal > 0 ? (computed.marge / computed.coutTotal) * 100 : undefined,
        fondsPropres: undefined, creditPromoteur: undefined,
      },
    };
  }, [study, ass, computed, sdpEstimatedM2, nbLogements, levelsCount, totalHeightM, footprintBuildingsM2, buildingKind, communeNom, codePostal, marcheFromLS, risquesFromSnap]);

  // ── BRIDGE localStorage ───────────────────────────────────────────────────
  useEffect(() => {
    if (!(computed.caTotal > 0)) return;
    try {
      localStorage.setItem(SYNTHESE_RAW_KEY, JSON.stringify(synthesisRawInput));
      console.debug("[Bilan→Synthese] rawInput persisté",
        "| CA =", synthesisRawInput.bilan?.chiffreAffaires,
        "| foncierBrut =", synthesisRawInput.bilan?.coutFoncier,
        "| prixAncienM2 =", synthesisRawInput.marche?.prixAncienM2,
        "| nbTransactions =", synthesisRawInput.marche?.nbTransactionsDvf,
        "| risquesCount =", (synthesisRawInput.risques as any)?.risquesIdentifies?.length,
      );
    } catch (e) { console.warn("[Bilan→Synthese] localStorage write failed:", e); }
  }, [synthesisRawInput, computed.caTotal]);

  useEffect(() => {
    try {
      const ok = surfaceVendableM2 > 0 && computed.caTotal > 0;
      patchModule("bilan", {
        ok, marge_pct: computed.margePct, ca: computed.caTotal,
        summary: `Marge ${computed.margePct.toFixed(1)}% · CA ${Math.round(computed.caTotal).toLocaleString("fr-FR")}€ · Vendable ${Math.round(surfaceVendableM2)} m²`,
        data: { assumptions: ass, kpis: { caTotal: computed.caTotal, coutTotal: computed.coutTotal, marge: computed.marge, margePct: computed.margePct }, surfaces: { footprintBuildingsM2, footprintParkingsM2, sdpEstimatedM2, habitableEstimatedM2: habitableEstimatedM2, surfaceVendableM2 }, params: { buildingKind, floorsSpec, nbLogements, levelsCount, totalHeightM }, terrassement: ass.terrassementEur > 0 ? { totalCout: ass.terrassementEur, hint: terrassementHint } : null, lines: computed.lines, notes: computed.notes, sensitivity },
      });
      if (studyId && surfaceVendableM2 > 0 && computed.caTotal > 0) {
        patchBilan({ prix_revient_total: computed.coutTotal, ca_previsionnel: computed.caTotal, marge_nette: computed.marge, taux_marge_nette_pct: computed.margePct, fonds_propres: null, credit_promotion: null, taux_credit_pct: ass.financingRatePct, duree_mois: null, roi_pct: null, tri_pct: null, ai_narrative: null, ai_generated_at: null, notes: computed.notes.join(" | ") || null, done: true }).catch((e) => console.warn("[BilanPromoteurPage] patchBilan failed:", e));
      }
    } catch (err) { console.warn("[BilanPromoteurPage] Erreur persistance:", err); }
  }, [computed, ass, surfaceVendableM2, footprintBuildingsM2, footprintParkingsM2, sdpEstimatedM2, buildingKind, floorsSpec, nbLogements, levelsCount, totalHeightM, sensitivity, studyId, patchBilan, terrassementHint]);

  const grouped = useMemo(() => { const map = new Map<string, Line[]>(); for (const l of computed.lines) { if (!map.has(l.section)) map.set(l.section, []); map.get(l.section)!.push(l); } return map; }, [computed.lines]);
  const handleSaveForSynthesis = () => { patchModule("bilan", { ok: true, validated: true, marge_pct: computed.margePct, ca: computed.caTotal, summary: `Marge ${computed.margePct.toFixed(1)}% · CA ${eur(computed.caTotal)} · ${m2(surfaceVendableM2)} vendable`, data: { assumptions: ass, kpis: { caTotal: computed.caTotal, coutTotal: computed.coutTotal, marge: computed.marge, margePct: computed.margePct }, surfaces: { surfaceVendableM2, sdpEstimatedM2 }, notes: computed.notes, sensitivity } }); setSynthesisSaved(true); setTimeout(() => setSynthesisSaved(false), 3000); };
  const scrollToStressTest = () => document.getElementById("stress-test")?.scrollIntoView({ behavior: "smooth", block: "start" });

  const handleExportExcel = async () => {
    try {
      const ExcelJS = await import("exceljs");
      const now = new Date(); const pad = (x: number) => x.toString().padStart(2, "0");
      const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
      const communeName = (study?.foncier as any)?.commune ?? study?.foncier?.commune_insee ?? "Projet";
      const fmtE = (v: number) => (Number.isFinite(v) ? Math.round(v) : 0); const TVA = 0.20;
      const wb = new ExcelJS.Workbook(); wb.creator = "Mimmoza";
      const ws = wb.addWorksheet("Bilan Détaillé");
      ws.columns = [{ width: 2 }, { width: 42 }, { width: 14 }, { width: 10 }, { width: 12 }, { width: 18 }, { width: 14 }, { width: 18 }, { width: 34 }];
      type ExcelFill = ExcelJS.Fill;
      const solidFill = (hex: string): ExcelFill => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + hex } });
      const FMT_EUR = '# ##0 "€";(# ##0 "€");"-"';
      const sC = (cell: ExcelJS.Cell, opts: { bold?: boolean; color?: string; bg?: string; size?: number; italic?: boolean; align?: "left"|"center"|"right"; numFmt?: string }) => { cell.font = { name: "Arial", size: opts.size ?? 9, bold: opts.bold ?? false, italic: opts.italic ?? false, color: { argb: "FF" + (opts.color ?? "000000") } }; if (opts.bg) cell.fill = solidFill(opts.bg); cell.alignment = { vertical: "middle", horizontal: opts.align ?? "left" }; if (opts.numFmt) cell.numFmt = opts.numFmt; };
      const addSec = (title: string) => { ws.addRow([]); const r = ws.addRow(["", title]); r.height = 18; ws.mergeCells(`B${r.number}:I${r.number}`); sC(r.getCell("B"), { bold: true, color: "FFFFFF", bg: "5247B8", size: 10 }); for (const col of ["C","D","E","F","G","H","I"]) r.getCell(col).fill = solidFill("5247B8"); };
      const addDL = (label: string, qty: string, unit: string, taux: string, ht: number, tva: number, note = "", rowNum: number) => { const bg = rowNum % 2 === 0 ? "F8F7FE" : "FFFFFF"; const r = ws.addRow(["", `  ${label}`, qty, unit, taux, fmtE(ht), fmtE(tva), fmtE(ht + tva), note]); r.height = 15; for (const [col, al] of [["B","left"],["C","center"],["D","center"],["E","center"],["F","right"],["G","right"],["H","right"],["I","left"]] as [string,"left"|"center"|"right"][]) { const c = r.getCell(col); sC(c, { bg, align: al }); if (["F","G","H"].includes(col) && typeof c.value === "number") c.numFmt = FMT_EUR; } };
      const addST = (label: string, ht: number, tva: number) => { const r = ws.addRow(["", label, "", "", "", fmtE(ht), fmtE(tva), fmtE(ht + tva), ""]); r.height = 17; for (const col of ["B","C","D","E","F","G","H","I"]) { const c = r.getCell(col); sC(c, { bold: true, color: "5247B8", bg: "E8E4F7", align: ["F","G","H"].includes(col) ? "right" : "left" }); if (["F","G","H"].includes(col) && typeof c.value === "number") c.numFmt = FMT_EUR; c.border = { bottom: { style: "medium", color: { argb: "FF5247B8" } } }; } };
      const addTR = (label: string, ht: number, tva: number, bg = "1E293B") => { ws.addRow([]); const r = ws.addRow(["", label, "", "", "", fmtE(ht), fmtE(tva), fmtE(ht + tva), ""]); r.height = 22; ws.mergeCells(`B${r.number}:E${r.number}`); for (const col of ["B","C","D","E","F","G","H","I"]) { const c = r.getCell(col); sC(c, { bold: true, color: "FFFFFF", bg, size: 11, align: ["F","G","H"].includes(col) ? "right" : "left" }); if (["F","G","H"].includes(col) && typeof c.value === "number") c.numFmt = FMT_EUR; } };
      const r1 = ws.addRow(["", "BILAN PROMOTEUR — PRO FORMA"]); r1.height = 30; ws.mergeCells("B1:I1"); sC(r1.getCell("B"), { bold: true, color: "FFFFFF", bg: "2D2D6B", size: 14, align: "center" }); for (const col of ["C","D","E","F","G","H","I"]) r1.getCell(col).fill = solidFill("2D2D6B");
      const r2 = ws.addRow(["", `Commune : ${communeName}   |   Date : ${new Date().toLocaleDateString("fr-FR")}   |   Mimmoza`]); r2.height = 16; ws.mergeCells("B2:I2"); sC(r2.getCell("B"), { italic: true, color: "94A3B8", bg: "F4F3FF", align: "center", size: 9 }); for (const col of ["C","D","E","F","G","H","I"]) r2.getCell(col).fill = solidFill("F4F3FF");
      ws.addRow([]); const rh = ws.addRow(["", "POSTE", "Qté / Surface", "Unité", "% / Taux", "Montant HT (€)", "TVA (€)", "Montant TTC (€)", "Notes"]); rh.height = 18;
      for (const [col, al] of [["B","left"],["C","center"],["D","center"],["E","center"],["F","right"],["G","right"],["H","right"],["I","left"]] as [string,"left"|"center"|"right"][]) sC(rh.getCell(col), { bold: true, color: "FFFFFF", bg: "5247B8", align: al });
      let li = 0;
      addSec("1. FONCIER"); addDL("Terrain", m2(sdpEstimatedM2), "m² SDP", "", computed.foncier, 0, "Prix d'acquisition", ++li); addDL("Frais acte notaire", "", "", `${ass.notaryFeesPct.toFixed(1)}%`, computed.fraisNotaire, 0, "", ++li); addDL("Droits / taxes acquisition", "", "", `${ass.acquisitionTaxesPct.toFixed(1)}%`, computed.taxesAcq, 0, "", ++li); addDL("Géomètre", "", "forfait", "", computed.surveyor, computed.surveyor * TVA, "", ++li); addDL("Sondage sol / géotechnique", "", "forfait", "", computed.geotech, computed.geotech * TVA, "", ++li); addST("TOTAL FONCIER", computed.totalFoncier, (computed.surveyor + computed.geotech) * TVA);
      addSec("2. TAXES"); addDL("Taxe d'aménagement (TA)", m2(sdpEstimatedM2), "m² SDP", `${ass.taxeAmenagementEurM2Sdp} €/m²`, computed.taxeAmenagement, 0, "", ++li); addST("TOTAL TAXES", computed.taxeAmenagement, 0);
      addSec("3. TRAVAUX"); const tvaTrav = (computed.totalTravaux - ass.terrassementEur) * TVA; addDL("Travaux principaux", m2(sdpEstimatedM2), "m² SDP", `${ass.worksCostEurM2Sdp} €/m²`, computed.travauxBase, computed.travauxBase * TVA, "", ++li); addDL("VRD / raccordements", "", "", `${ass.vrdPct.toFixed(1)}%`, computed.vrd, computed.vrd * TVA, "", ++li); if (ass.terrassementEur > 0) addDL("Terrassement & fondations", "", "Massing 3D", terrassementHint || "", ass.terrassementEur, 0, "Calculé depuis le relief terrain", ++li); addDL("Aménagements extérieurs", "", "", `${ass.extPct.toFixed(1)}%`, computed.ext, computed.ext * TVA, "", ++li); addDL("Aléas / imprévus", "", "", `${ass.contingencyPct.toFixed(1)}%`, computed.aleas, computed.aleas * TVA, "", ++li); addST("TOTAL TRAVAUX", computed.totalTravaux, tvaTrav);
      addSec("4. HONORAIRES & MONTAGE"); const tvaEtudes = (computed.moe + computed.bet + computed.spsCtOpc + computed.misc) * TVA; addDL("MOE / Architecte", "", "", `${ass.moePct.toFixed(1)}% coût bât.`, computed.moe, computed.moe * TVA, "", ++li); addDL("BET", "", "", `${ass.betPct.toFixed(1)}% coût bât.`, computed.bet, computed.bet * TVA, "", ++li); addDL("SPS / CT / OPC", "", "forfait", "", computed.spsCtOpc, computed.spsCtOpc * TVA, "", ++li); addDL("Assurance DO", "", "", `${ass.insuranceDoPct.toFixed(1)}% trav.TTC`, computed.insuranceDo, 0, "", ++li); addDL("Divers montage", "", "forfait", "", computed.misc, computed.misc * TVA, "", ++li); addST("TOTAL HONORAIRES", computed.totalEtudes, tvaEtudes);
      addSec("5. COMMERCIALISATION"); const tvaCom = (computed.marketingPct + computed.marketingFixed) * TVA; addDL("Honoraires ventes (% CA)", "", "", `${ass.marketingPctCa.toFixed(1)}% CA HT`, computed.marketingPct, computed.marketingPct * TVA, "", ++li); addDL("Publicité / forfait", "", "", "", computed.marketingFixed, computed.marketingFixed * TVA, "", ++li); addST("TOTAL COMMERCIALISATION", computed.totalCom, tvaCom);
      addSec("6. FRAIS FINANCIERS"); addDL("Intérêts intercalaires", "", "", `${ass.financingRatePct.toFixed(1)}%`, computed.intercalaires, 0, `${ass.financingRatePct.toFixed(1)}% × (foncier + 0.5×travaux)`, ++li); addDL("Frais dossier", "", "forfait", "", computed.fraisFin, 0, "", ++li); addST("TOTAL FRAIS FINANCIERS", computed.totalFin, 0);
      const tvaTotal = (computed.surveyor + computed.geotech) * TVA + tvaTrav + tvaEtudes + tvaCom; addTR("💰  PRIX DE REVIENT TOTAL", computed.coutTotal, tvaTotal);
      addSec("RECETTES PRÉVISIONNELLES"); addDL("Ventes logements", m2(surfaceVendableM2), "m² vend.", `${ass.salePriceEurM2Hab} €/m²`, computed.caTotal, computed.caTotal * 0.055 / 1.055, "TVA 5,5%", ++li);
      ws.addRow([]); const rCA = ws.addRow(["", "CA TOTAL TTC", "", "", "", fmtE(computed.caTotal), "", fmtE(computed.caTotal), ""]); rCA.height = 20; ws.mergeCells(`B${rCA.number}:E${rCA.number}`); for (const col of ["B","C","D","E","F","G","H","I"]) { const c = rCA.getCell(col); sC(c, { bold: true, color: "FFFFFF", bg: "166534", size: 10, align: ["F","H"].includes(col) ? "right" : "left" }); if (["F","H"].includes(col) && typeof c.value === "number") c.numFmt = FMT_EUR; }
      ws.addRow([]); const rMarge = ws.addRow(["", "MARGE BRUTE  (CA − Prix de Revient TTC)", "", "", "", "", "", fmtE(computed.marge), ""]); rMarge.height = 24; ws.mergeCells(`B${rMarge.number}:G${rMarge.number}`); for (const col of ["B","C","D","E","F","G","H","I"]) { const c = rMarge.getCell(col); sC(c, { bold: true, color: "FFFFFF", bg: "4F46E5", size: 11, align: col === "H" ? "right" : "left" }); if (col === "H" && typeof c.value === "number") c.numFmt = FMT_EUR; }
      const rTaux = ws.addRow(["", `Taux de marge : ${computed.margePct.toFixed(1)}%`, "", "", "", "", "", "", `Coût revient : ${Math.round(computed.coutRevientEurM2Hab)} €/m² vend.`]); rTaux.height = 16; ws.mergeCells(`B${rTaux.number}:G${rTaux.number}`); sC(rTaux.getCell("B"), { bold: true, color: "5247B8", bg: "EDE9FE", size: 10 }); for (const col of ["C","D","E","F","G","H","I"]) rTaux.getCell(col).fill = solidFill("EDE9FE");
      const buffer = await wb.xlsx.writeBuffer(); const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `bilan-promoteur-${communeName}-${dateStr}.xlsx`; a.click(); URL.revokeObjectURL(url);
    } catch (error) { console.error("Export Excel error:", error); window.alert("Export Excel impossible : " + String(error)); }
  };

  const isEmpty       = footprintBuildingsM2 <= 0;
  const foncierVide   = !n(ass.landPriceEur, 0);
  const margeColor    = computed.marge >= 0 ? "#16a34a" : "#dc2626";
  const margePctColor = computed.margePct >= 15 ? "#16a34a" : computed.margePct >= 8 ? "#ea580c" : "#dc2626";
  const kpiCard: React.CSSProperties      = { background: "white", borderRadius: 14, padding: "14px 16px 16px", border: "1px solid #e8edf4", boxShadow: "0 2px 8px rgba(15,23,42,0.05)", borderTop: `3px solid ${ACCENT_PRO}`, display: "flex", flexDirection: "column" as const, gap: 2 };
  const kpiLabel: React.CSSProperties     = { fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 4 };
  const kpiSub: React.CSSProperties       = { fontSize: 11, color: "#94a3b8", marginTop: 4, lineHeight: 1.4 };
  const card: React.CSSProperties         = { background: "white", borderRadius: 16, padding: 16, border: "1px solid #e8edf4", boxShadow: "0 2px 8px rgba(15,23,42,0.05)" };
  const labelStyle: React.CSSProperties   = { fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 6 };
  const inputStyle: React.CSSProperties   = { width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid #cbd5e1", background: "white", color: "#0f172a", fontSize: 13, boxSizing: "border-box" as const };
  const sectionTitle: React.CSSProperties = { fontSize: 11, fontWeight: 900, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" as const };
  const updateAss = <K extends keyof Assumptions>(key: K, value: Assumptions[K]) => setAss((s) => ({ ...s, [key]: value }));

  const hasStoreData    = (buildings?.features?.length ?? 0) > 0 || (snap2d?.buildings?.length ?? 0) > 0;
  const dataSourceLabel = (buildings?.features?.length ?? 0) > 0
    ? `✓ Données récupérées depuis le store GeoJSON (${nbLogements} logements, type ${buildingKind})`
    : snap2d?.buildings?.length
      ? `✓ Données récupérées depuis Implantation 2D — ${snap2d.buildings.length} bâtiment${snap2d.buildings.length > 1 ? "s" : ""} (${nbLogements} logements, type ${buildingKind})`
      : "⚠️ Aucun bâtiment trouvé — retournez sur Implantation 2D.";

  const lecturePromoteur = useMemo(() => {
    const ins: string[] = [];
    if (computed.margePct >= 20) ins.push("✅ Marge confortable (≥ 20%)");
    else if (computed.margePct >= 12) ins.push("⚠️ Marge moyenne (12-20%) : prudence sur les hypothèses");
    else if (computed.margePct > 0) ins.push("🔴 Marge faible (< 12%) : risque élevé");
    else ins.push("🔴 Marge négative : opération non viable en l'état");
    if (surfaceVendableM2 > 0 && surfaceVendableM2 < 150) ins.push("📏 Petite opération (< 150 m² vendable) : frais fixes proportionnellement élevés");
    if (computed.coutRevientEurM2Hab > 0 && ass.salePriceEurM2Hab > 0 && computed.coutRevientEurM2Hab / ass.salePriceEurM2Hab > 0.7) ins.push("⚠️ Risque de compression de marge : coût de revient élevé vs prix");
    if (!n(ass.landPriceEur, 0)) ins.push("📋 Foncier non renseigné : bilan incomplet");
    if (footprintBuildingsM2 <= 0) ins.push("🏗️ Aucun bâtiment dessiné : surfaces à 0");
    if (ass.terrassementEur > 0) ins.push(`🏗 Terrassement : ${eur(ass.terrassementEur)} HT intégré au coût total`);
    if (marcheFromLS) ins.push(`📊 Données marché chargées depuis l'étude de marché (${marcheFromLS.dvf?.nb_transactions ?? '?'} transactions DVF)`);
    if (risquesFromSnap) ins.push(`🛡 Analyse de risques chargée — score ${risquesFromSnap.scores?.global ?? '?'}/100`);
    return ins;
  }, [computed, surfaceVendableM2, ass.salePriceEurM2Hab, ass.landPriceEur, ass.terrassementEur, footprintBuildingsM2, marcheFromLS, risquesFromSnap]);

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
              <button onClick={handleSaveForSynthesis} style={{ padding: "9px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.4)", background: synthesisSaved ? "rgba(16,185,129,0.35)" : "rgba(255,255,255,0.15)", color: "white", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
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
          <PromoteurSynthesePage rawInputOverride={synthesisRawInput} />
        ) : (
          <>
            {isEmpty && <div style={{ marginBottom: 16, padding: "12px 18px", background: "#fffbeb", border: "1px solid #fde68a", borderLeft: "4px solid #f59e0b", borderRadius: 12, fontSize: 13, color: "#78350f" }}>⚠️ <strong>Aucun bâtiment dessiné</strong> — retournez sur <strong>Implantation 2D</strong>.</div>}
            {foncierVide && <div style={{ marginBottom: 16, padding: "12px 18px", background: "#fffbeb", border: "1px solid #fde68a", borderLeft: "4px solid #f59e0b", borderRadius: 12, fontSize: 13, color: "#78350f" }}>🏠 <strong>Prix du foncier non renseigné</strong> — saisissez-le dans les Hypothèses.</div>}
            {ass.terrassementEur > 0 && <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(82,71,184,0.06)", border: "1px solid rgba(82,71,184,0.2)", borderLeft: `4px solid ${ACCENT_PRO}`, borderRadius: 12, fontSize: 12, color: ACCENT_PRO, display: "flex", alignItems: "center", gap: 8 }}>🏗 <strong>Terrassement Massing 3D</strong> — {eur(ass.terrassementEur)} HT intégré dans C) Travaux · {terrassementHint}</div>}
            {marcheFromLS && <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderLeft: "4px solid #10b981", borderRadius: 12, fontSize: 12, color: "#065f46", display: "flex", alignItems: "center", gap: 8 }}>📊 <strong>Données marché chargées</strong> — {marcheFromLS.dvf?.nb_transactions ?? '?'} transactions DVF · Prix médian {marcheFromLS.dvf?.prix_m2_median ? `${Math.round(marcheFromLS.dvf.prix_m2_median).toLocaleString("fr-FR")} €/m²` : '—'}</div>}
            {risquesFromSnap && <div style={{ marginBottom: 16, padding: "10px 16px", background: "rgba(82,71,184,0.06)", border: "1px solid rgba(82,71,184,0.2)", borderLeft: `4px solid ${ACCENT_PRO}`, borderRadius: 12, fontSize: 12, color: ACCENT_PRO, display: "flex", alignItems: "center", gap: 8 }}>🛡 <strong>Analyse de risques chargée</strong> — Score {risquesFromSnap.scores?.global ?? '?'}/100 · {risquesFromSnap.data?.gaspar?.catnat_count ?? '?'} CATNAT · {risquesFromSnap.meta?.commune_nom}</div>}

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
              {[{ label: "Prix moyen / logement", value: eur(computed.prixParLogement), color: isEmpty ? "#94a3b8" : "#0f172a" }, { label: "Coût / logement", value: eur(computed.coutParLogement), color: "#0f172a" }, { label: "Marge / logement", value: eur(computed.margeParLogement), color: isEmpty ? "#94a3b8" : (computed.margeParLogement >= 0 ? "#16a34a" : "#dc2626") }].map((k) => (
                <div key={k.label} style={kpiCard}><div style={kpiLabel}>{k.label}</div><div style={{ fontSize: 20, fontWeight: 900, color: k.color }}>{k.value}</div><div style={kpiSub}>÷ {nbLogements} logement{nbLogements > 1 ? "s" : ""}</div></div>
              ))}
            </div>

            <div style={{ ...card, marginBottom: 12, borderLeft: `4px solid ${ACCENT_PRO}`, background: "linear-gradient(135deg, #fafafe, #f4f3ff)" }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, color: ACCENT_PRO }}>📊 Lecture promoteur</div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "#334155", lineHeight: 1.75 }}>{lecturePromoteur.map((i, idx) => <li key={idx}>{i}</li>)}</ul>
            </div>

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

            <div style={{ ...card, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>📐 Données sources — Implantation 2D</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
                {[{ label: "Empreinte bâtiments", value: m2(footprintBuildingsM2), highlight: footprintBuildingsM2 > 0 }, { label: "Niveaux", value: `R+${floorsSpec.aboveGroundFloors} (${levelsCount} niv.)`, highlight: false }, { label: "SDP estimée", value: m2(sdpEstimatedM2), highlight: sdpEstimatedM2 > 0 }, { label: "Habitable estimée", value: m2(habitableEstimatedM2), highlight: habitableEstimatedM2 > 0 }, { label: "Vendable estimée", value: m2(surfaceVendableM2), highlight: true }, { label: "Prix DVF médian", value: marcheFromLS?.dvf?.prix_m2_median ? `${Math.round(marcheFromLS.dvf.prix_m2_median).toLocaleString("fr-FR")} €/m²` : "—", highlight: !!marcheFromLS?.dvf?.prix_m2_median }].map((item, i) => (
                  <div key={i} style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 12px", border: "1px solid #e8edf4" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: item.highlight ? ACCENT_PRO : (isEmpty ? "#94a3b8" : "#0f172a") }}>{item.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: hasStoreData ? "#16a34a" : "#f59e0b", fontWeight: 600 }}>{dataSourceLabel}</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Paramètres projet</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[
                    { label: "Type bâtiment",    node: <select style={inputStyle} value={buildingKind} onChange={(e) => setBuildingKind(e.target.value as BuildingKind)}><option value="COLLECTIF">Collectif</option><option value="INDIVIDUEL">Individuel</option></select> },
                    { label: "Étages (R+N)",      node: <input style={inputStyle} type="number" min={0} max={40} value={floorsSpec.aboveGroundFloors} onChange={(e) => setFloorsSpec((f) => ({ ...f, aboveGroundFloors: Math.max(0, Number(e.target.value) || 0) }))} /> },
                    { label: "Hauteur RDC (m)",   node: <input style={inputStyle} type="number" step="0.1" value={floorsSpec.groundFloorHeightM} onChange={(e) => setFloorsSpec((f) => ({ ...f, groundFloorHeightM: Number(e.target.value) || 2.8 }))} /> },
                    { label: "Hauteur étage (m)", node: <input style={inputStyle} type="number" step="0.1" value={floorsSpec.typicalFloorHeightM} onChange={(e) => setFloorsSpec((f) => ({ ...f, typicalFloorHeightM: Number(e.target.value) || 2.7 }))} /> },
                    { label: "Nb logements",      node: <input style={inputStyle} type="number" min={1} max={500} value={nbLogements} onChange={(e) => setNbLogements(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} /> },
                  ].map(({ label, node }) => <div key={label}><div style={labelStyle}>{label}</div>{node}</div>)}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>Hauteur totale estimée : <b>{totalHeightM.toFixed(1)} m</b></div>
              </div>
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>Hypothèses</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                  <div><div style={labelStyle}>Prix vente (€/m² vend.)</div><input style={inputStyle} type="number" value={ass.salePriceEurM2Hab} onChange={(e) => updateAss("salePriceEurM2Hab", Number(e.target.value) || 0)} /></div>
                  <div><div style={labelStyle}>Commercialisation (%)</div><input style={inputStyle} type="number" value={ass.commercialisationPct} onChange={(e) => updateAss("commercialisationPct", pct(e.target.value, 100))} /></div>
                  <div><div style={labelStyle}>Coef vendable</div><input style={inputStyle} type="number" step="0.01" min={0.8} max={1.2} value={ass.coefVendable} onChange={(e) => updateAss("coefVendable", Math.min(1.2, Math.max(0.8, Number(e.target.value) || 1)))} /></div>
                  <div><div style={labelStyle}>Foncier (€)</div><input style={inputStyle} type="number" placeholder="ex: 450 000" value={Number.isFinite(ass.landPriceEur) ? ass.landPriceEur : ""} onChange={(e) => updateAss("landPriceEur", e.target.value === "" ? NaN : Number(e.target.value))} /></div>
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
                  <div style={{ gridColumn: "span 2" }}>
                    <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
                      Terrassement & fondations (€ HT)
                      {terrassementHint && <span style={{ fontSize: 10, fontWeight: 400, color: ACCENT_PRO, background: "rgba(82,71,184,0.08)", borderRadius: 4, padding: "1px 6px" }}>🏗 Massing 3D · {terrassementHint}</span>}
                    </div>
                    <input style={inputStyle} type="number" min={0} step={500} placeholder="0 — ou calculé automatiquement depuis Massing 3D" value={ass.terrassementEur === 0 ? "" : ass.terrassementEur} onChange={(e) => updateAss("terrassementEur", Number(e.target.value) || 0)} />
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>Saisie manuelle ou synchronisé automatiquement depuis Massing 3D</div>
                  </div>
                </div>
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
                        const isSubtotal = l.kind === "subtotal"; const isTotal = l.kind === "total"; const isNegative = l.valueEur < 0; const isTerr = l.label === "Terrassement & fondations";
                        return (
                          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 180px 160px", gap: 12, padding: "9px 14px", borderTop: idx === 0 ? "none" : `1px solid ${isTotal ? "rgba(255,255,255,0.08)" : "#f1f5f9"}`, background: isTotal ? "#1e293b" : isSubtotal ? "#f1f5f9" : isTerr ? "rgba(82,71,184,0.04)" : "white", color: isTotal ? "white" : isNegative ? "#dc2626" : "#0f172a", fontWeight: isTotal ? 900 : isSubtotal ? 700 : 500, alignItems: "center", fontSize: 13 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>{isTerr && <span style={{ fontSize: 11, background: "rgba(82,71,184,0.1)", color: ACCENT_PRO, borderRadius: 4, padding: "1px 5px", fontWeight: 700, flexShrink: 0 }}>Terrain</span>}{l.label}</div>
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