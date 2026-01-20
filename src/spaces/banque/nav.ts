import type { NavSection } from "../../components/layout/BaseShellLayout";

export const BANQUE_SIDEBAR: NavSection[] = [
  {
    title: "Portefeuille",
    items: [
      { label: "Tableau de bord", to: "/banque" },
    ],
  },
  {
    title: "Origination",
    items: [
      { label: "Origination", to: "/banque/origination" },
    ],
  },
  {
    title: "Analyse",
    items: [
      { label: "Analyse", to: "/banque/analyse" },
    ],
  },
  {
    title: "Évaluation",
    items: [
      { label: "Estimation", to: "/banque/estimation" },
    ],
  },
  {
    title: "Garanties",
    items: [
      { label: "Garanties", to: "/banque/garanties" },
    ],
  },
  {
    title: "Décision",
    items: [
      { label: "Décision", to: "/banque/decision" },
    ],
  },
  {
    title: "Monitoring",
    items: [
      { label: "Monitoring", to: "/banque/monitoring" },
    ],
  },
  {
    title: "Documents",
    items: [
      { label: "Documents", to: "/banque/documents" },
    ],
  },
];
