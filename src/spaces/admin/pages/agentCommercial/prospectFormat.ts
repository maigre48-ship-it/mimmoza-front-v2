// src/spaces/admin/pages/agentCommercial/prospectFormat.ts
// Helpers d'affichage (fonctions pures, sans JSX) du module Agent commercial.

import type {
  CommercialProspect,
  ProspectFormValues,
} from "@/spaces/admin/types/agentCommercial.types";

/** Nom affichable d'un contact (prénom + nom), ou tiret si vide. */
export function prospectContactName(p: {
  first_name: string | null;
  last_name: string | null;
}): string {
  const parts = [p.first_name, p.last_name].filter((s): s is string => !!s && s.trim().length > 0);
  return parts.length > 0 ? parts.join(" ") : "—";
}

/** Formate une date ISO en date courte FR, ou tiret si vide. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(d);
}

/** Formate une date ISO en date + heure FR, ou tiret si vide. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

/** Réduit une date ISO à sa portion AAAA-MM-JJ (pour <input type="date">). */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

/** Valeurs par défaut d'un nouveau prospect. */
export function emptyProspectForm(): ProspectFormValues {
  return {
    company_name: "",
    first_name: null,
    last_name: null,
    job_title: null,
    email: null,
    phone: null,
    website: null,
    city: null,
    department: null,
    zone: null,
    company_type: null,
    company_size: null,
    notes: null,
    status: "a_qualifier",
    score: null,
    next_action: null,
    next_action_at: null,
    last_interaction_at: null,
    legal_basis: "interet_legitime",
    opt_out: false,
  };
}

/** Convertit un prospect existant en valeurs de formulaire. */
export function prospectToForm(p: CommercialProspect): ProspectFormValues {
  return {
    company_name: p.company_name,
    first_name: p.first_name,
    last_name: p.last_name,
    job_title: p.job_title,
    email: p.email,
    phone: p.phone,
    website: p.website,
    city: p.city,
    department: p.department,
    zone: p.zone,
    company_type: p.company_type,
    company_size: p.company_size,
    notes: p.notes,
    status: p.status,
    score: p.score,
    next_action: p.next_action,
    next_action_at: toDateInput(p.next_action_at) || null,
    last_interaction_at: toDateInput(p.last_interaction_at) || null,
    legal_basis: p.legal_basis,
    opt_out: p.opt_out,
  };
}
