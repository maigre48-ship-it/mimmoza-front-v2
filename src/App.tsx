// src/App.tsx

import { useState, useCallback, useEffect } from "react";
import { Routes, Route, Navigate, Outlet, useNavigate, useParams } from "react-router-dom";
import { wgs84ToLambert93 } from "./lib/projection";

// Layout global + sync
import { AppShell } from "./components/AppShell";
import { SpaceSync, type Space } from "./components/SpaceSync";

import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";

// ✅ Test Banque Risques
import BanqueRisquesTestPage from "./pages/BanqueRisquesTestPage";

// =========================
// Particulier — pages (COMPLET)
// =========================
import ParticulierDashboard from "./spaces/particulier/pages/Dashboard";
import ParticulierMonProjet from "./spaces/particulier/pages/MonProjet";
import ParticulierFavoris from "./spaces/particulier/pages/Favoris";
import ParticulierRechercheBiens from "./spaces/particulier/pages/RechercheBiens";
import ParticulierAlertes from "./spaces/particulier/pages/Alertes";
import ParticulierComparateur from "./spaces/particulier/pages/Comparateur";
import ParticulierEstimation from "./spaces/particulier/pages/Estimation";
import ParticulierQuartier from "./spaces/particulier/pages/Quartier";
import ParticulierCharges from "./spaces/particulier/pages/Charges";
import ParticulierCapacite from "./spaces/particulier/pages/Capacite";
import ParticulierScenarios from "./spaces/particulier/pages/Scenarios";
import ParticulierDossierBanque from "./spaces/particulier/pages/DossierBanque";
import ParticulierBudgetTravaux from "./spaces/particulier/pages/BudgetTravaux";
import ParticulierConformite from "./spaces/particulier/pages/Conformite";
import ParticulierPlanning from "./spaces/particulier/pages/Planning";
import ParticulierMesDocuments from "./spaces/particulier/pages/MesDocuments";
import ParticulierExports from "./spaces/particulier/pages/Exports";
import ParticulierHistorique from "./spaces/particulier/pages/Historique";

// =========================
// Marchand — pages (socle)
// =========================
import MarchandLayout from "./spaces/marchand/MarchandLayout";
import MarchandPipeline from "./spaces/marchand/pages/Pipeline";
import MarchandQualification from "./spaces/marchand/pages/Qualification";
import MarchandRentabilite from "./spaces/marchand/pages/Rentabilite";
import MarchandExecution from "./spaces/marchand/pages/Execution";
import MarchandSortie from "./spaces/marchand/pages/Sortie";
import MarchandExports from "./spaces/marchand/pages/Exports";
import MarchandAnalyseBien from "./spaces/marchand/pages/AnalyseBien";
import MarchandTravaux from "./spaces/marchand/pages/Travaux";
import { SourcingHomePage } from "./spaces/sourcing";

// =========================
// Promoteur — pages (socle)
// =========================
import PromoteurDashboard from "./spaces/promoteur/pages/Dashboard";
import FoncierPluPage from "./spaces/promoteur/pages/FoncierPluPage";
import MarchePage from "./spaces/promoteur/etudes/marche/MarchePage";
import RisquesPage from "./spaces/promoteur/etudes/risques/RisquesPage";
import PromoteurMassing3D from "./spaces/promoteur/pages/Massing3D";
import PromoteurBilan from "./spaces/promoteur/pages/Bilan";
import PromoteurSynthese from "./spaces/promoteur/pages/Synthese";
import PromoteurExports from "./spaces/promoteur/pages/Exports";
import Implantation2DPage from "./spaces/promoteur/Implantation2DPage";
import BilanPromoteurPage from "./spaces/promoteur/bilan-promoteur/BilanPromoteurPage";

// =========================
// Banque — refactored
// =========================
import BanqueLayout from "./spaces/banque/components/BanqueLayout";
import BanquePipeline from "./spaces/banque/pages/Pipeline";
import BanqueDossierPage from "./spaces/banque/pages/DossierPage";
import BanqueAnalysePage from "./spaces/banque/pages/AnalysePage";
import BanqueComitePage from "./spaces/banque/pages/ComitePage";
import BanqueAlertes from "./spaces/banque/pages/Alertes";
import BanqueSmartScoreDebug from "./spaces/banque/pages/SmartScoreDebug";
import BanqueRedirectToDossier from "./spaces/banque/pages/BanqueRedirectToDossier";

