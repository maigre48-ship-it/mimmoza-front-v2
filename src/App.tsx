// src/App.tsx

import { useCallback, useEffect, useState } from "react";
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { wgs84ToLambert93 } from "./lib/projection";

import { AppShell } from "./components/AppShell";
import { PrivateRoute } from "./components/PrivateRoute";
import { SpaceSync, type Space } from "./components/SpaceSync";

import ApiDeveloperDashboardPage from "./pages/ApiDeveloperDashboardPage";
import ApiKeysPage from "./pages/ApiKeysPage";
import ApiPage from "./pages/ApiPage";
import ApiPlaygroundPage from "./pages/ApiPlaygroundPage";
import DashboardHomePage from "./pages/DashboardHomePage";
import JetonsPage from "./pages/JetonsPage";

/* ── Pages légales ───────────────────────────────────────────── */
import CGUPage from "./pages/legal/CGUPage";
import CGVPage from "./pages/legal/CGVPage";
import MentionsLegalesPage from "./pages/legal/MentionsLegalesPage";
import PrivacyPolicyPage from "./pages/legal/PrivacyPolicyPage";

/* ── Analyse rapide ──────────────────────────────────────────── */
import QuickAnalysisPage from "./spaces/shared/pages/quick-analysis/QuickAnalysisPage";

/* ── Opportunités (transversal) ──────────────────────────────── */
import OpportunitesHubPage from "./spaces/shared/pages/opportunities/OpportunitesHubPage";

import VeilleMarchePage from "@/spaces/investisseur/pages/VeilleMarchePage";
import VeillePage from "@/spaces/investisseur/pages/VeillePage";
import VeilleSettingsPage from "@/spaces/investisseur/pages/VeilleSettingsPage";
import InvestisseurAnalysePage from "./spaces/investisseur/pages/AnalysePage";
import SimulationTravauxPage from "./spaces/investisseur/pages/execution/SimulationTravauxPage";
import { bootInvestisseurSnapshot } from "./spaces/investisseur/shared/investisseurBootstrap";
// ── AJOUT : page Géorisques espace Investisseur ───────────────
import InvestisseurRisquesPanel from "./spaces/investisseur/pages/analyse/InvestisseurRisquesPanel";
// ── AJOUT : page Deal Center espace Investisseur ──────────────
import DealCenterPage from "./spaces/investisseur/pages/deal-center/DealCenterPage";

import ParticulierAlertes from "./spaces/particulier/pages/Alertes";
import ParticulierBudgetTravaux from "./spaces/particulier/pages/BudgetTravaux";
import ParticulierCapacite from "./spaces/particulier/pages/Capacite";
import ParticulierCharges from "./spaces/particulier/pages/Charges";
import ParticulierComparateur from "./spaces/particulier/pages/Comparateur";
import ParticulierConformite from "./spaces/particulier/pages/Conformite";
import ParticulierDashboard from "./spaces/particulier/pages/Dashboard";
import ParticulierDossierBanque from "./spaces/particulier/pages/DossierBanque";
import ParticulierEstimation from "./spaces/particulier/pages/Estimation";
import ParticulierExports from "./spaces/particulier/pages/Exports";
import ParticulierFavoris from "./spaces/particulier/pages/Favoris";
import ParticulierHistorique from "./spaces/particulier/pages/Historique";
import ParticulierMesDocuments from "./spaces/particulier/pages/MesDocuments";
import ParticulierMonProjet from "./spaces/particulier/pages/MonProjet";
import ParticulierPlanning from "./spaces/particulier/pages/Planning";
import ParticulierQuartier from "./spaces/particulier/pages/Quartier";
import ParticulierRechercheBiens from "./spaces/particulier/pages/RechercheBiens";
import ParticulierScenarios from "./spaces/particulier/pages/Scenarios";

import AbonnementPage from "./spaces/particulier/pages/AbonnementPage";
import ComptePage from "./spaces/particulier/pages/ComptePage";
import ConnexionPage from "./spaces/particulier/pages/ConnexionPage";
import InscriptionPage from "./spaces/particulier/pages/InscriptionPage";

