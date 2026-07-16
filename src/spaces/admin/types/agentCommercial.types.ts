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

export const PROSPECT_SOURCE_LABELS: Record<ProspectSource, string> = {
  manual: "Saisie manuelle",
  import: "Import CSV",
};

// ── Base légale de prospection (RGPD) ────────────────────────────────────────
export const PROSPECT_LEGAL_BASES = ["interet_legitime", "consentement"] as const;
export type ProspectLegalBasis = (typeof PROSPECT_LEGAL_BASES)[number];

export const PROSPECT_LEGAL_BASIS_LABELS: Record<ProspectLegalBasis, string> = {
  interet_legitime: "Intérêt légitime",
  consentement: "Consentement",
};

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
  legal_basis: ProspectLegalBasis;
  archived_at: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Champs éditables d'un prospect (création manuelle / édition).
// Tous en snake_case pour un mapping direct vers les colonnes.
export interface ProspectFormValues {
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
  notes: string | null;
  status: ProspectStatus;
  score: number | null;
  next_action: string | null;
  next_action_at: string | null;
  last_interaction_at: string | null;
  legal_basis: ProspectLegalBasis;
  opt_out: boolean;
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

// ── Base de connaissances ────────────────────────────────────────────────────
export const KNOWLEDGE_SECTIONS = [
  "presentation",
  "metiers_cibles",
  "problemes",
  "fonctionnalites",
  "benefices",
  "limites",
  "tarifs",
  "faq",
  "objections",
  "liens",
  "signature",
] as const;

export type KnowledgeSection = (typeof KNOWLEDGE_SECTIONS)[number];

export const KNOWLEDGE_SECTION_LABELS: Record<KnowledgeSection, string> = {
  presentation: "Présentation",
  metiers_cibles: "Métiers cibles",
  problemes: "Problèmes adressés",
  fonctionnalites: "Fonctionnalités",
  benefices: "Bénéfices",
  limites: "Limites",
  tarifs: "Tarifs",
  faq: "FAQ",
  objections: "Objections",
  liens: "Liens",
  signature: "Signature",
};

export const KNOWLEDGE_STATUSES = ["brouillon", "valide", "desactive"] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  brouillon: "Brouillon",
  valide: "Validé",
  desactive: "Désactivé",
};

export const KNOWLEDGE_STATUS_TONES: Record<KnowledgeStatus, StatusBadgeTone> = {
  brouillon: "amber",
  valide: "emerald",
  desactive: "slate",
};

export interface CommercialKnowledgeEntry {
  id: string;
  section: KnowledgeSection;
  title: string;
  content: string;
  status: KnowledgeStatus;
  position: number;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeFormValues {
  section: KnowledgeSection;
  title: string;
  content: string;
  status: KnowledgeStatus;
}

// ── Emails IA (table préparée en 5A, exploitée en 5B/6) ──────────────────────
export const EMAIL_KINDS = [
  "premier_contact",
  "relance_1",
  "relance_2",
  "reponse_question",
  "proposition_demo",
  "proposition_essai",
  "suivi_demo",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_KIND_LABELS: Record<EmailKind, string> = {
  premier_contact: "Premier contact",
  relance_1: "Relance 1",
  relance_2: "Relance 2",
  reponse_question: "Réponse à une question",
  proposition_demo: "Proposition de démonstration",
  proposition_essai: "Proposition d'essai",
  suivi_demo: "Suivi de démonstration",
};

export const EMAIL_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "sent",
  "failed",
  "rejected",
  "cancelled",
] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  draft: "Brouillon",
  pending_review: "À valider",
  approved: "Approuvé",
  sent: "Envoyé",
  failed: "Échec",
  rejected: "Rejeté",
  cancelled: "Annulé",
};

export const EMAIL_STATUS_TONES: Record<EmailStatus, StatusBadgeTone> = {
  draft: "slate",
  pending_review: "amber",
  approved: "emerald",
  sent: "sky",
  failed: "rose",
  rejected: "rose",
  cancelled: "slate",
};

export interface CommercialEmail {
  id: string;
  prospect_id: string;
  kind: EmailKind;
  subject: string | null;
  body: string | null;
  internal_rationale: string | null;
  recommended_status: string | null;
  recommended_next_action: string | null;
  status: EmailStatus;
  ai_model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  generated_by: string | null;
  reviewed_by: string | null;
  sent_at: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