// =========================
// Assurance — pages (now served under /banque/assurance/*)
// =========================
import AssuranceDashboard from "./spaces/assurance/pages/Dashboard";
import AssuranceSouscription from "./spaces/assurance/pages/Souscription";
import AssuranceExposition from "./spaces/assurance/pages/Exposition";
import AssuranceTarification from "./spaces/assurance/pages/Tarification";
import AssuranceOffre from "./spaces/assurance/pages/Offre";
import AssuranceMonitoring from "./spaces/assurance/pages/Monitoring";
import AssuranceDocuments from "./spaces/assurance/pages/Documents";

// =========================
// Due Diligence hook (Marchand page)
// =========================
import { useDueDiligence } from "./spaces/banque/hooks/useDueDiligence";
import type { DueDiligenceStatus } from "./spaces/banque/types/dueDiligence.types";

// =========================
// Types globaux (dev helpers)
// =========================
declare global {
  interface Window {
    __mimmozaProjection?: (lon: number, lat: number) => { x: number; y: number };
    __mimmozaElevation?: (deptCode: string, lon: number, lat: number) => Promise<unknown>;
  }
}

/**
 * Type-safe space → path resolver.
 * Uses a function instead of Record<Space, string> so we don't need to
 * enumerate Space values that may still exist in SpaceSync but are no
 * longer routed as standalone spaces (audit, assurance).
 * Those gracefully fall back to "/".
 */
function getSpacePath(space: Space): string {
  switch (space) {
    case "promoteur": return "/promoteur";
    case "agence":    return "/particulier";
    case "marchand":  return "/marchand-de-bien";
    case "banque":    return "/banque";
    default:          return "/";
  }
}

// ── Redirect helpers (inline) ──

function BanqueRedirectToComite() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/banque/comite/${id ?? ""}`} replace />;
}

function BanqueRedirectToAnalyse() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/banque/analyse/${id ?? ""}`} replace />;
}

// ── Status helpers ──

const DD_STATUSES: DueDiligenceStatus[] = ["OK", "WARNING", "CRITICAL", "MISSING", "NA"];

