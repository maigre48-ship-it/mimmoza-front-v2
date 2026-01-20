import type { NavSection } from "../../components/layout/BaseShellLayout";

export const MARCHAND_SIDEBAR: NavSection[] = [
  {
    title: "Pipeline",
    items: [
      { label: "Tableau de bord", to: "/marchand-de-bien" },
    ],
  },
  {
    title: "Sourcing",
    items: [
      { label: "Recherche", to: "/marchand-de-bien/sourcing" },
    ],
  },
  {
    title: "Qualification",
    items: [
      { label: "Qualification", to: "/marchand-de-bien/qualification" },
    ],
  },
  {
    title: "Évaluation",
    items: [
      { label: "Estimation", to: "/marchand-de-bien/estimation" },
    ],
  },
  {
    title: "Rentabilité",
    items: [
      { label: "Rentabilité", to: "/marchand-de-bien/rentabilite" },
    ],
  },
  {
    title: "Exécution",
    items: [
      { label: "Exécution", to: "/marchand-de-bien/execution" },
    ],
  },
  {
    title: "Sortie",
    items: [
      { label: "Sortie", to: "/marchand-de-bien/sortie" },
    ],
  },
  {
    title: "Exports",
    items: [
      { label: "Exports", to: "/marchand-de-bien/exports" },
    ],
  },
];
