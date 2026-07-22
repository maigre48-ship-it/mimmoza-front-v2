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
const GLOBAL_MAX_TOKENS = Number(Deno.env.get('ANTHROPIC_MAX_TOKENS')) || 8000;

// Budget de sortie par mode (perf + coût), borné par le plafond global.
// quick à 2500 et non 800 : l'étude complète (get_etude_parcelle) produit un
// rapport en 5 parties qui était tronqué au milieu de la partie 3 à 800 tokens.
// C'est un PLAFOND, pas une cible : la règle 5 garde les réponses courtes courtes,
// et le débit réel est calculé sur l'usage effectif (debitJetons), pas sur ce budget.
const MAX_OUTPUT_TOKENS: Record<CopilotMode, number> = {
  quick: Math.min(2500, GLOBAL_MAX_TOKENS),
  advanced: Math.min(2500, GLOBAL_MAX_TOKENS),
  report: Math.min(8000, GLOBAL_MAX_TOKENS),
};

// Timeout par appel LLM (ton secret existant), fallback 60s.
const LLM_TIMEOUT_MS = Number(Deno.env.get('ANTHROPIC_TIMEOUT_MS')) || 60000;

// Nombre max d'allers-retours tool-calling par mode (garde-fou latence + coût)
const MAX_TOOL_ITERATIONS: Record<CopilotMode, number> = {
  quick: 2,
  advanced: 6,
  report: 12,
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

function normalizePlan(stored: string | null | undefined): Plan {
  switch ((stored ?? '').toLowerCase()) {
    case 'pro':      return 'pro';
    case 'advanced':
    case 'starter':  return 'advanced';
    default:         return 'basic';
  }
}

async function getUserPlan(userId: string): Promise<Plan> {
  try {
    const { data } = await getAdmin()
      .from('profiles').select('plan').eq('id', userId).maybeSingle();
    return normalizePlan(data?.plan as string | undefined);
  } catch {
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
  return debitJetons(tier, ASSUMED_MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS[mode]);
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
    rentabilite?: { rendement_brut?: number | null; rendement_net?: number | null; cashflow_mensuel?: number | null; marge_brute?: number | null; marge_brute_pct?: number | null; prix_revente_cible?: number | null } | null;
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

interface ChatRequest {
  conversation_id?: string;
  message: string;
  mode: CopilotMode;
  context: MimmozaContext;
}

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
type ToolStatus = 'ok' | 'not_configured' | 'not_found' | 'partial' | 'error';

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
 */
function resolveParcelRef(input: Record<string, unknown>, ctx: MimmozaContext): ParcelRef {
  const p = ctx.parcel;
  const ref: ParcelRef = {
    parcel_id: str(input.parcel_id) ?? p?.id,
    cadastral_ref: str(input.cadastral_ref) ?? p?.cadastral_ref,
    lat: num(input.lat) ?? p?.lat,
    lng: num(input.lng) ?? p?.lng,
    commune: str(input.commune) ?? p?.commune,
    code_insee: str(input.code_insee) ?? p?.code_insee,
    address: str(input.address) ?? p?.address,
  };
  // Autonomie : dériver le code INSEE de l'identifiant parcellaire (IDU) si absent.
  // Tout identifiant cadastral français commence par le code INSEE sur 5 caractères :
  //   DDCCC OOO SS NNNN  →  ex "64065000AI0002" → INSEE "64065" (Corse : 2A/2B).
  if (!ref.code_insee) {
    const idu = (ref.cadastral_ref ?? ref.parcel_id ?? '').replace(/\s/g, '');
    const m = /^(2[ab]\d{3}|\d{5})/i.exec(idu);
    if (m) ref.code_insee = m[1].toUpperCase();
  }
  return ref;
}

function hasAnyIdentifier(ref: ParcelRef): boolean {
  return Boolean(ref.parcel_id || ref.cadastral_ref || (ref.lat != null && ref.lng != null));
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

  if (v4) {
    out.score = v4.score ?? null;
    out.verdict = v4.verdict ?? null;

    // Piliers : on ne garde que le score de chaque pilier (pas les sous-détails)
    const pillars = v4.pillar_scores as Record<string, unknown> | undefined;
    if (pillars) {
      out.piliers = pick(pillars, [
        'market', 'price_opportunity', 'services', 'transport',
        'ecoles', 'sante', 'environment', 'demographie', 'competition', 'dpe',
      ]);
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
  };

  // Niveau de RISQUE par catégorie (level = niveau de risque, pas de sécurité).
  if (categories.length > 0) {
    out.categories = categories.map((c: any) => ({
      nom: c.name ?? null,
      score_securite: c.score ?? null,
      niveau_risque: c.level ?? null,
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
      seveso_haut: data.icpe?.seveso_haut_count ?? null,
      seveso_bas: data.icpe?.seveso_bas_count ?? null,
      niveau_risque: data.icpe?.risk_level ?? null,
    },
    sites_pollues_sis: {
      count: data.sis?.count ?? null,
      niveau_risque: data.sis?.risk_level ?? null,
    },
    cavites: {
      count: data.cavites?.count ?? null,
      niveau_risque: data.cavites?.risk_level ?? null,
    },
    mouvements_terrain: {
      count: data.mouvements_terrain?.count ?? null,
      niveau_risque: data.mouvements_terrain?.risk_level ?? null,
    },
    feux_foret: {
      zone_risque: data.feux_foret?.zone_risque ?? null,
      obligation_debroussaillement: data.feux_foret?.obligation_debroussaillement ?? null,
      niveau_risque: data.feux_foret?.risk_level ?? null,
    },
    catnat_count: data.gaspar?.catnat_count ?? null,
    ppr_count: data.gaspar?.ppr_count ?? null,
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
 * (le taux TH ne vaut que pour résidences secondaires / logements vacants), majoration THRS
 * possible en zone tendue. Le LLM ne doit pas présenter la TH comme due sur une résidence principale.
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
        precision: root.stats?.precision ?? null,
        parcelle: root.stats?.parcelle ?? null,
        avertissements: root.stats?.avertissements ?? [],
        sources_indisponibles: root.stats?.sources_indisponibles ?? [],
        donnees: items.map((i: any) => ({
          domaine: i.label ?? i.cle,
          statut: i.status,
          resume: i.summary ?? null,
          chiffres: i.stats ?? null,
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
      scores: r.scores ?? null,
      explication_scores: r.scoring_details?.explanation ?? null,
      marche_dvf: dvf ? pick(dvf, ['nb_transactions', 'prix_m2_median', 'prix_m2_moyen', 'prix_m2_min', 'prix_m2_max', 'evolution_prix_pct', 'coverage']) : null,
      demographie_insee: insee ? pick(insee, [
        'population', 'densite', 'revenu_median', 'taux_chomage', 'taux_pauvrete',
        'pct_logements_vacants', 'pct_locataires', 'pct_75_plus', 'pct_etudiants',
        'revenu_source', 'coverage',
      ]) : null,
      transport: tr ? {
        ...pick(tr, ['score', 'nearest_stop_m', 'has_metro_train', 'has_tram', 'is_urban', 'coverage']),
        arrets_proches: Array.isArray(tr.stops) ? tr.stops.slice(0, 5) : [],
      } : null,
      equipements_bpe: bpe ? pick(bpe, ['total_equipements', 'score', 'nb_ecoles', 'nb_pharmacies', 'nb_supermarches', 'nb_universites', 'coverage']) : null,
      constats: Array.isArray(r.insights) ? r.insights.slice(0, 10).map((i: any) => ({ type: i.type, categorie: i.category, message: i.message })) : [],
      avertissements: r.warnings ?? [],
      source: 'market-study Mimmoza (DVF, INSEE, BPE, Overpass)',
    },
  };
}

// =============================================================
// TOOL DEFINITIONS (exposées au LLM) — LOT 4 + LOT 5
// =============================================================

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
      "présente jamais comme contradictoires. N'invente aucun chiffre absent de la réponse.",
    input_schema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Adresse complète (prioritaire si pas de coordonnées).' },
        city: { type: 'string' },
        zip_code: { type: 'string' },
        lat: { type: 'number' },
        lng: { type: 'number' },
        project_type: { type: 'string', description: "Type de projet étudié (défaut « logement »)." },
        rayon_km: { type: 'number', description: "Rayon d'analyse en km (défaut 5)." },
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
      "Récupère les règles d'urbanisme PLU DÉJÀ EXTRAITES pour la parcelle (zone, hauteur max, " +
      "emprise au sol, reculs, stationnement, pleine terre, COS) ainsi que l'OAP si elle a été " +
      "analysée. Source : le parser PLU de Mimmoza, le règlement étant importé manuellement sur la " +
      "page Foncier. À utiliser pour expliquer, synthétiser ou contrôler la constructibilité. " +
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
      "terrain. Nécessite des coordonnées (lat/lng). N'invente jamais un monument ni un périmètre.",
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
        code_insee: { type: 'string', description: "Code INSEE de la commune ou de l'arrondissement (prioritaire)." },
        commune:    { type: 'string', description: 'Nom de la commune (repli si code_insee absent).' },
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
        code_insee: { type: 'string', description: 'Code INSEE de la commune (prioritaire).' },
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
      "principale est SUPPRIMÉE depuis 2023 : le taux TH ne concerne que les résidences secondaires " +
      "(THRS) et les logements vacants (THLV). Utile pour estimer les charges d'un investisseur, le " +
      "coût de portage d'un marchand, ou comparer la pression fiscale entre communes. N'invente jamais " +
      "un taux : si la commune n'est pas trouvée, signale-le.",
    input_schema: {
      type: 'object',
      properties: {
        code_insee: { type: 'string', description: 'Code INSEE de la commune (prioritaire).' },
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
        code_insee: { type: 'string', description: 'Code INSEE de la commune (prioritaire).' },
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
        code_insee: { type: 'string', description: 'Code INSEE de la commune (prioritaire).' },
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
      "PAS l'absence de classement — signale-le et n'invente jamais un secteur ni une catégorie.",
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
];

function toolsForMode(mode: CopilotMode): ToolDef[] {
  return TOOLS.filter((t) => t.available_in_modes.includes(mode));
}

// =============================================================
// EXÉCUTION DES TOOLS — retourne toujours un ToolResult normalisé
// =============================================================

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: MimmozaContext,
): Promise<ToolResult> {
  switch (name) {
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
    default:
      return { status: 'error', source: 'copilot', message: `Tool inconnu : ${name}` };
  }
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
  if (INTERNAL_FUNCTIONS.parcel) {
    try {
      const raw = await callInternalFunction(INTERNAL_FUNCTIONS.parcel, { ...ref });
      // TODO[contrat-parcel]: aligner les clés sur la vraie réponse.
      const data = pick(raw, [
        'parcel_id', 'cadastral_ref', 'address', 'commune',
        'code_postal', 'code_insee', 'surface_m2', 'surface', 'plu_zone', 'lat', 'lng',
      ]);
      return { status: 'ok', source: INTERNAL_FUNCTIONS.parcel, data };
    } catch (e) {
      return { status: 'error', source: INTERNAL_FUNCTIONS.parcel, message: errMsg(e) };
    }
  }
  // Fallback : on renvoie ce que le contexte connaît (pas d'invention).
  return {
    status: 'ok', source: 'MimmozaContext',
    data: {
      parcel_id: ref.parcel_id ?? null,
      cadastral_ref: ref.cadastral_ref ?? null,
      address: ref.address ?? null,
      commune: ref.commune ?? null,
      code_insee: ref.code_insee ?? null,
      surface_m2: ctx.parcel?.surface_m2 ?? null,
      plu_zone: ctx.parcel?.plu_zone ?? null,
      lat: ref.lat ?? null,
      lng: ref.lng ?? null,
    },
  };
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
    try {
      const raw = await callInternalFunction(INTERNAL_FUNCTIONS.plu, { ...ref });
      return { status: 'ok', source: INTERNAL_FUNCTIONS.plu, data: summarizePlu(raw) };
    } catch (e) {
      return { status: 'error', source: INTERNAL_FUNCTIONS.plu, message: errMsg(e) };
    }
  }
  // 3) Rien d'extrait : on le dit, sans inventer de règle.
  return {
    status: 'not_found', source: 'PLU',
    message:
      "Aucune donnée PLU disponible : le règlement n'a pas encore été importé/analysé sur la page Foncier de Mimmoza. " +
      "Invite l'utilisateur à uploader le PDF du PLU. N'invente aucune règle d'urbanisme ni aucune OAP.",
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

  // ── PATCH annonce : pas de parcelle ni GPS → résoudre code_insee + centroïde
  //    commune depuis zip/city (contexte annonce investisseur/marchand).
  //    smartscore-enriched-v3 a besoin de lat/lon pour les piliers services/
  //    transport (Overpass) ; à défaut on prend le centre de la commune.
  if (!ref.code_insee && ref.lat == null) {
    const zipCode = str(input.zip_code) ?? (ctx as any).zip_code;
    const city    = str(input.commune) ?? str(input.city) ?? (ctx as any).city ?? ref.commune;
    const query = zipCode
      ? `codePostal=${encodeURIComponent(zipCode)}`
      : (city ? `nom=${encodeURIComponent(city)}` : null);
    if (query) {
      try {
        const r = await fetch(
          `https://geo.api.gouv.fr/communes?${query}&fields=code,nom,centre&limit=1`,
          { signal: AbortSignal.timeout(4000) },
        );
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d) && d[0]?.code) {
            ref.code_insee = d[0].code;
            if (!ref.commune && d[0].nom) ref.commune = d[0].nom;
            const c = d[0].centre?.coordinates;
            if (Array.isArray(c) && c.length === 2) { ref.lng = c[0]; ref.lat = c[1]; }
          }
        }
      } catch { /* geo.api injoignable → on continue sans */ }
    }
  }

  if (!hasAnyIdentifier(ref) && !ref.commune && !ref.code_insee) {
    return { status: 'not_found', source: 'SmartScore', message: 'Aucune parcelle ni localisation identifiée.' };
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
    return { status: 'ok', source: INTERNAL_FUNCTIONS.smartscore, data: summarizeSmartScore(raw) };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.smartscore, message: errMsg(e) };
  }
}

// ─── get_dvf_comparables ──
// Priorité à la fonction DVF dédiée (dvf-comparables-v1, COPILOT_FN_DVF), au contrat
// { status, summary, stats, comps }. Repli mutualisé sur smartscore-enriched-v3 (bloc
// market_like.dvf) si seul COPILOT_FN_SMARTSCORE est défini.
async function toolDvfComparables(input: Record<string, unknown>, ctx: MimmozaContext): Promise<ToolResult> {
  const ref = resolveParcelRef(input, ctx);

  // ── PATCH : si code_insee manquant mais commune connue, on le résout via geo.api ──
  if (!ref.code_insee && !ref.lat && ref.commune) {
    try {
      const r = await fetch(
        `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(ref.commune)}&fields=code&limit=1`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d) && d[0]?.code) ref.code_insee = d[0].code;
      }
    } catch { /* geo.api injoignable → on continue sans */ }
  }

  if (!hasAnyIdentifier(ref) && !ref.commune && !ref.code_insee) {
    return { status: 'not_found', source: 'DVF', message: 'Ni parcelle ni commune identifiée.' };
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
      return { status: s.status, source: dedicated, data: s.data, message: s.message };
    } catch (e) {
      return { status: 'error', source: dedicated, message: errMsg(e) };
    }
  }

  // ── Path B : repli mutualisé sur smartscore-enriched-v3 (mode standard) ──
  const fn = INTERNAL_FUNCTIONS.smartscore;
  if (!fn) {
    return {
      status: 'not_configured', source: 'DVF',
      message: "Le service DVF n'est pas encore branché (ni COPILOT_FN_DVF ni COPILOT_FN_SMARTSCORE). Signale-le sans inventer de prix.",
    };
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
    return { status: 'ok', source: fn, data: summarizeDvfFromSmartScore(raw) };
  } catch (e) {
    return { status: 'error', source: fn, message: errMsg(e) };
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

  // ── PATCH listing : résoudre code_insee depuis city/zip du contexte annonce ──
  if (!ref.code_insee && !ref.lat) {
    const zipCode = str(input.zip_code) ?? (ctx as any).zip_code;
    const city    = str(input.city)     ?? (ctx as any).city ?? ref.commune;

    if (zipCode) {
      try {
        const r = await fetch(
          `https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(zipCode)}&fields=code,nom&limit=1`,
          { signal: AbortSignal.timeout(4000) },
        );
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d) && d[0]?.code) {
            ref.code_insee = d[0].code;
            if (!ref.commune && d[0].nom) ref.commune = d[0].nom;
          }
        }
      } catch { /* geo.api injoignable → on continue sans */ }
    }

    if (!ref.commune && city) ref.commune = city;
  }

  if (!hasAnyIdentifier(ref) && !ref.code_insee && !ref.commune) {
    return {
      status: 'not_found', source: 'Géorisques',
      message: 'Aucune localisation exploitable (ni lat/lng, ni parcelle, ni code INSEE, ni ville).',
    };
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
    return { status: 'ok', source: INTERNAL_FUNCTIONS.risks, data: summarizeRisks(raw) };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.risks, message: errMsg(e) };
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
  const codePostal =
    str(input.code_postal) ?? ctx.parcel?.code_postal ?? (ctx as any).zip_code;

  // Localisation minimale : adresse OU coordonnées OU code postal.
  if (!address && ref.lat == null && !codePostal) {
    return {
      status: 'not_found', source: 'DPE ADEME',
      message: "Aucune localisation exploitable pour interroger le DPE (ni adresse, ni coordonnées, ni code postal).",
    };
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
    return { status: s.status, source: INTERNAL_FUNCTIONS.dpe, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.dpe, message: errMsg(e) };
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

  // Mérimée n'a de sens qu'en géographique. Si pas de lat/lon mais une commune,
  // on résout le code INSEE via geo.api (repli commune, moins précis).
  if (ref.lat == null && !ref.code_insee && ref.commune) {
    try {
      const r = await fetch(
        `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(ref.commune)}&fields=code&limit=1`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d) && d[0]?.code) ref.code_insee = d[0].code;
      }
    } catch { /* geo.api injoignable → on continue sans */ }
  }

  if (ref.lat == null && !ref.code_insee) {
    return {
      status: 'not_found', source: 'Mérimée',
      message: "Aucune localisation exploitable (ni coordonnées, ni commune) pour rechercher les monuments historiques.",
    };
  }

  try {
    const body = {
      lat: ref.lat ?? undefined,
      lon: ref.lng ?? undefined,        // ⚠️ patrimoine-merimee-v1 attend "lon"
      code_insee: ref.code_insee ?? undefined,
      radius_m: num(input.radius_m) ?? undefined,
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.merimee, body);
    const s = summarizeMerimeeDedicated(raw);
    return { status: s.status, source: INTERNAL_FUNCTIONS.merimee, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.merimee, message: errMsg(e) };
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
  let codeInsee = str(input.code_insee) ?? ref.code_insee;

  // Repli commune → code INSEE via geo.api si besoin.
  if (!address && !codeInsee && ref.commune) {
    try {
      const r = await fetch(
        `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(ref.commune)}&fields=code&limit=1`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d) && d[0]?.code) codeInsee = d[0].code;
      }
    } catch { /* geo.api injoignable → on continue sans */ }
  }

  if (!address && !codeInsee) {
    return {
      status: 'not_found', source: 'BDNB',
      message: "Aucune localisation exploitable (ni adresse, ni commune) pour interroger la BDNB.",
    };
  }

  try {
    const body = { address: address ?? undefined, code_insee: codeInsee ?? undefined };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.bdnb, body);
    const s = summarizeBdnbDedicated(raw);
    return { status: s.status, source: INTERNAL_FUNCTIONS.bdnb, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.bdnb, message: errMsg(e) };
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

  const ref = resolveParcelRef(input, ctx);
  let codeInsee = str(input.code_insee) ?? ref.code_insee ?? (ctx as any).code_insee;
  const commune = str(input.commune) ?? str(input.city) ?? ref.commune ?? (ctx as any).city;
  const zipCode = str(input.zip_code) ?? ctx.parcel?.code_postal ?? (ctx as any).zip_code;

  // Repli : résoudre le code INSEE depuis une commune / un code postal.
  // ⚠️ geo.api renvoie le code « commune globale » (75056/69123/13055) pour
  //    Paris/Lyon/Marseille recherchés par nom → l'éclatement PLM côté fonction
  //    prend le relais. Un code postal d'arrondissement cible l'arrondissement.
  if (!codeInsee && (commune || zipCode)) {
    const query = zipCode
      ? `codePostal=${encodeURIComponent(zipCode)}`
      : `nom=${encodeURIComponent(commune!)}`;
    try {
      const r = await fetch(
        `https://geo.api.gouv.fr/communes?${query}&fields=code&limit=1`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d) && d[0]?.code) codeInsee = String(d[0].code);
      }
    } catch { /* geo.api injoignable → la fonction retentera de résoudre */ }
  }

  if (!codeInsee && !commune && !zipCode) {
    return {
      status: 'not_found', source: 'Loyers de référence',
      message: "Aucune commune identifiée (ni code INSEE, ni ville, ni code postal) pour interroger les loyers de référence.",
    };
  }

  try {
    const body = {
      code_insee: codeInsee ?? undefined,
      commune: commune ?? undefined,
      zip_code: zipCode ?? undefined,
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.loyers, body);
    const s = summarizeLoyersDedicated(raw);
    return { status: s.status, source: INTERNAL_FUNCTIONS.loyers, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.loyers, message: errMsg(e) };
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

  const ref = resolveParcelRef(input, ctx);
  const lat = num(input.lat) ?? ref.lat;
  const lng = num(input.lng) ?? ref.lng;

  if (lat == null || lng == null) {
    return {
      status: 'not_found', source: 'Servitudes (GPU)',
      message: "Coordonnées précises (lat/lng) indisponibles. Les servitudes se recherchent à la parcelle, pas à la commune : demande à l'utilisateur d'ouvrir une parcelle localisée.",
    };
  }

  try {
    const body = {
      lat,
      lon: lng,                                    // ⚠️ servitudes-gpu-v1 attend "lon"
      cadastral_ref: str(input.cadastral_ref) ?? ref.cadastral_ref ?? undefined,
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

  // Repli : centroïde de la commune (INSEE prioritaire, sinon nom) via geo.api.
  if (lat == null || lng == null) {
    const codeInsee = str(input.code_insee) ?? ref.code_insee ?? (ctx as any).code_insee;
    const commune = str(input.commune) ?? ref.commune ?? (ctx as any).city;
    const query = codeInsee
      ? `code=${encodeURIComponent(codeInsee)}`
      : (commune ? `nom=${encodeURIComponent(commune)}` : null);
    if (query) {
      try {
        const r = await fetch(
          `https://geo.api.gouv.fr/communes?${query}&fields=centre&limit=1`,
          { signal: AbortSignal.timeout(4000) },
        );
        if (r.ok) {
          const d = await r.json();
          const c = Array.isArray(d) && d[0]?.centre?.coordinates;
          if (Array.isArray(c) && c.length === 2) { lng = c[0]; lat = c[1]; }
        }
      } catch { /* geo.api injoignable → on continue sans */ }
    }
  }

  if (lat == null || lng == null) {
    return {
      status: 'not_found', source: 'Potentiel solaire',
      message: "Aucune localisation exploitable (ni coordonnées, ni commune) pour estimer le potentiel solaire.",
    };
  }

  try {
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.solaire, { lat, lon: lng });
    const s = summarizePotentielSolaireDedicated(raw);
    return { status: s.status, source: INTERNAL_FUNCTIONS.solaire, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.solaire, message: errMsg(e) };
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

  const ref = resolveParcelRef(input, ctx);
  let codeInsee = str(input.code_insee) ?? ref.code_insee ?? (ctx as any).code_insee;
  const commune = str(input.commune) ?? ref.commune ?? (ctx as any).city;
  const zipCode = str(input.zip_code) ?? ctx.parcel?.code_postal ?? (ctx as any).zip_code;

  if (!codeInsee && (commune || zipCode)) {
    const query = zipCode
      ? `codePostal=${encodeURIComponent(zipCode)}`
      : `nom=${encodeURIComponent(commune!)}`;
    try {
      const r = await fetch(
        `https://geo.api.gouv.fr/communes?${query}&fields=code&limit=1`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d) && d[0]?.code) codeInsee = String(d[0].code);
      }
    } catch { /* geo.api injoignable → la fonction retentera de résoudre */ }
  }

  if (!codeInsee && !commune && !zipCode) {
    return {
      status: 'not_found', source: 'Zonage ABC',
      message: "Aucune commune identifiée (ni code INSEE, ni ville, ni code postal) pour déterminer le zonage ABC.",
    };
  }

  try {
    const body = { code_insee: codeInsee ?? undefined, commune: commune ?? undefined, zip_code: zipCode ?? undefined };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.zonage, body);
    const s = summarizeZonageDedicated(raw);
    return { status: s.status, source: INTERNAL_FUNCTIONS.zonage, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.zonage, message: errMsg(e) };
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

  const ref = resolveParcelRef(input, ctx);
  let codeInsee = str(input.code_insee) ?? ref.code_insee ?? (ctx as any).code_insee;
  const commune = str(input.commune) ?? ref.commune ?? (ctx as any).city;
  const zipCode = str(input.zip_code) ?? ctx.parcel?.code_postal ?? (ctx as any).zip_code;

  if (!codeInsee && (commune || zipCode)) {
    const query = zipCode
      ? `codePostal=${encodeURIComponent(zipCode)}`
      : `nom=${encodeURIComponent(commune!)}`;
    try {
      const r = await fetch(
        `https://geo.api.gouv.fr/communes?${query}&fields=code&limit=1`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d) && d[0]?.code) codeInsee = String(d[0].code);
      }
    } catch { /* geo.api injoignable → la fonction retentera de résoudre */ }
  }

  if (!codeInsee && !commune && !zipCode) {
    return {
      status: 'not_found', source: 'Taxes locales',
      message: "Aucune commune identifiée (ni code INSEE, ni ville, ni code postal) pour interroger les taxes locales.",
    };
  }

  try {
    const body = { code_insee: codeInsee ?? undefined, commune: commune ?? undefined, zip_code: zipCode ?? undefined };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.taxes, body);
    const s = summarizeTaxesDedicated(raw);
    return { status: s.status, source: INTERNAL_FUNCTIONS.taxes, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.taxes, message: errMsg(e) };
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

  const ref = resolveParcelRef(input, ctx);
  let codeInsee = str(input.code_insee) ?? ref.code_insee ?? (ctx as any).code_insee;
  const commune = str(input.commune) ?? ref.commune ?? (ctx as any).city;
  const zipCode = str(input.zip_code) ?? ctx.parcel?.code_postal ?? (ctx as any).zip_code;
  const lat = num(input.lat) ?? ref.lat;
  const lng = num(input.lng) ?? ref.lng;

  if (!codeInsee && (commune || zipCode)) {
    const query = zipCode
      ? `codePostal=${encodeURIComponent(zipCode)}`
      : `nom=${encodeURIComponent(commune!)}`;
    try {
      const r = await fetch(
        `https://geo.api.gouv.fr/communes?${query}&fields=code&limit=1`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d) && d[0]?.code) codeInsee = String(d[0].code);
      }
    } catch { /* geo.api injoignable → la fonction retentera de résoudre */ }
  }

  if (!codeInsee && !commune && !zipCode) {
    return {
      status: 'not_found', source: 'PPR (Géorisques)',
      message: "Aucune commune identifiée (ni code INSEE, ni ville, ni code postal) pour lister les PPR.",
    };
  }

  try {
    const body = {
      code_insee: codeInsee ?? undefined,
      commune: commune ?? undefined,
      zip_code: zipCode ?? undefined,
      lat: lat ?? undefined,
      lon: lng ?? undefined,          // ⚠️ ppr-detail-v1 attend "lon"
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.ppr, body);
    const s = summarizePprDedicated(raw);
    return { status: s.status, source: INTERNAL_FUNCTIONS.ppr, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.ppr, message: errMsg(e) };
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

  const ref = resolveParcelRef(input, ctx);
  let codeInsee = str(input.code_insee) ?? ref.code_insee ?? (ctx as any).code_insee;
  const commune = str(input.commune) ?? ref.commune ?? (ctx as any).city;
  const zipCode = str(input.zip_code) ?? ctx.parcel?.code_postal ?? (ctx as any).zip_code;

  if (!codeInsee && (commune || zipCode)) {
    const query = zipCode
      ? `codePostal=${encodeURIComponent(zipCode)}`
      : `nom=${encodeURIComponent(commune!)}`;
    try {
      const r = await fetch(
        `https://geo.api.gouv.fr/communes?${query}&fields=code&limit=1`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (r.ok) {
        const d = await r.json();
        if (Array.isArray(d) && d[0]?.code) codeInsee = String(d[0].code);
      }
    } catch { /* geo.api injoignable → la fonction retentera de résoudre */ }
  }

  if (!codeInsee && !commune && !zipCode) {
    return {
      status: 'not_found', source: 'Assainissement',
      message: "Aucune commune identifiée (ni code INSEE, ni ville, ni code postal) pour l'assainissement.",
    };
  }

  try {
    const body = { code_insee: codeInsee ?? undefined, commune: commune ?? undefined, zip_code: zipCode ?? undefined };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.assainissement, body);
    const s = summarizeAssainissementDedicated(raw);
    return { status: s.status, source: INTERNAL_FUNCTIONS.assainissement, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.assainissement, message: errMsg(e) };
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
  const codeInsee = str(input.code_insee) ?? ref.code_insee ?? (ctx as any).code_insee;
  const commune = str(input.commune) ?? ref.commune ?? (ctx as any).city;
  // Identifiant cadastral (IDU) : permet à la fonction de retrouver le centroïde
  // exact de la parcelle via le cadastre, même sans coordonnées ni commune.
  const idu = str(input.cadastral_ref) ?? str(input.parcel_id) ?? ref.cadastral_ref ?? ref.parcel_id;

  if (lat == null && lng == null && !codeInsee && !commune && !idu) {
    return {
      status: 'not_found', source: 'Altimétrie',
      message: "Aucune localisation (ni coordonnées, ni identifiant cadastral, ni commune) pour l'altimétrie.",
    };
  }

  try {
    const body = {
      lat: lat ?? undefined,
      lon: lng ?? undefined,          // ⚠️ altimetrie-v1 attend "lon"
      cadastral_ref: idu ?? undefined,
      code_insee: codeInsee ?? undefined,
      commune: commune ?? undefined,
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.altimetrie, body);
    const s = summarizeAltimetrieDedicated(raw);
    return { status: s.status, source: INTERNAL_FUNCTIONS.altimetrie, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.altimetrie, message: errMsg(e) };
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
  const codeInsee = str(input.code_insee) ?? ref.code_insee ?? (ctx as any).code_insee;
  const commune = str(input.commune) ?? ref.commune ?? (ctx as any).city;
  const zipCode = str(input.zip_code) ?? ctx.parcel?.code_postal ?? (ctx as any).zip_code;

  if (!idu && lat == null && !codeInsee && !commune && !zipCode) {
    return {
      status: 'not_found', source: 'Étude de parcelle',
      message: "Aucune localisation exploitable. Demande à l'utilisateur d'ouvrir une parcelle ou de préciser une commune.",
    };
  }

  try {
    const body = {
      cadastral_ref: idu ?? undefined,
      lat: lat ?? undefined,
      lon: lng ?? undefined,          // ⚠️ etude-parcelle-v1 attend "lon"
      code_insee: codeInsee ?? undefined,
      commune: commune ?? undefined,
      zip_code: zipCode ?? undefined,
    };
    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.etude, body);
    const s = summarizeEtudeParcelle(raw);
    return { status: s.status, source: INTERNAL_FUNCTIONS.etude, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.etude, message: errMsg(e) };
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
  const city = str(input.city) ?? str(input.commune) ?? ref.commune ?? (ctx as any).city;
  const zip = str(input.zip_code) ?? ctx.parcel?.code_postal ?? (ctx as any).zip_code;

  if (lat == null && !address && !city) {
    return {
      status: 'not_found', source: 'Étude de marché',
      message: "Aucune localisation exploitable (ni coordonnées, ni adresse, ni ville) pour l'étude de marché.",
    };
  }

  try {
    const body: Record<string, unknown> = {
      project_type: str(input.project_type) ?? 'logement',
      radius_km: num(input.rayon_km) ?? 5,
    };
    if (lat != null && lng != null) { body.lat = lat; body.lon = lng; }   // ⚠️ "lon"
    else if (address) body.address = address;
    if (zip) body.zipCode = zip;                                          // ⚠️ camelCase
    if (city) body.city = city;

    const raw = await callInternalFunction(INTERNAL_FUNCTIONS.market, body);
    const s = summarizeMarketStudy(raw);
    return { status: s.status, source: INTERNAL_FUNCTIONS.market, data: s.data, message: s.message };
  } catch (e) {
    return { status: 'error', source: INTERNAL_FUNCTIONS.market, message: errMsg(e) };
  }
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
    "",
  ];

  if (s.commune_nom) lines.push(`- Commune : ${s.commune_nom}${s.departement ? ` (dépt. ${s.departement})` : ''}`);

  const sc = s.scores_securite ?? {};
  const scParts = [
    sc.global != null         ? `global ${sc.global}/100`                : null,
    sc.naturels != null       ? `naturels ${sc.naturels}/100`            : null,
    sc.technologiques != null ? `technologiques ${sc.technologiques}/100`: null,
    sc.pollution != null      ? `pollution ${sc.pollution}/100`          : null,
    sc.geotechniques != null  ? `géotechniques ${sc.geotechniques}/100`  : null,
  ].filter(Boolean);
  if (scParts.length) lines.push(`- Scores de sécurité : ${scParts.join(' · ')}`);

  if (Array.isArray(s.categories) && s.categories.length) {
    lines.push('', '### Niveau de risque par catégorie');
    for (const c of s.categories) {
      if (c?.nom) lines.push(`- ${c.nom} : risque ${c.niveau_risque ?? 'n.c.'}${c.score_securite != null ? ` (sécurité ${c.score_securite}/100)` : ''}`);
    }
  }

  const f = s.faits ?? {};
  const faits: string[] = [];
  if (f.inondation?.zone_inondable != null) faits.push(`Inondation : ${f.inondation.zone_inondable ? 'zone inondable ⚠️' : 'hors zone'}${f.inondation.ppri ? ' (PPRI)' : ''}`);
  if (f.seisme?.zone != null) faits.push(`Séisme : zone ${f.seisme.zone}${f.seisme.libelle ? ` (${f.seisme.libelle})` : ''}`);
  if (f.argiles?.niveau_alea != null) faits.push(`Retrait-gonflement argiles : aléa ${f.argiles.niveau_alea}`);
  if (f.radon?.classe != null) faits.push(`Radon : classe ${f.radon.classe}${f.radon.libelle ? ` (${f.radon.libelle})` : ''}`);
  if (f.icpe_seveso?.total != null) faits.push(`ICPE : ${f.icpe_seveso.total}${f.icpe_seveso.seveso_haut ? `, dont ${f.icpe_seveso.seveso_haut} SEVESO haut ⚠️` : ''}`);
  if (f.sites_pollues_sis?.count != null) faits.push(`Sites pollués (SIS) : ${f.sites_pollues_sis.count}`);
  if (f.cavites?.count != null) faits.push(`Cavités : ${f.cavites.count}`);
  if (f.mouvements_terrain?.count != null) faits.push(`Mouvements de terrain : ${f.mouvements_terrain.count}`);
  if (f.feux_foret?.zone_risque != null) faits.push(`Feux de forêt : ${f.feux_foret.zone_risque ? 'zone à risque' : 'hors zone'}${f.feux_foret.obligation_debroussaillement ? ' (débroussaillement obligatoire)' : ''}`);
  if (f.catnat_count != null) faits.push(`Arrêtés CatNat : ${f.catnat_count}`);
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

  return [
    "Tu es Mimmoza Copilot, l'assistant IA intégré à la plateforme Mimmoza (intelligence immobilière et foncière française).",
    verticalLine[ctx.vertical],
    `Contexte : route ${ctx.route}. ${parcelLine}`,
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
    "RÈGLES IMPÉRATIVES :",
    "1. Tu n'inventes jamais de donnée. Si une information n'a pas été obtenue via un outil ou le snapshot, dis-le explicitement.",
    "2. Toute affirmation factuelle (chiffre, zone PLU, prix) doit indiquer sa source entre crochets, ex: [source: market-study v1].",
    "2bis. Tu n'introduis JAMAIS un étalon de comparaison absent des données (moyenne nationale ou départementale, « ordre de grandeur habituel », « au-dessus/en dessous de la moyenne »), ni une étiquette qualitative que les données ne portent pas (« classe aisée », « périurbain », « premium », « fiscalité favorable »). Un qualificatif n'est admis que s'il repose sur un chiffre présent dans la réponse d'un outil — par exemple un score fourni, ou un écart calculé entre deux valeurs fournies. Sinon, tu donnes le chiffre brut et son effet concret, sans jugement.",
    "3. Toute analyse juridique, urbanistique, fiscale ou financière se termine par : « À faire valider par un professionnel. »",
    "4. Tu utilises les données du snapshot prédictif EN PRIORITÉ. Tu n'appelles un tool que pour des données absentes du snapshot.",
    "4bis. Les outils renvoient un champ \"status\". Si status = \"not_configured\", le service n'est pas encore disponible : mentionne-le brièvement en une phrase seulement. Si status = \"not_found\" ou \"error\", la donnée est indisponible : concentre-toi sur ce qui est disponible.",
    "4ter. Quand tu cites un chiffre issu d'un outil ou du snapshot, mentionne sa source.",
    "4quater. Tu ne traduis JAMAIS un code INSEE en nom de commune par toi-même. N'affiche un nom de commune QUE s'il est explicitement présent dans le contexte ou dans le champ \"data\" d'un outil.",
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
    "4sexdecies. Le contexte peut contenir un DEAL ACTIF, un snapshot prédictif ou des données de page portant sur un bien précis. Tu ne les utilises QUE si la question porte sur ce bien, sur « cette page » ou sur « mon projet ». Tu n'introduis JAMAIS de toi-même un bien, un prix, une estimation, une décote ou un budget que l'utilisateur n'a pas évoqué dans la conversation en cours : une question générale sur une ville, un secteur ou une réglementation reçoit une réponse générale. Si un rapprochement avec le deal actif te paraît utile, tu le PROPOSES en une phrase (« souhaitez-vous que je rapproche cela de votre projet en cours ? ») au lieu d'en dérouler les chiffres.",
    "4quindecies-a. En mode rapide, get_etude_parcelle se suffit à lui-même : après l'avoir appelé, tu n'appelles AUCUN autre outil (ni PLU, ni risques, ni DVF) et tu rédiges directement le rapport. Le budget d'itérations est limité : un outil supplémentaire consomme le tour de synthèse et l'utilisateur ne reçoit alors aucun rapport. Si le PLU ou les risques manquent, tu le signales en partie 5 comme point à vérifier, sans chercher à les récupérer.",
    "4quindecies. Quand tu réponds à partir de get_etude_parcelle, tu ne listes PAS les données brutes : tu rédiges un RAPPORT structuré en cinq parties — (1) Identité de la parcelle ; (2) Contraintes réglementaires (zonage, servitudes) ; (3) Aptitude physique du terrain (pente, altitude, assainissement, solaire) ; (4) Potentiel économique (loyers, zone ABC, fiscalité) ; (5) VERDICT ET POINTS DE VIGILANCE. La partie 5 est la plus importante : elle hiérarchise ce qui bloque, ce qui coûte cher et ce qui reste à vérifier. Tu t'appuies UNIQUEMENT sur les données du bundle, tu cites la source de chaque chiffre, et tu consacres un paragraphe explicite aux sources indisponibles et à ce qu'elles empêchent de conclure. Termine par « À faire valider par un professionnel. » INTERDICTIONS ABSOLUES dans ce rapport : ne JAMAIS nommer ni décrire une couleur de zone d'un PPR (rouge, bleue, orange…) — ce zonage réglementaire n'est dans aucune donnée, renvoie au règlement du PPR en mairie ; ne JAMAIS déduire une caractéristique géographique non fournie (proximité du littoral, d'un cours d'eau, nature de l'aléa) à partir d'une altitude ou d'un nom de commune ; ne JAMAIS introduire un étalon de comparaison absent des données (moyenne nationale, moyenne départementale, ordre de grandeur « habituel ») ; ne JAMAIS qualifier un chiffre de modéré, élevé, favorable, attractif ou pénalisant sans référence chiffrée issue du bundle — présente le taux brut et son effet concret (« TFB 31,75 % : à intégrer au coût de portage »), sans jugement de valeur.",
    mode === 'quick'
      ? "5. Mode rapide : réponse concise et directe (quelques phrases). Pas de digression. EXCEPTION : une réponse construite sur get_etude_parcelle est un rapport complet en 5 parties (règle 4quindecies) — la concision ne s'y applique pas, et tu ne sacrifies JAMAIS la partie 5 (verdict et points de vigilance), qui est la plus importante."
      : "5. Mode avancé : raisonnement structuré, factuel et sourcé.",
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

  msgs.push({ role: 'user', content: newUserMessage });
  return msgs;
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
  onGenerationStart?: () => void;
}): Promise<OrchestratorResult> {
  const { mode, tier, ctx, sse, onGenerationStart } = params;
  const model = TIER_MODEL_ID[tier];   // ⬅️ le modèle suit le plan, pas le mode
  const system = buildSystemPrompt(ctx, mode);
  const tools = toolsForMode(mode);
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
        const output = await executeTool(tu.name, tu.input, ctx);
        const durationMs = Date.now() - started;
        // Le statut métier (not_configured, not_found…) n'est PAS une erreur
        // technique : on le transmet au LLM qui sait l'interpréter.
        const isOk = output.status === 'ok' || output.status === 'partial';
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
          content: JSON.stringify(output),
        });
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

async function saveUserMessage(p: {
  conversationId: string; userId: string; text: string; mode: CopilotMode;
}): Promise<void> {
  await getAdmin().from('copilot_messages').insert({
    conversation_id: p.conversationId, user_id: p.userId, role: 'user',
    content: [{ type: 'text', text: p.text }], mode: p.mode, credits_cost: 0,
  });
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

  try {
    userId = await requireUserId(req);
    payload = validateRequest(await req.json());

    conversationId = await ensureConversation({
      conversationId: payload.conversation_id,
      userId, ctx: payload.context, firstMessage: payload.message,
    });

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
      conversationId, userId, text: payload.message, mode,
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

    const messages = await buildMessages(conversationId, payload.message, mode);

    const result = await runOrchestrator({
      mode, tier, ctx: payload.context, messages, sse,   // ⬅️ tier ajouté
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