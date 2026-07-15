// src/spaces/admin/pages/agentCommercial/KnowledgePage.tsx
import { BookOpen } from "lucide-react";
import { AgentCommercialPlaceholder } from "./AgentCommercialPlaceholder";

export function AgentCommercialKnowledgePage() {
  return (
    <AgentCommercialPlaceholder
      icon={<BookOpen className="h-8 w-8 text-slate-400" />}
      title="Base de connaissances"
      description="Les éléments de contexte fournis à l'IA pour rédiger les messages (arguments, ton, offres) seront gérés ici à partir de la phase 5. Section vide pour l'instant."
    />
  );
}
