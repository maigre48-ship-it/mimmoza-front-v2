// src/spaces/admin/pages/agentCommercial/ConversationsPage.tsx
import { MessageSquare } from "lucide-react";
import { AgentCommercialPlaceholder } from "./AgentCommercialPlaceholder";

export function AgentCommercialConversationsPage() {
  return (
    <AgentCommercialPlaceholder
      icon={<MessageSquare className="h-8 w-8 text-slate-400" />}
      title="Conversations"
      description="Le fil des échanges avec les prospects (envois et réponses) arrivera avec l'intégration Gmail en phase 6. Section vide pour l'instant."
    />
  );
}
