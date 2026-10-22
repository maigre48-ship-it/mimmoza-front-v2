// src/App.tsx

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { track } from "@/lib/mimmozia/track";

/* ── Coque et gardes : chargées avec l'application (légères, utilisées partout) ── */
import { AppShell } from "./components/AppShell";
import { PrivateRoute } from "./components/PrivateRoute";
import { RequirePlan } from "./components/billing/RequirePlan";
import { RobotsPolicy } from "./components/RobotsPolicy";
import { BandeauCookies } from "./components/BandeauCookies";
import { SpaceSync, type Space } from "./components/SpaceSync";
import { ESPACES_VISIBLES } from "./lib/espacesEnPreparation";
import { ChargementPage } from "./components/routing/ChargementPage";
import { differer, type PageDifferee } from "./components/routing/pageDifferee";

/* ── Page d'entrée « / » (analyse express + connexion) : STATIQUE, pour un
      affichage immédiat sans attendre un second téléchargement. ──────────── */
import ConnexionPage from "./spaces/particulier/pages/ConnexionPage";

/* ══════════════════════════════════════════════════════════════════════════
   PERFORMANCE — toutes les autres pages sont chargées À LA DEMANDE.
   Avant : un visiteur de « / » téléchargeait toute l'application (cartes,
   3D, exports Office, graphiques…), soit ~2 Mo de JavaScript compressé.
   Chaque page ci-dessous devient un morceau séparé, téléchargé quand on
   l'ouvre (ou préchargé au survol d'un lien : voir PRECHARGEMENTS plus bas).
   Une page nommée (export { X }) se déclare differer(() => import(...), "X").
   ⚠️ Chemins vérifiés par src/components/routing/routesDifferees.test.ts.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Public / transverse ─────────────────────────────────────── */
const VitrinePage = differer(() => import("./pages/vitrine/VitrinePage"), "default");
const TarifsPage = differer(() => import("./pages/TarifsPage"), "default");
const NotFoundPage = differer(() => import("./pages/NotFoundPage"), "default");
const BientotDisponiblePage = differer(() => import("./pages/BientotDisponiblePage"), "default");
const StudioHorsApplication = differer(() => import("./components/StudioHorsApplication"), "default");
const AidePage = differer(() => import("./pages/aide/AidePage"), "default");
const SecuritePage = differer(() => import("./pages/securite/SecuritePage"), "default");

/* ── Pages légales ───────────────────────────────────────────── */
const CGUPage = differer(() => import("./pages/legal/CGUPage"), "default");
const CGVPage = differer(() => import("./pages/legal/CGVPage"), "default");
const MentionsLegalesPage = differer(() => import("./pages/legal/MentionsLegalesPage"), "default");
const PrivacyPolicyPage = differer(() => import("./pages/legal/PrivacyPolicyPage"), "default");

/* ── Compte / facturation ────────────────────────────────────── */
const InscriptionPage = differer(() => import("./spaces/particulier/pages/InscriptionPage"), "default");
const ComptePage = differer(() => import("./spaces/particulier/pages/ComptePage"), "default");
const AbonnementPage = differer(() => import("./spaces/particulier/pages/AbonnementPage"), "default");
const JetonsPage = differer(() => import("./pages/JetonsPage"), "default");

/* ── Accueil connecté / MimmozIA ─────────────────────────────── */
const MimmozIAPage = differer(() => import("./spaces/copilot/MimmozIAPage"), "default");
const DashboardHomePage = differer(() => import("./pages/DashboardHomePage"), "default");
const CopilotSpaceOutlet = differer(() => import("./spaces/copilot/components/CopilotSpaceOutlet"), "CopilotSpaceOutlet");
/** Copilot global (bouton flottant + tiroir) : chargé hors des pages d'entrée publiques. */
const CopilotRoot = differer(() => import("./spaces/copilot/CopilotRoot"), "CopilotRoot");

/* ── Analyse rapide / Opportunités / Veille ──────────────────── */
const QuickAnalysisPage = differer(() => import("./spaces/shared/pages/quick-analysis/QuickAnalysisPage"), "default");
const OpportunitesHubPage = differer(() => import("./spaces/shared/pages/opportunities/OpportunitesHubPage"), "default");
const VeilleMarchePage = differer(() => import("./spaces/investisseur/pages/VeilleMarchePage"), "default");
const VeillePage = differer(() => import("./spaces/investisseur/pages/VeillePage"), "default");
const VeilleSettingsPage = differer(() => import("./spaces/investisseur/pages/VeilleSettingsPage"), "default");

/* ── API ─────────────────────────────────────────────────────── */
const ApiPage = differer(() => import("./pages/ApiPage"), "default");
const ApiKeysPage = differer(() => import("./pages/ApiKeysPage"), "default");
const ApiPlaygroundPage = differer(() => import("./pages/ApiPlaygroundPage"), "default");
const ApiDeveloperDashboardPage = differer(() => import("./pages/ApiDeveloperDashboardPage"), "default");