import { AdminGuard } from "./spaces/admin/components/AdminGuard";
import { AdminLayout } from "./spaces/admin/components/AdminLayout";
import AdminAbonnementsPage from "./spaces/admin/pages/Abonnements";
import AdminCopilotPage from "./spaces/admin/pages/AdminCopilotPage";
import AdminDashboardPage from "./spaces/admin/pages/Dashboard";
import AdminDevisPage from "./spaces/admin/pages/Devis";
import AdminEntreprisesPage from "./spaces/admin/pages/Entreprises";
import AdminFacturesPage from "./spaces/admin/pages/Factures";
import AdminJetonsPage from "./spaces/admin/pages/Jetons";
import AdminLoginPage from "./spaces/admin/pages/Login";
import AdminParametresPage from "./spaces/admin/pages/Parametres";
import AdminTarifsPage from "./spaces/admin/pages/Tarifs";
import AdminUtilisateursPage from "./spaces/admin/pages/Utilisateurs";

import MarchandLayout from "./spaces/marchand/MarchandLayout";
import MarchandExecution from "./spaces/marchand/pages/Execution";
import MarchandExports from "./spaces/marchand/pages/Exports";
import MarchandPipeline from "./spaces/marchand/pages/Pipeline";
import RenduTravauxPage from "./spaces/marchand/pages/RenduTravauxPage";
import MarchandSortie from "./spaces/marchand/pages/Sortie";
import { SourcingHomePage } from "./spaces/sourcing";

/* ── Promoteur ───────────────────────────────────────────────── */
import Implantation2DPage from "./spaces/promoteur/Implantation2DPage";
import BilanPromoteurPage from "./spaces/promoteur/bilan-promoteur/BilanPromoteurPage";
import PromoteurStudyRequired from "./spaces/promoteur/components/PromoteurStudyRequired";
import MarchePage from "./spaces/promoteur/etudes/marche/MarchePage";
import RisquesPage from "./spaces/promoteur/etudes/risques/RisquesPage";
import BesoinLogementsSociauxPage from "./spaces/promoteur/pages/BesoinLogementsSociauxPage";
import PromoteurBilan from "./spaces/promoteur/pages/Bilan";
import PromoteurDashboard from "./spaces/promoteur/pages/Dashboard";
import EvaluationPage from "./spaces/promoteur/pages/EvaluationPage";
import PromoteurExports from "./spaces/promoteur/pages/Exports";
import FacadeGeneratorPage from "./spaces/promoteur/pages/FacadeGeneratorPage";
import FoncierPluPage from "./spaces/promoteur/pages/FoncierPluPage";
import PromoteurMassing3D from "./spaces/promoteur/pages/Massing3D";
import PromoteurMassingPage from "./spaces/promoteur/pages/MassingPage"; // ── AJOUT : Massing V2 (analyse de capacité)
import NouvelleOpportunitePage from "./spaces/promoteur/pages/NouvelleOpportunitePage";
import OpportunitesApporteursPage from "./spaces/promoteur/pages/OpportunitesApporteursPage";
import PermisConstruirePage from "./spaces/promoteur/pages/PermisConstruirePage";
import ProgrammationPage from "./spaces/promoteur/pages/ProgrammationPage";
import PromoteurSimulationTravauxPage from "./spaces/promoteur/pages/PromoteurSimulationTravauxPage";
import PromoteurVeilleFoncierePage from "./spaces/promoteur/pages/PromoteurVeilleFoncierePage";
import RechercheContactsPage from "./spaces/promoteur/pages/RechercheContactsPage";
import PromoteurSynthese from "./spaces/promoteur/pages/Synthese";

/* ──────────────────────────────────────────────────────────────
   ⚠️ Espace BANQUE mis hors-build (migration types inachevée).
   Dossier déplacé dans _drafts/banque + exclu du tsconfig.
   Pour le réactiver : restaurer les imports + le bloc <Route path="/banque">
   depuis l'historique git, et remettre AppShell dans son état d'origine.
   ────────────────────────────────────────────────────────────── */

