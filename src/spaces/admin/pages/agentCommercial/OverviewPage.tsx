// src/spaces/admin/pages/agentCommercial/OverviewPage.tsx
import { LayoutDashboard } from "lucide-react";
import { AgentCommercialPlaceholder } from "./AgentCommercialPlaceholder";

export function AgentCommercialOverviewPage() {
  return (
    <AgentCommercialPlaceholder
      icon={<LayoutDashboard className="h-8 w-8 text-slate-400" />}
      title="Vue d'ensemble"
      description="Le tableau de bord (KPIs, activité récente) sera branché une fois les données disponibles. Section vide pour l'instant."
    />
  );
}