/* ── Admin ───────────────────────────────────────────────────── */
const AdminGuard = differer(() => import("./spaces/admin/components/AdminGuard"), "AdminGuard");
const AdminLayout = differer(() => import("./spaces/admin/components/AdminLayout"), "AdminLayout");
const AdminLoginPage = differer(() => import("./spaces/admin/pages/Login"), "default");
const AdminDashboardPage = differer(() => import("./spaces/admin/pages/Dashboard"), "default");
const AdminUtilisateursPage = differer(() => import("./spaces/admin/pages/Utilisateurs"), "default");
const AdminAbonnementsPage = differer(() => import("./spaces/admin/pages/Abonnements"), "default");
const AdminJetonsPage = differer(() => import("./spaces/admin/pages/Jetons"), "default");
const AdminCopilotPage = differer(() => import("./spaces/admin/pages/AdminCopilotPage"), "default");
const AdminDevisPage = differer(() => import("./spaces/admin/pages/Devis"), "default");
const AdminFacturesPage = differer(() => import("./spaces/admin/pages/Factures"), "default");
const SocietyAgentsPage = differer(() => import("./spaces/admin/pages/SocietyAgentsPage"), "default");
const AdminEntreprisesPage = differer(() => import("./spaces/admin/pages/Entreprises"), "default");
const AdminTarifsPage = differer(() => import("./spaces/admin/pages/Tarifs"), "default");
const AdminFraicheurDonneesPage = differer(() => import("./spaces/admin/pages/FraicheurDonnees"), "default");
const AdminParametresPage = differer(() => import("./spaces/admin/pages/Parametres"), "default");
const AdminErreursPage = differer(() => import("./spaces/admin/pages/Erreurs"), "default");

/* ── Admin › Agent commercial (barrel : un seul morceau pour tout le module) ── */
const chargerAgentCommercial = () => import("./spaces/admin/pages/agentCommercial");
const AgentCommercialLayout = differer(chargerAgentCommercial, "AgentCommercialLayout");
const AgentCommercialOverviewPage = differer(chargerAgentCommercial, "AgentCommercialOverviewPage");
const AgentCommercialProspectsPage = differer(chargerAgentCommercial, "AgentCommercialProspectsPage");
const AgentCommercialProspectDetailPage = differer(chargerAgentCommercial, "AgentCommercialProspectDetailPage");
const AgentCommercialProspectsImportPage = differer(chargerAgentCommercial, "AgentCommercialProspectsImportPage");
const AgentCommercialExclusionsPage = differer(chargerAgentCommercial, "AgentCommercialExclusionsPage");
const AgentCommercialMessagesPage = differer(chargerAgentCommercial, "AgentCommercialMessagesPage");
const AgentCommercialConversationsPage = differer(chargerAgentCommercial, "AgentCommercialConversationsPage");
const AgentCommercialRelancesPage = differer(chargerAgentCommercial, "AgentCommercialRelancesPage");
const AgentCommercialPipelinePage = differer(chargerAgentCommercial, "AgentCommercialPipelinePage");
const AgentCommercialKnowledgePage = differer(chargerAgentCommercial, "AgentCommercialKnowledgePage");
const AgentCommercialSettingsPage = differer(chargerAgentCommercial, "AgentCommercialSettingsPage");
const AgentCommercialRepliesPage = differer(() => import("./spaces/admin/pages/agentCommercial/RepliesPage"), "AgentCommercialRepliesPage");
const AgentCommercialCampaignsPage = differer(() => import("./spaces/admin/pages/agentCommercial/CampaignsPage"), "AgentCommercialCampaignsPage");

/* ── Apporteur ───────────────────────────────────────────────── */
const ApporteurDashboard = differer(() => import("./spaces/apporteur/pages/Dashboard"), "default");
const ApporteurDeposerPage = differer(() => import("./spaces/apporteur/pages/DeposerPage"), "ApporteurDeposerPage");

