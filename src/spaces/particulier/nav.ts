import type { NavSection } from "../../components/layout/BaseShellLayout";

export const PARTICULIER_SIDEBAR: NavSection[] = [
  { title: "Démarrer", items: [
    { label: "Tableau de bord", to: "/particulier" },
    { label: "Mon projet", to: "/particulier/projet" },
    { label: "Favoris", to: "/particulier/favoris" },
  ]},
  { title: "Recherche", items: [
    { label: "Recherche de biens", to: "/particulier/recherche" },
    { label: "Alertes", to: "/particulier/alertes" },
    { label: "Comparateur", to: "/particulier/comparateur" },
  ]},
  { title: "Évaluation", items: [
    { label: "Estimation", to: "/particulier/evaluation" },
    { label: "Quartier", to: "/particulier/quartier" },
    { label: "Charges", to: "/particulier/charges" },
  ]},
  { title: "Financement", items: [
    { label: "Capacité", to: "/particulier/financement" },
    { label: "Scénarios", to: "/particulier/scenarios" },
    { label: "Dossier banque", to: "/particulier/dossier" },
  ]},
  { title: "Travaux", items: [
    { label: "Budget travaux", to: "/particulier/travaux" },
    { label: "Conformité", to: "/particulier/conformite" },
    { label: "Planning", to: "/particulier/planning" },
  ]},
  { title: "Documents", items: [
    { label: "Mes documents", to: "/particulier/documents" },
    { label: "Exports", to: "/particulier/exports" },
    { label: "Historique", to: "/particulier/historique" },
  ]},
];
