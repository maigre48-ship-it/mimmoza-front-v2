// ============================================================================
// MimmozIA — journalisation des gestes utilisateur (Phase 1)
//
// Objectif : nourrir la mémoire des habitudes (table user_events) pour que
// MimmozIA apprenne, sans jamais gêner l'UX.
//
// Règles (non négociables) :
//   · fire-and-forget : ne bloque jamais l'interface, ne lève jamais d'erreur ;
//   · respecte l'opt-out : no-op si l'apprentissage est désactivé ;
//   · user_id rempli côté DB (default auth.uid()) → rien à passer ici.
//
// ⚠️ SEULE HYPOTHÈSE de ce fichier : le client Supabase navigateur importé
//    ci-dessous. Adapte le chemin à ton arborescence (ton singleton `supabase`).
// ============================================================================

import { supabase } from '@/lib/supabaseClient'; // ← À ADAPTER

export type MimmoziaEventType =
  | 'session_start'
  | 'search'
  | 'module_open'
  | 'tool_call'
  | 'city_view'
  | 'property_view'
  | 'filter_apply'
  | 'budget_set'
  | 'surface_set'
  | 'favorite_add'
  | 'favorite_remove'
  | 'study_create'
  | 'study_open'
  | 'report_open'
  | 'report_download';

/**
 * Charge utile libre. Les clés ci-dessous sont celles que v_user_profile sait
 * exploiter ; tu peux en ajouter d'autres (elles seront stockées mais ignorées
 * du profil tant que la vue ne les lit pas).
 */
export interface MimmoziaEventPayload {
  city?: string;
  insee?: string; // code commune — sert aussi à dériver le département (2 premiers car.)
  module?: string; // 'promoteur' | 'investisseur' | 'particulier' | 'rehabilitation' | 'apporteur' | 'banque'
  property_type?: string; // 'terrain' | 'appartement' | 'maison' | ...
  strategy?: string; // 'promotion' | 'marchand' | 'rendement' | 'cashflow' | 'lmnp' | 'locatif' | 'estimation'
  budget?: number;
  surface?: number;
  tool?: string; // nom de l'outil copilot appelé (get_taxes_locales, get_loyers_reference, …)
  [k: string]: unknown;
}

// ── état de session (léger, en mémoire) ─────────────────────────────────────
let learningEnabled: boolean | null = null; // cache opt-out (évite un aller-retour réseau par événement)
let sessionId: string | null = null;

function getSessionId(): string {
  if (!sessionId) {
    sessionId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
  return sessionId;
}

async function isLearningEnabled(): Promise<boolean> {
  if (learningEnabled !== null) return learningEnabled;
  try {
    const { data } = await supabase
      .from('user_ai_preferences')
      .select('learning_enabled')
      .maybeSingle(); // RLS → au plus une ligne (la sienne)
    learningEnabled = data?.learning_enabled ?? true; // pas de ligne = jamais désactivé
  } catch {
    learningEnabled = true; // en cas de doute, on n'empêche pas l'apprentissage
  }
  return learningEnabled;
}

/**
 * Journalise un geste utilisateur. Ne lève jamais, ne bloque jamais.
 * No-op silencieux si l'apprentissage est désactivé ou si l'utilisateur
 * n'est pas connecté.
 *
 *   track('city_view', { city: 'Bordeaux', insee: '33063' });
 *   track('tool_call', { tool: 'get_taxes_locales', insee: '33063' });
 *   track('module_open', { module: 'promoteur' });
 */
export async function track(
  type: MimmoziaEventType,
  payload: MimmoziaEventPayload = {},
): Promise<void> {
  try {
    if (!(await isLearningEnabled())) return;
    await supabase.from('user_events').insert({
      event_type: type,
      payload,
      session_id: getSessionId(),
    });
  } catch {
    // silencieux par conception : l'analytics ne doit jamais dégrader l'UX.
  }
}

/** Version synchrone "tire et oublie" — pratique dans un onClick sans await. */
export function trackFire(type: MimmoziaEventType, payload: MimmoziaEventPayload = {}): void {
  void track(type, payload);
}

// ── Réglages ────────────────────────────────────────────────────────────────

/** Active / désactive l'apprentissage (toggle du menu Paramètres). */
export async function setLearningEnabled(enabled: boolean): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return;
  await supabase.from('user_ai_preferences').upsert({
    user_id: uid,
    learning_enabled: enabled,
    updated_at: new Date().toISOString(),
  });
  learningEnabled = enabled; // met à jour le cache immédiatement
}

/** Lit l'état courant de l'opt-out (pour afficher le toggle). */
export async function getLearningEnabled(): Promise<boolean> {
  learningEnabled = null; // force une relecture fraîche pour l'écran Réglages
  return isLearningEnabled();
}

/** "Effacer ce que MimmozIA a appris" — supprime définitivement mes événements. */
export async function purgeMyAiMemory(): Promise<void> {
  await supabase.rpc('purge_my_ai_memory');
}