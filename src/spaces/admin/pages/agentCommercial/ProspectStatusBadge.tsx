// src/spaces/admin/pages/agentCommercial/ProspectStatusBadge.tsx
// Badge de statut prospect (réutilise <StatusBadge> de l'admin).

import { StatusBadge } from "@/spaces/admin/components/StatusBadge";
import {
  PROSPECT_STATUS_LABELS,
  PROSPECT_STATUS_TONES,
  type ProspectStatus,
} from "@/spaces/admin/types/agentCommercial.types";

export function ProspectStatusBadge({ status }: { status: ProspectStatus }) {
  return <StatusBadge label={PROSPECT_STATUS_LABELS[status]} tone={PROSPECT_STATUS_TONES[status]} />;
}
