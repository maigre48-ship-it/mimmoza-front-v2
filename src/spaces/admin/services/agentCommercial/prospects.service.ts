// src/spaces/admin/services/agentCommercial/prospects.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Couche données « prospects » du module Agent commercial.
// Phase 2 : accès en lecture typés uniquement. Le CRUD complet (création, édition,
// suppression, import CSV, déduplication) arrive en phase 3.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import type { CommercialProspect } from "@/spaces/admin/types/agentCommercial.types";

const TABLE = "commercial_prospects";

/** Liste tous les prospects (plus récents d'abord). */
export async function listProspects(): Promise<CommercialProspect[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as CommercialProspect[];
}

/** Récupère un prospect par son id, ou null s'il n'existe pas. */
export async function getProspect(id: string): Promise<CommercialProspect | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as CommercialProspect | null) ?? null;
}

/** Nombre total de prospects. */
export async function countProspects(): Promise<number> {
  const { count, error } = await supabase
    .from(TABLE)
    .select("id", { count: "exact", head: true });

  if (error) throw new Error(error.message);
  return count ?? 0;
}
