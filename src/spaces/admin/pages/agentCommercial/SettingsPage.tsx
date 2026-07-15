// src/spaces/admin/pages/agentCommercial/SettingsPage.tsx
import { Settings } from "lucide-react";
import { AgentCommercialPlaceholder } from "./AgentCommercialPlaceholder";

export function AgentCommercialSettingsPage() {
  return (
    <AgentCommercialPlaceholder
      icon={<Settings className="h-8 w-8 text-slate-400" />}
      title="Paramètres"
      description="Les réglages du module (connexion Gmail, règles de relance, liste d'exclusion) seront regroupés ici à partir des phases 6 et 7. Section vide pour l'instant."
    />
  );
}