/* ── Particulier ─────────────────────────────────────────────── */
const ParticulierAlertes = differer(() => import("./spaces/particulier/pages/Alertes"), "default");
const ParticulierBudgetTravaux = differer(() => import("./spaces/particulier/pages/BudgetTravaux"), "default");
const ParticulierCapacite = differer(() => import("./spaces/particulier/pages/Capacite"), "default");
const ParticulierCharges = differer(() => import("./spaces/particulier/pages/Charges"), "default");
const ParticulierComparateur = differer(() => import("./spaces/particulier/pages/Comparateur"), "default");
const ParticulierConformite = differer(() => import("./spaces/particulier/pages/Conformite"), "default");
const ParticulierDashboard = differer(() => import("./spaces/particulier/pages/Dashboard"), "default");
const ParticulierDossierBanque = differer(() => import("./spaces/particulier/pages/DossierBanque"), "default");
const ParticulierEstimation = differer(() => import("./spaces/particulier/pages/Estimation"), "default");
const ParticulierExports = differer(() => import("./spaces/particulier/pages/Exports"), "default");
const ParticulierFavoris = differer(() => import("./spaces/particulier/pages/Favoris"), "default");
const ParticulierHistorique = differer(() => import("./spaces/particulier/pages/Historique"), "default");
const ParticulierMesDocuments = differer(() => import("./spaces/particulier/pages/MesDocuments"), "default");
const ParticulierMonProjet = differer(() => import("./spaces/particulier/pages/MonProjet"), "default");
const ParticulierPlanning = differer(() => import("./spaces/particulier/pages/Planning"), "default");
const ParticulierQuartier = differer(() => import("./spaces/particulier/pages/Quartier"), "default");
const ParticulierRechercheBiens = differer(() => import("./spaces/particulier/pages/RechercheBiens"), "default");
const ParticulierScenarios = differer(() => import("./spaces/particulier/pages/Scenarios"), "default");

/* ── Marchand de biens (et pages investisseur partagées) ─────── */
const MarchandLayout = differer(() => import("./spaces/marchand/MarchandLayout"), "default");
const MarchandPipeline = differer(() => import("./spaces/marchand/pages/Pipeline"), "default");
const MarchandExecution = differer(() => import("./spaces/marchand/pages/Execution"), "default");
const MarchandExports = differer(() => import("./spaces/marchand/pages/Exports"), "default");
const MarchandSortie = differer(() => import("./spaces/marchand/pages/Sortie"), "default");
const RenduTravauxPage = differer(() => import("./spaces/marchand/pages/RenduTravauxPage"), "default");
const SourcingHomePage = differer(() => import("./spaces/sourcing/pages/SourcingHomePage"), "default");
const InvestisseurAnalysePage = differer(() => import("./spaces/investisseur/pages/AnalysePage"), "default");
const SimulationTravauxPage = differer(() => import("./spaces/investisseur/pages/execution/SimulationTravauxPage"), "default");
const InvestisseurRisquesPanel = differer(() => import("./spaces/investisseur/pages/analyse/InvestisseurRisquesPanel"), "default");
const DealCenterPage = differer(() => import("./spaces/investisseur/pages/deal-center/DealCenterPage"), "default");

/* ── Promoteur ───────────────────────────────────────────────── */
const PromoteurDashboard = differer(() => import("./spaces/promoteur/pages/Dashboard"), "default");
const PromoteurStudyRequired = differer(() => import("./spaces/promoteur/components/PromoteurStudyRequired"), "default");
const NouvelleOpportunitePage = differer(() => import("./spaces/promoteur/pages/NouvelleOpportunitePage"), "default");
const PromoteurVeilleFoncierePage = differer(() => import("./spaces/promoteur/pages/PromoteurVeilleFoncierePage"), "default");
const FoncierPluPage = differer(() => import("./spaces/promoteur/pages/FoncierPluPage"), "default");
const MarchePage = differer(() => import("./spaces/promoteur/etudes/marche/MarchePage"), "default");
const RisquesPage = differer(() => import("./spaces/promoteur/etudes/risques/RisquesPage"), "default");
const PermisConstruirePage = differer(() => import("./spaces/promoteur/pages/PermisConstruirePage"), "default");
const RechercheContactsPage = differer(() => import("./spaces/promoteur/pages/RechercheContactsPage"), "default");
const ProprietairesParcellesPage = differer(() => import("./spaces/promoteur/pages/ProprietairesParcellesPage"), "default");
const OpportunitesApporteursPage = differer(() => import("./spaces/promoteur/pages/OpportunitesApporteursPage"), "default");
const ProgrammationPage = differer(() => import("./spaces/promoteur/pages/ProgrammationPage"), "default");
const StrategieProjetPage = differer(() => import("./spaces/promoteur/pages/StrategieProjetPage"), "default");
const StyleTendancesPage = differer(() => import("./spaces/promoteur/pages/StyleTendancesPage"), "default");
const BesoinLogementsSociauxPage = differer(() => import("./spaces/promoteur/pages/BesoinLogementsSociauxPage"), "default");
const PromoteurMassingPage = differer(() => import("./spaces/promoteur/pages/MassingPage"), "default");
const EvaluationPage = differer(() => import("./spaces/promoteur/pages/EvaluationPage"), "default");
const Implantation2DPage = differer(() => import("./spaces/promoteur/Implantation2DPage"), "default");
const PromoteurMassing3D = differer(() => import("./spaces/promoteur/pages/Massing3D"), "default");
const FacadeGeneratorPage = differer(() => import("./spaces/promoteur/pages/FacadeGeneratorPage"), "default");
const PromoteurSimulationTravauxPage = differer(() => import("./spaces/promoteur/pages/PromoteurSimulationTravauxPage"), "default");
const PromoteurBilan = differer(() => import("./spaces/promoteur/pages/Bilan"), "default");
const BilanPromoteurPage = differer(() => import("./spaces/promoteur/bilan-promoteur/BilanPromoteurPage"), "default");
const PromoteurSynthese = differer(() => import("./spaces/promoteur/pages/Synthese"), "default");
const PromoteurExports = differer(() => import("./spaces/promoteur/pages/Exports"), "default");

