// src/spaces/admin/services/agentCommercial/knowledgeBase.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Couche données « base de connaissances ». CRUD + réordonnancement (position).
// Journalisation non bloquante dans commercial_activity_log.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import type {
  CommercialKnowledgeEntry,
  KnowledgeFormValues,
  KnowledgeSection,
} from "@/spaces/admin/types/agentCommercial.types";
import { logActivity } from "./activityLog.service";

const TABLE = "commercial_knowledge_base";

/** Liste toutes les entrées, triées par section puis position. */
export async function listKnowledge(): Promise<CommercialKnowledgeEntry[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("section", { ascending: true })
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as CommercialKnowledgeEntry[];
}

/** Prochaine position disponible dans une section (max + 1). */
async function nextPosition(section: KnowledgeSection): Promise<number> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("position")
    .eq("section", section)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const max = (data as { position: number } | null)?.position;
  return typeof max === "number" ? max + 1 : 0;
}

export async function createKnowledge(
  values: KnowledgeFormValues,
): Promise<CommercialKnowledgeEntry> {
  const position = await nextPosition(values.section);

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      section: values.section,
      title: values.title.trim(),
      content: values.content,
      status: values.status,
      position,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  const entry = data as CommercialKnowledgeEntry;

  void logActivity({
    event_type: "knowledge_created",
    entity: "knowledge",
    entity_id: entry.id,
    metadata: { section: entry.section, status: entry.status },
  });

  return entry;
}

export async function updateKnowledge(
  id: string,
  patch: Partial<KnowledgeFormValues>,
): Promise<CommercialKnowledgeEntry> {
  const payload =
    "title" in patch && typeof patch.title === "string"
      ? { ...patch, title: patch.title.trim() }
      : patch;

  const { data, error } = await supabase
    .from(TABLE)
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  const entry = data as CommercialKnowledgeEntry;

  void logActivity({
    event_type: "knowledge_updated",
    entity: "knowledge",
    entity_id: id,
  });

  return entry;
}

export async function deleteKnowledge(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);

  void logActivity({
    event_type: "knowledge_deleted",
    entity: "knowledge",
    entity_id: id,
  });
}

/**
 * Échange la position de deux entrées (réordonnancement). Non journalisé par
 * entrée : une seule ligne de journal pour l'action de réorganisation.
 */
export async function swapKnowledgePositions(
  a: { id: string; position: number },
  b: { id: string; position: number },
): Promise<void> {
  const r1 = await supabase.from(TABLE).update({ position: b.position }).eq("id", a.id);
  if (r1.error) throw new Error(r1.error.message);
  const r2 = await supabase.from(TABLE).update({ position: a.position }).eq("id", b.id);
  if (r2.error) throw new Error(r2.error.message);

  void logActivity({
    event_type: "knowledge_reordered",
    entity: "knowledge",
    entity_id: a.id,
    metadata: { swapped_with: b.id },
  });
}
