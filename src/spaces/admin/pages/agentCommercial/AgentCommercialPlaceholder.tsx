// src/spaces/admin/pages/agentCommercial/AgentCommercialPlaceholder.tsx
// Bloc de section vide réutilisé par toutes les sous-pages du squelette (phase 2).
// S'appuie sur le composant partagé EmptyState de l'app.

import type { ReactNode } from "react";
import { EmptyState } from "@/components/layouts/EmptyState";

export function AgentCommercialPlaceholder({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <EmptyState icon={icon} title={title} description={description} />
    </div>
  );
}