/* ──────────────────────────────────────────────────────────────
   ⚠️ Espace BANQUE mis hors-build (migration types inachevée).
   Dossier déplacé dans _drafts/banque + exclu du tsconfig.
   Pour le réactiver : restaurer les imports + le bloc <Route path="/banque">
   depuis l'historique git, et remettre AppShell dans son état d'origine.
   ────────────────────────────────────────────────────────────── */

/* ── Assurance ───────────────────────────────────────────────── */
const AssuranceDashboard = differer(() => import("./spaces/assurance/pages/Dashboard"), "default");
const AssuranceDocuments = differer(() => import("./spaces/assurance/pages/Documents"), "default");
const AssuranceExposition = differer(() => import("./spaces/assurance/pages/Exposition"), "default");
const AssuranceMonitoring = differer(() => import("./spaces/assurance/pages/Monitoring"), "default");
const AssuranceOffre = differer(() => import("./spaces/assurance/pages/Offre"), "default");
const AssuranceSouscription = differer(() => import("./spaces/assurance/pages/Souscription"), "default");
const AssuranceTarification = differer(() => import("./spaces/assurance/pages/Tarification"), "default");

/* ── Réhabilitation ──────────────────────────────────────────── */
const RehabilitationLayout = differer(() => import("./spaces/rehabilitation/RehabilitationLayout"), "default");
const ProjetsPage = differer(() => import("./spaces/rehabilitation/pages/ProjetsPage"), "default");
const VueEnsemblePage = differer(() => import("./spaces/rehabilitation/pages/VueEnsemblePage"), "default");
const ConformitePage = differer(() => import("./spaces/rehabilitation/pages/ConformitePage"), "default");
const AnalysePlanPage = differer(() => import("./spaces/rehabilitation/pages/AnalysePlanPage"), "default");
const RehabilitationTravauxPage = differer(() => import("./spaces/rehabilitation/pages/TravauxPage"), "default");
const RehabilitationPlanningTravauxPage = differer(() => import("./spaces/rehabilitation/pages/PlanningTravauxPage"), "default");
const SyntheseAuditPage = differer(() => import("./spaces/rehabilitation/pages/SyntheseAuditPage"), "default");
const RehabilitationValorisationPage = differer(() => import("./spaces/rehabilitation/pages/ValorisationPage"), "default");
const RehabilitationRenduTravauxPage = differer(() => import("./spaces/rehabilitation/pages/RenduTravauxPage"), "default");

/* ══════════════════════════════════════════════════════════════════════════
   Préchargement au survol / focus d'un lien : quand le pointeur passe sur un
   lien interne, on télécharge déjà la page cible (le clic devient instantané).
   Premier préfixe qui correspond = pages préchargées. Ordre : du plus précis
   au plus général.
   ══════════════════════════════════════════════════════════════════════════ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PagePrechargeable = PageDifferee<any>;
const PRECHARGEMENTS: ReadonlyArray<readonly [prefixe: string, pages: readonly PagePrechargeable[]]> = [
  ["/decouvrir", [VitrinePage]],
  ["/tarifs", [TarifsPage]],
  ["/aide", [AidePage]],
  ["/securite", [SecuritePage]],
  ["/inscription", [InscriptionPage]],
  ["/analyse-rapide", [QuickAnalysisPage]],
  ["/mimmozia", [MimmozIAPage]],
  ["/accueil", [MimmozIAPage]],
  ["/dashboard", [DashboardHomePage]],
  ["/opportunites", [OpportunitesHubPage]],
  ["/cgu", [CGUPage]],
  ["/cgv", [CGVPage]],
  ["/mentions-legales", [MentionsLegalesPage]],
  ["/politique-confidentialite", [PrivacyPolicyPage]],
  ["/compte", [ComptePage]],
  ["/abonnement", [AbonnementPage]],
  ["/jetons", [JetonsPage]],
  ["/api", [ApiPage]],
  ["/apporteur", [CopilotSpaceOutlet, ApporteurDashboard]],
  ["/promoteur", [CopilotSpaceOutlet, PromoteurDashboard]],
  ["/marchand-de-bien", [MarchandLayout, MarchandPipeline]],
  ["/rehabilitation", [RehabilitationLayout, ProjetsPage]],
  ["/admin", [AdminGuard, AdminLayout, AdminDashboardPage]],
];

function pagesAPrecharger(chemin: string): readonly PagePrechargeable[] {
  for (const [prefixe, pages] of PRECHARGEMENTS) {
    if (chemin === prefixe || chemin.startsWith(prefixe + "/")) return pages;
  }
  return [];
}

/** Écoute survol et focus des liens internes et précharge la page visée (une fois). */
function usePrechargementAuSurvol() {
  useEffect(() => {
    const dejaFaits = new Set<string>();
    const surLien = (evenement: Event) => {
      const cible = evenement.target;
      if (!(cible instanceof Element)) return;
      const lien = cible.closest("a[href]");
      if (!(lien instanceof HTMLAnchorElement) || lien.origin !== window.location.origin) return;
      const chemin = lien.pathname;
      if (dejaFaits.has(chemin)) return;
      dejaFaits.add(chemin);
      for (const page of pagesAPrecharger(chemin)) page.precharger();
    };
    document.addEventListener("pointerover", surLien, { passive: true });
    document.addEventListener("focusin", surLien);
    document.addEventListener("touchstart", surLien, { passive: true });
    return () => {
      document.removeEventListener("pointerover", surLien);
      document.removeEventListener("focusin", surLien);
      document.removeEventListener("touchstart", surLien);
    };
  }, []);
}

