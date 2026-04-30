import { useState, useCallback, useEffect } from "react";
import {
  Routes,
  Route,
  Navigate,
  Outlet,
  useNavigate,
  useParams,
} from "react-router-dom";
import { wgs84ToLambert93 } from "./lib/projection";

import { AppShell } from "./components/AppShell";
import { SpaceSync, type Space } from "./components/SpaceSync";

import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import JetonsPage from "./pages/JetonsPage";
import ApiPage from "./pages/ApiPage";
import ApiKeysPage from "./pages/ApiKeysPage";
import ApiPlaygroundPage from "./pages/ApiPlaygroundPage";
import ApiDeveloperDashboardPage from "./pages/ApiDeveloperDashboardPage";

import BanqueRisquesTestPage from "./pages/BanqueRisquesTestPage";

/* ── Pages légales ───────────────────────────────────────────── */
import CGVPage from "./pages/legal/CGVPage";
import CGUPage from "./pages/legal/CGUPage";
import PrivacyPolicyPage from "./pages/legal/PrivacyPolicyPage";
import MentionsLegalesPage from "./pages/legal/MentionsLegalesPage";

import { bootInvestisseurSnapshot } from "./spaces/investisseur/shared/investisseurBootstrap";
import InvestisseurAnalysePage from "./spaces/investisseur/pages/AnalysePage";
import SimulationTravauxPage from "./spaces/investisseur/pages/execution/SimulationTravauxPage";
import VeilleSettingsPage from "@/spaces/investisseur/pages/VeilleSettingsPage";
import VeillePage from "@/spaces/investisseur/pages/VeillePage";
import VeilleMarchePage from "@/spaces/investisseur/pages/VeilleMarchePage";

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

import ConnexionPage from "./spaces/particulier/pages/ConnexionPage";
import InscriptionPage from "./spaces/particulier/pages/InscriptionPage";
import ComptePage from "./spaces/particulier/pages/ComptePage";
import AbonnementPage from "./spaces/particulier/pages/AbonnementPage";

import AdminDashboardPage from "./spaces/admin/pages/Dashboard";
import AdminUtilisateursPage from "./spaces/admin/pages/Utilisateurs";
import AdminAbonnementsPage from "./spaces/admin/pages/Abonnements";
import AdminJetonsPage from "./spaces/admin/pages/Jetons";
import AdminDevisPage from "./spaces/admin/pages/Devis";
import AdminFacturesPage from "./spaces/admin/pages/Factures";
import AdminEntreprisesPage from "./spaces/admin/pages/Entreprises";
import AdminParametresPage from "./spaces/admin/pages/Parametres";
import AdminLoginPage from "./spaces/admin/pages/Login";
import { AdminGuard } from "./spaces/admin/components/AdminGuard";
import { AdminLayout } from "./spaces/admin/components/AdminLayout";

import MarchandLayout from "./spaces/marchand/MarchandLayout";
import MarchandPipeline from "./spaces/marchand/pages/Pipeline";
import MarchandExecution from "./spaces/marchand/pages/Execution";
import MarchandSortie from "./spaces/marchand/pages/Sortie";
import MarchandExports from "./spaces/marchand/pages/Exports";
// ── NOUVEAU : page Rendu Travaux (remplace MarchandTravaux sur /planning) ──
import RenduTravauxPage from "./spaces/marchand/pages/RenduTravauxPage";
import { SourcingHomePage } from "./spaces/sourcing";

import PromoteurDashboard from "./spaces/promoteur/pages/Dashboard";
import FoncierPluPage from "./spaces/promoteur/pages/FoncierPluPage";
import MarchePage from "./spaces/promoteur/etudes/marche/MarchePage";
import RisquesPage from "./spaces/promoteur/etudes/risques/RisquesPage";
// ── NOUVEAU : page Permis de construire (sous-onglet Études) ──
import PermisConstruirePage from "./spaces/promoteur/pages/PermisConstruirePage";
// ── NOUVEAU : page Recherche contacts mairies (sous-onglet Études, indépendant) ──
import RechercheContactsPage from "./spaces/promoteur/pages/RechercheContactsPage";
import PromoteurMassing3D from "./spaces/promoteur/pages/Massing3D";
import PromoteurBilan from "./spaces/promoteur/pages/Bilan";
import PromoteurSynthese from "./spaces/promoteur/pages/Synthese";
import PromoteurExports from "./spaces/promoteur/pages/Exports";
import Implantation2DPage from "./spaces/promoteur/Implantation2DPage";
import BilanPromoteurPage from "./spaces/promoteur/bilan-promoteur/BilanPromoteurPage";
import PromoteurStudyRequired from "./spaces/promoteur/components/PromoteurStudyRequired";
import FacadeGeneratorPage from "./spaces/promoteur/pages/FacadeGeneratorPage";
// ── Évaluation Promoteur (remplace ParticulierEstimation sur /promoteur/estimation) ──
import EvaluationPage from "./spaces/promoteur/pages/EvaluationPage";
// ── NOUVEAU : Rendu travaux Promoteur (thème violet) ──
import PromoteurRenduTravauxPage from "./spaces/promoteur/pages/PromoteurRenduTravauxPage";

