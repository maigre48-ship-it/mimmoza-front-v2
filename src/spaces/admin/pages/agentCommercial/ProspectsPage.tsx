// src/spaces/admin/pages/agentCommercial/ProspectsPage.tsx
import { Users } from "lucide-react";
import { AgentCommercialPlaceholder } from "./AgentCommercialPlaceholder";

export function AgentCommercialProspectsPage() {
  return (
    <AgentCommercialPlaceholder
      icon={<Users className="h-8 w-8 text-slate-400" />}
      title="Prospects"
      description="La gestion des prospects (saisie manuelle et import CSV) arrivera en phase 3. Section vide pour l'instant."
    />
  );
}
