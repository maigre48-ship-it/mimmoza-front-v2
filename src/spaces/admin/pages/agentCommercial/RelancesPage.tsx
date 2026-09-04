// src/spaces/admin/pages/agentCommercial/RelancesPage.tsx
import { Clock } from "lucide-react";
import { AgentCommercialPlaceholder } from "./AgentCommercialPlaceholder";

export function AgentCommercialRelancesPage() {
  return (
    <AgentCommercialPlaceholder
      icon={<Clock className="h-8 w-8 text-slate-400" />}
      title="Relances"
      description="La planification et le suivi des relances arriveront en phase 7. Section vide pour l'instant."
    />
  );
}
