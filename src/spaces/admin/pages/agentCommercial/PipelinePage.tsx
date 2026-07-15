// src/spaces/admin/pages/agentCommercial/PipelinePage.tsx
import { GitBranch } from "lucide-react";
import { AgentCommercialPlaceholder } from "./AgentCommercialPlaceholder";

export function AgentCommercialPipelinePage() {
  return (
    <AgentCommercialPlaceholder
      icon={<GitBranch className="h-8 w-8 text-slate-400" />}
      title="Pipeline"
      description="Le board par statut (changement via menu déroulant, sans drag & drop) arrivera en phase 4. Section vide pour l'instant."
    />
  );
}
