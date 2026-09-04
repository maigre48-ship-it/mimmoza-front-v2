// src/spaces/admin/services/agentCommercial/prospects.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Couche données « prospects » : lecture, création manuelle, édition, archivage
// doux (archived_at), insertion d'import, et orchestration des effets de bord
// (vérification d'exclusion, historisation de transition, journalisation).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import type {
  CommercialProspect,
  ProspectFormValues,
  ProspectStatus,
} from "@/spaces/admin/types/agentCommercial.types";
import { logActivity } from "./activityLog.service";
import { recordTransition } from "./pipeline.service";
import { createExclusion } from "./exclusions.service";
import { isExcluded, normalizeEmail } from "./exclusionCheck";

const TABLE = "commercial_prospects";

type Scope = "active" | "archived" | "all";

/** Liste les prospects selon le périmètre (actifs par défaut). */
export async function listProspects(
  opts?: { scope?: Scope },
): Promise<CommercialProspect[]> {
  const scope = opts?.scope ?? "active";
  let query = supabase.from(TABLE).select("*").order("created_at", { ascending: false });

  if (scope === "active") query = query.is("archived_at", null);
  else if (scope === "archived") query = query.not("archived_at", "is", null);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as CommercialProspect[];
}

/** Récupère un prospect par son id, ou null. */
export async function getProspect(id: string): Promise<CommercialProspect | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as CommercialProspect | null) ?? null;
}

/** Ensemble des emails déjà présents (tous périmètres) pour la déduplication. */
export async function getExistingEmailSet(): Promise<Set<string>> {
  const { data, error } = await supabase.from(TABLE).select("email");
  if (error) throw new Error(error.message);

  const set = new Set<string>();
  for (const row of (data ?? []) as Array<{ email: string | null }>) {
    const e = normalizeEmail(row.email);
    if (e) set.add(e);
  }
  return set;
}

// ── Écritures brutes ─────────────────────────────────────────────────────────

async function insertProspect(
  values: ProspectFormValues,
  source: "manual" | "import",
): Promise<CommercialProspect> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...values, email: normalizeEmail(values.email), source })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as CommercialProspect;
}

async function updateProspect(
  id: string,
  patch: Partial<ProspectFormValues>,
): Promise<CommercialProspect> {
  const payload =
    "email" in patch ? { ...patch, email: normalizeEmail(patch.email ?? null) } : patch;

  const { data, error } = await supabase
    .from(TABLE)
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as CommercialProspect;
}

// ── Effets de bord partagés ──────────────────────────────────────────────────

/**
 * Applique TOUS les effets d'un opt-out, de façon centralisée :
 *   1. ajout à la liste d'exclusion (par email), non bloquant ;
 *   2. bascule du statut vers « exclu » via changeProspectStatus — donc avec
 *      transition historisée (commercial_pipeline_events) et journalisation
 *      (commercial_activity_log). No-op si le prospect est déjà « exclu ».
 * Retourne le prospect à jour (statut « exclu »).
 */
async function excludeProspectByOptOut(
  prospect: CommercialProspect,
): Promise<CommercialProspect> {
  const email = normalizeEmail(prospect.email);
  if (email) {
    try {
      await createExclusion({
        email,
        reason: "Opposition à la prospection (opt-out)",
        metadata: { prospect_id: prospect.id, via: "opt_out" },
      });
      void logActivity({
        event_type: "exclusion_added",
        entity: "prospect",
        entity_id: prospect.id,
        metadata: { via: "opt_out", email },
      });
    } catch (err) {
      // L'exclusion peut déjà exister : non bloquant.
      console.warn("[agentCommercial] exclusion opt-out non ajoutée:", err);
    }
  } else {
    console.warn(
      "[agentCommercial] opt-out sans email : impossible d'ajouter à la liste d'exclusion",
      prospect.id,
    );
  }

  // Un prospect en opt-out doit être « exclu » dans le pipeline.
  return changeProspectStatus(prospect, "exclu");
}

// ── Cas d'usage orchestrés ───────────────────────────────────────────────────

/**
 * Création manuelle. Refuse un email présent dans la liste d'exclusion :
 * une personne exclue ne doit jamais être réintégrée.
 */