import AssuranceDashboard from "./spaces/assurance/pages/Dashboard";
import AssuranceDocuments from "./spaces/assurance/pages/Documents";
import AssuranceExposition from "./spaces/assurance/pages/Exposition";
import AssuranceMonitoring from "./spaces/assurance/pages/Monitoring";
import AssuranceOffre from "./spaces/assurance/pages/Offre";
import AssuranceSouscription from "./spaces/assurance/pages/Souscription";
import AssuranceTarification from "./spaces/assurance/pages/Tarification";

/* ── Apporteur ───────────────────────────────────────────────── */
import ApporteurDashboard from "./spaces/apporteur/pages/Dashboard";
import { ApporteurDeposerPage } from "./spaces/apporteur/pages/DeposerPage";

/* ── Réhabilitation ──────────────────────────────────────────── */
import RehabilitationLayout from "./spaces/rehabilitation/RehabilitationLayout";
import AnalysePlanPage from "./spaces/rehabilitation/pages/AnalysePlanPage";
import ConformitePage from "./spaces/rehabilitation/pages/ConformitePage";
import ProjetsPage from "./spaces/rehabilitation/pages/ProjetsPage";
import RehabilitationRenduTravauxPage from "./spaces/rehabilitation/pages/RenduTravauxPage";
import SyntheseAuditPage from "./spaces/rehabilitation/pages/SyntheseAuditPage";
import RehabilitationTravauxPage from "./spaces/rehabilitation/pages/TravauxPage";
import RehabilitationValorisationPage from "./spaces/rehabilitation/pages/ValorisationPage";
import VueEnsemblePage from "./spaces/rehabilitation/pages/VueEnsemblePage";

/* ── Mimmoza Copilot (global : bouton flottant + drawer) ─────── */
import { CopilotRoot } from "./spaces/copilot/CopilotRoot";

declare global {
  interface Window {
    __mimmozaProjection?: (
      lon: number,
      lat: number
    ) => { x: number; y: number };
    __mimmozaElevation?: (
      deptCode: string,
      lon: number,
      lat: number
    ) => Promise<unknown>;
  }
}

