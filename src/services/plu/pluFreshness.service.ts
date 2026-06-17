// =============================================================
// Mimmoza · PLU Engine — Service fraîcheur
// Règles simples (sans appel GPU) :
//   - last_checked_at null            -> contrôle requis
//   - dernier contrôle > 30 jours     -> contrôle requis
//   - sinon                           -> frais
// =============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

// ⚠️ Ajuste UNIQUEMENT cette ligne si le chemin de ton client Supabase diffère.
import { supabase } from '@/lib/supabase';

import { PLU_TABLES } from './pluEngine.tables';
import type { PluFreshnessStatus, PluRegistryRecord } from './pluEngine.types';

type Db = SupabaseClient;

/** Âge max (jours) avant de re-déclencher un contrôle de fraîcheur. */
export const PLU_FRESHNESS_MAX_AGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Indique s'il faut (re)contrôler la fraîcheur d'un registry.
 * true => needs_check (jamais vérifié, date illisible, ou > 30 jours).
 */
export function shouldCheckPluFreshness(registry: PluRegistryRecord): boolean {
  if (!registry.last_checked_at) return true;

  const last = new Date(registry.last_checked_at).getTime();
  if (Number.isNaN(last)) return true;

  const ageDays = (Date.now() - last) / DAY_MS;
  return ageDays > PLU_FRESHNESS_MAX_AGE_DAYS;
}

/**
 * Marque un registry comme obsolète.
 * `detectedVersionKey` est informatif (la nouvelle version donnera lieu à une
 * nouvelle ligne registry plus tard) : on n'écrase pas version_key ici pour ne
 * pas violer la contrainte unique(code_insee, version_key).
 * ⚠️ UPDATE => service_role requis (RLS).
 */
export async function markPluAsOutdated(
  registryId: string,
  detectedVersionKey?: string | null,
  client: Db = supabase,
): Promise<PluRegistryRecord | null> {
  void detectedVersionKey; // à journaliser via createPluUpdateCheck si besoin

  const { data, error } = await client
    .from(PLU_TABLES.registry)
    .update({
      status: 'outdated',
      freshness_status: 'outdated',
      last_checked_at: new Date().toISOString(),
      // updated_at géré par trigger DB
    })
    .eq('id', registryId)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[pluFreshness] markPluAsOutdated failed');
    return null;
  }
  return (data as PluRegistryRecord) ?? null;
}

/**
 * Marque un registry comme à jour (fraîcheur OK, dernier contrôle = maintenant).
 * ⚠️ UPDATE => service_role requis (RLS).
 */
export async function markPluAsFresh(
  registryId: string,
  client: Db = supabase,
): Promise<PluRegistryRecord | null> {
  const { data, error } = await client
    .from(PLU_TABLES.registry)
    .update({
      freshness_status: 'fresh',
      last_checked_at: new Date().toISOString(),
    })
    .eq('id', registryId)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[pluFreshness] markPluAsFresh failed');
    return null;
  }
  return (data as PluRegistryRecord) ?? null;
}

/** Libellé FR lisible pour un statut de fraîcheur. */
export function getFreshnessStatusLabel(status: PluFreshnessStatus): string {
  switch (status) {
    case 'fresh':
      return 'À jour';
    case 'stale':
      return 'À vérifier';
    case 'outdated':
      return 'Obsolète';
    case 'needs_check':
      return 'Vérification requise';
    case 'unknown':
    default:
      return 'Inconnu';
  }
}