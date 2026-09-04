// src/spaces/admin/services/agentCommercial/pipeline.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Couche données « pipeline » (transitions de statut). Lecture typée + écriture
// d'une transition. Le BOARD pipeline (UI drag-less) reste en phase 4 ; ici on ne
// fait qu'historiser une transition quand le statut d'un prospect change (phase 3).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import type {
  CommercialPipelineEvent,
  ProspectStatus,
} from "@/spaces/admin/types/agentCommercial.types";

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

/**
 * Enregistre une transition de statut. NON BLOQUANT : un échec d'historisation
 * ne doit pas faire échouer la mise à jour du prospect (déjà persistée).
 * moved_by est renseigné côté DB via default auth.uid().
 */
export async function recordTransition(
  prospectId: string,
  fromStatus: ProspectStatus | null,
  toStatus: ProspectStatus,
  note?: string | null,
): Promise<void> {
  try {
    const { error } = await supabase.from(TABLE).insert({
      prospect_id: prospectId,
      from_status: fromStatus,
      to_status: toStatus,
      note: note ?? null,
    });
    if (error) {
      console.warn("[agentCommercial] transition non historisée:", error.message);
    }
  } catch (err) {
    console.warn("[agentCommercial] transition non historisée:", err);
  }
}
