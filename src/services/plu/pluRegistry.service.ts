// =============================================================
// Mimmoza · PLU Engine — Service registry / résolution de contexte
// Léger : ne fait AUCUN appel réel au GPU pour l'instant.
// Prêt à être branché sur le GPU Connector ultérieurement.
//
// Toutes les fonctions acceptent un client Supabase injectable
// (2e paramètre) : le client front par défaut côté UI,
// un client service_role côté Edge Function pour les écritures.
// =============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

// ⚠️ Ajuste UNIQUEMENT cette ligne si le chemin de ton client Supabase diffère.
import { supabase } from '@/lib/supabase';

import { PLU_TABLES } from './pluEngine.tables';
import type {
  PluRegistryRecord,
  PluRulesetRecord,
  PluUpdateCheckRecord,
  ResolvePluContextInput,
  ResolvePluContextResult,
} from './pluEngine.types';

type Db = SupabaseClient;

/** Entrée pour la journalisation d'un contrôle de mise à jour PLU. */
export interface CreatePluUpdateCheckInput {
  codeInsee: string;
  previousVersionKey?: string | null;
  detectedVersionKey?: string | null;
  hasChanged?: boolean;
  actionTaken?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

// -------------------------------------------------------------
// Log minimal (pas de payload sensible — cohérent audit sécu)
// -------------------------------------------------------------
function logPluError(context: string, error: unknown): void {
  const code = (error as { code?: string } | null)?.code ?? 'unknown';
  console.error(`[pluEngine] ${context} failed (code=${code})`);
}

// -------------------------------------------------------------
// Lectures
// -------------------------------------------------------------

/**
 * Renvoie le registry PLU courant pour une commune (le plus récent),
 * tous statuts confondus. La résolution du statut métier est faite
 * par resolvePluContext.
 */
export async function getActivePluRegistryByInsee(
  codeInsee: string,
  client: Db = supabase,
): Promise<PluRegistryRecord | null> {
  const { data, error } = await client
    .from(PLU_TABLES.registry)
    .select('*')
    .eq('code_insee', codeInsee)
    .order('approved_at', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logPluError('getActivePluRegistryByInsee', error);
    return null;
  }
  return (data as PluRegistryRecord) ?? null;
}

/**
 * Renvoie le ruleset actif pour une commune :
 *  1) celui pointé par registry.active_ruleset_id si présent,
 *  2) sinon le dernier ruleset 'parsed' rattaché au registry.
 */
export async function getActiveRulesetByInsee(
  codeInsee: string,
  client: Db = supabase,
): Promise<PluRulesetRecord | null> {
  const registry = await getActivePluRegistryByInsee(codeInsee, client);
  if (!registry) return null;

  // 1) Ruleset explicitement actif
  if (registry.active_ruleset_id) {
    const { data, error } = await client
      .from(PLU_TABLES.rulesets)
      .select('*')
      .eq('id', registry.active_ruleset_id)
      .maybeSingle();

    if (error) {
      logPluError('getActiveRulesetByInsee:active', error);
      return null;
    }
    if (data) return data as PluRulesetRecord;
  }

  // 2) Fallback : dernier ruleset 'parsed' du registry
  const { data, error } = await client
    .from(PLU_TABLES.rulesets)
    .select('*')
    .eq('registry_id', registry.id)
    .eq('status', 'parsed')
    .order('parsed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logPluError('getActiveRulesetByInsee:fallback', error);
    return null;
  }
  return (data as PluRulesetRecord) ?? null;
}

// -------------------------------------------------------------
// Écriture (service_role requis par la RLS)
// -------------------------------------------------------------

/**
 * Journalise un contrôle de mise à jour PLU.
 * ⚠️ L'INSERT nécessite le service_role (à appeler depuis une Edge Function,
 * ou en passant un client service_role en 2e paramètre).
 */
export async function createPluUpdateCheck(
  input: CreatePluUpdateCheckInput,
  client: Db = supabase,
): Promise<PluUpdateCheckRecord | null> {
  const payload = {
    code_insee: input.codeInsee,
    previous_version_key: input.previousVersionKey ?? null,
    detected_version_key: input.detectedVersionKey ?? null,
    has_changed: input.hasChanged ?? false,
    action_taken: input.actionTaken ?? null,
    error_message: input.errorMessage ?? null,
    metadata: input.metadata ?? {},
  };

  const { data, error } = await client
    .from(PLU_TABLES.updateChecks)
    .insert(payload)
    .select('*')
    .maybeSingle();

  if (error) {
    logPluError('createPluUpdateCheck', error);
    return null;
  }
  return (data as PluUpdateCheckRecord) ?? null;
}

// -------------------------------------------------------------
// Résolution de contexte PLU
// -------------------------------------------------------------

/**
 * Résout le contexte PLU pour une commune (et éventuellement une parcelle).
 * La résolution fine par parcelle (zone, contraintes, feasibility) sera
 * branchée plus tard via le GPU Connector / parcel resolver.
 *
 * Si aucun registry actif : PLU_PENDING / low / NO_ACTIVE_PLU_REGISTRY.
 */
export async function resolvePluContext(
  input: ResolvePluContextInput,
  client: Db = supabase,
): Promise<ResolvePluContextResult> {
  const { codeInsee } = input;

  const base: ResolvePluContextResult = {
    codeInsee,
    pluStatus: 'PLU_PENDING',
    constraints: {},
    feasibility: {},
    confidence: 'low',
  };

  try {
    const registry = await getActivePluRegistryByInsee(codeInsee, client);

    if (!registry) {
      return { ...base, reason: 'NO_ACTIVE_PLU_REGISTRY' };
    }

    const communeName = registry.commune_name ?? undefined;

    if (registry.status === 'failed') {
      return {
        ...base,
        communeName,
        registryId: registry.id,
        pluStatus: 'PLU_FAILED',
        reason: 'PLU_PARSE_FAILED',
      };
    }

    if (registry.status === 'outdated' || registry.freshness_status === 'outdated') {
      return {
        ...base,
        communeName,
        registryId: registry.id,
        pluStatus: 'PLU_OUTDATED',
        reason: 'PLU_OUTDATED_VERSION',
      };
    }

    const ruleset = await getActiveRulesetByInsee(codeInsee, client);

    if (!ruleset) {
      return {
        ...base,
        communeName,
        registryId: registry.id,
        pluStatus: 'PLU_PENDING',
        reason: 'RULESET_NOT_READY',
      };
    }

    return {
      ...base,
      communeName,
      registryId: registry.id,
      rulesetId: ruleset.id,
      pluStatus: 'PLU_READY',
      zoneLabel: undefined, // résolution parcelle à venir (GPU Connector)
      constraints: {},
      feasibility: {},
      confidence: 'medium',
    };
  } catch (error) {
    logPluError('resolvePluContext', error);
    return { ...base, pluStatus: 'PLU_FAILED', reason: 'RESOLVE_ERROR' };
  }
}

// -------------------------------------------------------------
// Clé de cache opportunité
// -------------------------------------------------------------

/**
 * Construit une clé de cache déterministe et stable pour
 * opportunity_plu_cache.cache_key.
 * Format : plu_v1:<insee>:<parcelId|->:<address-normalisee|->
 */
export function buildOpportunityPluCacheKey(input: ResolvePluContextInput): string {
  const insee = (input.codeInsee ?? '').trim().toLowerCase() || '-';
  const parcel = (input.parcelId ?? '').trim().toLowerCase() || '-';
  const address = normalizeForKey(input.address);
  return `plu_v1:${insee}:${parcel}:${address}`;
}

function normalizeForKey(value?: string | null): string {
  if (!value) return '-';
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || '-';
}