// src/spaces/admin/services/agentCommercial/exclusions.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Couche données « liste d'exclusion » : lecture, ajout (motif obligatoire),
// retrait. La vérification d'exclusion vit dans exclusionCheck.ts (réutilisable).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import type { CommercialExclusion } from "@/spaces/admin/types/agentCommercial.types";
import { normalizeDomain, normalizeEmail, normalizeSiren } from "./exclusionCheck";

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

export interface ExclusionInput {
  email?: string | null;
  domain?: string | null;
  siren?: string | null;
  reason: string;
  metadata?: Record<string, unknown>;
}

/**
 * Ajoute une exclusion. Au moins un critère (email/domaine/SIREN) et un motif
 * sont obligatoires (contrainte DB + validation côté service).
 */
export async function createExclusion(input: ExclusionInput): Promise<CommercialExclusion> {
  const email = normalizeEmail(input.email);
  const domain = normalizeDomain(input.domain);
  const siren = normalizeSiren(input.siren);
  const reason = input.reason.trim();

  if (!email && !domain && !siren) {
    throw new Error("Renseigne au moins un email, un domaine ou un SIREN.");
  }
  if (!reason) {
    throw new Error("Le motif d'exclusion est obligatoire.");
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({ email, domain, siren, reason, metadata: input.metadata ?? {} })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as CommercialExclusion;
}

/** Retire une exclusion (suppression dure : une exclusion levée n'a plus d'objet). */
export async function deleteExclusion(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
