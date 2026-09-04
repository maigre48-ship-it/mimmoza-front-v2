// supabase/functions/copilot-chat/index.ts
// =============================================================
// Mimmoza Copilot — Orchestrateur principal + streaming SSE
// LOT 4 : SmartScore + DVF branchés sur smartscore-enriched-v3.
// LOT 4.1 : DVF basculé sur la fonction dédiée dvf-comparables-v1 (COPILOT_FN_DVF).
//           Contrat dédié { status, summary, stats, comps } ; repli mutualisé
//           sur smartscore-enriched-v3 (bloc market_like.dvf) conservé.
// PLU    : couche d'explication/synthèse lisant le contexte parser (ctx.plu).
// RISQUES : Géorisques branché sur risk-study via COPILOT_FN_RISKS.
//           ⚠️ Convention de score risk-study : 100 = zone sûre, 0 = risque max.
// LOT 5  : get_quick_market_insight — lecture directe de v_quick_questions_mvp
//           pour les questions rapides investisseur/marchand sur une annonce.
// LOT 6  : predictive_snapshot — bloc de données prédictives (17 sources) injecté
//           dans le system prompt, transmis par le front. Utilisé EN PRIORITÉ par
//           le LLM ; les tools ne sont appelés que pour les données absentes.
// LOT 8  : pageSnapshot — donnees visibles a l'ecran de la page courante (ex :
//           valorisation rehabilitation) injectees telles quelles dans le prompt.
//
// Secrets utilisés (existants) :
//   ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ANTHROPIC_MAX_TOKENS,
//   ANTHROPIC_TIMEOUT_MS, SUPABASE_URL, (publishable + service role)
// Optionnels (overrides modèle) :
//   COPILOT_MODEL_QUICK, COPILOT_MODEL_ADVANCED, COPILOT_MODEL_REPORT
// Optionnels (branchement tools métier) :
//   COPILOT_FN_PARCEL, COPILOT_FN_PLU, COPILOT_FN_DVF,
//   COPILOT_FN_RISKS, COPILOT_FN_SMARTSCORE, COPILOT_FN_TIMEOUT_MS
//   → DVF dédié : COPILOT_FN_DVF = dvf-comparables-v1
// =============================================================

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { selectToolNames } from '../_shared/copilot-routing/selector.ts';
import { isKnownRoute, routeCatalogue, routeLabel, suggestRoutes } from '../_shared/copilot-routing/routes.ts';
import { createContextSnapshot, mergeContexts, type ContextSnapshot } from '../_shared/copilot-context/snapshot.ts';
import { geographicGroundingPolicy } from '../_shared/copilot-grounding/geographic.ts';
import { unsupportedInferencePolicy } from '../_shared/copilot-grounding/inferences.ts';
import { renderParcelStudyReport } from '../_shared/copilot-reporting/parcel-study.ts';
// Moteur prédictif — MÊME code que la page Analyse prédictive du front, qui le
// réexporte depuis ici. Deux copies auraient produit deux projections
// différentes pour le même bien selon qu'on la demande à l'écran ou au chat.
import { computePredictiveSnapshot } from '../_shared/predictive/engine.ts';
import type { PredictiveEngineInput } from '../_shared/predictive/types.ts';
import { fetchEcbRatesAnalysis } from '../_shared/predictive/ecb.ts';
import {
  calculerDenormandie,
  calculerJeanbrunAncien,
  calculerJeanbrunNeuf,
  calculerLocAvantages,
  FICHES_DISPOSITIFS,
  listerDispositifsClos,
  trouverDispositifClos,
} from '../_shared/dispositifs/engine.ts';
import { MILLESIME_BAREMES } from '../_shared/dispositifs/baremes.ts';
import type { DispositifCode, NiveauLoyer } from '../_shared/dispositifs/types.ts';

// =============================================================
// SECTION 1 — Configuration
// =============================================================

type CopilotMode = 'quick' | 'advanced' | 'report';

const CREDIT_COST: Record<CopilotMode, number> = {
  quick: 5,
  advanced: 15,
  report: 30,
};

// Modes ouverts en V1 (report arrive en V2)
const V1_MODES: CopilotMode[] = ['quick', 'advanced'];

// Modèle de base (ton secret existant) — fallback pour tous les modes.
const BASE_MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6';

// Modèles par mode : override optionnel par mode, sinon BASE_MODEL.
const MODEL_BY_MODE: Record<CopilotMode, string> = {
  quick: Deno.env.get('COPILOT_MODEL_QUICK') ?? BASE_MODEL,
  advanced: Deno.env.get('COPILOT_MODEL_ADVANCED') ?? BASE_MODEL,
  report: Deno.env.get('COPILOT_MODEL_REPORT') ?? BASE_MODEL,
};

// Plafond global défini dans tes secrets (garde-fou absolu).
//
// ⚠️ Le repli valait 8 000, soit la MOITIÉ des 16 000 que MAX_OUTPUT_TOKENS
// vise juste en dessous — et comme il est appliqué via Math.min, il écrasait
// silencieusement les trois modes tant que le secret ANTHROPIC_MAX_TOKENS
// n'était pas posé. Les rapports d'étude étaient donc coupés en deux sans
// qu'aucun message ne l'indique. Le repli est aligné sur la cible ; le secret
// reste prioritaire pour le cas où il faudrait redescendre.
const GLOBAL_MAX_TOKENS = Number(Deno.env.get('ANTHROPIC_MAX_TOKENS')) || 16000;

// Budget de sortie par mode — PLAFOND de génération, pas une cible.
// Généreux volontairement : à 2500 le rapport d'étude (get_etude_parcelle) était
// coupé AVANT le verdict et les points de vigilance, soit sa partie la plus utile.
// Aucun impact économique : le débit est calculé sur l'usage effectif (debitJetons).
// ⚠️ Borné par GLOBAL_MAX_TOKENS → monter aussi le secret ANTHROPIC_MAX_TOKENS,
//    sinon ces valeurs sont écrasées par l'ancien plafond.
// ⚠️ 32000 en report était intenable : une Edge Function n'a pas le temps de
// streamer autant avant d'être coupée (« network error » côté client, et ni
// settle ni refund ne s'exécutent → réservation orpheline). 16000 reste très
// large pour un rapport complet.
const MAX_OUTPUT_TOKENS: Record<CopilotMode, number> = {
  quick: Math.min(16000, GLOBAL_MAX_TOKENS),
  advanced: Math.min(16000, GLOBAL_MAX_TOKENS),
  report: Math.min(16000, GLOBAL_MAX_TOKENS),
};

// Gate de réservation : une ATTENTE réaliste de sortie, PAS le plafond absolu.
// Sans cette séparation, relever MAX_OUTPUT_TOKENS gonfle mécaniquement la
// réservation (worstCaseJetons) : chaque message immobiliserait dix fois ce
// qu'il coûte réellement, et l'utilisateur serait bloqué en INSUFFICIENT_CREDITS
// bien avant d'avoir consommé son solde. Le débit final reste l'usage réel.
const GATE_OUTPUT_TOKENS: Record<CopilotMode, number> = {
  quick: 3000, advanced: 4000, report: 8000,
};

// Timeout par appel LLM (ton secret existant), fallback 60s.
const LLM_TIMEOUT_MS = Number(Deno.env.get('ANTHROPIC_TIMEOUT_MS')) || 60000;

// Nombre max d'allers-retours tool-calling par mode (garde-fou latence + coût).
// ⚠️ Chaque itération = 1 appel LLM + N appels d'outils (jusqu'à ~20 s pour les
// plus lents) : 12 itérations dépassent la durée d'exécution disponible.
const MAX_TOOL_ITERATIONS: Record<CopilotMode, number> = {
  quick: 5,
  advanced: 6,
  report: 8,
};

// Historique conversation injecté (nb de messages max)
const MAX_HISTORY_MESSAGES: Record<CopilotMode, number> = {
  quick: 6,
  advanced: 12,
  report: 20,
};

// ─── Edge Functions internes (tools LOT 4) ───────────────────
// Un tool n'est "branché" que si son secret de nom de fonction est défini.
// Sinon il renvoie proprement { status: 'not_configured' }.
//   ex: COPILOT_FN_SMARTSCORE = smartscore-enriched-v3
//   ex: COPILOT_FN_DVF        = dvf-comparables-v1   (fonction DVF dédiée)
//   ex: COPILOT_FN_RISKS      = risk-study           (nom de ta fonction risques)
const INTERNAL_FUNCTIONS = {
  parcel: Deno.env.get('COPILOT_FN_PARCEL') ?? null,
  plu: Deno.env.get('COPILOT_FN_PLU') ?? null,
  dvf: Deno.env.get('COPILOT_FN_DVF') ?? null,            // dédié ; sinon mutualisé sur smartscore
  risks: Deno.env.get('COPILOT_FN_RISKS') ?? null,
  smartscore: Deno.env.get('COPILOT_FN_SMARTSCORE') ?? null,
  dpe: Deno.env.get('COPILOT_FN_DPE') ?? null,           // dpe-ademe-v1
  merimee: Deno.env.get('COPILOT_FN_MERIMEE') ?? null,   // patrimoine-merimee-v1
  bdnb: Deno.env.get('COPILOT_FN_BDNB') ?? null,         // batiment-bdnb-v1
  loyers: Deno.env.get('COPILOT_FN_LOYERS') ?? null,     // loyers-reference-v1
  servitudes: Deno.env.get('COPILOT_FN_SERVITUDES') ?? null, // servitudes-gpu-v1
  solaire: Deno.env.get('COPILOT_FN_SOLAIRE') ?? null,       // potentiel-solaire-v1
  zonage: Deno.env.get('COPILOT_FN_ZONAGE') ?? null,         // zonage-abc-v1
  taxes: Deno.env.get('COPILOT_FN_TAXES') ?? null,           // taxes-locales-v1
  ppr: Deno.env.get('COPILOT_FN_PPR') ?? null,               // ppr-detail-v1
 assainissement: Deno.env.get('COPILOT_FN_ASSAINISSEMENT') ?? null, // assainissement-commune-v1
  altimetrie: Deno.env.get('COPILOT_FN_ALTIMETRIE') ?? null,       // altimetrie-v1
  bruit: Deno.env.get('COPILOT_FN_BRUIT') ?? null,                // bruit-classement-v1
  etude: Deno.env.get('COPILOT_FN_ETUDE') ?? null,                // etude-parcelle-v1
  market: Deno.env.get('COPILOT_FN_MARKET') ?? null,              // market-study-investisseur-v1
  couts: Deno.env.get('COPILOT_FN_COUTS') ?? null,                // couts-construction-v1
  couts_renovation: Deno.env.get('COPILOT_FN_COUTS_RENOVATION') ?? null, // couts-renovation-v1
  sitadel: Deno.env.get('COPILOT_FN_SITADEL') ?? null,            // promoteur-permis-construire (permis géolocalisés récents)
  sirene: Deno.env.get('COPILOT_FN_SIRENE') ?? null,              // etablissements-sirene-v1 (établissements proches, API DINUM)
  bpe: Deno.env.get('COPILOT_FN_BPE') ?? null,                    // bpe-proxy (équipements et services, BPE INSEE via ODS)
  sru: Deno.env.get('COPILOT_FN_SRU') ?? null,                    // besoin-logements-sociaux (SRU / LLS)
  contexte: Deno.env.get('COPILOT_FN_CONTEXTE') ?? null,          // contexte-commune-v1 (contexte éditorial Wikidata/Wikipédia)
  gpu: Deno.env.get('COPILOT_FN_GPU') ?? null,                    // gpu-parcelle-v1 (zonage PLU + prescriptions, API Carto GPU)
  appels_offres: Deno.env.get('COPILOT_FN_APPELS_OFFRES') ?? null, // appels-offres-v1 (avis BOAMP ouverts)
  contacts: Deno.env.get('COPILOT_FN_CONTACTS') ?? null,          // recherche-contacts-mairies-v1 (mairies + maires par rayon)
  metrics_zone: Deno.env.get('COPILOT_FN_METRICS_ZONE') ?? null,  // market-metrics-zone-v1 (état du marché d'une zone surveillée)
} as const;

// Timeout dédié aux appels de fonctions internes (séparé du LLM).
// smartscore-enriched-v3 et risk-study font plusieurs appels externes → 25s.
const INTERNAL_FN_TIMEOUT_MS = Number(Deno.env.get('COPILOT_FN_TIMEOUT_MS')) || 25000;

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// uuid canonique — pour tout champ mappé sur une colonne Postgres type uuid.
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Constantes économiques (les SEULS nombres à ajuster) ────
const JETON_VALUE_EUR = 0.10;
const MARGIN = 3;
const USD_TO_EUR = 0.95;
const ASSUMED_MAX_INPUT_TOKENS = 60_000;

const TIER_RATES = {
  haiku:  { in: 1, out: 5  },
  sonnet: { in: 3, out: 15 },
  opus:   { in: 5, out: 25 },
} as const;

type ModelTier = keyof typeof TIER_RATES;

const TIER_MODEL_ID: Record<ModelTier, string> = {
  haiku:  Deno.env.get('COPILOT_MODEL_HAIKU')  ?? 'claude-haiku-4-5',
  sonnet: Deno.env.get('COPILOT_MODEL_SONNET') ?? (Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6'),
  opus:   Deno.env.get('COPILOT_MODEL_OPUS')   ?? 'claude-opus-4-8',
};

type Plan = 'basic' | 'advanced' | 'pro';

const PLAN_POLICY: Record<Plan, {
  tiers: ModelTier[];
  defaultTier: ModelTier;
  mode: CopilotMode;
  unlockAllTabs: boolean;
}> = {
  basic:    { tiers: ['haiku'],          defaultTier: 'haiku',  mode: 'quick',    unlockAllTabs: false },
  advanced: { tiers: ['sonnet'],         defaultTier: 'sonnet', mode: 'advanced', unlockAllTabs: false },
  pro:      { tiers: ['sonnet', 'opus'], defaultTier: 'sonnet', mode: 'report',   unlockAllTabs: true  },
};

// Vocabulaire des abonnements Mimmoza (PlanId front : basique | avance | pro |
// proplus) + valeurs héritées côté base. Tout ce qui n'est pas reconnu vaut
// 'basic' : un plan inconnu ne doit jamais ouvrir de droits par accident.
function normalizePlan(stored: string | null | undefined): Plan {
  switch ((stored ?? '').toLowerCase().trim()) {
    case 'proplus':
    case 'pro':      return 'pro';
    case 'avance':
    case 'advanced':
    case 'starter':  return 'advanced';
    default:         return 'basic';   // basique, free, freemium, null…
  }
}

// ⚠️ SOURCE DU PLAN — vérifié en base :
//   · 'profiles' n'existe pas ;
//   · users_profiles.plan est un vestige (une seule ligne, valeur 'freemium') ;
//   · billing_profiles (alimentée par stripe-webhook) porte plan_code +
//     subscription_status : c'est la seule source exploitable côté serveur.
// Le front, lui, lit encore localStorage via usePlanAccess : tant que ce TODO
// n'est pas levé, un utilisateur peut voir 'pro' à l'écran et être 'basic' ici.
// Un abonnement résilié ou impayé ne donne aucun droit, même avec plan_code 'pro'.
async function getUserPlan(userId: string): Promise<Plan> {
  try {
    const { data, error } = await getAdmin()
      .from('billing_profiles')
      .select('plan_code, subscription_status')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) console.error('[copilot] lecture du plan échouée', error.message);
    const actif = ['active', 'trialing'].includes(String(data?.subscription_status ?? ''));
    if (data && !actif) {
      console.warn('[copilot] abonnement non actif :', data.subscription_status);
    }
    return actif ? normalizePlan(data?.plan_code as string | undefined) : 'basic';
  } catch (e) {
    console.error('[copilot] getUserPlan exception', e);
    return 'basic';
  }
}

function resolveTier(plan: Plan, requested?: ModelTier): ModelTier {
  const policy = PLAN_POLICY[plan];
  if (requested && policy.tiers.includes(requested)) return requested;
  return policy.defaultTier;
}

function apiCostEur(tier: ModelTier, inputTokens: number, outputTokens: number): number {
  const r = TIER_RATES[tier];
  const usd = (inputTokens * r.in + outputTokens * r.out) / 1_000_000;
  return usd * USD_TO_EUR;
}

function debitJetons(tier: ModelTier, inputTokens: number, outputTokens: number): number {
  const cost = apiCostEur(tier, inputTokens, outputTokens);
  return Math.max(1, Math.ceil((cost * MARGIN) / JETON_VALUE_EUR));
}

function worstCaseJetons(tier: ModelTier, mode: CopilotMode): number {
  return debitJetons(tier, ASSUMED_MAX_INPUT_TOKENS, GATE_OUTPUT_TOKENS[mode]);
}

// =============================================================
// SECTION 2 — Erreurs typées
// =============================================================

type CopilotErrorCode =
  | 'INSUFFICIENT_CREDITS' | 'INVALID_MODE' | 'INVALID_AMOUNT'
  | 'CONTEXT_REQUIRED' | 'CONTEXT_TOO_LARGE' | 'TOOL_ERROR'
  | 'LLM_ERROR' | 'RATE_LIMITED' | 'INTERNAL_ERROR'
  | 'RESERVATION_NOT_FOUND' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'BAD_REQUEST';

const ERROR_STATUS: Record<CopilotErrorCode, number> = {
  INSUFFICIENT_CREDITS: 402, INVALID_MODE: 400, INVALID_AMOUNT: 400,
  CONTEXT_REQUIRED: 400, CONTEXT_TOO_LARGE: 413, TOOL_ERROR: 500,
  LLM_ERROR: 502, RATE_LIMITED: 429, INTERNAL_ERROR: 500,
  RESERVATION_NOT_FOUND: 404, UNAUTHORIZED: 401, NOT_FOUND: 404, BAD_REQUEST: 400,
};

class CopilotError extends Error {
  readonly code: CopilotErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;
  constructor(code: CopilotErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'CopilotError';
    this.code = code;
    this.statusCode = ERROR_STATUS[code];
    this.details = details;
  }
  toJSON() { return { code: this.code, message: this.message, details: this.details }; }
}

// =============================================================
// SECTION 3 — Clients Supabase (helpers multi-clés conservés)
// =============================================================

let _admin: SupabaseClient | null = null;

function readFirstJsonKey(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object") {
      const values = Object.values(parsed);
      const first = values.find((v) => typeof v === "string");
      if (typeof first === "string") return first;
    }
  } catch {
    return raw;
  }
  return null;
}

function getSupabaseUrl(): string {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new CopilotError("INTERNAL_ERROR", "Missing SUPABASE_URL env");
  return url;
}

function getSupabasePublishableKey(): string {
  const key =
    readFirstJsonKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")) ??
    Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("VITE_SUPABASE_ANON_KEY");
  if (!key) throw new CopilotError("INTERNAL_ERROR", "Missing Supabase publishable key env");
  return key;
}

function getSupabaseServiceRoleKey(): string {
  // ⚠️ Projet sur JWT Signing Keys : la legacy SUPABASE_SERVICE_ROLE_KEY est
  // dépréciée/désactivée et provoque un 401 « JWT invalide » lors des appels
  // internes. On lit donc SUPABASE_SECRET_KEYS (dictionnaire JSON des clés
  // secrètes actives) EN PRIORITÉ.
  const key =
    readFirstJsonKey(Deno.env.get("SUPABASE_SECRET_KEYS")) ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY");
  if (!key) throw new CopilotError("INTERNAL_ERROR", "Missing Supabase service role key env");
  return key;
}

function getAdmin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });
  return _admin;
}

function getUserClient(authHeader: string): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// =============================================================
// SECTION 4 — Helpers crédits (version compacte inlinée)
// =============================================================

async function reserveCredits(p: {
  userId: string; amount: number; reason: string; conversationId?: string;
}): Promise<{ reservationId: string; remainingBalance: number }> {
  const { data, error } = await getAdmin().rpc('copilot_reserve_credits', {
    p_user_id: p.userId, p_amount: p.amount,
    p_reason: p.reason, p_conversation_id: p.conversationId ?? null,
  });
  if (error) {
    if (error.message?.includes('INSUFFICIENT_CREDITS')) {
      throw new CopilotError('INSUFFICIENT_CREDITS', 'Solde insuffisant', { required: p.amount });
    }
    throw new CopilotError('INTERNAL_ERROR', `Réservation échouée : ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.reservation_id) throw new CopilotError('INTERNAL_ERROR', 'Réponse réservation invalide');
  return { reservationId: row.reservation_id, remainingBalance: row.remaining_balance ?? 0 };
}

async function settleCredits(p: {
  userId: string; reservationId: string; messageId: string;
  mode: CopilotMode; finalAmount?: number; metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await getAdmin().rpc('copilot_settle_credits', {
    p_user_id: p.userId, p_reservation_id: p.reservationId,
    p_message_id: p.messageId, p_metadata: p.metadata ?? null,
    p_final_amount: p.finalAmount ?? null,      // ⬅️ NULL = ancien comportement
  });
  if (error) console.error('[credits] settle failed', error.message);
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: ex } = await getAdmin()
      .from('copilot_usage_daily').select('*')
      .eq('user_id', p.userId).eq('date', today).maybeSingle();
    await getAdmin().from('copilot_usage_daily').upsert({
      user_id: p.userId, date: today,
      quick_calls: (ex?.quick_calls ?? 0) + (p.mode === 'quick' ? 1 : 0),
      advanced_calls: (ex?.advanced_calls ?? 0) + (p.mode === 'advanced' ? 1 : 0),
      report_calls: (ex?.report_calls ?? 0) + (p.mode === 'report' ? 1 : 0),
      total_tokens_in: (ex?.total_tokens_in ?? 0) + (Number(p.metadata?.inputTokens) || 0),
      total_tokens_out: (ex?.total_tokens_out ?? 0) + (Number(p.metadata?.outputTokens) || 0),
      total_credits: (ex?.total_credits ?? 0) + (p.finalAmount ?? CREDIT_COST[p.mode]),
    }, { onConflict: 'user_id,date' });
  } catch (e) { console.error('[credits] usage_daily failed', e); }
}

async function refundCredits(p: {
  userId: string; reservationId: string; reason?: string;
}): Promise<number> {
  const { data, error } = await getAdmin().rpc('copilot_refund_credits', {
    p_user_id: p.userId, p_reservation_id: p.reservationId,
    p_reason: p.reason ?? 'refund',
  });
  if (error) { console.error('[credits] refund failed', error.message); return 0; }
  return typeof data === 'number' ? data : 0;
}

// =============================================================
// SECTION 5 — Types contexte & requête
// =============================================================

type Vertical = 'promoteur' | 'investisseur' | 'marchand' | 'apporteur' | 'particulier' | 'generique';

interface MimmozaContext {
  vertical: Vertical;
  route: string;
  // ── Annonce active (investisseur / marchand) ──────────────
  listing_id?: string;
  url?: string;
  city?: string;
  zip_code?: string;
  price?: number;
  surface?: number;
  property_type?: string;
  // ── Foncier ───────────────────────────────────────────────
  parcel?: {
    id: string; address?: string; commune?: string;
    code_postal?: string; surface_m2?: number; plu_zone?: string;
    cadastral_ref?: string; lat?: number; lng?: number; code_insee?: string;
  };
  study?: { id: string; type: string; title?: string };
  user?: { id: string; role?: string; plan?: string };
  // PLU déjà extrait par le parser Mimmoza (rempli par le front, page Foncier).
  // Le ruleset reste dans le contexte ; seul get_parcel_plu le résume au LLM.
  plu?: {
    zone_code?: string;
    zone_libelle?: string;
    source?: string;
    ruleset?: Record<string, unknown> | null;
    oap?: Record<string, unknown> | null;
  };
  // LOT 6 — snapshot prédictif (17 sources, transmis par le front)
  predictive_snapshot?: {
    dvf?: { prix_m2_median?: number | null; nb_transactions?: number | null; evolution_prix_pct?: number | null; prix_m2_min?: number | null; prix_m2_max?: number | null } | null;
    market_scores?: { global?: number | null; demande?: number | null; offre?: number | null; accessibilite?: number | null; environnement?: number | null; transport_exclu?: boolean } | null;
    insee?: { population?: number | null; densite?: number | null; revenu_median?: number | null; taux_chomage?: number | null; taux_pauvrete?: number | null; pct_75_plus?: number | null; pct_etudiants?: number | null; commune_nom?: string | null; departement?: string | null } | null;
    bpe?: { score?: number | null; total_equipements?: number | null; commerces_count?: number | null; sante_count?: number | null; education_count?: number | null; loisirs_count?: number | null } | null;
    transport?: { score?: number | null; has_metro_train?: boolean; has_tram?: boolean; nearest_stop_m?: number | null; is_urban?: boolean } | null;
    georisques?: { nb_risques?: number | null; inondation?: boolean | null; sismique?: number | null; retrait_gonflement?: boolean | null; radon?: number | null; cavites?: boolean | null } | null;
    rentabilite?: { rendement_brut?: number | null; rendement_net?: number | null; cashflow_mensuel?: number | null; marge_brute?: number | null; marge_brute_pct?: number | null; prix_revente_cible?: number | null; tri_pct?: number | null; cout_projet?: number | null; cout_achat?: number | null } | null;
    dpe?: string | null;
    dpe_source?: string | null;
    plu_zone?: string | null;
    sitadel_score?: number | null;
    demographie_score?: number | null;
    loyer_median_zone?: number | null;
    travaux_budget?: number | null;
    fiscal_regime?: string | null;
    bce_rate?: number | null;
    bce_pressure_label?: string | null;
    horizon_mois?: number | null;
    deal_id?: string | null;
    deal_label?: string | null;
    generated_at?: string | null;
    sources_count?: number | null;
  } | null;
  // LOT 8 — snapshot libre de la page courante (donnees visibles a l'ecran)
  pageSnapshot?: Record<string, string | number | null> | null;
  // LOT 9 — étude de risques déjà calculée (page Risques/Réhabilitation),
  // transmise telle quelle par le front. Même contrat que la réponse risk-study :
  // { meta, scores, data, categories, insights }. Injectée dans le system prompt
  // → le Copilot répond aux questions de risques SANS appeler d'outil.
  risk_study?: Record<string, unknown> | null;
  // LOT 10 — implantation 2D dessinée (page Implantation2D), transmise telle
  // quelle par le front : parcelle, reculs, bâtiments, checks PLU, diagnostics,
  // scénario. Injectée dans le system prompt → le Copilot répond sur le plan
  // RÉELLEMENT dessiné, sans appeler d'outil et sans halluciner.
  implantation_2d?: Record<string, unknown> | null;
  // V1.1 — Deal actif et contexte de page (transmis par le front)
  activeDeal?: Record<string, unknown> | null;
  pageContext?: { pathname?: string; space?: string; mode?: string; tab?: string } | null;
}

// V1.7 — Pieces jointes du message courant (images + PDF).
// Encodees en base64 par le front. NON persistees : l'historique relu depuis
// copilot_messages est du texte, donc le modele ne "revoit" pas le fichier
// aux tours suivants.
interface CopilotAttachment {
  mediaType: string;   // image/png|jpeg|gif|webp ou application/pdf
  data: string;        // base64 SANS le prefixe data:
  name?: string;
}

interface ChatRequest {
  conversation_id?: string;
  message: string;
  mode: CopilotMode;
  context: MimmozaContext;
  attachments?: CopilotAttachment[];
}

const ALLOWED_MEDIA_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
]);
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_B64 = 6_000_000; // ~4,5 Mo de fichiers, cumules

// ─── LOT 5 : type d'input pour get_quick_market_insight ─────
interface QuickMarketInput {
  listing_id?: string;
  url?: string;
  city?: string;
  zip_code?: string;
  price?: number;
  surface?: number;
}

// =============================================================
// SECTION 6 — Tool Registry (LOT 4 + LOT 5)
// =============================================================

interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  available_in_modes: CopilotMode[];
}

// ─── Résultats normalisés renvoyés au LLM ────────────────────
// `confirmation_requise` : l'aperçu d'un verbe en deux temps. RIEN n'a été
// écrit ; il faut rappeler l'outil avec `confirmer: true`.
//
// ⚠️ Ce statut existe parce que les six aperçus renvoyaient `ok`. Pour le
// modèle, `ok` est un succès : il annonçait donc à l'utilisateur que la veille
// était désactivée alors qu'aucune écriture n'avait eu lieu, et le second appel
// n'arrivait jamais. Une promesse tenue pour un fait est le pire mode d'échec
// d'un assistant — l'utilisateur croit son action faite et n'y revient pas.
type ToolStatus = 'ok' | 'confirmation_requise' | 'not_configured' | 'not_found' | 'partial' | 'error';

interface ToolResult {
  status: ToolStatus;
  source: string;
  data?: Record<string, unknown>;
  message?: string;
}

// ─── Résolution de l'identifiant parcelle ────────────────────
interface ParcelRef {
  parcel_id?: string;
  cadastral_ref?: string;
  lat?: number;
  lng?: number;
  commune?: string;
  code_insee?: string;
  address?: string;
  /** D'où vient code_insee. Aucun de ces trois cas n'est vérifié : seul
   *  resoudreInseeFiable() a le droit de transformer cette valeur en code
   *  utilisable. Renseigné pour le diagnostic, jamais pour court-circuiter. */
  code_insee_origine?: 'modele' | 'contexte' | 'derive_idu';
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * Extrait la meilleure référence parcelle disponible depuis :
 *  - les inputs fournis par le LLM (prioritaire s'il a précisé)
 *  - le MimmozaContext (source de vérité par défaut)
 * Ne lève jamais : retourne un ParcelRef éventuellement partiel.
 *
 * ⚠️ Correctif A — `ref.code_insee` est une HYPOTHÈSE, pas une donnée : il peut
 * venir du modèle, du contexte, ou d'une dérivation de chaîne. Aucun appelant
 * ne doit s'en servir pour interroger une source : il doit passer par
 * resoudreInseeFiable(), qui le confronte au référentiel des communes.
 */
function resolveParcelRef(input: Record<string, unknown>, ctx: MimmozaContext): ParcelRef {
  const p = ctx.parcel;
  const inseeModele = str(input.code_insee);
  const ref: ParcelRef = {
    parcel_id: str(input.parcel_id) ?? p?.id,
    cadastral_ref: str(input.cadastral_ref) ?? p?.cadastral_ref,
    lat: num(input.lat) ?? p?.lat,
    lng: num(input.lng) ?? p?.lng,
    commune: str(input.commune) ?? p?.commune,
    code_insee: inseeModele ?? p?.code_insee,
    address: str(input.address) ?? p?.address,
  };
  if (ref.code_insee) ref.code_insee_origine = inseeModele ? 'modele' : 'contexte';
  // Autonomie : dériver le code INSEE de l'identifiant parcellaire (IDU) si absent.
  // Tout identifiant cadastral français commence par le code INSEE sur 5 caractères :
  //   DDCCC OOO SS NNNN  →  ex "64065000AI0002" → INSEE "64065" (Corse : 2A/2B).
  // Le modèle est explicitement invité à produire des IDU : un IDU inventé donne
  // ici un code de forme parfaite et de contenu fictif. D'où la vérification en aval.
  if (!ref.code_insee) {
    const idu = (ref.cadastral_ref ?? ref.parcel_id ?? '').replace(/\s/g, '');
    const m = /^(2[ab]\d{3}|\d{5})/i.exec(idu);
    if (m) {
      ref.code_insee = m[1].toUpperCase();
      ref.code_insee_origine = 'derive_idu';
    }
  }
  return ref;
}

function hasAnyIdentifier(ref: ParcelRef): boolean {
  return Boolean(ref.parcel_id || ref.cadastral_ref || (ref.lat != null && ref.lng != null));
}

// ─── Correctif A : point de passage unique du code INSEE ─────
//
// Un code INSEE proposé par le modèle n'est PAS une donnée : c'est une
// hypothèse. Le prompt système admet lui-même (règle 4quaterdecies) que le
// modèle se trompe en associant codes et communes — mais il n'interdisait que
// le sens code → nom. Le sens nom → code, seul à atteindre la base, restait
// ouvert, et la présence d'un code désactivait précisément la vérification.
//
// resoudreInseeFiable() est désormais le SEUL endroit du fichier autorisé à
// transformer une hypothèse en code utilisable, et elle ne le fait qu'après
// confrontation au référentiel geo.api.gouv.fr. Aucun handler ne doit lire
// input.code_insee directement.
//
// Règle de repli retenue : un code non résolu ne fait jamais échouer la
// requête s'il existe un nom de commune ou un code postal exploitable — on
// résout par le nom et l'écart est signalé. Un ajustement n'est JAMAIS
// silencieux : il remonte dans data._ajustement et dans le message du tool.

const INSEE_SHAPE = /^(?:\d{5}|2[AB]\d{3})$/i;

interface CommuneOfficielle {
  code: string;
  nom: string;
  cp?: string;
  lat?: number;
  lng?: number;
}

/** 'introuvable' = le référentiel a répondu, la commune n'existe pas.
 *  'indisponible' = le référentiel n'a pas répondu, on ne sait rien.
 *  Confondre les deux est ce qui permettait à un code faux de passer. */
type EchecReferentiel = 'introuvable' | 'indisponible';

// Le cache mémorise aussi les réponses NÉGATIVES fermes ('introuvable') :
// un code inventé est réutilisé par le modèle à chaque outil du même tour, et
// sans cela on repayait un aller-retour réseau à chaque fois. En revanche une
// indisponibilité n'est JAMAIS mémorisée : elle doit rester réessayable.
const _communeCache = new Map<string, CommuneOfficielle | 'introuvable'>();

// Coupe-circuit : si geo.api vient de ne pas répondre, on ne réessaie pas
// pendant quelques secondes. Sans cela, un tour appelant vingt outils cumulait
// vingt timeouts de 5 s — le correctif rendait l'assistant inutilisable en panne.
let _geoIndisponibleJusqua = 0;
const GEO_COUPE_CIRCUIT_MS = 15_000;

async function chercherCommune(query: string): Promise<CommuneOfficielle | EchecReferentiel> {
  const hit = _communeCache.get(query);
  if (hit) return hit;
  if (Date.now() < _geoIndisponibleJusqua) return 'indisponible';
  try {
    const r = await fetch(
      `https://geo.api.gouv.fr/communes?${query}&fields=code,nom,centre,codesPostaux&limit=1`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!r.ok) {
      if (r.status >= 500 || r.status === 429) {
        _geoIndisponibleJusqua = Date.now() + GEO_COUPE_CIRCUIT_MS;
        return 'indisponible';
      }
      _communeCache.set(query, 'introuvable');
      return 'introuvable';
    }
    const d = await r.json();
    const c = Array.isArray(d) ? d[0] : null;
    if (!c?.code) {
      _communeCache.set(query, 'introuvable');
      return 'introuvable';
    }
    const xy = c.centre?.coordinates;
    const cps = Array.isArray(c.codesPostaux) ? c.codesPostaux : [];
    const out: CommuneOfficielle = {
      code: String(c.code),
      nom: String(c.nom ?? ''),
      cp: cps.length ? String(cps[0]) : undefined,
      lng: Array.isArray(xy) ? xy[0] : undefined,
      lat: Array.isArray(xy) ? xy[1] : undefined,
    };
    _communeCache.set(query, out);
    return out;
  } catch {
    _geoIndisponibleJusqua = Date.now() + GEO_COUPE_CIRCUIT_MS;
    return 'indisponible';
  }
}

// ⚠️ geo.api.gouv.fr/communes ne contient PAS les arrondissements municipaux :
// `?code=75104` renvoie [] , et `?codePostal=75004` renvoie 75056 « Paris ».
// Interroger le référentiel avec un code d'arrondissement le ferait donc
// déclarer inexistant — soit l'inverse du but recherché, puisqu'un code
// d'arrondissement est PLUS précis qu'un code de commune globale (et que
// loyers-reference-v1 n'a aucune ligne pour la commune globale).
// On valide donc l'arrondissement par sa commune globale, et on conserve le
// code d'arrondissement tel quel.
async function chercherParCode(code: string): Promise<CommuneOfficielle | EchecReferentiel> {
  const global = communeGlobalePLM(code);
  if (!global) return chercherCommune(`code=${encodeURIComponent(code)}`);
  const c = await chercherCommune(`code=${global}`);
  if (c === 'introuvable' || c === 'indisponible') return c;
  return { ...c, code, nom: `${c.nom} ${libelleArrondissement(code)}` };
}
const chercherParNom = (nom: string) => chercherCommune(`nom=${encodeURIComponent(nom)}&boost=population`);
const chercherParCp = (cp: string) => chercherCommune(`codePostal=${encodeURIComponent(cp)}`);

/** Comparaison de noms de communes tolérante (accents, tirets, Saint/St). */
const DIACRITIQUES = new RegExp('[\\u0300-\\u036f]', 'g');
function normNomCommune(s: string): string {
  return s
    .normalize('NFD').replace(DIACRITIQUES, '')
    .toLowerCase()
    .replace(/\bst\b/g, 'saint')
    .replace(/\bste\b/g, 'sainte')
    .replace(/[^a-z0-9]/g, '');
}

/** Retire le suffixe « Ne arrondissement » (« Paris 4e arrondissement » → « Paris »). */
function sansSuffixeArrondissement(v: string): string {
  return v.replace(/\s+\d{1,2}\s*(?:er|ers|e|è|ème|eme)?\s+arrondissement\s*$/i, '').trim();
}

/** Deux noms désignent-ils la même commune ?
 *  Un arrondissement est une SUBDIVISION de la commune nommée : plus précis,
 *  pas contradictoire. Le suffixe est retiré des DEUX côtés — le retirer d'un
 *  seul rendait la fonction asymétrique, et « Paris 4e arrondissement » demandé
 *  face à « Paris » retenu produisait un faux conflit. */
function memeCommune(a: string, b: string): boolean {
  const ka = normNomCommune(a);
  const kb = normNomCommune(b);
  if (ka === kb) return true;
  const ra = normNomCommune(sansSuffixeArrondissement(a));
  const rb = normNomCommune(sansSuffixeArrondissement(b));
  return ra.length > 0 && ra === rb;
}

/** Paris/Lyon/Marseille : geo.api renvoie la commune globale sur recherche par
 *  nom. Un code d'arrondissement n'est donc pas en conflit avec elle — il est
 *  plus précis. Sans cette exception, tout arrondissement serait « corrigé ». */
function communeGlobalePLM(code: string): string | undefined {
  if (/^751(?:0[1-9]|1[0-9]|20)$/.test(code)) return '75056';
  if (/^6938[1-9]$/.test(code)) return '69123';
  if (/^132(?:0[1-9]|1[0-6])$/.test(code)) return '13055';
  return undefined;
}

/** « 75104 » → « 4e arrondissement ». Sert à nommer un arrondissement, que le
 *  référentiel des communes ne connaît pas.
 *  ⚠️ Le rang de Lyon tient sur UN chiffre (69383 = 3e), Paris et Marseille sur
 *  deux (75104 = 4e, 13208 = 8e). Un slice(-2) uniforme donnerait « Lyon 83e ». */
function libelleArrondissement(code: string): string {
  const n = Number(communeGlobalePLM(code) === '69123' ? code.slice(4) : code.slice(3));
  return `${n === 1 ? '1er' : `${n}e`} arrondissement`;
}

/** Code postal d'arrondissement → code INSEE d'arrondissement.
 *  geo.api ne sait pas faire cette conversion (il renvoie la commune globale) ;
 *  la correspondance est arithmétique et stable. */
function arrondissementDepuisCp(cp: string): string | undefined {
  const m = /^(75|69|13)(\d{3})$/.exec(cp);
  if (!m) return undefined;
  const n = Number(m[2]);
  if (m[1] === '75' && n >= 1 && n <= 20) return `751${String(n).padStart(2, '0')}`;
  // Paris a un second CP par arrondissement en 751xx (75116 = 16e, forme « bis »).
  if (m[1] === '75' && n >= 101 && n <= 120) return `751${String(n - 100).padStart(2, '0')}`;
  if (m[1] === '69' && n >= 1 && n <= 9) return `6938${n}`;
  if (m[1] === '13' && n >= 1 && n <= 16) return `132${String(n).padStart(2, '0')}`;
  return undefined;
}

type OrigineInsee =
  | 'verifie'      // code proposé, confirmé au référentiel
  | 'resolu_nom'   // code obtenu depuis le nom de commune
  | 'resolu_cp'    // code obtenu depuis le code postal
  | 'non_verifie'  // référentiel injoignable : code utilisé faute de mieux
  | 'aucun';

interface ResolutionInsee {
  code?: string;
  nom?: string;
  cp?: string;
  lat?: number;
  lng?: number;
  origine: OrigineInsee;
  /** Le code proposé en entrée, conservé dès qu'il diffère du code retenu. */
  code_propose?: string;
  /** Écart constaté. Doit toujours être répercuté à l'utilisateur. */
  ajustement?: string;
  /** Renseigné uniquement quand aucun code n'a pu être retenu. */
  echec?: 'aucun_identifiant' | 'introuvable' | 'referentiel_indisponible';
  /** Message prêt à être renvoyé au modèle en cas d'échec. */
  message?: string;
}

/**
 * Résout et VÉRIFIE le code INSEE à utiliser pour un appel d'outil.
 * Ordre : code proposé (vérifié) → nom de commune → code postal.
 * Ne lève jamais. Ne retourne jamais un code non vérifié sans le dire.
 */
async function resoudreInseeFiable(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
  refIn?: ParcelRef,
): Promise<ResolutionInsee> {
  const ref = refIn ?? resolveParcelRef(input, ctx);
  const propose = str(input.code_insee) ?? str(input.commune_insee) ?? ref.code_insee ?? (ctx as any).code_insee;
  const nom = str(input.commune) ?? str(input.city) ?? ref.commune ?? (ctx as any).city;
  const cp = str(input.zip_code) ?? ctx.parcel?.code_postal ?? (ctx as any).zip_code;

  // Recherche par nom, affinée par code postal pour Paris/Lyon/Marseille :
  // geo.api rend la commune globale sur un nom, l'arrondissement sur un CP.
  const parNom = async (): Promise<CommuneOfficielle | EchecReferentiel | null> => {
    if (!nom) return null;
    const c = await chercherParNom(nom);
    if (c === 'introuvable' || c === 'indisponible') return c;
    // Affinage PLM : chercher le CP au référentiel ne sert à rien (il renvoie
    // la commune globale). La correspondance CP → arrondissement est calculée.
    if (cp && ['75056', '69123', '13055'].includes(c.code)) {
      const arr = arrondissementDepuisCp(cp);
      if (arr && communeGlobalePLM(arr) === c.code) {
        return { ...c, code: arr, nom: `${c.nom} ${libelleArrondissement(arr)}`, cp };
      }
    }
    return c;
  };

  // 1) Forme du code proposé. Un code malformé n'est pas un code.
  let candidat = propose;
  let noteForme: string | undefined;
  if (candidat && !INSEE_SHAPE.test(candidat)) {
    noteForme = `Le code INSEE « ${candidat} » n'a pas une forme valide (5 caractères) : il a été ignoré.`;
    candidat = undefined;
  }

  // 2) Le code proposé est confronté au référentiel — toujours, sans exception.
  if (candidat) {
    const trouve = await chercherParCode(candidat.toUpperCase());

    if (trouve === 'indisponible') {
      return {
        code: candidat.toUpperCase(),
        nom,
        cp,
        origine: 'non_verifie',
        code_propose: candidat,
        ajustement:
          `Le référentiel des communes (geo.api.gouv.fr) est injoignable : le code INSEE ` +
          `« ${candidat} » n'a PAS pu être vérifié. Précise à l'utilisateur que la commune ` +
          `n'a pas été confirmée avant de présenter le moindre chiffre.`,
      };
    }

    if (trouve !== 'introuvable') {
      // 2a) Code valide. Reste à vérifier qu'il désigne bien la commune nommée.
      // « Paris » face à « Paris 4e arrondissement » n'est PAS un conflit.
      // On compare des RACINES, jamais par préfixe : un startsWith tiendrait
      // « Saint-Denis-de-Pile » pour un arrondissement de « Saint-Denis ».
      // Même règle que dans les quatre fonctions aval (memeCommune).
      const conflit = nom && !memeCommune(nom, trouve.nom);
      if (!conflit) {
        return { code: trouve.code, nom: trouve.nom, cp: cp ?? trouve.cp, lat: trouve.lat, lng: trouve.lng, origine: 'verifie', ajustement: noteForme };
      }
      const viaNom = await parNom();
      if (viaNom && viaNom !== 'introuvable' && viaNom !== 'indisponible') {
        // Arrondissement PLM : le code est plus précis que le nom, on le garde.
        if (communeGlobalePLM(trouve.code) === viaNom.code) {
          return { code: trouve.code, nom: trouve.nom, cp: cp ?? trouve.cp, lat: trouve.lat, lng: trouve.lng, origine: 'verifie', ajustement: noteForme };
        }
        // Conflit réel : le nom saisi prime sur le code, qui est l'élément
        // que le modèle fabrique. L'écart est signalé, jamais absorbé.
        return {
          code: viaNom.code, nom: viaNom.nom, cp: cp ?? viaNom.cp, lat: viaNom.lat, lng: viaNom.lng,
          origine: 'resolu_nom',
          code_propose: candidat,
          ajustement:
            `Le code INSEE « ${candidat} » correspond à ${trouve.nom}, pas à « ${nom} ». ` +
            `La réponse porte sur ${viaNom.nom} (${viaNom.code}), résolue depuis le nom de commune. ` +
            `Signale cet écart à l'utilisateur.`,
        };
      }
      // Le nom n'est pas résolvable : on garde le code vérifié, en le nommant.
      return {
        code: trouve.code, nom: trouve.nom, cp: cp ?? trouve.cp, lat: trouve.lat, lng: trouve.lng,
        origine: 'verifie',
        ajustement:
          `« ${nom} » est inconnu du référentiel ; la réponse porte sur ${trouve.nom} ` +
          `(${trouve.code}), commune du code INSEE fourni. Signale-le à l'utilisateur.`,
      };
    }

    // 2b) Le référentiel a répondu : ce code n'existe pas.
    noteForme =
      `Le code INSEE « ${candidat} » n'existe pas au référentiel officiel des communes.`;
  }

  // 3) Repli sur le nom de commune.
  const viaNom = await parNom();
  if (viaNom && viaNom !== 'introuvable' && viaNom !== 'indisponible') {
    return {
      code: viaNom.code, nom: viaNom.nom, cp: cp ?? viaNom.cp, lat: viaNom.lat, lng: viaNom.lng,
      origine: 'resolu_nom',
      code_propose: propose,
      ajustement: noteForme
        ? `${noteForme} La réponse porte sur ${viaNom.nom} (${viaNom.code}), résolue depuis le nom de commune. Signale-le à l'utilisateur.`
        : undefined,
    };
  }

  // 4) Repli sur le code postal.
  let cpIndisponible = false;
  if (cp) {
    const viaCp = await chercherParCp(cp);
    if (viaCp === 'indisponible') cpIndisponible = true;
    if (viaCp !== 'introuvable' && viaCp !== 'indisponible') {
      return {
        code: viaCp.code, nom: viaCp.nom, cp: viaCp.cp ?? cp, lat: viaCp.lat, lng: viaCp.lng,
        origine: 'resolu_cp',
        code_propose: propose,
        ajustement: noteForme
          ? `${noteForme} La réponse porte sur ${viaCp.nom} (${viaCp.code}), résolue depuis le code postal ${cp}. Signale-le à l'utilisateur.`
          : undefined,
      };
    }
  }

  // 5) Rien d'exploitable.
  // `cpIndisponible` couvre le cas sans nom de commune : la panne n'était alors
  // détectée par aucune des deux voies et ressortait en « aucune commune ne
  // correspond au code postal X » — un mensonge, et une réponse que le modèle
  // relaie comme un fait.
  if (viaNom === 'indisponible' || cpIndisponible) {
    return {
      origine: 'aucun', echec: 'referentiel_indisponible', code_propose: propose,
      message:
        "Le référentiel des communes (geo.api.gouv.fr) est momentanément injoignable : " +
        "impossible d'identifier la commune de façon fiable. Ne donne aucun chiffre et " +
        "propose de réessayer.",
    };
  }
  if (propose || nom || cp) {
    return {
      origine: 'aucun', echec: 'introuvable', code_propose: propose,
      message:
        `Aucune commune ne correspond à ${[propose && `au code « ${propose} »`, nom && `« ${nom} »`, cp && `au code postal ${cp}`].filter(Boolean).join(' / ')} ` +
        `au référentiel officiel. N'invente aucune valeur : demande à l'utilisateur de préciser la commune.`,
    };
  }
  return {
    origine: 'aucun', echec: 'aucun_identifiant',
    message:
      "Aucune commune identifiée (ni code INSEE, ni ville, ni code postal). " +
      "Demande la commune à l'utilisateur avant de répondre.",
  };
}

/** Échec de résolution → ToolResult normalisé. */
function echecInsee(r: ResolutionInsee, source: string): ToolResult {
  return { status: r.echec === 'referentiel_indisponible' ? 'error' : 'not_found', source, message: r.message };
}

/** Répercute l'ajustement éventuel dans le ToolResult. Jamais silencieux.
 *
 *  Couvre aussi le cas des outils où le code INSEE est FACULTATIF (adresse ou
 *  lat/lng suffisent) : ils poursuivent malgré l'échec de résolution, et sans
 *  cette branche le modèle n'apprenait jamais que le code qu'il avait proposé
 *  était faux — l'outil répondait normalement, code silencieusement écarté.
 *
 *  À APPLIQUER SUR TOUTE SORTIE d'un handler située après resoudreInseeFiable,
 *  y compris les `catch` et les `not_found` précoces : une erreur ou une absence
 *  de localisation qui remonte nue apprend au modèle que l'appel a échoué, jamais
 *  que le code qu'il venait de proposer a été invalidé — et il le rejoue au tour
 *  suivant. Le helper est sans effet quand il n'y a rien à signaler : l'envelopper
 *  systématiquement ne change pas le comportement nominal. */
function avecAjustement(res: ToolResult, r: ResolutionInsee): ToolResult {
  const note = r.ajustement ?? (
    r.echec && r.code_propose
      ? `Le code INSEE « ${r.code_propose} » n'a pas pu être validé au référentiel ` +
        `des communes : il a été écarté et la réponse ne s'appuie PAS dessus. ` +
        `Ne le réutilise pas et ne le cite pas comme s'il avait été confirmé.`
      : r.echec === 'referentiel_indisponible'
      // Aucun code proposé, mais le référentiel est en panne et l'outil a
      // répondu autrement (adresse, coordonnées). Sans ce message, la réponse
      // paraît complète alors que la commune n'a jamais été confirmée.
      ? `Le référentiel des communes est momentanément injoignable : aucune ` +
        `commune n'a été confirmée pour cette réponse. Ne rattache le résultat ` +
        `à aucune commune nommée.`
      : undefined
  );
  if (!note) return res;
  const r2 = { ...r, ajustement: note };
  return avecNote(res, r2, note);
}

/** Les fonctions aval (loyers, zonage, taxes, PPR) renvoient leur propre bloc
 *  `_insee` quand ELLES ont dû corriger la commune. Les `summarize*Dedicated`
 *  ne recopient que summary/stats/items : cette trace disparaissait, et ne
 *  survivait que par la concaténation au résumé côté fonction — un fil ténu,
 *  qu'une réécriture d'un summarize romprait sans bruit. On la réinjecte ici. */
function avecInseeAval(res: ToolResult, raw: unknown): ToolResult {
  const t = (raw as any)?._insee;
  if (!t || typeof t !== 'object' || !t.ajustement) return res;
  return {
    ...res,
    data: { ...(res.data ?? {}), _insee_aval: t, _ajustement: t.ajustement },
    message: res.message ? `${t.ajustement}\n\n${res.message}` : String(t.ajustement),
  };
}

function avecNote(res: ToolResult, r: ResolutionInsee, note: string): ToolResult {
  return {
    ...res,
    data: {
      ...(res.data ?? {}),
      _ajustement: note,
      _insee_origine: r.origine,
      ...(r.code_propose && r.code_propose !== r.code ? { _insee_propose: r.code_propose } : {}),
      _insee_retenu: r.code ?? null,
      _commune_retenue: r.nom ?? null,
    },
    message: res.message ? `${note}\n\n${res.message}` : note,
  };
}

// ─── Helper générique : appel d'une Edge Function interne ────
async function callInternalFunction(fnName: string, body: unknown): Promise<unknown> {
  const baseUrl = getSupabaseUrl();
  const serviceKey = getSupabaseServiceRoleKey();

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), INTERNAL_FN_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl}/functions/v1/${fnName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new CopilotError('TOOL_ERROR', `${fnName} → HTTP ${res.status} : ${txt.slice(0, 200)}`);
    }
    return await res.json();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new CopilotError('TOOL_ERROR', `${fnName} → timeout (${INTERNAL_FN_TIMEOUT_MS}ms)`);
    }
    if (e instanceof CopilotError) throw e;
    throw new CopilotError('TOOL_ERROR', `${fnName} → ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Helpers de résumé ───────────────────────────────────────
function pick(obj: unknown, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj && typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  }
  return out;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// =============================================================
// SUMMARIZERS — réduisent le brut en résumé compact pour le LLM.
// ⚠️ La réponse de smartscore-enriched-v3 fait plusieurs Ko :
//    on n'envoie JAMAIS le brut. Aucune valeur inventée.
// =============================================================

/** SmartScore : aligné sur le contrat réel de smartscore-enriched-v3 (v4.1). */
function summarizeSmartScore(raw: unknown): Record<string, unknown> {
  const root = raw as Record<string, unknown>;
  if (!root || root.success === false) {
    return { note: 'Réponse SmartScore vide ou en erreur', error: root?.error ?? null };
  }

  const v4 = root.smartscore_v4 as Record<string, unknown> | undefined;
  const v3 = root.smartscore as Record<string, unknown> | undefined;

  const out: Record<string, unknown> = {
    version: root.version ?? null,
    zone_type: root.zone_type ?? null,
  };

  // smartscore v4.6 — Classification de densité INSEE et rayons réellement
  // appliqués. Sans ce relais, le modèle écrivait « commune rurale » en le
  // déduisant de la densité, et commentait des équipements sans savoir sur quel
  // périmètre ils avaient été cherchés (500 m ou 20 km selon le niveau).
  const zoneProfile = root.zone_profile as Record<string, unknown> | undefined;
  if (zoneProfile) {
    out.zone_profile = pick(zoneProfile, [
      'zone_type', 'niveau_3', 'niveau_7', 'libelle_niveau_7', 'source', 'rayons_m', 'avertissement',
    ]);
  }

  if (v4) {
    out.score = v4.score ?? null;
    out.verdict = v4.verdict ?? null;

    // smartscore v4.5 — Indicateur de confiance. Le score global est renormalisé
    // sur les seuls piliers disponibles, mais rien n'indiquait combien : un
    // SmartScore assis sur 2 piliers sur 10 se lisait comme un score complet.
    // `score: null` signifie « non calculable », JAMAIS « moyen ».
    const conf = v4.confidence as Record<string, unknown> | undefined;
    if (conf) {
      out.confiance = {
        ...pick(conf, ['piliers_mesures', 'piliers_total', 'piliers_ecartes']),
        avertissement:
          "Un pilier écarté n'a PAS été mesuré : ne le présente ni comme favorable ni comme défavorable, et ne l'omets pas silencieusement. "
          + "Si des piliers manquent, dis-le dans ta conclusion et pas seulement dans un tableau. "
          + "Un score null signifie « non calculable faute de sources » — ne l'interprète jamais comme un potentiel moyen.",
      };
    }

    // Piliers : on ne garde que le score de chaque pilier (pas les sous-détails).
    // Un pilier à null = non mesuré (écarté de la pondération), pas un zéro.
    const pillars = v4.pillar_scores as Record<string, unknown> | undefined;
    if (pillars) {
      out.piliers = pick(pillars, [
        'market', 'price_opportunity', 'services', 'transport',
        'ecoles', 'sante', 'environment', 'demographie', 'competition', 'dpe',
        'rural_accessibility',
      ]);
    }

    // smartscore v4.5 — Composants du pilier environnement. Géorisques, DPE de
    // quartier et qualité de l'air sont des stubs NON BRANCHÉS : le pilier
    // entier est donc à null aujourd'hui. Le score de bruit, lui, est une
    // ESTIMATION (déduite de la desserte, ou forcée en zone classée rurale) et
    // son libellé le dit — à ne pas citer comme une mesure.
    const env = v4.environment as Record<string, unknown> | undefined;
    if (env) {
      const noise = env.noise as Record<string, unknown> | undefined;
      const geo = env.georisques as Record<string, unknown> | undefined;
      out.environnement_detail = {
        score: env.score ?? null,
        // smartscore v4.7 : Géorisques est branché sur risk-study-v1. Sa
        // couverture voyage avec le score — un pilier bâti sur 4 critères de
        // risque sur 9 ne se commente pas comme un pilier complet.
        georisques: geo
          ? {
              score_securite: geo.score ?? null,
              nb_risques_averes: geo.risks_count ?? null,
              principaux_risques: geo.main_risks ?? [],
              coverage: geo.coverage ?? null,
              criteres_mesures: geo.criteres_mesures ?? null,
              criteres_total: geo.criteres_total ?? null,
            }
          : null,
        bruit_label: noise?.label ?? null,
        bruit_est_une_estimation: noise?.estimated ?? null,
        avertissement:
          "Le DPE de quartier et la qualité de l'air ne sont toujours PAS branchés : ne commente jamais ces deux aspects. "
          + "Le score de bruit est une ESTIMATION (déduite de la desserte, ou forcée en zone peu dense), pas une mesure — dis-le si tu le cites. "
          + "Si `georisques` est null, le volet risques n'a rien mesuré : n'en déduis aucune qualité environnementale. "
          + "Pour un avis détaillé sur les risques, appuie-toi sur l'étude de risques (risk-study), plus complète que ce pilier.",
      };
    }

    // DPE : label + contrainte réglementaire (sans le texte long)
    const dpe = v4.dpe as Record<string, unknown> | undefined;
    if (dpe) {
      const constraint = dpe.constraint as Record<string, unknown> | undefined;
      out.dpe = {
        label: dpe.label ?? null,
        score: dpe.score ?? null,
        is_blocking: constraint?.is_blocking ?? false,
        severity: constraint?.severity ?? 'none',
        title: constraint?.title ?? null,
      };
    }

    // Opportunité prix (décote vs marché) si présente
    const priceOpp = v4.price_opportunity as Record<string, unknown> | undefined;
    if (priceOpp) {
      out.price_opportunity = pick(priceOpp, [
        'prix_m2_bien', 'prix_m2_marche', 'decote_pct', 'score',
      ]);
    }

    // Impact business énergétique (résumé seulement)
    const energy = v4.energy_business_impact as Record<string, unknown> | undefined;
    if (energy && energy.summary) {
      out.energy_impact = pick(energy, ['exploitability_risk', 'summary']);
    }
  } else if (v3) {
    // Fallback V3 (mode standard sans V4)
    out.score = v3.score ?? null;
    out.verdict = v3.verdict ?? null;
    out.composants = v3.components ?? null;
  } else {
    out.note = 'Aucun bloc SmartScore reconnu dans la réponse';
    out.raw_keys = Object.keys(root);
  }

  return out;
}

/** DVF : extrait depuis market_like.dvf / market.dvf de la réponse smartscore. */
function summarizeDvfFromSmartScore(raw: unknown, limit = 10): Record<string, unknown> {
  const root = raw as Record<string, unknown>;
  const marketLike = root?.market_like as Record<string, unknown> | undefined;
  const market = root?.market as Record<string, unknown> | undefined;
  const dvf = (marketLike?.dvf ?? market?.dvf) as Record<string, unknown> | undefined;

  if (!dvf) {
    return { note: 'Pas de bloc DVF dans la réponse', status: 'no_data' };
  }

  const kpis = dvf.kpis as Record<string, unknown> | undefined;
  const comps = (dvf.comps ?? market?.comps) as unknown[] | undefined;

  const out: Record<string, unknown> = {
    coverage: dvf.coverage ?? null,
    source: dvf.source ?? null,
  };

  // Prix : selon le mode, soit dans kpis, soit dans market.prices
  if (kpis) {
    out.prix = pick(kpis, [
      'transactions_count', 'price_median_eur_m2',
      'price_mean_eur_m2', 'price_q1_eur_m2', 'price_q3_eur_m2',
    ]);
  } else if (market?.prices) {
    out.prix = market.prices;
    out.transactions = market.transactions;
  }

  // Comparables : top N, champs essentiels uniquement
  if (Array.isArray(comps) && comps.length > 0) {
    out.count_total = comps.length;
    out.comparables = comps.slice(0, limit).map((c) =>
      pick(c, ['date', 'price_m2', 'surface_m2', 'type_local', 'distance_m', 'commune', 'address'])
    );
  }

  return out;
}

/**
 * DVF (fonction dédiée dvf-comparables-v1) : la réponse est DÉJÀ un résumé compact
 * ({ status, summary, stats, comps }). On la transmet quasi telle quelle au LLM,
 * en mappant le statut métier vers le ToolStatus de l'orchestrateur. Aucune valeur
 * inventée : on distingue données présentes / rayon vide / localisation manquante.
 */
function summarizeDvfDedicated(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse DVF illisible.' };
  }

  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;
  const stats = root.stats ?? null;
  const comps = Array.isArray(root.comps) ? root.comps : [];

  if (status === 'ok' || status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        // empty = true : le rayon/horizon n'a renvoyé aucune transaction.
        empty: status === 'no_data' || comps.length === 0,
        stats: stats
          ? pick(stats, [
              'transactions_count', 'price_median_eur_m2', 'price_mean_eur_m2',
              'price_q1_eur_m2', 'price_q3_eur_m2', 'evolution_pct', 'surface_mean_m2',
            ])
          : null,
        comparables: comps.slice(0, 10).map((c) =>
          pick(c, ['date', 'price_m2', 'surface_m2', 'type_local', 'distance_m', 'commune', 'adresse']),
        ),
      },
    };
  }

  if (status === 'no_localization') {
    return {
      status: 'not_found',
      message: summary ?? "Localisation insuffisante pour interroger le DVF (ni coordonnées ni commune INSEE).",
    };
  }

  // status === 'error' (ou inconnu)
  return { status: 'error', message: summary ?? root.error ?? 'Erreur DVF.' };
}

/** PLU (fonction dédiée, repli) : on ne renvoie JAMAIS le règlement complet. */
function summarizePlu(raw: unknown): Record<string, unknown> {
  // TODO[contrat-plu]: aligner ces clés sur la vraie réponse de COPILOT_FN_PLU.
  const summary = pick(raw, [
    'zone', 'zone_libelle', 'libelle',
    'hauteur_max', 'hauteur_max_m',
    'emprise_max', 'ces', 'coefficient_emprise_sol',
    'recul_voie', 'recul_limites_separatives',
    'stationnement', 'espaces_verts',
  ]);
  const servitudes = (raw as Record<string, unknown>)?.servitudes;
  if (Array.isArray(servitudes)) {
    summary.servitudes = servitudes.slice(0, 8).map((s) =>
      typeof s === 'string' ? s : pick(s, ['code', 'libelle', 'type'])
    );
    if (servitudes.length > 8) summary.servitudes_tronquees = servitudes.length - 8;
  }
  return summary;
}

/**
 * PLU (depuis le contexte parser, ctx.plu) : résumé compact pour le LLM.
 * Lit en priorité le format résolu (plu_ruleset_v1) avec repli générique.
 * N'invente jamais : distingue 3 états d'OAP (présente / absente / non analysée).
 */
function summarizePluContext(plu: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!plu) return { note: 'Aucune donnée PLU dans le contexte.' };

  const out: Record<string, unknown> = {
    zone_code: plu.zone_code ?? null,
    zone_libelle: plu.zone_libelle ?? null,
    source: plu.source ?? 'plu-parser',
  };

  // Règles : format résolu (plu_ruleset_v1) prioritaire, avec repli générique.
  const rs = plu.ruleset as Record<string, any> | undefined;
  if (rs) {
    const hauteur = rs.hauteur ?? {};
    const ces     = rs.ces ?? rs.emprise_sol ?? {};
    const reculs  = rs.reculs ?? {};
    const stat    = rs.stationnement ?? {};
    const pt      = rs.pleine_terre ?? {};
    const cos     = rs.cos ?? rs.densite ?? {};
    out.regles = {
      hauteur_max_m:              hauteur.max_m ?? hauteur.hauteur_max_m ?? hauteur.hauteur_egout_m ?? null,
      hauteur_faitage_m:          hauteur.faitage_m ?? hauteur.hauteur_faitage_m ?? null,
      emprise_sol_max_ratio:      ces.max_ratio ?? ces.emprise_sol_max ?? null,
      recul_voirie_m:             reculs.voirie?.min_m ?? null,
      recul_limites_m:            reculs.limites_separatives?.min_m ?? null,
      stationnement_par_logement: stat.par_logement ?? stat.places_par_logement ?? null,
      pleine_terre_ratio_min:     pt.ratio_min ?? (pt.min_pct != null ? pt.min_pct / 100 : null),
      cos_max:                    cos.max ?? cos.cos_max ?? null,
    };
    if (rs.completeness) out.regles_completeness = rs.completeness;
  } else if (plu.zone_code) {
    out.note_regles = 'Zone connue, mais règlement détaillé non extrait.';
  }

  // OAP : trois états distincts, jamais inventés.
  const oap = plu.oap as Record<string, any> | undefined;
  if (oap && oap.has_oap === true) {
    const constraints = oap.constraints
      ? Object.fromEntries(
          Object.entries(oap.constraints)
            .filter(([, v]) => Array.isArray(v) && (v as unknown[]).length > 0)
            .map(([k, v]) => [k, (v as string[]).slice(0, 6)]),
        )
      : undefined;
    out.oap = {
      has_oap: true,
      name: oap.oap_name ?? null,
      type: oap.oap_type ?? null,
      summary: oap.summary ?? null,
      constraints,
      promoter_impacts: Array.isArray(oap.promoter_impacts) ? oap.promoter_impacts.slice(0, 8) : undefined,
      permit_risks: Array.isArray(oap.permit_risks) ? oap.permit_risks.slice(0, 8) : undefined,
      source_document: oap.source_document ?? null,
    };
  } else if (oap) {
    out.oap = {
      has_oap: false,
      applicability_status: oap.oap_applicability_status ?? 'not_found_in_analyzed_documents',
      note: "Aucune OAP exploitable dans le règlement analysé (peut exister dans une pièce séparée du dossier PLU).",
    };
  } else {
    out.oap = { analysee: false, note: "L'OAP n'a pas encore été analysée pour cette parcelle." };
  }

  return out;
}

/**
 * Géorisques (risk-study v1.x) : résumé compact aligné sur le contrat réel.
 * ⚠️ CONVENTION DE SCORE : 100 = zone sûre, 0 = risque maximal (score de SÉCURITÉ).
 *    On l'annonce explicitement au LLM pour éviter toute inversion d'interprétation.
 *    Le champ "level"/"niveau_risque" reste un niveau de RISQUE (fort = mauvais).
 */
function summarizeRisks(raw: unknown): Record<string, unknown> {
  const root = raw as Record<string, any>;
  if (!root || root.success === false) {
    return { note: 'Réponse Géorisques vide ou en erreur', error: root?.error ?? null };
  }

  const meta = root.meta ?? {};
  const scores = root.scores ?? {};
  const data = root.data ?? {};
  const categories = Array.isArray(root.categories) ? root.categories : [];
  const insights = Array.isArray(root.insights) ? root.insights : [];

  const out: Record<string, unknown> = {
    // Rappel impératif de la convention, sinon le LLM inverse le sens.
    convention_score: "Score de SÉCURITÉ : 100 = zone très sûre, 0 = risque maximal. Un score élevé est BON.",
    commune_nom: meta.commune_nom ?? null,
    commune_insee: meta.commune_insee ?? null,
    departement: meta.departement ?? null,
    scores_securite: {
      global:         scores.global ?? null,
      naturels:       scores.naturels ?? null,
      technologiques: scores.technologiques ?? null,
      pollution:      scores.pollution ?? null,
      geotechniques:  scores.geotechniques ?? null,
    },
    // risk-study v1.1.0 — indicateur de confiance. Un score de sécurité null
    // signifie NON MESURÉ, jamais « sûr » ni « risqué ».
    confiance: {
      criteres_mesures: scores.criteres_mesures ?? null,
      criteres_total: scores.criteres_total ?? null,
      coverage: scores.coverage ?? null,
      categories_non_mesurees: Array.isArray(scores.categories_non_mesurees) ? scores.categories_non_mesurees : [],
      poids_effectifs: scores.poids_effectifs ?? null,
    },
  };

  // Niveau de RISQUE par catégorie (level = niveau de risque, pas de sécurité).
  if (categories.length > 0) {
    out.categories = categories.map((c: any) => ({
      nom: c.name ?? null,
      score_securite: c.score ?? null,
      niveau_risque: c.level ?? null,
      coverage: c.coverage ?? null,
      criteres_mesures: c.criteres_mesures ?? null,
      criteres_total: c.criteres_total ?? null,
    }));
  }

  // Faits saillants par risque (compteurs/booléens, pas les tableaux bruts).
  out.faits = {
    inondation: {
      zone_inondable: data.inondation?.zone_inondable ?? null,
      ppri: data.inondation?.ppri ?? null,
      niveau_risque: data.inondation?.risk_level ?? null,
    },
    seisme: {
      zone: data.seisme?.zone ?? null,
      libelle: data.seisme?.libelle ?? null,
      niveau_risque: data.seisme?.risk_level ?? null,
    },
    argiles: {
      niveau_alea: data.argiles?.niveau_alea ?? null,
      niveau_risque: data.argiles?.risk_level ?? null,
    },
    radon: {
      classe: data.radon?.classe_potentiel ?? null,
      libelle: data.radon?.libelle ?? null,
      niveau_risque: data.radon?.risk_level ?? null,
    },
    icpe_seveso: {
      total: data.icpe?.count ?? null,
      tronque: data.icpe?.truncated ?? false,
      coverage: data.icpe?.coverage ?? null,
      seveso_haut: data.icpe?.seveso_haut_count ?? null,
      seveso_bas: data.icpe?.seveso_bas_count ?? null,
      niveau_risque: data.icpe?.risk_level ?? null,
    },
    sites_pollues_sis: {
      count: data.sis?.count ?? null,
      tronque: data.sis?.truncated ?? false,
      coverage: data.sis?.coverage ?? null,
      niveau_risque: data.sis?.risk_level ?? null,
    },
    cavites: {
      count: data.cavites?.count ?? null,
      tronque: data.cavites?.truncated ?? false,
      coverage: data.cavites?.coverage ?? null,
      niveau_risque: data.cavites?.risk_level ?? null,
    },
    mouvements_terrain: {
      count: data.mouvements_terrain?.count ?? null,
      tronque: data.mouvements_terrain?.truncated ?? false,
      coverage: data.mouvements_terrain?.coverage ?? null,
      niveau_risque: data.mouvements_terrain?.risk_level ?? null,
    },
    feux_foret: {
      zone_risque: data.feux_foret?.zone_risque ?? null,
      obligation_debroussaillement: data.feux_foret?.obligation_debroussaillement ?? null,
      niveau_risque: data.feux_foret?.risk_level ?? null,
    },
    catnat_count: data.gaspar?.catnat_count ?? null,
    catnat_tronque: data.gaspar?.catnat_truncated ?? false,
    ppr_count: data.gaspar?.ppr_count ?? null,
    ppr_tronque: data.gaspar?.ppr_truncated ?? false,
    gaspar_coverage: data.gaspar?.coverage ?? null,
  };

  // Les insights sont déjà des phrases synthétiques rédigées : on les garde (limités).
  if (insights.length > 0) {
    out.insights = insights.slice(0, 12).map((i: any) => ({
      type: i.type ?? null,
      categorie: i.category ?? null,
      message: i.message ?? null,
    }));
  }

  return out;
}
/**
 * DPE ADEME (dpe-ademe-v1) : la réponse est DÉJÀ un résumé compact
 * ({ status, summary, stats, items }). On mappe le statut métier vers le
 * ToolStatus de l'orchestrateur. Aucune classe inventée : on distingue
 * données présentes / rien trouvé / localisation manquante.
 */
function summarizeDpeDedicated(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse DPE illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok' || status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        empty: status === 'no_data',
        stats: root.stats
          ? pick(root.stats, [
              'total', 'distribution_dpe', 'distribution_ges',
              'pire_classe_dpe', 'nb_passoires_fg', 'plus_recent',
            ])
          : null,
        echantillon: Array.isArray(root.items) ? root.items.slice(0, 10) : [],
        avertissement: "Base ADEME non exhaustive : l'absence de DPE ne prouve pas l'absence de diagnostic.",
      },
    };
  }
  if (status === 'no_localization') {
    return {
      status: 'not_found',
      message: summary ?? "Localisation insuffisante pour interroger la base DPE.",
    };
  }
  return { status: 'error', message: summary ?? root.error ?? 'Erreur DPE.' };
}

/**
 * Mérimée (patrimoine-merimee-v1) : réponse déjà compacte
 * ({ status, summary, stats, items }). On mappe le statut métier.
 * Le champ stats.dans_perimetre_abf_500m est l'info à impact : projet en
 * périmètre d'abords → avis ABF obligatoire.
 */
function summarizeMerimeeDedicated(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse Mérimée illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok' || status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        empty: status === 'no_data',
        stats: root.stats
          ? pick(root.stats, [
              'total', 'nb_classes', 'nb_inscrits',
              'distance_plus_proche_m', 'dans_perimetre_abf_500m',
            ])
          : null,
        monuments: Array.isArray(root.items) ? root.items.slice(0, 8) : [],
      },
    };
  }
  if (status === 'no_localization') {
    return {
      status: 'not_found',
      message: summary ?? "Localisation insuffisante pour interroger Mérimée.",
    };
  }
  return { status: 'error', message: summary ?? root.error ?? 'Erreur Mérimée.' };
}

/**
 * BDNB (batiment-bdnb-v1) : réponse déjà compacte { status, summary, stats, items }.
 * Beaucoup de champs BDNB sont null (non renseignés) : on transmet tel quel,
 * le LLM sait dire "non renseigné" sans inventer.
 */
function summarizeBdnbDedicated(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse BDNB illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok' || status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        empty: status === 'no_data',
        batiment_principal: Array.isArray(root.items) && root.items[0] ? root.items[0] : null,
        autres_batiments: Array.isArray(root.items) ? root.items.slice(1, 5) : [],
        source: 'BDNB - CSTB',
      },
    };
  }
  if (status === 'no_localization') {
    return { status: 'not_found', message: summary ?? "Localisation insuffisante pour la BDNB." };
  }
  return { status: 'error', message: summary ?? root.error ?? 'Erreur BDNB.' };
}

/**
 * Loyers de référence (loyers-reference-v1) : réponse déjà compacte
 * ({ status, summary, stats, items }). On mappe le statut métier vers le
 * ToolStatus. PLM : stats.is_plm=true → fourchette min/médiane/max entre
 * arrondissements. Aucune valeur inventée.
 */
function summarizeLoyersDedicated(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse Loyers illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok' || status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        empty: status === 'no_data',
        stats: root.stats ?? null,
        // Détail par arrondissement uniquement en cas PLM (Paris/Lyon/Marseille).
        arrondissements: root.stats?.is_plm && Array.isArray(root.items)
          ? root.items.slice(0, 20)
          : undefined,
        source: 'Carte des loyers ANIL/DHUP',
      },
    };
  }
  if (status === 'no_localization') {
    return {
      status: 'not_found',
      message: summary ?? "Localisation insuffisante pour interroger les loyers de référence.",
    };
  }
  return { status: 'error', message: summary ?? root.error ?? 'Erreur Loyers de référence.' };
}

/**
 * Servitudes d'utilité publique (servitudes-gpu-v1) : réponse déjà compacte
 * ({ status, summary, stats, items }). On mappe le statut métier vers le
 * ToolStatus et on transmet l'avertissement de non-exhaustivité du GPU
 * (une absence de résultat ne prouve pas l'absence de servitude).
 */
function summarizeServitudesDedicated(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse Servitudes illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok' || status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        empty: status === 'no_data',
        stats: root.stats ?? null,
        servitudes: Array.isArray(root.items) ? root.items.slice(0, 30) : [],
        source: "Géoportail de l'Urbanisme via API Carto IGN",
      },
    };
  }
  if (status === 'no_localization') {
    return {
      status: 'not_found',
      message: summary ?? "Coordonnées précises requises pour interroger les servitudes.",
    };
  }
  return { status: 'error', message: summary ?? root.error ?? 'Erreur Servitudes.' };
}

/**
 * Potentiel solaire (potentiel-solaire-v1, PVGIS) : réponse déjà compacte
 * ({ status, summary, stats, items }). Production SPÉCIFIQUE (par kWc) : le LLM
 * ne doit pas la présenter comme une production absolue sans puissance installée.
 */
function summarizePotentielSolaireDedicated(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse Potentiel solaire illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok' || status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        empty: status === 'no_data',
        stats: root.stats ?? null,
        production_mensuelle: Array.isArray(root.items) ? root.items : [],
        source: 'PVGIS (JRC, Commission européenne)',
      },
    };
  }
  if (status === 'no_localization') {
    return {
      status: 'not_found',
      message: summary ?? "Coordonnées requises pour estimer le potentiel solaire.",
    };
  }
  return { status: 'error', message: summary ?? root.error ?? 'Erreur Potentiel solaire.' };
}

/**
 * Zonage ABC (zonage-abc-v1) : réponse déjà compacte { status, summary, stats, items }.
 * On mappe le statut métier et on transmet la mise au point Pinel (dispositif clos
 * depuis le 31/12/2024) : le LLM ne doit pas présenter la zone comme ouvrant droit au Pinel.
 */
function summarizeZonageDedicated(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse Zonage ABC illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok' || status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        empty: status === 'no_data',
        stats: root.stats ?? null,
        source: 'Zonage ABC (DHUP / data.gouv)',
      },
    };
  }
  if (status === 'no_localization') {
    return {
      status: 'not_found',
      message: summary ?? "Localisation insuffisante pour déterminer le zonage ABC.",
    };
  }
  // APRÈS
  return { status: 'error', message: summary ?? root.error ?? 'Erreur Zonage ABC.' };
}

/**
 * Taxes locales (taxes-locales-v1) : réponse déjà compacte { status, summary, stats, items }.
 * On mappe le statut et on transmet les notes métier : TH résidence principale supprimée
 * (avec des régimes distincts pour résidences secondaires et logements vacants), majoration THRS
 * possible dans son propre champ. Le LLM ne doit ni présenter la TH comme due sur une résidence
 * principale, ni étendre la majoration THRS aux logements vacants.
 */
function summarizeTaxesDedicated(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse Taxes locales illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok' || status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        empty: status === 'no_data',
        stats: root.stats ?? null,
        source: 'DGFiP — Fiscalité locale des particuliers',
      },
    };
  }
  if (status === 'no_localization') {
    return {
      status: 'not_found',
      message: summary ?? "Localisation insuffisante pour interroger les taxes locales.",
    };
  }
  return { status: 'error', message: summary ?? root.error ?? 'Erreur Taxes locales.' };
}

/**
 * PPR détaillés (ppr-detail-v1) : réponse déjà compacte { status, summary, stats, items }.
 * Détail par PPR (nom, risque, statut approuvé/prescrit, dates) + test parcelle-dans-périmètre
 * si coordonnées. ⚠️ Ne fournit PAS le zonage rouge/bleue : le LLM ne doit jamais l'inventer,
 * et renvoie au règlement du PPR pour la zone précise.
 */
function summarizePprDedicated(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse PPR illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok' || status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        empty: status === 'no_data',
        stats: root.stats ?? null,
        ppr: Array.isArray(root.items) ? root.items.slice(0, 20) : [],
        source: 'Géorisques — BD GASPAR',
      },
    };
  }
  if (status === 'no_localization') {
    return {
      status: 'not_found',
      message: summary ?? "Code INSEE (ou commune) requis pour lister les PPR.",
    };
  }
  return { status: 'error', message: summary ?? root.error ?? 'Erreur PPR.' };
}

/**
 * Assainissement (assainissement-commune-v1) : réponse compacte { status, summary, stats, items }.
 * Donnée au niveau COMMUNE (collectif/ANC + opérateur). Le LLM ne doit JAMAIS affirmer le régime
 * d'une parcelle précise depuis cette seule donnée : renvoyer au zonage d'assainissement communal.
 */
function summarizeAssainissementDedicated(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse Assainissement illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok' || status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        empty: status === 'no_data',
        stats: root.stats ?? null,
        source: 'SISPEA (services.eaufrance.fr)',
      },
    };
  }
  if (status === 'no_localization') {
    return {
      status: 'not_found',
      message: summary ?? "Localisation insuffisante pour l'assainissement.",
    };
  }
  return { status: 'error', message: summary ?? root.error ?? 'Erreur Assainissement.' };
}

/**
 * Altimétrie & pente (altimetrie-v1) : réponse compacte { status, summary, stats, items }.
 * Pente ESTIMÉE (échantillonnage RGE Alti), à confirmer par relevé topo pour un projet.
 * Si stats.precision = 'centre_commune', valeurs indicatives : le LLM doit le signaler.
 */
function summarizeAltimetrieDedicated(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse Altimétrie illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok' || status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        empty: status === 'no_data',
        stats: root.stats ?? null,
        source: 'IGN — RGE Alti (Géoplateforme)',
      },
    };
  }
  if (status === 'no_localization') {
    return {
      status: 'not_found',
      message: summary ?? "Coordonnées ou commune requises pour l'altimétrie.",
    };
  }
  return { status: 'error', message: summary ?? root.error ?? 'Erreur Altimétrie.' };
}

/**
 * Classement sonore des voies (bruit-classement-v1) : réponse compacte
 * { status, summary, stats, items }. Classement RÉGLEMENTAIRE (pas des dB
 * mesurés) et GPU non-exhaustif → avertissement transmis au LLM.
 */
function summarizeBruitDedicated(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse Classement sonore illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok' || status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        empty: status === 'no_data',
        stats: root.stats ?? null,
        secteurs: Array.isArray(root.items) ? root.items.slice(0, 15) : [],
        avertissement:
          "Classement RÉGLEMENTAIRE (pas des dB mesurés). Le GPU n'est pas exhaustif : une absence ne prouve pas l'absence de secteur bruit.",
        source: "Classement sonore des voies — Géoportail de l'Urbanisme via API Carto IGN",
      },
    };
  }
  if (status === 'no_localization') {
    return { status: 'not_found', message: summary ?? "Coordonnées ou identifiant cadastral requis pour le classement sonore." };
  }
  return { status: 'error', message: summary ?? root.error ?? 'Erreur Classement sonore.' };
}

/**
 * Étude complète de parcelle (etude-parcelle-v1) : bundle multi-sources collecté
 * en parallèle. Le LLM reçoit le résumé de chaque source ET la liste explicite
 * des sources indisponibles → il doit signaler les trous, jamais les combler.
 */
function summarizeEtudeParcelle(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse Étude de parcelle illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok' || status === 'no_data') {
    const items = Array.isArray(root.items) ? root.items : [];
    return {
      status: 'ok',
      data: {
        summary,
        ancrage: root.stats?.ancrage ?? null,
        portees: root.stats?.portees ?? null,
        interdictions_de_conclusion: root.stats?.interdictions_de_conclusion ?? [],
        interdictions_analyse: root.stats?.interdictions_analyse ?? [],
        precision: root.stats?.precision ?? null,
        parcelle: root.stats?.parcelle ?? null,
        avertissements: root.stats?.avertissements ?? [],
        sources_indisponibles: root.stats?.sources_indisponibles ?? [],
        evidences: root.stats?.evidences ?? [],
        verdict: root.stats?.verdict ?? null,
        plan_action: root.stats?.plan_action ?? [],
        donnees: items.map((i: any) => ({
          domaine: i.label ?? i.cle,
          statut: i.status,
          resume: i.summary ?? null,
          chiffres: i.stats ?? null,
          portee: i.portee ?? null,
          organisme: i.organisme ?? null,
          jeu_de_donnees: i.jeu_de_donnees ?? null,
          millesime: i.millesime ?? null,
          motif_indisponibilite: i.motif ?? undefined,
        })),
      },
    };
  }
  if (status === 'no_localization') {
    return { status: 'not_found', message: summary ?? "Identifiant cadastral, coordonnées ou commune requis pour lancer l'étude." };
  }
  return { status: 'error', message: summary ?? 'Erreur Étude de parcelle.' };
}

/**
 * Étude de marché (market-study-investisseur-v1) : contrat { success, meta,
 * core:{dvf,insee,transport,bpe}, scores, scoring_details, insights }.
 * On ne transmet JAMAIS core.dvf.transactions ni les details[] des rubriques
 * BPE : plusieurs Ko inutiles. Scores 0-100, un score élevé est POSITIF.
 */
function summarizeMarketStudy(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const r = raw as Record<string, any>;
  if (!r || typeof r !== 'object') return { status: 'error', message: 'Réponse Étude de marché illisible.' };
  if (r.success !== true) return { status: 'error', message: r.error ?? 'Étude de marché en erreur.' };

  const c = r.core ?? {};
  const dvf = c.dvf ?? null;
  const insee = c.insee ?? null;
  const tr = c.transport ?? null;
  const bpe = c.bpe ?? null;

  return {
    status: 'ok',
    data: {
      convention_scores: 'Scores sur 100 : un score élevé est POSITIF.',
      commune: pick(r.meta ?? {}, ['commune_nom', 'commune_insee', 'departement', 'project_type_label', 'radius_km', 'generated_at']),
      // market-study v1.4.4 — Périmètre réel de CHAQUE source. `radius_km` seul
      // se lisait comme le rayon de toute l'étude, d'où des phrases telles que
      // « scores calculés sur un rayon de 5 km » alors que demande, offre et
      // environnement sont tous communaux.
      perimetres: (r.meta as Record<string, unknown> | undefined)?.perimetres ?? null,
      scores: r.scores ?? null,
      // market-study v1.4.3 — Le pilier nommé « environnement » mesure en
      // réalité les ÉQUIPEMENTS (score BPE + bonus d'équipement). Sans cette
      // précision, un 80/100 se lisait comme « cadre de vie favorable », ce qui
      // n'est pas ce qui a été mesuré.
      lexique_scores: {
        environnement: "ÉQUIPEMENTS ET SERVICES (score BPE + bonus). Ne dit RIEN du cadre de vie, du paysage, du bruit ni des risques — ne l'interprète jamais ainsi. Pour les risques, utilise l'étude de risques ; pour le cadre, aucune donnée n'est disponible ici.",
        demande: "Pression démographique et socio-économique locale.",
        offre: "Liquidité et niveau de prix du marché local (DVF).",
        accessibilite: "Desserte en transports en commun. Écarté du score quand il n'a pas été mesuré.",
      },
      explication_scores: r.scoring_details?.explanation ?? null,
      // market-study v1.4.0 : le DVF est désormais filtré sur la COMMUNE, plus
      // sur un rayon. `meta.radius_km` ne s'applique donc PLUS à ce bloc — il ne
      // concerne que BPE et transport. Sans ce garde-fou, le modèle réutilisait
      // « rayon 5 km » pour un chiffre communal.
      marche_dvf: dvf ? {
        ...pick(dvf, ['nb_transactions', 'prix_m2_median', 'prix_m2_moyen', 'prix_m2_min', 'prix_m2_max', 'evolution_prix_pct', 'coverage']),
        perimetre: dvf.perimetre ?? null,
        perimetre_label: dvf.perimetre_label ?? null,
        nb_transactions_plafonne: dvf.nb_transactions_plafonne ?? false,
        avertissement_perimetre:
          "Ce bloc DVF est filtré sur le PÉRIMÈTRE indiqué ci-dessus (commune, ou département en repli) — PAS sur meta.radius_km. "
          + "N'écris jamais « rayon X km » pour ces chiffres : cite le périmètre réel. "
          + "Si perimetre = 'departement', dis explicitement qu'aucune médiane communale n'était calculable et que le chiffre est départemental. "
          + "Si nb_transactions_plafonne est vrai, écris « au moins N », jamais « N ». "
          + "Les bornes min/max sont écrêtées à 500 et 25 000 €/m² par le filtrage : ne présente pas la fourchette comme l'amplitude réelle du marché.",
      } : null,
      // market-study « correctif B » : les onze parts démographiques ne sont
      // alimentées par AUCUNE requête communale — elles sortaient d'une table
      // de 13 départements et de formules de densité, et valent désormais null.
      // Le chômage suit la même règle : `taux_chomage` = mesure ou null,
      // `taux_chomage_estime` = repli départemental. On relaie les deux
      // séparément, plus la provenance champ par champ, pour que le modèle ne
      // puisse pas confondre un relevé et un modèle.
      demographie_insee: insee ? {
        ...pick(insee, [
          'population', 'densite', 'revenu_median', 'revenu_median_source',
          'taux_chomage', 'taux_chomage_estime', 'taux_chomage_source',
          'taux_pauvrete', 'pct_logements_vacants', 'pct_locataires',
          'pct_75_plus', 'pct_etudiants', 'revenu_source', 'coverage',
        ]),
        demographie_estimee: insee.demographie_estimee ?? null,
        qualite_par_champ: insee.insee_data_quality ?? null,
        avertissement_insee:
          "Un champ nu porte une MESURE ou null ; toute estimation vit dans un champ dédié (`_estime`, `demographie_estimee`) "
          + "et sa provenance dans `qualite_par_champ` — seule la valeur 'mesure' autorise à présenter le chiffre comme un relevé. "
          + "Les parts démographiques (tranches d'âge, étudiants, actifs, propriétaires, locataires, logements vacants) ne sont "
          + "PAS mesurées à la commune : elles valent null et seul `demographie_estimee` en donne une estimation départementale. "
          + "Ne les cite jamais comme des relevés INSEE de la commune, n'en tire aucun constat de terrain, et si tu les emploies, "
          + "écris explicitement qu'il s'agit d'une estimation départementale. "
          + "Si taux_chomage est null et taux_chomage_source = 'dept_fallback', le chiffre est celui du département, pas de la commune.",
      } : null,
      transport: tr ? {
        ...pick(tr, ['score', 'nearest_stop_m', 'has_metro_train', 'has_tram', 'is_urban', 'coverage']),
        // v1.4.0 : l'urbanité vient de la grille de densité INSEE quand
        // is_urban_source = 'insee'. Interdiction d'écrire « commune rurale »
        // sur la seule base de la densité ou de la population.
        is_urban_source: tr.is_urban_source ?? null,
        is_urban_label: tr.is_urban_label ?? null,
        avertissement_urbanite:
          "N'écris « commune rurale » QUE si is_urban est false. Si is_urban_source = 'insee', is_urban_label est la catégorie officielle "
          + "de la grille de densité INSEE (ex. « Ceintures urbaines ») : cite-la telle quelle. Une faible densité ou une faible population "
          + "ne suffisent PAS à qualifier une commune de rurale. Un score de transport absent signale une desserte non mesurée, pas une absence de desserte.",
        arrets_proches: Array.isArray(tr.stops) ? tr.stops.slice(0, 5) : [],
      } : null,
      // market-study v1.4.2 : `bpe_quality` porte le périmètre réel (la COMMUNE,
      // filtre depcom — jamais un rayon) et la fiabilité des zéros. Sans ce
      // relais, le modèle écrivait « 0 pharmacie dans le rayon de 5 km » là où
      // l'extrait BPE ne compte que 18 lignes et ne contient simplement aucun
      // code D301 : une lacune de source présentée comme un constat de terrain.
      equipements_bpe: bpe ? {
        ...pick(bpe, ['total_equipements', 'score', 'nb_ecoles', 'nb_pharmacies', 'nb_supermarches', 'nb_universites', 'coverage']),
        qualite: bpe.bpe_quality ?? null,
      } : null,
      constats: Array.isArray(r.insights) ? r.insights.slice(0, 10).map((i: any) => ({ type: i.type, categorie: i.category, message: i.message })) : [],
      avertissements: r.warnings ?? [],
      source: 'market-study Mimmoza (DVF, INSEE, BPE, Overpass)',
    },
  };
}

/**
 * Coûts de construction (couts-construction-v1) : { status, summary, stats }.
 * On relaie la décomposition du calcul telle quelle — c'est elle qui permet au
 * LLM d'EXPLIQUER le montant sans le recalculer. Le statut 'no_data' n'est PAS
 * une erreur : il signale une typologie hors barème (EHPAD, clinique…), et
 * cette information doit remonter à l'utilisateur telle quelle.
 */
function summarizeCoutsConstruction(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse Coûts de construction illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok') {
    return {
      status: 'ok',
      data: {
        summary,
        stats: root.stats ?? null,
        source: 'barème Mimmoza (hypothèse) indexé sur BT01 INSEE',
      },
    };
  }
  if (status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        empty: true,
        stats: root.stats ?? null,
        consigne:
          "Le barème ne couvre pas cette demande. Dis-le explicitement, n'approxime avec " +
          "aucune autre typologie, et renvoie vers un économiste de la construction.",
      },
    };
  }
  return { status: 'error', message: summary ?? root.error ?? 'Erreur Coûts de construction.' };
}

/**
 * Coûts de rénovation (couts-renovation-v1) : { status, summary, stats, source }.
 * Calcul DÉTERMINISTE côté fonction — on relaie la décomposition telle quelle,
 * le LLM restitue sans recalculer. 'no_data' n'est PAS une erreur : rien de
 * chiffrable (aucun poste reconnu ni niveau_global+surface) — info à remonter.
 */
function summarizeCoutsRenovation(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse Coûts de rénovation illisible.' };
  }
  const status = String(root.status ?? '');
  const summary = typeof root.summary === 'string' ? root.summary : null;

  if (status === 'ok') {
    return {
      status: 'ok',
      data: {
        summary,
        stats: root.stats ?? null,
        source: root.source ?? 'barème rénovation Mimmoza',
      },
    };
  }
  if (status === 'no_data') {
    return {
      status: 'ok',
      data: {
        summary,
        empty: true,
        stats: root.stats ?? null,
        consigne:
          "Aucun poste chiffrable au barème. Déduis les postes à reprendre (avec " +
          "quantités) depuis les photos, ou fournis un niveau_global + surface_habitable_m2, " +
          "puis rappelle l'outil. N'invente aucun montant.",
      },
    };
  }
  return { status: 'error', message: summary ?? root.error ?? 'Erreur Coûts de rénovation.' };
}

/**
 * Sitadel (sitadel-commune-v1) : dynamique de construction à la maille COMMUNE
 * { status, summary, stats }. no_data = commune peu couverte / pas de permis sur
 * la période (PAS une erreur). Maille commune uniquement : pas de projet voisin
 * géolocalisé à la parcelle — le LLM ne doit pas le laisser croire.
 */
function summarizeSitadel(
  raw: unknown,
  meta?: { rayonKm?: number; periodMonths?: number; precision?: 'parcelle' | 'centre_commune' },
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse Sitadel illisible.' };
  }

  const items = Array.isArray(root.items) ? (root.items as Record<string, any>[]) : null;
  if (!items) {
    return { status: 'error', message: "Format Sitadel inattendu (champ 'items' manquant)." };
  }

  const total = typeof root.total === 'number' ? root.total : items.length;

  // Agrégats par type + logements.
  const parType: Record<string, number> = { PC: 0, PA: 0, PD: 0, DP: 0 };
  let logementsTotal = 0;
  let plusGros = 0;
  for (const it of items) {
    const t = String(it.typeAutorisation ?? '').toUpperCase();
    if (t in parType) parType[t]++;
    const n = typeof it.nombreLogements === 'number' ? it.nombreLogements : 0;
    logementsTotal += n;
    if (n > plusGros) plusGros = n;
  }

  const compact = (it: Record<string, any>) => ({
    date: it.dateDepot ? String(it.dateDepot).slice(0, 10) : null,
    distance_km: typeof it.distanceKm === 'number' ? Math.round(it.distanceKm * 100) / 100 : null,
    type: it.typeAutorisation ?? null,
    nature: it.natureProjet ?? null,
    logements: it.nombreLogements ?? null,
    surface_m2: it.surface ?? null,
    commune: it.commune ?? null,
    adresse: it.adresse ?? null,
  });

  const parDate = [...items].sort((a, b) =>
    String(b.dateDepot ?? '').localeCompare(String(a.dateDepot ?? '')));
  const parDistance = [...items].sort((a, b) =>
    (typeof a.distanceKm === 'number' ? a.distanceKm : 1e9) -
    (typeof b.distanceKm === 'number' ? b.distanceKm : 1e9));

  const notices = Array.isArray(root.notices) ? root.notices.slice(0, 4) : [];

  const analyses = items.length;
  const tronque = total > analyses;

  return {
    status: 'ok',
    data: {
      empty: analyses === 0,
      // total_dans_rayon = tous les permis du rayon ; analyses = ceux réellement
      // agrégés ci-dessous (plafonné par limit). Les deux DIFFÈRENT si tronqué.
      total_dans_rayon: total,
      analyses,
      affichage_tronque: tronque,
      rayon_km: meta?.rayonKm ?? null,
      periode_mois: meta?.periodMonths ?? null,
      precision: meta?.precision ?? null,
      // ⚠️ ces agrégats portent sur les {analyses} permis analysés, PAS sur total_dans_rayon.
      par_type_sur_analyses: parType,
      logements_crees_sur_analyses: logementsTotal,
      plus_gros_projet_logements: plusGros,
      plus_recents: parDate.slice(0, 5).map(compact),
      plus_proches: parDistance.slice(0, 5).map(compact),
      notices,
      source: 'Sit@del2 / data.gouv (via Koumoul Data Fair)',
      note_comptage: tronque
        ? `${total} permis dans le rayon, dont seuls les ${analyses} plus récents sont agrégés ici (répartition par type, logements, top listes). NE présente PAS cette répartition comme couvrant les ${total}.`
        : `${analyses} permis dans le rayon, tous agrégés.`,
      avertissement:
        "Permis géolocalisés à la date de dépôt en mairie ; les tout derniers mois peuvent être incomplets. " +
        (meta?.precision === 'centre_commune'
          ? "Recherche centrée sur le centre de la commune (aucune parcelle localisée) : le rayon peut couvrir plusieurs communes."
          : "Recherche centrée sur la parcelle : les permis listés sont ceux du voisinage réel dans le rayon."),
    },
  };
}

/**
 * SIRENE / RNE (etablissements-sirene-v1) : la réponse est DÉJÀ un résumé
 * compact ({ status, summary, stats, items }). On mappe le statut métier vers
 * le ToolStatus de l'orchestrateur, sans rien recalculer ni inventer.
 */
function summarizeSirene(
  raw: unknown,
  meta?: { rayonKm?: number; precision?: 'parcelle' | 'centre_commune' },
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse SIRENE illisible.' };
  }

  const st = String(root.status ?? '');
  if (st === 'error') {
    return { status: 'error', message: str(root.summary) ?? 'Erreur SIRENE.' };
  }
  if (st === 'no_localization') {
    return {
      status: 'not_found',
      message: str(root.summary) ?? "Aucune localisation exploitable pour interroger SIRENE.",
    };
  }

  const stats = (root.stats ?? {}) as Record<string, any>;
  const items = Array.isArray(root.items) ? (root.items as Record<string, any>[]) : [];

  return {
    status: 'ok',
    data: {
      empty: st === 'no_data' || items.length === 0,
      summary: str(root.summary) ?? null,
      total_dans_rayon: stats.total_dans_rayon ?? null,
      analyses: stats.analyses ?? items.length,
      affichage_tronque: stats.affichage_tronque ?? null,
      rayon_km: stats.rayon_km ?? meta?.rayonKm ?? null,
      precision: meta?.precision ?? null,
      par_section_naf: stats.par_section ?? null,
      creations_recentes_12m: stats.creations_recentes_12m ?? null,
      etablissements_proches: items.slice(0, 15),
      source: str(root.source) ?? 'API Recherche d\'entreprises (DINUM) — Sirene + RNE',
      avertissement:
        (str(root.avertissement) ?? '') +
        " SIRENE recense des établissements IMMATRICULÉS : ce n'est ni un permis, ni un projet futur, " +
        "et le code NAF ne préjuge pas de l'usage réel du local. " +
        (meta?.precision === 'centre_commune'
          ? "Recherche centrée sur le centre de la commune (aucune parcelle localisée) : les distances sont relatives à ce centre."
          : "Recherche centrée sur la parcelle : les distances sont celles du voisinage réel."),
    },
  };
}


/**
 * BPE (bpe-proxy) : contrat legacy { success, items[], count }. On agrège par
 * catégorie et on isole l'équipement le PLUS PROCHE de chaque catégorie —
 * c'est ce qui répond à « y a-t-il une école / un médecin / une supérette ? ».
 */
function summarizeBpe(
  raw: unknown,
  meta?: { rayonM?: number; precision?: 'parcelle' | 'centre_commune' },
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse BPE illisible.' };
  }
  if (root.success === false) {
    // bpe-proxy dépend d'une API externe (OpenDataSoft) qui tombe par
    // intermittence (échec DNS constaté le 04/08). On remonte l'échec tel quel :
    // surtout ne pas laisser croire qu'il n'y a aucun équipement.
    return {
      status: 'error',
      message: "Le service Équipements (BPE) n'a pas répondu : " +
        (str(root.details) ?? str(root.error) ?? 'erreur inconnue') +
        ". Ne conclus PAS à une absence d'équipement, dis que la donnée est momentanément indisponible.",
    };
  }

  const items = Array.isArray(root.items) ? (root.items as Record<string, any>[]) : [];
  if (items.length === 0) {
    return {
      status: 'ok',
      data: {
        empty: true,
        rayon_m: meta?.rayonM ?? null,
        precision: meta?.precision ?? null,
        source: 'Base Permanente des Équipements (INSEE) via OpenDataSoft',
      },
    };
  }

  const parCategorie: Record<string, number> = {};
  const plusProcheParCategorie: Record<string, unknown> = {};
  for (const it of items) {
    const cat = str(it.category) ?? 'Non catégorisé';
    parCategorie[cat] = (parCategorie[cat] ?? 0) + 1;
    const d = typeof it.distance_m === 'number' ? it.distance_m : null;
    const prev = plusProcheParCategorie[cat] as Record<string, any> | undefined;
    if (d !== null && (!prev || d < (prev.distance_m ?? 1e12))) {
      plusProcheParCategorie[cat] = {
        nom: str(it.nom),
        type_code: str(it.type_code),
        commune: str(it.commune),
        distance_m: d,
      };
    }
  }

  const proches = [...items]
    .filter((it) => typeof it.distance_m === 'number')
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 15)
    .map((it) => ({
      nom: str(it.nom),
      categorie: str(it.category),
      type_code: str(it.type_code),
      commune: str(it.commune),
      distance_m: it.distance_m,
    }));

  return {
    status: 'ok',
    data: {
      empty: false,
      total_dans_rayon: typeof root.count === 'number' ? root.count : items.length,
      rayon_m: meta?.rayonM ?? null,
      precision: meta?.precision ?? null,
      par_categorie: parCategorie,
      plus_proche_par_categorie: plusProcheParCategorie,
      equipements_les_plus_proches: proches,
      source: 'Base Permanente des Équipements (INSEE) via OpenDataSoft',
      avertissement:
        "La BPE est un inventaire annuel : une ouverture ou une fermeture récente peut ne pas y figurer. " +
        "Les distances sont à vol d'oiseau depuis le point de recherche, pas des temps de trajet." +
        (meta?.precision === 'centre_commune'
          ? " Recherche centrée sur le centre de la commune (aucune parcelle localisée) : les distances sont relatives à ce centre."
          : ''),
    },
  };
}

/**
 * SRU / logement social (besoin-logements-sociaux) : objet PLAT métier, pas de
 * contrat compact. On mappe vers un objet lisible et on baken le sens métier
 * (commune carencée = obligation renforcée + majoration de prélèvement).
 */
function summarizeSru(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse logement social illisible.' };
  }
  if (root.success === false || root.error) {
    return { status: 'error', message: str(root.error) ?? 'Erreur du service logement social.' };
  }
  if (!str(root.codeInsee) && !str(root.commune)) {
    return { status: 'not_found', message: "Commune non résolue pour l'inventaire SRU." };
  }

  const statut = str(root.statutSRU);
  const carencee = !!statut && /caren/i.test(statut);
  const soumise = !!statut && !/non soumise/i.test(statut);

  return {
    status: 'ok',
    data: {
      commune: str(root.commune),
      code_insee: str(root.codeInsee),
      code_postal: str(root.codePostal),
      statut_sru: statut,
      commune_carencee: carencee,
      taux_lls_pct: root.tauxLLS ?? null,
      objectif_sru_pct: root.objectifSRU ?? null,
      deficit_logements_estime: root.deficitEstime ?? null,
      mode_calcul_deficit: str(root.deficitMode),
      logements_sociaux: root.logementsSociaux ?? null,
      demandes_en_attente: root.demandesEnAttente ?? null,
      attributions_annuelles: root.attributionsAnnuelles ?? null,
      tension_theorique: root.tensionTheorique ?? null,
      qualite_donnee: str(root.dataStatus),
      donnee_partielle: root.scorePartiel === true,
      sources: Array.isArray(root.sources) ? root.sources : [],
      avertissements: Array.isArray(root.warnings) ? root.warnings : [],
      lecture_metier: soumise
        ? (carencee
          ? "Commune CARENCÉE au titre de la loi SRU : le préfet peut préempter, majorer le prélèvement et imposer une part de logements sociaux dans les opérations. Sur un projet de logements, une servitude de mixité sociale ou une part LLS imposée est HAUTEMENT probable — à confirmer au règlement du PLU et en mairie."
          : "Commune soumise à l'obligation SRU : une part de logements sociaux peut être imposée dans les opérations, selon le PLU et les orientations locales. À confirmer en mairie.")
        : "Statut SRU à confirmer : ne présume ni obligation ni exonération de logements sociaux.",
      avertissement:
        "Inventaire SRU annuel + RPLS/SNE : les chiffres sont communaux, jamais parcellaires. " +
        "La part de LLS réellement imposée à une opération dépend du règlement du PLU (servitude de mixité sociale) — vérifier en mairie.",
    },
  };
}

/**
 * Contexte commune (contexte-commune-v1) : déjà au contrat compact. Source
 * Wikidata/Wikipédia = ÉDITORIAL, jamais réglementaire.
 * ⚠️ stats.commune peut sortir null (constaté sur 64065) alors que stats.article
 * porte le nom : on expose les deux et on interdit toute déduction de mémoire.
 */
function summarizeContexteCommune(
  raw: unknown,
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse contexte commune illisible.' };
  }
  const st = String(root.status ?? '');
  if (st === 'error') return { status: 'error', message: str(root.summary) ?? 'Erreur contexte commune.' };
  if (st === 'no_localization') {
    return { status: 'not_found', message: str(root.summary) ?? 'Commune non résolue.' };
  }

  const stats = (root.stats ?? {}) as Record<string, any>;
  return {
    status: 'ok',
    data: {
      empty: st === 'no_data',
      summary: str(root.summary) ?? null,
      code_insee: str(stats.code_insee),
      // stats.commune sort parfois null : le nom fiable est celui de l'article.
      nom_commune: str(stats.commune) ?? str(stats.article),
      description: str(stats.description),
      intro: str(stats.intro),
      rubriques: stats.rubriques ?? null,
      url: str(stats.url),
      source: 'Wikidata / Wikipédia (fr)',
      avertissement:
        "Contexte ÉDITORIAL (encyclopédique), pas une source réglementaire ni statistique : " +
        "n'en tire aucune règle d'urbanisme, aucun chiffre de marché et aucune donnée de risque. " +
        "N'utilise que le nom de commune renvoyé ici : ne traduis JAMAIS un code INSEE en nom de commune de mémoire.",
    },
  };
}

/**
 * GPU (gpu-parcelle-v1) : déjà au contrat compact. On sépare la vue « zonage »
 * de la vue « prescriptions » pour que chaque outil renvoie un payload court.
 */
function summarizeGpu(
  raw: unknown,
  vue: 'zonage' | 'prescriptions',
): { status: ToolStatus; data?: Record<string, unknown>; message?: string } {
  const root = raw as Record<string, any>;
  if (!root || typeof root !== 'object') {
    return { status: 'error', message: 'Réponse GPU illisible.' };
  }
  const st = String(root.status ?? '');
  if (st === 'error') {
    return {
      status: 'error',
      message: (str(root.summary) ?? 'Erreur GPU.') +
        " Ne conclus RIEN sur la constructibilité tant que la couche n'a pas répondu.",
    };
  }
  if (st === 'no_localization') {
    return {
      status: 'not_found',
      message: str(root.summary) ??
        "Localisation précise requise : le zonage d'urbanisme se lit au point, pas à la commune.",
    };
  }

  const stats = (root.stats ?? {}) as Record<string, any>;
  const items = (root.items ?? {}) as Record<string, any>;
  const commun = {
    summary: str(root.summary) ?? null,
    commune: stats.commune ?? null,
    couches_en_echec: stats.couches_en_echec ?? [],
    source: str(root.source) ?? "Géoportail de l'urbanisme via API Carto (IGN)",
    avertissement: str(root.avertissement) ?? null,
  };

  if (vue === 'zonage') {
    return {
      status: 'ok',
      data: {
        ...commun,
        empty: (stats.nb_zones ?? 0) === 0,
        zone_principale: stats.zone_principale ?? null,
        zones: Array.isArray(items.zones) ? items.zones : [],
      },
    };
  }

  return {
    status: 'ok',
    data: {
      ...commun,
      empty: (stats.nb_prescriptions ?? 0) === 0 && (stats.nb_informations ?? 0) === 0,
      nb_prescriptions: stats.nb_prescriptions ?? 0,
      nb_prescriptions_impactantes: stats.nb_prescriptions_impactantes ?? 0,
      prescriptions: Array.isArray(items.prescriptions) ? items.prescriptions : [],
      informations: Array.isArray(items.informations) ? items.informations : [],
    },
  };
}

// =============================================================
// TOOL DEFINITIONS (exposées au LLM) — LOT 4 + LOT 5
// =============================================================

// Correctif A — descriptions partagées des champs de localisation.
// Les schémas annonçaient le code INSEE comme « prioritaire » sur le nom de
// commune : c'est l'ordre inverse du sûr. Le modèle fabrique des codes, il ne
// fabrique pas le nom que l'utilisateur vient d'écrire. Le code est désormais
// vérifié au référentiel côté serveur et le nom fait foi en cas de désaccord.
const PATTERN_INSEE = '^(?:\\d{5}|2[AB]\\d{3})$';
const DESC_CODE_INSEE =
  "Code INSEE de la commune. À renseigner UNIQUEMENT s'il a été donné par l'utilisateur " +
  "ou par le contexte : ne le reconstitue jamais de mémoire. Il est confronté au référentiel " +
  "officiel des communes, et le nom de commune l'emporte en cas de désaccord.";
const DESC_COMMUNE =
  "Nom de la commune. Renseigne-le dès qu'il est connu : c'est lui qui fait foi.";

const TOOLS: ToolDef[] = [
  {
    name: 'get_etude_parcelle',
    description:
      "ÉTUDE COMPLÈTE d'une parcelle en un seul appel : interroge simultanément toutes les " +
      "sources Mimmoza (loyers de référence, zonage ABC, fiscalité locale, assainissement, " +
      "altitude/pente, servitudes d'utilité publique, potentiel solaire, RISQUES naturels et " +
      "technologiques, transactions comparables DVF, classement sonore des voies, contexte " +
      "territorial) et renvoie un bundle structuré. ⚠️ CET OUTIL SE SUFFIT À LUI-MÊME : " +
      "n'appelle JAMAIS get_risks_georisques, get_dvf_comparables ni get_classement_sonore " +
      "après lui, leurs données sont déjà dans le bundle et un appel supplémentaire consomme " +
      "le tour de synthèse (l'utilisateur ne reçoit alors aucun rapport). " +
      "À APPELER EN PRIORITÉ dès que l'utilisateur demande une étude, un rapport, " +
      "une synthèse, un bilan, une analyse complète, une faisabilité ou « tout ce que tu sais » " +
      "sur une parcelle ou un terrain — plutôt que d'enchaîner les outils un par un. " +
      "Chaque source est indépendante : certaines peuvent être indisponibles, elles sont alors " +
      "listées dans sources_indisponibles. Signale systématiquement ces trous et n'extrapole " +
      "JAMAIS une donnée manquante. Si precision = 'centre_commune', les données géométriques " +
      "(pente, servitudes, solaire) sont indicatives et non parcellaires : dis-le.",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id: { type: 'string' },
        cadastral_ref: { type: 'string', description: "Identifiant cadastral IDU (14 caractères) — le plus précis." },
        lat: { type: 'number' },
        lng: { type: 'number' },
        code_insee: { type: 'string', description: 'Repli commune si pas de parcelle.' },
        commune: { type: 'string', description: 'Repli commune.' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_etude_marche',
    description:
      "ÉTUDE DE MARCHÉ LOCAL autour d'une adresse, d'une commune ou d'un point : " +
      "prix DVF (médiane, fourchette, évolution), démographie et revenus INSEE (population, " +
      "densité, revenu médian, chômage, pauvreté, vacance des logements, part de locataires), " +
      "desserte en transports (arrêts proches, métro/tram) et équipements BPE (écoles, santé, " +
      "commerces), plus des scores de demande, d'offre, d'accessibilité et d'environnement. " +
      "À appeler pour toute question sur l'ATTRACTIVITÉ, la DEMANDE, la LIQUIDITÉ ou le " +
      "PROFIL SOCIO-ÉCONOMIQUE d'un secteur, et pour situer un bien dans son marché. " +
      "Complémentaire de compute_smartscore, qui note la qualité d'un emplacement selon la " +
      "méthode propre à Mimmoza : ces deux outils mesurent des choses différentes, ne les " +
      "présente jamais comme contradictoires. N'invente aucun chiffre absent de la réponse. " +
      "Si l'utilisateur donne un IDENTIFIANT DE PARCELLE (ex. 64065000AI0002), transmets-le " +
      "dans parcel_id : c'est la localisation la plus précise, elle centre l'analyse sur le " +
      "terrain et évite un géocodage par nom de commune qui viserait le centre-bourg. " +
      "Tu n'as alors besoin d'aucune autre information de localisation.",
    input_schema: {
      type: 'object',
      properties: {
        // v1.9 — parcel_id et commune_insee n'étaient PAS déclarés : le modèle
        // ne pouvait pas les transmettre même en les connaissant, et l'outil
        // répondait « Indisponible » sur une question ne fournissant qu'un IDU.
        parcel_id: {
          type: 'string',
          description: "Identifiant cadastral (IDU) à 14 caractères, ex. « 64065000AI0002 ». Localisation la PLUS PRÉCISE : à privilégier dès qu'il est connu.",
        },
        commune_insee: {
          type: 'string',
          pattern: PATTERN_INSEE,
          description: DESC_CODE_INSEE,
        },
        address: { type: 'string', description: 'Adresse complète (prioritaire si pas de parcelle ni de coordonnées).' },
        city: { type: 'string' },
        zip_code: { type: 'string' },
        lat: { type: 'number' },
        lng: { type: 'number' },
        project_type: { type: 'string', description: "Type de projet étudié (défaut « logement »)." },
        rayon_km: { type: 'number', description: "Rayon d'analyse en km (défaut 5). Ne s'applique PAS au bloc DVF, filtré sur la commune." },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_parcel_summary',
    description:
      "Résumé synthétique d'une parcelle Mimmoza (adresse, commune, surface, zone PLU). " +
      "À appeler dès qu'une question porte sur une parcelle précise.",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id: { type: 'string', description: 'Identifiant de la parcelle (optionnel si déjà dans le contexte)' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_parcel_plu',
    description:
      "RÈGLES D'URBANISME CHIFFRÉES de la parcelle (zone, hauteur max, emprise au sol, reculs, " +
      "stationnement, pleine terre, COS) ainsi que l'OAP si elle a été analysée. Source primaire : " +
      "le parser PLU de Mimmoza, le règlement étant importé manuellement sur la page Foncier. " +
      "C'est l'outil à utiliser pour expliquer, synthétiser ou contrôler la constructibilité DÉTAILLÉE. " +
      "⚠️ REPLI AUTOMATIQUE : si aucun règlement n'a été importé, cet outil bascule seul sur le " +
      "Géoportail de l'urbanisme et renvoie alors le ZONAGE SEUL, avec niveau_de_detail='zonage_seul' " +
      "et regle_ecrite_disponible=false. Dans ce cas tu disposes du code de zone et de son type " +
      "(U/AU/A/N) mais d'AUCUNE règle chiffrée : ne déduis ni hauteur, ni emprise, ni recul, ni " +
      "stationnement du seul code de zone, et dis à l'utilisateur qu'il doit importer le PDF du " +
      "règlement sur la page Foncier pour les obtenir. " +
      "N'invente jamais : si une donnée manque, signale-le explicitement.",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id: { type: 'string' },
        cadastral_ref: { type: 'string' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_dvf_comparables',
    description:
      "Récupère les transactions comparables (DVF) autour de la parcelle : prix médian au m², " +
      "fourchette Q1-Q3, et transactions récentes. Utile pour estimer une valeur ou un prix de sortie.",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id: { type: 'string' },
        commune: { type: 'string' },
        rayon_m: { type: 'number', description: 'Rayon de recherche en mètres (défaut 2000)' },
        horizon_months: { type: 'number', description: 'Profondeur historique en mois (défaut 24)' },
        type_local: { type: 'string', description: 'Filtre type de bien (Appartement, Maison, Local)' },
      },
    },
    available_in_modes: ['advanced', 'report'],
  },
  {
    name: 'get_risks_georisques',
    description:
      "Récupère les risques naturels et technologiques (Géorisques) de la parcelle : inondation, " +
      "séisme, retrait-gonflement des argiles, radon, sites pollués (SIS), ICPE/SEVESO, cavités, " +
      "mouvements de terrain, feux de forêt. Renvoie des scores de SÉCURITÉ (100 = zone sûre, " +
      "0 = risque maximal) + un niveau de risque par catégorie + des constats rédigés (insights). " +
      "À utiliser pour évaluer l'exposition aux risques d'un terrain.",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id: { type: 'string' },
        lat: { type: 'number' },
        lng: { type: 'number' },
        code_insee: { type: 'string' },
        rayon_m: { type: 'number', description: 'Rayon de recherche ICPE/cavités/MVT en mètres (défaut 5000)' },
      },
    },
    available_in_modes: ['advanced', 'report'],
  },
  {
    name: 'get_dpe_ademe',
    description:
      "Récupère les diagnostics de performance énergétique (DPE, classes A à G) enregistrés " +
      "à l'ADEME autour d'une adresse : distribution des classes énergie et climat, DPE le plus " +
      "récent, nombre de passoires (F/G). Utile pour évaluer l'état énergétique du bâti et le " +
      "gisement de rénovation (Réhabilitation, Promotion). ⚠️ La base ADEME ne couvre pas tout le " +
      "parc : l'absence de DPE ne signifie pas absence de diagnostic. N'invente jamais de classe.",
    input_schema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: "Adresse complète (optionnel si présente dans le contexte)" },
        lat: { type: 'number' },
        lng: { type: 'number' },
        code_postal: { type: 'string' },
        radius_m: { type: 'number', description: 'Rayon de recherche en mètres (défaut 150)' },
      },
    },
    available_in_modes: ['advanced', 'report'],
  },
  {
    name: 'get_monuments_historiques',
    description:
      "Recherche les monuments historiques (base Mérimée) autour d'une parcelle : édifices " +
      "classés ou inscrits, distance, nature et date de protection. CRITIQUE pour la promotion : " +
      "un monument à moins de 500 m place le terrain dans le périmètre des abords, soumettant tout " +
      "projet à l'avis de l'Architecte des Bâtiments de France (ABF). À appeler pour toute question " +
      "sur le patrimoine, les contraintes ABF, les abords ou la faisabilité réglementaire d'un " +
      "terrain. Nécessite des coordonnées (lat/lng). N'invente jamais un monument ni un périmètre. " +
      "⚠️ RÉGIME DE L'AVIS ABF — ne l'improvise JAMAIS, et n'écris JAMAIS que l'avis serait simple " +
      "pour un monument inscrit et conforme pour un monument classé : c'est FAUX. Dans les abords " +
      "d'un monument historique, l'avis de l'ABF est CONFORME (contraignant) que le monument soit " +
      "classé OU inscrit — la distinction classé/inscrit qualifie la protection du MONUMENT, pas la " +
      "nature de l'avis sur les travaux alentour. Les rares cas où la loi ELAN (2018) ramène cet " +
      "avis à un avis simple sont limitativement énumérés (antennes-relais de radiotéléphonie, " +
      "travaux de traitement de l'insalubrité ou du péril) : ne les élargis pas. Le périmètre peut " +
      "aussi avoir été remplacé par un périmètre délimité des abords (PDA), différent du rayon de " +
      "500 m — signale cette possibilité et renvoie à l'UDAP du département. Au-delà de ces " +
      "éléments, tu n'énonces AUCUNE règle de procédure d'urbanisme que les données ne portent pas.",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id: { type: 'string' },
        lat: { type: 'number' },
        lng: { type: 'number' },
        code_insee: { type: 'string' },
        radius_m: { type: 'number', description: 'Rayon de recherche en mètres (défaut 500, périmètre abords)' },
      },
    },
    available_in_modes: ['advanced', 'report'],
  },
  {
    name: 'get_batiment_bdnb',
    description:
      "Récupère la carte d'identité d'un bâtiment via la BDNB (Base de Données Nationale des " +
      "Bâtiments, CSTB) : année de construction, usage, matériaux (murs, toit), nombre de niveaux " +
      "et de logements, hauteur, emprise au sol, classe DPE représentative, aléa argile, potentiel " +
      "solaire. Essentiel pour la Réhabilitation (connaître le bâti avant de rénover) et la " +
      "Promotion. Recherche par adresse. ⚠️ Beaucoup de champs peuvent être non renseignés : un " +
      "champ vide ne signifie pas absence de la caractéristique. Cite la source « BDNB - CSTB ».",
    input_schema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: "Adresse complète du bâtiment" },
        code_insee: { type: 'string', description: 'Code INSEE commune (repli si pas d\'adresse)' },
      },
    },
    available_in_modes: ['advanced', 'report'],
  },
  {
    name: 'compute_smartscore',
    description:
      "Calcule le SmartScore Mimmoza de la parcelle (score global /100 + piliers : marché, " +
      "transport, écoles, santé, environnement, démographie, DPE…). À utiliser pour évaluer " +
      "la qualité globale d'un emplacement et son potentiel.",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id: { type: 'string' },
        lat: { type: 'number' },
        lng: { type: 'number' },
        commune: { type: 'string' },
        type_local: { type: 'string', description: 'Type de bien (Appartement, Maison, Local)' },
      },
    },
    available_in_modes: ['advanced', 'report'],
  },
  // ─── LOT 5 : analyse rapide marché annonce (investisseur / marchand) ──────
  {
    name: 'get_quick_market_insight',
    description:
      "Récupère l'analyse rapide marché d'une annonce immobilière : prix/m² du bien, prix/m² " +
      "marché de référence, écart marché (décote ou surcote en %), position de marché, profondeur " +
      "du marché (nombre d'annonces comparables), niveau de confiance de l'analyse et verdict rapide. " +
      "À appeler pour toute question d'un investisseur ou marchand sur le prix, la décote, " +
      "l'opportunité ou la liquidité d'une annonce.",
    input_schema: {
      type: 'object',
      properties: {
        listing_id: {
          type: 'string',
          description: "Identifiant interne de l'annonce dans Mimmoza (prioritaire).",
        },
        url: {
          type: 'string',
          description: "URL publique de l'annonce (priorité 2 si listing_id absent).",
        },
        city: {
          type: 'string',
          description: "Ville de l'annonce (utilisée en combinaison avec zip_code, price, surface).",
        },
        zip_code: {
          type: 'string',
          description: "Code postal de l'annonce.",
        },
        price: {
          type: 'number',
          description: "Prix de l'annonce en euros.",
        },
        surface: {
          type: 'number',
          description: "Surface en m².",
        },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  // ─── recherche_biens : recherche multi-critères dans la base d'annonces ──
  {
    name: 'recherche_biens',
    description:
      "Recherche des biens immobiliers dans la base d'annonces Mimmoza selon des critères " +
      "(ville, code postal, budget min/max, surface min/max, uniquement les biens en décote). " +
      "Renvoie une liste d'annonces correspondantes triées par écart marché (meilleures décotes " +
      "d'abord), avec prix, surface, prix/m² et position marché. À appeler quand l'utilisateur " +
      "CHERCHE des biens (« trouve-moi… », « quels biens à X sous Y € », « des appartements décotés »). " +
      "Ne renvoie que ce que la base contient ; n'invente aucune annonce.",
    input_schema: {
      type: 'object',
      properties: {
        city:          { type: 'string', description: "Ville (recherche partielle)." },
        zip_code:      { type: 'string', description: 'Code postal (exact).' },
        price_min:     { type: 'number', description: 'Budget minimum en euros.' },
        price_max:     { type: 'number', description: 'Budget maximum en euros.' },
        surface_min:   { type: 'number', description: 'Surface minimale en m².' },
        surface_max:   { type: 'number', description: 'Surface maximale en m².' },
       only_discounts:{ type: 'boolean', description: 'Ne retourner que les biens en décote marché.' },
        limit:         { type: 'number', description: 'Nombre max de résultats (défaut 10, max 25).' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_loyers_reference',
    description:
      "Récupère le loyer de référence médian (€/m²/mois) d'une commune à partir de la Carte des " +
      "loyers ANIL/DHUP : médiane globale + ventilation appartement / maison, nombre d'observations " +
      "et millésime. Pour Paris, Lyon et Marseille (pas de valeur commune globale), renvoie une " +
      "fourchette min–médiane–max entre arrondissements (et accepte un arrondissement précis via " +
      "son code INSEE ou son code postal). Utile pour estimer un loyer de marché, une rentabilité " +
      "locative ou un potentiel locatif. N'invente jamais : si la commune n'est pas couverte, signale-le.",
    input_schema: {
      type: 'object',
      properties: {
        code_insee: { type: 'string', pattern: PATTERN_INSEE, description: DESC_CODE_INSEE + " Un code d'arrondissement (Paris/Lyon/Marseille) est accepté et plus précis." },
        commune:    { type: 'string', description: DESC_COMMUNE },
        zip_code:   { type: 'string', description: "Code postal (repli ; un CP d'arrondissement cible cet arrondissement)." },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_servitudes',
    description:
      "Récupère les servitudes d'utilité publique (SUP) qui grèvent une parcelle via le Géoportail " +
      "de l'Urbanisme (API Carto IGN) : monuments historiques (abords), sites, PPRn/PPRt, captages " +
      "d'eau, canalisations gaz/électricité/hydrocarbures, télécom, alignement de voirie, aéronautique… " +
      "Renvoie la liste des servitudes intersectant l'emprise de la parcelle, regroupées par catégorie. " +
      "CRITIQUE pour la constructibilité et la faisabilité d'un projet. Nécessite des coordonnées " +
      "précises (lat/lng) : ne fonctionne pas au niveau commune. ⚠️ Le GPU n'est PAS exhaustif : une " +
      "absence de résultat ne prouve JAMAIS l'absence de servitude — signale-le systématiquement et " +
      "n'invente aucune servitude.",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id: { type: 'string' },
        lat: { type: 'number' },
        lng: { type: 'number' },
        cadastral_ref: { type: 'string', description: 'Référence cadastrale (optionnelle, améliore la précision).' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },

  {
    name: 'get_potentiel_solaire',
    description:
      "Estime le potentiel photovoltaïque d'une parcelle via PVGIS (Commission européenne) : " +
      "production spécifique (kWh par kWc installé et par an), irradiation annuelle dans le plan " +
      "(kWh/m²/an), inclinaison et azimut optimaux, répartition mensuelle. Utile pour évaluer " +
      "l'autoconsommation, un projet PV en toiture ou l'attrait énergétique d'un bien. " +
      "⚠️ Production SPÉCIFIQUE (par kWc) : pour une production absolue, la multiplier par la " +
      "puissance installée. PVGIS ne modélise pas l'ombrage propre à la toiture (estimation de " +
      "référence, pas un relevé par pan de toit). Nécessite une localisation (lat/lng, sinon centre commune).",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id: { type: 'string' },
        lat: { type: 'number' },
        lng: { type: 'number' },
        commune: { type: 'string' },
        code_insee: { type: 'string' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_zonage_abc',
    description:
      "Donne la zone de tension d'une commune dans le zonage ABC (Abis, A, B1, B2, C), " +
      "source DHUP/data.gouv à jour de l'arrêté du 23/06/2026. ⚠️ Le dispositif Pinel a pris fin " +
      "le 31/12/2024 : ce zonage n'ouvre PLUS droit au Pinel pour un nouvel investissement. Il reste " +
      "la référence pour Loc'Avantages, PTZ, LLI, Denormandie, PSLA/PLS/BRS et les plafonds de " +
      "loyers/ressources. À utiliser pour situer la tension du marché local et l'éligibilité aux " +
      "dispositifs actuels. N'invente jamais une zone : si la commune n'est pas trouvée, signale-le.",
    input_schema: {
      type: 'object',
      properties: {
        code_insee: { type: 'string', pattern: PATTERN_INSEE, description: DESC_CODE_INSEE },
        commune:    { type: 'string', description: 'Nom de la commune (repli).' },
        zip_code:   { type: 'string', description: 'Code postal (repli).' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_taxes_locales',
    description:
      "Donne les taux de fiscalité directe locale VOTÉS d'une commune (source DGFiP, data.economie.gouv) : " +
      "taxe foncière sur les propriétés bâties (TFB) — la plus utile en immobilier —, taxe foncière " +
      "non bâtie (TFNB), taxe d'habitation (TH), majoration THRS et TEOM. ⚠️ La TH sur la résidence " +
      "principale est SUPPRIMÉE depuis 2023. La THRS et sa majoration éventuelle concernent les " +
      "résidences secondaires ; les logements vacants relèvent de régimes distincts (THLV/TLV selon " +
      "leur champ). Ne présente jamais la majoration THRS comme applicable aux logements vacants sans " +
      "champ explicite fourni par la source. Utile pour estimer les charges d'un investisseur, le " +
      "coût de portage d'un marchand, ou comparer la pression fiscale entre communes. N'invente jamais " +
      "un taux : si la commune n'est pas trouvée, signale-le.",
    input_schema: {
      type: 'object',
      properties: {
        code_insee: { type: 'string', pattern: PATTERN_INSEE, description: DESC_CODE_INSEE },
        commune:    { type: 'string', description: 'Nom de la commune (repli).' },
        zip_code:   { type: 'string', description: 'Code postal (repli).' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_ppr_detail',
    description:
      "Détaille les Plans de Prévention des Risques (PPRN/PPRT/PPRM) d'une commune via l'API " +
      "Géorisques (BD GASPAR) : nom du PPR, type de risque, statut APPROUVÉ (opposable, vaut " +
      "servitude, annexé au PLU) ou PRESCRIT (sursis à statuer possible), dates. Si des coordonnées " +
      "(lat/lng) sont fournies, teste si la parcelle est réellement DANS le périmètre du PPR — plus " +
      "précis que « la commune est concernée » de get_risks_georisques. ⚠️ Ne fournit PAS le zonage " +
      "réglementaire interne (zone rouge/bleue) ni son règlement : ces données ne sont pas en API " +
      "nationale. N'invente JAMAIS une couleur de zone ; renvoie au règlement du PPR (Géorisques/DDT).",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id:  { type: 'string' },
        code_insee: { type: 'string', pattern: PATTERN_INSEE, description: DESC_CODE_INSEE },
        commune:    { type: 'string', description: 'Nom de la commune (repli).' },
        zip_code:   { type: 'string', description: 'Code postal (repli).' },
        lat:        { type: 'number', description: 'Latitude parcelle (active le test dans-périmètre).' },
        lng:        { type: 'number', description: 'Longitude parcelle (active le test dans-périmètre).' },
      },
    },
    available_in_modes: ['advanced', 'report'],
  },
  {
    name: 'get_assainissement',
    description:
      "Indique, au niveau COMMUNE, la présence d'un service d'assainissement COLLECTIF (raccordement " +
      "au réseau possible) et/ou NON COLLECTIF (ANC/SPANC), avec l'opérateur (source SISPEA). Utile " +
      "pour anticiper le mode d'assainissement d'un projet et ses coûts. ⚠️ Donnée COMMUNALE : le " +
      "zonage à la parcelle (collectif vs non collectif) n'existe pas en national. Si le collectif " +
      "est présent, une parcelle donnée peut malgré tout être en zone non collective — ne l'affirme " +
      "JAMAIS à la parcelle depuis cette donnée, renvoie au zonage d'assainissement communal / mairie. " +
      "Si le collectif est absent, un ANC (fosse) est à prévoir.",
    input_schema: {
      type: 'object',
      properties: {
        code_insee: { type: 'string', pattern: PATTERN_INSEE, description: DESC_CODE_INSEE },
        commune:    { type: 'string', description: 'Nom de la commune (repli).' },
        zip_code:   { type: 'string', description: 'Code postal (repli).' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_altimetrie',
    description:
      "Donne l'altitude et une estimation de la PENTE d'une parcelle via le RGE Alti de l'IGN " +
      "(échantillonnage local). Renvoie altitude (m), pente (% et degrés) et une classe qualitative " +
      "(plat / faible / modérée / forte / très forte). Indicateur clé de faisabilité : terrassement, " +
      "VRD, accès, surcoûts. Nécessite des coordonnées (lat/lng) pour une mesure à la parcelle ; sinon " +
      "mesure indicative au centre de la commune (le préciser). Pente ESTIMÉE, à confirmer par relevé " +
      "topographique pour un projet — ne pas la présenter comme une donnée topo officielle.",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id:  { type: 'string' },
        lat:        { type: 'number' },
        lng:        { type: 'number' },
        code_insee: { type: 'string', description: 'Repli si pas de coordonnées (centre commune).' },
        commune:    { type: 'string', description: 'Repli si pas de coordonnées (centre commune).' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_classement_sonore',
    description:
      "Indique si une parcelle est dans un SECTEUR AFFECTÉ PAR LE BRUIT au titre du classement sonore " +
      "des infrastructures de transport terrestre (routes, voies ferrées), via le Géoportail de " +
      "l'Urbanisme (API Carto IGN). Renvoie la présence de secteur(s), la catégorie la plus sévère " +
      "(1 = la plus bruyante, secteur 300 m ; 5 = 10 m) et la largeur. Dans ces secteurs, tout bâtiment " +
      "sensible neuf (logement, école, santé, hôtel) doit présenter une isolation acoustique renforcée " +
      "— impact direct de coût et de faisabilité (promotion, réhabilitation). Nécessite une localisation " +
      "précise (lat/lng ou identifiant cadastral) : ne fonctionne pas au niveau commune. ⚠️ Classement " +
      "RÉGLEMENTAIRE, pas des décibels mesurés ; et le GPU n'est pas exhaustif : une absence ne prouve " +
      "PAS l'absence de classement — signale-le et n'invente jamais un secteur ni une catégorie. " +
      "Le classement sonore est le plus souvent porté par un ARRÊTÉ PRÉFECTORAL annexé au PLU (fréquemment " +
      "un PDF non géométrique, donc absent de cette API) : quand aucun secteur ne remonte (empty/no_data), " +
      "ne conclus PAS à l'absence de classement — renvoie vers les annexes du PLU et l'arrêté de classement " +
      "sonore en préfecture (ou en mairie) pour une réponse définitive.",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id: { type: 'string' },
        cadastral_ref: { type: 'string' },
        lat: { type: 'number' },
        lng: { type: 'number' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_couts_construction',
    description:
      "Donne le COÛT DE CONSTRUCTION NEUVE au m² de surface de plancher, issu du barème " +
      "interne Mimmoza, ajusté de la tension du marché local (zonage ABC) et réindexé sur " +
      "l'index BT01 de l'INSEE. À appeler dès qu'une question porte sur le coût, le budget " +
      "ou le prix de construction d'un projet neuf (« combien coûterait de construire… », " +
      "« quel budget pour X m² »). Renvoie le coût au m², une fourchette, le montant total si " +
      "une surface est fournie, et la DÉCOMPOSITION complète du calcul. " +
      "⚠️ CE BARÈME EST UNE HYPOTHÈSE MIMMOZA, pas une donnée de marché sourcée : présente " +
      "toujours le montant comme un ordre de grandeur à confirmer par devis, et cite " +
      "« [source : barème Mimmoza, indexé BT01 INSEE] ». Montants HT, hors foncier, honoraires, " +
      "VRD, taxes d'urbanisme et aléas — dis-le. " +
      "⚠️ TYPOLOGIES COUVERTES UNIQUEMENT : maison individuelle, petit collectif (R+2), " +
      "collectif (R+4), tertiaire. Un EHPAD, une clinique, un hôtel ou une école NE SONT PAS " +
      "couverts : si l'outil renvoie « empty », dis-le franchement et renvoie vers un " +
      "économiste de la construction — n'approxime JAMAIS avec 'tertiaire'.",
    input_schema: {
      type: 'object',
      properties: {
        typologie: { type: 'string', description: "maison_individuelle | collectif_r2 | collectif_r4 | tertiaire" },
        gamme: { type: 'string', description: "economique | standard | premium (défaut standard)" },
        surface_sdp: { type: 'number', description: "Surface de plancher en m² (pour obtenir un montant total)" },
        zone_abc: { type: 'string', description: "Abis | A | B1 | B2 | C (sinon résolue depuis la commune)" },
        code_insee: { type: 'string' },
        commune: { type: 'string' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_couts_renovation',
    description:
      "Donne le COÛT DES TRAVAUX DE RÉNOVATION d'un bien EXISTANT (distinct de la construction " +
      "neuve = get_couts_construction), barème interne Mimmoza, poste par poste. CALCUL " +
      "DÉTERMINISTE côté fonction : TU lis l'état sur les photos (ou la description), tu en " +
      "déduis les postes à reprendre et leurs quantités, tu les transmets ici, la fonction " +
      "applique les ratios et renvoie la décomposition chiffrée — que tu RESTITUES sans la " +
      "recalculer. Deux modes : (A) poste par poste via 'postes' [recommandé] ; (B) à défaut, " +
      "'niveau_global' + 'surface_habitable_m2' pour un forfait global. Clés de postes reconnues " +
      "(unité entre parenthèses) : cuisine, salle_de_bains, wc, chauffage_pac, cuve_fioul, " +
      "assainissement (forfait) ; electricite, plomberie (€/m² habitable) ; sols, peinture, " +
      "isolation_combles, isolation_murs_iti (€/m²) ; toiture (€/m² toiture) ; ravalement " +
      "(€/m² façade) ; menuiseries (par ouverture). niveau_global ∈ {rafraichissement, " +
      "partielle, moyenne, lourde, complete}. gamme ∈ {economique, standard, premium} " +
      "(défaut standard). restructuration=true pour provisionner la maîtrise d'œuvre (8-12 %). " +
      "Donnée manquante (surface d'une pièce, gamme) → pose une hypothèse explicite et " +
      "transmets-la quand même : ne bloque JAMAIS le chiffrage. ⚠️ Montants HT, ordres de " +
      "grandeur à confirmer par devis, hors désamiantage/plomb et aléas structurels non " +
      "visibles ; TVA rénovation (5,5/10/20 %) à ajouter. Cite « [source: barème rénovation Mimmoza] ».",
    input_schema: {
      type: 'object',
      properties: {
        surface_habitable_m2: { type: 'number', description: "Surface habitable en m² (repli mode global + postes au m² habitable)." },
        gamme: { type: 'string', description: "economique | standard | premium (défaut standard)." },
        alea_pct: { type: 'number', description: "Provision aléas en % (défaut 12, borné 0-30)." },
        restructuration: { type: 'boolean', description: "true = provisionner la maîtrise d'œuvre (8-12 %)." },
        niveau_global: { type: 'string', description: "rafraichissement | partielle | moyenne | lourde | complete — mode forfait global si pas de postes." },
        postes: {
          type: 'array',
          description: "Liste des postes à reprendre, lus sur les photos.",
          items: {
            type: 'object',
            properties: {
              poste: { type: 'string', description: "Clé du catalogue (ex: cuisine, electricite, toiture, menuiseries)." },
              quantite: { type: 'number', description: "Quantité dans l'unité du poste (m², nb d'ouvertures…). Forfait = 1 par défaut." },
              niveau: { type: 'string', description: "Niveau de reprise (libre, indicatif)." },
              hypothese: { type: 'string', description: "Hypothèse retenue si donnée déduite (ex: '[H] surface estimée')." },
            },
            required: ['poste'],
          },
        },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_sitadel',
    description:
      "Liste les PERMIS D'URBANISME RÉCENTS et GÉOLOCALISÉS autour d'un point (permis de construire PC, " +
      "d'aménager PA, de démolir PD, déclarations préalables DP), source Sit@del2 / data.gouv. Recherche " +
      "par RAYON autour de la parcelle ouverte (coordonnées du contexte) ou, à défaut, autour du centre de " +
      "la commune. Renvoie le nombre de permis sur la période, la répartition par type, le total de " +
      "logements créés, le plus gros projet, et les permis les plus RÉCENTS et les plus PROCHES (avec " +
      "distance, date de dépôt, nature, logements, surface, commune). Utile pour la veille concurrentielle " +
      "(promoteur), le dynamisme d'un secteur (investisseur/marchand) et surtout pour repérer un PROJET " +
      "VOISIN (ex. un permis de gros collectif ou une surface commerciale déposés à quelques centaines de " +
      "mètres = signal d'un projet type supermarché ou résidence). ⚠️ Si la parcelle n'est pas localisée " +
      "précisément, la recherche est centrée sur le centre de la commune (champ precision='centre_commune') : " +
      "dis-le, les distances sont alors relatives à ce centre et le rayon peut couvrir des communes voisines. " +
      "Les tout derniers mois peuvent être incomplets (remontée mensuelle). Cite [source: Sit@del2 / data.gouv]. " +
      "total_dans_rayon = nombre total de permis dans le rayon ; par_type_sur_analyses et logements_crees_sur_analyses ne portent QUE sur les permis analysés (les plus récents, plafonnés). Si affichage_tronque=true, dis-le et ne présente jamais la répartition comme couvrant le total. " +
      "⚠️ PÉRIMÈTRE : cet outil ne couvre QUE les permis à usage de LOGEMENT (+ permis d'aménager et de démolir). Il ne renvoie PAS les surfaces de locaux NON RÉSIDENTIELS (commerce, bureaux, industrie, entrepôts…) : tu ne peux donc ni confirmer ni écarter un projet de commerce à partir de ces données, et tu ne dois pas laisser entendre que tu as regardé les commerces. Pour un projet commercial (ex. supermarché), renvoie vers le service urbanisme de la mairie et la CDAC du département. " +
      "N'invente aucun chiffre : si aucun permis (empty), dis-le.",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id:     { type: 'string' },
        cadastral_ref: { type: 'string', description: 'Identifiant cadastral IDU (repli localisation).' },
        lat:           { type: 'number', description: 'Latitude du point de recherche (prioritaire, précision parcelle).' },
        lng:           { type: 'number', description: 'Longitude du point de recherche.' },
        code_insee:    { type: 'string', description: 'Code INSEE (repli : centre commune).' },
        commune:       { type: 'string', description: 'Nom de la commune (repli : centre commune).' },
        zip_code:      { type: 'string', description: 'Code postal (repli).' },
        rayon_km:      { type: 'number', description: 'Rayon de recherche en km (défaut 3 à la parcelle, 5 à la commune ; max 25).' },
        periode_mois:  { type: 'number', description: 'Profondeur en mois (défaut 24, max 120).' },
        type_autorisation: {
          type: 'string',
          description:
            "Filtre sur la nature de l'autorisation : 'all' (défaut, tout), ou une liste séparée par des " +
            "virgules parmi PC (permis de construire), DP (déclaration préalable), PA (permis d'aménager), " +
            "PD (permis de démolir). Ex. 'PC' pour ne voir que les permis de construire, 'PA,PD' pour " +
            "repérer les divisions foncières et les démolitions.",
        },
        typologie: {
          type: 'string',
          enum: ['all', 'logement', 'individuel', 'collectif', 'mixte', 'activite'],
          description:
            "Filtre sur la nature du programme (défaut 'all'). 'collectif' isole les immeubles, " +
            "'individuel' les maisons, 'mixte' les deux. ⚠️ 'activite' est très incomplet : le dataset " +
            "Sit@del-logements ne couvre pas les projets non résidentiels — un résultat vide ne prouve " +
            "donc PAS l'absence de projet commercial, dis-le explicitement.",
        },
        logements_min: { type: 'number', description: "Ne garder que les permis créant AU MOINS ce nombre de logements. Sert à isoler les grosses opérations (ex. 30 pour repérer un collectif d'envergure)." },
        logements_max: { type: 'number', description: 'Ne garder que les permis créant AU PLUS ce nombre de logements.' },
        surface_min:   { type: 'number', description: 'Surface de plancher minimale du projet, en m².' },
        surface_max:   { type: 'number', description: 'Surface de plancher maximale du projet, en m².' },
        trier_par: {
          type: 'string',
          enum: ['date', 'distance', 'logements', 'surface'],
          description:
            "Critère de tri des permis analysés (défaut 'date', du plus récent au plus ancien). " +
            "'logements' ou 'surface' font remonter les plus gros projets, 'distance' les plus proches. " +
            "⚠️ Le tri décide QUELS permis sont analysés en détail quand le rayon en contient plus de 100 : " +
            "pour chercher le plus gros projet voisin, trie par 'logements', pas par 'date'.",
        },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_etablissements_proches',
    description:
      "ÉTABLISSEMENTS ET ACTIVITÉS ÉCONOMIQUES autour d'un point (base Sirene + RNE via l'API " +
      "Recherche d'entreprises de la DINUM). Recherche par RAYON autour de la parcelle ouverte " +
      "(coordonnées du contexte) ou, à défaut, autour du centre de la commune. Renvoie le nombre " +
      "d'établissements dans le rayon, la répartition par SECTION NAF (commerce, santé, " +
      "enseignement, industrie, restauration…), le nombre de créations sur les 12 derniers mois, " +
      "et la liste des établissements les plus proches (nom/enseigne, activité, adresse, distance, " +
      "tranche d'effectif, date de création, état actif/fermé). Utile pour qualifier " +
      "l'ENVIRONNEMENT COMMERCIAL et de SERVICES d'un terrain (« y a-t-il un supermarché, une " +
      "école, un médecin à côté ? »), mesurer le dynamisme économique local (créations récentes) " +
      "et détecter l'implantation d'une grande enseigne. " +
      "⚠️ PÉRIMÈTRE : SIRENE recense des établissements DÉJÀ IMMATRICULÉS. Ce n'est ni un permis, " +
      "ni un projet futur : tu ne peux pas en déduire qu'un commerce va ouvrir. Pour un projet " +
      "commercial à venir, renvoie vers le service urbanisme de la mairie et la CDAC. Le code NAF " +
      "décrit l'activité déclarée, pas l'usage réel du local. Un établissement peut être fermé " +
      "(champ etat) : ne le compte pas comme actif. " +
      "⚠️ Si la parcelle n'est pas localisée précisément, la recherche est centrée sur le centre " +
      "de la commune (precision='centre_commune') : dis-le, les distances sont alors relatives à " +
      "ce centre. Cite [source: Sirene / RNE via API Recherche d'entreprises (DINUM)]. " +
      "N'invente aucun établissement : si aucun résultat (empty), dis-le.",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id:     { type: 'string' },
        cadastral_ref: { type: 'string', description: 'Identifiant cadastral IDU (repli localisation).' },
        lat:           { type: 'number', description: 'Latitude du point de recherche (prioritaire, précision parcelle).' },
        lng:           { type: 'number', description: 'Longitude du point de recherche.' },
        code_insee:    { type: 'string', description: 'Code INSEE (repli : centre commune).' },
        commune:       { type: 'string', description: 'Nom de la commune (repli : centre commune).' },
        zip_code:      { type: 'string', description: 'Code postal (repli).' },
        rayon_km:      { type: 'number', description: "Rayon de recherche en km (défaut 1 à la parcelle, 2 à la commune ; max 10)." },
        section_naf:   { type: 'string', description: "Filtre optionnel sur une section NAF (lettre A à U ; ex. 'G' = commerce, 'Q' = santé, 'P' = enseignement)." },
        limite:        { type: 'number', description: "Nombre d'établissements détaillés à renvoyer (défaut 15, max 30)." },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_equipements_proches',
    description:
      "ÉQUIPEMENTS ET SERVICES autour d'un point (Base Permanente des Équipements de l'INSEE) : " +
      "écoles et collèges, médecins et pharmacies, commerces alimentaires (supérette, supermarché, " +
      "boulangerie), poste, banque, équipements sportifs, gares et arrêts, restaurants, services " +
      "publics. Recherche par RAYON autour de la parcelle ouverte ou, à défaut, autour du centre de " +
      "la commune. Renvoie le nombre total d'équipements, la répartition par catégorie, " +
      "l'équipement LE PLUS PROCHE de chaque catégorie (avec sa distance) et les 15 équipements les " +
      "plus proches. C'est l'outil à utiliser pour qualifier la COMMODITÉ d'un terrain " +
      "(« y a-t-il une école / un médecin / une supérette à proximité ? ») et l'attractivité " +
      "résidentielle d'un secteur. " +
      "⚠️ La BPE est un inventaire ANNUEL : une ouverture ou une fermeture récente peut manquer. " +
      "Les distances sont à VOL D'OISEAU, jamais des temps de trajet : ne les convertis pas en minutes. " +
      "⚠️ Si l'outil renvoie une erreur, la source externe est momentanément indisponible : dis-le, " +
      "et ne conclus SURTOUT PAS à une absence d'équipement. " +
      "Cite [source: BPE INSEE]. Si aucun équipement (empty), dis-le sans inventer.",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id:     { type: 'string' },
        cadastral_ref: { type: 'string', description: 'Identifiant cadastral IDU (repli localisation).' },
        lat:           { type: 'number', description: 'Latitude du point de recherche (prioritaire, précision parcelle).' },
        lng:           { type: 'number', description: 'Longitude du point de recherche.' },
        code_insee:    { type: 'string', description: 'Code INSEE (repli : centre commune).' },
        commune:       { type: 'string', description: 'Nom de la commune (repli : centre commune).' },
        zip_code:      { type: 'string', description: 'Code postal (repli).' },
        rayon_m:       { type: 'number', description: 'Rayon de recherche en mètres (défaut 1500 à la parcelle, 3000 à la commune ; max 20000).' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_logement_social',
    description:
      "LOGEMENT SOCIAL ET OBLIGATION SRU d'une commune : statut au regard de l'article 55 de la loi " +
      "SRU (soumise / non soumise / CARENCÉE), taux de logements locatifs sociaux, objectif légal " +
      "(20 ou 25 %), déficit estimé en nombre de logements, stock de LLS, et lorsque la donnée SNE " +
      "est disponible, demandes en attente et attributions annuelles (tension locative sociale). " +
      "UTILISE CET OUTIL dès qu'un projet de LOGEMENTS est envisagé sur un terrain : dans une " +
      "commune carencée, une part de logements sociaux imposée (servitude de mixité sociale) est " +
      "hautement probable et change l'équilibre financier de l'opération ; le préfet peut aussi " +
      "préempter et majorer le prélèvement. C'est aussi un indicateur de la demande locative " +
      "abordable pour un investisseur (LLI, BRS, Loc'Avantages). " +
      "⚠️ MAILLE COMMUNALE STRICTE : ces chiffres ne disent RIEN de ce qui sera imposé à une " +
      "parcelle précise — la part de LLS exigible se lit dans le règlement du PLU et se confirme " +
      "en mairie. Ne présente jamais le déficit communal comme une obligation parcellaire. " +
      "Si donnee_partielle vaut true, signale que les données SNE ou RPLS manquent. " +
      "Cite [source: Inventaire SRU / RPLS / SNE].",
    input_schema: {
      type: 'object',
      properties: {
        code_insee: { type: 'string', pattern: PATTERN_INSEE, description: DESC_CODE_INSEE },
        commune:    { type: 'string', description: 'Nom de la commune (repli).' },
        zip_code:   { type: 'string', description: 'Code postal (repli).' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_analyse_predictive',
    description:
      "PROJECTION DE VALEUR d'un bien à 6, 12, 18 et 24 mois (36 et 60 si l'horizon le justifie), " +
      "avec TROIS scénarios — prudent, central, optimiste —, un régime de marché (correction, " +
      "plateau, reprise, hausse), des scores de pression, de liquidité et de sécurité, et la " +
      "liste des facteurs qui poussent la valeur vers le haut ou vers le bas. " +
      "UTILISE CET OUTIL dès qu'on te demande où va le marché, ce que vaudra un bien, s'il faut " +
      "acheter maintenant ou attendre, ou quelle plus-value espérer : « ça va monter ? », " +
      "« je revends dans 2 ans, j'y gagne ? », « le marché est-il en train de se retourner ? ». " +
      "Le calcul intègre les transactions DVF locales et les TAUX DIRECTEURS BCE, récupérés en " +
      "direct — la pression crédit est le premier déterminant du marché résidentiel. " +
      "⚠️ SURFACE et PRIX D'ACQUISITION sont OBLIGATOIRES : sans eux l'outil refuse, et il a " +
      "raison — une projection sans le bien, c'est une moyenne de quartier déguisée. " +
      "Demande-les plutôt que de les inventer. " +
      "⚠️ Enrichis le résultat en passant `dpe` et `loyer_median_m2` si tu les as déjà obtenus " +
      "par get_dpe_ademe et get_loyers_reference dans cet échange : chaque entrée manquante " +
      "abaisse confidenceScore, que tu DOIS citer. " +
      "⚠️ RESTITUTION : présente TOUJOURS les trois scénarios, jamais le seul central. Annoncer " +
      "« +7,2 % à 24 mois » sans fourchette est une fausse précision sur un exercice qui n'en " +
      "permet aucune. Dis que c'est une projection de modèle, pas une estimation contractuelle, " +
      "et relaie le champ entrees_manquantes s'il n'est pas vide.",
    input_schema: {
      type: 'object',
      properties: {
        surface_m2:       { type: 'number', description: 'Surface du bien en m². OBLIGATOIRE.' },
        prix_acquisition: { type: 'number', description: "Prix d'acquisition en €. OBLIGATOIRE." },
        type_bien: {
          type: 'string',
          enum: ['appartement', 'maison', 'immeuble', 'terrain', 'commerce'],
          description: "Nature du bien (défaut : appartement).",
        },
        code_postal: { type: 'string', description: 'Code postal. À défaut, déduit du contexte.' },
        commune:     { type: 'string', description: 'Nom de la commune (repli de localisation).' },
        code_insee:  { type: 'string', description: 'Code INSEE (repli de localisation).' },
        travaux_estime: { type: 'number', description: 'Budget travaux en €, s\'il y en a.' },
        frais_annexes:  { type: 'number', description: 'Frais de notaire, agence, etc. en €.' },
        horizon_mois:   { type: 'number', description: "Durée de détention envisagée en mois (défaut 12). À 36 ou plus, les horizons longs s'activent." },
        dpe: {
          type: 'string',
          description: "Classe énergétique A→G du bien, si tu l'as obtenue par get_dpe_ademe ou fournie par l'utilisateur. Ne l'invente pas.",
        },
        loyer_median_m2: {
          type: 'number',
          description: "Loyer de référence en €/m²/mois, si tu l'as obtenu par get_loyers_reference.",
        },
      },
      required: ['surface_m2', 'prix_acquisition'],
    },
    // Sans cette ligne, toolsForMode lit `.includes` sur undefined et TOUTE
    // conversation échoue, quel que soit le sujet. Le champ est pourtant
    // déclaré obligatoire dans ToolDef : c'est `npx tsc` qui ne voit pas ce
    // fichier, exclu du tsconfig du front puisqu'il s'exécute sous Deno.
    available_in_modes: ['advanced', 'report'],
  },
  {
    name: 'get_proprietaire_parcelle',
    description:
      "PROPRIÉTAIRE PERSONNE MORALE d'une parcelle : dénomination, SIREN, forme juridique. " +
      "Fonctionne dans les deux sens — « qui détient cette parcelle ? » à partir d'une " +
      "référence cadastrale, et « que détient cette société ? » à partir d'un SIREN ou " +
      "d'une dénomination. " +
      "UTILISE CET OUTIL dès qu'on cherche à identifier ou contacter le détenteur d'un " +
      "terrain : « à qui appartient ce terrain ? », « qui est le propriétaire ? », " +
      "« comment joindre le propriétaire ? », « quel foncier détient cette SCI ? ». " +
      "⚠️ PÉRIMÈTRE STRICTEMENT LIMITÉ AUX PERSONNES MORALES — sociétés, SCI, foncières, " +
      "collectivités, associations. AUCUNE personne physique n'y figure, et il n'existe " +
      "aucun moyen légal pour Mimmoza d'en obtenir : l'identité des propriétaires " +
      "particuliers relève des fichiers fonciers, réservés aux acteurs publics et interdits " +
      "de démarchage commercial. " +
      "⚠️ UNE ABSENCE DE RÉSULTAT NE PROUVE RIEN. Ne conclus JAMAIS « c'est donc un " +
      "particulier » : le fichier exclut aussi les sociétés unipersonnelles et les " +
      "entrepreneurs individuels, et le département n'a peut-être pas été importé. " +
      "Relaie le champ `avertissement` tel quel. " +
      "⚠️ RESTITUTION : cite l'attribution DGFiP et le millésime. Quand `siren_exploitable` " +
      "vaut false, dis que l'identifiant n'est pas utilisable — la DGFiP attribue des " +
      "numéros fictifs qui ne correspondent à aucune entreprise.",
    input_schema: {
      type: 'object',
      properties: {
        cadastral_ref: {
          type: 'string',
          description: "IDU cadastral de 14 caractères. La voie la plus fiable.",
        },
        code_insee: {
          type: 'string',
          pattern: PATTERN_INSEE,
          description: "Code INSEE de la commune, à combiner avec section et numero.",
        },
        section: { type: 'string', description: "Section cadastrale, ex. « AY »." },
        numero:  { type: 'string', description: "Numéro de plan de la parcelle, ex. « 102 »." },
        prefixe: { type: 'string', description: "Préfixe cadastral, souvent « 000 »." },
        siren: {
          type: 'string',
          description:
            "Recherche inverse : SIREN à 9 chiffres d'une société, pour lister le foncier " +
            "qu'elle détient.",
        },
        denomination: {
          type: 'string',
          description:
            "Recherche inverse par nom de société, quand le SIREN est inconnu. Recherche " +
            "partielle, insensible à la casse.",
        },
      },
    },
    available_in_modes: ['advanced', 'report'],
  },
  {
    name: 'get_dispositif_fiscal',
    description:
      "DISPOSITIFS DE DÉFISCALISATION IMMOBILIÈRE : explique un dispositif et/ou chiffre " +
      "l'avantage fiscal d'une opération. Trois dispositifs sont ouverts aux nouveaux " +
      "investisseurs au 1er septembre 2026 : " +
      "JEANBRUN NEUF et JEANBRUN ANCIEN (amortissement créé par la loi de finances 2026, " +
      "successeur du Pinel), DENORMANDIE (réduction d'impôt, ancien à rénover) et " +
      "LOC'AVANTAGES (réduction d'impôt, conventionnement Anah). " +
      "UTILISE CET OUTIL dès qu'on te parle de défiscalisation, de Jeanbrun, de Denormandie, " +
      "de Loc'Avantages, de Pinel, d'amortissement locatif, de plafonds de loyer ou de " +
      "ressources : « je peux défiscaliser ? », « le Pinel existe encore ? », « ça donne quoi " +
      "en Jeanbrun ? », « quel loyer maximum en zone B1 ? ». " +
      "⚠️ TU NE CALCULES JAMAIS toi-même un avantage fiscal, un taux d'amortissement ou un " +
      "plafond de loyer : tous les barèmes changent chaque année et tes valeurs seraient " +
      "périmées. Appelle l'outil, même pour une question qui te semble simple. " +
      "MODE EXPLICATION : sans `prix_acquisition`, l'outil renvoie la fiche du dispositif — " +
      "mécanique, conditions, date limite, pièges courants. Utilise-le pour répondre à " +
      "« comment ça marche ? ». " +
      "MODE CALCUL : avec `prix_acquisition`, il chiffre l'avantage année par année. " +
      "DISPOSITIF CLOS : passe le nom au paramètre `dispositif` (« pinel », « censi-bouvard »…) " +
      "et l'outil répond qu'il est fermé, depuis quand, et par quoi il est remplacé. " +
      "⚠️ RESTITUTION : relaie TOUJOURS le champ `constats`. Un constat « bloquant » signifie " +
      "que l'investisseur n'a PAS droit au dispositif — ne présente jamais le chiffre sans le " +
      "motif. Cite le millésime des barèmes et termine par la mention de validation " +
      "professionnelle : la fiscalité n'est pas un domaine où l'à-peu-près est acceptable.",
    input_schema: {
      type: 'object',
      properties: {
        dispositif: {
          type: 'string',
          description:
            "Dispositif visé. Ouverts : jeanbrun_neuf, jeanbrun_ancien, denormandie, " +
            "loc_avantages. Tu peux aussi passer le nom d'un dispositif clos (pinel, " +
            "censi-bouvard, scellier, cosse, duflot, borloo…) pour savoir s'il existe encore. " +
            "Omets ce paramètre pour obtenir la liste de tout ce qui est ouvert.",
        },
        prix_acquisition: {
          type: 'number',
          description:
            "Prix d'acquisition NET DE FRAIS en € (prix + frais de notaire). Sa présence " +
            "bascule l'outil en mode calcul. Ne l'invente pas : demande-le.",
        },
        travaux: {
          type: 'number',
          description:
            "Montant des travaux facturés par une entreprise, en €. Indispensable au " +
            "Jeanbrun ancien et au Denormandie, qui imposent tous deux un seuil de travaux.",
        },
        surface_m2:     { type: 'number', description: 'Surface habitable en m².' },
        surface_annexes_m2: {
          type: 'number',
          description: "Surface des annexes en m² (balcon, cave…). Sert à la surface fiscale de Loc'Avantages.",
        },
        zone: {
          type: 'string',
          enum: ['Abis', 'A', 'B1', 'B2', 'C'],
          description: "Zone A/B/C. Si tu ne l'as pas, appelle d'abord get_zonage_abc.",
        },
        code_insee: { type: 'string', description: "Code INSEE, requis pour le plafond de loyer communal Loc'Avantages." },
        niveau_loyer: {
          type: 'string',
          enum: ['intermediaire', 'social', 'tres_social'],
          description: 'Niveau de loyer conventionné (défaut : intermédiaire). Détermine le taux.',
        },
        tmi: {
          type: 'number',
          enum: [0, 11, 30, 41, 45],
          description: "Taux marginal d'imposition en %. Défaut 30. Décisif pour un amortissement.",
        },
        loyer_mensuel: { type: 'number', description: 'Loyer mensuel hors charges envisagé en €, pour vérifier le plafond.' },
        duree_engagement: {
          type: 'number',
          enum: [6, 9],
          description: "Denormandie uniquement : durée de l'engagement initial. Il n'existe pas d'engagement de 12 ans.",
        },
        prorogations: {
          type: 'number',
          enum: [0, 1, 2],
          description: 'Denormandie : périodes triennales de prorogation envisagées.',
        },
        intermediation_locative: {
          type: 'boolean',
          description: "Loc'Avantages : passage par un organisme agréé. Ouvre les taux majorés et, seul, le niveau très social.",
        },
        habitat_collectif: { type: 'boolean', description: "Le logement est-il dans un immeuble collectif ? Exigé par le Jeanbrun." },
        dpe_apres_travaux: { type: 'string', description: 'Classe DPE après travaux (A→G). Le Jeanbrun ancien exige A ou B.' },
        date_acquisition: { type: 'string', description: "Date d'acquisition au format AAAA-MM-JJ, pour contrôler les fenêtres." },
      },
    },
    // Même omission que sur get_analyse_predictive : sans ce champ, aucune
    // conversation ne démarre.
    available_in_modes: ['advanced', 'report'],
  },
  {
    name: 'get_bilan_promoteur',
    description:
      "BILAN FINANCIER de l'opération promoteur en cours : prix de revient total, chiffre " +
      "d'affaires prévisionnel, marge nette en euros et en pourcentage du CA, prix du foncier, " +
      "fonds propres, crédit de promotion et sa durée, ROI et TRI. " +
      "UTILISE CET OUTIL dès que la question porte sur l'équilibre financier de l'opération : " +
      "« quelle marge ? », « est-ce que ça passe ? », « quel est mon prix de revient ? », " +
      "« combien je peux payer le terrain ? ». " +
      "⚠️ CET OUTIL NE CALCULE RIEN — il LIT le bilan tel que la page l'a enregistré. Si aucun " +
      "bilan n'a encore été produit pour l'opération, il te le dit : propose alors " +
      "action_lancer_etape('bilan') plutôt que d'estimer toi-même. N'invente jamais une marge : " +
      "un chiffre d'affaires prévisionnel faux se propage dans toute la décision d'achat. " +
      "⚠️ CONVENTION DE MARGE : le taux de marge promoteur est calculé en pourcentage du CHIFFRE " +
      "D'AFFAIRES, pas du coût de revient. 15 % ici correspondent à environ 17,6 % dans la " +
      "convention marchand de biens : ne compare jamais les deux directement.",
    input_schema: {
      type: 'object',
      properties: {
        study_id: {
          type: 'string',
          description:
            "Identifiant de l'opération. Omets-le pour utiliser l'opération active du contexte " +
            '`promoteur_chain.study_id`, ce qui est le cas normal.',
        },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_contacts_mairies',
    description:
      "CONTACTS DES MAIRIES d'un secteur, avec les MAIRES en exercice : nom et prénom du maire, " +
      "email de la mairie, téléphone, adresse postale, code INSEE, code postal et distance au " +
      "point de recherche. Un rayon en kilomètres autour d'une commune permet de balayer tout un " +
      "bassin (« les mairies dans un rayon de 10 km autour du projet »). " +
      "UTILISE CET OUTIL dès que l'utilisateur veut savoir QUI contacter, où écrire ou téléphoner : " +
      "prise de rendez-vous en mairie, sollicitation du service urbanisme, prospection foncière " +
      "auprès des communes d'un secteur, recherche d'un élu. " +
      "⚠️ N'INVENTE JAMAIS un nom de maire, une adresse email ni un numéro de téléphone : ce sont " +
      "des données nominatives, une erreur envoie l'utilisateur vers le mauvais interlocuteur. Si " +
      "l'outil ne renvoie pas le champ, dis qu'il n'est pas disponible. " +
      "Les mairies sans email renvoient emailMairie à null — signale-le plutôt que de le combler. " +
      "Pour l'envoi groupé d'emails et l'export, propose la page '/promoteur/recherche-contacts' " +
      "via action_ouvrir_page. Cite [source: annuaire des mairies / RNE].",
    input_schema: {
      type: 'object',
      properties: {
        code_insee: { type: 'string', pattern: PATTERN_INSEE, description: DESC_CODE_INSEE },
        commune:    { type: 'string', description: 'Nom de la commune de référence (repli).' },
        zip_code:   { type: 'string', description: 'Code postal (repli).' },
        rayon_km:   {
          type: 'number',
          description:
            "Rayon de recherche en km autour de la commune de référence (1 à 50). " +
            "Omets-le ou mets 0 pour n'obtenir que la commune elle-même.",
        },
        limite: { type: 'number', description: 'Nombre maximum de mairies retournées (défaut 40, max 100).' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_contexte_commune',
    description:
      "CONTEXTE TERRITORIAL ÉDITORIAL d'une commune (Wikidata + Wikipédia) : situation " +
      "géographique, patrimoine, tourisme, transports, histoire. Sert UNIQUEMENT à donner de la " +
      "couleur et du contexte narratif à une analyse (introduction d'un rapport, présentation d'un " +
      "secteur, compréhension d'un territoire qu'on ne connaît pas). " +
      "⚠️ CE N'EST PAS UNE SOURCE RÉGLEMENTAIRE NI STATISTIQUE : n'en tire aucune règle " +
      "d'urbanisme, aucun chiffre de marché, aucun risque, aucune donnée fiscale — pour cela, " +
      "utilise les outils dédiés (get_parcel_plu, get_dvf_comparables, get_risks_georisques, " +
      "get_taxes_locales…). Le contenu est encyclopédique, potentiellement daté et non vérifié. " +
      "⚠️ N'utilise que le nom de commune renvoyé par cet outil : ne traduis JAMAIS un code INSEE " +
      "en nom de commune de mémoire. Cite [source: Wikipédia].",
    input_schema: {
      type: 'object',
      properties: {
        code_insee: { type: 'string', pattern: PATTERN_INSEE, description: DESC_CODE_INSEE },
        commune:    { type: 'string', description: 'Nom de la commune (repli).' },
        zip_code:   { type: 'string', description: 'Code postal (repli).' },
      },
    },
    available_in_modes: ['advanced', 'report'],
  },
  {
    name: 'creer_zone_veille',
    description:
      "ACTION — CRÉE une veille IMMOBILIÈRE géographique : une commune, éventuellement avec un " +
      "rayon, sur laquelle l'utilisateur sera alerté (mouvements de marché, biens qui sortent). " +
      "⚠️ AMBIGUÏTÉ À LEVER AVANT TOUT APPEL : « surveiller un secteur » peut vouloir dire DEUX " +
      "choses très différentes chez Mimmoza — une veille IMMOBILIÈRE (biens, marché) ou une veille " +
      "APPELS D'OFFRES (marchés publics, cessions foncières, cf. creer_veille_appels_offres). " +
      "Si l'utilisateur n'a pas dit clairement laquelle, tu lui POSES la question avant d'appeler " +
      "quoi que ce soit. N'appelle cet outil que pour la veille IMMOBILIÈRE, et seulement une fois " +
      "l'intention confirmée. " +
      "⚠️ DEUX TEMPS OBLIGATOIRES. Premier appel SANS `confirmer` : rien n'est écrit, l'outil " +
      "renvoie un APERÇU exact de ce qui serait créé. Tu PRÉSENTES cet aperçu à l'utilisateur et tu " +
      "lui demandes de valider. Second appel avec `confirmer: true` UNIQUEMENT après un accord " +
      "EXPLICITE de sa part dans le message suivant. Ne mets JAMAIS `confirmer: true` au premier " +
      "appel, même si la demande semble claire : une écriture ne doit jamais être l'effet de bord " +
      "d'une question mal comprise. " +
      "Après création, annonce ce qui a été créé et rappelle que la zone peut être désactivée avec " +
      "desactiver_zone_veille.",
    input_schema: {
      type: 'object',
      properties: {
        commune:   { type: 'string', description: "Nom de la commune à surveiller (ou code INSEE dans code_insee)." },
        code_insee:{ type: 'string', pattern: PATTERN_INSEE, description: DESC_CODE_INSEE },
        libelle:   { type: 'string', description: "Nom donné à la veille par l'utilisateur. À défaut, le nom de la commune est utilisé." },
        rayon_m:   { type: 'number', description: "Rayon de surveillance en mètres autour du point (100 à 50000)." },
        lat:       { type: 'number' },
        lng:       { type: 'number' },
        confirmer: { type: 'boolean', description: "true UNIQUEMENT après accord explicite de l'utilisateur sur l'aperçu." },
      },
      // ⚠️ Une zone de veille immobilière est une COMMUNE (+ rayon facultatif).
      //    Elle ne porte NI type de bien, NI fourchette de prix, NI surface, NI
      //    département entier. Si l'utilisateur demande « les appartements du 64 »,
      //    dis-lui ce que cet outil sait faire et ce qu'il ne sait pas faire, au
      //    lieu d'afficher un aperçu contenant des critères qui seront perdus.
      required: ['commune'],
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'creer_watchlist',
    description:
      "ACTION — CRÉE une ou plusieurs WATCHLISTS de biens : des critères de recherche (type de bien, " +
      "fourchette de prix, de surface, score minimal) sur une ou plusieurs COMMUNES. C'est l'outil " +
      "pour « alerte-moi sur les appartements à moins de 300 000 € à Bayonne ». " +
      "⚠️ UNE WATCHLIST = UNE COMMUNE. La table ne connaît ni département, ni région, ni rayon. Si " +
      "l'utilisateur demande « les appartements du 64 » ou « dans les Landes », tu NE peux PAS créer " +
      "une entrée départementale : DIS-LE, et demande-lui quelles communes l'intéressent. Tu peux " +
      "alors en passer plusieurs d'un coup dans `communes` — une watchlist sera créée par commune. " +
      "Ne propose pas toi-même une liste de communes « représentatives » du département : c'est à " +
      "l'utilisateur de choisir son terrain de chasse. " +
      "⚠️ À NE PAS CONFONDRE avec creer_zone_veille (zone géographique immobilière, sans critère de " +
      "bien) ni avec creer_veille_appels_offres (marchés publics). " +
      "Protocole en deux temps : premier appel sans `confirmer` = aperçu de TOUTES les watchlists " +
      "qui seraient créées, aucune écriture ; second appel avec `confirmer: true` après accord.",
    input_schema: {
      type: 'object',
      properties: {
        communes:     { type: 'array', items: { type: 'string' }, description: "Noms de communes (une watchlist par commune)." },
        libelle:      { type: 'string', description: "Nom de la recherche. Le nom de la commune y est ajouté si plusieurs." },
        type_bien:    { type: 'string', description: "Ex. « appartement », « maison », « terrain ». Valeur libre." },
        prix_min:     { type: 'number' },
        prix_max:     { type: 'number' },
        surface_min:  { type: 'number', description: 'En m².' },
        surface_max:  { type: 'number', description: 'En m².' },
        score_min:    { type: 'number', description: "Score d'opportunité minimal (0-100)." },
        confirmer:    { type: 'boolean' },
      },
      required: ['communes'],
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'lister_watchlists',
    description:
      "Liste les watchlists de biens de l'utilisateur (actives par défaut) avec leurs critères. " +
      "À appeler avant d'en créer une (doublon), pour répondre « qu'est-ce que je recherche ? », ou " +
      "pour retrouver un identifiant à désactiver. " +
      "⚠️ NE VOIT NI les zones de veille immobilière, NI les veilles appels d'offres : une réponse " +
      "vide signifie « aucune watchlist », jamais « aucune veille ». Lecture seule.",
    input_schema: {
      type: 'object',
      properties: { inclure_inactives: { type: 'boolean' } },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'desactiver_watchlist',
    description:
      "ACTION — DÉSACTIVE une watchlist de biens (is_active = false), sans la supprimer. " +
      "Protocole en deux temps, identifiant obtenu via lister_watchlists — jamais inventé.",
    input_schema: {
      type: 'object',
      properties: {
        watchlist_id: { type: 'string' },
        confirmer:    { type: 'boolean' },
      },
      required: ['watchlist_id'],
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'creer_veille_appels_offres',
    description:
      "ACTION — CRÉE une veille APPELS D'OFFRES : mémorise des critères de recherche BOAMP " +
      "(départements, catégories, mots-clés) pour que l'utilisateur soit alerté des nouveaux avis. " +
      "À distinguer de creer_zone_veille, qui surveille le MARCHÉ IMMOBILIER : si la demande de " +
      "l'utilisateur est ambiguë (« surveille Bayonne »), POSE-LUI la question avant d'appeler. " +
      "Catégories : `foncier` (cessions de terrains publics, AMI, concessions d'aménagement), " +
      "`travaux` (construction, réhabilitation), `moe` (maîtrise d'œuvre, signal précoce). " +
      "⚠️ Une veille doit avoir une PORTÉE : au moins un département, ou un texte de recherche. " +
      "Sans quoi elle balaierait la France entière à chaque passage et noierait l'utilisateur — la " +
      "base refusera l'insertion. " +
      "⚠️ MÊME PROTOCOLE EN DEUX TEMPS que les autres verbes : premier appel sans `confirmer` = " +
      "aperçu, aucune écriture ; second appel avec `confirmer: true` seulement après accord " +
      "EXPLICITE. Ne mets jamais `confirmer: true` au premier appel.",
    input_schema: {
      type: 'object',
      properties: {
        libelle:      { type: 'string', description: "Nom de la veille (ex. « Foncier public Pays basque »)." },
        departements: { type: 'array', items: { type: 'string' }, description: "Codes département (ex. [\"64\",\"40\"])." },
        categories:   { type: 'array', items: { type: 'string', enum: ['foncier', 'travaux', 'moe'] } },
        texte:        { type: 'string', description: "Mots-clés recherchés dans l'objet de l'avis." },
        frequence:    { type: 'string', enum: ['daily', 'weekly'] },
        confirmer:    { type: 'boolean' },
      },
      required: ['libelle'],
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_veille_marche',
    description:
      "ÉTAT DU MARCHÉ SUR UNE ZONE SURVEILLÉE : nombre d'annonces actives, nouvelles annonces " +
      "des 7 derniers jours, prix médian au m², délai médian de vente, et deux signaux de " +
      "synthèse (liquidité, tension). Peut aussi renvoyer un échantillon d'annonces avec leur " +
      "lien. " +
      "UTILISE CET OUTIL pour « quoi de neuf sur ma veille ? », « comment évolue le marché à " +
      "X ? », « combien d'annonces en ce moment ? », « le marché se tend ou se détend ? ». " +
      "⚠️ NE CONFONDS PAS avec lister_nouveautes_appels_offres, qui concerne les MARCHÉS PUBLICS. " +
      "Ici il s'agit de la veille IMMOBILIÈRE : des annonces de biens à vendre ou à louer. " +
      "⚠️ Ces chiffres décrivent les ANNONCES en ligne, pas les ventes réalisées : un prix " +
      "médian d'annonces est un prix DEMANDÉ, supérieur au prix de transaction. Pour du prix de " +
      "vente réel, c'est get_dvf_comparables. Dis-le si tu compares les deux. " +
      "Si la zone n'a jamais été alimentée, l'outil renvoie zéro annonce : propose alors " +
      "creer_zone_veille, ou l'ouverture de '/veille/marche' via action_ouvrir_page.",
    input_schema: {
      type: 'object',
      properties: {
        code_postal: { type: 'string', description: "Code postal de la zone (le plus fiable)." },
        commune:     { type: 'string', description: "Nom de commune, si le code postal est inconnu." },
        mode: {
          type: 'string',
          enum: ['all', 'sale', 'rent'],
          description: "Ventes, locations, ou les deux. Par défaut : ventes.",
        },
        avec_annonces: {
          type: 'boolean',
          description: "Joindre un échantillon d'annonces avec leur lien (défaut : non).",
        },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'modifier_veille_appels_offres',
    description:
      "ACTION — MODIFIE une veille APPELS D'OFFRES existante : son libellé, ses départements, " +
      "ses catégories ou son texte de recherche. À utiliser pour « ajoute le 40 à ma veille », " +
      "« renomme-la », « enlève la catégorie travaux », « change les mots-clés ». " +
      "Sert aussi à RÉACTIVER une veille désactivée : passe `actif: true`. " +
      "Ne transmets QUE les champs à changer : ceux que tu omets restent inchangés. " +
      "⚠️ Les listes sont REMPLACÉES, pas fusionnées. Pour ajouter un département à une veille " +
      "qui en a déjà, appelle d'abord lister_veilles_appels_offres, lis la liste actuelle, et " +
      "renvoie la liste COMPLÈTE — sinon tu effaces silencieusement les autres. " +
      "Protocole en deux temps : premier appel sans `confirmer` = aperçu de l'avant/après, " +
      "aucune modification ; second appel avec `confirmer: true` après accord explicite. " +
      "Obtiens l'identifiant via lister_veilles_appels_offres — ne l'invente JAMAIS.",
    input_schema: {
      type: 'object',
      properties: {
        veille_id:    { type: 'string', description: "UUID de la veille, via lister_veilles_appels_offres." },
        libelle:      { type: 'string', description: "Nouveau nom de la veille." },
        departements: { type: 'array', items: { type: 'string' }, description: "Liste COMPLÈTE des codes département (remplace l'ancienne)." },
        categories:   { type: 'array', items: { type: 'string', enum: ['foncier', 'travaux', 'moe'] }, description: "Liste COMPLÈTE des catégories (remplace l'ancienne)." },
        texte:        { type: 'string', description: "Nouveaux mots-clés recherchés dans l'objet de l'avis." },
        actif:        { type: 'boolean', description: "true pour RÉACTIVER une veille désactivée, false pour la désactiver." },
        confirmer:    { type: 'boolean' },
      },
      required: ['veille_id'],
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'desactiver_veille_appels_offres',
    description:
      "ACTION — DÉSACTIVE une veille APPELS D'OFFRES (is_active = false). Réversible : la ligne " +
      "n'est pas supprimée. " +
      "⚠️ NE CONFONDS PAS avec desactiver_zone_veille, qui ne concerne QUE les veilles " +
      "IMMOBILIÈRES et ne verra jamais une veille appels d'offres. " +
      "Protocole en deux temps : premier appel sans `confirmer` = aperçu de la veille visée, " +
      "aucune modification ; second appel avec `confirmer: true` après accord explicite. " +
      "Obtiens l'identifiant via lister_veilles_appels_offres — ne l'invente JAMAIS.",
    input_schema: {
      type: 'object',
      properties: {
        veille_id: { type: 'string', description: "UUID de la veille, via lister_veilles_appels_offres." },
        confirmer: { type: 'boolean' },
      },
      required: ['veille_id'],
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'lister_nouveautes_appels_offres',
    description:
      "NOUVEAUTÉS détectées par les veilles appels d'offres de l'utilisateur depuis le dernier " +
      "passage : avis BOAMP jamais encore signalés, avec l'objet, l'acheteur, la date limite, les " +
      "jours restants et le lien. À appeler pour « quoi de neuf ? », « des nouveautés sur mes " +
      "veilles ? », « qu'est-ce qui est sorti cette semaine ? », ou spontanément en début de " +
      "conversation SI l'utilisateur demande un point de situation. " +
      "Par défaut, seules les nouveautés NON LUES sont renvoyées, les plus urgentes d'abord. " +
      "⚠️ Ces avis ont été captés au moment du passage de la veille : une DATE LIMITE peut avoir " +
      "été franchie depuis. Fie-toi au champ jours_restants recalculé, et signale explicitement " +
      "tout avis dont le délai est dépassé ou inférieur à 3 jours. " +
      "⚠️ Un avis marqué zone_incertaine a été diffusé sur plusieurs départements sans préciser le " +
      "lieu des travaux : dis-le pour ceux-là. " +
      "Le champ lien_markdown contient DÉJÀ un lien complet : colle-le tel quel, seul dans sa cellule, " +
      "sans crochets supplémentaires et sans y accoler la citation [source: BOAMP], qui va dans une " +
      "phrase à part. Après présentation, propose de marquer " +
      "les nouveautés comme lues avec marquer_nouveautes_lues.",
    input_schema: {
      type: 'object',
      properties: {
        inclure_lues: { type: 'boolean', description: "Inclure aussi les nouveautés déjà consultées." },
        limite:       { type: 'number', description: "Nombre maximum d'avis renvoyés (1-50, défaut 20)." },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'marquer_nouveautes_lues',
    description:
      "ACTION — marque comme lues les nouveautés de veille appels d'offres, pour qu'elles ne " +
      "reviennent plus. Sans paramètre, marque TOUTES les nouveautés non lues ; avec `avis_ids`, " +
      "seulement celles-là. Action bénigne et réversible côté produit, mais elle modifie l'état : " +
      "ne l'appelle QUE si l'utilisateur le demande ou accepte ta proposition — jamais " +
      "automatiquement après un affichage.",
    input_schema: {
      type: 'object',
      properties: {
        avis_ids: { type: 'array', items: { type: 'string' }, description: "Identifiants d'avis (champ id renvoyé par lister_nouveautes_appels_offres). Omettre = tout marquer." },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'lister_veilles_appels_offres',
    description:
      "Liste les veilles appels d'offres de l'utilisateur. À appeler avant d'en créer une (doublon) " +
      "ou quand il demande ce qu'il surveille côté marchés publics. Lecture seule.",
    input_schema: {
      type: 'object',
      properties: { inclure_inactives: { type: 'boolean' } },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'lister_zones_veille',
    description:
      "Liste les zones de veille IMMOBILIÈRE de l'utilisateur (actives par défaut). À appeler avant " +
      "de créer une zone pour éviter un doublon, ou pour retrouver l'identifiant d'une zone à " +
      "désactiver. Lecture seule. " +
      "⚠️ CET OUTIL NE VOIT PAS les veilles APPELS D'OFFRES, qui vivent ailleurs " +
      "(lister_veilles_appels_offres). Une réponse vide signifie « aucune veille IMMOBILIÈRE », " +
      "JAMAIS « aucune veille » : ne conclus pas qu'une veille appels d'offres n'existe pas ou n'a " +
      "pas été enregistrée sur la foi de cet outil. Si l'utilisateur demande « tout ce que je " +
      "surveille », appelle LES DEUX outils.",
    input_schema: {
      type: 'object',
      properties: {
        inclure_inactives: { type: 'boolean', description: "Inclure aussi les zones désactivées." },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'desactiver_zone_veille',
    description:
      "ACTION — DÉSACTIVE une zone de veille (is_active = false). Réversible : la ligne n'est pas " +
      "supprimée. Même protocole en deux temps que creer_zone_veille : premier appel sans " +
      "`confirmer` pour l'aperçu, second avec `confirmer: true` après accord explicite. " +
      "Utilise lister_zones_veille pour obtenir l'identifiant : ne l'invente JAMAIS.",
    input_schema: {
      type: 'object',
      properties: {
        zone_id:   { type: 'string', description: "Identifiant (UUID) de la zone, obtenu via lister_zones_veille." },
        confirmer: { type: 'boolean' },
      },
      required: ['zone_id'],
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_appels_offres',
    description:
      "APPELS D'OFFRES PUBLICS ENCORE OUVERTS auxquels un promoteur, un aménageur ou un contractant " +
      "général peut répondre, lus au BOAMP (Bulletin officiel des annonces des marchés publics). " +
      "Renvoie pour chaque avis : l'objet, l'acheteur public, le type de marché, la procédure, la " +
      "DATE LIMITE DE RÉPONSE, le nombre de JOURS RESTANTS et l'URL de l'avis officiel. " +
      "Trois catégories, cumulables via le paramètre `categories` (par défaut les trois) : " +
      "`foncier` = le gisement d'un promoteur (cessions de terrains publics, appels à manifestation " +
      "d'intérêt, concessions d'aménagement, consultations promoteurs, baux emphytéotiques) ; " +
      "`travaux` = marchés de construction, réhabilitation, VRD ; " +
      "`moe` = maîtrise d'œuvre, AMO, études de faisabilité, utile comme SIGNAL PRÉCOCE d'un projet " +
      "public avant qu'il ne sorte en travaux. " +
      "Filtre géographique par `departements` (ex. [\"64\",\"40\"]) — sans ce paramètre la recherche " +
      "porte sur la FRANCE ENTIÈRE. Si l'utilisateur dit « ici », « dans le coin » ou « autour de " +
      "cette parcelle », déduis le département des 2 premiers chiffres du code INSEE du contexte et " +
      "passe-le ; sinon DEMANDE la zone plutôt que de balayer la France entière sans le dire. " +
      "`texte` ajoute une recherche libre dans l'objet (ex. « logements sociaux », « friche »). " +
      "⚠️ COUVERTURE — le BOAMP ne recense PAS toutes les cessions foncières : beaucoup passent par " +
      "les sites des collectivités, des EPF ou des SEM. Le champ géographique de la base est en " +
      "outre lacunaire. Une absence de résultat n'est donc JAMAIS une preuve d'absence " +
      "d'opportunité — dis-le, et propose d'élargir la zone ou de retirer un filtre. " +
      "⚠️ N'invente jamais un avis, un acheteur ni une date limite, et n'affirme pas qu'un candidat " +
      "est éligible : l'éligibilité se lit dans le règlement de consultation. " +
      "Cite [source: BOAMP] et donne l'URL de l'avis pour que l'utilisateur puisse candidater.",
    input_schema: {
      type: 'object',
      properties: {
        departements: {
          type: 'array', items: { type: 'string' },
          description: "Codes département sur 2 caractères (ex. [\"64\",\"40\"], Corse \"2A\"/\"2B\"). Omettre = France entière.",
        },
        categories: {
          type: 'array', items: { type: 'string', enum: ['foncier', 'travaux', 'moe'] },
          description: "Par défaut les trois.",
        },
        texte:     { type: 'string', description: "Recherche libre dans l'objet de l'avis." },
        limite:    { type: 'number', description: "Nombre d'avis renvoyés (1-50, défaut 15)." },
        jours_min: { type: 'number', description: "N'affiche que les avis dont la clôture est à plus de N jours." },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_zonage_plu',
    description:
      "ZONAGE D'URBANISME OPPOSABLE AU POINT, lu directement dans le Géoportail de l'urbanisme " +
      "(source officielle, aucune importation préalable nécessaire) : code de la zone (UA, UD, 1AU, " +
      "A, N…), son libellé long, son TYPE réglementaire (U urbaine / AU à urbaniser / A agricole / " +
      "N naturelle) avec le sens de ce type en matière de constructibilité, la référence du document " +
      "d'urbanisme et du règlement, et sa date de validité. Renvoie aussi deux informations " +
      "structurantes sur la commune : au_rnu (la commune n'a AUCUN document d'urbanisme, elle est au " +
      "Règlement National d'Urbanisme, la constructibilité est alors très restreinte hors parties " +
      "urbanisées) et commune_littorale (la loi Littoral s'applique et PRIME sur le PLU). " +
      "C'EST L'OUTIL À UTILISER EN PREMIER pour toute question de constructibilité d'un terrain " +
      "(« est-ce constructible ? », « en quelle zone suis-je ? », « puis-je construire ici ? »). " +
      "⚠️ IL DONNE LA CONSTRUCTIBILITÉ DE PRINCIPE, PAS LES RÈGLES CHIFFRÉES : hauteur maximale, " +
      "emprise au sol, retraits, stationnement se lisent dans le RÈGLEMENT ÉCRIT — pour cela utilise " +
      "get_parcel_plu (règlement importé sur la page Foncier). N'invente jamais une règle chiffrée à " +
      "partir du seul code de zone. " +
      "⚠️ Le GPU ne contient que ce que la collectivité a numérisé : une absence de zonage n'est PAS " +
      "une preuve d'absence de PLU, et encore moins une preuve de constructibilité. " +
      "⚠️ Exige une localisation PRÉCISE (coordonnées ou parcelle) : un zonage change d'une rue à " +
      "l'autre, il ne se déduit jamais d'un centre de commune — si seule la commune est connue, " +
      "dis-le et ne réponds pas au niveau parcellaire. " +
      "Cite [source: Géoportail de l'urbanisme].",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id:     { type: 'string' },
        cadastral_ref: { type: 'string', description: 'Identifiant cadastral IDU (résolu en centroïde parcelle).' },
        lat:           { type: 'number', description: 'Latitude du point (prioritaire).' },
        lng:           { type: 'number', description: 'Longitude du point.' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'get_prescriptions_urbanisme',
    description:
      "PRESCRIPTIONS ET INFORMATIONS D'URBANISME AU POINT (Géoportail de l'urbanisme) : tout ce que " +
      "le PLU grève ou impose sur ce terrain précis, en plus du zonage — espaces boisés classés, " +
      "emplacements réservés, servitudes de mixité sociale (part de logements sociaux imposée), " +
      "prescriptions de hauteur, règles de stationnement spécifiques, protections patrimoniales ou " +
      "paysagères, reculs et alignements, obligations de végétalisation ou de pleine terre, secteurs " +
      "particuliers. Chaque prescription est renvoyée avec son LIBELLÉ OFFICIEL, sa portée " +
      "(surfacique / linéaire / ponctuelle), ses codes CNIG bruts, et lorsqu'un mot-clé le permet un " +
      "champ enjeu_probable qui explique l'impact opérationnel. " +
      "UTILISE CET OUTIL dès qu'on évalue la FAISABILITÉ RÉELLE d'un projet : c'est ici que se " +
      "cachent les contraintes qui tuent une opération (terrain grevé d'un emplacement réservé, EBC " +
      "inconstructible, part de logement social imposée, hauteur plafonnée). " +
      "⚠️ enjeu_probable est une lecture HEURISTIQUE par mots-clés, pas une interprétation " +
      "juridique : présente-le comme une piste à vérifier au règlement, jamais comme une règle. " +
      "Les codes typepsc/stypepsc sont relayés bruts et ne doivent PAS être décodés de mémoire. " +
      "⚠️ LE DROIT DE PRÉEMPTION (DPU) ET LES ZAD NE FIGURENT PAS dans ces couches : si on te pose la " +
      "question de la préemption, dis explicitement que cette donnée n'est pas publiée au GPU et " +
      "renvoie au service urbanisme de la mairie. Ne conclus JAMAIS à l'absence de préemption. " +
      "⚠️ Une absence de prescription n'est pas une preuve d'absence de contrainte (numérisation " +
      "partielle). Cite [source: Géoportail de l'urbanisme].",
    input_schema: {
      type: 'object',
      properties: {
        parcel_id:     { type: 'string' },
        cadastral_ref: { type: 'string', description: 'Identifiant cadastral IDU (résolu en centroïde parcelle).' },
        lat:           { type: 'number', description: 'Latitude du point (prioritaire).' },
        lng:           { type: 'number', description: 'Longitude du point.' },
        limite:        { type: 'number', description: 'Nombre maximum de prescriptions détaillées (défaut 25, max 40).' },
      },
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },

  // ===========================================================================
  // OUTILS D'ACTION — le copilote pilote la chaîne promoteur.
  //
  // ⚠️  Ces outils N'ÉCRIVENT RIEN ici, contrairement aux verbes ci-dessus qui
  //     écrivent sous l'identité de l'utilisateur. Ils renvoient une
  //     *proposition* que le FRONT exécute avec la session de l'utilisateur :
  //     les écritures passent par RLS, la provenance (vous / l'agent) est
  //     tracée à l'écriture, et une hallucination du modèle ne peut pas
  //     corrompre une étude — au pire elle propose une action refusée.
  //
  //     L'état de la chaîne (étapes prêtes / périmées / bloquées) arrive par le
  //     contexte `promoteur_chain`, pas par un outil : c'est une lecture
  //     systématique, inutile de la laisser à la décision du modèle.
  // ===========================================================================
  {
    name: 'action_ouvrir_page',
    description:
      "ACTION — propose d'OUVRIR une page de l'application. À utiliser quand la réponse utile n'est " +
      "pas un texte mais un écran : l'utilisateur veut voir, saisir ou vérifier quelque chose. Ne " +
      "l'utilise pas pour illustrer un propos — uniquement quand ouvrir la page est l'action " +
      "attendue. Si l'utilisateur demande à OUVRIR une page ou un onglet (« ouvre l'étude de " +
      "marché », « ouvre l'onglet PLU »), propose cette action immédiatement — même sans parcelle " +
      "ni étude en contexte : la page s'occupe de la saisie. Ne demande pas d'adresse ou de " +
      "parcelle avant d'ouvrir. Si l'utilisateur demande à VOIR une étude en détail, utilise cette " +
      "action plutôt que de résumer. Rien n'est écrit : l'utilisateur confirme avant que la page " +
      "s'ouvre.\n\n" +
      "La route doit être EXACTEMENT l'un des chemins ci-dessous, ou venir de " +
      "`promoteur_chain.steps[].route`. N'invente jamais de chemin : toute route absente de cette " +
      "liste est rejetée. Tu peux ajouter des query params (`?study=<id>` quand une opération est " +
      "active dans `promoteur_chain`, `?tab=`, `&highlight=pdf` pour mettre en avant la génération " +
      "du rapport PDF).\n\n" +
      routeCatalogue(),
    input_schema: {
      type: 'object',
      properties: {
        route:  { type: 'string', description: "Chemin interne, commençant par '/'." },
        raison: { type: 'string', description: "Pourquoi cette page, en une phrase, pour l'utilisateur." },
      },
      required: ['route', 'raison'],
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'action_creer_operation',
    description:
      "ACTION — propose de CRÉER une opération promoteur (étude) et d'y poser le foncier. À utiliser " +
      "quand l'utilisateur veut étudier un terrain ou monter une opération et qu'aucune opération " +
      "active n'apparaît dans `promoteur_chain`. Renseigne commune_insee et parcel_ids dès que tu " +
      "les connais : sans eux l'étape foncier restera à compléter à la main et rien ne pourra " +
      "s'enchaîner. ⚠️ À NE PAS CONFONDRE avec creer_zone_veille (surveillance d'un secteur) ni " +
      "creer_watchlist (critères de recherche de biens) : ici on ouvre un DOSSIER D'OPÉRATION.",
    input_schema: {
      type: 'object',
      properties: {
        titre:         { type: 'string', description: "Nom de l'opération, court et parlant." },
        commune_insee: { type: 'string', pattern: PATTERN_INSEE, description: DESC_CODE_INSEE },
        commune_nom:   { type: 'string' },
        parcel_ids:    { type: 'array', items: { type: 'string' }, description: 'Identifiants cadastraux.' },
        surface_m2:    { type: 'number', description: 'Surface totale du foncier.' },
      },
      required: ['titre'],
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
  {
    name: 'action_lancer_etape',
    description:
      "ACTION — propose de LANCER une étape de la chaîne promoteur (enveloppe, programmation, bilan, " +
      "synthèse…). ⚠️ Cet outil ne couvre QUE la chaîne promoteur : pour les espaces marchand de " +
      "bien, particulier, réhabilitation et assurance, il n'existe pas de chaîne d'étapes — utilise " +
      "`action_ouvrir_page` avec la route correspondante. N'appelle JAMAIS cet outil sur une étape dont `runnable` est false dans " +
      "`promoteur_chain` : explique d'abord ce qui la bloque et propose l'étape amont. Utilise-le " +
      "aussi pour relancer une étape passée en `stale` après modification d'une étape amont. " +
      "⚠️ Le calcul est fait par la PAGE de l'étape, pas par toi : n'annonce jamais un résultat " +
      "avant qu'il existe.",
    input_schema: {
      type: 'object',
      properties: {
        step:   { type: 'string', enum: ['foncier', 'plu', 'marche', 'risques', 'enveloppe', 'programmation', 'bilan', 'synthese'] },
        raison: { type: 'string', description: "Ce que cette étape va produire, en une phrase." },
      },
      required: ['step', 'raison'],
    },
    available_in_modes: ['quick', 'advanced', 'report'],
  },
];

/**
 * Outils disponibles pour un mode donné.
 *
 * Le filtre est volontairement défensif. `available_in_modes` est déclaré
 * obligatoire dans ToolDef, mais rien ne le vérifie à la compilation : ce
 * fichier tourne sous Deno et n'est pas couvert par le tsconfig du front. Deux
 * outils ont été ajoutés sans ce champ, et `undefined.includes(mode)` faisait
 * échouer TOUTE conversation, quel que soit le sujet — un oubli d'une ligne
 * rendait le copilote entièrement muet.
 *
 * Un outil mal déclaré est désormais écarté et signalé, plutôt que d'emporter
 * le reste avec lui : perdre un outil est un incident, perdre le chat en est
 * un autre.
 */
function toolsForMode(mode: CopilotMode): ToolDef[] {
  return TOOLS.filter((t) => {
    if (!Array.isArray(t.available_in_modes)) {
      console.error(
        `[copilot-chat] outil « ${t?.name ?? '?'} » sans available_in_modes : ignoré. ` +
          'Ajoute le champ dans sa déclaration.',
      );
      return false;
    }
    return t.available_in_modes.includes(mode);
  });
}

// =============================================================
// EXÉCUTION DES TOOLS — retourne toujours un ToolResult normalisé
// =============================================================

// Identite AUTHENTIFIEE, issue du JWT verifie par requireUserId() — jamais de
// ctx.user.id, que le front remplit et qu'un client malveillant peut falsifier.
// authHeader sert a ecrire via getUserClient() : les politiques RLS s'appliquent
// alors normalement, ce que getAdmin() court-circuiterait.
interface AuthCtx { userId: string; authHeader: string }

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: MimmozaContext,
  auth: AuthCtx | null = null,
): Promise<ToolResult> {
  switch (name) {
    case 'creer_zone_veille':        return await toolCreerZoneVeille(input, ctx, auth);
    case 'creer_watchlist':          return await toolCreerWatchlist(input, ctx, auth);
    case 'lister_watchlists':        return await toolListerWatchlists(input, ctx, auth);
    case 'desactiver_watchlist':     return await toolDesactiverWatchlist(input, ctx, auth);
    case 'creer_veille_appels_offres':   return await toolCreerVeilleAo(input, ctx, auth);
    case 'lister_veilles_appels_offres': return await toolListerVeillesAo(input, ctx, auth);
    case 'lister_nouveautes_appels_offres': return await toolNouveautesAo(input, ctx, auth);
    case 'get_veille_marche':              return await toolVeilleMarche(input, ctx);
    case 'modifier_veille_appels_offres':   return await toolModifierVeilleAo(input, ctx, auth);
    case 'desactiver_veille_appels_offres': return await toolDesactiverVeilleAo(input, ctx, auth);
    case 'marquer_nouveautes_lues':         return await toolMarquerNouveautesLues(input, ctx, auth);
    case 'lister_zones_veille':      return await toolListerZonesVeille(input, ctx, auth);
    case 'desactiver_zone_veille':   return await toolDesactiverZoneVeille(input, ctx, auth);
    case 'get_parcel_summary':       return await toolParcelSummary(input, ctx);
    case 'get_parcel_plu':           return await toolParcelPlu(input, ctx);
    case 'get_dvf_comparables':      return await toolDvfComparables(input, ctx);
    case 'get_risks_georisques':     return await toolRisksGeorisques(input, ctx);
    case 'compute_smartscore':       return await toolSmartScore(input, ctx);
    case 'get_dpe_ademe':            return await toolDpeAdeme(input, ctx);
    case 'get_monuments_historiques': return await toolMonumentsHistoriques(input, ctx);
    case 'get_batiment_bdnb':          return await toolBatimentBdnb(input, ctx);
    case 'get_quick_market_insight': return await toolQuickMarketInsight(input, ctx);
    case 'recherche_biens':          return await toolRechercheBiens(input, ctx);
    case 'get_loyers_reference':     return await toolLoyersReference(input, ctx);
    case 'get_servitudes':           return await toolServitudes(input, ctx);
    case 'get_potentiel_solaire':    return await toolPotentielSolaire(input, ctx);
    case 'get_zonage_abc':           return await toolZonageAbc(input, ctx);
    case 'get_taxes_locales':        return await toolTaxesLocales(input, ctx);
    case 'get_ppr_detail':           return await toolPprDetail(input, ctx);
    case 'get_assainissement':       return await toolAssainissement(input, ctx);
    case 'get_altimetrie':           return await toolAltimetrie(input, ctx);
    case 'get_classement_sonore':    return await toolClassementSonore(input, ctx);
    case 'get_etude_parcelle':       return await toolEtudeParcelle(input, ctx);
    case 'get_etude_marche':         return await toolEtudeMarche(input, ctx);
    case 'get_couts_construction':   return await toolCoutsConstruction(input, ctx);
    case 'get_couts_renovation':     return await toolCoutsRenovation(input, ctx);
    case 'get_sitadel':              return await toolSitadel(input, ctx);
    case 'get_appels_offres':        return await toolAppelsOffres(input, ctx);
    case 'get_etablissements_proches': return await toolEtablissementsProches(input, ctx);
    case 'get_equipements_proches':  return await toolEquipementsProches(input, ctx);
    case 'get_logement_social':      return await toolLogementSocial(input, ctx);
    case 'get_contexte_commune':     return await toolContexteCommune(input, ctx);
    case 'get_contacts_mairies':     return await toolContactsMairies(input, ctx);
    case 'get_bilan_promoteur':      return await toolBilanPromoteur(input, ctx);
    case 'get_analyse_predictive':   return await toolAnalysePredictive(input, ctx);
    case 'get_dispositif_fiscal':    return await toolDispositifFiscal(input, ctx);
    case 'get_proprietaire_parcelle': return await toolProprietaireParcelle(input, ctx);
    case 'get_zonage_plu':           return await toolZonagePlu(input, ctx);
    case 'get_prescriptions_urbanisme': return await toolPrescriptionsUrbanisme(input, ctx);
    case 'action_ouvrir_page':       return toolActionOuvrirPage(input, ctx);
    case 'action_creer_operation':   return await toolActionCreerOperation(input, ctx);
    case 'action_lancer_etape':      return toolActionLancerEtape(input, ctx);
    default:
      return { status: 'error', source: 'copilot', message: `Tool inconnu : ${name}` };
  }
}

// =============================================================
// OUTILS D'ACTION — production de propositions, jamais d'écriture
// -------------------------------------------------------------
// Différence assumée avec les VERBES (creer_zone_veille & co.) : les verbes
// écrivent ici, sous l'identité de l'utilisateur, avec le protocole en deux
// temps. Les actions promoteur, elles, ne touchent PAS la base côté serveur —
// elles décrivent une intention que le front exécute avec la session de
// l'utilisateur. C'est ce qui permet au front de savoir si l'écriture vient
// de l'utilisateur ou de l'agent, information impossible à produire ici.
// =============================================================

interface ChainStepCtx {
  step: string;
  label?: string;
  route?: string;
  status?: string;
  blocked_by?: string[];
  runnable?: boolean;
}

/** Repli si la chaîne n'est pas dans le contexte (aucune opération active). */
const STEP_ROUTES: Record<string, string> = {
  foncier:       '/promoteur/foncier',
  plu:           '/promoteur/foncier',
  marche:        '/promoteur/marche',
  risques:       '/promoteur/risques',
  enveloppe:     '/promoteur/implantation-2d',
  programmation: '/promoteur/programmation',
  bilan:         '/promoteur/bilan-promoteur',
  synthese:      '/promoteur/synthese',
};

function readChain(ctx: MimmozaContext): { study_id?: string; steps: ChainStepCtx[] } {
  const raw = (ctx as unknown as Record<string, unknown>).promoteur_chain;
  if (!raw || typeof raw !== 'object') return { steps: [] };
  const o = raw as { study_id?: unknown; steps?: unknown };
  return {
    study_id: typeof o.study_id === 'string' ? o.study_id : undefined,
    steps: Array.isArray(o.steps) ? (o.steps as ChainStepCtx[]) : [],
  };
}

function proposal(action: Record<string, unknown>): ToolResult {
  return { status: 'ok', source: 'copilot', data: { action } };
}

function toolActionOuvrirPage(input: Record<string, unknown>, ctx: MimmozaContext): ToolResult {
  const route = str(input.route) ?? '';
  const raison = str(input.raison) ?? '';
  if (!route.startsWith('/')) {
    return { status: 'error', source: 'copilot', message: 'Route interne invalide.' };
  }
  const path = route.split('?')[0];
  const known = readChain(ctx).steps.find((s) => s.route === route || s.route?.split('?')[0] === path);

  // La route doit exister. Sans cette garde, le modèle invente des chemins et
  // l'utilisateur atterrit sur la redirection catch-all de App.tsx.
  // Les routes de la chaîne promoteur sont admises telles quelles : elles
  // viennent du contexte, pas du modèle.
  if (!known && !isKnownRoute(route)) {
    const proches = suggestRoutes(route);
    const piste = proches.length
      ? ` Routes proches : ${proches.map((r) => `${r.path} (${r.label})`).join(', ')}.`
      : '';
    return {
      status: 'error',
      source: 'copilot',
      message: `La route « ${route} » n'existe pas dans l'application.${piste}`,
    };
  }

  const label = known?.label ?? routeLabel(path);
  return proposal({
    kind: 'open_page',
    label: label && label !== path ? `Ouvrir ${label}` : 'Ouvrir la page',
    summary: raison || `Ouvrir ${route}`,
    params: { route },
  });
}

async function toolActionCreerOperation(
  input: Record<string, unknown>, ctx: MimmozaContext,
): Promise<ToolResult> {
  const titre = str(input.titre) ?? '';
  if (!titre) return { status: 'error', source: 'copilot', message: 'Titre manquant.' };

  const parcelIds = Array.isArray(input.parcel_ids)
    ? (input.parcel_ids as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];

  // Correctif A : commune_insee/commune_nom étaient recopiés bruts dans la
  // proposition, donc dans l'opération créée. Le couple persisté est désormais
  // celui validé au référentiel. (Le champ s'appelant ici commune_nom, il est
  // exposé sous le nom attendu par resoudreInseeFiable avant l'appel.)
  const insee = await resoudreInseeFiable(
    { ...input, commune: str(input.commune_nom) ?? str(input.commune) }, ctx,
  );
  const communeNom = insee.nom ?? str(input.commune_nom);
  const communeInsee = insee.code;

  const bits = [`Créer l'opération « ${titre} »`];
  if (communeNom || communeInsee) bits.push(`sur ${communeNom ?? communeInsee}`);
  if (parcelIds.length) {
    bits.push(parcelIds.length === 1 ? `parcelle ${parcelIds[0]}` : `${parcelIds.length} parcelles`);
  }

  return avecAjustement(proposal({
    kind: 'create_operation',
    label: 'Créer l’opération',
    summary: `${bits.join(' — ')}.`,
    params: {
      title: titre,
      commune_insee: communeInsee,
      commune_nom: communeNom,
      parcel_ids: parcelIds,
      surface_m2: num(input.surface_m2),
    },
  }), insee);
}

function toolActionLancerEtape(input: Record<string, unknown>, ctx: MimmozaContext): ToolResult {
  const step = str(input.step) ?? '';
  const raison = str(input.raison) ?? '';
  if (!STEP_ROUTES[step]) {
    return { status: 'error', source: 'copilot', message: `Étape inconnue : ${step}` };
  }

  const chain = readChain(ctx);
  if (!chain.study_id) {
    return {
      status: 'not_found',
      source: 'copilot',
      message: "Aucune opération active : propose d'abord d'en créer une (action_creer_operation).",
    };
  }

  // Garde-fou serveur : le modèle peut se tromper d'ordre, la chaîne fait foi.
  const known = chain.steps.find((s) => s.step === step);
  if (known && known.runnable === false) {
    const blockers = (known.blocked_by ?? []).join(', ');
    return {
      status: 'error',
      source: 'copilot',
      message: `L'étape « ${step} » est bloquée${blockers ? ` par : ${blockers}` : ''}. `
             + `Traite d'abord ces étapes et explique-le à l'utilisateur.`,
    };
  }

  return proposal({
    kind: 'run_step',
    label: `Lancer ${known?.label ?? step}`,
    summary: raison || `Lancer l'étape ${known?.label ?? step}.`,
    params: {
      step,
      route: known?.route ?? STEP_ROUTES[step],
      study_id: chain.study_id,
    },
  });
}

// ─── get_parcel_summary (fallback contexte si non branché) ────
async function toolParcelSummary(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  const ref = resolveParcelRef(input, ctx);
  if (!hasAnyIdentifier(ref)) {
    return {
      status: 'not_found', source: 'MimmozaContext',
      message: "Aucune parcelle identifiée. Demande à l'utilisateur d'en sélectionner une.",
    };
  }
  // Correctif A : `ref.code_insee` est une hypothèse (modèle, contexte ou
  // dérivation d'IDU). On la confronte au référentiel avant de la transmettre
  // ou de la restituer.
  const insee = await resoudreInseeFiable(input, ctx, ref);
  const inseeSur = insee.origine === 'non_verifie' ? undefined : insee.code;

  if (INTERNAL_FUNCTIONS.parcel) {
    try {
      const raw = await callInternalFunction(
        INTERNAL_FUNCTIONS.parcel,
        { ...ref, code_insee: inseeSur, commune: insee.nom ?? ref.commune },
      );
      // TODO[contrat-parcel]: aligner les clés sur la vraie réponse.
      const data = pick(raw, [
        'parcel_id', 'cadastral_ref', 'address', 'commune',
        'code_postal', 'code_insee', 'surface_m2', 'surface', 'plu_zone', 'lat', 'lng',
      ]);
      return avecAjustement({ status: 'ok', source: INTERNAL_FUNCTIONS.parcel, data }, insee);
    } catch (e) {
      return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.parcel, message: errMsg(e) }, insee);
    }
  }
  // Fallback : on renvoie ce que le contexte connaît (pas d'invention).
  //
  // Correctif A — ce retour renvoyait `ref.code_insee`, c'est-à-dire le code
  // proposé par le modèle lui-même, sous `status: 'ok'` et `source:
  // 'MimmozaContext'`. Le modèle recevait donc son propre code avec l'apparence
  // d'une donnée confirmée, puis le réutilisait en confiance : blanchiment
  // complet, qui rouvrait la porte fermée partout ailleurs. On ne renvoie plus
  // qu'un code passé par le référentiel.
  return avecAjustement({
    status: 'ok', source: 'MimmozaContext',
    data: {
      parcel_id: ref.parcel_id ?? null,
      cadastral_ref: ref.cadastral_ref ?? null,
      address: ref.address ?? null,
      commune: insee.nom ?? ref.commune ?? null,
      code_insee: inseeSur ?? null,
      surface_m2: ctx.parcel?.surface_m2 ?? null,
      plu_zone: ctx.parcel?.plu_zone ?? null,
      lat: ref.lat ?? null,
      lng: ref.lng ?? null,
    },
  }, insee);
}

// ─── get_parcel_plu : lit le PLU extrait par le parser (contexte), puis fonction dédiée si branchée ──
async function toolParcelPlu(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  // 1) Source de vérité actuelle : le PLU déjà extrait par plu-parser et présent dans le contexte.
  if (ctx.plu && (ctx.plu.zone_code || ctx.plu.ruleset || ctx.plu.oap)) {
    return { status: 'ok', source: 'plu-parser (Mimmoza)', data: summarizePluContext(ctx.plu) };
  }
  // 2) Repli extensible : fonction PLU dédiée (table plu_documents / Storage) si un jour configurée.
  if (INTERNAL_FUNCTIONS.plu) {
    const ref = resolveParcelRef(input, ctx);
    if (!hasAnyIdentifier(ref)) {
      return { status: 'not_found', source: 'PLU', message: 'Aucune parcelle identifiée.' };
    }
    // Correctif A : `{ ...ref }` transmettait le code INSEE brut (hypothèse du
    // modèle ou dérivée de l'IDU). Seul outil du fichier resté non traité.
    const insee = await resoudreInseeFiable(input, ctx, ref);
    ref.code_insee = insee.code;
    ref.code_insee_origine = insee.code ? 'contexte' : undefined;
    if (insee.nom) ref.commune = insee.nom;
    try {
      const raw = await callInternalFunction(INTERNAL_FUNCTIONS.plu, { ...ref });
      return avecAjustement(
        { status: 'ok', source: INTERNAL_FUNCTIONS.plu, data: summarizePlu(raw) },
        insee,
      );
    } catch (e) {
      return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.plu, message: errMsg(e) }, insee);
    }
  }
  // 3) REPLI AUTOMATIQUE sur le Géoportail de l'urbanisme (gpu-parcelle-v1).
  //    Aucun règlement importé ≠ aucune donnée d'urbanisme : le GPU donne le
  //    zonage opposable au point. On le renvoie en disant EXPLICITEMENT que le
  //    niveau de détail est dégradé — zonage seul, aucune règle chiffrée.
  if (INTERNAL_FUNCTIONS.gpu) {
    const gpu = await toolZonagePlu(input, ctx);
    if (gpu.status === 'ok' && gpu.data && (gpu.data as any).empty !== true) {
      return {
        status: 'ok',
        source: `${INTERNAL_FUNCTIONS.gpu} (repli GPU — aucun règlement importé)`,
        data: {
          ...(gpu.data as Record<string, unknown>),
          niveau_de_detail: 'zonage_seul',
          regle_ecrite_disponible: false,
          note_repli:
            "Aucun règlement de PLU n'a été importé sur la page Foncier : ces éléments viennent du " +
            "Géoportail de l'urbanisme et se limitent au ZONAGE OPPOSABLE (code de zone, type U/AU/A/N). " +
            "Les règles CHIFFRÉES — hauteur maximale, emprise au sol, retraits, stationnement, OAP — ne " +
            "sont PAS disponibles ici : ne les invente sous aucun prétexte. Dis à l'utilisateur que pour " +
            "les obtenir il doit importer le PDF du règlement sur la page Foncier de Mimmoza.",
        },
      };
    }
    // GPU muet ou en échec : on retombe sur le message d'origine, sans rien inventer.
  }

  // 4) Ni règlement importé, ni zonage GPU : on le dit, sans inventer de règle.
  return {
    status: 'not_found', source: 'PLU',
    message:
      "Aucune donnée PLU disponible : le règlement n'a pas été importé sur la page Foncier de Mimmoza, " +
      "et le Géoportail de l'urbanisme ne renvoie aucun zonage sur ce point (commune non numérisée, " +
      "localisation trop imprécise, ou commune au RNU). " +
      "Invite l'utilisateur à uploader le PDF du PLU. N'invente aucune règle d'urbanisme ni aucune OAP, " +
      "et ne conclus SURTOUT PAS que le terrain est constructible ou non.",
  };
}

// ─── compute_smartscore (branché sur smartscore-enriched-v3) ──
async function toolSmartScore(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.smartscore) {
    return {
      status: 'not_configured', source: 'SmartScore',
      message: "Le moteur SmartScore n'est pas encore branché (COPILOT_FN_SMARTSCORE non défini). Signale-le sans inventer de score.",
    };
  }

  const ref = resolveParcelRef(input, ctx);

  // Correctif A : remplace le PATCH annonce (repli zip/city → geo.api), qui ne
  // s'activait qu'en l'absence de code INSEE et de coordonnées. Le centroïde
  // commune reste le repli lat/lon des piliers services/transport (Overpass).
  const insee = await resoudreInseeFiable(input, ctx, ref);
  // Affectation INCONDITIONNELLE : conditionner à `insee.code` laissait dans
  // `ref` la valeur brute posée par resolveParcelRef quand la résolution
  // échouait — et c'est cette valeur-là qui repartait dans le corps de requête.
  // Un code non résolu doit disparaître, pas survivre à sa propre invalidation.
  ref.code_insee = insee.code;
  ref.code_insee_origine = insee.code ? 'contexte' : undefined;
  if (insee.nom) ref.commune = insee.nom;
  if (ref.lat == null && insee.lat != null && insee.lng != null) {
    ref.lat = insee.lat; ref.lng = insee.lng;
  }

  if (!hasAnyIdentifier(ref) && !ref.commune && !ref.code_insee) {
    return avecAjustement({ status: 'not_found', source: 'SmartScore', message: 'Aucune parcelle ni localisation identifiée.' }, insee);
  }
  try {
    // Contrat smartscore-enriched-v3 : mode "standard", lng→lon, commune_insee.
    const body = {
      mode: 'standard',
      parcel_id: ref.parcel_id ?? undefined,
      commune_insee: ref.code_insee ?? undefined,
      lat: ref.lat ?? undefined,
      lon: ref.lng ?? undefined,   // ⚠️ la fonction attend "lon", pas "lng"
      type_local: str(input.type_local) ?? undefined,
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.smartscore, body);
    return avecAjustement(
      { status: 'ok', source: INTERNAL_FUNCTIONS.smartscore, data: summarizeSmartScore(raw) },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.smartscore, message: errMsg(e) }, insee);
  }
}

// ─── get_dvf_comparables ──
// Priorité à la fonction DVF dédiée (dvf-comparables-v1, COPILOT_FN_DVF), au contrat
// { status, summary, stats, comps }. Repli mutualisé sur smartscore-enriched-v3 (bloc
// market_like.dvf) si seul COPILOT_FN_SMARTSCORE est défini.
async function toolDvfComparables(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  const ref = resolveParcelRef(input, ctx);

  // Correctif A : remplace le repli commune → geo.api, qui ne s'activait qu'en
  // l'absence de code INSEE ET de coordonnées — un code inventé passait donc
  // directement dans la requête DVF.
  const insee = await resoudreInseeFiable(input, ctx, ref);
  // Affectation INCONDITIONNELLE : conditionner à `insee.code` laissait dans
  // `ref` la valeur brute posée par resolveParcelRef quand la résolution
  // échouait — et c'est cette valeur-là qui repartait dans le corps de requête.
  // Un code non résolu doit disparaître, pas survivre à sa propre invalidation.
  ref.code_insee = insee.code;
  ref.code_insee_origine = insee.code ? 'contexte' : undefined;
  if (insee.nom) ref.commune = insee.nom;

  if (!hasAnyIdentifier(ref) && !ref.commune && !ref.code_insee) {
    return avecAjustement({ status: 'not_found', source: 'DVF', message: 'Ni parcelle ni commune identifiée.' }, insee);
  }

  const radiusKm = num(input.rayon_m) != null ? num(input.rayon_m)! / 1000 : 2;
  const horizonMonths = num(input.horizon_months) ?? 24;
  const typeLocal = str(input.type_local) ?? undefined;

  // ── Path A : fonction DVF dédiée (dvf-comparables-v1) ──
  const dedicated = INTERNAL_FUNCTIONS.dvf;
  if (dedicated) {
    try {
      const body = {
        lat: ref.lat ?? undefined,
        lon: ref.lng ?? undefined,            // ⚠️ dvf-comparables-v1 attend "lon", pas "lng"
        commune_insee: ref.code_insee ?? undefined,
        parcel_id: ref.parcel_id ?? undefined,
        radius_km: radiusKm,
        horizon_months: horizonMonths,
        type_local: typeLocal,
      };
      const raw = await callInternalFunction(dedicated, body);
      const s = summarizeDvfDedicated(raw);
      return avecAjustement(
        { status: s.status, source: dedicated, data: s.data, message: s.message },
        insee,
      );
    } catch (e) {
      return avecAjustement({ status: 'error', source: dedicated, message: errMsg(e) }, insee);
    }
  }

  // ── Path B : repli mutualisé sur smartscore-enriched-v3 (mode standard) ──
  const fn = INTERNAL_FUNCTIONS.smartscore;
  if (!fn) {
    // Enveloppé, à la différence des `not_configured` de tête de handler : celui-ci
    // est postérieur à la résolution, un code écarté doit donc être signalé ici aussi.
    return avecAjustement({
      status: 'not_configured', source: 'DVF',
      message: "Le service DVF n'est pas encore branché (ni COPILOT_FN_DVF ni COPILOT_FN_SMARTSCORE). Signale-le sans inventer de prix.",
    }, insee);
  }
  try {
    const body = {
      mode: 'standard',
      parcel_id: ref.parcel_id ?? undefined,
      commune_insee: ref.code_insee ?? undefined,
      lat: ref.lat ?? undefined,
      lon: ref.lng ?? undefined,             // ⚠️ "lon"
      type_local: typeLocal,
      radius_km: radiusKm,
    };
    const raw = await callInternalFunction(fn, body);
    return avecAjustement(
      { status: 'ok', source: fn, data: summarizeDvfFromSmartScore(raw) },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: fn, message: errMsg(e) }, insee);
  }
}

// ─── get_risks_georisques (branché sur risk-study via COPILOT_FN_RISKS) ──
async function toolRisksGeorisques(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.risks) {
    return {
      status: 'not_configured', source: 'Géorisques',
      message: "Le service Géorisques n'est pas encore branché (COPILOT_FN_RISKS non défini). Signale-le sans inventer de risque.",
    };
  }

  const ref = resolveParcelRef(input, ctx);

  // Correctif A : remplace le PATCH listing (repli CP → geo.api), qui ne
  // s'activait qu'en l'absence de code INSEE et de coordonnées.
  const insee = await resoudreInseeFiable(input, ctx, ref);
  // Affectation INCONDITIONNELLE : conditionner à `insee.code` laissait dans
  // `ref` la valeur brute posée par resolveParcelRef quand la résolution
  // échouait — et c'est cette valeur-là qui repartait dans le corps de requête.
  // Un code non résolu doit disparaître, pas survivre à sa propre invalidation.
  ref.code_insee = insee.code;
  ref.code_insee_origine = insee.code ? 'contexte' : undefined;
  if (insee.nom) ref.commune = insee.nom;

  if (!hasAnyIdentifier(ref) && !ref.code_insee && !ref.commune) {
    return avecAjustement({
      status: 'not_found', source: 'Géorisques',
      message: 'Aucune localisation exploitable (ni lat/lng, ni parcelle, ni code INSEE, ni ville).',
    }, insee);
  }

  try {
    const body = {
      lat:           ref.lat        ?? undefined,
      lon:           ref.lng        ?? undefined,
      commune_insee: ref.code_insee ?? undefined,
      parcel_id:     ref.parcel_id  ?? undefined,
      address:       ref.address    ?? undefined,
      radius_km: num(input.rayon_m) != null ? num(input.rayon_m)! / 1000 : undefined,
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.risks, body);
    return avecAjustement(
      { status: 'ok', source: INTERNAL_FUNCTIONS.risks, data: summarizeRisks(raw) },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.risks, message: errMsg(e) }, insee);
  }
}

// ─── get_dpe_ademe (branché sur dpe-ademe-v1 via COPILOT_FN_DPE) ──
async function toolDpeAdeme(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.dpe) {
    return {
      status: 'not_configured', source: 'DPE ADEME',
      message: "Le service DPE n'est pas encore branché (COPILOT_FN_DPE non défini). Signale-le sans inventer de classe.",
    };
  }

  const ref = resolveParcelRef(input, ctx);
  const address = str(input.address) ?? ref.address;

  // Correctif A — ici le canal n'est pas le code INSEE mais le CODE POSTAL, et
  // c'est le même vecteur : le modèle peut le fabriquer aussi facilement, et il
  // partait brut vers dpe-ademe-v1 comme filtre géographique. On le confronte au
  // référentiel : `code_postal` alimente `zip_code`, que resoudreInseeFiable lit.
  // `str()` sur TOUTE la cascade, y compris le dernier terme : sans lui
  // l'expression est typée `any`, et un zip_code numérique du contexte serait
  // écarté par resoudreInseeFiable (qui filtre) mais retenu ici — l'inverse
  // exact de ce que ce correctif cherche à obtenir.
  const cpPropose = str(
    str(input.code_postal) ?? str(input.zip_code) ?? ctx.parcel?.code_postal ?? (ctx as any).zip_code,
  );
  const insee = await resoudreInseeFiable({ ...input, zip_code: cpPropose }, ctx, ref);

  // Un CP proposé n'est retenu que s'il existe réellement. Note : on ne peut pas
  // se contenter de `insee.cp`, qui privilégie volontairement le CP d'entrée sur
  // celui du référentiel (pour ne pas écraser le CP réel d'une commune multi-CP).
  let codePostal: string | undefined = insee.cp;
  let cpEcarte: string | undefined;
  if (cpPropose) {
    const c = await chercherParCp(cpPropose);
    if (c === 'introuvable') { cpEcarte = cpPropose; codePostal = insee.origine === 'resolu_nom' ? insee.cp : undefined; }
    else codePostal = cpPropose; // 'indisponible' inclus : mode dégradé, signalé par insee.ajustement
  }
  const noteCp = cpEcarte
    ? `Le code postal « ${cpEcarte} » n'existe pas : il a été écarté du filtre DPE. Ne le cite pas.`
    : undefined;

  // `noteCp` doit accompagner TOUTES les sorties, pas seulement le chemin
  // nominal : c'est sur l'échec que le modèle a le plus besoin de savoir que son
  // code postal a été invalidé, sinon il le rejoue au tour suivant.
  const avecNoteCp = (res: ToolResult): ToolResult =>
    noteCp
      ? { ...res, message: res.message ? `${noteCp}\n\n${res.message}` : noteCp }
      : res;

  // Localisation minimale : adresse OU coordonnées OU code postal.
  if (!address && ref.lat == null && !codePostal) {
    return avecAjustement(avecNoteCp({
      status: 'not_found', source: 'DPE ADEME',
      message: "Aucune localisation exploitable pour interroger le DPE (ni adresse, ni coordonnées, ni code postal vérifié).",
    }), insee);
  }

  try {
    const body = {
      address: address ?? undefined,
      lat: ref.lat ?? undefined,
      lon: ref.lng ?? undefined,        // ⚠️ dpe-ademe-v1 attend "lon", pas "lng"
      code_postal: codePostal ?? undefined,
      radius_m: num(input.radius_m) ?? undefined,
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.dpe, body);
    const s = summarizeDpeDedicated(raw);
    return avecAjustement(
      avecNoteCp({ status: s.status, source: INTERNAL_FUNCTIONS.dpe, data: s.data, message: s.message }),
      insee,
    );
  } catch (e) {
    return avecAjustement(avecNoteCp({ status: 'error', source: INTERNAL_FUNCTIONS.dpe, message: errMsg(e) }), insee);
  }
}

// ─── get_monuments_historiques (branché sur patrimoine-merimee-v1) ──
async function toolMonumentsHistoriques(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.merimee) {
    return {
      status: 'not_configured', source: 'Mérimée',
      message: "Le service Monuments historiques n'est pas encore branché (COPILOT_FN_MERIMEE non défini). Signale-le sans inventer de périmètre.",
    };
  }

  const ref = resolveParcelRef(input, ctx);

  // Le périmètre ABF se mesure à 500 m d'un POINT : sans coordonnées, le repli
  // communal ne peut PAS répondre « suis-je dans les abords ? ». On tente donc
  // d'abord le centroïde cadastral depuis l'IDU.
  if (ref.lat == null || ref.lng == null) {
    const idu = str(input.cadastral_ref) ?? str(input.parcel_id) ?? ref.cadastral_ref ?? ref.parcel_id;
    if (idu) {
      const c = await parcelCentroidFromIdu(idu);
      if (c) { ref.lat = c.lat; ref.lng = c.lon; }
    }
  }

  // Correctif A : supprime le repli commune → geo.api, qui ne s'activait qu'en
  // l'absence de code. Le code INSEE reste facultatif : des coordonnées suffisent.
  const insee = await resoudreInseeFiable(input, ctx, ref);

  if (ref.lat == null && !insee.code) {
    return avecAjustement({
      status: 'not_found', source: 'Mérimée',
      message: "Aucune localisation exploitable (ni coordonnées, ni commune) pour rechercher les monuments historiques.",
    }, insee);
  }

  try {
    const body = {
      lat: ref.lat ?? undefined,
      lon: ref.lng ?? undefined,        // ⚠️ patrimoine-merimee-v1 attend "lon"
      code_insee: insee.code ?? undefined,
      radius_m: num(input.radius_m) ?? undefined,
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.merimee, body);
    const s = summarizeMerimeeDedicated(raw);
    return avecAjustement(
      { status: s.status, source: INTERNAL_FUNCTIONS.merimee, data: s.data, message: s.message },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.merimee, message: errMsg(e) }, insee);
  }
}

// ─── get_batiment_bdnb (branché sur batiment-bdnb-v1 via COPILOT_FN_BDNB) ──
async function toolBatimentBdnb(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.bdnb) {
    return {
      status: 'not_configured', source: 'BDNB',
      message: "Le service BDNB n'est pas encore branché (COPILOT_FN_BDNB non défini). Signale-le sans inventer de caractéristique.",
    };
  }

  const ref = resolveParcelRef(input, ctx);
  const address = str(input.address) ?? ref.address;
  // Correctif A : supprime le repli commune → geo.api, qui ne s'activait qu'en
  // l'absence d'adresse ET de code. Le code INSEE reste FACULTATIF ici : une
  // adresse seule suffit à interroger la BDNB.
  const insee = await resoudreInseeFiable(input, ctx, ref);

  if (!address && !insee.code) {
    return avecAjustement({
      status: 'not_found', source: 'BDNB',
      message: "Aucune localisation exploitable (ni adresse, ni commune) pour interroger la BDNB.",
    }, insee);
  }

  try {
    const body = { address: address ?? undefined, code_insee: insee.code ?? undefined };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.bdnb, body);
    const s = summarizeBdnbDedicated(raw);
    return avecAjustement(
      { status: s.status, source: INTERNAL_FUNCTIONS.bdnb, data: s.data, message: s.message },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.bdnb, message: errMsg(e) }, insee);
  }
}

// ─── get_loyers_reference (branché sur loyers-reference-v1 via COPILOT_FN_LOYERS) ──
// Source #1 : Carte des loyers ANIL/DHUP. Le tool résout le code INSEE
// (input LLM → contexte → geo.api depuis ville/CP) ; la fonction lit la table
// et gère l'éclatement PLM (Paris/Lyon/Marseille → fourchette arrondissements).
async function toolLoyersReference(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.loyers) {
    return {
      status: 'not_configured', source: 'Loyers de référence',
      message: "Le service Loyers de référence n'est pas encore branché (COPILOT_FN_LOYERS non défini). Signale-le sans inventer de loyer.",
    };
  }

  // Correctif A : le code INSEE passe obligatoirement par le référentiel.
  // L'ancien repli « if (!codeInsee && ...) » ne s'activait que si le modèle
  // n'avait rien proposé — fournir un code désactivait donc la vérification.
  const ref = resolveParcelRef(input, ctx);
  const insee = await resoudreInseeFiable(input, ctx, ref);
  if (!insee.code) return echecInsee(insee, 'Loyers de référence');

  try {
    const body = {
      code_insee: insee.code,
      commune: insee.nom ?? undefined,
      zip_code: insee.cp ?? undefined,
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.loyers, body);
    const s = summarizeLoyersDedicated(raw);
    return avecAjustement(
      avecInseeAval({ status: s.status, source: INTERNAL_FUNCTIONS.loyers, data: s.data, message: s.message }, raw),
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.loyers, message: errMsg(e) }, insee);
  }
}

// ─── get_servitudes (branché sur servitudes-gpu-v1 via COPILOT_FN_SERVITUDES) ──
// SUP = donnée parcellaire → nécessite lat/lon. Pas de repli centroïde commune :
// interroger un centre-ville renverrait des servitudes hors sujet. La fonction
// récupère elle-même le polygone parcelle (cadastre) et intersecte les assiettes.
async function toolServitudes(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.servitudes) {
    return {
      status: 'not_configured', source: 'Servitudes (GPU)',
      message: "Le service Servitudes n'est pas encore branché (COPILOT_FN_SERVITUDES non défini). Signale-le sans inventer de servitude.",
    };
  }

  // Même cascade que le GPU : coordonnées du contexte, sinon centroïde cadastral
  // résolu depuis l'IDU. Sans cela l'outil rendait la main en 0 ms sur une simple
  // référence cadastrale, alors que la donnée était parfaitement atteignable.
  const loc = await resolvePointPrecis(input, ctx);
  if (!loc.pt) {
    const idu = loc.idu ?? 'non fournie';
    const MSG: Record<string, string> = {
      idu_invalide:
        `La référence cadastrale « ${idu} » n'a pas le format d'un identifiant parcellaire français ` +
        `(14 caractères). Demande à l'utilisateur de vérifier sa saisie. N'avance aucune servitude.`,
      introuvable_cadastre:
        `La référence cadastrale « ${idu} » est bien formée mais INTROUVABLE au cadastre : référence ` +
        `erronée, parcelle renumérotée après division ou fusion, ou commune non couverte par le plan ` +
        `cadastral informatisé. C'est un problème de RÉFÉRENCE, pas de servitude : demande à ` +
        `l'utilisateur de la vérifier, et ne conclus RIEN sur les contraintes du terrain.`,
      reseau:
        `Le service cadastre (API Carto/IGN) n'a pas répondu : impossible de convertir « ${idu} » en ` +
        `coordonnées. Panne temporaire, pas une information sur le terrain. Propose de réessayer.`,
    };
    return {
      status: 'not_found', source: 'Servitudes (GPU)',
      message: (loc.echec && MSG[loc.echec]) ??
        ("Coordonnées précises (lat/lng) indisponibles. Les servitudes se recherchent à la parcelle, " +
         "pas à la commune : demande à l'utilisateur d'ouvrir une parcelle localisée. " +
         "Une absence de résultat ne prouve JAMAIS l'absence de servitude."),
    };
  }
  const lat = loc.pt.lat;
  const lng = loc.pt.lon;

  try {
    const body = {
      lat,
      lon: lng,                                    // ⚠️ servitudes-gpu-v1 attend "lon"
      // ⚠️ CORRECTIF : `ref` n'existe plus ici depuis le passage à
      // resolvePointPrecis — cette ligne levait un ReferenceError à CHAQUE
      // appel de get_servitudes. On repasse par resolveParcelRef, qui conserve
      // le repli sur la référence cadastrale du contexte.
      cadastral_ref:
        str(input.cadastral_ref) ?? resolveParcelRef(input, ctx).cadastral_ref ?? undefined,
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.servitudes, body);
    const s = summarizeServitudesDedicated(raw);
    return { status: s.status, source: INTERNAL_FUNCTIONS.servitudes, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.servitudes, message: errMsg(e) };
  }
}

// ─── get_potentiel_solaire (branché sur potentiel-solaire-v1 via COPILOT_FN_SOLAIRE) ──
// PVGIS accepte un centroïde commune (l'irradiation varie peu à l'échelle du km),
// donc repli geo.api autorisé ici — contrairement aux servitudes.
async function toolPotentielSolaire(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.solaire) {
    return {
      status: 'not_configured', source: 'Potentiel solaire',
      message: "Le service Potentiel solaire n'est pas encore branché (COPILOT_FN_SOLAIRE non défini). Signale-le sans inventer de valeur.",
    };
  }

  const ref = resolveParcelRef(input, ctx);
  let lat = num(input.lat) ?? ref.lat;
  let lng = num(input.lng) ?? ref.lng;

  // Correctif A : le repli centroïde interrogeait geo.api par le code proposé,
  // sans jamais vérifier qu'il désignait la commune nommée — un code erroné
  // déplaçait donc silencieusement le point de mesure.
  const insee = await resoudreInseeFiable(input, ctx, ref);
  if (lat == null || lng == null) {
    if (insee.lat != null && insee.lng != null) { lat = insee.lat; lng = insee.lng; }
  }

  if (lat == null || lng == null) {
    return avecAjustement({
      status: 'not_found', source: 'Potentiel solaire',
      message: "Aucune localisation exploitable (ni coordonnées, ni commune) pour estimer le potentiel solaire.",
    }, insee);
  }

  try {
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.solaire, { lat, lon: lng });
    const s = summarizePotentielSolaireDedicated(raw);
    return avecAjustement(
      { status: s.status, source: INTERNAL_FUNCTIONS.solaire, data: s.data, message: s.message },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.solaire, message: errMsg(e) }, insee);
  }
}

// ─── get_zonage_abc (branché sur zonage-abc-v1 via COPILOT_FN_ZONAGE) ──
// Le tool résout le code INSEE (input → contexte → geo.api depuis ville/CP) ;
// la fonction lit la table zonage_abc. Donnée à la commune (pas de lat/lon requis).
async function toolZonageAbc(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.zonage) {
    return {
      status: 'not_configured', source: 'Zonage ABC',
      message: "Le service Zonage ABC n'est pas encore branché (COPILOT_FN_ZONAGE non défini). Signale-le sans inventer de zone.",
    };
  }

  // Correctif A : supprime le repli geo.api local, qui ne s'activait qu'en
  // l'absence de code proposé et laissait donc passer tout code inventé.
  const ref = resolveParcelRef(input, ctx);
  const insee = await resoudreInseeFiable(input, ctx, ref);
  if (!insee.code) return echecInsee(insee, 'Zonage ABC');

  try {
    const body = { code_insee: insee.code, commune: insee.nom ?? undefined, zip_code: insee.cp ?? undefined };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.zonage, body);
    const s = summarizeZonageDedicated(raw);
    return avecAjustement(
      avecInseeAval({ status: s.status, source: INTERNAL_FUNCTIONS.zonage, data: s.data, message: s.message }, raw),
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.zonage, message: errMsg(e) }, insee);
  }
}

// ─── get_taxes_locales (branché sur taxes-locales-v1 via COPILOT_FN_TAXES) ──
// Le tool résout le code INSEE (input → contexte → geo.api depuis ville/CP) ;
// la fonction interroge l'API DGFiP Opendatasoft. Donnée à la commune.
async function toolTaxesLocales(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.taxes) {
    return {
      status: 'not_configured', source: 'Taxes locales',
      message: "Le service Taxes locales n'est pas encore branché (COPILOT_FN_TAXES non défini). Signale-le sans inventer de taux.",
    };
  }

  // Correctif A : supprime le repli geo.api local, qui ne s'activait qu'en
  // l'absence de code proposé et laissait donc passer tout code inventé.
  const ref = resolveParcelRef(input, ctx);
  const insee = await resoudreInseeFiable(input, ctx, ref);
  if (!insee.code) return echecInsee(insee, 'Taxes locales');

  try {
    const body = { code_insee: insee.code, commune: insee.nom ?? undefined, zip_code: insee.cp ?? undefined };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.taxes, body);
    const s = summarizeTaxesDedicated(raw);
    return avecAjustement(
      avecInseeAval({ status: s.status, source: INTERNAL_FUNCTIONS.taxes, data: s.data, message: s.message }, raw),
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.taxes, message: errMsg(e) }, insee);
  }
}

// ─── get_ppr_detail (branché sur ppr-detail-v1 via COPILOT_FN_PPR) ──
// Détail PPR par commune (Géorisques GASPAR) + test dans-périmètre si lat/lng.
// Le tool résout l'INSEE ; passe aussi lat/lon pour affiner à la parcelle.
async function toolPprDetail(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.ppr) {
    return {
      status: 'not_configured', source: 'PPR (Géorisques)',
      message: "Le service PPR détaillés n'est pas encore branché (COPILOT_FN_PPR non défini). Signale-le sans inventer de PPR.",
    };
  }

  // Correctif A : supprime le repli geo.api local, qui ne s'activait qu'en
  // l'absence de code proposé et laissait donc passer tout code inventé.
  const ref = resolveParcelRef(input, ctx);
  const lat = num(input.lat) ?? ref.lat;
  const lng = num(input.lng) ?? ref.lng;
  const insee = await resoudreInseeFiable(input, ctx, ref);
  if (!insee.code) return echecInsee(insee, 'PPR (Géorisques)');

  try {
    const body = {
      code_insee: insee.code,
      commune: insee.nom ?? undefined,
      zip_code: insee.cp ?? undefined,
      lat: lat ?? undefined,
      lon: lng ?? undefined,          // ⚠️ ppr-detail-v1 attend "lon"
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.ppr, body);
    const s = summarizePprDedicated(raw);
    return avecAjustement(
      avecInseeAval({ status: s.status, source: INTERNAL_FUNCTIONS.ppr, data: s.data, message: s.message }, raw),
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.ppr, message: errMsg(e) }, insee);
  }
}

// ─── get_assainissement (branché sur assainissement-commune-v1 via COPILOT_FN_ASSAINISSEMENT) ──
// Le tool résout le code INSEE (input → contexte → geo.api depuis ville/CP) ;
// la fonction lit la table assainissement_commune. Donnée à la commune.
async function toolAssainissement(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.assainissement) {
    return {
      status: 'not_configured', source: 'Assainissement',
      message: "Le service Assainissement n'est pas encore branché (COPILOT_FN_ASSAINISSEMENT non défini). Signale-le sans inventer.",
    };
  }

  // Correctif A : supprime le repli geo.api local, qui ne s'activait qu'en
  // l'absence de code proposé et laissait donc passer tout code inventé.
  const ref = resolveParcelRef(input, ctx);
  const insee = await resoudreInseeFiable(input, ctx, ref);
  if (!insee.code) return echecInsee(insee, 'Assainissement');

  try {
    const body = { code_insee: insee.code, commune: insee.nom ?? undefined, zip_code: insee.cp ?? undefined };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.assainissement, body);
    const s = summarizeAssainissementDedicated(raw);
    return avecAjustement(
      { status: s.status, source: INTERNAL_FUNCTIONS.assainissement, data: s.data, message: s.message },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.assainissement, message: errMsg(e) }, insee);
  }
}

// ─── get_altimetrie (branché sur altimetrie-v1 via COPILOT_FN_ALTIMETRIE) ──
// Altitude + pente estimée (RGE Alti). lat/lng pour la parcelle ; sinon repli
// centre commune (précision dégradée, signalée par la fonction).
async function toolAltimetrie(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  console.log('[altimetrie-tool] input=', JSON.stringify(input),
              '| parcel=', JSON.stringify(ctx.parcel),
              '| city=', (ctx as any).city, '| zip=', (ctx as any).zip_code);
  if (!INTERNAL_FUNCTIONS.altimetrie) {
    return {
      status: 'not_configured', source: 'Altimétrie',
      message: "Le service Altimétrie n'est pas encore branché (COPILOT_FN_ALTIMETRIE non défini). Signale-le sans inventer.",
    };
  }

  const ref = resolveParcelRef(input, ctx);
  const lat = num(input.lat) ?? ref.lat;
  const lng = num(input.lng) ?? ref.lng;
  // Identifiant cadastral (IDU) : permet à la fonction de retrouver le centroïde
  // exact de la parcelle via le cadastre, même sans coordonnées ni commune.
  const idu = str(input.cadastral_ref) ?? str(input.parcel_id) ?? ref.cadastral_ref ?? ref.parcel_id;
  // Correctif A : le code INSEE partait brut vers altimetrie-v1, qui s'en sert
  // pour le repli « centre de la commune ». Il reste facultatif ici (coordonnées
  // ou IDU suffisent) mais n'est plus transmis sans vérification.
  const insee = await resoudreInseeFiable(input, ctx, ref);

  if (lat == null && lng == null && !insee.code && !insee.nom && !idu) {
    return avecAjustement({
      status: 'not_found', source: 'Altimétrie',
      message: "Aucune localisation (ni coordonnées, ni identifiant cadastral, ni commune) pour l'altimétrie.",
    }, insee);
  }

  try {
    const body = {
      lat: lat ?? undefined,
      lon: lng ?? undefined,          // ⚠️ altimetrie-v1 attend "lon"
      cadastral_ref: idu ?? undefined,
      code_insee: insee.code ?? undefined,
      commune: insee.nom ?? undefined,
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.altimetrie, body);
    const s = summarizeAltimetrieDedicated(raw);
    return avecAjustement(
      { status: s.status, source: INTERNAL_FUNCTIONS.altimetrie, data: s.data, message: s.message },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.altimetrie, message: errMsg(e) }, insee);
  }
}

// ─── get_classement_sonore (branché sur bruit-classement-v1 via COPILOT_FN_BRUIT) ──
// Donnée parcellaire (secteurs affectés par le bruit, GPU info-surf/prescription-surf).
// Besoin d'un IDU (→ polygone cadastre côté fonction) ou de lat/lng. Pas de repli commune.
async function toolClassementSonore(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.bruit) {
    return {
      status: 'not_configured', source: 'Classement sonore',
      message: "Le service Classement sonore n'est pas encore branché (COPILOT_FN_BRUIT non défini). Signale-le sans inventer de secteur.",
    };
  }

  const ref = resolveParcelRef(input, ctx);
  const lat = num(input.lat) ?? ref.lat;
  const lng = num(input.lng) ?? ref.lng;
  const idu = str(input.cadastral_ref) ?? str(input.parcel_id) ?? ref.cadastral_ref ?? ref.parcel_id;

  if (!idu && (lat == null || lng == null)) {
    return {
      status: 'not_found', source: 'Classement sonore',
      message: "Le classement sonore s'interroge à la parcelle : fournis un identifiant cadastral (IDU) ou des coordonnées précises (lat/lng), pas seulement une commune.",
    };
  }

  try {
    const body = {
      lat: lat ?? undefined,
      lon: lng ?? undefined,          // ⚠️ bruit-classement-v1 attend "lon"
      cadastral_ref: idu ?? undefined,
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.bruit, body);
    const s = summarizeBruitDedicated(raw);
    return { status: s.status, source: INTERNAL_FUNCTIONS.bruit, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.bruit, message: errMsg(e) };
  }
}

// ─── get_etude_parcelle (branché sur etude-parcelle-v1 via COPILOT_FN_ETUDE) ──
// Un seul appel → 7 sources en parallèle côté serveur. Contourne la limite
// MAX_TOOL_ITERATIONS.quick = 2 qui interdit d'enchaîner les outils en mode rapide.
async function toolEtudeParcelle(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.etude) {
    return {
      status: 'not_configured', source: 'Étude de parcelle',
      message: "L'étude complète n'est pas encore branchée (COPILOT_FN_ETUDE non défini). Signale-le sans inventer de synthèse.",
    };
  }

  const ref = resolveParcelRef(input, ctx);
  const idu = str(input.cadastral_ref) ?? str(input.parcel_id) ?? ref.cadastral_ref ?? ref.parcel_id;
  const lat = num(input.lat) ?? ref.lat;
  const lng = num(input.lng) ?? ref.lng;
  // Correctif A : le triplet code/commune/CP partait brut vers etude-parcelle-v1.
  // Le code reste facultatif (une parcelle ou des coordonnées suffisent), mais il
  // n'est plus transmis sans avoir été confronté au référentiel.
  const insee = await resoudreInseeFiable(input, ctx, ref);

  if (!idu && lat == null && !insee.code && !insee.nom && !insee.cp) {
    return avecAjustement({
      status: 'not_found', source: 'Étude de parcelle',
      message: "Aucune localisation exploitable. Demande à l'utilisateur d'ouvrir une parcelle ou de préciser une commune.",
    }, insee);
  }

  try {
    const body = {
      cadastral_ref: idu ?? undefined,
      lat: lat ?? undefined,
      lon: lng ?? undefined,          // ⚠️ etude-parcelle-v1 attend "lon"
      code_insee: insee.code ?? undefined,
      commune: insee.nom ?? undefined,
      zip_code: insee.cp ?? undefined,
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.etude, body);
    const s = summarizeEtudeParcelle(raw);
    return avecAjustement(
      { status: s.status, source: INTERNAL_FUNCTIONS.etude, data: s.data, message: s.message },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.etude, message: errMsg(e) }, insee);
  }
}

// ─── get_etude_marche (branché sur market-study-investisseur-v1) ──
// ⚠️ CONTRAT : la fonction attend "lon" (pas "lng") et "zipCode" en camelCase.
async function toolEtudeMarche(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.market) {
    return {
      status: 'not_configured', source: 'Étude de marché',
      message: "L'étude de marché n'est pas encore branchée (COPILOT_FN_MARKET non défini). Signale-le sans inventer de chiffre.",
    };
  }

  const ref = resolveParcelRef(input, ctx);
  const lat = num(input.lat) ?? ref.lat;
  const lng = num(input.lng) ?? ref.lng;
  const address = str(input.address) ?? ref.address;
  // v1.9 — L'IDU cadastral et le code INSEE sont résolus depuis le contexte par
  // resolveParcelRef (qui dérive même l'INSEE des 5 premiers caractères de l'IDU),
  // mais ils n'étaient tout simplement PAS transmis à la fonction.
  const parcelId = ref.cadastral_ref ?? ref.parcel_id;
  // Correctif A : commune_insee était transmis brut à market-study, qui l'utilise
  // comme dernier critère de centrage. Le code est facultatif ici (parcelle,
  // adresse ou coordonnées suffisent), mais il ne passe plus sans vérification.
  const insee = await resoudreInseeFiable(input, ctx, ref);
  const codeInsee = insee.code;
  const city = insee.nom ?? str(input.city) ?? str(input.commune) ?? ref.commune ?? (ctx as any).city;
  const zip = insee.cp ?? str(input.zip_code) ?? ctx.parcel?.code_postal ?? (ctx as any).zip_code;

  // Le garde exigeait lat/adresse/ville. Sur « étude de marché de la parcelle
  // 64065000AI0002 », aucun des trois n'est connu au premier appel : l'outil
  // répondait donc « Indisponible » alors que l'identifiant portait toute
  // l'information. Le copilote allait ensuite chercher le NOM de la commune et
  // relançait — d'où deux échecs, et une analyse finalement centrée sur le
  // centre-bourg au lieu de la parcelle.
  if (lat == null && !address && !city && !parcelId && !codeInsee) {
    return avecAjustement({
      status: 'not_found', source: 'Étude de marché',
      message: "Aucune localisation exploitable (ni coordonnées, ni identifiant de parcelle, ni code INSEE, ni adresse, ni ville) pour l'étude de marché.",
    }, insee);
  }

  try {
    const body: Record<string, unknown> = {
      project_type: str(input.project_type) ?? 'logement',
      radius_km: num(input.rayon_km) ?? 5,
    };
    // ⚠️ ORDRE DE PRÉCISION. market-study v1.4.1 essaie la parcelle EN PREMIER
    // (Apicarto IGN → centroïde réel), puis l'adresse, la ville, et enfin
    // l'INSEE. Transmettre parcel_id est donc ce qui permet de centrer le rayon
    // d'analyse sur le terrain plutôt que sur le clocher.
    if (parcelId) body.parcel_id = parcelId;
    if (codeInsee) body.commune_insee = codeInsee;
    if (lat != null && lng != null) { body.lat = lat; body.lon = lng; }   // ⚠️ "lon"
    else if (address) body.address = address;
    if (zip) body.zipCode = zip;                                          // ⚠️ camelCase
    if (city) body.city = city;

    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.market, body);
    const s = summarizeMarketStudy(raw);
    return avecAjustement(
      { status: s.status, source: INTERNAL_FUNCTIONS.market, data: s.data, message: s.message },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.market, message: errMsg(e) }, insee);
  }
}

// ─── get_couts_construction (branché sur couts-construction-v1) ──
// Barème interne × coefficient de zone × indexation BT01. Le calcul est
// DÉTERMINISTE côté fonction : le LLM restitue, il ne recalcule pas.
async function toolCoutsConstruction(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.couts) {
    return {
      status: 'not_configured', source: 'Coûts de construction',
      message: "Le barème de coûts n'est pas encore branché (COPILOT_FN_COUTS non défini). Signale-le sans inventer de montant.",
    };
  }

  // Correctif A : le coefficient de zone dépend de la commune ; le code INSEE
  // brut de l'input n'était confronté à aucun référentiel avant de la choisir.
  // Le code reste facultatif ici (le barème a un défaut national).
  const ref = resolveParcelRef(input, ctx);
  const insee = await resoudreInseeFiable(input, ctx, ref);
  const body = {
    typologie: str(input.typologie) ?? undefined,
    gamme: str(input.gamme) ?? undefined,
    surface_sdp: num(input.surface_sdp) ?? undefined,
    zone_abc: str(input.zone_abc) ?? undefined,
    code_insee: insee.code ?? undefined,
    commune: insee.nom ?? undefined,
  };

  try {
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.couts, body);
    const s = summarizeCoutsConstruction(raw);
    return avecAjustement(
      { status: s.status, source: INTERNAL_FUNCTIONS.couts, data: s.data, message: s.message },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.couts, message: errMsg(e) }, insee);
  }
}

// ─── get_couts_renovation (branché sur couts-renovation-v1 via COPILOT_FN_COUTS_RENOVATION) ──
// Barème rénovation interne, poste par poste. Calcul DÉTERMINISTE côté fonction :
// le LLM lit l'état sur les photos, transmet les postes ; il restitue sans recalculer.
async function toolCoutsRenovation(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.couts_renovation) {
    return {
      status: 'not_configured', source: 'Coûts de rénovation',
      message: "Le barème rénovation n'est pas encore branché (COPILOT_FN_COUTS_RENOVATION non défini). Signale-le sans inventer de montant.",
    };
  }

  const body = {
    surface_habitable_m2:
      num(input.surface_habitable_m2) ?? ctx.surface ?? (ctx as any).plan_surface_retenue_m2 ?? undefined,
    gamme: str(input.gamme) ?? undefined,
    alea_pct: num(input.alea_pct) ?? undefined,
    restructuration: input.restructuration === true ? true : undefined,
    niveau_global: str(input.niveau_global) ?? undefined,
    // Transmis tel quel : la fonction valide/normalise chaque poste (synonymes tolérés).
    postes: Array.isArray(input.postes) ? input.postes : undefined,
  };

  try {
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.couts_renovation, body);
    const s = summarizeCoutsRenovation(raw);
    return { status: s.status, source: INTERNAL_FUNCTIONS.couts_renovation, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.couts_renovation, message: errMsg(e) };
  }
}

// ─── IDU (identifiant cadastral) → centroïde parcelle via API Carto cadastre ──
// Même brique qu'altimetrie-v1 : évite de dépendre d'un lat/lon présent au
// contexte (les parcelles Mimmoza n'en portent pas toujours). Réutilisable pour
// servitudes / solaire. Repli silencieux (null) si le cadastre ne répond pas.
type IduEchec = 'idu_invalide' | 'introuvable_cadastre' | 'reseau';
type IduResultat = { lat: number; lon: number; echec: null } | { lat: null; lon: null; echec: IduEchec };

// Wrapper de compatibilite : les appelants qui se moquent de la cause.
async function parcelCentroidFromIdu(iduRaw: string): Promise<{ lat: number; lon: number } | null> {
  const r = await parcelCentroidDetaille(iduRaw);
  return r.echec === null ? { lat: r.lat, lon: r.lon } : null;
}

async function parcelCentroidDetaille(iduRaw: string): Promise<IduResultat> {
  const idu = iduRaw.replace(/\s/g, '').toUpperCase();
  // IDU 14 car. : INSEE[0..5) prefixe[5..8) section[8..10) numero[10..14).
  const m = /^(2[AB]\d{3}|\d{5})(\d{3})([0-9A-Z]{2})(\d{4})$/.exec(idu);
  if (!m) { console.log('[cadastre] IDU non parsable :', idu); return { lat: null, lon: null, echec: 'idu_invalide' }; }
  const [, codeInsee, prefixe, section, numeroRaw] = m;

  // API Carto sert le cadastre PCI : le numero y est stocke sur 4 caracteres
  // zero-remplis ("0002"). Certains millesimes repondent aussi au format court
  // ("2"). On essaie les deux : la premiere reponse peuplee gagne.
  const numeros = numeroRaw === String(Number(numeroRaw))
    ? [numeroRaw]
    : [numeroRaw, String(Number(numeroRaw))];

  let reseauKo = false;
  for (const numero of numeros) {
    const url = new URL('https://apicarto.ign.fr/api/cadastre/parcelle');
    url.searchParams.set('code_insee', codeInsee);
    url.searchParams.set('section', section);
    url.searchParams.set('numero', numero);
    // Commune absorbee : le prefixe "000" est le cas courant (pas de fusion).
    if (prefixe !== '000') url.searchParams.set('com_abs', prefixe);

    try {
      const r = await fetch(url.toString(), { signal: AbortSignal.timeout(7000) });
      if (!r.ok) {
        // Un 4xx dit « cette parcelle n'existe pas / ces paramètres ne matchent rien » :
        // c'est une réponse SUR le fond, pas une panne. Seuls 429 et 5xx sont des incidents.
        const incident = r.status === 429 || r.status >= 500;
        if (incident) reseauKo = true;
        console.log('[cadastre] HTTP', r.status, 'numero=' + numero, incident ? '(incident)' : '(reponse negative)');
        continue;
      }
      const fc = await r.json();
      const feats = Array.isArray(fc?.features) ? fc.features : [];
      if (feats.length === 0) { console.log('[cadastre] 0 feature numero=' + numero); continue; }

      const geom = feats[0]?.geometry;
      let ring: unknown = null;
      if (geom?.type === 'Polygon') ring = geom.coordinates?.[0];
      else if (geom?.type === 'MultiPolygon') ring = geom.coordinates?.[0]?.[0];
      if (!Array.isArray(ring) || ring.length === 0) continue;

      // Centroide surfacique (formule du polygone) : robuste aux parcelles en L,
      // la ou la moyenne des sommets peut tomber hors de la parcelle.
      let a = 0, cx = 0, cy = 0;
      for (let i = 0, n = ring.length; i < n; i++) {
        const p1 = ring[i] as number[], p2 = ring[(i + 1) % n] as number[];
        if (!Array.isArray(p1) || !Array.isArray(p2)) continue;
        const f = p1[0] * p2[1] - p2[0] * p1[1];
        a += f; cx += (p1[0] + p2[0]) * f; cy += (p1[1] + p2[1]) * f;
      }
      let lon: number, lat: number;
      if (Math.abs(a) > 1e-12) {
        lon = cx / (3 * a); lat = cy / (3 * a);
      } else {
        let sx = 0, sy = 0, n = 0;
        for (const pt of ring as number[][]) {
          if (Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) { sx += pt[0]; sy += pt[1]; n++; }
        }
        if (n === 0) continue;
        lon = sx / n; lat = sy / n;
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      console.log('[cadastre]', codeInsee, section, numero, '-> lat=', lat, 'lon=', lon);
      return { lat, lon, echec: null };
    } catch (e) {
      reseauKo = true;
      console.log('[cadastre] echec numero=' + numero, ':', String(e));
    }
  }

  console.log('[cadastre] aucune geometrie pour', idu, '| reseau=', reseauKo);
  return { lat: null, lon: null, echec: reseauKo ? 'reseau' : 'introuvable_cadastre' };
}

// ─── get_sitadel (branché sur sitadel-commune-v1 via COPILOT_FN_SITADEL) ──
// Dynamique de construction à la maille commune (ODS Sitadel/SDES national).
// Le tool résout l'INSEE (input → contexte → geo.api) ; la fonction lit les 2 jeux ODS.
async function toolSitadel(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.sitadel) {
    return {
      status: 'not_configured', source: 'Sitadel',
      message: "Le service Sitadel n'est pas encore branché (COPILOT_FN_SITADEL non défini). Signale-le sans inventer de chiffre.",
    };
  }

  const ref = resolveParcelRef(input, ctx);

  // 1) Coordonnées : parcelle du contexte → IDU cadastre → centroïde commune.
  let lat = num(input.lat) ?? ref.lat;
  let lon = num(input.lng) ?? ref.lng;
  let precision: 'parcelle' | 'centre_commune' =
    lat != null && lon != null ? 'parcelle' : 'centre_commune';

  // Correctif A : remplace la cascade locale code/CP/nom → geo.api du repli 1b,
  // qui ne s'activait qu'à défaut de coordonnées et retenait le code proposé
  // sans le confronter au nom de commune.
  const insee = await resoudreInseeFiable(input, ctx, ref);

  // 1a) Repli IDU → centroïde cadastre (précision parcelle même sans lat/lon au contexte).
  //     On MÉMORISE la cause d'un échec : une référence fournie puis non résolue
  //     ne doit pas se dégrader en silence vers l'échelle communale (dérive de contexte).
  let iduFourni: string | null = null;
  let iduEchec: IduEchec | null = null;
  if (lat == null || lon == null) {
    const idu = str(input.cadastral_ref) ?? str(input.parcel_id) ?? ref.cadastral_ref ?? ref.parcel_id;
    if (idu) {
      iduFourni = idu;
      const c = await parcelCentroidDetaille(idu);
      if (c.echec === null) { lat = c.lat; lon = c.lon; precision = 'parcelle'; }
      else { iduEchec = c.echec; }
    }
  }

  // 1a-bis) Référence MALFORMÉE : le code INSEE dérivé de ses 5 premiers caractères
  //         n'est pas fiable. On refuse plutôt que de répondre sur une autre commune.
  //
  // Correctif A : la condition portait sur `!str(input.code_insee)`, si bien qu'un
  // code INSEE proposé par le modèle suffisait à désactiver ce refus. Or c'est
  // exactement l'élément qui n'ancre rien : le référentiel confirme qu'un code
  // existe, jamais qu'il correspond à la parcelle demandée. Seule une commune
  // venue de l'utilisateur ou du contexte applicatif fait office d'ancrage.
  const communeAncree =
    str(input.commune) ?? ctx.parcel?.commune ?? ctx.parcel?.code_insee ?? (ctx as any).city;
  if (iduEchec === 'idu_invalide' && !communeAncree) {
    return avecAjustement({
      status: 'not_found', source: 'Sitadel',
      message:
        `La référence « ${iduFourni} » n'est pas un identifiant cadastral valide : le code commune qu'on ` +
        `en déduirait ne serait pas fiable. Demande à l'utilisateur de préciser la COMMUNE, et ne réponds ` +
        `sur AUCUN périmètre en attendant.`,
    }, insee);
  }

  // 1b) Dernier repli : centroïde de la commune vérifiée.
  if ((lat == null || lon == null) && insee.lat != null && insee.lng != null) {
    lat = insee.lat; lon = insee.lng; precision = 'centre_commune';
  }

  // Périmètre effectif de la réponse, à ANNONCER : c'est le garde-fou contre une
  // analyse lue comme parcellaire alors qu'elle est communale.
  const perimetre: Record<string, unknown> = {
    echelle: precision === 'parcelle' ? 'autour de la parcelle' : 'centre de la commune',
    precision,
  };
  if (iduEchec) {
    perimetre.reference_non_resolue = iduFourni;
    perimetre.avertissement =
      iduEchec === 'introuvable_cadastre'
        ? `⚠️ La référence « ${iduFourni} » est INTROUVABLE au cadastre. Ces chiffres portent donc sur la ` +
          `COMMUNE (code dérivé de la référence), PAS sur cette parcelle — dont l'existence n'est pas établie. ` +
          `DIS-LE explicitement à l'utilisateur en tête de réponse et invite-le à vérifier sa référence.`
        : `⚠️ Le service cadastre n'a pas répondu : ces chiffres portent sur la COMMUNE et non sur la ` +
          `parcelle. Signale-le explicitement et propose de réessayer.`;
  }

  console.log('[sitadel] precision=', precision, '| lat=', lat, '| lon=', lon, '| iduEchec=', iduEchec);

  if (lat == null || lon == null) {
    return avecAjustement({
      status: 'not_found', source: 'Sitadel',
      message: "Aucune localisation exploitable (ni coordonnées, ni commune) pour interroger les permis Sitadel.",
    }, insee);
  }

  // 2) Paramètres de recherche (bornés comme l'exige promoteur-permis-construire).
  const rayonKm = Math.min(25, Math.max(0.5, num(input.rayon_km) ?? (precision === 'parcelle' ? 3 : 5)));
  const periodMonths = Math.min(120, Math.max(1, Math.trunc(num(input.periode_mois) ?? 24)));

  try {
    // ⚠️ Contrat promoteur-permis-construire : latitude/longitude OBLIGATOIRES.
    //    commune=null volontaire → le rayon capte aussi les permis des communes
    //    voisines (le « projet à côté »), non bridé par la limite administrative.
    // Filtres : la fonction cible les applique côté serveur, AVANT le plafond de
    // 100 permis. Les figer en dur (ce qui était le cas) obligeait le modèle à
    // trier lui-même 100 permis triés par date — donc à rater le plus gros
    // projet du secteur dès que le rayon en contenait davantage. Les valeurs par
    // défaut ci-dessous reproduisent exactement l'ancien comportement.
    const trierPar = str(input.trier_par);
    const sortBy = trierPar === 'distance' || trierPar === 'logements' || trierPar === 'surface'
      ? trierPar
      : 'date';

    const body = {
      latitude: lat,
      longitude: lon,
      radiusKm: rayonKm,
      periodMonths,
      typeAutorisation: str(input.type_autorisation) ?? 'all',
      typologie: str(input.typologie) ?? 'all',
      logementsMin: num(input.logements_min) ?? null,
      logementsMax: num(input.logements_max) ?? null,
      surfaceMin: num(input.surface_min) ?? null,
      surfaceMax: num(input.surface_max) ?? null,
      commune: null,
      limit: 100,   // borne maxLimit de promoteur-permis-construire
      offset: 0,
      sortBy,
      // Distance : le plus proche d'abord. Tout le reste : le plus grand ou le
      // plus récent d'abord — c'est ce qu'on cherche dans chacun de ces tris.
      sortOrder: sortBy === 'distance' ? 'asc' : 'desc',
    };
    // Un filtre appliqué voyage AVEC la donnée, comme l'échelle géographique :
    // sans cela le modèle présente un sous-ensemble comme le total du secteur.
    const filtres: Record<string, unknown> = {};
    if (body.typeAutorisation !== 'all') filtres.type_autorisation = body.typeAutorisation;
    if (body.typologie !== 'all')        filtres.typologie = body.typologie;
    if (body.logementsMin != null)       filtres.logements_min = body.logementsMin;
    if (body.logementsMax != null)       filtres.logements_max = body.logementsMax;
    if (body.surfaceMin != null)         filtres.surface_min = body.surfaceMin;
    if (body.surfaceMax != null)         filtres.surface_max = body.surfaceMax;
    if (Object.keys(filtres).length > 0) {
      perimetre.filtres = filtres;
      perimetre.avertissement_filtres =
        `⚠️ Ces chiffres ne portent PAS sur tous les permis du rayon : un filtre a été appliqué ` +
        `(${Object.entries(filtres).map(([k, v]) => `${k}=${v}`).join(', ')}). Annonce ce filtre, et ne ` +
        `présente jamais ces totaux comme l'activité complète du secteur. Pour le total, rappelle ` +
        `l'outil sans filtre.`;
    }
    if (sortBy !== 'date') perimetre.tri = sortBy;

    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.sitadel, body);
    const s = summarizeSitadel(raw, { rayonKm, periodMonths, precision });
    // Le périmètre voyage AVEC la donnée : le modèle ne peut plus l'ignorer.
    const data = s.data && typeof s.data === 'object'
      ? { perimetre, ...(s.data as Record<string, unknown>) }
      : { perimetre };
    return avecAjustement(
      { status: s.status, source: INTERNAL_FUNCTIONS.sitadel, data, message: s.message },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.sitadel, message: errMsg(e) }, insee);
  }
}

// ─── get_etablissements_proches (branché sur etablissements-sirene-v1 via COPILOT_FN_SIRENE) ──
// Établissements immatriculés autour d'un point (API DINUM Recherche d'entreprises,
// token-free). Même cascade de localisation que Sitadel : contexte → IDU cadastre →
// centroïde commune. La fonction renvoie déjà un contrat compact.
async function toolEtablissementsProches(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.sirene) {
    return {
      status: 'not_configured', source: 'SIRENE',
      message: "Le service Établissements (SIRENE) n'est pas encore branché (COPILOT_FN_SIRENE non défini). Signale-le sans inventer d'établissement.",
    };
  }

  const ref = resolveParcelRef(input, ctx);

  // 1) Coordonnées : parcelle du contexte → IDU cadastre → centroïde commune.
  let lat = num(input.lat) ?? ref.lat;
  let lon = num(input.lng) ?? ref.lng;
  let precision: 'parcelle' | 'centre_commune' =
    lat != null && lon != null ? 'parcelle' : 'centre_commune';

  // Correctif A : remplace la cascade locale code/CP/nom → geo.api, qui retenait
  // le code proposé sans jamais vérifier qu'il désignait la commune nommée.
  const insee = await resoudreInseeFiable(input, ctx, ref);

  // 1a) Repli IDU → centroïde cadastre (précision parcelle même sans lat/lon au contexte).
  if (lat == null || lon == null) {
    const idu = str(input.cadastral_ref) ?? str(input.parcel_id) ?? ref.cadastral_ref ?? ref.parcel_id;
    if (idu) {
      const c = await parcelCentroidFromIdu(idu);
      if (c) { lat = c.lat; lon = c.lon; precision = 'parcelle'; }
    }
  }

  // 1b) Dernier repli : centroïde de la commune vérifiée.
  if ((lat == null || lon == null) && insee.lat != null && insee.lng != null) {
    lat = insee.lat; lon = insee.lng; precision = 'centre_commune';
  }

  console.log('[sirene] precision=', precision, '| lat=', lat, '| lon=', lon);

  if (lat == null || lon == null) {
    return avecAjustement({
      status: 'not_found', source: 'SIRENE',
      message: "Aucune localisation exploitable (ni coordonnées, ni commune) pour interroger les établissements SIRENE.",
    }, insee);
  }

  // 2) Paramètres bornés comme l'exige etablissements-sirene-v1 (radius 0.1–10 km, limit ≤ 30).
  const rayonKm = Math.min(10, Math.max(0.1, num(input.rayon_km) ?? (precision === 'parcelle' ? 1 : 2)));
  const limite = Math.min(30, Math.max(1, Math.trunc(num(input.limite) ?? 15)));
  const section = str(input.section_naf)?.toUpperCase().slice(0, 1);

  try {
    const body: Record<string, unknown> = {
      latitude: lat,
      longitude: lon,
      radius_km: rayonKm,
      limit: limite,
    };
    if (section && /^[A-U]$/.test(section)) body.section = section;

    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.sirene, body);
    const s = summarizeSirene(raw, { rayonKm, precision });
    return avecAjustement(
      { status: s.status, source: INTERNAL_FUNCTIONS.sirene, data: s.data, message: s.message },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.sirene, message: errMsg(e) }, insee);
  }
}

// ─── get_equipements_proches (branché sur bpe-proxy via COPILOT_FN_BPE) ──
// Base Permanente des Équipements (INSEE) via OpenDataSoft. Même cascade de
// localisation que SIRENE/Sitadel.
async function toolEquipementsProches(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.bpe) {
    return {
      status: 'not_configured', source: 'BPE',
      message: "Le service Équipements (BPE) n'est pas encore branché (COPILOT_FN_BPE non défini). Signale-le sans inventer d'équipement.",
    };
  }

  const loc = await resolvePointForTool(input, ctx);
  if (loc.lat == null || loc.lon == null) {
    return avecAjustement({
      status: 'not_found', source: 'BPE',
      message: "Aucune localisation exploitable (ni coordonnées, ni commune) pour interroger les équipements.",
    }, loc.insee);
  }
  const lat = loc.lat, lon = loc.lon;
  console.log('[bpe] precision=', loc.precision, '| lat=', lat, '| lon=', lon);

  const rayonM = Math.min(20000, Math.max(200,
    num(input.rayon_m) ?? (loc.precision === 'parcelle' ? 1500 : 3000)));

  try {
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.bpe, {
      lat,
      lon,
      radius_m: rayonM,
      limit: 500,
    });
    const s = summarizeBpe(raw, { rayonM, precision: loc.precision });
    return avecAjustement(
      { status: s.status, source: INTERNAL_FUNCTIONS.bpe, data: s.data, message: s.message },
      loc.insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.bpe, message: errMsg(e) }, loc.insee);
  }
}

// ─── get_logement_social (branché sur besoin-logements-sociaux via COPILOT_FN_SRU) ──
// Maille COMMUNE. La fonction attend un unique champ { query } : INSEE, CP ou nom.
async function toolLogementSocial(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.sru) {
    return {
      status: 'not_configured', source: 'SRU',
      message: "Le service Logement social n'est pas encore branché (COPILOT_FN_SRU non défini). Signale-le sans inventer de taux.",
    };
  }

  // Correctif A : la requête libre partait du code INSEE brut de l'input, sans
  // aucune vérification — un code inventé interrogeait donc une autre commune.
  const ref = resolveParcelRef(input, ctx);
  const insee = await resoudreInseeFiable(input, ctx, ref);
  if (!insee.code) return echecInsee(insee, 'SRU');
  const query = insee.code ?? insee.nom;

  try {
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.sru, { query: String(query) });
    const s = summarizeSru(raw);
    return avecAjustement(
      { status: s.status, source: INTERNAL_FUNCTIONS.sru, data: s.data, message: s.message },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.sru, message: errMsg(e) }, insee);
  }
}

// ─── get_bilan_promoteur ────────────────────────────────────────────────────
//
// Choix d'architecture, et pourquoi il compte
// -------------------------------------------
// Cet outil LIT le bilan persisté ; il ne le RECALCULE pas. La tentation était
// de porter `computeProForma` (BilanPromoteurPage.tsx) côté serveur pour que
// le chat puisse répondre sans que la page ait tourné. C'est précisément ce
// qu'il ne fallait pas faire : l'audit de cette session a passé l'essentiel de
// son temps à réconcilier des calculs dupliqués — SHAB à deux coefficients,
// quatre hauteurs de bâtiment, quatre diviseurs de logements, deux barèmes de
// coûts. Ajouter une seconde implémentation du bilan aurait recréé le problème
// à l'endroit le plus coûteux : les euros.
//
// Le chat lit donc la même source que l'écran. S'ils divergent un jour, c'est
// qu'il y a un bug de persistance, pas deux moteurs — une erreur trouvable.
//
// Conséquence assumée : sans bilan enregistré, l'outil ne répond pas un chiffre
// mais un statut, et le modèle propose de lancer l'étape.

interface BilanPersiste {
  prix_foncier: number | null;
  prix_revient_total: number | null;
  ca_previsionnel: number | null;
  marge_nette: number | null;
  taux_marge_nette_pct: number | null;
  fonds_propres: number | null;
  credit_promotion: number | null;
  taux_credit_pct: number | null;
  duree_mois: number | null;
  roi_pct: number | null;
  tri_pct: number | null;
  notes: string | null;
  done: boolean;
}

// ─── get_analyse_predictive ───────────────────────────────────────────────────
//
// Projection de valeur à 6 / 12 / 18 / 24 mois, avec scénarios prudent, central
// et optimiste, régime de marché et facteurs explicatifs.
//
// Ce que cet outil change
// -----------------------
// Le moteur prédictif existait déjà, mais uniquement dans le front : le chat en
// recevait un instantané SEULEMENT quand l'utilisateur se trouvait sur la page
// qui l'avait calculé. Depuis l'accueil, « quelle tendance à Saint-Cloud ? »
// n'avait aucune réponse possible. Le copilote pouvait lire une prédiction, pas
// en produire une.
//
// Il appelle maintenant le MÊME moteur, importé depuis _shared/predictive/.
//
// Ce qu'il va chercher lui-même, et pourquoi
// ------------------------------------------
// DVF et taux BCE sont les deux entrées portantes : la première ancre le prix
// au marché local constaté, la seconde donne la pression crédit, qui est LE
// déterminant macro de l'immobilier. Elles sont récupérées en parallèle.
//
// Les enrichissements (DPE, géorisques, loyers, PLU) ne sont PAS refetchés :
// le modèle les a souvent déjà obtenus dans le même échange via les outils
// dédiés, et les repasser en paramètres évite d'empiler les appels réseau.
// Chaque entrée absente dégrade la confiance, elle n'est jamais inventée.
// ── Dispositifs fiscaux d'investissement locatif ─────────────────────────────
//
// L'outil a deux modes. Sans prix d'acquisition, il explique ; avec, il chiffre.
// Il répond aussi sur les dispositifs fermés, parce que « le Pinel existe-t-il
// encore ? » est une vraie question d'investisseur, et que se taire dessus
// laisserait le modèle y répondre de mémoire — avec des barèmes de 2024.

// ── Propriétaire personne morale d'une parcelle ──────────────────────────────
//
// Ne renvoie QUE des personnes morales : sociétés, SCI, foncières,
// collectivités, associations. C'est une limite de droit, pas de données.
//
// L'identité des propriétaires personnes physiques figure dans les fichiers
// fonciers (MAJIC), dont l'accès est réservé aux acteurs publics
// (BOI-CAD-DIFF-20-20-10-30 § 30) et dont l'acte d'engagement interdit
// expressément tout démarchage commercial. Le fichier des personnes morales,
// lui, est publié en Licence Ouverte 2.0.
//
// Piège à ne jamais laisser passer : l'ABSENCE de résultat ne signifie pas que
// le bien appartient à un particulier. Le fichier source exclut aussi les
// sociétés unipersonnelles et les entrepreneurs individuels.

async function toolProprietaireParcelle(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<ToolResult> {
  const SOURCE = 'DGFiP — Fichiers des parcelles des personnes morales (Licence Ouverte 2.0)';

  const admin = getAdmin();
  const siren = str(input.siren)?.replace(/\s/gu, '');
  const denomination = str(input.denomination);

  // ── Recherche inverse : que détient cette société ? ──
  if (siren || denomination) {
    let requete = admin
      .from('proprietaires_personnes_morales')
      .select('idu, code_insee, commune_nom, section, numero_parcelle, denomination, siren, forme_juridique, nom_voie, numero_voirie, millesime')
      .order('code_insee', { ascending: true })
      .limit(200);

    if (siren) {
      if (!/^[0-9]{9}$/.test(siren)) {
        return {
          status: 'error',
          source: SOURCE,
          message: `« ${siren} » n'est pas un SIREN valide : neuf chiffres attendus.`,
        };
      }
      requete = requete.eq('siren', siren);
    } else {
      requete = requete.ilike('denomination', `%${denomination}%`);
    }

    const { data, error } = await requete;
    if (error) {
      console.error('[proprietaire_parcelle] recherche inverse:', error);
      return { status: 'error', source: SOURCE, message: error.message };
    }
    if (!data || data.length === 0) {
      return {
        status: 'not_found',
        source: SOURCE,
        data: { recherche: siren ?? denomination, parcelles: [] },
        message:
          `Aucune parcelle trouvée pour « ${siren ?? denomination} » dans les départements importés. ` +
          `Cela peut vouloir dire que la société ne détient rien, ou simplement que son ` +
          `département n'a pas encore été chargé.`,
      };
    }

    return {
      status: 'ok',
      source: SOURCE,
      data: {
        recherche: siren ?? denomination,
        nombre_parcelles: data.length,
        tronque: data.length === 200,
        parcelles: data,
        attribution: 'Source : DGFiP — Fichiers des parcelles des personnes morales',
      },
    };
  }

  // ── Recherche directe : qui détient cette parcelle ? ──
  let idu = str(input.cadastral_ref)?.replace(/\s/gu, '').toUpperCase() ?? null;

  if (!idu) {
    const insee = str(input.code_insee);
    const section = str(input.section);
    const numero = str(input.numero);
    if (insee && section && numero) {
      const prefixe = (str(input.prefixe) ?? '').padStart(3, '0');
      idu = `${insee}${prefixe}${section.padStart(2, '0')}${numero.padStart(4, '0')}`;
    }
  }

  // Repli sur la parcelle du contexte de page, si le modèle n'a rien fourni.
  if (!idu && ctx.parcel?.cadastral_ref) {
    idu = ctx.parcel.cadastral_ref.replace(/\s/gu, '').toUpperCase();
  }

  if (!idu || idu.length !== 14) {
    return {
      status: 'not_found',
      source: SOURCE,
      message:
        "Référence cadastrale manquante ou mal formée : il faut un IDU de 14 caractères, " +
        "ou le triplet code INSEE + section + numéro. Demande-le plutôt que de le deviner.",
    };
  }

  const { data, error } = await admin
    .from('proprietaires_personnes_morales')
    .select('denomination, siren, forme_juridique, forme_juridique_code, code_droit, nom_voie, numero_voirie, commune_nom, code_insee, section, numero_parcelle, millesime')
    .eq('idu', idu)
    .order('millesime', { ascending: false });

  if (error) {
    console.error('[proprietaire_parcelle] lecture:', error);
    return { status: 'error', source: SOURCE, message: error.message };
  }

  const AVERTISSEMENT_ABSENCE =
    "⚠️ Une absence de résultat ne signifie PAS que le bien appartient à un particulier. " +
    "Ce fichier ne recense que les personnes morales, et il exclut par construction les " +
    "sociétés unipersonnelles et les entrepreneurs individuels. Il se peut aussi que le " +
    "département n'ait pas encore été importé. Ne conclus rien sur l'identité du propriétaire.";

  if (!data || data.length === 0) {
    return {
      status: 'not_found',
      source: SOURCE,
      data: {
        idu,
        proprietaires: [],
        avertissement: AVERTISSEMENT_ABSENCE,
        recours_legal:
          "Pour connaître le propriétaire d'une parcelle précise, quel qu'il soit, la voie " +
          "légale est la demande de relevé de propriété (formulaire 6815-EM-SD) auprès du " +
          "centre des impôts fonciers. Elle est gratuite mais ponctuelle : cinq demandes par " +
          "semaine et dix par mois au maximum.",
      },
      message: `Aucune personne morale enregistrée sur la parcelle ${idu}. ${AVERTISSEMENT_ABSENCE}`,
    };
  }

  // Ne garder que le millésime le plus récent : les précédents restent en base
  // pour l'historique, mais les mélanger donnerait de faux copropriétaires.
  const millesimeRecent = data[0].millesime;
  const courants = data.filter((r) => r.millesime === millesimeRecent);
  const millesimesAnterieurs = [...new Set(data.map((r) => r.millesime))].filter(
    (m) => m !== millesimeRecent,
  );

  return {
    status: 'ok',
    source: SOURCE,
    data: {
      idu,
      millesime: millesimeRecent,
      nombre_titulaires: courants.length,
      proprietaires: courants.map((r) => ({
        denomination: r.denomination,
        siren: r.siren,
        siren_exploitable: r.siren !== null,
        forme_juridique: r.forme_juridique,
        code_droit: r.code_droit,
        adresse_du_bien: [r.numero_voirie, r.nom_voie].filter(Boolean).join(' ') || null,
        commune: r.commune_nom,
      })),
      millesimes_anterieurs_disponibles: millesimesAnterieurs,
      note_siren:
        courants.some((r) => r.siren === null)
          ? "Certains titulaires n'ont pas de SIREN exploitable : la DGFiP leur attribue un " +
            "identifiant fictif, qui ne correspond à aucune entreprise réelle. Il a été écarté."
          : null,
      note_pluralite:
        courants.length > 1
          ? "Plusieurs titulaires de droits sur cette parcelle : indivision, usufruit ou " +
            "nue-propriété. Le code droit précise la nature de chacun."
          : null,
      attribution:
        `Source : DGFiP — Fichiers des parcelles des personnes morales, situation au ` +
        `1er janvier ${millesimeRecent}.`,
    },
  };
}

async function toolDispositifFiscal(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<ToolResult> {
  const SOURCE = 'Dispositifs fiscaux Mimmoza (BOFiP / Legifrance)';

  const demande = str(input.dispositif)?.toLowerCase().replace(/[\s'-]/gu, '_') ?? '';
  const prix = num(input.prix_acquisition);

  // — Dispositif clos : on le dit, on ne calcule pas —
  if (demande) {
    const clos = trouverDispositifClos(demande.replace(/_/gu, ' '));
    if (clos) {
      return {
        ok: true,
        source: SOURCE,
        data: {
          statut: 'dispositif_clos',
          nom: clos.nom,
          ferme_depuis: clos.finPourNouveauxInvestisseurs,
          remplace_par: clos.remplacePar,
          precision: clos.precision,
          dispositifs_ouverts: Object.values(FICHES_DISPOSITIFS).map((f) => ({
            code: f.code,
            libelle: f.libelle,
            mecanique: f.mecanique,
          })),
          message:
            `${clos.nom} n'est plus ouvert aux nouveaux investissements depuis le ` +
            `${clos.finPourNouveauxInvestisseurs}. ${clos.precision}`,
        },
      };
    }
  }

  const codesOuverts: DispositifCode[] = [
    'jeanbrun_neuf', 'jeanbrun_ancien', 'denormandie', 'loc_avantages',
  ];
  const code = codesOuverts.find((c) => c === demande);

  // — Aucun dispositif nommé : on liste ce qui est ouvert —
  if (!code) {
    if (demande) {
      return {
        ok: true,
        source: SOURCE,
        data: {
          statut: 'dispositif_inconnu',
          demande,
          message:
            `« ${demande} » ne correspond à aucun dispositif connu, ouvert ou clos. ` +
            `Ne suppose pas qu'il existe : demande à l'utilisateur de préciser.`,
          dispositifs_ouverts: Object.values(FICHES_DISPOSITIFS),
        },
      };
    }
    return {
      ok: true,
      source: SOURCE,
      data: {
        statut: 'liste',
        millesime_baremes: MILLESIME_BAREMES,
        dispositifs_ouverts: Object.values(FICHES_DISPOSITIFS),
        dispositifs_clos: listerDispositifsClos(),
      },
    };
  }

  const fiche = FICHES_DISPOSITIFS[code];

  // — Mode explication —
  if (prix === null || prix <= 0) {
    return {
      ok: true,
      source: SOURCE,
      data: {
        statut: 'explication',
        fiche,
        millesime_baremes: MILLESIME_BAREMES,
        message:
          "Fiche du dispositif, sans chiffrage. Pour calculer l'avantage, rappelle cet " +
          "outil avec le prix d'acquisition net de frais.",
      },
    };
  }

  // — Mode calcul —
  const niveauLoyerBrut = str(input.niveau_loyer);
  const niveauLoyer: NiveauLoyer =
    niveauLoyerBrut === 'social' || niveauLoyerBrut === 'tres_social'
      ? niveauLoyerBrut
      : 'intermediaire';

  const zoneBrute = str(input.zone);
  const zone = (['Abis', 'A', 'B1', 'B2', 'C'] as const).find((z) => z === zoneBrute);

  const logement = {
    prixAcquisitionNetFraisEur: prix,
    travauxEur: num(input.travaux) ?? undefined,
    surfaceHabitableM2: num(input.surface_m2) ?? undefined,
    surfaceAnnexesM2: num(input.surface_annexes_m2) ?? undefined,
    zone,
    codeInsee: str(input.code_insee) ?? undefined,
    loyerMensuelHcEur: num(input.loyer_mensuel) ?? undefined,
    habitatCollectif: typeof input.habitat_collectif === 'boolean' ? input.habitat_collectif : undefined,
    dpeApresTravaux: str(input.dpe_apres_travaux) ?? undefined,
    dateAcquisition: str(input.date_acquisition) ?? undefined,
  };

  const tmiBrut = num(input.tmi);
  const situation = {
    tmiPct: tmiBrut !== null && [0, 11, 30, 41, 45].includes(tmiBrut) ? tmiBrut : 30,
  };
  const tmiParDefaut = tmiBrut === null;

  let resultat;
  if (code === 'jeanbrun_neuf') {
    resultat = calculerJeanbrunNeuf({ logement, situation, niveauLoyer });
  } else if (code === 'jeanbrun_ancien') {
    resultat = calculerJeanbrunAncien({ logement, situation, niveauLoyer });
  } else if (code === 'denormandie') {
    const duree = num(input.duree_engagement);
    const prorog = num(input.prorogations);
    resultat = calculerDenormandie({
      logement,
      situation,
      dureeEngagementAns: duree === 6 ? 6 : 9,
      prorogationsTriennales: prorog === 1 ? 1 : prorog === 2 ? 2 : 0,
    });
  } else {
    // Loc'Avantages : le plafond de loyer est communal. On tente de le lire ;
    // son absence produit un avertissement du moteur, jamais un plafond inventé.
    let plafondCommunal: number | undefined;
    if (logement.codeInsee) {
      // Barème public de référence : lecture par le client admin, comme les
      // autres tables de référentiel. `ctx` est le contexte de page envoyé par
      // le front, il ne porte aucun accès base.
      const { data, error } = await getAdmin()
        .from('plafonds_loyer_locavantages')
        .select('plafond_intermediaire, plafond_social, plafond_tres_social')
        .eq('code_insee', logement.codeInsee)
        .eq('millesime', MILLESIME_BAREMES)
        .maybeSingle();
      if (error) console.error('[dispositif_fiscal] plafond communal illisible:', error);
      if (data) {
        plafondCommunal =
          niveauLoyer === 'social' ? Number(data.plafond_social)
            : niveauLoyer === 'tres_social' ? Number(data.plafond_tres_social)
              : Number(data.plafond_intermediaire);
      }
    }
    resultat = calculerLocAvantages({
      logement,
      situation,
      niveauLoyer,
      intermediationLocative: input.intermediation_locative === true,
      plafondLoyerCommunalEurM2: plafondCommunal,
      revenusBrutsAnnuelsEur: logement.loyerMensuelHcEur
        ? logement.loyerMensuelHcEur * 12
        : undefined,
    });
  }

  const bloquants = resultat.constats.filter((c) => c.niveau === 'bloquant');

  return {
    ok: true,
    source: SOURCE,
    data: {
      statut: 'calcul',
      fiche,
      resultat,
      // Remonté à part pour que le modèle ne puisse pas le manquer.
      eligible: resultat.eligible,
      motifs_de_refus: bloquants.map((c) => c.message),
      tmi_par_defaut: tmiParDefaut,
      avertissement_tmi: tmiParDefaut
        ? "TMI non fournie : 30 % retenu par défaut. Sur un amortissement, le gain varie " +
          "du simple au double entre 11 % et 45 % — demande-la avant de présenter le chiffre " +
          'comme celui de l\'utilisateur.'
        : null,
      mention_obligatoire: 'À faire valider par un professionnel.',
    },
  };
}

async function toolAnalysePredictive(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<ToolResult> {
  const SOURCE = 'Analyse prédictive Mimmoza';

  const surfaceM2 = num(input.surface_m2);
  const acquisitionPrice = num(input.prix_acquisition);

  // Ces deux valeurs ne se devinent pas : sans elles il n'y a pas de projection,
  // seulement une moyenne de quartier déguisée en prédiction.
  if (surfaceM2 == null || surfaceM2 <= 0 || acquisitionPrice == null || acquisitionPrice <= 0) {
    return {
      status: 'empty', source: SOURCE,
      message:
        "Il manque la SURFACE (m²) et le PRIX D'ACQUISITION (€) — sans eux, aucune " +
        "projection n'est possible. Demande-les à l'utilisateur. Ne les estime PAS " +
        "toi-même à partir du marché local : ce serait projeter une moyenne de " +
        "quartier en la présentant comme l'analyse de SON bien.",
    };
  }

  const ref = readChain(ctx);
  const insee = await resolveCommune({
    code_insee: str(input.code_insee) ?? ref.code_insee,
    commune: str(input.commune) ?? ref.commune,
    zip_code: str(input.code_postal) ?? ref.zip_code,
  });

  const codePostal = str(input.code_postal) ?? insee.cp ?? ref.zip_code ?? '';
  const typeBienBrut = str(input.type_bien) ?? 'appartement';
  const typeBien = (['appartement', 'maison', 'immeuble', 'terrain', 'commerce'] as const)
    .includes(typeBienBrut as never)
    ? (typeBienBrut as PredictiveEngineInput['typeBien'])
    : 'appartement';

  // DVF et BCE en parallèle : deux réseaux indépendants, aucune raison de les
  // enchaîner. Chacun échoue seul, sans emporter l'autre.
  const [dvfRes, ecbRes] = await Promise.allSettled([
    (async () => {
      if (!INTERNAL_FUNCTIONS.dvf && !INTERNAL_FUNCTIONS.smartscore) return null;
      return await toolDvfComparables(
        { commune: insee.nom ?? undefined, code_insee: insee.code ?? undefined,
          zip_code: codePostal || undefined },
        ctx,
      );
    })(),
    fetchEcbRatesAnalysis(),
  ]);

  const dvfOut = dvfRes.status === 'fulfilled' ? dvfRes.value : null;
  const dvfData = (dvfOut?.status === 'ok' ? dvfOut.data : null) as Record<string, unknown> | null;
  const ecb = ecbRes.status === 'fulfilled' ? ecbRes.value : null;

  const prixM2Median = num((dvfData as any)?.prix_m2_median ?? (dvfData as any)?.prixM2Median);
  const nbTransactions = num((dvfData as any)?.nb_ventes ?? (dvfData as any)?.nbTransactions);

  const moteurInput: PredictiveEngineInput = {
    surfaceM2,
    acquisitionPrice,
    codePostal,
    typeBien,
    travauxEstime: num(input.travaux_estime) ?? 0,
    fraisAnnexes: num(input.frais_annexes) ?? 0,
    horizonDetention: num(input.horizon_mois) ?? undefined,
    dvf: prixM2Median != null
      ? { prixM2Median, nbTransactions: nbTransactions ?? undefined }
      : undefined,
    dpe: str(input.dpe)?.trim().toUpperCase().match(/\b([A-G])\b/)?.[1],
    loyerMedianZone: num(input.loyer_median_m2) ?? undefined,
    tauxBcePct: ecb?.refinancingRate,
    ecbAnalysis: ecb ?? undefined,
  } as PredictiveEngineInput;

  try {
    const snapshot = computePredictiveSnapshot(moteurInput);

    // Le périmètre voyage AVEC la projection : ce qui a nourri le calcul, et ce
    // qui manquait. Sans cela, une projection appuyée sur zéro transaction DVF
    // ressemble exactement à une projection appuyée sur soixante.
    const entrees = {
      dvf_disponible: prixM2Median != null,
      dvf_nb_transactions: nbTransactions ?? 0,
      taux_bce: ecb ? `${ecb.refinancingRate} % (${ecb.source === 'ecb' ? 'relevé BCE' : 'valeur de repli'})` : 'indisponible',
      dpe_fourni: moteurInput.dpe ?? null,
      loyer_fourni: moteurInput.loyerMedianZone ?? null,
    };

    const manquants: string[] = [];
    if (prixM2Median == null) manquants.push('DVF (aucun comparable)');
    if (!moteurInput.dpe) manquants.push('DPE');
    if (moteurInput.loyerMedianZone == null) manquants.push('loyer de référence');
    if (ecb?.source === 'fallback') manquants.push('taux BCE réels (repli utilisé)');

    return {
      status: 'ok', source: SOURCE,
      data: { projection: snapshot, entrees, entrees_manquantes: manquants },
      message:
        `Projection calculée sur ${entrees.dvf_nb_transactions} transaction(s) DVF. ` +
        (manquants.length
          ? `⚠️ Entrées manquantes : ${manquants.join(', ')}. ANNONCE-LES : une projection ` +
            `sans DVF ni DPE repose sur des hypothèses de marché, pas sur ce bien. ` +
            `Le champ confidenceScore le reflète — cite-le. `
          : '') +
        `Présente les trois scénarios, jamais le seul central : donner un chiffre unique ` +
        `pour une projection à 24 mois est une fausse précision. Rappelle que c'est une ` +
        `projection de modèle, pas une estimation contractuelle.`,
    };
  } catch (e) {
    return { status: 'error', source: SOURCE, message: errMsg(e) };
  }
}

async function toolBilanPromoteur(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<ToolResult> {
  const studyId = str(input.study_id) ?? readChain(ctx).study_id ?? null;
  if (!studyId) {
    return {
      status: 'empty',
      source: 'Bilan promoteur',
      message:
        "Aucune opération promoteur active. Demande à l'utilisateur laquelle il vise, ou " +
        "propose action_creer_operation s'il n'en a pas encore.",
    };
  }

  try {
    const { data, error } = await getAdmin()
      .from('promoteur_studies')
      .select('id, title, bilan, foncier, updated_at')
      .eq('id', studyId)
      .maybeSingle();

    if (error) {
      return { status: 'error', source: 'Bilan promoteur', message: error.message };
    }
    if (!data) {
      return {
        status: 'not_found',
        source: 'Bilan promoteur',
        message: `Aucune opération ne porte l'identifiant ${studyId}.`,
      };
    }

    const bilan = (data.bilan ?? null) as BilanPersiste | null;
    const caRenseigne = typeof bilan?.ca_previsionnel === 'number' && bilan.ca_previsionnel > 0;

    if (!bilan || !caRenseigne) {
      return {
        status: 'empty',
        source: 'Bilan promoteur',
        data: { study_id: data.id, titre: data.title ?? null },
        message:
          `L'opération « ${data.title ?? studyId} » n'a pas encore de bilan enregistré. ` +
          "N'estime AUCUN chiffre toi-même : propose action_lancer_etape('bilan') pour que la " +
          'page le produise.',
      };
    }

    const communeInsee = (data.foncier as Record<string, unknown> | null)?.commune_insee ?? null;

    return {
      status: 'ok',
      source: 'Bilan promoteur (Mimmoza)',
      data: {
        study_id: data.id,
        titre: data.title ?? null,
        commune_insee: communeInsee,
        enregistre_le: data.updated_at ?? null,
        // Le drapeau `done` distingue un bilan validé d'un brouillon en cours.
        bilan_finalise: bilan.done === true,
        prix_foncier_eur: bilan.prix_foncier,
        prix_revient_total_eur: bilan.prix_revient_total,
        ca_previsionnel_eur: bilan.ca_previsionnel,
        marge_nette_eur: bilan.marge_nette,
        taux_marge_nette_pct: bilan.taux_marge_nette_pct,
        convention_marge: 'marge / chiffre d\'affaires (convention promoteur)',
        fonds_propres_eur: bilan.fonds_propres,
        credit_promotion_eur: bilan.credit_promotion,
        taux_credit_pct: bilan.taux_credit_pct,
        duree_operation_mois: bilan.duree_mois,
        roi_pct: bilan.roi_pct,
        tri_pct: bilan.tri_pct,
        notes: bilan.notes,
      },
      message: bilan.done === true
        ? undefined
        : 'Bilan encore à l\'état de brouillon : les chiffres peuvent changer.',
    };
  } catch (e) {
    return { status: 'error', source: 'Bilan promoteur', message: errMsg(e) };
  }
}

// ─── get_contacts_mairies (branché sur recherche-contacts-mairies-v1 via COPILOT_FN_CONTACTS) ──
//
// Miroir serveur de src/spaces/promoteur/services/rechercheContacts.service.ts.
// Deux temps, comme côté front :
//   1. la fonction interne renvoie les mairies du secteur ;
//   2. les maires manquants sont complétés depuis public.maires_rne.
// L'étape 2 ne remplace jamais une valeur déjà fournie par la fonction : elle
// ne comble que les cellules vides, exactement comme enrichRowsWithMaires().

interface MairieRow {
  code_insee: string | null;
  commune: string;
  code_postal: string | null;
  maire: string | null;
  email: string | null;
  telephone: string | null;
  adresse: string | null;
  distance_km: number | null;
}

/** Les clés varient selon la source ; on accepte les trois graphies connues. */
function pickField(r: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function normalizeMairieRows(raw: unknown): MairieRow[] {
  const container = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const list = Array.isArray(container.rows) ? container.rows
    : Array.isArray(container.results) ? container.results
    : Array.isArray(container.data) ? container.data
    : Array.isArray(raw) ? raw
    : [];

  const out: MairieRow[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const commune = pickField(r, 'commune', 'nom_commune', 'nomCommune', 'ville');
    if (!commune) continue;

    const civilite = pickField(r, 'civiliteMaire', 'civilite_maire', 'civilite');
    const prenom   = pickField(r, 'prenomMaire', 'prenom_maire', 'prenom');
    const nom      = pickField(r, 'nomMaire', 'nom_maire', 'nom');
    const maire    = [civilite, prenom, nom].filter(Boolean).join(' ') || null;

    out.push({
      code_insee:  pickField(r, 'codeInsee', 'code_insee', 'insee', 'codeCommune', 'code_commune'),
      commune,
      code_postal: pickField(r, 'codePostal', 'code_postal', 'cp'),
      maire,
      email:       pickField(r, 'emailMairie', 'email_mairie', 'email'),
      telephone:   pickField(r, 'telephoneMairie', 'telephone_mairie', 'telephone', 'tel'),
      adresse:     pickField(r, 'adresseMairie', 'adresse_mairie', 'adresse'),
      distance_km: num(r.distanceKm) ?? num(r.distance_km) ?? null,
    });
  }
  return out;
}

/** Complète les maires manquants depuis public.maires_rne. Jamais bloquant. */
async function enrichirMaires(rows: MairieRow[]): Promise<MairieRow[]> {
  const manquants = rows.filter((r) => !r.maire && r.code_insee);
  if (manquants.length === 0) return rows;

  const codes = [...new Set(manquants.map((r) => r.code_insee as string))];
  try {
    const { data, error } = await getAdmin()
      .from('maires_rne')
      .select('code_insee, civilite, prenom, nom')
      .in('code_insee', codes);
    if (error || !Array.isArray(data)) return rows;

    const parInsee = new Map<string, string>();
    for (const item of data as Array<Record<string, unknown>>) {
      const code = typeof item.code_insee === 'string' ? item.code_insee : null;
      if (!code) continue;
      const label = [item.civilite, item.prenom, item.nom]
        .map((v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null))
        .filter(Boolean)
        .join(' ');
      if (label) parInsee.set(code, label);
    }

    return rows.map((r) =>
      !r.maire && r.code_insee && parInsee.has(r.code_insee)
        ? { ...r, maire: parInsee.get(r.code_insee) ?? null }
        : r,
    );
  } catch {
    // L'absence de maire n'invalide pas les coordonnées de la mairie.
    return rows;
  }
}

async function toolContactsMairies(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.contacts) {
    return {
      status: 'not_configured', source: 'Contacts mairies',
      message:
        "Le service Contacts mairies n'est pas encore branché (COPILOT_FN_CONTACTS non défini). " +
        "Signale-le sans inventer de nom d'élu ni de coordonnées ; propose la page " +
        "'/promoteur/recherche-contacts' via action_ouvrir_page.",
    };
  }

  // Même garde que les autres outils communaux : le code INSEE n'est jamais lu
  // brut depuis l'input, il est vérifié au référentiel.
  const ref = resolveParcelRef(input, ctx);
  const insee = await resoudreInseeFiable(input, ctx, ref);
  if (!insee.code) return echecInsee(insee, 'Contacts mairies');

  const rayonDemande = num(input.rayon_km) ?? 0;
  const rayonKm = rayonDemande > 0 ? Math.min(50, Math.max(1, rayonDemande)) : null;
  const limite = Math.min(100, Math.max(1, num(input.limite) ?? 40));

  try {
    // ⚠️ `recherche-contacts-mairies-v1` ne comprend PAS un code INSEE.
    // Son résolveur (searchCommunes) ne connaît que trois formes : un code
    // postal à 5 chiffres, un code de département, ou un NOM de commune.
    // On lui envoyait `insee.code` — « 64065 » pour Ascain — qu'il prenait
    // pour un code postal ; le vrai code postal étant 64310, la recherche ne
    // renvoyait rien et l'outil répondait « aucune mairie trouvée » sur une
    // commune parfaitement couverte.
    //
    // On envoie donc ce que la fonction sait lire, dans l'ordre de précision
    // décroissante pour le PIVOT du rayon : le nom de commune d'abord — un
    // code postal en couvre souvent plusieurs (64310 = Ascain, Saint-Pée et
    // Sare), et le pivot déterminerait alors mal le centre du rayon.
    const requete = insee.nom ?? insee.cp ?? insee.code;
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.contacts, {
      query: requete,
      radiusKm: rayonKm,
    });

    const rows = await enrichirMaires(normalizeMairieRows(raw));
    if (rows.length === 0) {
      return avecAjustement({
        status: 'empty', source: INTERNAL_FUNCTIONS.contacts,
        // La requête réellement envoyée est nommée : un « aucun résultat » qui
        // ne dit pas CE QUI a été cherché rend le diagnostic impossible — c'est
        // ce qui a masqué le fait qu'on envoyait un code INSEE là où la
        // fonction attend un nom de commune ou un code postal.
        data: { requete_envoyee: requete, rayon_km: rayonKm },
        message: rayonKm
          ? `Aucune mairie trouvée dans un rayon de ${rayonKm} km autour de « ${requete} ».`
          : `Aucune coordonnée de mairie disponible pour « ${requete} ».`,
      }, insee);
    }

    const tries = [...rows].sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));
    const retenues = tries.slice(0, limite);
    const sansEmail = retenues.filter((r) => !r.email).length;
    const sansMaire = retenues.filter((r) => !r.maire).length;

    return avecAjustement({
      status: 'ok',
      source: INTERNAL_FUNCTIONS.contacts,
      data: {
        commune_centre: insee.nom ?? insee.code,
        code_insee_centre: insee.code,
        rayon_km: rayonKm,
        total_trouve: rows.length,
        nombre_retourne: retenues.length,
        mairies: retenues,
        // Signalé explicitement pour que le modèle décrive les trous au lieu
        // de les combler : ce sont des données nominatives.
        mairies_sans_email: sansEmail,
        mairies_sans_maire_connu: sansMaire,
      },
      message: rows.length > retenues.length
        ? `${rows.length} mairies trouvées, ${retenues.length} retournées (les plus proches).`
        : undefined,
    }, insee);
  } catch (e) {
    return avecAjustement(
      { status: 'error', source: INTERNAL_FUNCTIONS.contacts, message: errMsg(e) },
      insee,
    );
  }
}

// ─── get_contexte_commune (branché sur contexte-commune-v1 via COPILOT_FN_CONTEXTE) ──
async function toolContexteCommune(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.contexte) {
    return {
      status: 'not_configured', source: 'Contexte commune',
      message: "Le service Contexte commune n'est pas encore branché (COPILOT_FN_CONTEXTE non défini). Signale-le sans inventer de contexte.",
    };
  }

  // Correctif A : le code INSEE n'est plus lu directement de l'input ; il est
  // vérifié au référentiel avant d'atteindre contexte-commune-v1.
  const ref = resolveParcelRef(input, ctx);
  const insee = await resoudreInseeFiable(input, ctx, ref);
  if (!insee.code) return echecInsee(insee, 'Contexte commune');

  const body: Record<string, unknown> = {
    code_insee: insee.code,
    commune:    insee.nom ?? undefined,
    zip_code:   insee.cp ?? undefined,
  };

  try {
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.contexte, body);
    const s = summarizeContexteCommune(raw);
    return avecAjustement(
      { status: s.status, source: INTERNAL_FUNCTIONS.contexte, data: s.data, message: s.message },
      insee,
    );
  } catch (e) {
    return avecAjustement({ status: 'error', source: INTERNAL_FUNCTIONS.contexte, message: errMsg(e) }, insee);
  }
}

// ─── Résolution d'un point (lat/lon) mutualisée par les outils à rayon ──
// Cascade identique à Sitadel/SIRENE : contexte → IDU cadastre → centroïde commune.
//
// Retourne TOUJOURS la `ResolutionInsee`, y compris quand aucun point n'a pu
// être établi (lat/lon à null) : elle disparaissait auparavant avec le `null` de
// retour, et le « aucune localisation exploitable » renvoyé à l'appelant ne
// disait donc pas que le code proposé était en cause — le modèle le rejouait.
async function resolvePointForTool(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<{ lat: number | null; lon: number | null; precision: 'parcelle' | 'centre_commune'; insee: ResolutionInsee }> {
  const ref = resolveParcelRef(input, ctx);

  let lat = num(input.lat) ?? ref.lat;
  let lon = num(input.lng) ?? ref.lng;
  let precision: 'parcelle' | 'centre_commune' =
    lat != null && lon != null ? 'parcelle' : 'centre_commune';

  // Correctif A : remplace la cascade locale code/CP/nom → geo.api, qui prenait
  // le code proposé sans jamais le confronter au nom de commune.
  const insee = await resoudreInseeFiable(input, ctx, ref);

  if (lat == null || lon == null) {
    const idu = str(input.cadastral_ref) ?? str(input.parcel_id) ?? ref.cadastral_ref ?? ref.parcel_id;
    if (idu) {
      const c = await parcelCentroidFromIdu(idu);
      if (c) { lat = c.lat; lon = c.lon; precision = 'parcelle'; }
    }
  }

  // Dernier repli : centroïde de la commune vérifiée.
  if ((lat == null || lon == null) && insee.lat != null && insee.lng != null) {
    lat = insee.lat; lon = insee.lng; precision = 'centre_commune';
  }

  return { lat: lat ?? null, lon: lon ?? null, precision, insee };
}

// ─── Brique GPU (gpu-parcelle-v1 via COPILOT_FN_GPU) ──────────
// ⚠️ PAS DE REPLI CENTRE-COMMUNE ICI, à la différence des outils à rayon : un
// zonage d'urbanisme change d'une parcelle à l'autre. Répondre depuis le centre
// de la commune produirait une réponse fausse avec l'apparence du sérieux —
// même décision que pour les servitudes (servitudes-gpu-v1).
async function resolvePointPrecis(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<{ pt: { lat: number; lon: number } | null; echec: IduEchec | null; idu: string | null }> {
  const ref = resolveParcelRef(input, ctx);
  let lat = num(input.lat) ?? ref.lat;
  let lon = num(input.lng) ?? ref.lng;

  let echec: IduEchec | null = null;
  if (lat == null || lon == null) {
    const idu = str(input.cadastral_ref) ?? str(input.parcel_id) ?? ref.cadastral_ref ?? ref.parcel_id;
    if (idu) {
      const c = await parcelCentroidDetaille(idu);
      if (c.echec === null) { lat = c.lat; lon = c.lon; } else { echec = c.echec; }
    }
  }
  if (lat == null || lon == null) return { pt: null, echec, idu: str(input.cadastral_ref) ?? ref.cadastral_ref ?? ref.parcel_id ?? null };
  return { pt: { lat, lon }, echec: null, idu: null };
}

async function callGpu(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
  couches: string[],
  vue: 'zonage' | 'prescriptions',
  source: string,
): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.gpu) {
    return {
      status: 'not_configured', source,
      message: `Le service Urbanisme GPU n'est pas encore branché (COPILOT_FN_GPU non défini). Signale-le sans inventer de zonage ni de règle.`,
    };
  }

  const loc = await resolvePointPrecis(input, ctx);
  if (!loc.pt) {
    const idu = loc.idu ?? 'non fournie';
    const MSG: Record<string, string> = {
      idu_invalide:
        `La référence cadastrale « ${idu} » n'a pas le format d'un identifiant parcellaire français ` +
        `(14 caractères : INSEE sur 5, préfixe sur 3, section sur 2, numéro sur 4 — ex. 64065000AI0002). ` +
        `Demande à l'utilisateur de vérifier sa saisie. N'avance aucun zonage.`,
      introuvable_cadastre:
        `La référence cadastrale « ${idu} » est bien formée mais INTROUVABLE au cadastre (API Carto/IGN) : ` +
        `elle n'existe pas, elle a été renumérotée après division ou fusion, ou la commune n'est pas couverte ` +
        `par le plan cadastral informatisé. Dis-le clairement — c'est un problème de RÉFÉRENCE, pas de PLU : ` +
        `n'invite PAS l'utilisateur à chercher des coordonnées GPS, demande-lui de vérifier la référence. ` +
        `Ne conclus RIEN sur la constructibilité.`,
      reseau:
        `Le service cadastre (API Carto/IGN) n'a pas répondu : impossible de convertir « ${idu} » en coordonnées. ` +
        `C'est une panne temporaire, pas une information sur le terrain. Propose de réessayer. N'avance aucun zonage.`,
    };
    return {
      status: 'not_found', source,
      message: (loc.echec && MSG[loc.echec]) ??
        ("Localisation précise indisponible (ni coordonnées, ni identifiant cadastral). " +
         "Le zonage d'urbanisme se lit au point : il ne peut PAS être approché par le centre de la commune. " +
         "Demande à l'utilisateur d'ouvrir une parcelle ou de préciser l'adresse, et n'avance aucun zonage."),
    };
  }
  const pt = loc.pt;

  console.log('[gpu]', vue, '| lat=', pt.lat, '| lon=', pt.lon);

  try {
    const body: Record<string, unknown> = {
      latitude: pt.lat,
      longitude: pt.lon,
      couches,
    };
    const lim = num(input.limite);
    if (lim != null) body.limite = Math.min(40, Math.max(1, Math.trunc(lim)));

    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.gpu, body);
    const s = summarizeGpu(raw, vue);
    return { status: s.status, source: INTERNAL_FUNCTIONS.gpu, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.gpu, message: errMsg(e) };
  }
}

// =============================================================
// VERBES — outils d'ACTION (écriture)
// -------------------------------------------------------------
// Trois règles non négociables, valables pour tout verbe futur :
//   1. L'identité vient du JWT vérifié (AuthCtx), jamais de ctx.user.
//   2. L'écriture passe par getUserClient(authHeader) : le RLS s'applique.
//      getAdmin() ici court-circuiterait toutes les politiques de sécurité.
//   3. Aucune écriture sans `confirmer: true` : le premier appel ne fait que
//      décrire ce qui serait écrit. Le modèle doit obtenir un accord explicite
//      entre les deux appels.
// =============================================================

function refuseSansIdentite(source: string): ToolResult {
  return {
    status: 'error', source,
    message:
      "Action impossible : l'utilisateur n'est pas authentifié pour cette requête. " +
      "N'invente pas de confirmation et ne prétends pas que l'action a été réalisée.",
  };
}

// Résout commune → { code, nom, cp, lat, lng } pour les outils qui traitent une
// LISTE de noms de communes (toolCreerWatchlist) et n'ont donc pas de code
// proposé à arbitrer.
//
// Correctif A : cette fonction avait son propre client geo.api — ni cache, ni
// coupe-circuit. Une watchlist de quinze communes pendant une panne du
// référentiel accumulait quinze timeouts de 5 s. Elle délègue désormais à
// chercherCommune, qui porte les deux.
async function resoudreCommune(
  nom?: string, insee?: string,
): Promise<{ code: string; nom: string; cp?: string; lat?: number; lng?: number } | null> {
  const c = insee
    ? await chercherParCode(insee)
    : nom
    ? await chercherParNom(nom)
    : null;
  if (!c || c === 'introuvable' || c === 'indisponible') return null;
  return { ...c, nom: c.nom || nom || '' };
}

async function toolCreerZoneVeille(
  input: Record<string, unknown>, ctx: MimmozaContext, auth: AuthCtx | null,
): Promise<ToolResult> {
  const SOURCE = 'Zones de veille Mimmoza';
  if (!auth?.userId || !auth.authHeader) return refuseSansIdentite(SOURCE);

  // Correctif A : remplace resoudreCommune(nom, insee) — qui privilégiait le
  // code proposé sans jamais le confronter au nom — par le point de passage
  // unique. On ne persiste que le couple (code, nom) validé au référentiel.
  const insee = await resoudreInseeFiable(input, ctx);
  if (!insee.code) {
    return {
      status: 'not_found', source: SOURCE,
      message:
        `${insee.message ?? 'Commune introuvable au référentiel officiel.'} ` +
        `Ne crée RIEN.`,
    };
  }
  const commune = { code: insee.code, nom: insee.nom ?? '', lat: insee.lat, lng: insee.lng };

  const rayon = num(input.rayon_m);
  const rayonM = rayon != null ? Math.min(50000, Math.max(100, Math.trunc(rayon))) : null;
  const lat = num(input.lat) ?? ctx.parcel?.lat ?? commune.lat ?? null;
  const lng = num(input.lng) ?? ctx.parcel?.lng ?? commune.lng ?? null;
  const libelle = str(input.libelle) ?? commune.nom;

  const ligne = {
    user_id: auth.userId,
    label: libelle,
    city: commune.nom,
    insee_code: commune.code,
    lat, lng,
    radius_m: rayonM,
    is_active: true,
  };

  // ── Temps 1 : APERÇU, aucune écriture ────────────────────────
  if (input.confirmer !== true) {
    return avecAjustement({
      status: 'confirmation_requise', source: SOURCE,
      data: {
        confirmation_requise: true,
        action: 'création d\'une zone de veille',
        apercu: {
          libelle, commune: commune.nom, code_insee: commune.code,
          rayon_m: rayonM, centre: lat != null && lng != null ? { lat, lng } : null,
          precision_centre: num(input.lat) != null ? 'point fourni'
            : ctx.parcel?.lat != null ? 'parcelle ouverte' : 'centre de la commune',
        },
        note:
          "RIEN N'A ÉTÉ CRÉÉ. Présente cet aperçu à l'utilisateur et demande-lui de valider. " +
          "Rappelle-lui le rayon retenu et l'origine du centre : s'il visait un secteur précis et " +
          "que le centre est celui de la commune, propose-lui d'ouvrir la parcelle ou de préciser " +
          "un point. Rappelle UNIQUEMENT après son accord explicite, avec confirmer: true.",
      },
      message: "RIEN N'A ÉTÉ MODIFIÉ. Ceci est un APERÇU. Présente-le à l'utilisateur, attends son accord, puis RAPPELLE CE MÊME OUTIL avec confirmer: true. N'annonce jamais l'action comme faite tant que tu n'as pas reçu une réponse portant le statut ok.",
    }, insee);
  }

  // ── Temps 2 : écriture, sous l'identité de l'utilisateur ─────
  try {
    const db = getUserClient(auth.authHeader);
    const { data, error } = await db.from('watch_zones').insert(ligne).select().single();
    if (error) throw new Error(error.message);
    console.log('[verbe] zone de veille creee', data?.id, commune.code);
    return avecAjustement({
      status: 'ok', source: SOURCE,
      data: {
        cree: true, zone_id: data?.id, libelle, commune: commune.nom,
        code_insee: commune.code, rayon_m: rayonM,
        note: "Zone créée. Annonce-le, cite l'identifiant, et rappelle qu'elle peut être désactivée à tout moment.",
      },
    }, insee);
  } catch (e) {
    return avecAjustement({
      status: 'error', source: SOURCE,
      message:
        `Création refusée par la base : ${errMsg(e)}. La zone n'a PAS été créée — dis-le clairement ` +
        `et ne prétends pas le contraire. Si le message évoque une politique de sécurité (RLS), ` +
        `c'est que la session de l'utilisateur n'autorise pas cette écriture.`,
    }, insee);
  }
}

// Le moteur de rapprochement des watchlists tourne-t-il encore ? On ne le
// DÉCLARE pas, on le CONSTATE : dernier rapprochement observé en base. Sans
// cela, le copilote promet des alertes que rien ne produit — c'est arrivé.
async function dernierRapprochementWatchlist(db: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await db.from('user_watchlist_matches')
      .select('last_matched_at').order('last_matched_at', { ascending: false }).limit(1);
    if (error) return null;
    const v = (data ?? [])[0]?.last_matched_at;
    return typeof v === 'string' ? v : null;
  } catch { return null; }
}

function noteRapprochement(dernier: string | null): string {
  if (!dernier) {
    return "⚠️ AUCUN rapprochement n'a jamais été enregistré : les critères sont MÉMORISÉS, mais " +
           "aucune alerte automatique n'est produite à ce jour. DIS-LE explicitement — ne promets " +
           "PAS à l'utilisateur qu'il « sera alerté ».";
  }
  const jours = Math.round((Date.now() - Date.parse(dernier)) / 86400000);
  if (!Number.isFinite(jours)) return '';
  if (jours > 14) {
    return `⚠️ Le dernier rapprochement de watchlist remonte à ${jours} jours (${dernier.slice(0, 10)}). ` +
           `Le moteur d'alerte semble à l'arrêt : les critères sont bien mémorisés, mais ne promets PAS ` +
           `d'alerte automatique — signale que le rapprochement n'a pas tourné récemment.`;
  }
  return `Dernier rapprochement il y a ${jours} jour(s) : le moteur d'alerte tourne.`;
}

async function toolCreerWatchlist(
  input: Record<string, unknown>, ctx: MimmozaContext, auth: AuthCtx | null,
): Promise<ToolResult> {
  const SOURCE = 'Watchlists Mimmoza';
  if (!auth?.userId || !auth.authHeader) return refuseSansIdentite(SOURCE);

  const noms = Array.isArray(input.communes)
    ? input.communes.map((c) => String(c).trim()).filter(Boolean)
    : str(input.communes) ? [String(input.communes).trim()] : [];
  if (noms.length === 0 && ctx.parcel?.commune) noms.push(ctx.parcel.commune);

  if (noms.length === 0) {
    return {
      status: 'not_found', source: SOURCE,
      message:
        "Aucune commune fournie. Une watchlist s'attache à UNE commune : demande à l'utilisateur " +
        "lesquelles l'intéressent. S'il a cité un département ou une région, explique-lui que la " +
        "recherche se définit commune par commune et propose de lui en créer plusieurs d'un coup. " +
        "Ne choisis PAS les communes à sa place. Ne crée RIEN.",
    };
  }
  if (noms.length > 15) {
    return {
      status: 'not_found', source: SOURCE,
      message: `${noms.length} communes demandées : c'est trop pour une seule opération (maximum 15). Propose à l'utilisateur de resserrer sa sélection.`,
    };
  }

  // Résolution officielle : une commune inconnue est signalée, pas devinée.
  const resolues: { nom: string; cp?: string; code: string }[] = [];
  const introuvables: string[] = [];
  for (const n of noms) {
    const c = await resoudreCommune(n);
    if (c) resolues.push({ nom: c.nom, cp: c.cp, code: c.code });
    else introuvables.push(n);
  }
  if (resolues.length === 0) {
    return {
      status: 'not_found', source: SOURCE,
      message: `Aucune de ces communes n'est reconnue au référentiel officiel : ${introuvables.join(', ')}. Demande à l'utilisateur de vérifier l'orthographe. Ne crée RIEN.`,
    };
  }

  const typeBien   = str(input.type_bien) ?? null;
  const prixMin    = num(input.prix_min) ?? null;
  const prixMax    = num(input.prix_max) ?? null;
  const surfMin    = num(input.surface_min) ?? null;
  const surfMax    = num(input.surface_max) ?? null;
  const scoreMinBr = num(input.score_min);
  const scoreMin   = scoreMinBr != null ? Math.min(100, Math.max(0, Math.trunc(scoreMinBr))) : null;
  const base       = str(input.libelle) ?? (typeBien ? `Recherche ${typeBien}` : 'Recherche');

  // Incohérences signalées AVANT l'écriture : un min supérieur au max ne
  // remontera jamais aucun bien, et l'utilisateur attendrait pour rien.
  const alertes: string[] = [];
  if (prixMin != null && prixMax != null && prixMin > prixMax) alertes.push('prix minimum supérieur au prix maximum');
  if (surfMin != null && surfMax != null && surfMin > surfMax) alertes.push('surface minimale supérieure à la surface maximale');
  if (alertes.length) {
    return {
      status: 'not_found', source: SOURCE,
      message: `Critères incohérents (${alertes.join(' ; ')}) : cette recherche ne remonterait jamais aucun bien. Fais corriger avant de créer quoi que ce soit.`,
    };
  }

  const lignes = resolues.map((c) => ({
    user_id: auth.userId,
    name: resolues.length > 1 ? `${base} — ${c.nom}` : base,
    city: c.nom,
    zip_code: c.cp ?? null,
    property_type: typeBien,
    min_price: prixMin, max_price: prixMax,
    min_surface_m2: surfMin, max_surface_m2: surfMax,
    min_opportunity_score: scoreMin,
    is_active: true,
  }));

  if (input.confirmer !== true) {
    return {
      status: 'confirmation_requise', source: SOURCE,
      data: {
        confirmation_requise: true,
        action: `création de ${lignes.length} watchlist(s) de biens`,
        apercu: lignes.map((l) => ({
          libelle: l.name, commune: l.city, code_postal: l.zip_code,
          type_bien: l.property_type, prix: [l.min_price, l.max_price],
          surface_m2: [l.min_surface_m2, l.max_surface_m2], score_min: l.min_opportunity_score,
        })),
        communes_introuvables: introuvables.length ? introuvables : undefined,
        note:
          "RIEN N'A ÉTÉ CRÉÉ. Présente la liste et fais valider." +
          (introuvables.length
            ? ` ⚠️ SIGNALE que ces communes n'ont pas été reconnues et seront IGNORÉES : ${introuvables.join(', ')}.`
            : '') +
          " Rappelle ensuite avec confirmer: true.",
      },
      message: "RIEN N'A ÉTÉ MODIFIÉ. Ceci est un APERÇU. Présente-le à l'utilisateur, attends son accord, puis RAPPELLE CE MÊME OUTIL avec confirmer: true. N'annonce jamais l'action comme faite tant que tu n'as pas reçu une réponse portant le statut ok.",
    };
  }

  try {
    const db = getUserClient(auth.authHeader);
    const { data, error } = await db.from('user_watchlists').insert(lignes).select('id, name, city');
    if (error) throw new Error(error.message);
    console.log('[verbe] watchlists creees', (data ?? []).length);
    const dernier = await dernierRapprochementWatchlist(db);
    return {
      status: 'ok', source: SOURCE,
      data: {
        creees: (data ?? []).length, watchlists: data,
        communes_ignorees: introuvables.length ? introuvables : undefined,
        dernier_rapprochement: dernier,
        note_alerte: noteRapprochement(dernier),
      },
    };
  } catch (e) {
    return {
      status: 'error', source: SOURCE,
      message: `Création refusée par la base : ${errMsg(e)}. AUCUNE watchlist n'a été créée — dis-le clairement.`,
    };
  }
}

/**
 * Compte les éléments DÉSACTIVÉS d'une famille de veille, et en nomme quelques-uns.
 *
 * Pourquoi les trois listings en ont besoin
 * -----------------------------------------
 * Un listing qui ne trouve aucun élément ACTIF répondait « aucun ». Le modèle
 * en concluait « vous n'avez rien », et l'utilisateur — qui se souvient
 * parfaitement d'avoir créé cette veille — en déduisait qu'elle avait été
 * supprimée. Il la recréait alors en double, ou pire, croyait le produit
 * défaillant. Or l'élément est là, simplement éteint : c'est un fait
 * vérifiable, et il tient en une requête.
 *
 * Renvoie `null` quand il n'y a rien de désactivé non plus, pour que l'appelant
 * distingue « rien du tout » de « rien d'actif ».
 */
async function compterInactives(
  db: ReturnType<typeof getUserClient>,
  table: string,
  colonneLibelle: string,
  colonneActif = 'is_active',
): Promise<{ inactives: number; exemples: string[] } | null> {
  try {
    const { data } = await db.from(table)
      .select(colonneLibelle).eq(colonneActif, false)
      .order('created_at', { ascending: false }).limit(5);
    const lignes = data ?? [];
    if (lignes.length === 0) return null;
    return {
      inactives: lignes.length,
      exemples: lignes
        .map((r) => String((r as Record<string, unknown>)[colonneLibelle] ?? '').trim())
        .filter(Boolean),
    };
  } catch {
    // Le décompte est un confort : son échec ne doit pas casser le listing.
    return null;
  }
}

/** Message uniforme quand rien n'est actif mais que des éléments existent, éteints. */
function messageInactives(famille: string, off: { inactives: number; exemples: string[] }, outilReactivation: string): string {
  const noms = off.exemples.length ? ` : ${off.exemples.join(', ')}` : '';
  return `Aucune ${famille} ACTIVE, mais ${off.inactives} DÉSACTIVÉE(S) existe(nt)${noms}. ` +
    `DIS-LE à l'utilisateur et nomme-les — n'écris jamais « vous n'avez rien », ce serait faux ` +
    `par omission et il la recréerait en double. N'évoque ni une suppression, ni un autre compte, ` +
    `ce serait faux. Propose de la réactiver (${outilReactivation}) ou d'en créer une nouvelle.`;
}

async function toolListerWatchlists(
  input: Record<string, unknown>, _ctx: MimmozaContext, auth: AuthCtx | null,
): Promise<ToolResult> {
  const SOURCE = 'Watchlists Mimmoza';
  if (!auth?.userId || !auth.authHeader) return refuseSansIdentite(SOURCE);
  try {
    const db = getUserClient(auth.authHeader);
    let q = db.from('user_watchlists')
      .select('id, name, city, zip_code, property_type, min_price, max_price, min_surface_m2, max_surface_m2, min_opportunity_score, is_active, created_at')
      .order('created_at', { ascending: false }).limit(50);
    if (input.inclure_inactives !== true) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const w = data ?? [];
    if (w.length === 0) {
      const rappelFamilles =
        " Cela ne dit RIEN des zones de veille ni des veilles appels d'offres, qui ont leurs propres outils.";
      const off = input.inclure_inactives !== true
        ? await compterInactives(db, 'user_watchlists', 'name')
        : null;
      if (off) {
        return {
          status: 'not_found', source: SOURCE,
          data: { actives: 0, inactives: off.inactives, watchlists_inactives: off.exemples },
          message: messageInactives('watchlist de biens', off, 'creer_watchlist ou la page Watchlists') + rappelFamilles,
        };
      }
      return {
        status: 'not_found', source: SOURCE,
        data: { actives: 0, inactives: 0 },
        message: "Aucune watchlist de biens" + (input.inclure_inactives === true ? '' : ' active') +
                 ", et aucune désactivée non plus." + rappelFamilles,
      };
    }
    const dernier = await dernierRapprochementWatchlist(db);
    return { status: 'ok', source: SOURCE,
             data: { total: w.length, watchlists: w, dernier_rapprochement: dernier, note_alerte: noteRapprochement(dernier) } };
  } catch (e) {
    return { status: 'error', source: SOURCE, message: errMsg(e) };
  }
}

async function toolDesactiverWatchlist(
  input: Record<string, unknown>, _ctx: MimmozaContext, auth: AuthCtx | null,
): Promise<ToolResult> {
  const SOURCE = 'Watchlists Mimmoza';
  if (!auth?.userId || !auth.authHeader) return refuseSansIdentite(SOURCE);

  const id = str(input.watchlist_id);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_RE.test(id)) {
    return { status: 'not_found', source: SOURCE,
             message: "Identifiant absent ou invalide. Appelle lister_watchlists pour l'obtenir — ne l'invente pas." };
  }

  const db = getUserClient(auth.authHeader);
  let wl: Record<string, unknown> | null = null;
  try {
    const { data, error } = await db.from('user_watchlists')
      .select('id, name, city, property_type, is_active').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    wl = data ?? null;
  } catch (e) {
    return { status: 'error', source: SOURCE, message: errMsg(e) };
  }
  if (!wl) {
    return { status: 'not_found', source: SOURCE,
             message: `Aucune watchlist accessible sous l'identifiant ${id}. Ne prétends pas l'avoir désactivée.` };
  }
  if (wl.is_active === false) {
    return { status: 'ok', source: SOURCE, data: { deja_inactive: true, watchlist: wl },
             message: "Cette watchlist est déjà désactivée." };
  }

  if (input.confirmer !== true) {
    return {
      status: 'confirmation_requise', source: SOURCE,
      data: { confirmation_requise: true, action: 'désactivation d\'une watchlist', watchlist: wl,
              note: "RIEN N'A ÉTÉ MODIFIÉ. Fais valider, puis rappelle avec confirmer: true." },
      message: "RIEN N'A ÉTÉ MODIFIÉ. Ceci est un APERÇU. Présente-le à l'utilisateur, attends son accord, puis RAPPELLE CE MÊME OUTIL avec confirmer: true. N'annonce jamais l'action comme faite tant que tu n'as pas reçu une réponse portant le statut ok.",
    };
  }

  try {
    const { error } = await db.from('user_watchlists')
      .update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    return { status: 'ok', source: SOURCE, data: { desactivee: true, watchlist_id: id, watchlist: wl } };
  } catch (e) {
    return { status: 'error', source: SOURCE,
             message: `Désactivation refusée : ${errMsg(e)}. La watchlist est TOUJOURS active.` };
  }
}

const AO_CATEGORIES = ['foncier', 'travaux', 'moe'] as const;

async function toolCreerVeilleAo(
  input: Record<string, unknown>, ctx: MimmozaContext, auth: AuthCtx | null,
): Promise<ToolResult> {
  const SOURCE = 'Veilles appels d\'offres Mimmoza';
  if (!auth?.userId || !auth.authHeader) return refuseSansIdentite(SOURCE);

  // Départements : 2 chiffres, Corse, ou DOM sur 3.
  const depsBruts = Array.isArray(input.departements)
    ? input.departements
    : str(input.departements) ? String(input.departements).split(/[,;\s]+/) : [];
  const departements: string[] = [];
  for (const d of depsBruts) {
    const m = /^(2[AB]|\d{2,3})$/i.exec(String(d).trim().toUpperCase());
    if (m && !departements.includes(m[1])) departements.push(m[1]);
  }
  // Repli sur le contexte : la parcelle ouverte donne le département.
  if (departements.length === 0) {
    const insee = ctx.parcel?.code_insee;
    if (insee && /^\d{2}/.test(insee)) departements.push(insee.slice(0, 2));
  }

  const cats = Array.isArray(input.categories)
    ? input.categories.map((c) => String(c).toLowerCase().trim())
        .filter((c) => (AO_CATEGORIES as readonly string[]).includes(c))
    : [];
  const categories = cats.length ? [...new Set(cats)] : [...AO_CATEGORIES];

  const texte = str(input.texte) ?? null;
  const frequence = str(input.frequence) === 'weekly' ? 'weekly' : 'daily';
  const libelle = str(input.libelle) ?? 'Veille appels d\'offres';

  // Contrainte de portée, vérifiée AVANT l'aperçu : mieux vaut l'expliquer que
  // laisser la base refuser une insertion que l'utilisateur croyait validée.
  if (departements.length === 0 && !texte) {
    return {
      status: 'not_found', source: SOURCE,
      message:
        "Cette veille n'a aucune portée : ni département, ni mots-clés. Elle balaierait la France " +
        "entière à chaque passage. Demande à l'utilisateur sur quels départements il veut être " +
        "alerté, ou quels mots-clés l'intéressent. Ne crée RIEN.",
    };
  }

  const ligne = {
    user_id: auth.userId, label: libelle, departements, categories,
    texte, jours_min: 0, frequency: frequence,
    notify_inapp: true, notify_email: false, is_active: true,
  };

  if (input.confirmer !== true) {
    return {
      status: 'confirmation_requise', source: SOURCE,
      data: {
        confirmation_requise: true,
        action: 'création d\'une veille APPELS D\'OFFRES (marchés publics, pas immobilier)',
        apercu: {
          libelle, departements: departements.length ? departements : 'aucun (recherche par mots-clés)',
          categories, texte, frequence,
        },
        note:
          "RIEN N'A ÉTÉ CRÉÉ. Présente l'aperçu et fais valider. VÉRIFIE au passage que l'utilisateur " +
          "voulait bien une veille APPELS D'OFFRES et non une veille IMMOBILIÈRE : les deux se " +
          "demandent avec les mêmes mots. Rappelle ensuite avec confirmer: true.",
      },
      message: "RIEN N'A ÉTÉ MODIFIÉ. Ceci est un APERÇU. Présente-le à l'utilisateur, attends son accord, puis RAPPELLE CE MÊME OUTIL avec confirmer: true. N'annonce jamais l'action comme faite tant que tu n'as pas reçu une réponse portant le statut ok.",
    };
  }

  try {
    const db = getUserClient(auth.authHeader);
    const { data, error } = await db.from('ao_watches').insert(ligne).select().single();
    if (error) throw new Error(error.message);
    console.log('[verbe] veille AO creee', data?.id, departements.join('/'));
    return {
      status: 'ok', source: SOURCE,
      data: { cree: true, veille_id: data?.id, libelle, departements, categories, texte, frequence },
    };
  } catch (e) {
    return {
      status: 'error', source: SOURCE,
      message: `Création refusée par la base : ${errMsg(e)}. La veille n'a PAS été créée — dis-le clairement.`,
    };
  }
}

// ─── get_veille_marche (branché sur market-metrics-zone-v1) ─────────────────
//
// Le manque comblé : le chat savait CRÉER une zone de veille mais jamais la
// consulter. « Quoi de neuf sur mon secteur ? » n'avait aucune réponse
// possible, alors que trois fonctions déployées calculent ces métriques et que
// la page /veille/marche les affiche. Créer sans pouvoir lire était
// l'asymétrie la plus visible du produit.
//
// Contrat vérifié dans market-metrics-zone-v1 avant d'écrire l'appel :
// `{ zip_code, city, transaction_mode, include_samples, sample_limit }`.
// C'est le code postal qui identifie une zone, PAS le code INSEE — la leçon
// de recherche-contacts-mairies-v1.

async function toolVeilleMarche(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<ToolResult> {
  const SOURCE = 'Veille marché Mimmoza';
  if (!INTERNAL_FUNCTIONS.metrics_zone) {
    return {
      status: 'not_configured', source: SOURCE,
      message:
        "Le service Veille marché n'est pas branché (COPILOT_FN_METRICS_ZONE non défini). " +
        "Signale-le sans inventer de chiffres ; propose la page '/veille/marche' via action_ouvrir_page.",
    };
  }

  const cp = str(input.code_postal) ?? ctx.parcel?.code_postal ?? (ctx as any).zip_code ?? null;
  const commune = str(input.commune) ?? ctx.parcel?.commune ?? (ctx as any).city ?? null;
  if (!cp && !commune) {
    return {
      status: 'not_found', source: SOURCE,
      message: "Aucune zone identifiable. Demande à l'utilisateur le code postal ou la commune.",
    };
  }

  const mode = str(input.mode);
  const transactionMode = mode === 'rent' || mode === 'all' ? mode : 'sale';
  const avecAnnonces = input.avec_annonces === true;

  try {
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.metrics_zone, {
      ...(cp ? { zip_code: cp } : {}),
      ...(commune ? { city: commune } : {}),
      transaction_mode: transactionMode,
      dry_run: true,          // lecture seule : on ne réécrit pas les métriques
      include_samples: avecAnnonces,
      sample_limit: avecAnnonces ? 10 : 0,
    });

    const r = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    const m = (r.metrics && typeof r.metrics === 'object') ? r.metrics as Record<string, unknown> : null;
    if (!m) {
      return { status: 'empty', source: SOURCE,
               data: { zone_demandee: cp ?? commune },
               message: `Aucune métrique disponible pour « ${cp ?? commune} ».` };
    }

    const actives = num(m.active_listings) ?? 0;
    if (actives === 0) {
      return {
        status: 'empty', source: SOURCE,
        data: { zone_demandee: cp ?? commune, zone_key: m.zone_key ?? null },
        message:
          `Aucune annonce active sur « ${cp ?? commune} ». Soit la zone n'a jamais été alimentée, ` +
          `soit le marché y est à l'arrêt — ne tranche pas sans le dire. Propose creer_zone_veille ` +
          `si l'utilisateur n'a pas encore de veille sur ce secteur.`,
      };
    }

    return {
      status: 'ok',
      source: `${SOURCE} (annonces en ligne)`,
      data: {
        zone: { code_postal: cp, commune, cle: m.zone_key ?? null },
        mode: transactionMode,
        annonces_actives: actives,
        nouvelles_7j: num(m.new_listings_7d) ?? 0,
        // ⚠️ Prix DEMANDÉ, pas prix de transaction : à ne pas confondre avec DVF.
        prix_median_m2_demande: num(m.median_price_m2),
        delai_median_vente_jours: num(m.median_days_on_market),
        signal_liquidite: m.liquidity_signal ?? null,
        signal_tension: m.tension_signal ?? null,
        calcule_le: m.computed_at ?? null,
        ...(avecAnnonces && Array.isArray(r.samples) ? { annonces: r.samples } : {}),
      },
      message:
        "Le prix médian ci-dessus est un prix DEMANDÉ en annonce, pas un prix de vente réalisé. " +
        "Si tu le compares à une médiane DVF, dis-le explicitement.",
    };
  } catch (e) {
    return { status: 'error', source: SOURCE, message: errMsg(e) };
  }
}

// ─── modifier_veille_appels_offres ──────────────────────────────────────────
//
// Même protocole en deux temps que la désactivation. Deux précautions propres
// à la modification :
//
//   • Les listes (départements, catégories) sont REMPLACÉES, pas fusionnées.
//     L'aperçu montre donc l'avant ET l'après, pour que l'utilisateur voie ce
//     qu'il perd. Sans cela, « ajoute le 40 » effacerait le 64 en silence.
//   • On refuse de vider la portée : une veille sans département ni texte ne
//     remonterait plus rien, tout en restant affichée comme active.

async function toolModifierVeilleAo(
  input: Record<string, unknown>, _ctx: MimmozaContext, auth: AuthCtx | null,
): Promise<ToolResult> {
  const SOURCE = 'Veilles appels d\'offres Mimmoza';
  if (!auth?.userId || !auth.authHeader) return refuseSansIdentite(SOURCE);

  const id = str(input.veille_id);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_RE.test(id)) {
    return {
      status: 'not_found', source: SOURCE,
      message: "Identifiant de veille absent ou invalide. Appelle lister_veilles_appels_offres pour l'obtenir — ne l'invente pas.",
    };
  }

  const db = getUserClient(auth.authHeader);
  let veille: Record<string, unknown> | null = null;
  try {
    const { data, error } = await db.from('ao_watches')
      .select('id, label, departements, categories, texte, is_active').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    veille = data ?? null;
  } catch (e) {
    return { status: 'error', source: SOURCE, message: errMsg(e) };
  }
  if (!veille) {
    return {
      status: 'not_found', source: SOURCE,
      message: `Aucune veille appels d'offres accessible sous l'identifiant ${id}. Ne prétends pas l'avoir modifiée.`,
    };
  }

  // Champs effectivement fournis. Les autres ne sont pas touchés.
  const listeStr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : undefined;

  const patch: Record<string, unknown> = {};
  const libelle = str(input.libelle);
  if (libelle) patch.label = libelle;
  const deps = listeStr(input.departements);
  if (deps) patch.departements = deps;
  const cats = listeStr(input.categories);
  if (cats) patch.categories = cats;
  if (typeof input.texte === 'string') patch.texte = input.texte.trim();
  // Réactivation : c'est le seul moyen de rallumer une veille depuis le chat.
  // `desactiver_veille_appels_offres` ne sait qu'éteindre, si bien qu'une
  // veille coupée était définitivement hors de portée du copilote.
  if (typeof input.actif === 'boolean') patch.is_active = input.actif;

  if (Object.keys(patch).length === 0) {
    return {
      status: 'not_found', source: SOURCE,
      message: "Aucun champ à modifier n'a été fourni. Précise ce que l'utilisateur veut changer : libellé, départements, catégories ou texte.",
    };
  }

  // Portée résultante : on refuse de rendre la veille muette.
  const depsApres = (patch.departements ?? veille.departements ?? []) as string[];
  const texteApres = (patch.texte ?? veille.texte ?? '') as string;
  if ((!Array.isArray(depsApres) || depsApres.length === 0) && !String(texteApres).trim()) {
    return {
      status: 'not_found', source: SOURCE,
      message:
        "Cette modification laisserait la veille SANS PORTÉE — ni département, ni texte de " +
        "recherche. Elle ne remonterait plus aucun avis tout en restant affichée comme active. " +
        "Demande à l'utilisateur de conserver au moins un département ou des mots-clés.",
    };
  }

  if (input.confirmer !== true) {
    return {
      status: 'confirmation_requise', source: SOURCE,
      data: {
        confirmation_requise: true,
        action: "modification d'une veille APPELS D'OFFRES",
        avant: {
          libelle: veille.label, departements: veille.departements,
          categories: veille.categories, texte: veille.texte,
          active: veille.is_active,
        },
        apres: {
          libelle: patch.label ?? veille.label,
          departements: patch.departements ?? veille.departements,
          categories: patch.categories ?? veille.categories,
          texte: patch.texte ?? veille.texte,
          active: patch.is_active ?? veille.is_active,
        },
        note: "Les listes sont REMPLACÉES, pas fusionnées : montre l'avant/après à l'utilisateur.",
      },
      message:
        "RIEN N'A ÉTÉ MODIFIÉ. Ceci est un APERÇU. Présente l'avant/après à l'utilisateur, " +
        "attends son accord, puis RAPPELLE CE MÊME OUTIL avec confirmer: true. " +
        "N'annonce jamais la modification comme faite tant que tu n'as pas reçu une réponse " +
        "portant le statut ok.",
    };
  }

  try {
    patch.updated_at = new Date().toISOString();
    const { data, error } = await db.from('ao_watches')
      .update(patch).eq('id', id)
      .select('id, label, departements, categories, texte, is_active').single();
    if (error) throw new Error(error.message);
    console.log('[verbe] veille AO modifiee', id);
    return { status: 'ok', source: SOURCE, data: { modifiee: true, veille_id: id, veille: data } };
  } catch (e) {
    return { status: 'error', source: SOURCE,
             message: `Modification refusée : ${errMsg(e)}. La veille est INCHANGÉE.` };
  }
}

async function toolDesactiverVeilleAo(
  input: Record<string, unknown>, _ctx: MimmozaContext, auth: AuthCtx | null,
): Promise<ToolResult> {
  const SOURCE = 'Veilles appels d\'offres Mimmoza';
  if (!auth?.userId || !auth.authHeader) return refuseSansIdentite(SOURCE);

  const id = str(input.veille_id);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_RE.test(id)) {
    return {
      status: 'not_found', source: SOURCE,
      message: "Identifiant de veille absent ou invalide. Appelle lister_veilles_appels_offres pour l'obtenir — ne l'invente pas.",
    };
  }

  const db = getUserClient(auth.authHeader);
  let veille: Record<string, unknown> | null = null;
  try {
    const { data, error } = await db.from('ao_watches')
      .select('id, label, departements, categories, texte, is_active').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    veille = data ?? null;
  } catch (e) {
    return { status: 'error', source: SOURCE, message: errMsg(e) };
  }
  if (!veille) {
    return {
      status: 'not_found', source: SOURCE,
      message: `Aucune veille appels d'offres accessible sous l'identifiant ${id}. Ne prétends pas l'avoir désactivée.`,
    };
  }
  if (veille.is_active === false) {
    return { status: 'ok', source: SOURCE, data: { deja_inactive: true, veille },
             message: "Cette veille est déjà désactivée : aucune action nécessaire." };
  }

  if (input.confirmer !== true) {
    return {
      status: 'confirmation_requise', source: SOURCE,
      data: {
        confirmation_requise: true,
        action: 'désactivation d\'une veille APPELS D\'OFFRES', veille,
        note: "RIEN N'A ÉTÉ MODIFIÉ. Fais valider, puis rappelle avec confirmer: true. Réversible : la veille n'est pas supprimée.",
      },
      message: "RIEN N'A ÉTÉ MODIFIÉ. Ceci est un APERÇU. Présente-le à l'utilisateur, attends son accord, puis RAPPELLE CE MÊME OUTIL avec confirmer: true. N'annonce jamais l'action comme faite tant que tu n'as pas reçu une réponse portant le statut ok.",
    };
  }

  try {
    const { error } = await db.from('ao_watches')
      .update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    console.log('[verbe] veille AO desactivee', id);
    return { status: 'ok', source: SOURCE, data: { desactivee: true, veille_id: id, veille } };
  } catch (e) {
    return { status: 'error', source: SOURCE,
             message: `Désactivation refusée : ${errMsg(e)}. La veille est TOUJOURS active.` };
  }
}

async function toolNouveautesAo(
  input: Record<string, unknown>, _ctx: MimmozaContext, auth: AuthCtx | null,
): Promise<ToolResult> {
  const SOURCE = 'Veilles appels d\'offres Mimmoza';
  if (!auth?.userId || !auth.authHeader) return refuseSansIdentite(SOURCE);

  const limite = Math.min(50, Math.max(1, Math.trunc(num(input.limite) ?? 20)));

  try {
    const db = getUserClient(auth.authHeader);
    // ⚠️ Jointure INTERNE sur la veille parente ACTIVE. Sans elle, les
    // nouveautés d'une veille éteinte continuaient de remonter — la même
    // incohérence que l'accueil, qui affichait une alerte pour une veille
    // désactivée depuis une semaine.
    let q = db.from('ao_watch_events')
      .select('id, avis_id, objet, acheteur, url, departements, zone_incertaine, date_limite, is_read, created_at, ao_watches!inner(label, is_active)')
      .eq('ao_watches.is_active', true)
      .order('date_limite', { ascending: true, nullsFirst: false })
      .limit(limite);
    if (input.inclure_lues !== true) q = q.eq('is_read', false);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const lignes = data ?? [];
    if (lignes.length === 0) {
      return {
        status: 'not_found', source: SOURCE,
        message:
          "Aucune nouveauté" + (input.inclure_lues === true ? '' : ' non lue') + " sur les veilles " +
          "appels d'offres. Si l'utilisateur s'en étonne, vérifie avec lister_veilles_appels_offres " +
          "qu'il a bien une veille ACTIVE : une veille absente ou désactivée ne produit rien, ce qui " +
          "n'est pas la même chose qu'une absence d'opportunité.",
      };
    }

    // jours_restants est RECALCULÉ ici : la valeur stockée date du passage de la
    // veille et a pu vieillir de plusieurs jours. Une date limite dépassée doit
    // se voir, pas se déduire.
    const maintenant = Date.now();
    const avis = lignes.map((r: any) => {
      const t = r.date_limite ? Date.parse(r.date_limite) : NaN;
      const jours = Number.isFinite(t) ? Math.round((t - maintenant) / 86400000) : null;
      return {
        id: r.avis_id,
        veille: r.ao_watches?.label ?? null,
        objet: r.objet, acheteur: r.acheteur,
        departements_diffusion: r.departements,
        zone_incertaine: r.zone_incertaine === true,
        date_limite: r.date_limite,
        jours_restants: jours,
        expire: jours != null && jours < 0,
        deja_lu: r.is_read === true,
        lien_markdown: r.url ? `[Avis ${r.avis_id}](${r.url})` : null,
      };
    });

    const expires = avis.filter((a) => a.expire).length;
    const urgents = avis.filter((a) => !a.expire && a.jours_restants != null && a.jours_restants <= 3).length;
    const flous = avis.filter((a) => a.zone_incertaine).length;

    return {
      status: 'ok', source: SOURCE,
      data: {
        total: avis.length, expires, urgents, zone_incertaine: flous, avis,
        note:
          (expires ? `⚠️ ${expires} avis dont la DATE LIMITE EST DÉPASSÉE depuis le passage de la veille : signale-les comme tels, ne les présente pas comme des opportunités ouvertes. ` : '') +
          (urgents ? `⚠️ ${urgents} avis à 3 jours ou moins de la clôture : mets-les en tête. ` : '') +
          (flous ? `⚠️ ${flous} avis à zone d'exécution incertaine. ` : '') +
          "Propose ensuite de les marquer comme lus, sans le faire de ta propre initiative.",
      },
    };
  } catch (e) {
    return { status: 'error', source: SOURCE, message: errMsg(e) };
  }
}

async function toolMarquerNouveautesLues(
  input: Record<string, unknown>, _ctx: MimmozaContext, auth: AuthCtx | null,
): Promise<ToolResult> {
  const SOURCE = 'Veilles appels d\'offres Mimmoza';
  if (!auth?.userId || !auth.authHeader) return refuseSansIdentite(SOURCE);

  const ids = Array.isArray(input.avis_ids)
    ? input.avis_ids.map((v) => String(v)).filter(Boolean).slice(0, 200)
    : null;

  try {
    const db = getUserClient(auth.authHeader);
    let q = db.from('ao_watch_events').update({ is_read: true }).eq('is_read', false);
    if (ids && ids.length) q = q.in('avis_id', ids);
    const { data, error } = await q.select('avis_id');
    if (error) throw new Error(error.message);
    const n = (data ?? []).length;
    return {
      status: 'ok', source: SOURCE,
      data: { marques: n, portee: ids && ids.length ? 'sélection' : 'toutes les non lues' },
      message: n === 0
        ? "Aucune nouveauté n'était à marquer : elles étaient déjà lues."
        : `${n} nouveauté(s) marquée(s) comme lue(s).`,
    };
  } catch (e) {
    return { status: 'error', source: SOURCE,
             message: `Marquage refusé : ${errMsg(e)}. Rien n'a été modifié.` };
  }
}

async function toolListerVeillesAo(
  input: Record<string, unknown>, _ctx: MimmozaContext, auth: AuthCtx | null,
): Promise<ToolResult> {
  const SOURCE = 'Veilles appels d\'offres Mimmoza';
  if (!auth?.userId || !auth.authHeader) return refuseSansIdentite(SOURCE);
  try {
    const db = getUserClient(auth.authHeader);
    let q = db.from('ao_watches')
      .select('id, label, departements, categories, texte, frequency, is_active, last_run_at, created_at')
      .order('created_at', { ascending: false }).limit(50);
    if (input.inclure_inactives !== true) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const v = data ?? [];
    if (v.length === 0) {
      // ⚠️ Ne pas s'arrêter à « aucune veille active ». Une veille DÉSACTIVÉE
      // reste une veille : la passer sous silence poussait le modèle à
      // spéculer — « elle a peut-être été supprimée, ou rattachée à un autre
      // compte » — alors que la réponse exacte était à un compte de distance.
      // Une hypothèse inquiétante à la place d'un fait vérifiable est le pire
      // service qu'on puisse rendre.
      const off = input.inclure_inactives !== true
        ? await compterInactives(db, 'ao_watches', 'label')
        : null;

      if (off) {
        return {
          status: 'not_found', source: SOURCE,
          data: { actives: 0, inactives: off.inactives, veilles_inactives: off.exemples },
          message: messageInactives(
            "veille appels d'offres", off,
            'modifier_veille_appels_offres avec actif: true',
          ),
        };
      }

      return {
        status: 'not_found', source: SOURCE,
        data: { actives: 0, inactives: 0 },
        message: "Aucune veille appels d'offres" + (input.inclure_inactives === true ? '' : ' active') +
                 ", et aucune désactivée non plus. Propose d'en créer une, sans le faire de ta propre initiative.",
      };
    }
    return { status: 'ok', source: SOURCE, data: { total: v.length, veilles: v } };
  } catch (e) {
    return { status: 'error', source: SOURCE, message: errMsg(e) };
  }
}

async function toolListerZonesVeille(
  input: Record<string, unknown>, _ctx: MimmozaContext, auth: AuthCtx | null,
): Promise<ToolResult> {
  const SOURCE = 'Zones de veille Mimmoza';
  if (!auth?.userId || !auth.authHeader) return refuseSansIdentite(SOURCE);

  try {
    const db = getUserClient(auth.authHeader);
    let q = db.from('watch_zones')
      .select('id, label, city, insee_code, lat, lng, radius_m, is_active, created_at')
      .order('created_at', { ascending: false }).limit(50);
    if (input.inclure_inactives !== true) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const zones = data ?? [];
    if (zones.length === 0) {
      const off = input.inclure_inactives !== true
        ? await compterInactives(db, 'watch_zones', 'label')
        : null;
      if (off) {
        return {
          status: 'not_found', source: SOURCE,
          data: { actives: 0, inactives: off.inactives, zones_inactives: off.exemples },
          message: messageInactives('zone de veille', off, 'creer_zone_veille'),
        };
      }
      return {
        status: 'not_found', source: SOURCE,
        data: { actives: 0, inactives: 0 },
        message: "L'utilisateur n'a aucune zone de veille" +
          (input.inclure_inactives === true ? '' : ' active') +
          ", et aucune désactivée non plus." +
          " Propose-lui d'en créer une avec creer_zone_veille, sans le faire de ta propre initiative.",
      };
    }
    return { status: 'ok', source: SOURCE, data: { total: zones.length, zones } };
  } catch (e) {
    return { status: 'error', source: SOURCE, message: errMsg(e) };
  }
}

async function toolDesactiverZoneVeille(
  input: Record<string, unknown>, _ctx: MimmozaContext, auth: AuthCtx | null,
): Promise<ToolResult> {
  const SOURCE = 'Zones de veille Mimmoza';
  if (!auth?.userId || !auth.authHeader) return refuseSansIdentite(SOURCE);

  const id = str(input.zone_id);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_RE.test(id)) {
    return {
      status: 'not_found', source: SOURCE,
      message: "Identifiant de zone absent ou invalide. Appelle lister_zones_veille pour l'obtenir — ne l'invente pas.",
    };
  }

  const db = getUserClient(auth.authHeader);

  // On relit la zone AVANT : l'aperçu doit décrire ce qui existe vraiment, pas
  // ce que le modèle croit avoir compris.
  let zone: Record<string, unknown> | null = null;
  try {
    const { data, error } = await db.from('watch_zones')
      .select('id, label, city, insee_code, radius_m, is_active').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    zone = data ?? null;
  } catch (e) {
    return { status: 'error', source: SOURCE, message: errMsg(e) };
  }
  if (!zone) {
    return {
      status: 'not_found', source: SOURCE,
      message: `Aucune zone de veille accessible sous l'identifiant ${id} (inexistante, ou appartenant à un autre utilisateur). Ne prétends pas l'avoir désactivée.`,
    };
  }
  if (zone.is_active === false) {
    return { status: 'ok', source: SOURCE, data: { deja_inactive: true, zone },
             message: "Cette zone est déjà désactivée : aucune action nécessaire." };
  }

  if (input.confirmer !== true) {
    return {
      status: 'confirmation_requise', source: SOURCE,
      data: {
        confirmation_requise: true, action: 'désactivation d\'une zone de veille', zone,
        note: "RIEN N'A ÉTÉ MODIFIÉ. Fais valider par l'utilisateur, puis rappelle avec confirmer: true. La désactivation est réversible : la zone n'est pas supprimée.",
      },
      message: "RIEN N'A ÉTÉ MODIFIÉ. Ceci est un APERÇU. Présente-le à l'utilisateur, attends son accord, puis RAPPELLE CE MÊME OUTIL avec confirmer: true. N'annonce jamais l'action comme faite tant que tu n'as pas reçu une réponse portant le statut ok.",
    };
  }

  try {
    const { error } = await db.from('watch_zones')
      .update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    console.log('[verbe] zone de veille desactivee', id);
    return { status: 'ok', source: SOURCE, data: { desactivee: true, zone_id: id, zone } };
  } catch (e) {
    return { status: 'error', source: SOURCE,
             message: `Désactivation refusée par la base : ${errMsg(e)}. La zone est TOUJOURS active.` };
  }
}

// ─── get_appels_offres (branché sur appels-offres-v1 via COPILOT_FN_APPELS_OFFRES) ──
// Avis BOAMP encore ouverts. Aucun ancrage géographique implicite : si le modèle
// ne passe pas de département, la recherche est nationale et le résultat le dit
// (règle 4vicies — le périmètre d'une réponse s'annonce, il ne se devine pas).
async function toolAppelsOffres(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  if (!INTERNAL_FUNCTIONS.appels_offres) {
    return {
      status: 'not_configured', source: 'BOAMP',
      message: "Le service Appels d'offres n'est pas encore branché (COPILOT_FN_APPELS_OFFRES non défini). Signale-le sans inventer d'avis.",
    };
  }

  const body: Record<string, unknown> = {};
  if (Array.isArray(input.departements)) body.departements = input.departements;
  else if (str(input.departements)) body.departements = str(input.departements);
  if (Array.isArray(input.categories)) body.categories = input.categories;
  if (str(input.texte)) body.texte = str(input.texte);
  const lim = num(input.limite);
  if (lim != null) body.limite = Math.min(50, Math.max(1, Math.trunc(lim)));
  const jm = num(input.jours_min);
  if (jm != null) body.jours_min = Math.max(0, Math.trunc(jm));

  console.log('[boamp]', JSON.stringify(body));

  try {
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.appels_offres, body) as Record<string, unknown>;
    const st = str(raw?.status) ?? 'ok';
    return {
      status: st === 'ok' ? 'ok' : st === 'no_data' ? 'not_found' : 'error',
      source: INTERNAL_FUNCTIONS.appels_offres,
      data: { perimetre: body.departements ? { echelle: 'départements', valeur: body.departements } : { echelle: 'France entière' }, ...raw },
      message: str(raw?.summary),
    };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.appels_offres, message: errMsg(e) };
  }
}

async function toolZonagePlu(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  return await callGpu(input, ctx, ['municipality', 'zone-urba'], 'zonage', 'Zonage PLU (GPU)');
}

async function toolPrescriptionsUrbanisme(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  return await callGpu(
    input, ctx,
    ['prescription-surf', 'prescription-lin', 'prescription-pct', 'info-surf'],
    'prescriptions', 'Prescriptions d\'urbanisme (GPU)',
  );
}

// ─── get_quick_market_insight (LOT 5) ────────────────────────
// Lecture directe de la vue SQL public.v_quick_questions_mvp via getAdmin().
// Stratégie de matching : listing_id → url → city+zip_code+price+surface (±2%).
// Le calcul est DÉJÀ fait en SQL : le LLM présente, ne recalcule pas.
async function toolQuickMarketInsight(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<ToolResult> {
  const qi: QuickMarketInput = {
    listing_id: str(input.listing_id) ?? (ctx as any).listing_id,
    url:        str(input.url)        ?? (ctx as any).url,
    city:       str(input.city)       ?? (ctx as any).city,
    zip_code:   str(input.zip_code)   ?? (ctx as any).zip_code,
    price:      num(input.price)      ?? (ctx as any).price,
    surface:    num(input.surface)    ?? (ctx as any).surface,
  };

  const SELECT_FIELDS = [
    'id', 'portal', 'listing_portal_id', 'url', 'city', 'zip_code',
    'price', 'surface', 'computed_price_m2', 'median_price_m2',
    'listings_count', 'ecart_marche_pct', 'position_marche',
    'profondeur_marche', 'confidence_level', 'is_discount_opportunity',
    'is_market_coherent', 'has_liquid_market', 'quick_verdict', 'quick_payload',
  ].join(', ');

  const db = getAdmin();
  let row: Record<string, any> | null = null;

  try {
    // ── Stratégie 1 : par listing_id (UUID valide uniquement) ─
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (qi.listing_id && UUID_RE.test(qi.listing_id)) {
      const { data, error } = await db
        .from('v_quick_questions_mvp').select(SELECT_FIELDS)
        .eq('id', qi.listing_id).maybeSingle();
      if (error) throw new Error(error.message);
      if (data) row = data;
    }

    // ── Stratégie 2 : par url ──────────────────────────────────
    if (!row && qi.url) {
      const { data, error } = await db
        .from('v_quick_questions_mvp').select(SELECT_FIELDS)
        .eq('url', qi.url).maybeSingle();
      if (error) throw new Error(error.message);
      if (data) row = data;
    }

    // ── Stratégie 3 : city + zip + price + surface (±2%) ──────
    if (!row && qi.city && qi.zip_code && qi.price != null && qi.surface != null) {
      const { data, error } = await db
        .from('v_quick_questions_mvp').select(SELECT_FIELDS)
        .ilike('city', qi.city.trim())
        .eq('zip_code', qi.zip_code.trim())
        .gte('price', qi.price * 0.98).lte('price', qi.price * 1.02)
        .gte('surface', qi.surface * 0.98).lte('surface', qi.surface * 1.02)
        .limit(1).maybeSingle();
      if (error) throw new Error(error.message);
      if (data) row = data;
    }

    // ── Stratégie 4 (fallback) : médiane marché city+zip ──────
    // Le bien est saisi manuellement (pas ingéré depuis un portail).
    // On récupère la médiane marché de la ville pour calculer la position.
    if (!row && qi.city && qi.zip_code && qi.price != null && qi.surface != null) {
      const { data, error } = await db
        .from('v_quick_questions_mvp').select('median_price_m2, listings_count, profondeur_marche, has_liquid_market')
        .ilike('city', qi.city.trim())
        .eq('zip_code', qi.zip_code.trim())
        .limit(1).maybeSingle();

      if (!error && data && data.median_price_m2) {
        const medianPriceM2 = Number(data.median_price_m2);
        const prixM2Bien = qi.price / qi.surface;
        const ecartPct = ((prixM2Bien - medianPriceM2) / medianPriceM2) * 100;

        let positionMarche: string;
        let isDiscount: boolean;
        let verdict: string;
        if (ecartPct <= -20) { positionMarche = 'fortement décoté'; isDiscount = true; verdict = 'opportunité à étudier'; }
        else if (ecartPct <= -5) { positionMarche = 'légèrement décoté'; isDiscount = true; verdict = 'décote modérée'; }
        else if (ecartPct <= 5) { positionMarche = 'cohérent marché'; isDiscount = false; verdict = 'prix cohérent'; }
        else if (ecartPct <= 20) { positionMarche = 'légèrement surcoté'; isDiscount = false; verdict = 'prix à négocier'; }
        else { positionMarche = 'fortement surcoté'; isDiscount = false; verdict = 'prix à négocier'; }

        // ── Simulation travaux intégrée ──────────────────────────────────
        const ctxAny = ctx as any;
        const renovCost  = typeof ctxAny.renovation_cost_total === 'number' ? ctxAny.renovation_cost_total : 0;
        const fraisAchat = Math.round(qi.price * 0.075);
        const prixRevient = qi.price + renovCost + fraisAchat;
        const margeMediane = Math.round(medianPriceM2 * qi.surface) - prixRevient;
        const margePct     = Math.round((margeMediane / prixRevient) * 100);

        return {
          status: 'ok',
          source: 'v_quick_questions_mvp (marché local)',
          data: {
            note: "Bien saisi manuellement — analyse basée sur la médiane marché de la ville.",
            ville: qi.city,
            code_postal: qi.zip_code,
            prix: qi.price,
            surface: qi.surface,
            prix_m2_bien: Math.round(prixM2Bien),
            prix_m2_marche: medianPriceM2,
            ecart_marche_pct: Math.round(ecartPct * 100) / 100,
            position_marche: positionMarche,
            profondeur_marche: data.profondeur_marche ?? null,
            confiance: 'moyenne',
            nb_annonces_comparables: data.listings_count ?? null,
            opportunite_decote: isDiscount,
            marche_liquide: data.has_liquid_market ?? null,
            verdict,
            // ── Simulation travaux ───────────────────────────────────────
            ...(renovCost > 0 ? {
              simulation_travaux: {
                cout_travaux_ttc:    renovCost,
                cout_par_m2:         ctxAny.renovation_cost_per_m2 ?? null,
                niveau:              ctxAny.renovation_level ?? null,
                gamme:               ctxAny.renovation_gamme  ?? null,
                frais_achat_estimes: fraisAchat,
                prix_de_revient:     prixRevient,
                revente_cible_mediane: Math.round(medianPriceM2 * qi.surface),
                marge_brute_estimee: margeMediane,
                marge_brute_pct:     margePct,
                note_calcul: "Prix revient = achat + travaux TTC + frais achat 7.5%. Revente cible = médiane ville × surface.",
              },
            } : {}),
          },
        };
      }
    }
  } catch (e) {
    console.error('[quick_market_insight] SQL error:', errMsg(e));
    return {
      status: 'error',
      source: 'v_quick_questions_mvp',
      message: `Erreur lecture vue SQL : ${errMsg(e)}`,
    };
  }

  if (!row) {
    return {
      status: 'not_found',
      source: 'v_quick_questions_mvp',
      message: `Aucune donnée marché trouvée pour ${qi.city ?? '?'} (${qi.zip_code ?? '?'}). La ville n'est peut-être pas encore couverte par la veille marché Mimmoza.`,
    };
  }

  return {
    status: 'ok',
    source: 'v_quick_questions_mvp',
    data: {
      ville: row.city ?? null,
      code_postal: row.zip_code ?? null,
      prix: row.price ?? null,
      surface: row.surface ?? null,
      prix_m2_bien: row.computed_price_m2 ?? null,
      prix_m2_marche: row.median_price_m2 ?? null,
      ecart_marche_pct: row.ecart_marche_pct ?? null,
      position_marche: row.position_marche ?? null,
      profondeur_marche: row.profondeur_marche ?? null,
      confiance: row.confidence_level ?? null,
      nb_annonces_comparables: row.listings_count ?? null,
      opportunite_decote: row.is_discount_opportunity ?? null,
      prix_coherent: row.is_market_coherent ?? null,
      marche_liquide: row.has_liquid_market ?? null,
      verdict: row.quick_verdict ?? null,
      ...(row.quick_payload != null ? { detail_payload: row.quick_payload } : {}),
    },
  };
}

// ─── recherche_biens ─────────────────────────────────────────
// Recherche multi-critères en lecture directe sur la vue annonces.
// TODO[contrat-biens]: si une table `listings` plus riche existe (pièces,
// property_type…), remplacer TABLE et ajouter les filtres correspondants.
async function toolRechercheBiens(
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<ToolResult> {
  const TABLE = 'v_quick_questions_mvp';
  const SELECT_FIELDS = [
    'id', 'url', 'city', 'zip_code', 'price', 'surface',
    'computed_price_m2', 'median_price_m2', 'ecart_marche_pct',
    'position_marche', 'is_discount_opportunity', 'quick_verdict',
  ].join(', ');

  const city         = str(input.city)     ?? (ctx as any).city;
  const zip          = str(input.zip_code) ?? (ctx as any).zip_code;
  const priceMin     = num(input.price_min);
  const priceMax     = num(input.price_max);
  const surfaceMin   = num(input.surface_min);
  const surfaceMax   = num(input.surface_max);
  const onlyDiscount = input.only_discounts === true;
  const limit        = Math.min(Math.max(num(input.limit) ?? 10, 1), 25);

  // Un critère de localisation minimum pour éviter un scan global de la vue.
  if (!city && !zip) {
    return {
      status: 'not_found', source: TABLE,
      message: "Précise au moins une ville ou un code postal pour lancer la recherche de biens.",
    };
  }

  try {
    let q = getAdmin().from(TABLE).select(SELECT_FIELDS);
    if (city)          q = q.ilike('city', `%${city.trim()}%`);
    if (zip)           q = q.eq('zip_code', zip.trim());
    if (priceMin != null)   q = q.gte('price', priceMin);
    if (priceMax != null)   q = q.lte('price', priceMax);
    if (surfaceMin != null) q = q.gte('surface', surfaceMin);
    if (surfaceMax != null) q = q.lte('surface', surfaceMax);
    if (onlyDiscount)  q = q.eq('is_discount_opportunity', true);
    // Meilleures décotes d'abord (écart marché croissant ; NULL en dernier).
    q = q.order('ecart_marche_pct', { ascending: true, nullsFirst: false }).limit(limit);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return {
        status: 'not_found', source: TABLE,
        message:
          `Aucun bien ne correspond à ces critères (${city ?? '?'}${zip ? ` ${zip}` : ''}). ` +
          "La ville n'est peut-être pas encore couverte par la veille marché Mimmoza.",
      };
    }

    return {
      status: 'ok', source: TABLE,
      data: {
        count: rows.length,
        criteres: {
          ville: city ?? null, code_postal: zip ?? null,
          budget: { min: priceMin ?? null, max: priceMax ?? null },
          surface: { min: surfaceMin ?? null, max: surfaceMax ?? null },
          uniquement_decotes: onlyDiscount,
        },
        biens: rows.map((r: Record<string, any>) => ({
          id: r.id ?? null,
          url: r.url ?? null,
          ville: r.city ?? null,
          code_postal: r.zip_code ?? null,
          prix: r.price ?? null,
          surface: r.surface ?? null,
          prix_m2: r.computed_price_m2 ?? null,
          prix_m2_marche: r.median_price_m2 ?? null,
          ecart_marche_pct: r.ecart_marche_pct ?? null,
          position_marche: r.position_marche ?? null,
          opportunite_decote: r.is_discount_opportunity ?? null,
          verdict: r.quick_verdict ?? null,
        })),
      },
    };
  } catch (e) {
    console.error('[recherche_biens] SQL error:', errMsg(e));
    return { status: 'error', source: TABLE, message: `Erreur lecture ${TABLE} : ${errMsg(e)}` };
  }
}

// =============================================================
// LOT 6 — Bloc snapshot prédictif pour le system prompt
// =============================================================

function buildPredictiveSnapshotBlock(ps: NonNullable<MimmozaContext['predictive_snapshot']>): string {
  const lines: string[] = [
    `## Données prédictives Mimmoza — ${ps.sources_count ?? '?'}/17 sources actives`,
    ps.deal_label ? `Deal : ${ps.deal_label}` : '',
    '',
  ];

  if (ps.dvf) {
    lines.push('### DVF — Marché immobilier [source: market-study v1]');
    if (ps.dvf.prix_m2_median != null) lines.push(`- Prix médian : ${ps.dvf.prix_m2_median.toLocaleString('fr-FR')} €/m²`);
    if (ps.dvf.nb_transactions != null) lines.push(`- Volume : ${ps.dvf.nb_transactions} transactions`);
    if (ps.dvf.evolution_prix_pct != null) {
      const sign = ps.dvf.evolution_prix_pct > 0 ? '+' : '';
      lines.push(`- Évolution annuelle : ${sign}${ps.dvf.evolution_prix_pct}%`);
    } else {
      lines.push('- Évolution annuelle : non disponible (historique insuffisant en base)');
    }
    if (ps.dvf.prix_m2_min != null && ps.dvf.prix_m2_max != null)
      lines.push(`- Fourchette : ${ps.dvf.prix_m2_min.toLocaleString('fr-FR')} – ${ps.dvf.prix_m2_max.toLocaleString('fr-FR')} €/m²`);
    lines.push('');
  }

  if (ps.market_scores) {
    lines.push('### Scores marché [source: market-study v1]');
    if (ps.market_scores.global != null)        lines.push(`- Score global : ${ps.market_scores.global}/100`);
    if (ps.market_scores.demande != null)        lines.push(`- Demande : ${ps.market_scores.demande}/100`);
    if (ps.market_scores.offre != null)          lines.push(`- Offre : ${ps.market_scores.offre}/100`);
    if (ps.market_scores.environnement != null)  lines.push(`- Environnement : ${ps.market_scores.environnement}/100`);
    if (ps.market_scores.accessibilite != null)  lines.push(`- Accessibilité : ${ps.market_scores.accessibilite}/100`);
    if (ps.market_scores.transport_exclu)        lines.push('- ⚠️ Transport non évalué (zone non-urbaine)');
    lines.push('');
  }

  if (ps.insee) {
    lines.push('### INSEE — Démographie & économie [source: geo.api + FiLoSoFi]');
    if (ps.insee.commune_nom)           lines.push(`- Commune : ${ps.insee.commune_nom}${ps.insee.departement ? ` (dépt. ${ps.insee.departement})` : ''}`);
    if (ps.insee.population != null)    lines.push(`- Population : ${ps.insee.population.toLocaleString('fr-FR')} hab.`);
    if (ps.insee.revenu_median != null) lines.push(`- Revenu médian : ${ps.insee.revenu_median.toLocaleString('fr-FR')} €/an`);
    if (ps.insee.taux_chomage != null)  lines.push(`- Taux de chômage : ${ps.insee.taux_chomage}%`);
    if (ps.insee.taux_pauvrete != null) lines.push(`- Taux de pauvreté : ${ps.insee.taux_pauvrete}%`);
    lines.push('');
  }

  if (ps.bpe) {
    lines.push('### BPE — Équipements locaux [source: BPE / Supabase]');
    if (ps.bpe.score != null)             lines.push(`- Score équipements : ${ps.bpe.score}/100`);
    if (ps.bpe.total_equipements != null) lines.push(`- Total équipements : ${ps.bpe.total_equipements}`);
    const d = [
      ps.bpe.commerces_count != null ? `commerces: ${ps.bpe.commerces_count}` : null,
      ps.bpe.sante_count     != null ? `santé: ${ps.bpe.sante_count}`         : null,
      ps.bpe.education_count != null ? `éducation: ${ps.bpe.education_count}` : null,
      ps.bpe.loisirs_count   != null ? `loisirs: ${ps.bpe.loisirs_count}`     : null,
    ].filter(Boolean);
    if (d.length > 0) lines.push(`- Détail : ${d.join(' | ')}`);
    lines.push('');
  }

  if (ps.transport) {
    lines.push('### Transport [source: Overpass/OSM]');
    if (ps.transport.is_urban === false) {
      lines.push('- Zone non-urbaine — pilier transport non applicable');
    } else {
      if (ps.transport.score != null)          lines.push(`- Score transport : ${ps.transport.score}/100`);
      if (ps.transport.nearest_stop_m != null) lines.push(`- Arrêt le plus proche : ${ps.transport.nearest_stop_m} m`);
      if (ps.transport.has_metro_train)        lines.push('- Métro/train : ✓');
      if (ps.transport.has_tram)               lines.push('- Tramway : ✓');
    }
    lines.push('');
  }

  if (ps.georisques) {
    lines.push('### Géorisques [source: risk-study]');
    if (ps.georisques.nb_risques != null)        lines.push(`- Risques identifiés : ${ps.georisques.nb_risques}`);
    if (ps.georisques.inondation != null)        lines.push(`- Zone inondable : ${ps.georisques.inondation ? 'OUI ⚠️' : 'non'}`);
    if (ps.georisques.sismique != null)          lines.push(`- Zone sismique : ${ps.georisques.sismique}`);
    if (ps.georisques.retrait_gonflement)        lines.push('- Retrait-gonflement argiles : ⚠️ présent');
    if (ps.georisques.radon != null)             lines.push(`- Radon classe : ${ps.georisques.radon}`);
    if (ps.georisques.cavites)                   lines.push('- Cavités souterraines : ⚠️ présentes');
    lines.push('');
  }

  if (ps.dpe) {
    lines.push(`### DPE — Performance énergétique${ps.dpe_source ? ` [source: ${ps.dpe_source}]` : ''}`);
    lines.push(`- Classe : ${ps.dpe}`);
    lines.push('');
  }

  if (ps.plu_zone) {
    lines.push('### PLU — Zonage');
    lines.push(`- Zone : ${ps.plu_zone}`);
    lines.push('');
  }

  if (ps.sitadel_score != null) {
    lines.push('### Sitadel — Concurrence constructive [source: Sitadel/SDES]');
    lines.push(`- Score : ${Math.round(ps.sitadel_score)}/100`);
    lines.push('');
  }

  if (ps.demographie_score != null) {
    lines.push('### Score démographie INSEE');
    lines.push(`- Score : ${Math.round(ps.demographie_score)}/100`);
    lines.push('');
  }

  if (ps.loyer_median_zone != null) {
    lines.push('### Loyer médian de zone [source: saisie manuelle]');
    lines.push(`- ${ps.loyer_median_zone} €/m²/mois`);
    lines.push('');
  }

  if (ps.rentabilite) {
    lines.push('### Rentabilité calculée [source: module Rentabilité Mimmoza]');
    if (ps.rentabilite.rendement_brut != null)     lines.push(`- Rendement brut : ${ps.rentabilite.rendement_brut}%`);
    if (ps.rentabilite.rendement_net != null)      lines.push(`- Rendement net : ${ps.rentabilite.rendement_net}%`);
    if (ps.rentabilite.cashflow_mensuel != null)   lines.push(`- Cash-flow mensuel : ${ps.rentabilite.cashflow_mensuel.toLocaleString('fr-FR')} €`);
    if (ps.rentabilite.marge_brute != null)        lines.push(`- Marge brute : ${ps.rentabilite.marge_brute.toLocaleString('fr-FR')} €`);
    if (ps.rentabilite.marge_brute_pct != null)    lines.push(`- Marge brute % : ${ps.rentabilite.marge_brute_pct}%`);
    if (ps.rentabilite.prix_revente_cible != null) lines.push(`- Prix revente cible : ${ps.rentabilite.prix_revente_cible.toLocaleString('fr-FR')} €`);
    if (ps.rentabilite.tri_pct != null)            lines.push(`- TRI : ${ps.rentabilite.tri_pct}%`);
    if (ps.rentabilite.cout_projet != null)        lines.push(`- Coût de projet : ${ps.rentabilite.cout_projet.toLocaleString('fr-FR')} €`);
    if (ps.rentabilite.cout_achat != null)         lines.push(`- Coût d'acquisition : ${ps.rentabilite.cout_achat.toLocaleString('fr-FR')} €`);
    // La convention est rappelée à chaque fois : côté marchand la marge se
    // rapporte au COÛT DE REVIENT, côté promoteur au CHIFFRE D'AFFAIRES. Sans
    // ce rappel, le modèle compare des taux qui ne sont pas homogènes.
    if (ps.rentabilite.marge_brute_pct != null)
      lines.push("- Convention : marge rapportée au coût de revient (convention marchand de biens). 15 % ici ≈ 13 % en convention promoteur.");
    lines.push('');
  }

  if (ps.travaux_budget != null) {
    lines.push('### Budget travaux [source: simulation Mimmoza]');
    lines.push(`- Budget total TTC : ${ps.travaux_budget.toLocaleString('fr-FR')} €`);
    lines.push('');
  }

  if (ps.fiscal_regime) {
    lines.push('### Régime fiscal [source: module Rentabilité Mimmoza]');
    lines.push(`- Régime : ${ps.fiscal_regime}`);
    lines.push('');
  }

  if (ps.bce_rate != null) {
    lines.push('### Pression crédit BCE [source: API ECB]');
    lines.push(`- Taux directeur : ${ps.bce_rate}%${ps.bce_pressure_label ? ` — ${ps.bce_pressure_label}` : ''}`);
    lines.push('');
  }

  if (ps.horizon_mois != null) {
    lines.push('### Horizon de détention');
    lines.push(`- ${ps.horizon_mois} mois`);
    lines.push('');
  }

  return lines.filter(Boolean).join('\n');
}

// =============================================================
// LOT 8 — Bloc snapshot de page (donnees visibles a l'ecran)
// =============================================================

function buildPageSnapshotBlock(
  psnap: Record<string, string | number | null>,
  pageContext?: MimmozaContext['pageContext'],
): string {
  const entries = Object.entries(psnap).filter(([, v]) => v !== null && v !== '');
  if (entries.length === 0) return '';

  const header = pageContext?.space
    ? `## Donnees de la page actuellement ouverte — espace ${pageContext.space}${pageContext.tab ? ` / ${pageContext.tab}` : ''}`
    : "## Donnees de la page actuellement ouverte (visibles a l'ecran)";

  return [
    header,
    "Ces valeurs ont ete saisies ou calculees par l'utilisateur sur la page courante. Utilise-les directement pour repondre, sans reclamer d'annonce, de parcelle ni d'URL.",
    ...entries.map(([k, v]) => `- ${k} : ${typeof v === 'number' ? v.toLocaleString('fr-FR') : v}`),
  ].join('\n');
}

// =============================================================
// LOT 9 — Bloc étude de risques (données déjà calculées par la page)
// =============================================================

function buildRiskStudyBlock(rs: Record<string, unknown>): string {
  const s = summarizeRisks(rs) as Record<string, any>;
  if (!s || s.note) return ''; // réponse vide/en erreur → pas de bloc

  const lines: string[] = [
    "## Étude de risques Mimmoza — DÉJÀ CALCULÉE (page actuellement ouverte) [source: risk-study]",
    "⚠️ Convention : scores de SÉCURITÉ (100 = zone très sûre, 0 = risque maximal). Un score élevé est POSITIF. Le champ « niveau_risque » reste un niveau de RISQUE (fort = mauvais).",
    "⚠️ RÈGLE ABSOLUE — absence de donnée ≠ absence de risque. Un score « non mesuré », un niveau « inconnu » ou un critère non listé ci-dessous signifie que la source publique n'a pas répondu. Tu ne dois JAMAIS le présenter comme rassurant, ni écrire « hors zone », « aucun risque » ou « pas de PPRI » pour un critère non mesuré. Dis « non mesuré » et indique quelle source manque.",
    "",
  ];

  if (s.commune_nom) lines.push(`- Commune : ${s.commune_nom}${s.departement ? ` (dépt. ${s.departement})` : ''}`);

  const sc = s.scores_securite ?? {};
  const conf = s.confiance ?? {};
  const label = (v: unknown, nom: string) => (v == null ? `${nom} non mesuré` : `${nom} ${v}/100`);
  const scParts = [
    label(sc.global, 'global'),
    label(sc.naturels, 'naturels'),
    label(sc.technologiques, 'technologiques'),
    label(sc.pollution, 'pollution'),
    label(sc.geotechniques, 'géotechniques'),
  ];
  lines.push(`- Scores de sécurité : ${scParts.join(' · ')}`);

  // Indicateur de confiance : une note assise sur une fraction des critères doit
  // se lire comme telle, y compris dans la réponse du Copilot.
  if (conf.criteres_total != null) {
    lines.push(`- Confiance : ${conf.criteres_mesures ?? 0} critère(s) mesuré(s) sur ${conf.criteres_total} (couverture ${conf.coverage ?? 'n.c.'})`);
  }
  if (Array.isArray(conf.categories_non_mesurees) && conf.categories_non_mesurees.length) {
    lines.push(`- ⚠️ Catégories NON MESURÉES, exclues du score global : ${conf.categories_non_mesurees.join(', ')}. Le score global a été renormalisé sur les seules catégories mesurées — signale-le si tu commentes ce score, et ne conclus rien sur les catégories exclues.`);
  }

  if (Array.isArray(s.categories) && s.categories.length) {
    lines.push('', '### Niveau de risque par catégorie');
    for (const c of s.categories) {
      if (!c?.nom) continue;
      if (c.score_securite == null) {
        lines.push(`- ${c.nom} : NON MESURÉ (aucune source disponible) — ne rien conclure`);
      } else {
        const couv = c.criteres_total != null && c.criteres_mesures !== c.criteres_total
          ? `, ${c.criteres_mesures}/${c.criteres_total} critères mesurés`
          : '';
        lines.push(`- ${c.nom} : risque ${c.niveau_risque ?? 'n.c.'} (sécurité ${c.score_securite}/100${couv})`);
      }
    }
  }

  const f = s.faits ?? {};
  const faits: string[] = [];
  // v1.1.0 : `zone_inondable` peut valoir null (GASPAR muet). Le `!= null`
  // d'origine laissait passer `false` et écrivait « hors zone » comme un fait.
  if (f.inondation?.zone_inondable == null) {
    faits.push("Inondation : non mesuré (GASPAR indisponible) — ne pas conclure « hors zone »");
  } else {
    faits.push(`Inondation : ${f.inondation.zone_inondable ? 'zone inondable ⚠️' : 'hors zone (donnée GASPAR confirmée)'}${f.inondation.ppri ? ' (PPRI)' : ''}`);
  }
  // Le libellé (« Moyen ») est celui du zonage réglementaire français ; le
  // niveau de risque Mimmoza (« fort ») est une échelle interne. Sans cette
  // précision le modèle écrit « zone 4 (Moyen) » puis « risque fort » deux
  // lignes plus loin, ce qui se lit comme une contradiction.
  if (f.seisme?.zone == null) {
    faits.push("Séisme : non mesuré (département non résolu)");
  } else {
    faits.push(`Séisme : zone ${f.seisme.zone}${f.seisme.libelle ? ` — libellé réglementaire « ${f.seisme.libelle} »` : ''}${f.seisme.niveau_risque ? `, niveau de risque Mimmoza « ${f.seisme.niveau_risque} » (échelle interne, à ne pas confondre avec le libellé réglementaire)` : ''}`);
  }
  if (f.argiles?.niveau_alea != null) faits.push(`Retrait-gonflement argiles : aléa ${f.argiles.niveau_alea}`);
  if (f.radon?.classe != null) faits.push(`Radon : classe ${f.radon.classe}${f.radon.libelle ? ` (${f.radon.libelle})` : ''}`);
  // risk-study v1.1.1 : `total` est plafonné par la pagination Géorisques.
  // « ICPE : 100 » se lisait comme un décompte exact alors que c'est le plafond.
  // v1.1.1 — Ces quatre faits sont des DÉCOMPTES, et un décompte vaut 0 même
  // quand la source n'a pas répondu. Le test `count != null` les publiait donc
  // tels quels : « Sites pollués (SIS) : 0 · Cavités : 0 · Mouvements : 0 » sur
  // des sources muettes, ce dont le modèle concluait « aucun risque identifié »
  // — juste au-dessus d'un tableau annonçant ces mêmes catégories non mesurées.
  // On ne publie un décompte que si le critère a effectivement été mesuré.
  const compte = (bloc: any, nom: string, valeur: unknown, tronque?: boolean) => {
    if (bloc?.niveau_risque === 'inconnu' || bloc?.coverage === 'error' || bloc?.coverage === 'no_data') {
      faits.push(`${nom} : NON MESURÉ (source indisponible) — ne pas écrire « 0 » ni « aucun »`);
      return;
    }
    if (valeur == null) return;
    faits.push(`${nom} : ${valeur}${tronque ? '+ (décompte plafonné par la pagination Géorisques — dis « au moins N », jamais « N »)' : ''}`);
  };

  compte(
    f.icpe_seveso, 'ICPE',
    f.icpe_seveso?.total != null
      ? `${f.icpe_seveso.total}${f.icpe_seveso.seveso_haut ? `, dont ${f.icpe_seveso.seveso_haut} SEVESO haut ⚠️` : ''}`
      : null,
    f.icpe_seveso?.tronque,
  );
  compte(f.sites_pollues_sis, 'Sites pollués (SIS)', f.sites_pollues_sis?.count, f.sites_pollues_sis?.tronque);
  compte(f.cavites, 'Cavités', f.cavites?.count, f.cavites?.tronque);
  compte(f.mouvements_terrain, 'Mouvements de terrain', f.mouvements_terrain?.count, f.mouvements_terrain?.tronque);
  if (f.feux_foret?.zone_risque != null) faits.push(`Feux de forêt : ${f.feux_foret.zone_risque ? 'zone à risque' : 'hors zone'}${f.feux_foret.obligation_debroussaillement ? ' (débroussaillement obligatoire)' : ''}`);
  if (f.gaspar_coverage === 'error' || f.gaspar_coverage === 'no_data') {
    faits.push("Arrêtés CatNat : NON MESURÉ (GASPAR indisponible) — ne pas écrire « 0 »");
  } else if (f.catnat_count != null) {
    faits.push(`Arrêtés CatNat : ${f.catnat_count}${f.catnat_tronque ? '+ (plafonné)' : ''}`);
  }
  if (faits.length) { lines.push('', '### Faits saillants'); for (const x of faits) lines.push(`- ${x}`); }

  if (Array.isArray(s.insights) && s.insights.length) {
    lines.push('', '### Constats');
    for (const i of s.insights) if (i?.message) lines.push(`- ${i.message}`);
  }

  return lines.join('\n');
}

// =============================================================
// LOT 10 — Bloc implantation 2D (plan déjà dessiné par la page)
// =============================================================

function buildImplantation2DBlock(im: Record<string, any>): string {
  if (!im || typeof im !== 'object') return '';

  const lines: string[] = [
    "## Implantation 2D — PLAN ACTUELLEMENT DESSINÉ PAR L'UTILISATEUR [source: Implantation 2D Mimmoza]",
    "Ces valeurs proviennent du plan ouvert à l'écran. Elles sont la source de vérité pour toute question sur l'implantation, les surfaces bâties ou la conformité du scénario dessiné.",
    "",
  ];

  // ── Parcelle & enveloppe ──
  lines.push('### Parcelle et enveloppe constructible');
  if (im.parcelle_surface_m2 != null)
    lines.push(`- Surface parcelle : ${Number(im.parcelle_surface_m2).toLocaleString('fr-FR')} m²`);
  lines.push(`- Enveloppe constructible : ${im.enveloppe_constructible_definie ? 'calculée' : 'non calculée'}`);
  const reculs = [
    im.recul_facade_m  != null ? `façade ${im.recul_facade_m} m`   : null,
    im.recul_lateral_m != null ? `latéral ${im.recul_lateral_m} m` : null,
    im.recul_fond_m    != null ? `fond ${im.recul_fond_m} m`       : null,
  ].filter(Boolean);
  if (reculs.length) lines.push(`- Reculs appliqués : ${reculs.join(' · ')}`);

  // ── Règles PLU utilisées ──
  const rp = im.regles_plu as Record<string, any> | undefined;
  if (rp) {
    lines.push('', '### Règles utilisées par le moteur de conformité');
    if (rp.maxHeightMeters      != null) lines.push(`- Hauteur max : ${rp.maxHeightMeters} m`);
    if (rp.maxCoverageRatio     != null) lines.push(`- Emprise au sol max : ${Math.round(rp.maxCoverageRatio * 100)} %`);
    if (rp.minSetbackMeters     != null) lines.push(`- Recul minimal : ${rp.minSetbackMeters} m`);
    if (rp.parkingSpacesPerUnit != null) lines.push(`- Stationnement : ${rp.parkingSpacesPerUnit} place(s)/logement`);
    if (im.regles_plu_source === 'placeholder') {
      lines.push(
        "- ⚠️ IMPORTANT : ces règles sont des valeurs PAR DÉFAUT de l'éditeur, PAS le PLU réel de la parcelle. " +
        "Tu dois le signaler à chaque fois que tu commentes une conformité, et inviter l'utilisateur à importer le règlement PLU sur la page Foncier."
      );
    }
  }

  // ── Programme dessiné ──
  lines.push('', '### Programme dessiné');
  lines.push(`- Bâtiments : ${im.nb_batiments ?? 0}`);
  if (im.places_parking_totales != null)
    lines.push(`- Places de stationnement dessinées : ${im.places_parking_totales} (${im.nb_parkings_zones ?? 0} zone(s))`);
  if (Array.isArray(im.batiments) && im.batiments.length) {
    for (const b of im.batiments.slice(0, 12)) {
      lines.push(`  · ${b.nom ?? b.id} — R+${(b.niveaux ?? 1) - 1}, emprise ${b.emprise_m2} m²`);
    }
  }
  if (im.nb_logements != null) lines.push(`- Logements programmés : ${im.nb_logements}`);
  if (im.surface_moy_logement_m2 != null) lines.push(`- Surface moyenne logement : ${im.surface_moy_logement_m2} m²`);

  // ── Conformité PLU (déjà calculée par le moteur, ne PAS recalculer) ──
  const plu = im.plu_checks as Record<string, any> | undefined;
  if (plu) {
    lines.push('', '### Conformité — résultats du moteur PLU (déjà calculés)');
    if (Array.isArray(plu.checks)) {
      for (const c of plu.checks.slice(0, 15)) {
        const label  = c.label ?? c.rule ?? c.id ?? 'règle';
        const statut = c.passed === true ? 'CONFORME' : c.passed === false ? 'NON CONFORME ⚠️' : 'n.c.';
        lines.push(`- ${label} : ${statut}${c.message ? ` — ${c.message}` : ''}`);
      }
    } else {
      lines.push(`- Résultat brut : ${JSON.stringify(plu).slice(0, 800)}`);
    }
  }

  // ── Diagnostic parcellaire ──
  const diag = im.diagnostics as Record<string, any> | undefined;
  if (diag) {
    lines.push('', '### Diagnostic parcellaire (déjà calculé)');
    lines.push(JSON.stringify(diag).slice(0, 800));
  }

  // ── Scénario économique ──
  const sc = im.scenario as Record<string, any> | undefined;
  if (sc) {
    lines.push('', '### Scénario d\'implantation (déjà calculé)');
    lines.push(JSON.stringify(sc).slice(0, 1200));
  }

  return lines.join('\n');
}

// =============================================================
// SECTION 7 — System prompt
// =============================================================

/**
 * Bloc « chaîne d'opération » : l'état réel du projet promoteur, transmis par
 * le front dans ctx.promoteur_chain. Sans lui, le copilote propose des étapes
 * dans le désordre ou relance ce qui est déjà fait — c'est ce bloc qui fait la
 * différence entre répondre et piloter.
 */
function buildPromoteurChainBlock(ctx: MimmozaContext): string {
  const chain = readChain(ctx);
  if (!chain.study_id || chain.steps.length === 0) {
    return "Aucune opération promoteur active. Si l'utilisateur veut étudier un terrain ou monter "
         + "une opération, propose d'en créer une (action_creer_operation) plutôt que de répondre "
         + "dans le vide.";
  }

  const STATUS_FR: Record<string, string> = {
    empty: 'à faire', running: 'en cours', ready: 'faite',
    stale: 'PÉRIMÉE (une étape amont a changé, à relancer)', error: 'en erreur',
  };

  const lignes = chain.steps.map((s) => {
    const bits = [`- ${s.label ?? s.step} (${s.step}) : ${STATUS_FR[s.status ?? 'empty'] ?? s.status}`];
    if (s.runnable === false && (s.blocked_by ?? []).length) {
      bits.push(`— bloquée par : ${(s.blocked_by ?? []).join(', ')}`);
    } else if (s.status === 'empty' || s.status === 'stale') {
      bits.push('— lançable maintenant');
    }
    return bits.join(' ');
  });

  return [
    "## Chaîne de l'opération en cours",
    "État réel du projet. Il fait autorité : ne propose JAMAIS une étape bloquée, et n'affirme "
    + "JAMAIS le résultat d'une étape qui n'est pas « faite ».",
    ...lignes,
    "Si des étapes sont PÉRIMÉES, signale-le en PREMIER : les chiffres affichés ailleurs dans "
    + "l'application ne sont plus cohérents tant qu'elles n'ont pas été relancées.",
  ].join('\n');
}

function buildSystemPrompt(ctx: MimmozaContext, mode: CopilotMode): string {
  console.log('[copilot] pageSnapshot reçu:', JSON.stringify(ctx.pageSnapshot)?.slice(0, 300));
  const verticalLine: Record<Vertical, string> = {
    promoteur: "Tu assistes un promoteur immobilier (constructibilité, bilan, marge, risques).",
    investisseur: "Tu assistes un investisseur (rentabilité, cash-flow, fiscalité, marché).",
    marchand: "Tu assistes un marchand de biens (marge brute, travaux, revente, délais).",
    apporteur: "Tu assistes un apporteur d'affaires (qualification, sourcing, mise en relation).",
    particulier: "Tu assistes un particulier (analyse simple, vulgarisation).",
    generique: "Tu assistes un utilisateur de Mimmoza.",
  };

  // ⚠️ On NE nomme la commune dans le contexte QUE si elle est explicitement fournie.
  // On n'expose pas le code INSEE comme s'il valait un nom de ville (cf. règle 4quater).
  const parcelLine = ctx.parcel
    ? `Parcelle ouverte : ${ctx.parcel.address ?? ctx.parcel.id}` +
      (ctx.parcel.commune ? `, ${ctx.parcel.commune}` : '') +
      (ctx.parcel.plu_zone ? ` (zone ${ctx.parcel.plu_zone})` : '') + '.'
    : "Aucune parcelle ouverte.";

  // Le PLU extrait par le parser est-il disponible dans le contexte ?
  const pluAvailable = !!(ctx.plu && (ctx.plu.zone_code || ctx.plu.ruleset || ctx.plu.oap));

  // Règle quick_market_insight : active pour investisseur + marchand uniquement.
  const showQuickMarketRule = ctx.vertical === 'investisseur' || ctx.vertical === 'marchand';

  // Annonce active transmise par le front
  const hasListing = !!(ctx.listing_id || ctx.url || (ctx.city && ctx.price && ctx.surface));
  // Travaux simulés disponibles dans le contexte
  const ctxAny = ctx as any;
  const hasRenovation = typeof ctxAny.renovation_cost_total === 'number' && ctxAny.renovation_cost_total > 0;
  const renovationLine = hasRenovation
    ? `Budget travaux simulé (Mimmoza) : ${Number(ctxAny.renovation_cost_total).toLocaleString('fr-FR')} € TTC` +
      (ctxAny.renovation_cost_per_m2 ? ` · ${ctxAny.renovation_cost_per_m2} €/m²` : '') +
      (ctxAny.renovation_level ? ` · Niveau : ${ctxAny.renovation_level}` : '') +
      (ctxAny.renovation_gamme  ? ` · Gamme : ${ctxAny.renovation_gamme}` : '') + '.'
    : '';
  const listingLine = hasListing
    ? `Annonce ouverte : ${[
        ctx.city && ctx.zip_code ? `${ctx.city} (${ctx.zip_code})` : ctx.city ?? null,
        ctx.price != null ? `${ctx.price.toLocaleString('fr-FR')} €` : null,
        ctx.surface != null ? `${ctx.surface} m²` : null,
        ctx.listing_id ? `ID: ${ctx.listing_id}` : null,
      ].filter(Boolean).join(' · ')}.`
    : '';

  // ── V1.6 — Analyse de plan (Réhabilitation), poussée à plat par AnalysePlanPage ──
  const hasPlanAnalysis =
    typeof ctxAny.plan_summary === 'string' ||
    typeof ctxAny.plan_rooms === 'string' ||
    typeof ctxAny.plan_surface_retenue_m2 === 'number';
  const planAnalysisBlock = hasPlanAnalysis
    ? [
        '---',
        "## Analyse du plan (page Réhabilitation actuellement ouverte)",
        "Une analyse de plan a été réalisée sur la page courante. Utilise ces données DIRECTEMENT pour répondre, sans réclamer de parcelle, d'annonce ni de plan à charger.",
        ctxAny.plan_surface_retenue_m2 != null
          ? `- Surface retenue : ${Number(ctxAny.plan_surface_retenue_m2).toLocaleString('fr-FR')} m²${ctxAny.plan_room_count ? ` (somme de ${ctxAny.plan_room_count} pièces)` : ''}`
          : null,
        ctxAny.plan_rooms ? `- Pièces détectées : ${ctxAny.plan_rooms}` : null,
        ctxAny.plan_summary ? `- Synthèse de l'analyse : ${ctxAny.plan_summary}` : null,
        ctxAny.plan_anomalies ? `- Anomalies / points de contrôle : ${ctxAny.plan_anomalies}` : null,
        "Ces données proviennent de l'analyse réglementaire et fonctionnelle Mimmoza [source: analyse-plan]. Termine toute conclusion par « À faire valider par un professionnel. »",
        '---',
      ].filter(Boolean).join('\n')
    : '';

  // LOT 6 — snapshot prédictif
  const ps = (ctx as any).predictive_snapshot ?? null;
  if (ps) console.log('[copilot] snapshot sources_count=', ps.sources_count, '· non-null:', Object.keys(ps).filter((k) => ps[k] != null));
  const snapshotBlock = ps ? buildPredictiveSnapshotBlock(ps) : '';
  const hasSnapshot = !!snapshotBlock;

  // LOT 8 — snapshot de page (donnees visibles a l'ecran)
  const psnap = (ctx as any).pageSnapshot ?? null;
  const pageSnapshotBlock = psnap ? buildPageSnapshotBlock(psnap, ctx.pageContext ?? undefined) : '';
  const hasPageSnapshot = !!pageSnapshotBlock;

  // LOT 9 — étude de risques déjà calculée (transmise par la page)
  const rstudy = (ctx as any).risk_study ?? null;
  const riskStudyBlock = rstudy ? buildRiskStudyBlock(rstudy) : '';
  const hasRiskStudy = !!riskStudyBlock;

  // LOT 10 — implantation 2D dessinée (transmise par la page)
  const impl = (ctx as any).implantation_2d ?? null;
  if (impl) console.log('[copilot] implantation_2d reçue · bâtiments=', impl.nb_batiments, '· parcelle_m2=', impl.parcelle_surface_m2);
  const implantationBlock = impl ? buildImplantation2DBlock(impl) : '';
  const hasImplantation = !!implantationBlock;

  // Chaîne d'opération promoteur : où en est le projet, ce qui est lançable.
  const chainBlock = buildPromoteurChainBlock(ctx);

  // ⚠️ RÈGLE DE PRÉSÉANCE — indispensable.
  //
  // Les règles numérotées plus bas nomment une dizaine d'outils à l'impératif
  // (« tu appelles TOUJOURS get_couts_renovation »), alors qu'elles sont
  // rédigées SANS SAVOIR quels outils ont survécu au filtrage par mode et par
  // intention. En mode `quick`, huit outils sont absents ; le sélecteur peut
  // en retirer d'autres. Le modèle recevait donc des ordres portant sur des
  // outils qu'il n'avait pas — d'où des tentatives d'appel en échec, ou des
  // réponses qui s'excusaient de ne pas pouvoir faire ce que le prompt exigeait.
  //
  // Cette phrase est placée EN TÊTE, avant toute règle, pour lever
  // l'ambiguïté une fois pour toutes.
  const preseanceOutils =
    "RÈGLE DE PRÉSÉANCE — la liste d'outils qui t'est fournie dans cette requête " +
    "fait AUTORITÉ sur toutes les règles ci-dessous. Plusieurs règles nomment un " +
    "outil à l'impératif : elles s'appliquent UNIQUEMENT si cet outil figure dans " +
    "ta liste. S'il en est absent, tu ne tentes pas de l'appeler, tu n'inventes " +
    "pas son résultat, et tu ne t'excuses pas : tu réponds avec ce dont tu " +
    "disposes, et tu signales en une phrase quelle information n'a pas pu être " +
    "vérifiée. Un outil absent n'est jamais une raison de ne pas répondre.";

  return [
    "Tu es Mimmoza Copilot, l'assistant IA intégré à la plateforme Mimmoza (intelligence immobilière et foncière française).",
    preseanceOutils,
    verticalLine[ctx.vertical],
    `Contexte : route ${ctx.route}. ${parcelLine}`,
    chainBlock,
    listingLine,
    renovationLine,
    planAnalysisBlock,
    pluAvailable
      ? "Des données PLU extraites par le parser Mimmoza sont disponibles pour cette parcelle : appelle get_parcel_plu pour lire zone, règles et OAP avant de te prononcer sur la constructibilité."
      : "",
    "",
    hasSnapshot ? [
      "---",
      "# DONNÉES PRÉDICTIVES MIMMOZA — DÉJÀ CALCULÉES",
      "Les données suivantes ont été calculées par le moteur prédictif Mimmoza et sont disponibles IMMÉDIATEMENT.",
      "Utilise-les EN PRIORITÉ. N'appelle un tool que pour des données absentes du snapshot ou pour plus de détails (comparables détaillés, recalcul, PLU complet).",
      "Ces données sont sourcées : cite les mentions [source: …] dans tes réponses.",
      "",
      snapshotBlock,
      "---",
    ].join('\n') : "",
    "",
    hasPageSnapshot ? [
      "---",
      pageSnapshotBlock,
      "---",
    ].join('\n') : "",
    "",
    hasRiskStudy ? [
      "---",
      riskStudyBlock,
      "---",
    ].join('\n') : "",
    "",
    hasImplantation ? [
      "---",
      implantationBlock,
      "---",
    ].join('\n') : "",
    "",
    geographicGroundingPolicy(),
    "",
    unsupportedInferencePolicy(),
    "",
    "RÈGLES IMPÉRATIVES :",
    "1. Tu n'inventes jamais de donnée. Si une information n'a pas été obtenue via un outil ou le snapshot, dis-le explicitement.",
    "2. Toute affirmation factuelle (chiffre, zone PLU, prix) doit indiquer sa source entre crochets, ex: [source: market-study v1].",
    "2bis. Tu n'introduis JAMAIS un étalon de comparaison absent des données (moyenne nationale ou départementale, « ordre de grandeur habituel », « au-dessus/en dessous de la moyenne »), ni une étiquette qualitative que les données ne portent pas (« classe aisée », « périurbain », « premium », « fiscalité favorable »). Un qualificatif n'est admis que s'il repose sur un chiffre présent dans la réponse d'un outil — par exemple un score fourni, ou un écart calculé entre deux valeurs fournies. Sinon, tu donnes le chiffre brut et son effet concret, sans jugement.",
    "3. Toute analyse juridique, urbanistique, fiscale ou financière se termine par : « À faire valider par un professionnel. »",
    "4. Tu utilises les données du snapshot prédictif EN PRIORITÉ. Tu n'appelles un tool que pour des données absentes du snapshot.",
    "4bis. Les outils renvoient un champ \"status\". Si status = \"not_configured\", le service n'est pas encore disponible : mentionne-le brièvement en une phrase seulement. Si status = \"not_found\" ou \"error\", la donnée est indisponible : concentre-toi sur ce qui est disponible.",
    "4ter. Quand tu cites un chiffre issu d'un outil ou du snapshot, mentionne sa source.",
    "4quater. Tu ne traduis JAMAIS un code INSEE en nom de commune par toi-même. N'affiche un nom de commune QUE s'il est explicitement présent dans le contexte ou dans le champ \"data\" d'un outil.",
    "4vicies. ANCRAGE GÉOGRAPHIQUE — tu annonces TOUJOURS sur quel périmètre porte ta réponse (telle parcelle, telle commune, tel rayon) dès qu\'une réponse repose sur une localisation. Tu ne RÉUTILISES JAMAIS une référence cadastrale, une commune ou des coordonnées issues d\'un tour PRÉCÉDENT de la conversation dont la résolution a ÉCHOUÉ : une référence qui n\'a pas pu être localisée est morte, elle ne sert ni d\'ancrage, ni de source de code INSEE, ni de repli. Si l\'utilisateur enchaîne une question sans préciser le bien, et que le dernier ancrage valide est ambigu ou absent, tu DEMANDES de quel terrain il parle au lieu de supposer. Quand un outil renvoie un champ \"perimetre\" ou \"avertissement\", tu le restitues en TÊTE de réponse, jamais en note de bas de page : une analyse communale présentée comme parcellaire est une erreur grave.",
    "4quatervicies. NE PROMETS JAMAIS UN TRAITEMENT AUTOMATIQUE que tu n\'as pas constaté. Créer une veille, une watchlist ou une alerte MÉMORISE des critères ; cela ne prouve pas qu\'un moteur les rejoue. Tu n\'écris « vous serez alerté », « vous recevrez une notification » ou « je vous préviens dès que » QUE si la réponse de l\'outil l\'atteste — par exemple un champ dernier_rapprochement récent ou une note_alerte qui le confirme. Si l\'outil signale que le traitement n\'a pas tourné récemment ou jamais, tu le DIS à l\'utilisateur en une phrase claire, et tu formules ce qui est vrai : ses critères sont enregistrés. Une promesse d\'alerte non tenue coûte plus cher qu\'une absence de promesse : l\'utilisateur attend au lieu de chercher.",
    "4tervicies. PORTÉE D\'UN OUTIL — un outil ne voit QUE son domaine. Une réponse vide signifie « rien dans CE périmètre », jamais « cet objet n\'existe pas ». Tu ne conclus JAMAIS qu\'une chose n\'a pas été enregistrée, a échoué ou n\'existe pas en te fondant sur un outil qui couvre un AUTRE domaine — et surtout pas après avoir toi-même annoncé une création réussie : si tu ne retrouves pas ce que tu viens de créer, c\'est que tu interroges le mauvais outil. Dans ce cas, cherche l\'outil du bon domaine ou dis que tu ne peux pas vérifier, mais n\'annonce pas à l\'utilisateur que son enregistrement a disparu. Chaque famille d\'objets a ses propres verbes : veilles immobilières (creer/lister/desactiver_zone_veille) et veilles appels d\'offres (creer/lister/desactiver_veille_appels_offres) sont deux familles SÉPARÉES.",
    "4duovicies. DEUX VEILLES DISTINCTES — chez Mimmoza, « surveille tel secteur » est AMBIGU : cela peut désigner une veille IMMOBILIÈRE (biens, marché, opportunités d\'achat) ou une veille APPELS D\'OFFRES (marchés publics, cessions de terrains publics, concessions d\'aménagement). Les deux se formulent avec les mêmes mots et n\'ont rien à voir. Tant que l\'utilisateur n\'a pas levé l\'ambiguïté, tu NE CRÉES RIEN et tu lui POSES la question en une phrase. Ne devine pas depuis le métier de l\'utilisateur ni depuis la page où il se trouve : un promoteur suit les deux.",
    "4unvicies. IDENTIFIANTS ET LIENS — tu ne RECOMPOSES JAMAIS de mémoire un identifiant, une référence d\'avis, un numéro de dossier ou une URL : tu les REPRODUIS caractère par caractère depuis le champ correspondant de la réponse d\'outil, et quand un champ prêt à l\'emploi existe (par exemple lien_markdown) tu l\'utilises tel quel plutôt que de reconstruire le lien. Dans un tableau, chaque ligne doit porter l\'identifiant de SON propre enregistrement : deux lignes différentes qui affichent le même lien sont une ERREUR de recopie — relis avant d\'envoyer. Si tu n\'as pas l\'identifiant d\'une ligne, laisse la cellule vide plutôt que d\'en inventer un. ⚠️ UN CHAMP DÉJÀ FORMATÉ NE SE COMBINE AVEC RIEN : lien_markdown contient DÉJÀ un lien complet de la forme [texte](url). Tu le colles TEL QUEL, seul dans sa cellule ou sa puce. Tu ne l\'entoures JAMAIS de crochets ou de parenthèses supplémentaires, tu ne l\'imbriques pas dans un autre lien, et tu n\'y accoles NI la citation de source NI aucun autre texte — la mention [source: ...] se place dans une phrase à part, jamais collée à un lien.",
    "4sexvicies. CHIFFRES FINANCIERS — TU NE LES CALCULES JAMAIS TOI-MÊME. La rentabilité, la marge, le TRI, le prix de revient et la charge foncière sont produits par les moteurs de Mimmoza, pas par toi. Deux sources, et deux seulement : (a) pour une opération PROMOTEUR, l\'outil get_bilan_promoteur, qui LIT le bilan enregistré ; (b) pour un bien INVESTISSEUR ou MARCHAND, le bloc rentabilite du snapshot prédictif, déjà présent dans ton contexte quand la page l\'a produit. Si la source est vide, tu le DIS et tu proposes de lancer le calcul — action_lancer_etape(\'bilan\') côté promoteur, ou l\'ouverture de la page \'/marchand-de-bien/analyse?tab=rentabilite\' côté investisseur. Tu ne fabriques pas un ordre de grandeur \u00ab en attendant \u00bb : un chiffre d\'affaires ou une marge inventés se propagent dans une décision d\'achat. ⚠️ LES DEUX CONVENTIONS DE MARGE NE SE COMPARENT PAS : le promoteur rapporte sa marge au CHIFFRE D\'AFFAIRES, le marchand au COÛT DE REVIENT. 15 % promoteur valent environ 17,6 % marchand. Quand tu cites un taux, précise sur quelle base, et ne mets jamais les deux côte à côte sans conversion.",
    "4septvicies. ACTIONS EN DEUX TEMPS — TU NE DIS JAMAIS « c'est fait » SANS PREUVE. Créer, modifier ou désactiver une veille, une zone ou une watchlist se fait en DEUX appels. Le premier renvoie le statut `confirmation_requise` : c'est un APERÇU, RIEN n'a été écrit. Tu le présentes à l'utilisateur et tu attends son accord. Dès qu'il l'a donné — un « oui », « vas-y », « confirme » suffit — tu RAPPELLES IMMÉDIATEMENT LE MÊME OUTIL avec `confirmer: true`, DANS LE MÊME TOUR, avant de rédiger quoi que ce soit. Ne redemande pas l'accord deux fois. ⚠️ Tu n'écris « c'est désactivé », « c'est créé » ou « c'est modifié » QUE si l'outil a répondu avec le statut `ok` ET un champ attestant l'écriture (desactivee, cree, modifiee). Un statut `confirmation_requise` n'est PAS un succès : annoncer une suppression qui n'a pas eu lieu est pire que de ne rien faire, car l'utilisateur n'y reviendra pas. Si tu as perdu l'identifiant entre deux tours, rappelle l'outil de listing pour le retrouver plutôt que de l'inventer ou d'abandonner.",
    "4tricies. « AUCUN RÉSULTAT » N'EST PAS « RIEN À DIRE ». Quand un outil de listing (veilles, zones, watchlists) répond avec le statut `not_found`, regarde TOUJOURS son champ `data` avant de rédiger. S'il contient `inactives` supérieur à 0 ou une liste `veilles_inactives`, tu DOIS nommer ces éléments désactivés dans ta réponse et proposer de les réactiver — même si l'utilisateur n'a demandé que les actifs, même si tu résumes plusieurs familles d'un coup, et même si la réponse en devient plus longue. Écrire « aucune veille » alors qu'une veille désactivée existe est faux par omission : l'utilisateur en conclut qu'elle a disparu, et il la recrée en double. Ne dis « il n'y a rien » QUE si actives et inactives valent toutes les deux 0.",

    "4duodetricies. DOCUMENT JOINT DISPARU DE TON CONTEXTE. Quand l'historique contient un marqueur [PIÈCES JOINTES À CE MESSAGE : …] mais qu'AUCUN document ni image n'accompagne le tour courant, tu n'as PLUS le fichier sous les yeux. Tu ne disposes que de ce que tu en as ÉCRIT toi-même dans tes réponses précédentes. Conduite à tenir : (a) tu peux réutiliser librement les chiffres et constats déjà énoncés dans la conversation ; (b) pour TOUTE information qui n'y figure pas — une valeur du document que tu n'avais pas citée, un détail d'une page, un poste que tu n'avais pas relevé — tu ne la reconstitues JAMAIS de mémoire : tu dis en une phrase que le document n'est plus dans ton contexte et tu demandes à l'utilisateur de le rejoindre au message. (c) Ne prétends jamais « relire » ou « vérifier dans le document » : tu ne le peux pas. Inventer une donnée d'un document que l'utilisateur a sous les yeux est la pire erreur possible — il la croira vérifiée, et il verra qu'elle est fausse.",

    "4undetricies. LECTURE D'UN DPE JOINT. Quand l'utilisateur joint un DPE (PDF ou photo), tu l'analyses de façon structurée et tu ne relèves que ce qui est ÉCRIT dessus : (1) l'étiquette énergie (A→G) ET l'étiquette climat/GES, qui sont deux notes distinctes — ne confonds pas les deux, un bien peut être D en énergie et F en GES ; (2) la consommation en kWh/m²/an et les émissions en kgCO₂/m²/an ; (3) la date de réalisation et la méthode, car un DPE d'avant juillet 2021 relève de l'ancienne méthode et n'est plus opposable ; (4) la surface de référence, le type de chauffage et d'eau chaude ; (5) les déperditions signalées et les recommandations de travaux avec leurs estimations, si le document les porte. Ensuite seulement, tu tires les conséquences : calendrier d'interdiction de location de la loi Climat et Résilience (G depuis 2025, F en 2028, E en 2034 — dis-le comme un calendrier légal, pas comme une estimation), obligation d'audit énergétique à la vente pour les classes F et G, et incidence sur la valeur. ⚠️ Tu ne calcules JAMAIS toi-même un coût de travaux de rénovation : appelle get_couts_renovation. Et si une mention est illisible ou absente du document, tu écris qu'elle est illisible ou absente — tu ne la déduis ni de l'année de construction, ni du type de chauffage, ni des autres valeurs.",

    "4septentricies. IDENTITÉ D'UN PROPRIÉTAIRE — CE QUE TU PEUX ET CE QUE TU NE PEUX PAS. Quand on te demande à qui appartient un terrain, ou comment joindre son propriétaire, tu appelles get_proprietaire_parcelle. Cet outil ne connaît QUE les personnes morales : sociétés, SCI, foncières, collectivités, associations. Pour les propriétaires PERSONNES PHYSIQUES, Mimmoza n'a aucune donnée et ne peut légalement pas en avoir — leur identité figure dans les fichiers fonciers de la DGFiP, dont l'accès est réservé aux collectivités et aux organismes chargés d'une mission de service public, et dont l'acte d'engagement interdit expressément tout démarchage commercial. Tu ne proposes JAMAIS de contourner cela : ni recherche sur le web, ni annuaire, ni recoupement d'indices, ni déduction à partir d'un nom trouvé ailleurs. Si l'utilisateur insiste, tu lui indiques la seule voie légale : la demande de relevé de propriété (formulaire 6815-EM-SD) auprès du centre des impôts fonciers, gratuite mais plafonnée à cinq demandes par semaine et dix par mois, et réservée à un usage ponctuel.",

    "4duodequadragies. « AUCUN PROPRIÉTAIRE TROUVÉ » NE VEUT PAS DIRE « C'EST UN PARTICULIER ». C'est l'erreur de raisonnement la plus tentante sur ce sujet, et elle est fausse. Quand get_proprietaire_parcelle renvoie `not_found`, trois explications coexistent : le bien appartient effectivement à une personne physique ; il appartient à une société unipersonnelle ou à un entrepreneur individuel, que le fichier exclut par construction ; ou le département n'a pas encore été chargé dans Mimmoza. Tu énonces cette incertitude au lieu de la trancher, et tu relaies le champ `avertissement` tel qu'il t'est fourni. Conclure « c'est donc un particulier, vous pouvez le démarcher » serait à la fois faux et imprudent.",

    "4duotricies. DISPOSITIFS DE DÉFISCALISATION — TU NE RÉCITES RIEN DE MÉMOIRE. Les taux, plafonds de loyer, plafonds de ressources et dates limites des dispositifs d'investissement locatif changent CHAQUE ANNÉE, et le paysage a été refondu par la loi de finances pour 2026. Ce que tu crois savoir est probablement périmé. Dès qu'une question touche à la défiscalisation immobilière — Jeanbrun, Denormandie, Loc'Avantages, Pinel, amortissement locatif, « je peux défiscaliser ? », « quel loyer maximum ? », « quel plafond de ressources ? » — tu appelles get_dispositif_fiscal, même si la question te semble élémentaire, même pour dire qu'un dispositif est fermé. Tu ne calcules JAMAIS toi-même un amortissement, une réduction d'impôt ou un loyer plafond. Tu cites le millésime des barèmes renvoyé par l'outil : un chiffre fiscal sans son année est inutilisable.",

    "4tertricies. TROIS DISPOSITIFS SONT OUVERTS, ET UN SEUL EST NEUF. Au 1er septembre 2026, les dispositifs ouverts aux nouveaux investisseurs sont : JEANBRUN NEUF et JEANBRUN ANCIEN (déduction du revenu foncier au titre de l'amortissement, loi de finances 2026, acquisitions du 21/02/2026 au 31/12/2028), DENORMANDIE (réduction d'impôt, ancien à rénover, jusqu'au 31/12/2027) et LOC'AVANTAGES (réduction d'impôt, conventionnement Anah, demande jusqu'au 31/12/2027). Le PINEL est CLOS aux nouveaux investissements depuis le 01/01/2025 : si l'utilisateur en parle au présent, tu le corriges et tu l'orientes vers le Jeanbrun, son successeur — sans jamais laisser entendre qu'il pourrait encore y souscrire. Sont également clos : Pinel+, Censi-Bouvard, Cosse, Scellier, Duflot, Borloo, Robien, Besson. Ne présente JAMAIS un dispositif clos comme une option.",

    "4quattuortricies. AMORTISSEMENT ET RÉDUCTION D'IMPÔT NE SONT PAS LA MÊME CHOSE, et confondre les deux fausse tout. Le Jeanbrun est un AMORTISSEMENT : il diminue le revenu foncier imposable, donc son gain dépend du taux marginal d'imposition — 8 000 € d'amortissement rapportent environ 3 776 € à 30 % de TMI et 4 992 € à 45 %. Il échappe au plafonnement global des niches fiscales. Le Denormandie et le Loc'Avantages sont des RÉDUCTIONS D'IMPÔT : elles s'imputent directement sur l'impôt dû, indépendamment de la TMI, mais entrent dans le plafond de 10 000 € des niches. Tu ne compares donc JAMAIS un taux d'amortissement et un taux de réduction comme s'ils étaient de même nature : 3,5 % d'amortissement et 18 % de réduction ne se comparent pas terme à terme. Si la TMI n'a pas été fournie, l'outil retient 30 % par défaut et te le signale : dis-le, et demande-la, plutôt que de présenter le chiffre comme celui de l'utilisateur.",

    "4quintricies. UN CONSTAT BLOQUANT ANNULE LE CHIFFRE. Le résultat de get_dispositif_fiscal porte un tableau `constats` et un champ `eligible`. Quand `eligible` vaut false, tu n'annonces PAS l'avantage fiscal comme acquis : tu dis d'abord que la condition n'est pas remplie, tu cites le motif exact, et tu ne présentes le montant que comme ce qu'il SERAIT si la condition l'était. Les constats de niveau `avertissement` signalent une condition que l'outil n'a PAS pu vérifier faute d'information — tu les relaies, en demandant la donnée manquante. Trois pièges reviennent constamment et tu dois les démentir activement si l'utilisateur les énonce : (a) le Denormandie exige 25 % de travaux du COÛT TOTAL de l'opération, travaux compris, soit environ un tiers du prix d'acquisition et non un quart ; (b) il n'existe AUCUN engagement Denormandie de 12 ans — les 21 % s'obtiennent par prorogations triennales décidées à l'échéance ; (c) le niveau très social de Loc'Avantages (65 %) n'existe PAS en location directe, il suppose une intermédiation locative.",

    "4sextricies. PLAFONDS DE LOYER : DEUX LOGIQUES DIFFÉRENTES, NE LES MÉLANGE PAS. Pour le secteur intermédiaire — Denormandie, Jeanbrun intermédiaire —, les plafonds sont ZONAUX (A bis, A, B1, B2 et C) et figurent au barème. Pour Loc'Avantages et pour le Jeanbrun social ou très social, ils sont COMMUNAUX : fixés commune par commune, et par arrondissement à Paris, Lyon et Marseille, par arrêté annuel. Tu ne déduis JAMAIS un plafond Loc'Avantages du zonage A/B/C : cela n'a aucun sens. Si l'outil renvoie un avertissement disant que le plafond communal est indisponible, tu le dis franchement et tu invites à le vérifier sur le simulateur officiel — tu ne proposes pas une valeur approchée. Note enfin que les plafonds de RESSOURCES de Loc'Avantages, eux, sont bien zonaux : le même dispositif combine les deux logiques.",

    "4quinvicies. CONTACTS ET ÉLUS — tu n\'écris JAMAIS de mémoire le nom d\'un maire, d\'un adjoint, d\'un élu ou d\'un agent, ni une adresse email, ni un numéro de téléphone de mairie : ce sont des données nominatives qui changent à chaque mandat, et une erreur envoie l\'utilisateur vers le mauvais interlocuteur. Dès qu\'une question porte sur QUI contacter, où écrire ou téléphoner — prise de rendez-vous en mairie, service urbanisme, prospection foncière sur un secteur, identification d\'un élu — tu appelles get_contacts_mairies. Le paramètre rayon_km balaie tout un bassin (« les mairies dans un rayon de 10 km »). Tu restitues UNIQUEMENT les champs renvoyés par l\'outil : si maire, email ou telephone valent null, tu écris que l\'information n\'est pas disponible et tu t\'arrêtes là — tu ne la reconstitues pas, tu ne renvoies pas vers une recherche web, tu n\'extrapoles pas depuis une commune voisine. Les compteurs mairies_sans_email et mairies_sans_maire_connu se mentionnent en une phrase. Pour l\'envoi groupé et l\'export Excel, propose \'/promoteur/recherche-contacts\' via action_ouvrir_page. Enfin, savoir QUI contacter ne dit rien de CE QUI est autorisé : les règles opposables restent celles du PLU (get_parcel_plu).",
    "4quinquies. Pour les RISQUES, les scores sont des scores de SÉCURITÉ : 100 = zone très sûre, 0 = risque maximal. Un score élevé est POSITIF.",
    "4quinquies-a. Si AUCUNE donnée de risque n'est disponible (ni étude de risques injectée, ni bloc géorisques dans le snapshot, ni résultat de get_risks_georisques), tu NE fournis AUCUNE estimation de risque — même « typique », « générale » ou « probable » — déduite du seul nom de la commune. Tu n'inventes JAMAIS un aléa argile, une zone inondable, un PPRI, une sismicité ou une cavité à partir de la localisation. Tu réponds uniquement : l'étude de risques n'a pas encore été lancée pour ce bien, et tu invites l'utilisateur à la lancer depuis l'espace Risques. Aucun tableau de risques estimés.",
    "4quinquies-b. Pour une question portant UNIQUEMENT sur les risques, tu ne mentionnes AUCUNE donnée financière non demandée (budget travaux, prix, marge, rentabilité), même si elle est présente dans le contexte ou le snapshot. Reste strictement sur le périmètre risques.",
    "4sexies. Pour le DVF (get_dvf_comparables), si le résultat contient \"empty\": true, aucune transaction n'a été trouvée : ne donne AUCUN prix au m².",
    "4sexies-bis. Pour le DPE (get_dpe_ademe), si le résultat contient \"empty\": true, aucun DPE n'existe à cette adresse dans la base ADEME : ne donne AUCUNE classe énergétique et rappelle que la base n'est pas exhaustive. Ne déduis JAMAIS une classe DPE du seul âge ou type du bâtiment.",
    "4septies. Si l'utilisateur demande une synthèse de marché et qu'aucune localisation n'est disponible, invite-le à lancer une étude Marché/Risques.",
    showQuickMarketRule
      ? "4octies. Pour toute question sur le prix, la décote, l'opportunité ou la liquidité d'une annonce (investisseur/marchand), appelle get_quick_market_insight en premier. Présente uniquement les champs renvoyés par l'outil ; ne recalcule pas la décote toi-même."
      : "",
    hasSnapshot
      ? "4nonies. Les données du snapshot prédictif (DVF, scores marché, géorisques, DPE, rentabilité…) sont disponibles sans appel de tool. Utilise-les directement pour répondre aux questions sur le marché, les risques ou la performance du deal."
      : "",
    "4decies. Plusieurs scores peuvent porter sur un même thème (environnement, services/équipements, démographie…) tout en provenant de moteurs DIFFÉRENTS : le pilier SmartScore (compute_smartscore) mesure une proximité/qualité pondérée et normalisée, tandis que market-study (scores marché) et BPE (équipements) mesurent autre chose (volume d'équipements, dynamique de marché). Ces scores ne sont donc PAS redondants et ne doivent JAMAIS être présentés comme contradictoires. Quand tu affiches deux scores d'un même thème issus de sources distinctes, indique systématiquement entre parenthèses ce que chacun mesure et garde sa source. En cas d'écart, explique-le par la différence de méthode, jamais comme une incohérence des données.",
    hasPageSnapshot
      ? "4undecies. Des données de la page actuellement ouverte sont fournies (section « Donnees de la page actuellement ouverte »). Si l'utilisateur pose une question sur le bien, la marge, le prix de sortie, le coût de revient ou la rentabilité affichés à l'écran, réponds DIRECTEMENT avec ces valeurs SANS réclamer d'annonce, de parcelle ou d'URL. Ces données priment pour toute question portant sur « cette page », « ce bien » ou « ma valorisation »."
      : "",
    hasRiskStudy
      ? "4duodecies. Une étude de risques Mimmoza DÉJÀ CALCULÉE est fournie ci-dessus. Pour toute question sur les risques (inondation, séisme, argiles, radon, ICPE/SEVESO, cavités, mouvements de terrain, feux de forêt, sites pollués…), réponds DIRECTEMENT à partir de ces données [source: risk-study], sans appeler aucun outil et sans réclamer de parcelle ni de localisation."
      : "",
    "4terdecies. get_parcel_plu concerne UNIQUEMENT l'urbanisme et la constructibilité (zone PLU, hauteur, emprise, reculs, stationnement, OAP). Ne l'appelle JAMAIS pour une question de risques naturels ou technologiques : le PLU n'est pas la bonne source pour les risques.",
    "4quaterdecies. Ne traduis JAMAIS un code INSEE en nom de commune de mémoire (tu te trompes). Utilise UNIQUEMENT le nom de commune renvoyé par un outil. Si aucun outil n'a fourni le nom, écris « commune {code INSEE} » sans inventer de nom.",
    "4quaterdecies-bis. RÈGLE SYMÉTRIQUE, dans l'autre sens : tu ne traduis JAMAIS un nom de commune en code INSEE de mémoire non plus — tu te trompes tout autant, et cette erreur-là est invisible car elle part directement en requête. Ne renseigne un paramètre code_insee ou commune_insee QUE si le code figure explicitement dans le message de l'utilisateur ou dans le contexte fourni. Sinon, laisse le champ VIDE et renseigne le nom de commune : le serveur résout le code lui-même au référentiel officiel. Un code que tu aurais reconstitué est vérifié puis écarté, et ce n'est pas un service que tu rends : tu fais perdre un tour.",
    "4quaterdecies-ter. Si la réponse d'un outil contient un champ « _ajustement » (ou « _insee »), c'est que la commune retenue n'est pas celle qui avait été demandée. Tu dois RELAYER cet écart à l'utilisateur, en clair et avant les chiffres — jamais le passer sous silence, jamais présenter le résultat comme s'il portait sur la commune initialement visée.",
    "4sexdecies. Le contexte peut contenir un DEAL ACTIF, un snapshot prédictif ou des données de page portant sur un bien précis. Tu ne les utilises QUE si la question porte sur ce bien, sur « cette page » ou sur « mon projet ». Tu n'introduis JAMAIS de toi-même un bien, un prix, une estimation, une décote ou un budget que l'utilisateur n'a pas évoqué dans la conversation en cours : une question générale sur une ville, un secteur ou une réglementation reçoit une réponse générale. Si un rapprochement avec le deal actif te paraît utile, tu le PROPOSES en une phrase (« souhaitez-vous que je rapproche cela de votre projet en cours ? ») au lieu d'en dérouler les chiffres.",
    "4quindecies-a. En mode rapide, get_etude_parcelle se suffit à lui-même : après l'avoir appelé, tu n'appelles AUCUN autre outil (ni PLU, ni risques, ni DVF) et tu rédiges directement le rapport. Le budget d'itérations est limité : un outil supplémentaire consomme le tour de synthèse et l'utilisateur ne reçoit alors aucun rapport. Si le PLU ou les risques manquent, tu le signales en partie 5 comme point à vérifier, sans chercher à les récupérer.",
    "4quindecies. Quand tu réponds à partir de get_etude_parcelle, tu ne listes PAS les données brutes : tu rédiges un RAPPORT structuré en cinq parties — (1) Identité de la parcelle ; (2) Contraintes réglementaires (zonage, servitudes) ; (3) Aptitude physique du terrain (pente, altitude, assainissement, solaire) ; (4) Potentiel économique (loyers, zone ABC, fiscalité) ; (5) VERDICT ET POINTS DE VIGILANCE. La partie 5 est la plus importante : elle hiérarchise ce qui bloque, ce qui coûte cher et ce qui reste à vérifier. Tu t'appuies UNIQUEMENT sur les données du bundle, tu cites la source de chaque chiffre, et tu consacres un paragraphe explicite aux sources indisponibles et à ce qu'elles empêchent de conclure. Termine par « À faire valider par un professionnel. » INTERDICTIONS ABSOLUES dans ce rapport : ne JAMAIS nommer ni décrire une couleur de zone d'un PPR (rouge, bleue, orange…) — ce zonage réglementaire n'est dans aucune donnée, renvoie au règlement du PPR en mairie ; ne JAMAIS déduire une caractéristique géographique non fournie (proximité du littoral, d'un cours d'eau, nature de l'aléa) à partir d'une altitude ou d'un nom de commune ; ne JAMAIS introduire un étalon de comparaison absent des données (moyenne nationale, moyenne départementale, ordre de grandeur « habituel ») ; ne JAMAIS qualifier un chiffre de modéré, élevé, favorable, attractif ou pénalisant sans référence chiffrée issue du bundle — présente le taux brut et son effet concret (« TFB 31,75 % : à intégrer au coût de portage »), sans jugement de valeur.",
    "4quindecies-bis. CALCULS DU RAPPORT PARCELLAIRE — si la réponse repose sur get_etude_parcelle et que la question n'est pas explicitement financière, tu ne calcules AUCUN rendement, ratio, dispersion ou indicateur nouveau en combinant loyer, DVF ou autres champs. Cette restriction est propre au rapport parcellaire : elle ne désactive pas la synthèse d'investissement lorsqu'elle est explicitement demandée. Tu transportes et respectes intégralement interdictions_analyse.",
    "4septdecies. Pour toute question de COÛT ou de BUDGET de construction neuve, appelle get_couts_construction — n'avance JAMAIS un €/m² de mémoire, et ne déduis JAMAIS un coût de construction d'un prix DVF (le DVF porte sur des ventes de biens EXISTANTS, pas sur un coût de construction : les deux ne sont pas comparables). Présente le montant comme un ordre de grandeur issu du barème Mimmoza, cite la source, rappelle les postes non inclus (foncier, honoraires, VRD, taxes d'urbanisme, aléas) et la nécessité d'un devis. Si l'outil signale que la typologie n'est pas couverte (EHPAD, clinique, hôtel, école), dis-le franchement et renvoie vers un économiste de la construction : n'utilise JAMAIS 'tertiaire' comme approximation.",
    "4octodecies. COÛT DES TRAVAUX DE RÉNOVATION (bien EXISTANT, distinct de la construction neuve de la règle 4septdecies). Si un budget travaux Mimmoza est déjà fourni (contexte renovation_* ou snapshot travaux_budget), utilise-le EN PRIORITÉ [source: simulation Mimmoza]. SINON, dès que l'utilisateur fournit des photos (ou décrit l'état) d'un bien PRÉCIS qu'il envisage d'acheter, d'estimer ou de rénover, tu estimes le coût des travaux DE TA PROPRE INITIATIVE — sans attendre une demande explicite de budget : une question sur le prix, l'opportunité, la qualité ou un simple « qu'en penses-tu ? » suffit à le déclencher. Et si un prix d'achat est connu, tu enchaînes dans le MÊME message la synthèse d'investissement de la règle 4novodecies (prix de revient + lecture des 3 angles). Cela ne s'applique qu'à un bien précis soumis par l'utilisateur, jamais à une question de marché générale (cf. règle 4sexdecies). Pour le chiffrage lui-même, tu appelles TOUJOURS get_couts_renovation : tu lis l'état sur les photos, tu en déduis les postes à reprendre et leurs quantités (surface, nombre d'ouvertures, nombre de pièces…), tu les transmets à l'outil qui applique les ratios et renvoie la décomposition chiffrée, que tu restitues SANS la recalculer. MODE DE CHIFFRAGE — RÈGLE STRICTE : dès que tu peux nommer NE SERAIT-CE QU'UN poste depuis les photos ou la description (cuisine, salle de bains, sols, peinture, électricité, menuiseries…), tu chiffres OBLIGATOIREMENT poste par poste (paramètre `postes`). Le paramètre `niveau_global` (rafraichissement/partielle/moyenne/lourde/complete) est un forfait grossier de DERNIER RECOURS, réservé au SEUL cas où l'état du bien est totalement illisible et qu'aucun poste n'est identifiable : il ne doit JAMAIS servir de raccourci quand tu as déjà identifié des postes. Chiffrer en `niveau_global` un bien dont tu viens de décrire les postes est une ERREUR (le forfait surestime massivement). Tu choisis aussi la `gamme` (economique/standard/premium) en cohérence avec le bien et tu l'ANNONCES explicitement dans ta réponse (« chiffrage en gamme premium »), pour que l'hypothèse soit traçable. Tu ne réponds JAMAIS « à chiffrer » ni « budget à anticiper » sans montant, et tu ne demandes JAMAIS son budget à l'utilisateur — c'est toi qui l'estimes via l'outil. Donnée absente (surface d'une pièce, gamme) → hypothèse explicite notée [H] transmise en quantité/paramètre à l'outil, et tu chiffres quand même. Présente la sortie sous forme de tableau poste par poste + TOTAL (fourchette) + ratio €/m² implicite (contrôle de cohérence) + 3 scénarios (indispensable / recommandé / valorisation max) si pertinent. Présente les montants comme des ordres de grandeur à confirmer par devis et cite [source: barème rénovation Mimmoza]. Postes non visibles sur photo (structure, réseaux enterrés, humidité, amiante <1997, plomb <1949, assainissement) : signale-les « à confirmer par visite/diagnostic » (l'aléa de l'outil les couvre), mais ne t'en sers JAMAIS comme prétexte pour ne pas chiffrer. Réserves regroupées en un seul bloc final. Termine par « À faire valider par un professionnel. »",
        "4novodecies. SYNTHÈSE INVESTISSEMENT — enchaînement OBLIGATOIRE. Dès que tu disposes À LA FOIS d'une estimation de valeur (comparables DVF/outil ou valeur saisie) ET d'un coût travaux (barème rénovation ou budget Mimmoza), tu ne t'arrêtes PAS au chiffrage : tu enchaînes sur une synthèse d'investissement chiffrée. (a) PRIX DE REVIENT = prix d'achat + travaux + frais d'acquisition ; les frais de notaire dans l'ancien (~7-8 %) sont un ordre de grandeur réglementaire standard que tu peux appliquer en l'annonçant. Si l'utilisateur n'a pas donné le prix d'achat, pose une hypothèse [H] (par défaut le bas de ta fourchette de valeur) pour illustrer le calcul, et marque-la comme hypothèse. (b) Positionne ce prix de revient face à la valeur de marché APRÈS travaux (comparables) et déduis, CHIFFRÉES : la marge brute sous l'angle marchand (valeur de revente − prix de revient, en € et en %) et/ou le rendement locatif si un loyer est disponible. Pour le loyer, appelle get_loyers_reference — ne l'invente JAMAIS. Si un calcul de rentabilité Mimmoza est déjà fourni (snapshot rentabilite / loyer_median_zone), utilise-le EN PRIORITÉ [source: module Rentabilité Mimmoza]. (c) ORDRE IMPÉRATIF : tu livres TOUJOURS le prix de revient EN PREMIER dès qu'il est calculable — il ne dépend d'AUCUN angle, ne le retarde donc jamais derrière une question. Tu ne demandes PAS son angle à l'utilisateur avant de produire la synthèse : tu enchaînes directement une lecture COURTE des trois angles à partir des données disponibles — résidence (paie-t-il le juste prix ? prix de revient face à la valeur de marché), locatif (rendement brut ≈ loyer annuel / prix de revient ; appelle get_loyers_reference pour le loyer, ne l'invente jamais), marchand (marge = valeur de revente − prix de revient, en € et en %). PUIS seulement tu proposes d'approfondir l'angle qui l'intéresse. Tu ne bloques JAMAIS toute la synthèse sur le choix de l'angle. (d) Le prix d'achat est le seul intrant réellement bloquant : s'il manque, réclame-le en UNE phrase ; s'il est connu, tu n'as plus aucune raison de t'arrêter — tu produis la synthèse complète. Termine par « À faire valider par un professionnel. »",
        mode === "quick"
      ? "5. Mode rapide : réponse concise et directe (quelques phrases). Pas de digression. EXCEPTION : une réponse construite sur get_etude_parcelle est un rapport complet en 5 parties (règle 4quindecies) — la concision ne s'y applique pas, et tu ne sacrifies JAMAIS la partie 5 (verdict et points de vigilance), qui est la plus importante."
      : "5. Mode avancé : raisonnement structuré, factuel et sourcé. Pas de digression. EXCEPTION : une réponse construite sur get_etude_parcelle est un rapport complet en 5 parties (règle 4quindecies) — la concision ne s'y applique pas, et tu ne sacrifies JAMAIS la partie 5 (verdict et points de vigilance), qui est la plus importante.",
    "",
    // ── CONCLUSION OBLIGATOIRE SUR LES ÉTUDES ────────────────────────────────
    // Les études (marché, risques, parcelle) produisent beaucoup de tableaux et
    // peu de sens : l'utilisateur reçoit une accumulation de chiffres sans
    // lecture d'ensemble. Cette règle impose une conclusion RÉDIGÉE en fin de
    // réponse — le seul endroit où le modèle doit trancher.
    [
      "# CONCLUSION OBLIGATOIRE — étude de marché, de risques ou de parcelle",
      "",
      "Dès que ta réponse présente une étude (marché, risques, parcelle, faisabilité), tu TERMINES par une section « ## Conclusion » rédigée en PROSE — pas en tableau, pas en liste à puces. 5 à 10 phrases, dans cet ordre :",
      "",
      "1. **Ce que dit le marché / le site, en une phrase tranchée.** Le chiffre qui compte et ce qu'il implique concrètement pour ce projet. Pas de reformulation des tableaux.",
      "2. **Les deux ou trois éléments qui pèsent vraiment** sur la décision, et pourquoi. Tu hiérarchises : tout n'a pas le même poids. Un aléa sismique de zone 4 engage des coûts de structure ; une pharmacie manquante non.",
      "3. **Ce sur quoi la donnée ne permet PAS de se prononcer**, nommément, et ce qu'il faudrait pour lever le doute (quelle source, quel interlocuteur).",
      "4. **La prochaine action utile**, une seule, celle qui débloque le plus.",
      "",
      "Règles de véracité dans cette conclusion — elles priment sur la fluidité :",
      "- Un critère non mesuré n'est JAMAIS présenté comme favorable, ni passé sous silence. « Non mesuré » et « nul » sont deux choses différentes et tu les nommes différemment.",
      "- Tu rappelles le périmètre réel des chiffres cités (commune, département, rayon en km) quand il diffère de ce que le lecteur supposerait.",
      "- Si le score global repose sur une partie seulement des critères, tu le dis dans la conclusion, pas seulement dans un tableau plus haut.",
      "- Tu ne réconcilies pas artificiellement deux chiffres divergents : tu expliques d'où vient l'écart (périmètres, dates, sources) ou tu dis que tu ne peux pas l'expliquer.",
      "- Aucun chiffre nouveau n'apparaît dans la conclusion : elle interprète, elle ne calcule pas.",
      "- Elle se termine par « À faire valider par un professionnel. »",
      "",
      "Cette conclusion est la partie la plus importante de ta réponse. Si tu dois raccourcir, tu coupes les tableaux, jamais la conclusion.",
    ].join('\n'),
    "",
    "Tu réponds toujours en français.",
  ].filter(Boolean).join('\n');
}

// =============================================================
// SECTION 8 — Construction de l'historique (budget tokens)
// =============================================================

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: string | unknown[];
};

async function buildMessages(
  conversationId: string,
  newUserMessage: string,
  mode: CopilotMode,
  attachments?: CopilotAttachment[],
): Promise<AnthropicMessage[]> {
  const limit = MAX_HISTORY_MESSAGES[mode];
  const { data: history } = await getAdmin()
    .from('copilot_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(limit);

  const ordered = (history ?? []).reverse();
  const msgs: AnthropicMessage[] = [];

  for (const m of ordered) {
    const text = extractText(m.content);
    if (text.trim()) {
      msgs.push({ role: m.role as 'user' | 'assistant', content: text });
    }
  }

  // Blocs image/document AVANT le texte (recommandation Anthropic).
  if (attachments?.length) {
    const lastMessage = msgs.at(-1);
    const persistedText = lastMessage?.role === 'user' && typeof lastMessage.content === 'string'
      ? lastMessage.content
      : '';
    if (persistedText) msgs.pop();
    const blocks: unknown[] = attachments.map((a) =>
      a.mediaType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data } }
        : { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } },
    );
    // Le message courant vient d'être persisté AVEC son marqueur de pièces
    // jointes — lequel annonce que le document n'est plus disponible. Or à ce
    // tour-ci il l'est : les blocs sont juste au-dessus. On retire donc le
    // marqueur du texte du tour courant, pour ne pas dire au modèle qu'il ne
    // voit pas ce qu'il a sous les yeux. Le marqueur reste en base, et sera lu
    // aux tours suivants, où il sera exact.
    const currentText = (newUserMessage.trim() || persistedText)
      .replace(/\n*\[PIÈCES JOINTES À CE MESSAGE :[\s\S]*?\]\s*$/u, '')
      .trim();
    if (currentText) blocks.push({ type: 'text', text: currentText });
    msgs.push({ role: 'user', content: blocks });
    console.log('[copilot] pieces jointes recues :', attachments.length);
  } else if (newUserMessage.trim()) {
    msgs.push({ role: 'user', content: newUserMessage });
  }
  return msgs;
}

// =============================================================
// RAPPEL DES DONNÉES DÉJÀ OBTENUES DANS LA CONVERSATION
// -------------------------------------------------------------
// Le problème : `buildMessages` ne relit que le TEXTE des messages persistés.
// Tout ce qu'un outil avait renvoyé au tour précédent — prix DVF, règles PLU,
// risques, coordonnées de mairies — disparaissait. À la question suivante, le
// modèle relançait les mêmes outils (coût, latence, et parfois un résultat
// différent), ou répondait sans données. En mode quick, l'historique vaut
// 6 messages, soit trois échanges : le problème se posait dès la deuxième
// question.
//
// Pourquoi un DIGEST et non les blocs tool_use / tool_result d'origine :
// l'API Anthropic exige un appariement strict — chaque bloc `tool_use` d'un
// message assistant doit être suivi immédiatement du `tool_result`
// correspondant. Un historique tronqué à N messages casse cet appariement et
// fait échouer la requête entière. Le digest n'a pas cette contrainte, se
// borne en taille, et suffit : le modèle a besoin des FAITS, pas de rejouer
// le protocole d'appel.
// =============================================================

/**
 * Plafond d'une sortie d'outil transmise au modèle, en caractères.
 *
 * Aucune troncature n'était appliquée : le `JSON.stringify` intégral partait au
 * modèle. Une réponse volumineuse — 500 mutations DVF, un règlement de PLU
 * complet — pouvait à elle seule saturer la fenêtre de contexte et faire
 * échouer le tour, ou évincer le reste de la conversation. 24 000 caractères
 * représentent environ 6 000 tokens : très large pour un résultat structuré,
 * et la coupure est ANNONCÉE au modèle pour qu'il ne complète pas de mémoire.
 */
const TOOL_OUTPUT_MAX_CHARS = 24000;

function tronquerSortieOutil(output: unknown): string {
  let brut: string;
  try {
    brut = JSON.stringify(output) ?? 'null';
  } catch {
    return JSON.stringify({ status: 'error', message: 'Sortie non sérialisable.' });
  }
  if (brut.length <= TOOL_OUTPUT_MAX_CHARS) return brut;

  return JSON.stringify({
    _tronque: true,
    _note:
      `Sortie tronquée : ${brut.length} caractères ramenés à ${TOOL_OUTPUT_MAX_CHARS}. ` +
      "Les données ci-dessous sont INCOMPLÈTES — ne complète pas de mémoire. " +
      "Si le détail manquant est nécessaire, rappelle l'outil avec des " +
      'paramètres plus restrictifs (rayon plus court, période plus courte, ' +
      'limite plus basse).',
    _extrait: brut.slice(0, TOOL_OUTPUT_MAX_CHARS),
  });
}

/** Budget de caractères du rappel. Au-delà, on garde les appels les plus récents. */
const PRIOR_RESULTS_MAX_CHARS = 6000;
/** Nombre d'appels d'outils relus au maximum. */
const PRIOR_RESULTS_MAX_CALLS = 12;
/** Troncature d'une sortie d'outil isolée. */
const PRIOR_RESULT_MAX_CHARS = 900;

function compactJson(value: unknown, maxChars: number): string {
  let s: string;
  try {
    s = JSON.stringify(value) ?? 'null';
  } catch {
    return '[non sérialisable]';
  }
  return s.length > maxChars ? `${s.slice(0, maxChars)}… (tronqué)` : s;
}

/**
 * Relit les appels d'outils RÉUSSIS de la conversation et en fait un bloc
 * compact à injecter dans le prompt système.
 *
 * Déduplication : un même outil appelé plusieurs fois avec les mêmes
 * paramètres n'apparaît qu'une fois, dans sa version la plus récente.
 * Retourne '' quand il n'y a rien à rappeler.
 */
async function buildPriorToolResultsBlock(conversationId: string): Promise<string> {
  try {
    const { data, error } = await getAdmin()
      .from('copilot_tool_calls')
      .select('tool_name, tool_input, tool_output, status, created_at')
      .eq('conversation_id', conversationId)
      .eq('status', 'ok')
      .order('created_at', { ascending: false })
      .limit(PRIOR_RESULTS_MAX_CALLS * 3);

    if (error || !Array.isArray(data) || data.length === 0) return '';

    const vus = new Set<string>();
    const lignes: string[] = [];
    let budget = PRIOR_RESULTS_MAX_CHARS;

    for (const row of data as Array<Record<string, unknown>>) {
      const nom = typeof row.tool_name === 'string' ? row.tool_name : null;
      if (!nom) continue;
      // Les actions ne rapportent aucune donnée : rien à rappeler.
      if (nom.startsWith('action_')) continue;

      const signature = `${nom}:${compactJson(row.tool_input, 200)}`;
      if (vus.has(signature)) continue;
      vus.add(signature);

      const entree = compactJson(row.tool_input, 200);
      const sortie = compactJson(row.tool_output, PRIOR_RESULT_MAX_CHARS);
      const ligne = `### ${nom} ${entree}\n${sortie}`;
      if (ligne.length > budget) break;
      budget -= ligne.length;
      lignes.push(ligne);
      if (lignes.length >= PRIOR_RESULTS_MAX_CALLS) break;
    }

    if (lignes.length === 0) return '';

    // Ordre chronologique : plus lisible pour le modèle que l'ordre inverse.
    lignes.reverse();

    return [
      '---',
      '# DONNÉES DÉJÀ OBTENUES DANS CETTE CONVERSATION',
      "Ces résultats proviennent d'outils que TU AS DÉJÀ APPELÉS plus tôt dans cet",
      "échange. Utilise-les directement plutôt que de rappeler le même outil avec",
      'les mêmes paramètres. Rappelle un outil UNIQUEMENT si : la question porte',
      "sur un autre bien ou une autre commune, tu as besoin d'un paramètre",
      "différent (autre rayon, autre période), ou la sortie ci-dessous est",
      'tronquée et le détail manquant est nécessaire.',
      '',
      "⚠️ Ces sorties peuvent être TRONQUÉES (marquées « (tronqué) ») : n'invente",
      'jamais la suite, rappelle l\'outil si le détail compte.',
      '',
      ...lignes,
      '---',
    ].join('\n');
  } catch (e) {
    // Un rappel indisponible ne doit jamais empêcher de répondre.
    console.warn('[copilot] rappel des résultats précédents indisponible :', e);
    return '';
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'text')
      .map((b) => (b as { text?: string }).text ?? '')
      .join('\n');
  }
  return '';
}

// =============================================================
// SECTION 9 — SSE writer
// =============================================================

type StreamEvent =
  | { type: 'reservation'; reserved_credits: number; remaining: number }
  | { type: 'conversation'; conversation_id: string }
  | { type: 'message_start'; message_id: string }
  | { type: 'token'; delta: string }
  | { type: 'tool_use_start'; call: { id: string; name: string; input: unknown } }
  | { type: 'tool_use_end'; call: { id: string; name: string; output: unknown; duration_ms: number; status: string; error?: string } }
  | { type: 'done'; message_id: string; final_credits: number }
  | { type: 'error'; error: string; refunded_credits?: number };

class SSEWriter {
  private encoder = new TextEncoder();
  private closed = false;
  constructor(private controller: ReadableStreamDefaultController<Uint8Array>) {}
  send(event: StreamEvent) {
    if (this.closed) return;
    try {
      this.controller.enqueue(this.encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      this.closed = true; // client déconnecté : on cesse d'écrire sans throw
    }
  }
  get isClosed() { return this.closed; }
  close() {
    this.closed = true;
    try { this.controller.close(); } catch { /* already closed */ }
  }
}

// =============================================================
// SECTION 10 — Appel Anthropic (streaming) + parsing + timeout
// =============================================================

interface LLMTurnResult {
  textBlocks: string[];
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
}

async function streamLLMTurn(params: {
  model: string;
  system: string;
  messages: AnthropicMessage[];
  tools: ToolDef[];
  maxTokens: number;
  onToken: (delta: string) => void;
  onGenerationStart?: () => void;   // NEW
}): Promise<LLMTurnResult> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new CopilotError('LLM_ERROR', 'ANTHROPIC_API_KEY manquant');

  const body = {
    model: params.model,
    max_tokens: params.maxTokens,
    system: params.system,
    messages: params.messages,
    stream: true,
    ...(params.tools.length > 0
      ? {
          tools: params.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
          })),
        }
      : {}),
  };

  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new CopilotError('LLM_ERROR', `Timeout Anthropic (${LLM_TIMEOUT_MS}ms dépassés)`);
    }
    throw new CopilotError('LLM_ERROR', `Échec requête Anthropic : ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!res.ok || !res.body) {
    clearTimeout(timeoutId);
    const errText = await res.text().catch(() => '');
    if (res.status === 429) {
      throw new CopilotError('RATE_LIMITED', `Anthropic rate limit : ${errText.slice(0, 200)}`);
    }
    throw new CopilotError('LLM_ERROR', `Anthropic API ${res.status} : ${errText.slice(0, 300)}`);
  }

  const textBlocks: string[] = [];
  const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
  const partialBlocks: Record<number, {
    type: string; text?: string; id?: string; name?: string; partialJson?: string;
  }> = {};
  let stopReason = 'end_turn';
  let inputTokens = 0;
  let outputTokens = 0;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let evt: Record<string, unknown>;
        try { evt = JSON.parse(payload); } catch { continue; }

        switch (evt.type) {
          case 'message_start': {
  const usage = (evt.message as { usage?: { input_tokens?: number } })?.usage;
  inputTokens = usage?.input_tokens ?? 0;
  params.onGenerationStart?.();   // NEW : pivot de non-remboursement
  break;
}
          case 'content_block_start': {
            const idx = evt.index as number;
            const block = evt.content_block as Record<string, unknown>;
            if (block.type === 'tool_use') {
              partialBlocks[idx] = {
                type: 'tool_use', id: block.id as string,
                name: block.name as string, partialJson: '',
              };
            } else if (block.type === 'text') {
              partialBlocks[idx] = { type: 'text', text: '' };
            }
            break;
          }
          case 'content_block_delta': {
            const idx = evt.index as number;
            const delta = evt.delta as Record<string, unknown>;
            const pb = partialBlocks[idx];
            if (!pb) break;
            if (delta.type === 'text_delta') {
              const t = delta.text as string;
              pb.text = (pb.text ?? '') + t;
              params.onToken(t);
            } else if (delta.type === 'input_json_delta') {
              pb.partialJson = (pb.partialJson ?? '') + (delta.partial_json as string);
            }
            break;
          }
          case 'content_block_stop': {
            const idx = evt.index as number;
            const pb = partialBlocks[idx];
            if (!pb) break;
            if (pb.type === 'text' && pb.text) {
              textBlocks.push(pb.text);
            } else if (pb.type === 'tool_use') {
              let parsedInput: Record<string, unknown> = {};
              try { parsedInput = pb.partialJson ? JSON.parse(pb.partialJson) : {}; } catch { /* keep {} */ }
              toolUses.push({ id: pb.id!, name: pb.name!, input: parsedInput });
            }
            delete partialBlocks[idx];
            break;
          }
          case 'message_delta': {
            const delta = evt.delta as { stop_reason?: string };
            if (delta?.stop_reason) stopReason = delta.stop_reason;
            const usage = (evt.usage as { output_tokens?: number }) ?? {};
            if (usage.output_tokens) outputTokens = usage.output_tokens;
            break;
          }
          case 'error': {
            const e = evt.error as { message?: string };
            throw new CopilotError('LLM_ERROR', `Stream error : ${e?.message ?? 'unknown'}`);
          }
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return { textBlocks, toolUses, stopReason, inputTokens, outputTokens };
}

// =============================================================
// SECTION 11 — Orchestrateur (boucle tool-calling)
// =============================================================

interface OrchestratorResult {
  finalText: string;
  toolCallsLog: Array<{
    id: string; name: string; input: unknown; output: unknown;
    status: 'success' | 'error'; durationMs: number; error?: string;
  }>;
  totalInputTokens: number;
  totalOutputTokens: number;
  model: string;
  finishReason: string;
}

async function runOrchestrator(params: {
  mode: CopilotMode;
  tier: ModelTier;                    // ⬅️ nouveau
  ctx: MimmozaContext;
  messages: AnthropicMessage[];
  sse: SSEWriter;
  auth?: AuthCtx | null;
  onGenerationStart?: () => void;
  /** Rappel des données déjà obtenues dans la conversation (peut être vide). */
  priorToolResults?: string;
}): Promise<OrchestratorResult> {
  const { mode, tier, ctx, sse, onGenerationStart } = params;
  const auth = params.auth ?? null;
  const model = TIER_MODEL_ID[tier];   // ⬅️ le modèle suit le plan, pas le mode
  // Le rappel est ajouté APRÈS les règles : il porte des faits, pas de la
  // doctrine, et ne doit pas s'interposer entre les règles et leur contexte.
  const system = params.priorToolResults
    ? `${buildSystemPrompt(ctx, mode)}\n\n${params.priorToolResults}`
    : buildSystemPrompt(ctx, mode);
  const availableTools = toolsForMode(mode);
  const lastUserMessage = [...params.messages].reverse().find((message) => message.role === 'user');
  const userText = lastUserMessage ? extractText(lastUserMessage.content) : '';
  const selection = selectToolNames(userText, availableTools.map((tool) => tool.name));
  const selectedNames = new Set(selection.toolNames);
  const tools = availableTools.filter((tool) => selectedNames.has(tool.name));
  const maxIter = MAX_TOOL_ITERATIONS[mode];

  const messages = [...params.messages];
  const toolCallsLog: OrchestratorResult['toolCallsLog'] = [];
  let finalText = '';
  let totalIn = 0;
  let totalOut = 0;
  let finishReason = 'end_turn';

  for (let iter = 0; iter < maxIter; iter++) {
    const turn = await streamLLMTurn({
      model, system, messages, tools,
      maxTokens: MAX_OUTPUT_TOKENS[mode],
      onToken: (delta) => sse.send({ type: 'token', delta }),
      onGenerationStart,   // NEW
    });

    totalIn += turn.inputTokens;
    totalOut += turn.outputTokens;
    finalText += turn.textBlocks.join('\n');
    finishReason = turn.stopReason;

    if (turn.stopReason !== 'tool_use' || turn.toolUses.length === 0) {
      break;
    }

    const assistantContent: unknown[] = [];
    for (const t of turn.textBlocks) {
      assistantContent.push({ type: 'text', text: t });
    }
    for (const tu of turn.toolUses) {
      assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
    }
    messages.push({ role: 'assistant', content: assistantContent });

    const toolResults: unknown[] = [];
    for (const tu of turn.toolUses) {
      sse.send({ type: 'tool_use_start', call: { id: tu.id, name: tu.name, input: tu.input } });
      const started = Date.now();
      try {
        const output = await executeTool(tu.name, tu.input, ctx, auth);
        const durationMs = Date.now() - started;
        // Le statut métier (not_configured, not_found…) n'est PAS une erreur
        // technique : on le transmet au LLM qui sait l'interpréter.
        // `confirmation_requise` est un aboutissement normal du premier temps
        // d'un verbe : l'appel a réussi, il attend simplement une confirmation.
        // Le classer en erreur ferait afficher « Indisponible » sur la carte
        // d'outil et pousserait le modèle à réessayer au lieu de demander
        // l'accord de l'utilisateur.
        const isOk = output.status === 'ok'
          || output.status === 'partial'
          || output.status === 'confirmation_requise';
        toolCallsLog.push({
          id: tu.id, name: tu.name, input: tu.input,
          output, status: isOk ? 'success' : 'error', durationMs,
          error: isOk ? undefined : `${output.status}: ${output.message ?? ''}`,
        });
        sse.send({
          type: 'tool_use_end',
          call: {
            id: tu.id, name: tu.name, output,
            duration_ms: durationMs,
            status: isOk ? 'success' : output.status,
            error: isOk ? undefined : output.message,
          },
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: tronquerSortieOutil(output),
        });
        if (tu.name === 'get_etude_parcelle' && isOk) {
          const deterministicReport = renderParcelStudyReport(output);
          if (deterministicReport) {
            // La narration pré-outil a déjà pu être streamée, mais elle n'est
            // ni persistée ni complétée par une synthèse libre du modèle.
            sse.send({ type: 'token', delta: `\n\n${deterministicReport}` });
            return {
              finalText: deterministicReport,
              toolCallsLog,
              totalInputTokens: totalIn,
              totalOutputTokens: totalOut,
              model,
              finishReason: 'deterministic_report',
            };
          }
        }
      } catch (e) {
        const durationMs = Date.now() - started;
        const msg = e instanceof Error ? e.message : 'tool error';
        toolCallsLog.push({
          id: tu.id, name: tu.name, input: tu.input,
          output: null, status: 'error', durationMs, error: msg,
        });
        sse.send({
          type: 'tool_use_end',
          call: { id: tu.id, name: tu.name, output: null, duration_ms: durationMs, status: 'error', error: msg },
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: `Erreur outil : ${msg}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Filet de sécurité : si la boucle s'arrête alors que le modèle voulait encore
  // un outil (plafond d'itérations atteint), on force une dernière passe SANS
  // outils pour produire la réponse finale — sinon l'utilisateur ne voit que la
  // narration d'avant-outil (cas quick mode + 2 outils enchaînés).
  if (finishReason === 'tool_use') {
    const finalTurn = await streamLLMTurn({
      model, system, messages, tools: [],
      maxTokens: MAX_OUTPUT_TOKENS[mode],
      onToken: (delta) => sse.send({ type: 'token', delta }),
    });
    totalIn += finalTurn.inputTokens;
    totalOut += finalTurn.outputTokens;
    finalText += (finalText ? '\n' : '') + finalTurn.textBlocks.join('\n');
    finishReason = finalTurn.stopReason;
  }

  return {
    finalText,
    toolCallsLog,
    totalInputTokens: totalIn,
    totalOutputTokens: totalOut,
    model,
    finishReason,
  };
}

// =============================================================
// SECTION 12 — Persistance
// =============================================================

async function ensureConversation(params: {
  conversationId?: string;
  userId: string;
  ctx: MimmozaContext;
  firstMessage: string;
}): Promise<string> {
  const { conversationId, userId, ctx, firstMessage } = params;
  if (conversationId) {
    const { data } = await getAdmin()
      .from('copilot_conversations')
      .select('id').eq('id', conversationId).eq('user_id', userId).maybeSingle();
    if (data?.id) return data.id;
  }
  const title = firstMessage.slice(0, 60) + (firstMessage.length > 60 ? '…' : '');

  // ⚠️ context_study_id est une colonne uuid : un slug type "demo-study-001"
  // fait échouer l'insert avec « invalid input syntax for type uuid », ce qui
  // tue la conversation AVANT tout appel LLM. On n'écrit que si c'est un uuid ;
  // sinon null (l'étude reste exploitable via le contexte injecté au prompt).
  const rawStudyId = ctx.study?.id ?? null;
  const studyIdUuid =
    rawStudyId && UUID_V4_RE.test(rawStudyId) ? rawStudyId : null;
  if (rawStudyId && !studyIdUuid) {
    console.warn('[copilot] study.id non-uuid ignoré pour context_study_id:', rawStudyId);
  }

  const { data, error } = await getAdmin()
    .from('copilot_conversations')
    .insert({
      user_id: userId,
      title,
      vertical: ctx.vertical,
      context_parcel_id: ctx.parcel?.id ?? null,
      context_route: ctx.route,
      context_study_id: studyIdUuid,
    })
    .select('id').single();
  if (error || !data) throw new CopilotError('INTERNAL_ERROR', `Création conversation : ${error?.message}`);
  return data.id;
}

/**
 * Trace des pièces jointes dans le TEXTE persisté.
 *
 * Les fichiers eux-mêmes ne sont pas conservés : `copilot_messages` ne stocke
 * que du texte, et `buildMessages` ne relit que ce texte. Sans cette trace, un
 * document lu au tour N devenait, au tour N+1, une conversation où l'utilisateur
 * semble n'avoir jamais rien envoyé — le modèle continuait alors à répondre sur
 * un DPE qu'il ne voyait plus, en s'appuyant sur sa propre prose antérieure.
 *
 * La trace est rédigée pour être comprise par le modèle qui la relira : elle
 * dit ce qui a été joint, et qu'il ne l'a plus. La règle 4duodetricies du
 * prompt système lui dit quoi en faire.
 */
function marqueurPiecesJointes(attachments?: CopilotAttachment[]): string {
  if (!attachments?.length) return '';
  const noms = attachments
    .map((a, i) => {
      const type = a.mediaType === 'application/pdf' ? 'PDF' : 'image';
      return a.name?.trim() ? `${a.name.trim()} (${type})` : `${type} n°${i + 1}`;
    })
    .join(', ');
  return `\n\n[PIÈCES JOINTES À CE MESSAGE : ${noms}. Le contenu de ces fichiers a été lu ` +
    `à ce tour-là UNIQUEMENT. Il n'est PAS conservé dans l'historique : aux tours suivants, ` +
    `tu ne disposes plus du document.]`;
}

async function saveUserMessage(p: {
  conversationId: string; userId: string; text: string; mode: CopilotMode;
  contextSnapshot: ContextSnapshot; attachments?: CopilotAttachment[];
}): Promise<void> {
  const texte = `${p.text}${marqueurPiecesJointes(p.attachments)}`;
  await getAdmin().from('copilot_messages').insert({
    conversation_id: p.conversationId, user_id: p.userId, role: 'user',
    content: [{ type: 'text', text: texte }], mode: p.mode, credits_cost: 0,
    context_snapshot: p.contextSnapshot,
  });
}

async function loadLatestUserContext(conversationId: string): Promise<unknown> {
  const { data, error } = await getAdmin().from('copilot_messages')
    .select('context_snapshot').eq('conversation_id', conversationId).eq('role', 'user')
    .not('context_snapshot', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) {
    console.warn('[copilot] lecture dernier contexte impossible:', error.message);
    return null;
  }
  return (data?.context_snapshot as ContextSnapshot | null)?.context ?? null;
}

async function saveAssistantMessage(p: {
  conversationId: string; userId: string; result: OrchestratorResult;
  mode: CopilotMode; latencyMs: number; creditsCost?: number;
}): Promise<string> {
  const content: unknown[] = [{ type: 'text', text: p.result.finalText }];
  const { data, error } = await getAdmin().from('copilot_messages').insert({
    conversation_id: p.conversationId, user_id: p.userId, role: 'assistant',
    content, mode: p.mode, model: p.result.model,
    input_tokens: p.result.totalInputTokens,
    output_tokens: p.result.totalOutputTokens,
    credits_cost: p.creditsCost ?? CREDIT_COST[p.mode],
    latency_ms: p.latencyMs, finish_reason: p.result.finishReason,
  }).select('id').single();
  if (error || !data) throw new CopilotError('INTERNAL_ERROR', `Sauvegarde message : ${error?.message}`);

  if (p.result.toolCallsLog.length > 0) {
    try {
      await getAdmin().from('copilot_tool_calls').insert(
        p.result.toolCallsLog.map((tc) => ({
          message_id: data.id, conversation_id: p.conversationId, user_id: p.userId,
          tool_name: tc.name, tool_input: tc.input, tool_output: tc.output,
          status: tc.status, error: tc.error ?? null, duration_ms: tc.durationMs,
        })),
      );
    } catch (e) { console.error('[persist] tool_calls failed', e); }
  }
  return data.id;
}

// =============================================================
// SECTION 13 — Handler HTTP principal
// =============================================================

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

async function requireUserId(req: Request): Promise<string> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new CopilotError('UNAUTHORIZED', 'Missing Authorization');
  const { data, error } = await getUserClient(authHeader).auth.getUser();
  if (error || !data?.user) throw new CopilotError('UNAUTHORIZED', 'Invalid JWT');
  return data.user.id;
}

function validateRequest(body: unknown): ChatRequest {
  const b = body as Partial<ChatRequest>;
  if (!b || typeof b.message !== 'string' || !b.message.trim()) {
    throw new CopilotError('BAD_REQUEST', 'message requis');
  }
  // Le mode est désormais dérivé du plan côté serveur ; on n'exige plus rien du client.
  b.mode = b.mode ?? 'quick';
  if (!b.context || !b.context.vertical || !b.context.route) {
    throw new CopilotError('CONTEXT_REQUIRED', 'context.vertical et context.route requis');
  }
  if (b.message.length > 8000) {
    throw new CopilotError('CONTEXT_TOO_LARGE', 'message trop long (max 8000 caractères)');
  }
  if (b.attachments !== undefined) {
    if (!Array.isArray(b.attachments) || b.attachments.length > MAX_ATTACHMENTS) {
      throw new CopilotError('BAD_REQUEST', `attachments : tableau de ${MAX_ATTACHMENTS} elements maximum`);
    }
    let totalB64 = 0;
    for (const a of b.attachments) {
      if (!a || typeof a.data !== 'string' || !ALLOWED_MEDIA_TYPES.has(a.mediaType)) {
        throw new CopilotError('BAD_REQUEST', `Type de piece jointe non pris en charge : ${a?.mediaType}`);
      }
      totalB64 += a.data.length;
    }
    if (totalB64 > MAX_ATTACHMENT_B64) {
      throw new CopilotError('CONTEXT_TOO_LARGE', 'Pieces jointes trop volumineuses');
    }
  }
  return b as ChatRequest;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'POST only' }), {
      status: 404, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  let userId: string;
  let payload: ChatRequest;
  let conversationId: string;
  let reservationId: string;
  let remainingBalance: number;
  let mode: CopilotMode;
  let tier: ModelTier;
  let plan: Plan;
  let reserved: number;          // montant RÉELLEMENT réservé (pire cas)
  let effectiveContext: MimmozaContext;

  try {
    userId = await requireUserId(req);
    payload = validateRequest(await req.json());

    conversationId = await ensureConversation({
      conversationId: payload.conversation_id,
      userId, ctx: payload.context, firstMessage: payload.message,
    });

    const persistedContext = await loadLatestUserContext(conversationId);
    effectiveContext = mergeContexts(persistedContext, payload.context) as unknown as MimmozaContext;
    const contextSnapshot = await createContextSnapshot(effectiveContext);

    // ── Plan lu CÔTÉ SERVEUR (jamais depuis le client) ──────────
    plan = await getUserPlan(userId);
    mode = PLAN_POLICY[plan].mode;
    const requestedTier = (payload as any).tier as ModelTier | undefined;
    tier = resolveTier(plan, plan === 'pro' ? requestedTier : undefined);

    reserved = worstCaseJetons(tier, mode);
    const reservation = await reserveCredits({
      userId,
      amount: reserved,                       // ⬅️ gate = pire cas
      reason: `copilot ${plan}/${tier}`,
      conversationId,
    });
    reservationId = reservation.reservationId;
    remainingBalance = reservation.remainingBalance;

    await saveUserMessage({
      conversationId, userId, text: payload.message, mode, contextSnapshot,
      attachments: payload.attachments,
    });
  } catch (err) {
    const e = err instanceof CopilotError ? err : new CopilotError('INTERNAL_ERROR', String(err));
    return new Response(JSON.stringify(e.toJSON()), {
      status: e.statusCode, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  const startedAt = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
  const sse = new SSEWriter(controller);
  let billable = false;   // NEW : la génération a démarré → plus de refund
  let settled  = false;   // NEW : évite double settle/refund

  try {
    sse.send({ type: 'reservation', reserved_credits: reserved, remaining: remainingBalance });
    sse.send({ type: 'conversation', conversation_id: conversationId });

    const messages = await buildMessages(conversationId, '', mode, payload.attachments);

    // Rappel des données déjà obtenues : évite de relancer les mêmes outils au
    // tour suivant. Jamais bloquant — en cas d'échec, le bloc est vide.
    const priorToolResults = await buildPriorToolResultsBlock(conversationId);

    const result = await runOrchestrator({
      mode, tier, ctx: effectiveContext, messages, sse, priorToolResults,   // ⬅️ tier ajouté
      // userId vient de requireUserId() (JWT vérifié) ; l'en-tête est réutilisé
      // tel quel pour que les écritures passent par le client UTILISATEUR.
      auth: { userId, authHeader: req.headers.get('Authorization') ?? '' },
      onGenerationStart: () => { billable = true; },
    });

    const latencyMs = Date.now() - startedAt;
    // ── Débit RÉEL calculé sur l'usage renvoyé par l'API ────────
    const debit = debitJetons(tier, result.totalInputTokens, result.totalOutputTokens);

    const messageId = await saveAssistantMessage({
      conversationId, userId, result, mode, latencyMs, creditsCost: debit,
    });

    await settleCredits({
      userId, reservationId, messageId, mode,
      finalAmount: debit,                       // ⬅️ le settle rend la différence
      metadata: {
        inputTokens: result.totalInputTokens,
        outputTokens: result.totalOutputTokens,
        model: result.model, tier, plan, debit, latencyMs,
        toolCalls: result.toolCallsLog.length,
      },
    });
    
    settled = true;   // NEW

    sse.send({ type: 'message_start', message_id: messageId });
    sse.send({ type: 'done', message_id: messageId, final_credits: debit });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erreur interne';
    console.error('[copilot-chat] orchestration error', err);

    if (billable && !settled) {
      // NEW : génération déjà commencée → on FACTURE, pas de refund.
      try {
        const messageId = await saveAssistantMessage({
          conversationId, userId, mode,
          latencyMs: Date.now() - startedAt,
          result: {
            finalText: '[réponse interrompue]',
            toolCallsLog: [],
            totalInputTokens: 0,
            totalOutputTokens: 0,
            model: TIER_MODEL_ID[tier],
            finishReason: 'interrupted',
          },
        });
        await settleCredits({
          userId, reservationId, messageId, mode,
          metadata: { interrupted: true },
        });
        settled = true;
      } catch (e) {
        console.error('[credits] settle-after-interrupt failed', e);
      }
      sse.send({ type: 'error', error: msg });   // NEW : aucun refunded_credits

    } else if (!settled) {
      // Échec AVANT toute génération → remboursable (429, timeout, clé API…).
      const refunded = await refundCredits({ userId, reservationId, reason: 'failed before generation' });
      sse.send({ type: 'error', error: msg, refunded_credits: refunded });
    }
  } finally {
        sse.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders(),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});