export async function createProspectManual(
  values: ProspectFormValues,
): Promise<CommercialProspect> {
  const email = normalizeEmail(values.email);
  if (email) {
    const match = await isExcluded({ email });
    if (match.excluded) {
      throw new Error(
        "Ce contact figure dans la liste d'exclusion. Retire-le de la liste d'exclusion avant de le créer.",
      );
    }
  }

  const created = await insertProspect(values, "manual");

  void logActivity({
    event_type: "prospect_created",
    entity: "prospect",
    entity_id: created.id,
    metadata: { source: "manual" },
  });

  if (created.status !== "a_qualifier") {
    void recordTransition(created.id, null, created.status);
  }
  if (created.opt_out) {
    // Force le statut « exclu » + ajout à la liste d'exclusion.
    return excludeProspectByOptOut(created);
  }

  return created;
}

/**
 * Édition d'un prospect existant. Journalise la modification, historise une
 * éventuelle transition de statut, et applique l'exclusion en cas de passage
 * en opt-out.
 */
export async function saveProspectEdit(
  prev: CommercialProspect,
  values: ProspectFormValues,
): Promise<CommercialProspect> {
  const updated = await updateProspect(prev.id, values);

  void logActivity({
    event_type: "prospect_updated",
    entity: "prospect",
    entity_id: prev.id,
  });

  if (prev.status !== updated.status) {
    void recordTransition(prev.id, prev.status, updated.status);
    void logActivity({
      event_type: "status_changed",
      entity: "prospect",
      entity_id: prev.id,
      metadata: { from: prev.status, to: updated.status },
    });
  }

  if (!prev.opt_out && updated.opt_out) {
    // Passage en opt-out : force le statut « exclu » + ajout à la liste d'exclusion.
    return excludeProspectByOptOut(updated);
  }

  return updated;
}

/**
 * Change uniquement le statut d'un prospect (pipeline). Réutilise recordTransition
 * (historisation) et journalise le changement. Retourne le prospect à jour.
 */
export async function changeProspectStatus(
  prospect: CommercialProspect,
  toStatus: ProspectStatus,
): Promise<CommercialProspect> {
  if (toStatus === prospect.status) return prospect;

  const updated = await updateProspect(prospect.id, { status: toStatus });

  void recordTransition(prospect.id, prospect.status, toStatus);
  void logActivity({
    event_type: "status_changed",
    entity: "prospect",
    entity_id: prospect.id,
    metadata: { from: prospect.status, to: toStatus },
  });

  return updated;
}

/**
 * Bascule vers « exclu » les prospects ACTIFS dont l'email correspond EXACTEMENT
 * (suite à un ajout manuel d'exclusion par email). Réutilise changeProspectStatus
 * (transition historisée + journalisation). Ne touche pas opt_out. Les exclusions
 * par domaine ne basculent volontairement aucun statut. Retourne le nombre basculé.
 */
export async function excludeProspectsByEmail(email: string): Promise<number> {
  const target = normalizeEmail(email);
  if (!target) return 0;

  const actives = await listProspects({ scope: "active" });
  const matches = actives.filter(
    (p) => normalizeEmail(p.email) === target && p.status !== "exclu",
  );

  for (const p of matches) {
    await changeProspectStatus(p, "exclu");
  }
  return matches.length;
}

/** Archivage doux (« Supprimer » côté UI). Réversible. */
export async function archiveProspect(id: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(error.message);

  void logActivity({ event_type: "prospect_archived", entity: "prospect", entity_id: id });
}

/** Restauration d'un prospect archivé. */
export async function restoreProspect(id: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ archived_at: null })
    .eq("id", id);

  if (error) throw new Error(error.message);

  void logActivity({ event_type: "prospect_restored", entity: "prospect", entity_id: id });
}

/**
 * Insère un lot de prospects importés (source = import). Les lignes exclues et
 * les doublons DOIVENT avoir été filtrés en amont par l'écran d'import, qui est
 * aussi responsable de journaliser le bilan complet de l'import.
 * Retourne le nombre de lignes réellement insérées.
 */
export async function insertImportedProspects(
  rows: ProspectFormValues[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const payload = rows.map((r) => ({
    ...r,
    email: normalizeEmail(r.email),
    source: "import" as const,
  }));

  const { data, error } = await supabase.from(TABLE).insert(payload).select("id");
  if (error) throw new Error(error.message);

  return data?.length ?? 0;
}
