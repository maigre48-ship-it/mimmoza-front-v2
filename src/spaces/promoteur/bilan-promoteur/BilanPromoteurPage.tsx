// src/spaces/promoteur/bilan-promoteur/BilanPromoteurPage.tsx
// Pro forma v3.1 — surfaceRehabM2 : champ surface en mode Réhabilitation
//   transmis depuis PromoteurSimulationTravauxPage via le bridge bilan.
//
// En mode Réhabilitation :
//   • sdpEffectiveM2    = surfaceRehabM2 (depuis simulation ou saisie manuelle)
//   • habitableM2       = sdpEffectiveM2 × coefHab
//   • surfaceVendableM2 = habitableM2 × coefVendable
//   • CA = surfaceVendableM2 × salePriceEurM2Hab
//   → Le bilan est positif dès que surface + prix de vente sont renseignés.

import React, { useMemo, useState, useEffect, useLayoutEffect, useRef } from "react";
import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useSearchParams } from "react-router-dom";
import { usePromoteurProjectStore } from "../store/promoteurProject.store";
import { patchModule, getSnapshot } from "../shared/promoteurSnapshot.store";
import { usePromoteurStudy } from "../shared/usePromoteurStudy";
import { GRAD_PRO, ACCENT_PRO } from "../shared/promoteurDesign.tokens";
import {
  PromoteurPageHero,
  HeroPrimaryButton,
  HeroGhostButton,
} from "../shared/components/PromoteurPageHero";
import { PromoteurSynthesePage } from "../pages/PromoteurSynthesePage";
import type { PromoteurRawInput } from "../services/promoteurSynthese.types";
import type { Implantation2DSnapshot } from "../plan2d/implantation2d.snapshot";
import {
  totalEmpriseM2 as snapTotalEmprise,
  totalSdpM2    as snapTotalSdp,
} from "../plan2d/implantation2d.snapshot";

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
function eur(v: number): string { try { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v); } catch { return `${Math.round(v)} €`; } }
function m2(v: number): string { return `${Math.round(v)} m²`; }
function safeAreaM2(feat: Feature<Geometry> | null | undefined): number { if (!feat?.geometry) return 0; try { return turf.area(feat as turf.AllGeoJSON); } catch { return 0; } }
function sumAreas(fc?: FeatureCollection<Geometry> | null): number { if (!fc?.features || !Array.isArray(fc.features)) return 0; return fc.features.reduce((acc, f) => acc + safeAreaM2(f as Feature<Geometry>), 0); }

type BuildingKind = "INDIVIDUEL" | "COLLECTIF";
type FloorsSpec   = { aboveGroundFloors: number; groundFloorHeightM: number; typicalFloorHeightM: number; };

// ── Assumptions v3.1 ─────────────────────────────────────────────────────────
type Assumptions = {
  salePriceEurM2Hab: number; commercialisationPct: number; coefVendable: number;
  landPriceEur: number; notaryFeesPct: number; acquisitionTaxesPct: number;
  worksCostEurM2Sdp: number; vrdPct: number; extPct: number; contingencyPct: number;
  surveyorEur: number; geotechEur: number; moePct: number; betPct: number;
  spsCtOpcEur: number; insuranceDoPct: number; miscEur: number;
  marketingPctCa: number; marketingFixedEur: number;
  financingRatePct: number; financingFeesEur: number; taxeAmenagementEurM2Sdp: number;
  terrassementEur: number;
  /** Montant travaux depuis simulation réhabilitation (0 = non défini) */
  travauxRehabTotal: number;
  /** true = utiliser travauxRehabTotal et surfaceRehabM2 */
  rehabMode: boolean;
  /** Surface SDP réhabilitée (m²) — transmise depuis la simulation ou saisie manuelle */
  surfaceRehabM2: number;
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
  travauxRehabTotal: 0,
  rehabMode: false,
  surfaceRehabM2: 0,
};

