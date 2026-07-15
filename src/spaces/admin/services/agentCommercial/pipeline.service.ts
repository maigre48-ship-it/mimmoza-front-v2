// src/spaces/admin/services/agentCommercial/pipeline.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Couche données « pipeline » (transitions de statut). Phase 2 : lecture typée.
// L'écriture des transitions accompagnera le changement de statut en phase 4.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import type { CommercialPipelineEvent } from "@/spaces/admin/types/agentCommercial.types";

const TABLE = "commercial_pipeline_events";

/** Historique des transitions d'un prospect (plus récentes d'abord). */
export async function listPipelineEvents(
  prospectId: string,
): Promise<CommercialPipelineEvent[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as CommercialPipelineEvent[];
}
