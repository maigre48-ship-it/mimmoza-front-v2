// src/spaces/admin/pages/agentCommercial/MessagesPage.tsx
import { MailCheck } from "lucide-react";
import { AgentCommercialPlaceholder } from "./AgentCommercialPlaceholder";

export function AgentCommercialMessagesPage() {
  return (
    <AgentCommercialPlaceholder
      icon={<MailCheck className="h-8 w-8 text-slate-400" />}
      title="Messages à valider"
      description="La file de validation humaine des emails générés par l'IA arrivera en phase 5. Section vide pour l'instant."
    />
  );
}
