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
// Assurance — pages (socle)
// =========================
import AssuranceDashboard from "./spaces/assurance/pages/Dashboard";
import AssuranceSouscription from "./spaces/assurance/pages/Souscription";
import AssuranceExposition from "./spaces/assurance/pages/Exposition";
import AssuranceTarification from "./spaces/assurance/pages/Tarification";
import AssuranceOffre from "./spaces/assurance/pages/Offre";
import AssuranceMonitoring from "./spaces/assurance/pages/Monitoring";
import AssuranceDocuments from "./spaces/assurance/pages/Documents";

// =========================
// Types globaux (dev helpers)
// =========================
declare global {
  interface Window {
    __mimmozaProjection?: (lon: number, lat: number) => { x: number; y: number };
    __mimmozaElevation?: (deptCode: string, lon: number, lat: number) => Promise<unknown>;
  }
}

const SPACE_PATHS: Record<Space, string> = {
  none: "/",
  audit: "/audit",
  promoteur: "/promoteur",
  agence: "/particulier",
  marchand: "/marchand-de-bien",
  banque: "/banque",
  assurance: "/assurance",
};

// ── Redirect helpers (inline) ──

function BanqueRedirectToComite() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/banque/comite/${id ?? ""}`} replace />;
}

function BanqueRedirectToAnalyse() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/banque/analyse/${id ?? ""}`} replace />;
}

// ── AppRoot ──

function AppRoot() {
  const [currentSpace, setCurrentSpace] = useState<Space>("none");
  const navigate = useNavigate();

  const handleChangeSpace = useCallback(
    (space: Space) => {
      setCurrentSpace(space);
      navigate(SPACE_PATHS[space]);
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

          {/* ═══ Marchand ═══ */}
          <Route path="/marchand-de-bien" element={<MarchandLayout />}>
            <Route index element={<MarchandPipeline />} />
            <Route path="sourcing" element={<SourcingHomePage />} />
            <Route path="qualification" element={<MarchandQualification />} />
            <Route path="rentabilite" element={<MarchandRentabilite />} />
            <Route path="execution" element={<MarchandExecution />} />
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
              Banque — REFACTORED
              Workflow: Dossiers → Dossier → Analyse → Comité
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

          {/* ═══ Assurance ═══ */}
          <Route path="/assurance" element={<Outlet />}>
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
            <Route path="*" element={<Navigate to="/assurance" replace />} />
          </Route>

          {/* ═══ Audit ═══ */}
          <Route path="/audit" element={<Outlet />}>
            <Route index element={
              <div className="p-8 text-center text-slate-500">
                <h1 className="text-2xl font-bold mb-2">Espace Audit</h1>
                <p>Coming soon — Analyse PLU, risques et SmartScore</p>
              </div>
            } />
            <Route path="*" element={<Navigate to="/audit" replace />} />
          </Route>

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