function getSpacePath(space: Space): string {
  switch (space) {
    case "promoteur":
      return "/promoteur";
    case "agence":
      return "/apporteur";
    case "marchand":
      return "/marchand-de-bien";
    default:
      return "/dashboard";
  }
}

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
    try {
      bootInvestisseurSnapshot();
    } catch (e) {
      console.warn("[Investisseur] bootInvestisseurSnapshot failed:", e);
    }
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    window.__mimmozaProjection = (lon: number, lat: number) => {
      const { x, y } = wgs84ToLambert93(lon, lat);
      console.log("[mimmoza] projection EPSG:4326 -> EPSG:2154", { lon, lat, x, y });
      return { x, y };
    };

    window.__mimmozaElevation = async (
      deptCode: string,
      lon: number,
      lat: number
    ) => {
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
          {/* ═══════════════════════════════════════════════════════════════
              PUBLIC — "/" est désormais la page de connexion / espace compte
          ════════════════════════════════════════════════════════════════ */}
          <Route path="/" element={<ConnexionPage />} />

          {/* ── Alias publics de connexion (conservés pour compatibilité) ── */}
          <Route path="/login"     element={<ConnexionPage />} />
          <Route path="/connexion" element={<ConnexionPage />} />

          {/* ═══════════════════════════════════════════════════════════════
              DASHBOARD — ancienne HomePage, protégée (connecté requis)
          ════════════════════════════════════════════════════════════════ */}
          <Route element={<PrivateRoute />}>
            <Route path="/dashboard" element={<DashboardHomePage />} />
          </Route>

          {/* ═══ Légal ═══ */}
          <Route path="/cgv"                       element={<CGVPage />} />
          <Route path="/cgu"                       element={<CGUPage />} />
          <Route path="/politique-confidentialite" element={<PrivacyPolicyPage />} />
          <Route path="/mentions-legales"          element={<MentionsLegalesPage />} />

          {/* Alias légaux */}
          <Route path="/privacy"                   element={<Navigate to="/politique-confidentialite" replace />} />
          <Route path="/confidentialite"           element={<Navigate to="/politique-confidentialite" replace />} />
          <Route path="/privacy-policy"            element={<Navigate to="/politique-confidentialite" replace />} />
          <Route path="/terms"                     element={<Navigate to="/cgu" replace />} />
          <Route path="/conditions-utilisation"    element={<Navigate to="/cgu" replace />} />
          <Route path="/conditions-generales"      element={<Navigate to="/cgv" replace />} />
          <Route path="/legal"                     element={<Navigate to="/mentions-legales" replace />} />

          {/* ═══ Compte / Auth ═══ */}
          <Route path="/inscription" element={<InscriptionPage />} />
          <Route path="/compte"      element={<ComptePage />} />
          <Route path="/abonnement"  element={<AbonnementPage />} />
          <Route path="/jetons"      element={<JetonsPage />} />

          {/* Redirections d'alias */}
          <Route path="/signup"   element={<Navigate to="/inscription" replace />} />
          <Route path="/register" element={<Navigate to="/inscription" replace />} />
          <Route path="/billing"  element={<Navigate to="/abonnement" replace />} />
          <Route path="/account"  element={<Navigate to="/compte" replace />} />
          <Route path="/tokens"   element={<Navigate to="/jetons" replace />} />

          {/* ═══ Paramètres ═══ */}
          <Route path="/parametres/veille" element={<VeilleSettingsPage />} />

          {/* ═══ Veille → fusionnée dans Opportunités ═══ */}
          <Route path="/veille"        element={<Navigate to="/opportunites" replace />} />
          {/* Anciennes pages conservées (réversible) */}
          <Route path="/veille/legacy" element={<VeillePage />} />
          <Route path="/veille/marche" element={<VeilleMarchePage />} />

          {/* ═══ Analyse rapide ═══ */}
          <Route path="/analyse-rapide" element={<QuickAnalysisPage />} />

          {/* ═══ Opportunités (transversal) — scan + suivi dans le temps ═══ */}
          <Route path="/opportunites" element={<OpportunitesHubPage />} />

          {/* ═══ API ═══ */}
          <Route path="/api"            element={<ApiPage />} />
          <Route path="/api/keys"       element={<ApiKeysPage />} />
          <Route path="/api/playground" element={<ApiPlaygroundPage />} />
          <Route path="/api/developer"  element={<ApiDeveloperDashboardPage />} />

          {/* ═══ Admin ═══ */}
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route
            path="/admin"
            element={
              <AdminGuard>
                <AdminLayout />
              </AdminGuard>
            }
          >
            <Route index                element={<AdminDashboardPage />} />
            <Route path="utilisateurs"  element={<AdminUtilisateursPage />} />
            <Route path="abonnements"   element={<AdminAbonnementsPage />} />
            <Route path="jetons"        element={<AdminJetonsPage />} />
            <Route path="copilot"       element={<AdminCopilotPage />} />
            <Route path="devis"         element={<AdminDevisPage />} />
            <Route path="factures"      element={<AdminFacturesPage />} />
            <Route path="entreprises"   element={<AdminEntreprisesPage />} />
            <Route path="tarifs"        element={<AdminTarifsPage />} />
            <Route path="parametres"    element={<AdminParametresPage />} />
          </Route>

          {/* ═══ Apporteur ═══ */}
          <Route path="/apporteur" element={<Outlet />}>
            <Route index element={<ApporteurDashboard />} />
            <Route path="deposer" element={<ApporteurDeposerPage />} />
            <Route path="*" element={<Navigate to="/apporteur" replace />} />
          </Route>

          {/* ═══ Particulier ═══ */}
          <Route path="/particulier" element={<Outlet />}>
            <Route index element={<ParticulierDashboard />} />
            <Route path="projet"      element={<ParticulierMonProjet />} />
            <Route path="favoris"     element={<ParticulierFavoris />} />
            <Route path="recherche"   element={<ParticulierRechercheBiens />} />
            <Route path="alertes"     element={<ParticulierAlertes />} />
            <Route path="comparateur" element={<ParticulierComparateur />} />
            <Route path="estimation"  element={<ParticulierEstimation />} />
            <Route path="evaluation"  element={<Navigate to="/particulier/estimation" replace />} />
            <Route path="quartier"    element={<ParticulierQuartier />} />
            <Route path="charges"     element={<ParticulierCharges />} />
            <Route path="financement" element={<ParticulierCapacite />} />
            <Route path="scenarios"   element={<ParticulierScenarios />} />
            <Route path="dossier"     element={<ParticulierDossierBanque />} />
            <Route path="travaux"     element={<ParticulierBudgetTravaux />} />
            <Route path="conformite"  element={<ParticulierConformite />} />
            <Route path="planning"    element={<ParticulierPlanning />} />
            <Route path="documents"   element={<ParticulierMesDocuments />} />
            <Route path="exports"     element={<ParticulierExports />} />
            <Route path="historique"  element={<ParticulierHistorique />} />
            <Route path="*"           element={<Navigate to="/particulier" replace />} />
          </Route>

          {/* ═══ Marchand-de-bien ═══ */}
          <Route path="/marchand-de-bien" element={<MarchandLayout />}>
            <Route index element={<MarchandPipeline />} />
            <Route path="sourcing"             element={<SourcingHomePage />} />
            <Route path="qualification"        element={<Navigate to="/marchand-de-bien" replace />} />
            <Route path="analyse"              element={<InvestisseurAnalysePage />} />
            <Route path="rentabilite"          element={<Navigate to="/marchand-de-bien/analyse?tab=rentabilite" replace />} />
            <Route path="due-diligence"        element={<Navigate to="/marchand-de-bien/analyse?tab=due-diligence" replace />} />
            <Route path="analyse-predictive"   element={<Navigate to="/marchand-de-bien/analyse?tab=analyse_predictive" replace />} />
            <Route path="execution/simulation" element={<SimulationTravauxPage />} />
            <Route path="execution"            element={<MarchandExecution />} />
            <Route path="planning"             element={<RenduTravauxPage />} />
            <Route path="sortie"               element={<MarchandSortie />} />
            <Route path="exports"              element={<MarchandExports />} />
            <Route path="estimation"           element={<ParticulierEstimation />} />
            <Route path="marche"               element={<MarchePage />} />
            <Route path="risques"              element={<RisquesPage />} />
            {/* ── Géorisques Investisseur ─────────────────────────────── */}
            <Route path="georisques"           element={<InvestisseurRisquesPanel />} />
            {/* ── Deal Center ─────────────────────────────────────────── */}
            <Route path="deal-center"          element={<DealCenterPage />} />
            <Route path="*"                    element={<Navigate to="/marchand-de-bien" replace />} />
          </Route>

          {/* ═══ Promoteur ═══ */}
          <Route path="/promoteur" element={<Outlet />}>
            <Route index element={<PromoteurDashboard />} />

            <Route path="nouvelle-opportunite"    element={<NouvelleOpportunitePage />} />

            {/* Routes libres */}
            <Route path="veille"                  element={<PromoteurVeilleFoncierePage />} />
            <Route path="foncier"                 element={<FoncierPluPage />} />
            <Route path="plu-faisabilite"         element={<Navigate to="/promoteur/foncier" replace />} />
            <Route path="faisabilite"             element={<Navigate to="/promoteur/foncier" replace />} />
            <Route path="marche"                  element={<MarchePage />} />
            <Route path="risques"                 element={<RisquesPage />} />
            <Route path="permis-construire"       element={<PermisConstruirePage />} />
            <Route path="recherche-contacts"      element={<RechercheContactsPage />} />
            <Route path="opportunites-apporteurs" element={<OpportunitesApporteursPage />} />
            <Route path="opportunites/nouvelle"   element={<NouvelleOpportunitePage />} />
            <Route path="programmation"           element={<ProgrammationPage />} />
            <Route path="logements-sociaux"       element={<BesoinLogementsSociauxPage />} />
            {/* ── AJOUT : Massing V2 — analyse de capacité (route libre, sans étude requise) ── */}
            <Route path="massing"                 element={<PromoteurMassingPage />} />

            {/* Routes nécessitant une étude active */}
            <Route element={<PromoteurStudyRequired />}>
              <Route path="estimation"         element={<EvaluationPage />} />
              <Route path="implantation-2d"    element={<Implantation2DPage />} />
              <Route path="plan-2d"            element={<Navigate to="/promoteur/implantation-2d" replace />} />
              <Route path="massing-3d"         element={<PromoteurMassing3D />} />
              <Route path="generateur-facades" element={<FacadeGeneratorPage />} />
              <Route path="simulation-travaux" element={<PromoteurSimulationTravauxPage />} />
              <Route path="bilan"              element={<PromoteurBilan />} />
              <Route path="bilan-promoteur"    element={<BilanPromoteurPage />} />
              <Route path="synthese"           element={<PromoteurSynthese />} />
              <Route path="exports"            element={<PromoteurExports />} />
            </Route>

            <Route path="*" element={<Navigate to="/promoteur" replace />} />
          </Route>

          {/* ═══ Assurance ═══
              (autrefois monté sous /banque/assurance ; remonté ici en
              autonome suite à la mise hors-build de l'espace banque) */}
          <Route path="/assurance" element={<Outlet />}>
            <Route index element={<AssuranceDashboard />} />
            <Route path="souscription" element={<AssuranceSouscription />} />
            <Route path="exposition"   element={<AssuranceExposition />} />
            <Route path="tarification" element={<AssuranceTarification />} />
            <Route path="offre"        element={<AssuranceOffre />} />
            <Route path="monitoring"   element={<AssuranceMonitoring />} />
            <Route path="documents"    element={<AssuranceDocuments />} />
            <Route path="estimation"   element={<ParticulierEstimation />} />
            <Route path="marche"       element={<MarchePage />} />
            <Route path="risques"      element={<RisquesPage />} />
            <Route path="*"            element={<Navigate to="/assurance" replace />} />
          </Route>

          {/* ═══ Réhabilitation ═══ */}
          <Route path="/rehabilitation" element={<RehabilitationLayout />}>
            <Route index element={<Navigate to="/rehabilitation/projets" replace />} />

            <Route path="projets"        element={<ProjetsPage />} />
            <Route path="vue-ensemble"   element={<VueEnsemblePage />} />
            <Route path="conformite"     element={<ConformitePage />} />
            <Route path="analyse-plan"   element={<AnalysePlanPage />} />
            <Route path="travaux"        element={<RehabilitationTravauxPage />} />
            <Route path="synthese-audit" element={<SyntheseAuditPage />} />
            <Route path="valorisation"   element={<RehabilitationValorisationPage />} />
            <Route path="rendu-travaux"  element={<RehabilitationRenduTravauxPage />} />

            {/* Legacy redirects */}
            <Route path="audit"   element={<Navigate to="/rehabilitation/vue-ensemble" replace />} />
            <Route path="analyse" element={<Navigate to="/rehabilitation/vue-ensemble" replace />} />
            <Route path="*"       element={<Navigate to="/rehabilitation/projets" replace />} />
          </Route>

          {/* ═══ Compatibility redirects ═══ */}
          {/* ⚠️ Banque hors-build : toute ancienne route /banque/* → accueil */}
          <Route path="/banque/*"    element={<Navigate to="/" replace />} />
          <Route path="/audit/*"     element={<Navigate to="/" replace />} />
          <Route path="/agence"      element={<Navigate to="/apporteur" replace />} />
          <Route path="/marchand"    element={<Navigate to="/marchand-de-bien" replace />} />

          {/* Catch-all → page de connexion */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        {/* ═══ Mimmoza Copilot — global (bouton flottant + drawer) ═══ */}
        <CopilotRoot />
      </AppShell>
    </>
  );
}

export default function App() {
  return <AppRoot />;
}