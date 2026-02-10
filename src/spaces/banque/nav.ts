import { LayoutDashboard, Kanban, FileText, BarChart3, Gavel, Bell, ShieldAlert } from "lucide-react";
import type { ComponentType } from "react";

export interface BanqueNavItem {
  label: string;
  path: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

export const banqueNav: BanqueNavItem[] = [
  { label: "Dashboard", path: "/banque", icon: LayoutDashboard },
  { label: "Dossiers", path: "/banque/dossiers", icon: FileText },      // ✅ manquait
  { label: "Pipeline", path: "/banque/pipeline", icon: Kanban },
  { label: "Monitoring", path: "/banque/monitoring", icon: Bell },
];

// ⚠️ Ces liens doivent être construits AVEC l’ID du dossier (donc pas constants)
export const banqueProjectNavBase = [
  { label: "Risque",   slug: "risque",   icon: ShieldAlert },           // ✅ manquait
  { label: "Analyse",  slug: "analyse",  icon: BarChart3 },
  { label: "Décision", slug: "decision", icon: Gavel },
] as const;
