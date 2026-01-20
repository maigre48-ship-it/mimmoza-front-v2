import type { NavSection } from "../../components/layout/BaseShellLayout";

export const ASSURANCE_SIDEBAR: NavSection[] = [
  {
    title: "Portefeuille",
    items: [
      { label: "Tableau de bord", to: "/assurance" },
    ],
  },
  {
    title: "Souscription",
    items: [
      { label: "Souscription", to: "/assurance/souscription" },
    ],
  },
  {
    title: "Exposition",
    items: [
      { label: "Exposition", to: "/assurance/exposition" },
    ],
  },
  {
    title: "Évaluation",
    items: [
      { label: "Estimation", to: "/assurance/estimation" },
    ],
  },
  {
    title: "Tarification",
    items: [
      { label: "Tarification", to: "/assurance/tarification" },
    ],
  },
  {
    title: "Offre",
    items: [
      { label: "Offre", to: "/assurance/offre" },
    ],
  },
  {
    title: "Monitoring",
    items: [
      { label: "Monitoring", to: "/assurance/monitoring" },
    ],
  },
  {
    title: "Documents",
    items: [
      { label: "Documents", to: "/assurance/documents" },
    ],
  },
];
