// src/spaces/admin/services/agentCommercial/activityLog.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Journal d'activité du module. Lecture typée + écriture append NON BLOQUANTE :
// un échec de log ne doit jamais faire échouer l'action métier appelante.
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

/** Entrées du journal liées à une entité précise (ex. un prospect). */
export async function listActivityForEntity(
  entity: string,
  entityId: string,
  limit = 100,
): Promise<CommercialActivityLog[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("entity", entity)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as CommercialActivityLog[];
}

/**
 * Écrit une entrée de journal. NE THROW JAMAIS : en cas d'erreur, on log en
 * console et on continue (actor_id est renseigné côté DB via default auth.uid()).
 */
export async function logActivity(entry: {
  event_type: string;
  entity?: string | null;
  entity_id?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await supabase.from(TABLE).insert({
      event_type: entry.event_type,
      entity: entry.entity ?? null,
      entity_id: entry.entity_id ?? null,
      metadata: entry.metadata ?? {},
    });
    if (error) {
      console.warn("[agentCommercial] journalisation échouée:", error.message);
    }
  } catch (err) {
    console.warn("[agentCommercial] journalisation échouée:", err);
  }
}