import BanqueLayout from "./spaces/banque/components/BanqueLayout";
import BanquePipeline from "./spaces/banque/pages/Pipeline";
import BanqueDossierPage from "./spaces/banque/pages/DossierPage";
import BanqueAnalysePage from "./spaces/banque/pages/AnalysePage";
import BanqueComitePage from "./spaces/banque/pages/ComitePage";
import BanqueAlertes from "./spaces/banque/pages/Alertes";
import BanqueSmartScoreDebug from "./spaces/banque/pages/SmartScoreDebug";
import BanqueRedirectToDossier from "./spaces/banque/pages/BanqueRedirectToDossier";

import AssuranceDashboard from "./spaces/assurance/pages/Dashboard";
import AssuranceSouscription from "./spaces/assurance/pages/Souscription";
import AssuranceExposition from "./spaces/assurance/pages/Exposition";
import AssuranceTarification from "./spaces/assurance/pages/Tarification";
import AssuranceOffre from "./spaces/assurance/pages/Offre";
import AssuranceMonitoring from "./spaces/assurance/pages/Monitoring";
import AssuranceDocuments from "./spaces/assurance/pages/Documents";

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
      return "/particulier";
    case "marchand":
      return "/marchand-de-bien";
    case "banque":
      return "/banque";
    default:
      return "/";
  }
}

