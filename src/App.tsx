// src/App.tsx

import { Routes, Route, Navigate } from "react-router-dom";

import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage"; // ✅ AJOUT

// Layouts
import ParticulierLayout from "./spaces/particulier/ParticulierLayout";
import MarchandLayout from "./spaces/marchand/MarchandLayout";
import PromoteurLayout from "./spaces/promoteur/PromoteurLayout";
import BanqueLayout from "./spaces/banque/BanqueLayout";
import AssuranceLayout from "./spaces/assurance/AssuranceLayout";

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
import MarchandPipeline from "./spaces/marchand/pages/Pipeline";
import MarchandSourcing from "./spaces/marchand/pages/Sourcing";
import MarchandQualification from "./spaces/marchand/pages/Qualification";
import MarchandRentabilite from "./spaces/marchand/pages/Rentabilite";
import MarchandExecution from "./spaces/marchand/pages/Execution";
import MarchandSortie from "./spaces/marchand/pages/Sortie";
import MarchandExports from "./spaces/marchand/pages/Exports";

// =========================
// Promoteur — pages (socle)
// =========================
import PromoteurDashboard from "./spaces/promoteur/pages/Dashboard";
import PromoteurFoncier from "./spaces/promoteur/pages/Foncier";
import PromoteurPluFaisabilite from "./spaces/promoteur/pages/PluFaisabilite";
import PromoteurMarche from "./spaces/promoteur/pages/Marche";
import PromoteurRisques from "./spaces/promoteur/pages/Risques";
import PromoteurMassing3D from "./spaces/promoteur/pages/Massing3D";
import PromoteurBilan from "./spaces/promoteur/pages/Bilan";
import PromoteurSynthese from "./spaces/promoteur/pages/Synthese";
import PromoteurExports from "./spaces/promoteur/pages/Exports";

// ✅ IMPORTANT: utiliser la vraie page Implantation 2D (pas le placeholder)
import Implantation2DPage from "./spaces/promoteur/Implantation2DPage";

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

export default function App() {
  return (
    <Routes>
      {/* Accueil */}
      <Route path="/" element={<HomePage />} />

      {/* ✅ Login */}
      <Route path="/login" element={<LoginPage />} />

      {/* =========================
          Particulier (COMPLET)
         ========================= */}
      <Route path="/particulier" element={<ParticulierLayout />}>
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
        {/* compat ancien chemin */}
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

      {/* Marchand de bien */}
      <Route path="/marchand-de-bien" element={<MarchandLayout />}>
        <Route index element={<MarchandPipeline />} />
        <Route path="sourcing" element={<MarchandSourcing />} />
        <Route path="qualification" element={<MarchandQualification />} />
        <Route path="rentabilite" element={<MarchandRentabilite />} />
        <Route path="execution" element={<MarchandExecution />} />
        <Route path="sortie" element={<MarchandSortie />} />
        <Route path="exports" element={<MarchandExports />} />

        {/* ✅ Estimation DVF (réutilise la page Particulier) */}
        <Route path="estimation" element={<ParticulierEstimation />} />

        <Route path="*" element={<Navigate to="/marchand-de-bien" replace />} />
      </Route>

      {/* Promoteur */}
      <Route path="/promoteur" element={<PromoteurLayout />}>
        <Route index element={<PromoteurDashboard />} />
        <Route path="foncier" element={<PromoteurFoncier />} />
        <Route path="plu-faisabilite" element={<PromoteurPluFaisabilite />} />
        <Route path="marche" element={<PromoteurMarche />} />
        <Route path="risques" element={<PromoteurRisques />} />

        {/* ✅ VRAIE page Implantation 2D */}
        <Route path="implantation-2d" element={<Implantation2DPage />} />

        <Route path="massing-3d" element={<PromoteurMassing3D />} />
        <Route path="bilan" element={<PromoteurBilan />} />
        <Route path="synthese" element={<PromoteurSynthese />} />
        <Route path="exports" element={<PromoteurExports />} />

        {/* ✅ Estimation DVF */}
        <Route path="estimation" element={<ParticulierEstimation />} />

        <Route path="*" element={<Navigate to="/promoteur" replace />} />
      </Route>

      {/* Banque */}
      <Route path="/banque" element={<BanqueLayout />}>
        <Route index element={<BanqueDashboard />} />
        <Route path="origination" element={<BanqueOrigination />} />
        <Route path="analyse" element={<BanqueAnalyse />} />
        <Route path="garanties" element={<BanqueGaranties />} />
        <Route path="decision" element={<BanqueDecision />} />
        <Route path="monitoring" element={<BanqueMonitoring />} />
        <Route path="documents" element={<BanqueDocuments />} />

        {/* ✅ Estimation DVF */}
        <Route path="estimation" element={<ParticulierEstimation />} />

        <Route path="*" element={<Navigate to="/banque" replace />} />
      </Route>

      {/* Assurance */}
      <Route path="/assurance" element={<AssuranceLayout />}>
        <Route index element={<AssuranceDashboard />} />
        <Route path="souscription" element={<AssuranceSouscription />} />
        <Route path="exposition" element={<AssuranceExposition />} />
        <Route path="tarification" element={<AssuranceTarification />} />
        <Route path="offre" element={<AssuranceOffre />} />
        <Route path="monitoring" element={<AssuranceMonitoring />} />
        <Route path="documents" element={<AssuranceDocuments />} />

        {/* ✅ Estimation DVF */}
        <Route path="estimation" element={<ParticulierEstimation />} />

        <Route path="*" element={<Navigate to="/assurance" replace />} />
      </Route>

      {/* Fallback global */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