/**
 * Pages publiques d'arrivée : le Copilot global (≈ 400 Ko compressés avec ses
 * graphiques et sa 3D) n'y est pas téléchargé tant que l'on n'a pas ouvert une
 * autre page. Mesuré sur /tarifs (Lighthouse mobile) : il pesait sur le temps
 * de blocage alors qu'un visiteur non connecté ne peut pas s'en servir.
 * Une fois monté, il le reste et gère lui-même sa visibilité (CopilotRoot).
 */
const SANS_COPILOT = new Set([
  "/", "/decouvrir", "/login", "/connexion", "/inscription", "/mimmozia",
  "/tarifs", "/aide", "/securite",
  "/cgu", "/cgv", "/mentions-legales", "/politique-confidentialite",
]);

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

/* ──────────────────────────────────────────────────────────────
   AJOUT Phase 0 — Décideur d'atterrissage après connexion.
   MimmozIA devient la porte d'entrée par défaut ; l'utilisateur
   ayant activé le mode expert atterrit directement sur le dashboard.
   On réorganise, on ne supprime rien : /dashboard reste accessible.

   ⚠️ ÉTAT RÉEL de la clé "mode:expert-default" : elle est LUE ici et
   n'est ÉCRITE nulle part dans le dépôt (vérifié). La branche experte
   est donc inatteignable en pratique, et tout le monde atterrit sur
   /mimmozia — ce qui est le comportement voulu aujourd'hui.

   Si un jour un réglage vient l'écrire, deux précautions :
   • utiliser userScopedStorage (clé préfixée par l'identifiant du
     compte), pas localStorage brut : une clé globale se partage entre
     deux comptes sur le même navigateur, c'est la classe de fuite déjà
     corrigée ailleurs dans l'application ;
   • ne pas oublier de la nettoyer à la déconnexion.
   ────────────────────────────────────────────────────────────── */
function HomeLanding() {
  let expertDefault = false;
  try {
    expertDefault = localStorage.getItem("mode:expert-default") === "true";
  } catch {
    expertDefault = false;
  }
  return <Navigate to={expertDefault ? "/dashboard" : "/mimmozia"} replace />;
}

/** Déduit le module actif depuis l'URL pour l'apprentissage MimmozIA (module_open). */
function moduleFromPath(pathname: string): string | undefined {
  if (pathname.startsWith("/promoteur")) return "promoteur";
  if (pathname.startsWith("/particulier")) return "particulier";
  if (pathname.startsWith("/marchand-de-bien")) return "marchand";
  if (pathname.startsWith("/apporteur")) return "apporteur";
  if (pathname.startsWith("/rehabilitation")) return "rehabilitation";
  if (pathname.startsWith("/assurance")) return "assurance";
  return undefined;
}

function getSpacePath(space: Space): string {
  switch (space) {
    case "promoteur":
      return "/promoteur";
    case "agence":
      return "/apporteur";
    case "marchand":
      return "/marchand-de-bien";
    case "mimmozia":
      return "/mimmozia";
    case "rehabilitation":
      return "/rehabilitation";
    default:
      return "/dashboard";
  }
}

