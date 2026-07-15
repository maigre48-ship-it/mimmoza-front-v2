// src/spaces/admin/services/agentCommercial/activityLog.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Couche données « journal d'activité ». Phase 2 : lecture typée uniquement.
// L'écriture (append) sera branchée sur les actions métier des phases suivantes.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import type { CommercialActivityLog } from "@/spaces/admin/types/agentCommercial.types";

const TABLE = "commercial_activity_log";

/** Dernières entrées du journal (plus récentes d'abord). */
export async function listActivity(limit = 100): Promise<CommercialActivityLog[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as CommercialActivityLog[];
}
