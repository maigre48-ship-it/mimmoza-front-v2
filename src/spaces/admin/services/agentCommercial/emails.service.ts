// src/spaces/admin/services/agentCommercial/emails.service.ts
// ─────────────────────────────────────────────────────────────────────────────
// Couche données « emails IA » : file de validation (pending_review), édition du
// contenu, validation (approved) / rejet (rejected). AUCUN envoi ici (phase 6).
// Journalisation non bloquante.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";
import type {
  CommercialEmail,
  EmailStatus,
} from "@/spaces/admin/types/agentCommercial.types";
import { logActivity } from "./activityLog.service";

const TABLE = "commercial_emails";

const PROSPECT_EMBED = "prospect:commercial_prospects(company_name, first_name, last_name)";

export interface EmailWithProspect extends CommercialEmail {
  prospect: {
    company_name: string;
    first_name: string | null;
    last_name: string | null;
  } | null;
}

/** Emails d'un statut donné (plus récents d'abord), avec le prospect embarqué. */
export async function listEmailsByStatus(status: EmailStatus): Promise<EmailWithProspect[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(`*, ${PROSPECT_EMBED}`)
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as EmailWithProspect[];
}

/** Emails d'un prospect (plus récents d'abord). */
export async function listEmailsForProspect(prospectId: string): Promise<CommercialEmail[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as CommercialEmail[];
}

/** Édite le sujet/corps d'un email (uniquement pertinent tant qu'il est à valider). */
export async function updateEmailContent(
  id: string,
  patch: { subject: string; body: string },
): Promise<CommercialEmail> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ subject: patch.subject, body: patch.body })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  void logActivity({ event_type: "email_updated", entity: "email", entity_id: id });
  return data as CommercialEmail;
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Valide un email (status → approved). N'ENVOIE RIEN (Gmail = phase 6). */
export async function approveEmail(id: string): Promise<void> {
  const reviewer = await currentUserId();
  const { error } = await supabase
    .from(TABLE)
    .update({ status: "approved", reviewed_by: reviewer })
    .eq("id", id);

  if (error) throw new Error(error.message);
  void logActivity({ event_type: "email_approved", entity: "email", entity_id: id });
}

/** Rejette un email (status → rejected). */
export async function rejectEmail(id: string): Promise<void> {
  const reviewer = await currentUserId();
  const { error } = await supabase
    .from(TABLE)
    .update({ status: "rejected", reviewed_by: reviewer })
    .eq("id", id);

  if (error) throw new Error(error.message);
  void logActivity({ event_type: "email_rejected", entity: "email", entity_id: id });
}