function BanqueRedirectToComite() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/banque/comite/${id ?? ""}`} replace />;
}

function BanqueRedirectToAnalyse() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/banque/analyse/${id ?? ""}`} replace />;
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
      console.log("[mimmoza] projection EPSG:4326 -> EPSG:2154", {
        lon,
        lat,
        x,
        y,
      });
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
          <Route path="/" element={<HomePage />} />

          {/* ═══ Légal ═══ */}
          <Route path="/cgv" element={<CGVPage />} />
          <Route path="/cgu" element={<CGUPage />} />
          <Route
            path="/politique-confidentialite"
            element={<PrivacyPolicyPage />}
          />
          <Route path="/mentions-legales" element={<MentionsLegalesPage />} />

          {/* ═══ Compte / Auth / Abonnement ═══ */}
          <Route path="/login" element={<ConnexionPage />} />
          <Route path="/connexion" element={<ConnexionPage />} />
          <Route path="/inscription" element={<InscriptionPage />} />
          <Route path="/compte" element={<ComptePage />} />
          <Route path="/abonnement" element={<AbonnementPage />} />
          <Route path="/jetons" element={<JetonsPage />} />

          <Route path="/signup" element={<Navigate to="/inscription" replace />} />
          <Route path="/register" element={<Navigate to="/inscription" replace />} />
          <Route path="/billing" element={<Navigate to="/abonnement" replace />} />
          <Route path="/account" element={<Navigate to="/compte" replace />} />
          <Route path="/tokens" element={<Navigate to="/jetons" replace />} />

          {/* ═══ Paramètres ═══ */}
          <Route path="/parametres/veille" element={<VeilleSettingsPage />} />

          {/* ═══ Veille ═══ */}
          <Route path="/veille" element={<VeillePage />} />
          <Route path="/veille/marche" element={<VeilleMarchePage />} />

          {/* ═══ API ═══ */}
          <Route path="/api" element={<ApiPage />} />
          <Route path="/api/keys" element={<ApiKeysPage />} />
          <Route path="/api/playground" element={<ApiPlaygroundPage />} />
          <Route path="/api/developer" element={<ApiDeveloperDashboardPage />} />

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
            <Route index element={<AdminDashboardPage />} />
            <Route path="utilisateurs" element={<AdminUtilisateursPage />} />
            <Route path="abonnements" element={<AdminAbonnementsPage />} />
            <Route path="jetons" element={<AdminJetonsPage />} />
            <Route path="devis" element={<AdminDevisPage />} />
            <Route path="factures" element={<AdminFacturesPage />} />
            <Route path="entreprises" element={<AdminEntreprisesPage />} />
            <Route path="parametres" element={<AdminParametresPage />} />
          </Route>

          {/* ═══ Particulier ═══ */}
          {/* NOTE : ParticulierEstimation reste intact pour l'espace Particulier */}
          <Route path="/particulier" element={<Outlet />}>
            <Route index element={<ParticulierDashboard />} />
            <Route path="projet" element={<ParticulierMonProjet />} />
            <Route path="favoris" element={<ParticulierFavoris />} />
            <Route path="recherche" element={<ParticulierRechercheBiens />} />
            <Route path="alertes" element={<ParticulierAlertes />} />
            <Route path="comparateur" element={<ParticulierComparateur />} />
            <Route path="estimation" element={<ParticulierEstimation />} />
            <Route
              path="evaluation"
              element={<Navigate to="/particulier/estimation" replace />}
            />
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

          {/* ═══ Marchand-de-bien ═══ */}
          <Route path="/marchand-de-bien" element={<MarchandLayout />}>
            <Route index element={<MarchandPipeline />} />
            <Route path="sourcing" element={<SourcingHomePage />} />
            <Route
              path="qualification"
              element={<Navigate to="/marchand-de-bien" replace />}
            />
            <Route path="analyse" element={<InvestisseurAnalysePage />} />
            <Route
              path="rentabilite"
              element={
                <Navigate
                  to="/marchand-de-bien/analyse?tab=rentabilite"
                  replace
                />
              }
            />
            <Route
              path="due-diligence"
              element={
                <Navigate
                  to="/marchand-de-bien/analyse?tab=due-diligence"
                  replace
                />
              }
            />
            <Route
              path="analyse-predictive"
              element={
                <Navigate
                  to="/marchand-de-bien/analyse?tab=analyse_predictive"
                  replace
                />
              }
            />
            <Route
              path="execution/simulation"
              element={<SimulationTravauxPage />}
            />
            <Route path="execution" element={<MarchandExecution />} />
            <Route path="planning" element={<RenduTravauxPage />} />
            <Route path="sortie" element={<MarchandSortie />} />
            <Route path="exports" element={<MarchandExports />} />
            <Route path="estimation" element={<ParticulierEstimation />} />
            <Route path="marche" element={<MarchePage />} />
            <Route path="risques" element={<RisquesPage />} />
            <Route
              path="*"
              element={<Navigate to="/marchand-de-bien" replace />}
            />
          </Route>

          {/* ═══ Promoteur ═══ */}
          <Route path="/promoteur" element={<Outlet />}>
            <Route index element={<PromoteurDashboard />} />
            <Route path="foncier" element={<FoncierPluPage />} />
            <Route
              path="plu-faisabilite"
              element={<Navigate to="/promoteur/foncier" replace />}
            />
            <Route
              path="faisabilite"
              element={<Navigate to="/promoteur/foncier" replace />}
            />
            <Route path="marche" element={<MarchePage />} />
            <Route path="risques" element={<RisquesPage />} />
            {/* ── Sous-onglet Permis de construire (Études) ── */}
            <Route
              path="permis-construire"
              element={<PermisConstruirePage />}
            />
            {/* ── Sous-onglet Recherche contacts (Études, module indépendant) ── */}
            <Route
              path="recherche-contacts"
              element={<RechercheContactsPage />}
            />

            <Route element={<PromoteurStudyRequired />}>
              {/* ✅ EvaluationPage — page dédiée Promoteur avec absorption + prix de sortie */}
              <Route path="estimation" element={<EvaluationPage />} />
              <Route path="implantation-2d" element={<Implantation2DPage />} />
              <Route
                path="plan-2d"
                element={<Navigate to="/promoteur/implantation-2d" replace />}
              />
              <Route path="massing-3d" element={<PromoteurMassing3D />} />
              <Route
                path="generateur-facades"
                element={<FacadeGeneratorPage />}
              />
              {/* ── NOUVEAU : Rendu travaux Promoteur (thème violet) ── */}
              <Route
                path="rendu-travaux"
                element={<PromoteurRenduTravauxPage />}
              />
              <Route path="bilan" element={<PromoteurBilan />} />
              <Route path="bilan-promoteur" element={<BilanPromoteurPage />} />
              <Route path="synthese" element={<PromoteurSynthese />} />
              <Route path="exports" element={<PromoteurExports />} />
            </Route>

            <Route path="*" element={<Navigate to="/promoteur" replace />} />
          </Route>

          {/* ═══ Banque / Assurance ═══ */}
          <Route path="/banque" element={<BanqueLayout />}>
            <Route index element={<Navigate to="/banque/dossiers" replace />} />
            <Route path="dossiers" element={<BanquePipeline />} />
            <Route path="dossier/:id" element={<BanqueDossierPage />} />
            <Route path="analyse/:id" element={<BanqueAnalysePage />} />
            <Route path="comite/:id" element={<BanqueComitePage />} />
            <Route path="alertes" element={<BanqueAlertes />} />
            <Route
              path="smartscore-debug"
              element={<BanqueSmartScoreDebug />}
            />
            <Route path="risques-test" element={<BanqueRisquesTestPage />} />
            <Route path="estimation" element={<ParticulierEstimation />} />
            <Route path="marche" element={<MarchePage />} />
            <Route path="outil-risques/:id" element={<RisquesPage />} />

            <Route path="assurance" element={<Outlet />}>
              <Route index element={<AssuranceDashboard />} />
              <Route
                path="souscription"
                element={<AssuranceSouscription />}
              />
              <Route path="exposition" element={<AssuranceExposition />} />
              <Route path="tarification" element={<AssuranceTarification />} />
              <Route path="offre" element={<AssuranceOffre />} />
              <Route path="monitoring" element={<AssuranceMonitoring />} />
              <Route path="documents" element={<AssuranceDocuments />} />
              <Route path="estimation" element={<ParticulierEstimation />} />
              <Route path="marche" element={<MarchePage />} />
              <Route path="risques" element={<RisquesPage />} />
              <Route
                path="*"
                element={<Navigate to="/banque/assurance" replace />}
              />
            </Route>

            <Route path="garanties/:id" element={<BanqueRedirectToDossier />} />
            <Route path="documents/:id" element={<BanqueRedirectToDossier />} />
            <Route path="decision/:id" element={<BanqueRedirectToComite />} />
            <Route path="smartscore/:id" element={<BanqueRedirectToAnalyse />} />
            <Route path="risque/:id" element={<BanqueRedirectToAnalyse />} />
            <Route path="risques/:id" element={<BanqueRedirectToAnalyse />} />

            <Route
              path="origination"
              element={<Navigate to="/banque/dossiers" replace />}
            />
            <Route
              path="monitoring"
              element={<Navigate to="/banque/alertes" replace />}
            />
            <Route
              path="pipeline"
              element={<Navigate to="/banque/dossiers" replace />}
            />
            <Route
              path="garanties"
              element={<Navigate to="/banque/dossiers" replace />}
            />
            <Route
              path="documents"
              element={<Navigate to="/banque/dossiers" replace />}
            />
            <Route
              path="decision"
              element={<Navigate to="/banque/dossiers" replace />}
            />
            <Route
              path="comite"
              element={<Navigate to="/banque/dossiers" replace />}
            />
            <Route
              path="analyse"
              element={<Navigate to="/banque/dossiers" replace />}
            />
            <Route
              path="risque"
              element={<Navigate to="/banque/dossiers" replace />}
            />
            <Route
              path="risques"
              element={<Navigate to="/banque/dossiers" replace />}
            />
            <Route
              path="dossier"
              element={<Navigate to="/banque/dossiers" replace />}
            />
            <Route
              path="*"
              element={<Navigate to="/banque/dossiers" replace />}
            />
          </Route>

          {/* ═══ Compatibility redirects ═══ */}
          <Route
            path="/assurance/*"
            element={<Navigate to="/banque/assurance" replace />}
          />
          <Route path="/audit/*" element={<Navigate to="/" replace />} />
          <Route
            path="/agence"
            element={<Navigate to="/particulier" replace />}
          />
          <Route
            path="/marchand"
            element={<Navigate to="/marchand-de-bien" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </>
  );
}

export default function App() {
  return <AppRoot />;
}