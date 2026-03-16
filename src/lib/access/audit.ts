import { supabase } from "@/lib/supabase";
import type { AccessAuditEvent, AccessContext, AccessEventType, FeatureKey } from "./access.types";

// ─── Configuration audit ──────────────────────────────────────────────────────

/**
 * Contrôle la verbosité du log en développement.
 * En production, tous les événements sont persistés silencieusement.
 */
const AUDIT_CONSOLE_EVENTS: Set<AccessEventType> = new Set([
  "admin_bypass",
  "feature_access_denied",
  "quota_exceeded",
]);

// ─── Paramètres d'appel ───────────────────────────────────────────────────────

type LogAccessEventParams = {
  ctx: AccessContext;
  feature: FeatureKey;
  eventType: AccessEventType;
  tokensConsumed?: number;
  quotaConsumed?: number;
  metadata?: Record<string, unknown>;
};

// ─── Fonction principale ──────────────────────────────────────────────────────

/**
 * Enregistre un événement d'accès dans `access_audit_log`.
 *
 * - Non-bloquant : ne throw jamais, les erreurs d'écriture sont avalées.
 * - Admin : les événements admin_bypass sont loggés avec bypassActive=true.
 * - Dev : les événements importants sont affichés dans la console.
 *
 * Schéma Supabase attendu pour `access_audit_log` :
 * ```sql
 * create table access_audit_log (
 *   id uuid primary key default gen_random_uuid(),
 *   user_id text,
 *   email text,
 *   feature text not null,
 *   event_type text not null,
 *   plan text,
 *   is_admin boolean default false,
 *   bypass_active boolean default false,
 *   tokens_consumed integer default 0,
 *   quota_consumed integer default 0,
 *   block_reason text,
 *   metadata jsonb,
 *   created_at timestamptz default now()
 * );
 * ```
 */
export async function logAccessEvent(params: LogAccessEventParams): Promise<void> {
  const {
    ctx,
    feature,
    eventType,
    tokensConsumed = 0,
    quotaConsumed = 0,
    metadata = {},
  } = params;

  const event: AccessAuditEvent = {
    userId: ctx.userId,
    email: ctx.email,
    feature,
    eventType,
    plan: ctx.plan,
    isAdmin: ctx.isAdmin,
    bypassActive: ctx.bypassLimits || ctx.isAdmin,
    tokensConsumed,
    quotaConsumed,
    blockReason: null,
    metadata,
    timestamp: new Date().toISOString(),
  };

  // Console log pour les événements importants en dev
  if (import.meta.env.DEV && AUDIT_CONSOLE_EVENTS.has(eventType)) {
    console.log(`[audit] ${eventType}`, {
      feature,
      userId: ctx.userId,
      isAdmin: ctx.isAdmin,
      plan: ctx.plan,
      ...metadata,
    });
  }

  // Persistance Supabase — fire and forget
  try {
    await supabase.from("access_audit_log").insert({
      user_id: event.userId,
      email: event.email,
      feature: event.feature,
      event_type: event.eventType,
      plan: event.plan,
      is_admin: event.isAdmin,
      bypass_active: event.bypassActive,
      tokens_consumed: event.tokensConsumed,
      quota_consumed: event.quotaConsumed,
      block_reason: event.blockReason,
      metadata: event.metadata,
      created_at: event.timestamp,
    });
  } catch {
    // Silencieux — l'audit ne doit jamais bloquer un flux métier
  }
}

// ─── Helper : log d'accès accordé / refusé ────────────────────────────────────

export async function logFeatureAccess(
  ctx: AccessContext,
  feature: FeatureKey,
  granted: boolean,
  extra?: Record<string, unknown>
): Promise<void> {
  await logAccessEvent({
    ctx,
    feature,
    eventType: granted ? "feature_access_granted" : "feature_access_denied",
    metadata: extra,
  });
}

// ─── SQL de création de la table (documentation) ─────────────────────────────
//
// À exécuter dans la console Supabase pour activer l'audit complet :
//
// create table if not exists public.access_audit_log (
//   id uuid primary key default gen_random_uuid(),
//   user_id text,
//   email text,
//   feature text not null,
//   event_type text not null,
//   plan text,
//   is_admin boolean not null default false,
//   bypass_active boolean not null default false,
//   tokens_consumed integer not null default 0,
//   quota_consumed integer not null default 0,
//   block_reason text,
//   metadata jsonb,
//   created_at timestamptz not null default now()
// );
//
// create index if not exists idx_audit_user_id on access_audit_log (user_id);
// create index if not exists idx_audit_feature on access_audit_log (feature);
// create index if not exists idx_audit_event_type on access_audit_log (event_type);
// create index if not exists idx_audit_created_at on access_audit_log (created_at desc);
//
// -- RLS : visibilité admin uniquement
// alter table access_audit_log enable row level security;
// create policy "Admin only" on access_audit_log
//   for select using (auth.jwt() ->> 'role' = 'admin');