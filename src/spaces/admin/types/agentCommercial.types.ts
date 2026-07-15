// src/spaces/admin/types/agentCommercial.types.ts
// ─────────────────────────────────────────────────────────────────────────────
// Types du module « Agent commercial » (espace admin).
// Reflètent le schéma des tables commercial_* (migrations 20260715_agent_commercial_*).
// Phase 2 — socle. Aucune logique métier ici, uniquement les formes de données.
// ─────────────────────────────────────────────────────────────────────────────

import type { StatusBadgeTone } from "./statusBadgeTone";

// ── Statuts du pipeline ──────────────────────────────────────────────────────
// L'ordre reflète la progression logique dans le pipeline commercial.
export const PROSPECT_STATUSES = [
  "a_qualifier",
  "a_contacter",
  "message_a_valider",
  "contacte",
  "relance_prevue",
  "a_repondu",
  "interesse",
  "demonstration",
  "essai",
  "negociation",
  "client",
  "non_interesse",
  "exclu",
] as const;

export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

// Libellés FR affichables.
export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  a_qualifier: "À qualifier",
  a_contacter: "À contacter",
  message_a_valider: "Message à valider",
  contacte: "Contacté",
  relance_prevue: "Relance prévue",
  a_repondu: "A répondu",
  interesse: "Intéressé",
  demonstration: "Démonstration",
  essai: "Essai",
  negociation: "Négociation",
  client: "Client",
  non_interesse: "Non intéressé",
  exclu: "Exclu",
};

// Tons StatusBadge (voir src/spaces/admin/components/StatusBadge.tsx).
export const PROSPECT_STATUS_TONES: Record<ProspectStatus, StatusBadgeTone> = {
  a_qualifier: "slate",
  a_contacter: "sky",
  message_a_valider: "amber",
  contacte: "sky",
  relance_prevue: "amber",
  a_repondu: "violet",
  interesse: "emerald",
  demonstration: "violet",
  essai: "violet",
  negociation: "amber",
  client: "emerald",
  non_interesse: "rose",
  exclu: "rose",
};

// ── Sources de prospects ─────────────────────────────────────────────────────
export const PROSPECT_SOURCES = ["manual", "import"] as const;
export type ProspectSource = (typeof PROSPECT_SOURCES)[number];

// ── Lignes de tables ─────────────────────────────────────────────────────────

export interface CommercialProspect {
  id: string;
  company_name: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  department: string | null;
  zone: string | null;
  company_type: string | null;
  company_size: string | null;
  source: ProspectSource;
  notes: string | null;
  status: ProspectStatus;
  score: number | null;
  last_interaction_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  opt_out: boolean;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommercialPipelineEvent {
  id: string;
  prospect_id: string;
  from_status: ProspectStatus | null;
  to_status: ProspectStatus;
  note: string | null;
  metadata: Record<string, unknown>;
  moved_by: string | null;
  created_at: string;
}

export interface CommercialExclusion {
  id: string;
  email: string | null;
  domain: string | null;
  siren: string | null;
  reason: string;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export interface CommercialActivityLog {
  id: string;
  event_type: string;
  entity: string | null;
  entity_id: string | null;
  actor_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