const STATUS_COLORS: Record<DueDiligenceStatus, { bg: string; text: string; border: string }> = {
  OK:       { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" },
  WARNING:  { bg: "#fffbeb", text: "#b45309", border: "#fde68a" },
  CRITICAL: { bg: "#fef2f2", text: "#b91c1c", border: "#fecaca" },
  MISSING:  { bg: "#f9fafb", text: "#6b7280", border: "#e5e7eb" },
  NA:       { bg: "#f5f3ff", text: "#6d28d9", border: "#ddd6fe" },
};

// ── Marchand Due Diligence Page ──

function MarchandDueDiligencePage() {
  const dossierId = "DOSS-TEST-001";
  const { report, setStatus, setValue } = useDueDiligence(dossierId);
  const computed = report.computed;

  const score = computed?.score ?? 0;
  const completionPct = computed ? Math.round(computed.completionRate * 100) : 0;
  const criticalCount = computed?.criticalCount ?? 0;
  const warningCount = computed?.warningCount ?? 0;

  // Score color
  const scoreColor = score >= 80 ? "#15803d" : score >= 50 ? "#b45309" : "#b91c1c";

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem" }}>
      {/* Header */}
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.25rem" }}>
        Due Diligence
      </h1>
      <p style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Dossier : {dossierId}
      </p>

      {/* KPI Banner */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        {/* Score */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: "1rem",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>
            Score global
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: scoreColor }}>
            {score}
          </div>
          <div style={{ fontSize: "0.7rem", color: "#9ca3af" }}>/100</div>
        </div>

        {/* Completion */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            padding: "1rem",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>
            Complétion
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#1d4ed8" }}>
            {completionPct}%
          </div>
          <div style={{ fontSize: "0.7rem", color: "#9ca3af" }}>
            {computed?.completedItems ?? 0}/{computed?.totalItems ?? 0}
          </div>
        </div>

        {/* Critical */}
        <div
          style={{
            background: criticalCount > 0 ? "#fef2f2" : "#fff",
            border: `1px solid ${criticalCount > 0 ? "#fecaca" : "#e5e7eb"}`,
            borderRadius: 8,
            padding: "1rem",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>
            Critiques
          </div>
          <div
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              color: criticalCount > 0 ? "#b91c1c" : "#6b7280",
            }}
          >
            {criticalCount}
          </div>
        </div>

        {/* Warning */}
        <div
          style={{
            background: warningCount > 0 ? "#fffbeb" : "#fff",
            border: `1px solid ${warningCount > 0 ? "#fde68a" : "#e5e7eb"}`,
            borderRadius: 8,
            padding: "1rem",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>
            Avertissements
          </div>
          <div
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              color: warningCount > 0 ? "#b45309" : "#6b7280",
            }}
          >
            {warningCount}
          </div>
        </div>
      </div>

      {/* Categories + Items */}
      {report.categories.map((cat) => (
        <div
          key={cat.key}
          style={{
            marginBottom: "1.5rem",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {/* Category header */}
          <div
            style={{
              background: "#f9fafb",
              padding: "0.75rem 1rem",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>{cat.label}</span>
            {cat.description && (
              <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{cat.description}</span>
            )}
          </div>

          {/* Items */}
          {cat.items.map((item) => {
            const colors = STATUS_COLORS[item.status];
            return (
              <div
                key={item.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto 1fr",
                  gap: "0.75rem",
                  alignItems: "center",
                  padding: "0.625rem 1rem",
                  borderBottom: "1px solid #f3f4f6",
                  background: colors.bg,
                }}
              >
                {/* Label */}
                <div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>{item.label}</div>
                  {item.description && (
                    <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: 2 }}>
                      {item.description}
                    </div>
                  )}
                </div>

                {/* Status select */}
                <select
                  value={item.status}
                  onChange={(e) => setStatus(item.key, e.target.value as DueDiligenceStatus)}
                  style={{
                    padding: "0.25rem 0.5rem",
                    borderRadius: 6,
                    border: `1px solid ${colors.border}`,
                    background: "#fff",
                    color: colors.text,
                    fontWeight: 600,
                    fontSize: "0.8rem",
                    cursor: "pointer",
                    minWidth: 110,
                  }}
                >
                  {DD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                {/* Comment input */}
                <input
                  type="text"
                  placeholder="Commentaire…"
                  defaultValue={item.comment ?? ""}
                  onBlur={(e) => {
                    const val = e.target.value.trim();
                    if (val !== (item.comment ?? "")) {
                      setValue(item.key, val, val);
                    }
                  }}
                  style={{
                    padding: "0.25rem 0.5rem",
                    borderRadius: 6,
                    border: "1px solid #e5e7eb",
                    fontSize: "0.8rem",
                    width: "100%",
                  }}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── AppRoot ──

function AppRoot() {
  const [currentSpace, setCurrentSpace] = useState<Space>("none");
  const navigate = useNavigate();

  const handleChangeSpace = useCallback(
    (space: Space) => {
      setCurrentSpace(space);
      navigate(getSpacePath(space));
    },
    [navigate]
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__mimmozaProjection = (lon: number, lat: number) => {
      const { x, y } = wgs84ToLambert93(lon, lat);
      console.log("[mimmoza] projection EPSG:4326 -> EPSG:2154", { lon, lat, x, y });
      return { x, y };
    };
    window.__mimmozaElevation = async (deptCode: string, lon: number, lat: number) => {
      const { x, y } = wgs84ToLambert93(lon, lat);
      const resp = await fetch("http://localhost:4010/elevation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deptCode, points: [{ x, y }] }),
      });
      const json = await resp.json();
      console.log("[mimmoza] elevation", { deptCode, lon, lat, x, y, json });
      return json;
    };
    const { x, y } = wgs84ToLambert93(2.3522, 48.8566);
    console.log("[mimmoza] DEV helpers ready. Paris (Lambert93) ≈", { x, y });
  }, []);

  return (
    <>
      <SpaceSync setCurrentSpace={setCurrentSpace} />

      <AppShell currentSpace={currentSpace} onChangeSpace={handleChangeSpace}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />

          {/* ═══ Particulier ═══ */}
          <Route path="/particulier" element={<Outlet />}>
            <Route index element={<ParticulierDashboard />} />
            <Route path="projet" element={<ParticulierMonProjet />} />
            <Route path="favoris" element={<ParticulierFavoris />} />
            <Route path="recherche" element={<ParticulierRechercheBiens />} />
            <Route path="alertes" element={<ParticulierAlertes />} />
            <Route path="comparateur" element={<ParticulierComparateur />} />
            <Route path="estimation" element={<ParticulierEstimation />} />
            <Route path="evaluation" element={<Navigate to="/particulier/estimation" replace />} />
            <Route path="quartier" element={<ParticulierQuartier />} />
            <Route path="charges" element={<ParticulierCharges />} />
            <Route path="financement" element={<ParticulierCapacite />} />
            <Route path="scenarios" element={<ParticulierScenarios />} />
            <Route path="dossier" element={<ParticulierDossierBanque />} />
            <Route path="travaux" element={<ParticulierBudgetTravaux />} />
            <Route path="conformite" element={<ParticulierConformite />} />
            <Route path="planning" element={<ParticulierPlanning />} />
            <Route path="documents" element={<ParticulierMesDocuments />} />
            <Route path="exports" element={<ParticulierExports />} />
            <Route path="historique" element={<ParticulierHistorique />} />
            <Route path="*" element={<Navigate to="/particulier" replace />} />
          </Route>

          {/* ═══ Marchand (Investisseur) ═══ */}
          <Route path="/marchand-de-bien" element={<MarchandLayout />}>
            <Route index element={<MarchandPipeline />} />
            <Route path="sourcing" element={<SourcingHomePage />} />
            <Route path="qualification" element={<MarchandQualification />} />
            <Route path="analyse" element={<MarchandAnalyseBien />} />
            <Route path="due-diligence" element={<MarchandDueDiligencePage />} />
            <Route path="rentabilite" element={<MarchandRentabilite />} />
            <Route path="execution" element={<MarchandExecution />} />
            <Route path="planning" element={<MarchandTravaux />} />
            <Route path="sortie" element={<MarchandSortie />} />
            <Route path="exports" element={<MarchandExports />} />
            <Route path="estimation" element={<ParticulierEstimation />} />
            <Route path="marche" element={<MarchePage />} />
            <Route path="risques" element={<RisquesPage />} />
            <Route path="*" element={<Navigate to="/marchand-de-bien" replace />} />
          </Route>

          {/* ═══ Promoteur ═══ */}
          <Route path="/promoteur" element={<Outlet />}>
            <Route index element={<PromoteurDashboard />} />
            <Route path="foncier" element={<FoncierPluPage />} />
            <Route path="plu-faisabilite" element={<Navigate to="/promoteur/foncier" replace />} />
            <Route path="faisabilite" element={<Navigate to="/promoteur/foncier" replace />} />
            <Route path="marche" element={<MarchePage />} />
            <Route path="risques" element={<RisquesPage />} />
            <Route path="implantation-2d" element={<Implantation2DPage />} />
            <Route path="massing-3d" element={<PromoteurMassing3D />} />
            <Route path="bilan" element={<PromoteurBilan />} />
            <Route path="bilan-promoteur" element={<BilanPromoteurPage />} />
            <Route path="synthese" element={<PromoteurSynthese />} />
            <Route path="exports" element={<PromoteurExports />} />
            <Route path="estimation" element={<ParticulierEstimation />} />
            <Route path="*" element={<Navigate to="/promoteur" replace />} />
          </Route>

          {/* ═══════════════════════════════════════════
              Banque / Assurance — UNIFIED
              Workflow: Dossiers → Dossier → Analyse → Comité
              + Assurance pages under /banque/assurance/*
              Layout unique: BanqueLayout (nav + Changer de dossier)
             ═══════════════════════════════════════════ */}
          <Route path="/banque" element={<BanqueLayout />}>
            <Route index element={<Navigate to="/banque/dossiers" replace />} />

            {/* Main workflow */}
            <Route path="dossiers" element={<BanquePipeline />} />
            <Route path="dossier/:id" element={<BanqueDossierPage />} />
            <Route path="analyse/:id" element={<BanqueAnalysePage />} />
            <Route path="comite/:id" element={<BanqueComitePage />} />

            {/* Utilities */}
            <Route path="alertes" element={<BanqueAlertes />} />
            <Route path="smartscore-debug" element={<BanqueSmartScoreDebug />} />
            <Route path="risques-test" element={<BanqueRisquesTestPage />} />

            {/* Shared tools */}
            <Route path="estimation" element={<ParticulierEstimation />} />
            <Route path="marche" element={<MarchePage />} />
            <Route path="outil-risques/:id" element={<RisquesPage />} />

            {/* ── Assurance (now under /banque/assurance/*) ── */}
            <Route path="assurance" element={<Outlet />}>
              <Route index element={<AssuranceDashboard />} />
              <Route path="souscription" element={<AssuranceSouscription />} />
              <Route path="exposition" element={<AssuranceExposition />} />
              <Route path="tarification" element={<AssuranceTarification />} />
              <Route path="offre" element={<AssuranceOffre />} />
              <Route path="monitoring" element={<AssuranceMonitoring />} />
              <Route path="documents" element={<AssuranceDocuments />} />
              <Route path="estimation" element={<ParticulierEstimation />} />
              <Route path="marche" element={<MarchePage />} />
              <Route path="risques" element={<RisquesPage />} />
              <Route path="*" element={<Navigate to="/banque/assurance" replace />} />
            </Route>

            {/* ── Redirections anciennes routes ── */}
            <Route path="garanties/:id" element={<BanqueRedirectToDossier />} />
            <Route path="documents/:id" element={<BanqueRedirectToDossier />} />
            <Route path="decision/:id" element={<BanqueRedirectToComite />} />
            <Route path="smartscore/:id" element={<BanqueRedirectToAnalyse />} />
            <Route path="risque/:id" element={<BanqueRedirectToAnalyse />} />
            <Route path="risques/:id" element={<BanqueRedirectToAnalyse />} />
            <Route path="origination" element={<Navigate to="/banque/dossiers" replace />} />
            <Route path="monitoring" element={<Navigate to="/banque/alertes" replace />} />
            <Route path="pipeline" element={<Navigate to="/banque/dossiers" replace />} />

            {/* Fallbacks (routes sans :id) */}
            <Route path="garanties" element={<Navigate to="/banque/dossiers" replace />} />
            <Route path="documents" element={<Navigate to="/banque/dossiers" replace />} />
            <Route path="decision" element={<Navigate to="/banque/dossiers" replace />} />
            <Route path="comite" element={<Navigate to="/banque/dossiers" replace />} />
            <Route path="analyse" element={<Navigate to="/banque/dossiers" replace />} />
            <Route path="risque" element={<Navigate to="/banque/dossiers" replace />} />
            <Route path="risques" element={<Navigate to="/banque/dossiers" replace />} />
            <Route path="dossier" element={<Navigate to="/banque/dossiers" replace />} />
            <Route path="*" element={<Navigate to="/banque/dossiers" replace />} />
          </Route>

          {/* ═══ Compatibility redirects ═══ */}
          <Route path="/assurance/*" element={<Navigate to="/banque/assurance" replace />} />
          <Route path="/audit/*" element={<Navigate to="/" replace />} />

          {/* Aliases */}
          <Route path="/agence" element={<Navigate to="/particulier" replace />} />
          <Route path="/marchand" element={<Navigate to="/marchand-de-bien" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </>
  );
}

export default function App() {
  return <AppRoot />;
}