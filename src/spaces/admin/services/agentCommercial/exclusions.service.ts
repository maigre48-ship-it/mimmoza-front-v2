// src/spaces/admin/services/agentCommercial/exclusions.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Couche données « liste d'exclusion ». Phase 2 : lecture typée uniquement.
// L'ajout / retrait d'exclusions arrivera avec la gestion des prospects (phase 3).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import type { CommercialExclusion } from "@/spaces/admin/types/agentCommercial.types";

const TABLE = "commercial_exclusions";

/** Liste toutes les exclusions (plus récentes d'abord). */
export async function listExclusions(): Promise<CommercialExclusion[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as CommercialExclusion[];
}
