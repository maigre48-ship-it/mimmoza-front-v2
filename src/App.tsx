// src/App.tsx

import { useState, useCallback, useEffect } from "react";
import { Routes, Route, Navigate, Outlet, useNavigate } from "react-router-dom";
import { wgs84ToLambert93 } from "./lib/projection";

// Layout global + sync
import { AppShell } from "./components/AppShell";
import { SpaceSync, type Space } from "./components/SpaceSync";

import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";

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
// import MarchandSourcing from "./spaces/marchand/pages/Sourcing"; // ⛔ remplacé par SourcingHomePage
import MarchandQualification from "./spaces/marchand/pages/Qualification";
import MarchandRentabilite from "./spaces/marchand/pages/Rentabilite";
import MarchandExecution from "./spaces/marchand/pages/Execution";
import MarchandSortie from "./spaces/marchand/pages/Sortie";
import MarchandExports from "./spaces/marchand/pages/Exports";

// ✅ Nouveau module Sourcing (transversal)
import { SourcingHomePage } from "./spaces/sourcing";

// =========================
// Promoteur — pages (socle)
// =========================
import PromoteurDashboard from "./spaces/promoteur/pages/Dashboard";
import PromoteurFoncier from "./spaces/promoteur/pages/Foncier";
import PromoteurPluFaisabilite from "./spaces/promoteur/pages/PluFaisabilite";

import MarchePage from "./spaces/promoteur/etudes/marche/MarchePage";
import RisquesPage from "./spaces/promoteur/pages/Risques";

import PromoteurMassing3D from "./spaces/promoteur/pages/Massing3D";
import PromoteurBilan from "./spaces/promoteur/pages/Bilan";
import PromoteurSynthese from "./spaces/promoteur/pages/Synthese";
import PromoteurExports from "./spaces/promoteur/pages/Exports";

import Implantation2DPage from "./spaces/promoteur/Implantation2DPage";
import BilanPromoteurPage from "./spaces/promoteur/bilan-promoteur/BilanPromoteurPage";

// =========================
// Banque — pages (socle)
// =========================
import BanqueDashboard from "./spaces/banque/pages/Dashboard";
import BanqueOrigination from "./spaces/banque/pages/Origination";
import BanqueAnalyse from "./spaces/banque/pages/Analyse";
import BanqueGaranties from "./spaces/banque/pages/Garanties";
import BanqueDecision from "./spaces/banque/pages/Decision";
import BanqueMonitoring from "./spaces/banque/pages/Monitoring";
import BanqueDocuments from "./spaces/banque/pages/Documents";

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

// =========================
// Mapping Space -> Path pour navigation
// =========================
const SPACE_PATHS: Record<Space, string> = {
  none: "/",
  audit: "/audit",
  promoteur: "/promoteur",
  agence: "/particulier",
  marchand: "/marchand-de-bien",
  banque: "/banque",
  assurance: "/assurance",
};

