// src/spaces/admin/pages/agentCommercial/EmailStatusBadge.tsx
import { StatusBadge } from "@/spaces/admin/components/StatusBadge";
import {
  EMAIL_STATUS_LABELS,
  EMAIL_STATUS_TONES,
  type EmailStatus,
} from "@/spaces/admin/types/agentCommercial.types";

export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  return <StatusBadge label={EMAIL_STATUS_LABELS[status]} tone={EMAIL_STATUS_TONES[status]} />;
}
