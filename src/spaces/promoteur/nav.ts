import type { NavSection } from "../../components/layout/BaseShellLayout";

export const PROMOTEUR_SIDEBAR: NavSection[] = [
  {
    title: "Démarrer",
    items: [
      { label: "Tableau de bord", to: "/promoteur" },
    ],
  },
  {
    title: "Foncier",
    items: [
      { label: "Foncier", to: "/promoteur/foncier" },
    ],
  },
  {
    title: "Faisabilité",
    items: [
      { label: "PLU & Faisabilité", to: "/promoteur/plu-faisabilite" },
    ],
  },
  {
    title: "Évaluation",
    items: [
      { label: "Estimation", to: "/promoteur/estimation" },
    ],
  },
  {
    title: "Études",
    items: [
      { label: "Marché", to: "/promoteur/marche" },
      { label: "Risques", to: "/promoteur/risques" },
    ],
  },
  {
    title: "Conception",
    items: [
      { label: "Implantation 2D", to: "/promoteur/implantation-2d" },
      { label: "Massing 3D", to: "/promoteur/massing-3d" },
    ],
  },
  {
    title: "Bilan",
    items: [
      { label: "Bilan", to: "/promoteur/bilan" },
    ],
  },
  {
    title: "Synthèse",
    items: [
      { label: "Synthèse", to: "/promoteur/synthese" },
      { label: "Exports", to: "/promoteur/exports" },
    ],
  },
];
