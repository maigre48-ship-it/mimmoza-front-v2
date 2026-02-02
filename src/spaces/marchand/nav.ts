import React from "react";
import {
  Workflow,
  Search,
  ClipboardCheck,
  Calculator,
  Hammer,
  TrendingUp,
  Download,
} from "lucide-react";

export type MarchandNavItem = {
  label: string;
  path: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  desc?: string;
};

export const MARCHAND_SIDEBAR: MarchandNavItem[] = [
  {
    label: "Pipeline",
    path: "/marchand-de-bien",
    icon: Workflow,
    desc: "Deal flow et statuts",
  },
  {
    label: "Sourcing",
    path: "/marchand-de-bien/sourcing",
    icon: Search,
    desc: "Biens, leads, opportunités",
  },
  {
    label: "Qualification",
    path: "/marchand-de-bien/qualification",
    icon: ClipboardCheck,
    desc: "Analyse rapide + go/no-go",
  },
  {
    label: "Rentabilité",
    path: "/marchand-de-bien/rentabilite",
    icon: Calculator,
    desc: "Marge, TRI, cash requis",
  },
  {
    label: "Exécution",
    path: "/marchand-de-bien/execution",
    icon: Hammer,
    desc: "Travaux, planning, suivi",
  },
  {
    label: "Sortie",
    path: "/marchand-de-bien/sortie",
    icon: TrendingUp,
    desc: "Revente / location / découpe",
  },
  {
    label: "Exports",
    path: "/marchand-de-bien/exports",
    icon: Download,
    desc: "PDF / CSV (plus tard)",
  },
];