function AppRoot() {
  const [currentSpace, setCurrentSpace] = useState<Space>("none");
  const navigate = useNavigate();
  const location = useLocation();
  const lastModuleRef = useRef<string | null>(null);

  const handleChangeSpace = useCallback(
    (space: Space) => {
      setCurrentSpace(space);
      // "none" = simple sortie d'un espace métier (clic logo, retour accueil).
      // On ne navigue PAS : le lien appelant gère lui-même sa destination,
      // sinon on déclenche une navigation parasite vers /dashboard.
      if (space === "none") return;
      navigate(getSpacePath(space));
    },
    [navigate]
  );

  // ── Apprentissage MimmozIA : trace l'entrée dans un module (une fois par
  //    module, pas à chaque sous-route). Signal fort pour le profil pressenti.
  useEffect(() => {
    const mod = moduleFromPath(location.pathname);
    if (mod && mod !== lastModuleRef.current) {
      lastModuleRef.current = mod;
      void track("module_open", { module: mod });
    }
  }, [location.pathname]);

  usePrechargementAuSurvol();

  // Copilot global : téléchargé seulement après la première visite d'une page
  // où il s'affiche (jamais pour un visiteur qui reste sur « / » ou /decouvrir),
  // puis gardé monté — il gère lui-même son masquage selon la route.
  // (Mise à jour pendant le rendu, motif React « ajuster l'état sur un changement
  //  de props » : pas d'effet, pas de rendu en cascade.)
  const [copilotMonte, setCopilotMonte] = useState(() => !SANS_COPILOT.has(location.pathname));
  if (!copilotMonte && !SANS_COPILOT.has(location.pathname)) setCopilotMonte(true);

  // Outils de développement : importés dynamiquement pour ne PAS embarquer
  // proj4 ni le magasin investisseur dans le code de production.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    void import("./spaces/investisseur/shared/investisseurBootstrap")
      .then(({ bootInvestisseurSnapshot }) => bootInvestisseurSnapshot())
      .catch((e) => console.warn("[Investisseur] bootInvestisseurSnapshot failed:", e));
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    void import("./lib/projection").then(({ wgs84ToLambert93 }) => {
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
    });
  }, []);

  return (
    <>
      {/* Consigne d'indexation par route. Le défaut « noindex » vient
          d'index.html ; ce composant ne l'assouplit que sur les pages
          publiques sans donnée DVF (cf. R. 112 A-3 du LPF). */}
      <RobotsPolicy />

      {/* Bandeau d'information cookies (stockages techniques uniquement) */}
      <BandeauCookies />

      <SpaceSync currentSpace={currentSpace} setCurrentSpace={setCurrentSpace} />

      <AppShell currentSpace={currentSpace} onChangeSpace={handleChangeSpace}>
        {/* Une seule frontière de chargement : au premier affichage d'une page
            différée, ChargementPage réserve la place. Ensuite, les navigations
            (transitions React Router) gardent la page courante affichée
            jusqu'à l'arrivée de la suivante — pas d'écran blanc intermédiaire. */}
        <Suspense fallback={<ChargementPage />}>
        <Routes>
          {/* ═══════════════════════════════════════════════════════════════
              PUBLIC — "/" = page d'entrée (analyse express + connexion).
              "/decouvrir" = présentation détaillée de Mimmoza (vitrine) ;
              un utilisateur déjà connecté y est renvoyé vers /accueil.
          ════════════════════════════════════════════════════════════════ */}
          <Route path="/" element={<ConnexionPage />} />
          <Route path="/decouvrir" element={<VitrinePage />} />

          {/* ── Alias publics de connexion (conservés pour compatibilité) ── */}
          <Route path="/login"     element={<ConnexionPage />} />
          <Route path="/connexion" element={<ConnexionPage />} />

          {/* ═══════════════════════════════════════════════════════════════
              LANDING PROTÉGÉE (connecté requis)
              • /accueil  → décideur : MimmozIA (défaut) ou dashboard (expert)
              • /mimmozia → porte d'entrée conversationnelle (remontée ici,
                            gagne au passage la garde d'auth qui lui manquait)
              • /dashboard→ ancienne HomePage, toujours accessible (mode expert)
          ════════════════════════════════════════════════════════════════ */}
          <Route element={<PrivateRoute />}>
            <Route path="/accueil"   element={<HomeLanding />} />
            <Route path="/mimmozia"  element={<MimmozIAPage />} />
            <Route path="/dashboard" element={<DashboardHomePage />} />
          </Route>

          {/* ═══ Légal ═══ */}
          <Route path="/cgv"                       element={<CGVPage />} />
          <Route path="/cgu"                       element={<CGUPage />} />
          <Route path="/politique-confidentialite" element={<PrivacyPolicyPage />} />
          <Route path="/mentions-legales"          element={<MentionsLegalesPage />} />

          {/* ═══ Aide et sécurité (pages publiques) ═══ */}
          <Route path="/aide"                      element={<AidePage />} />
          <Route path="/securite"                  element={<SecuritePage />} />

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
          {/* Audit 21/10/2026 : espaces connectés protégés par la session Supabase */}
          <Route element={<PrivateRoute />}>
            <Route path="/compte"      element={<ComptePage />} />
            <Route path="/abonnement"  element={<AbonnementPage />} />
            <Route path="/jetons"      element={<JetonsPage />} />
          </Route>

          {/* Redirections d'alias */}
          <Route path="/signup"   element={<Navigate to="/inscription" replace />} />
          <Route path="/register" element={<Navigate to="/inscription" replace />} />
          <Route path="/billing"  element={<Navigate to="/abonnement" replace />} />
          <Route path="/account"  element={<Navigate to="/compte" replace />} />
          <Route path="/tokens"   element={<Navigate to="/jetons" replace />} />
          {/* Page publique des tarifs (grille unique src/lib/billing/grille.ts) */}
          <Route path="/tarifs"   element={<TarifsPage />} />

          {/* ═══ Paramètres ═══ */}
          <Route element={<PrivateRoute />}>
            <Route path="/parametres/veille" element={<VeilleSettingsPage />} />

            {/* ═══ Veille → fusionnée dans Opportunités ═══ */}
            <Route path="/veille"        element={<Navigate to="/opportunites" replace />} />
            {/* Anciennes pages conservées (réversible) */}
            <Route path="/veille/legacy" element={<VeillePage />} />
            <Route path="/veille/marche" element={<VeilleMarchePage />} />
          </Route>

          {/* ═══ Analyse rapide ═══ — PUBLIQUE : produit d'appel gratuit.
              Le visiteur non connecté est invité à créer un compte au lancement. */}
          <Route path="/analyse-rapide" element={<QuickAnalysisPage />} />

          <Route element={<PrivateRoute />}>
            {/* ═══ Opportunités (transversal) — scan + suivi dans le temps ═══ */}
            <Route path="/opportunites" element={<OpportunitesHubPage />} />
          </Route>

          {/* ═══ API ═══ (/api : présentation publique) */}
          <Route path="/api"            element={<ApiPage />} />
          <Route element={<PrivateRoute />}>
            <Route path="/api/keys"       element={<ApiKeysPage />} />
            <Route path="/api/playground" element={<ApiPlaygroundPage />} />
            {/* Tableau de bord sur données fictives (apiMemberMock) : masqué */}
            <Route
              path="/api/developer"
              element={ESPACES_VISIBLES.apiDashboard
                ? <ApiDeveloperDashboardPage />
                : <BientotDisponiblePage titre="Le tableau de bord développeur" />}
            />
          </Route>

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
            <Route path="agents-gestion" element={<SocietyAgentsPage />} />
            <Route path="entreprises"   element={<AdminEntreprisesPage />} />
            <Route path="tarifs"        element={<AdminTarifsPage />} />
            <Route path="fraicheur-donnees" element={<AdminFraicheurDonneesPage />} />
            <Route path="parametres"    element={<AdminParametresPage />} />
            {/* Suivi des erreurs remontées par l'application (même garde admin) */}
            <Route path="erreurs"       element={<AdminErreursPage />} />

            {/* ── Module Agent commercial ──────────────────────────────────
                Récupéré de la branche feat/agent-commercial, jamais fusionnée :
                les 5 edge functions et les tables commercial_* étaient bien en
                production, mais l'interface n'était sur aucune route de main.
                Le module était donc invisible alors que ses données existaient
                (base de connaissance, prospects, e-mails, journal d'activité).
                ─────────────────────────────────────────────────────────────── */}
            <Route path="agent-commercial" element={<AgentCommercialLayout />}>
              <Route index                    element={<AgentCommercialOverviewPage />} />
              <Route path="prospects"         element={<AgentCommercialProspectsPage />} />
              <Route path="prospects/import"  element={<AgentCommercialProspectsImportPage />} />
              <Route path="prospects/:id"     element={<AgentCommercialProspectDetailPage />} />
              <Route path="exclusions"        element={<AgentCommercialExclusionsPage />} />
              <Route path="messages"          element={<AgentCommercialMessagesPage />} />
              <Route path="reponses"          element={<AgentCommercialRepliesPage />} />
              <Route path="campagnes"         element={<AgentCommercialCampaignsPage />} />
              <Route path="conversations"     element={<AgentCommercialConversationsPage />} />
              <Route path="relances"          element={<AgentCommercialRelancesPage />} />
              <Route path="pipeline"          element={<AgentCommercialPipelinePage />} />
              <Route path="connaissances"     element={<AgentCommercialKnowledgePage />} />
              <Route path="parametres"        element={<AgentCommercialSettingsPage />} />
            </Route>
          </Route>

          {/* ═══════════════════════════════════════════════════════════════
              ESPACES MÉTIER — session Supabase obligatoire (PrivateRoute) ;
              modules payants (Marchand de biens, Promotion, Réhabilitation)
              soumis en plus à la formule LUE EN BASE (RequirePlan).
          ════════════════════════════════════════════════════════════════ */}
          <Route element={<PrivateRoute />}>

          {/* ═══ Apporteur ═══ (inclus dans toutes les formules) */}
          <Route path="/apporteur" element={<CopilotSpaceOutlet vertical="apporteur" />}>
            <Route index element={<ApporteurDashboard />} />
            <Route path="deposer" element={<ApporteurDeposerPage />} />
            <Route path="*" element={<Navigate to="/apporteur" replace />} />
          </Route>

          {/* ═══ Particulier ═══ — masqué (pages vides) : ESPACES_VISIBLES.particulier */}
          {!ESPACES_VISIBLES.particulier && (
            <Route path="/particulier/*" element={<BientotDisponiblePage titre="L'espace Particulier" />} />
          )}
          {ESPACES_VISIBLES.particulier && (
          <Route path="/particulier" element={<CopilotSpaceOutlet vertical="particulier" />}>
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
          )}

          <Route element={<RequirePlan />}>
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
          <Route path="/promoteur" element={<CopilotSpaceOutlet vertical="promoteur" />}>
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
            <Route path="proprietaires"           element={<ProprietairesParcellesPage />} />
            <Route path="opportunites-apporteurs" element={<OpportunitesApporteursPage />} />
            <Route path="opportunites/nouvelle"   element={<NouvelleOpportunitePage />} />
            <Route path="programmation"           element={<ProgrammationPage />} />
            <Route path="strategie-projet"        element={<StrategieProjetPage />} />
            <Route path="style-tendances"          element={<StyleTendancesPage />} />
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
              {/* Page sans contenu : masquée (ESPACES_VISIBLES.promoteurExports) */}
              <Route
                path="exports"
                element={ESPACES_VISIBLES.promoteurExports
                  ? <PromoteurExports />
                  : <BientotDisponiblePage titre="Les exports Promoteur" />}
              />
            </Route>

            <Route path="*" element={<Navigate to="/promoteur" replace />} />
          </Route>
          </Route>{/* fin RequirePlan (Marchand de biens, Promotion) */}

          {/* ═══ Assurance ═══
              (autrefois monté sous /banque/assurance ; remonté ici en
              autonome suite à la mise hors-build de l'espace banque) */}
          {!ESPACES_VISIBLES.assurance && (
            <Route path="/assurance/*" element={<BientotDisponiblePage titre="L'espace Assurance" />} />
          )}
          {ESPACES_VISIBLES.assurance && (
          <Route path="/assurance" element={<CopilotSpaceOutlet vertical="generique" />}>
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
          )}

          {/* ═══ Réhabilitation ═══ */}
          <Route element={<RequirePlan />}>
          <Route path="/rehabilitation" element={<RehabilitationLayout />}>
            <Route index element={<Navigate to="/rehabilitation/projets" replace />} />

            <Route path="projets"        element={<ProjetsPage />} />
            <Route path="vue-ensemble"   element={<VueEnsemblePage />} />
            <Route path="conformite"     element={<ConformitePage />} />
            <Route path="analyse-plan"     element={<AnalysePlanPage />} />
            <Route path="travaux"          element={<RehabilitationTravauxPage />} />
            <Route path="planning-travaux" element={<RehabilitationPlanningTravauxPage />} />
            <Route path="synthese-audit"   element={<SyntheseAuditPage />} />
            <Route path="valorisation"   element={<RehabilitationValorisationPage />} />
            <Route path="rendu-travaux"  element={<RehabilitationRenduTravauxPage />} />

            {/* Legacy redirects */}
            <Route path="audit"   element={<Navigate to="/rehabilitation/vue-ensemble" replace />} />
            <Route path="analyse" element={<Navigate to="/rehabilitation/vue-ensemble" replace />} />
            <Route path="*"       element={<Navigate to="/rehabilitation/projets" replace />} />
          </Route>
          </Route>{/* fin RequirePlan (Réhabilitation) */}

          </Route>{/* fin PrivateRoute (espaces métier) */}

          {/* ═══ Compatibility redirects ═══ */}
          {/* ⚠️ Banque hors-build : toute ancienne route /banque/* → accueil */}
          <Route path="/banque/*"    element={<BientotDisponiblePage titre="L'espace Banque" />} />
          <Route path="/audit/*"     element={<Navigate to="/" replace />} />
          <Route path="/agence"      element={<Navigate to="/apporteur" replace />} />
          <Route path="/marchand"    element={<Navigate to="/marchand-de-bien" replace />} />

          {/* R1 — MimmozIA Studio (servi sous /studio/ par le serveur) : jamais la connexion */}
          <Route path="/studio/*" element={<StudioHorsApplication />} />

          {/* Catch-all → vraie page 404 (plus de renvoi silencieux vers la connexion) */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>

        {/* ═══ Mimmoza Copilot — global (bouton flottant + drawer) ═══
            Masqué sur /mimmozia : la page EST déjà l'assistant (doublon). */}
        {copilotMonte && location.pathname !== "/mimmozia" && (
          <Suspense fallback={null}>
            <CopilotRoot />
          </Suspense>
        )}
      </AppShell>
    </>
  );
}

export default function App() {
  return <AppRoot />;
}