// =========================
// Composant wrapper interne (avec accès à useNavigate)
// =========================
function AppRoot() {
  const [currentSpace, setCurrentSpace] = useState<Space>("none");
  const navigate = useNavigate();

  // Handler pour changer d'espace (appelé par AppShell)
  const handleChangeSpace = useCallback(
    (space: Space) => {
      setCurrentSpace(space);
      navigate(SPACE_PATHS[space]);
    },
    [navigate]
  );

  // DEV helpers (non intrusif, ne tourne pas en prod)
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
      {/* Synchronise le pathname avec currentSpace */}
      <SpaceSync setCurrentSpace={setCurrentSpace} />

      {/* Layout global */}
      <AppShell currentSpace={currentSpace} onChangeSpace={handleChangeSpace}>
        <Routes>
          {/* Accueil */}
          <Route path="/" element={<HomePage />} />

          {/* Login */}
          <Route path="/login" element={<LoginPage />} />

          {/* =========================
              Particulier (COMPLET)
             ========================= */}
          <Route path="/particulier" element={<Outlet />}>
            {/* Démarrer */}
            <Route index element={<ParticulierDashboard />} />
            <Route path="projet" element={<ParticulierMonProjet />} />
            <Route path="favoris" element={<ParticulierFavoris />} />

            {/* Recherche */}
            <Route path="recherche" element={<ParticulierRechercheBiens />} />
            <Route path="alertes" element={<ParticulierAlertes />} />
            <Route path="comparateur" element={<ParticulierComparateur />} />

            {/* Évaluation */}
            <Route path="estimation" element={<ParticulierEstimation />} />
            <Route path="evaluation" element={<Navigate to="/particulier/estimation" replace />} />
            <Route path="quartier" element={<ParticulierQuartier />} />
            <Route path="charges" element={<ParticulierCharges />} />

            {/* Financement */}
            <Route path="financement" element={<ParticulierCapacite />} />
            <Route path="scenarios" element={<ParticulierScenarios />} />
            <Route path="dossier" element={<ParticulierDossierBanque />} />

            {/* Travaux */}
            <Route path="travaux" element={<ParticulierBudgetTravaux />} />
            <Route path="conformite" element={<ParticulierConformite />} />
            <Route path="planning" element={<ParticulierPlanning />} />

            {/* Documents */}
            <Route path="documents" element={<ParticulierMesDocuments />} />
            <Route path="exports" element={<ParticulierExports />} />
            <Route path="historique" element={<ParticulierHistorique />} />

            <Route path="*" element={<Navigate to="/particulier" replace />} />
          </Route>

          {/* =========================
              Marchand de bien
             ========================= */}
          <Route path="/marchand-de-bien" element={<MarchandLayout />}>
            <Route index element={<MarchandPipeline />} />

            {/* ✅ Sourcing: utilise le nouveau module transversal */}
            <Route path="sourcing" element={<SourcingHomePage />} />

            <Route path="qualification" element={<MarchandQualification />} />
            <Route path="rentabilite" element={<MarchandRentabilite />} />
            <Route path="execution" element={<MarchandExecution />} />
            <Route path="sortie" element={<MarchandSortie />} />
            <Route path="exports" element={<MarchandExports />} />
            <Route path="estimation" element={<ParticulierEstimation />} />
            <Route path="marche" element={<MarchePage />} />
            <Route path="*" element={<Navigate to="/marchand-de-bien" replace />} />
          </Route>

          {/* =========================
              Promoteur
             ========================= */}
          <Route path="/promoteur" element={<Outlet />}>
            <Route index element={<PromoteurDashboard />} />
            <Route path="foncier" element={<PromoteurFoncier />} />
            <Route path="plu-faisabilite" element={<PromoteurPluFaisabilite />} />
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

          {/* =========================
              Banque
             ========================= */}
          <Route path="/banque" element={<Outlet />}>
            <Route index element={<BanqueDashboard />} />
            <Route path="origination" element={<BanqueOrigination />} />
            <Route path="analyse" element={<BanqueAnalyse />} />
            <Route path="garanties" element={<BanqueGaranties />} />
            <Route path="decision" element={<BanqueDecision />} />
            <Route path="monitoring" element={<BanqueMonitoring />} />
            <Route path="documents" element={<BanqueDocuments />} />
            <Route path="estimation" element={<ParticulierEstimation />} />
            <Route path="marche" element={<MarchePage />} />
            <Route path="*" element={<Navigate to="/banque" replace />} />
          </Route>

          {/* =========================
              Assurance
             ========================= */}
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
            <Route path="*" element={<Navigate to="/assurance" replace />} />
          </Route>

          {/* =========================
              Audit (placeholder pour cohérence avec AppShell)
             ========================= */}
          <Route path="/audit" element={<Outlet />}>
            <Route
              index
              element={
                <div className="p-8 text-center text-slate-500">
                  <h1 className="text-2xl font-bold mb-2">Espace Audit</h1>
                  <p>Coming soon — Analyse PLU, risques et SmartScore</p>
                </div>
              }
            />
            <Route path="*" element={<Navigate to="/audit" replace />} />
          </Route>

          {/* =========================
              Agence (placeholder pour cohérence avec AppShell)
             ========================= */}
          <Route path="/agence" element={<Navigate to="/particulier" replace />} />

          {/* =========================
              Marchand (alias court)
             ========================= */}
          <Route path="/marchand" element={<Navigate to="/marchand-de-bien" replace />} />

          {/* Fallback global */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </>
  );
}

// =========================
// Export principal
// =========================
export default function App() {
  return <AppRoot />;
}
