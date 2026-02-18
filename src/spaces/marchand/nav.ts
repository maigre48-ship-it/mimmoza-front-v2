// src/spaces/marchand/shared/nav.ts
import React from "react";
import {
  Workflow,
  Search,
  ClipboardCheck,
  Calculator,
  Hammer,
  TrendingUp,
  Download,
  Bell,
} from "lucide-react";

export type InvestisseursNavItem = {
  label: string;
  path: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  desc?: string;
};

/**
 * On garde l'ancien préfixe pour compat,
 * mais on standardise le nouveau sur /investisseurs.
 */
export const INVESTISSEURS_BASE_PATH = "/investisseurs";
export const MARCHAND_LEGACY_BASE_PATH = "/marchand-de-bien";

/**
 * Sidebar officielle (nouveau).
 */
export const INVESTISSEURS_SIDEBAR: InvestisseursNavItem[] = [
  {
    label: "Pipeline",
    path: `${INVESTISSEURS_BASE_PATH}`,
    icon: Workflow,
    desc: "Deal flow et statuts",
  },
  {
    label: "Sourcing",
    path: `${INVESTISSEURS_BASE_PATH}/sourcing`,
    icon: Search,
    desc: "Biens, leads, opportunités",
  },
  {
    label: "Qualification",
    path: `${INVESTISSEURS_BASE_PATH}/qualification`,
    icon: ClipboardCheck,
    desc: "Analyse rapide + go/no-go",
  },
  {
    label: "Alertes",
    path: `${INVESTISSEURS_BASE_PATH}/alertes`,
    icon: Bell,
    desc: "Zones surveillées + signaux marché",
  },
  {
    label: "Rentabilité",
    path: `${INVESTISSEURS_BASE_PATH}/rentabilite`,
    icon: Calculator,
    desc: "Rendement, cashflow, TRI (selon profil)",
  },
  {
    label: "Exécution",
    path: `${INVESTISSEURS_BASE_PATH}/execution`,
    icon: Hammer,
    desc: "Travaux, planning, suivi",
  },
  {
    label: "Sortie",
    path: `${INVESTISSEURS_BASE_PATH}/sortie`,
    icon: TrendingUp,
    desc: "Revente / location / découpe",
  },
  {
    label: "Exports",
    path: `${INVESTISSEURS_BASE_PATH}/exports`,
    icon: Download,
    desc: "PDF / CSV",
  },
];

/**
 * ✅ Compat legacy : certains fichiers importent encore MARCHAND_SIDEBAR / MarchandNavItem.
 * On les garde comme alias pour éviter toute casse et migrer progressivement.
 */
export type MarchandNavItem = InvestisseursNavItem;
export const MARCHAND_SIDEBAR = INVESTISSEURS_SIDEBAR;