// ── computeProForma ───────────────────────────────────────────────────────────
function computeProForma(ass: Assumptions, sdpEstimatedM2: number, surfaceVendableM2: number) {
  const useRehab    = ass.rehabMode && ass.travauxRehabTotal > 0;
  const travauxBase = useRehab ? n(ass.travauxRehabTotal, 0) : sdpEstimatedM2 * n(ass.worksCostEurM2Sdp, 0);

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
    useRehab, travauxBase,
    caLogements, caTotal, foncier, fraisNotaire, taxesAcq, totalFoncier,
    surveyor, geotech, moe, bet, spsCtOpc, insuranceDo, misc, totalEtudes,
    vrd, ext, aleas, totalTravaux, taxeAmenagement, totalTaxes,
    marketingPct, marketingFixed, totalCom, intercalaires, fraisFin, totalFin,
    coutTotal, marge, margePct, coutRevientEurM2Hab, coutRevientEurM2Sdp,
  };
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

  // ── Bridge simulation travaux → bilan ─────────────────────────────────────
  useEffect(() => {
    // Lecture initiale (si l'utilisateur a cliqué avant d'ouvrir le bilan)
    try {
      const raw = localStorage.getItem(BILAN_TRAVAUX_KEY);
      if (raw) {
        const payload = JSON.parse(raw) as BilanTravauxBridgePayload;
        if (payload.totalWithBuffer > 0) {
          setAss((prev) => {
            // N'écrase que si pas encore de données réhab
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

    // Mise à jour live (bouton cliqué depuis la simulation)
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

  // SDP effective : en mode réhab, utilise surfaceRehabM2 ; sinon, surfaces 2D
  const sdpEstimatedM2 = useMemo(() => {
    if (ass.rehabMode && ass.surfaceRehabM2 > 0) return ass.surfaceRehabM2;
    if (footprintBuildingsM2Raw <= 0 && sdpFromSnap > 0) return sdpFromSnap;
    return footprintBuildingsM2 * levelsCount * 1.0;
  }, [ass.rehabMode, ass.surfaceRehabM2, footprintBuildingsM2Raw, footprintBuildingsM2, levelsCount, sdpFromSnap]);

  const habitableEstimatedM2 = useMemo(() => sdpEstimatedM2 * coefHab, [sdpEstimatedM2, coefHab]);
  const surfaceVendableM2    = useMemo(() => habitableEstimatedM2 * n(ass.coefVendable, 1), [habitableEstimatedM2, ass.coefVendable]);

  // ── Détection conflit ─────────────────────────────────────────────────────
  const hasConceptionData = footprintBuildingsM2 > 0 || sdpFromSnap > 0;
  const hasRehabData      = ass.travauxRehabTotal > 0;
  const realConflict      = hasConceptionData && hasRehabData;

  // ── Marché / risques ──────────────────────────────────────────────────────
  const marcheFromLS = useMemo(() => { try { const raw = localStorage.getItem(LS_MARKET_STUDY); if (!raw) return null; const p = JSON.parse(raw); return p?.data?.market ?? null; } catch { return null; } }, []); // eslint-disable-line
  const risquesFromSnap = useMemo(() => { try { const snap = getSnapshot() as any; return snap?.risks?.data ?? null; } catch { return null; } }, []); // eslint-disable-line

  // ── Computed ──────────────────────────────────────────────────────────────
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
    if (pf.useRehab) {
      lines.push({ section: "C) TRAVAUX", label: "🔧 Travaux réhabilitation (simulation)", valueEur: pf.travauxBase, hint: `${m2(ass.surfaceRehabM2)} · total + buffer` });
    } else {
      lines.push({ section: "C) TRAVAUX", label: "Travaux principaux", valueEur: pf.travauxBase, hint: `${m2(sdpEstimatedM2)} × ${ass.worksCostEurM2Sdp} €/m² SDP` });
    }
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
    if (sdpEstimatedM2 <= 0) notes.push("Surface SDP = 0 : renseignez la surface réhabilitée.");
    if (ass.salePriceEurM2Hab <= 0) notes.push("Prix de vente €/m² non renseigné : CA = 0.");
    if (!n(ass.landPriceEur, 0)) notes.push("Foncier non renseigné : le bilan est incomplet.");
    if (ass.terrassementEur > 0) notes.push(`Terrassement intégré : ${eur(ass.terrassementEur)} HT (${terrassementHint}).`);
    if (pf.useRehab) notes.push(`Mode Réhabilitation — Travaux = ${eur(pf.travauxBase)} · Surface = ${m2(ass.surfaceRehabM2)}.`);

    const safeNb = nbLogements > 0 ? nbLogements : 1;
    return {
      ...pf, coutTotal: pfCoutTotal, marge: pfMarge, margePct: pfMargePct,
      coutRevientEurM2Hab: pfCoutRevM2Hab, coutRevientEurM2Sdp: pfCoutRevM2Sdp,
      totalTravaux: pfTotalTravaux, lines, notes,
      prixParLogement: pf.caTotal / safeNb,
      coutParLogement: pfCoutTotal / safeNb,
      margeParLogement: pfMarge / safeNb,
    };
  }, [ass, sdpEstimatedM2, surfaceVendableM2, nbLogements, terrassementHint]);

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
      conception: { surfacePlancher: sdpEstimatedM2 > 0 ? sdpEstimatedM2 : undefined, nbLogements: nbLogements > 0 ? nbLogements : undefined, nbNiveaux: levelsCount > 0 ? levelsCount : undefined, hauteurProjet: totalHeightM > 0 ? totalHeightM : undefined, empriseBatie: footprintBuildingsM2 > 0 ? footprintBuildingsM2 : undefined, programmeType: ass.rehabMode ? "Réhabilitation" : buildingKind === "COLLECTIF" ? "Résidentiel collectif libre" : "Résidentiel individuel" },
      marche: { prixNeufM2: study?.marche?.prix_m2_neuf ?? (pricesLS?.median_eur_m2 > 0 ? pricesLS.median_eur_m2 : undefined) ?? (ass.salePriceEurM2Hab > 0 ? ass.salePriceEurM2Hab : undefined), prixAncienM2: study?.marche?.prix_m2_ancien ?? (dvfLS?.prix_m2_median > 0 ? dvfLS.prix_m2_median : undefined) ?? undefined, nbTransactionsDvf: study?.marche?.nb_transactions ?? (dvfLS?.nb_transactions > 0 ? dvfLS.nb_transactions : undefined) ?? (transactionsLS?.count > 0 ? transactionsLS.count : undefined) ?? undefined, prixMoyenDvf: study?.marche?.prix_moyen_dvf ?? (dvfLS?.prix_m2_moyen > 0 ? dvfLS.prix_m2_moyen : undefined) ?? (pricesLS?.mean_eur_m2 > 0 ? pricesLS.mean_eur_m2 : undefined) ?? undefined, offreConcurrente: study?.marche?.nb_programmes_concurrents ?? undefined, absorptionMensuelle: study?.marche?.absorption_mensuelle ?? undefined },
      risques: { risquesIdentifies, zonageRisque, scoreGlobal: riskScoreGlobal ?? undefined, nbCatnat: riskData?.gaspar?.catnat_count ?? undefined, nbSeveso: riskData?.icpe ? (riskData.icpe.seveso_haut_count ?? 0) + (riskData.icpe.seveso_bas_count ?? 0) : undefined, pprCount: riskData?.gaspar?.ppr_count ?? undefined, classeRadon: riskData?.radon?.classe_potentiel ?? undefined } as any,
      evaluation: { prixVenteM2: ass.salePriceEurM2Hab > 0 ? ass.salePriceEurM2Hab : undefined, prixVenteTotal: computed.caTotal > 0 ? computed.caTotal : undefined, nbLogementsLibres: nbLogements > 0 ? nbLogements : undefined },
      bilan: { coutFoncier: prixFoncierBrut > 0 ? prixFoncierBrut : undefined, coutTravaux: computed.totalTravaux > 0 ? computed.totalTravaux : undefined, coutTravauxM2: ass.rehabMode ? undefined : (ass.worksCostEurM2Sdp > 0 ? ass.worksCostEurM2Sdp : undefined), fraisFinanciers: computed.totalFin > 0 ? computed.totalFin : undefined, fraisCommercialisation: computed.totalCom > 0 ? computed.totalCom : undefined, fraisGestion: computed.totalEtudes > 0 ? computed.totalEtudes : undefined, chiffreAffaires: computed.caTotal > 0 ? computed.caTotal : undefined, margeNette: computed.marge, margeNettePercent: computed.margePct, trnRendement: computed.caTotal > 0 && computed.coutTotal > 0 ? (computed.marge / computed.coutTotal) * 100 : undefined, fondsPropres: undefined, creditPromoteur: undefined },
    };
  }, [study, ass, computed, sdpEstimatedM2, nbLogements, levelsCount, totalHeightM, footprintBuildingsM2, buildingKind, communeNom, codePostal, marcheFromLS, risquesFromSnap]);

  useEffect(() => {
    if (!(computed.caTotal > 0)) return;
    try { localStorage.setItem(SYNTHESE_RAW_KEY, JSON.stringify(synthesisRawInput)); } catch (e) { console.warn("[Bilan→Synthese] failed:", e); }
  }, [synthesisRawInput, computed.caTotal]);

  useEffect(() => {
    try {
      const ok = surfaceVendableM2 > 0 && computed.caTotal > 0;
      patchModule("bilan", { ok, marge_pct: computed.margePct, ca: computed.caTotal, summary: `Marge ${computed.margePct.toFixed(1)}% · CA ${Math.round(computed.caTotal).toLocaleString("fr-FR")}€`, data: { assumptions: ass, kpis: { caTotal: computed.caTotal, coutTotal: computed.coutTotal, marge: computed.marge, margePct: computed.margePct }, surfaces: { footprintBuildingsM2, footprintParkingsM2, sdpEstimatedM2, habitableEstimatedM2, surfaceVendableM2 }, params: { buildingKind, floorsSpec, nbLogements, levelsCount, totalHeightM }, rehabMode: ass.rehabMode, travauxRehabTotal: ass.travauxRehabTotal, surfaceRehabM2: ass.surfaceRehabM2, lines: computed.lines, notes: computed.notes, sensitivity } });
      if (studyId && surfaceVendableM2 > 0 && computed.caTotal > 0) {
        patchBilan({ prix_revient_total: computed.coutTotal, ca_previsionnel: computed.caTotal, marge_nette: computed.marge, taux_marge_nette_pct: computed.margePct, fonds_propres: null, credit_promotion: null, taux_credit_pct: ass.financingRatePct, duree_mois: null, roi_pct: null, tri_pct: null, ai_narrative: null, ai_generated_at: null, notes: computed.notes.join(" | ") || null, done: true }).catch((e) => console.warn("[BilanPromoteurPage] patchBilan failed:", e));
      }
    } catch (err) { console.warn("[BilanPromoteurPage] Erreur persistance:", err); }
  }, [computed, ass, surfaceVendableM2, footprintBuildingsM2, footprintParkingsM2, sdpEstimatedM2, habitableEstimatedM2, buildingKind, floorsSpec, nbLogements, levelsCount, totalHeightM, sensitivity, studyId, patchBilan, terrassementHint]);

  // ── UI ────────────────────────────────────────────────────────────────────
  const grouped = useMemo(() => { const map = new Map<string, Line[]>(); for (const l of computed.lines) { if (!map.has(l.section)) map.set(l.section, []); map.get(l.section)!.push(l); } return map; }, [computed.lines]);
  const handleSaveForSynthesis = () => { patchModule("bilan", { ok: true, validated: true }); setSynthesisSaved(true); setTimeout(() => setSynthesisSaved(false), 3000); };
  const scrollToStressTest = () => document.getElementById("stress-test")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const updateAss = <K extends keyof Assumptions>(key: K, value: Assumptions[K]) => setAss((s) => ({ ...s, [key]: value }));

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
  const sectionTitle: React.CSSProperties = { fontSize: 11, fontWeight: 900, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" as const };

  const lecturePromoteur = useMemo(() => {
    const ins: string[] = [];
    if (ass.rehabMode) ins.push(`🔧 Mode Réhabilitation — Travaux = ${eur(ass.travauxRehabTotal)} · Surface = ${m2(ass.surfaceRehabM2)}`);
    if (computed.margePct >= 20) ins.push("✅ Marge confortable (≥ 20%)");
    else if (computed.margePct >= 12) ins.push("⚠️ Marge moyenne (12-20%)");
    else if (computed.margePct > 0) ins.push("🔴 Marge faible (< 12%) — risque élevé");
    else ins.push("🔴 Marge négative — opération non viable en l'état");
    if (missingRehab) ins.push("⚠️ Surface réhabilitée non renseignée → CA = 0");
    if (foncierVide) ins.push("📋 Foncier non renseigné : bilan incomplet");
    if (ass.terrassementEur > 0) ins.push(`🏗 Terrassement : ${eur(ass.terrassementEur)} HT intégré`);
    return ins;
  }, [computed, ass, missingRehab, foncierVide]);

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
    <div style={{ background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 45%, #eef2ff 100%)", minHeight: "100vh", padding: 24, color: "#0f172a", fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>

        {/* Bannière */}
        <div style={{ marginBottom: 16 }}>
  <PromoteurPageHero
    badge="Promoteur · Bilan"
    title={`Bilan Promoteur${ass.rehabMode && ass.travauxRehabTotal > 0 ? " 🔧 Réhabilitation" : hasConceptionData ? " 🏗 Programme neuf" : ""}`}
    metaLines={[
      { text: "Pro forma détaillé — basé sur l'implantation 2D et des hypothèses ajustables." },
      ...(study?.foncier?.commune_insee ? [{ text: `INSEE ${study.foncier.commune_insee}` }] : []),
    ]}
    statCards={computed.caTotal > 0 ? [
      {
        label: "Marge brute",
        value: `${computed.margePct.toFixed(1)} %`,
        tone: "indigo" as const,
      },
      {
        label: "CA total",
        value: `${Math.round(computed.caTotal / 1000)} k€`,
        tone: "emerald" as const,
      },
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
          <HeroGhostButton onClick={handleExportExcel}>
            ⬇ Exporter Excel
          </HeroGhostButton>
        )}
      </>
    }
  />
</div>

        {activeTab === "synthese" ? <PromoteurSynthesePage rawInputOverride={synthesisRawInput} /> : (
          <>
            {realConflict && <ConflictBanner rehabTotal={ass.travauxRehabTotal} onUseNeuf={activateNeufMode} onUseRehab={activateRehabMode} />}
            {!realConflict && ass.rehabMode && ass.travauxRehabTotal > 0 && <RehabBanner rehabTotal={ass.travauxRehabTotal} surfaceM2={ass.surfaceRehabM2} onClear={clearRehabMode} />}

            {/* Alerte surface manquante */}
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
                <div key={k.label} style={kpiCard}><div style={kpiLabel}>{k.label}</div><div style={{ fontSize: 20, fontWeight: 900, color: k.color }}>{k.value}</div><div style={kpiSub}>÷ {nbLogements} logement{nbLogements > 1 ? "s" : ""}</div></div>
              ))}
            </div>

            {/* Lecture promoteur */}
            <div style={{ ...card, marginBottom: 12, borderLeft: `4px solid ${ACCENT_PRO}`, background: "linear-gradient(135deg, #fafafe, #f4f3ff)" }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, color: ACCENT_PRO }}>📊 Lecture promoteur</div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "#334155", lineHeight: 1.75 }}>{lecturePromoteur.map((i, idx) => <li key={idx}>{i}</li>)}</ul>
            </div>

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
                    { label: "Nb logements",      node: <input style={inputStyle} type="number" min={1} max={500} value={nbLogements} onChange={(e) => setNbLogements(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} /> },
                  ].map(({ label, node }) => <div key={label}><div style={labelStyle}>{label}</div>{node}</div>)}
                </div>

                {/* ── Champ surface UNIQUEMENT en mode réhabilitation ── */}
                {ass.rehabMode && (
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f1f5f9" }}>
                    <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6, color: missingRehab ? "#dc2626" : "#0f172a" }}>
                      📐 Surface SDP réhabilitée (m²)
                      {missingRehab && <span style={{ fontSize: 10, color: "#dc2626", fontWeight: 600 }}>⚠ requis</span>}
                    </div>
                    <input
                      style={{ ...inputStyle, border: `2px solid ${missingRehab ? "#dc2626" : ACCENT_PRO}`, background: missingRehab ? "#fff5f5" : "#faf5ff" }}
                      type="number"
                      min={0}
                      placeholder="Ex : 650 — surface totale réhabilitée en m²"
                      value={ass.surfaceRehabM2 === 0 ? "" : ass.surfaceRehabM2}
                      onChange={(e) => updateAss("surfaceRehabM2", Math.max(0, Number(e.target.value) || 0))}
                    />
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                      Pré-rempli depuis la Simulation Travaux. Surface vendable estimée = {m2(surfaceVendableM2)} ({(coefHab * 100).toFixed(0)}% × {n(ass.coefVendable, 1).toFixed(2)})
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>Hauteur estimée : <b>{totalHeightM.toFixed(1)} m</b></div>
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
                  {ass.rehabMode ? (
                    <div style={{ gridColumn: "span 2" }}>
                      <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
                        🔧 Travaux réhabilitation (€ HT)
                        <span style={{ fontSize: 10, color: ACCENT_PRO, background: ACCENT_PRO + "18", borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>Simulation</span>
                      </div>
                      <input style={{ ...inputStyle, borderColor: ACCENT_PRO, background: "#faf5ff" }} type="number" value={ass.travauxRehabTotal} onChange={(e) => updateAss("travauxRehabTotal", Number(e.target.value) || 0)} />
                    </div>
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
                  <div style={{ gridColumn: "span 2" }}>
                    <div style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 6 }}>
                      Terrassement & fondations (€ HT)
                      {terrassementHint && <span style={{ fontSize: 10, color: ACCENT_PRO, background: ACCENT_PRO + "18", borderRadius: 4, padding: "1px 6px" }}>🏗 Massing 3D</span>}
                    </div>
                    <input style={inputStyle} type="number" min={0} step={500} placeholder="0" value={ass.terrassementEur === 0 ? "" : ass.terrassementEur} onChange={(e) => updateAss("terrassementEur", Number(e.target.value) || 0)} />
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