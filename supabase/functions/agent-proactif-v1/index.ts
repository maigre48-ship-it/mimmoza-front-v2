// supabase/functions/agent-proactif-v1/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Agent PROACTIF — passage de nuit (cron `agent-proactif-nuit`, 4 h 23).
// Appel réservé au service : `Authorization: Bearer <clé secrète service_role>`.
// verify_jwt = false (les clés secrètes `sb_secret_…` ne sont pas des JWT) :
// la clé est comparée ici, en temps constant, à SUPABASE_SECRET_KEYS /
// SUPABASE_SERVICE_ROLE_KEY.
// Corps : {"interne":"proactif_nuit"} (cron) ; facultatif "user_ids": ["…"] pour limiter le passage.
// Réponse : { status, summary, stats, resultats[] } — HTTP 200 même sans rien à faire.
// Aucun appel LLM ici. Toute la logique est dans logique.ts (testée sans réseau).
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  executerProactif,
  localisationProjet,
  tierDepuisPlan,
  FENETRE_MAX_JOURS,
  type AoEvent,
  type DepotProactif,
  type EtatProactif,
  type OpportunityEvent,
  type PermisSitadel,
  type PrefsProactif,
  type ProjetLocalise,
  type SourcesBrutes,
  type WatchlistMatch,
  type WatchZone,
  type ZoneAlert,
} from './logique.ts';

const STATUTS_ACTIFS = ['devis', 'en_attente', 'en_cours', 'attente_utilisateur'];
const STATUTS_CLOS = ['terminee', 'budget_atteint', 'echec', 'annulee'];

function clesService(): string[] {
  const cles: string[] = [];
  const brut = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (brut) {
    try {
      const v = JSON.parse(brut);
      if (typeof v === 'string') cles.push(v);
      else if (v && typeof v === 'object') for (const x of Object.values(v)) if (typeof x === 'string' && x) cles.push(x);
    } catch { cles.push(brut); }
  }
  for (const n of ['SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY']) {
    const v = Deno.env.get(n);
    if (v) cles.push(v);
  }
  return cles;
}

function egalTempsConstant(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function appelService(req: Request, cles: string[]): boolean {
  const jeton = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!jeton) return false;
  let ok = false;
  for (const c of cles) ok = egalTempsConstant(jeton, c) || ok;
  return ok;
}

function json(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), { status, headers: { 'Content-Type': 'application/json' } });
}

function verifier<T>(r: { data: T | null; error: { message: string } | null }, quoi: string): T {
  if (r.error) throw new Error(`${quoi} : ${r.error.message}`);
  return (r.data ?? ([] as unknown)) as T;
}

/** Dépôt Supabase (service_role). Les alertes de zone, globales, sont lues une seule fois par passage. */
export function depotSupabase(db: SupabaseClient, now: Date): DepotProactif {
  let cacheAlertes: Promise<ZoneAlert[]> | null = null;
  const alertesFenetre = () => {
    cacheAlertes ??= (async () => verifier(await db.from('zone_alerts')
      .select('id, city, postal_code, iris_code, alert_type, alert_score, message, created_at')
      .gt('created_at', new Date(now.getTime() - FENETRE_MAX_JOURS * 86_400_000).toISOString())
      .lte('created_at', now.toISOString())
      .order('created_at', { ascending: false }).limit(2000), 'zone_alerts') as ZoneAlert[])();
    return cacheAlertes;
  };

  return {
    async utilisateursCandidats(userIds) {
      // Budget nul compris : il n'empêche pas un briefing déterministe (0 jeton).
      let q = db.from('user_ai_preferences')
        .select('user_id, learning_enabled, proactif_actif, budget_proactif_mensuel, proactif_consomme_mois, proactif_mois')
        .eq('proactif_actif', true).eq('learning_enabled', true).limit(1000);
      if (userIds?.length) q = q.in('user_id', userIds);
      return verifier(await q, 'user_ai_preferences') as PrefsProactif[];
    },

    async etat(userId) {
      const r = await db.rpc('agent_proactif_etat', { p_user_id: userId });
      if (r.error) throw new Error(`agent_proactif_etat : ${r.error.message}`);
      return r.data as EtatProactif;
    },

    async engageNonRegle(userId) {
      // Missions proactives dont les crédits ne sont pas encore réglés : leur plafond reste engagé.
      // Une mission close sans réservation (ex. échec « solde insuffisant ») n'engage rien.
      const rows = verifier(await db.from('agent_missions')
        .select('statut, reservation_id, jetons_reserves, devis')
        .eq('user_id', userId).eq('origine', 'proactif').is('regle_le', null)
        .neq('statut', 'devis').limit(50), 'agent_missions') as
        { statut: string; reservation_id: string | null; jetons_reserves: number | null; devis: { jetons_max?: number } | null }[];
      return rows.reduce((s, m) => s + (STATUTS_CLOS.includes(m.statut) && !m.reservation_id
        ? 0
        : Math.max(m.jetons_reserves ?? 0, Number(m.devis?.jetons_max ?? 0))), 0);
    },

    async curseur(userId) {
      const [b, m] = await Promise.all([
        db.from('agent_briefings').select('cree_le').eq('user_id', userId).is('mission_id', null)
          .order('cree_le', { ascending: false }).limit(1).maybeSingle(),
        db.from('agent_missions').select('criteres, cree_le').eq('user_id', userId).eq('origine', 'proactif')
          .order('cree_le', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (b.error) throw new Error(`agent_briefings : ${b.error.message}`);
      if (m.error) throw new Error(`agent_missions : ${m.error.message}`);
      const cands: number[] = [];
      const tb = Date.parse(String((b.data as { cree_le?: string } | null)?.cree_le ?? ''));
      if (Number.isFinite(tb)) cands.push(tb);
      const md = m.data as { criteres?: { curseur?: string }; cree_le?: string } | null;
      const tm = Date.parse(String(md?.criteres?.curseur ?? md?.cree_le ?? ''));
      if (Number.isFinite(tm)) cands.push(tm);
      return cands.length ? new Date(Math.max(...cands)).toISOString() : null;
    },

    async missionProactiveActive(userId) {
      const r = await db.from('agent_missions').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('origine', 'proactif').in('statut', STATUTS_ACTIFS);
      if (r.error) throw new Error(`agent_missions : ${r.error.message}`);
      return (r.count ?? 0) > 0;
    },

    async sources(userId, depuis, jusqua): Promise<SourcesBrutes> {
      const zones = verifier(await db.from('watch_zones')
        .select('id, label, city, postal_code, insee_code, iris_code, is_active')
        .eq('user_id', userId).eq('is_active', true).limit(200), 'watch_zones') as WatchZone[];
      const alertes = zones.length ? await alertesFenetre() : [];

      const listes = verifier(await db.from('user_watchlists').select('id, name, is_active')
        .eq('user_id', userId).eq('is_active', true).limit(200), 'user_watchlists') as { id: string; name: string; is_active: boolean }[];
      let matches: WatchlistMatch[] = [];
      if (listes.length) {
        const ms = verifier(await db.from('user_watchlist_matches')
          .select('id, watchlist_id, property_cluster_id, first_matched_at, is_active')
          .in('watchlist_id', listes.map((l) => l.id)).eq('is_active', true)
          .gt('first_matched_at', depuis).lte('first_matched_at', jusqua).limit(200), 'user_watchlist_matches') as
          { id: string; watchlist_id: string; property_cluster_id: string; first_matched_at: string; is_active: boolean }[];
        const ids = [...new Set(ms.map((x) => x.property_cluster_id))];
        const clusters = ids.length ? verifier(await db.from('property_clusters')
          .select('id, normalized_title, normalized_address, city, zip_code, canonical_price, canonical_surface_m2, is_active')
          .in('id', ids), 'property_clusters') as NonNullable<WatchlistMatch['cluster']>[] : [];
        matches = ms.map((x) => ({
          id: x.id, first_matched_at: x.first_matched_at, is_active: x.is_active,
          watchlist: listes.find((l) => l.id === x.watchlist_id)!,
          cluster: clusters.find((c) => c.id === x.property_cluster_id) ?? null,
        }));
      }

      const opportunites = verifier(await db.from('opportunity_watch_events')
        .select('id, event_type, title, url, price, previous_price, price_delta_pct, score, seen, created_at')
        .eq('user_id', userId).eq('seen', false).gt('created_at', depuis).lte('created_at', jusqua)
        .order('created_at', { ascending: false }).limit(100), 'opportunity_watch_events') as OpportunityEvent[];

      const appelsOffres = verifier(await db.from('ao_watch_events')
        .select('id, avis_id, objet, acheteur, url, zone_incertaine, date_limite, is_read, created_at')
        .eq('user_id', userId).eq('is_read', false).gt('created_at', depuis).lte('created_at', jusqua)
        .order('created_at', { ascending: false }).limit(100), 'ao_watch_events') as AoEvent[];

      const projetsBruts = verifier(await db.from('projects').select('id, name, data')
        .eq('created_by', userId).limit(50), 'projects') as { id: string; name: string; data: unknown }[];
      const projets: ProjetLocalise[] = [];
      for (const p of projetsBruts) {
        const loc = localisationProjet(p.data);
        if (loc) projets.push({ id: p.id, name: p.name, ...loc });
      }
      const insees = [...new Set(projets.map((p) => p.insee))];
      const permis = insees.length ? verifier(await db.from('sitadel_permis')
        .select('id, numero_permis, date_autorisation, commune_insee, commune, nature_projet, destination, nb_logements, surface_plancher, latitude, longitude, created_at')
        .in('commune_insee', insees).gt('created_at', depuis).lte('created_at', jusqua).limit(500), 'sitadel_permis') as PermisSitadel[] : [];

      return { zones, alertes, matches, opportunites, appelsOffres, projets, permis };
    },

    async tier(userId) {
      const r = await db.from('billing_profiles').select('plan_code, subscription_status').eq('user_id', userId).maybeSingle();
      if (r.error) return 'haiku';
      const d = r.data as { plan_code?: string; subscription_status?: string } | null;
      return tierDepuisPlan(d?.plan_code, d?.subscription_status);
    },

    async solde(userId) {
      const r = await db.from('credit_accounts').select('current_credits').eq('user_id', userId).maybeSingle();
      if (r.error || !r.data) return null;
      const v = (r.data as { current_credits?: number }).current_credits;
      return typeof v === 'number' ? v : null;
    },

    async creerMission(m) {
      const r = await db.from('agent_missions').insert(m).select('id').single();
      if (r.error) {
        console.warn('[agent-proactif] création de mission refusée :', r.error.message);
        return null;
      }
      return (r.data as { id: string }).id;
    },

    async creerBriefing(b) {
      const r = await db.from('agent_briefings').insert(b).select('id').single();
      if (r.error) throw new Error(`agent_briefings : ${r.error.message}`);
      return (r.data as { id: string }).id;
    },
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ status: 'error', summary: 'Méthode non autorisée.' }, 405);
  const cles = clesService();
  if (!cles.length) return json({ status: 'error', summary: 'Clé de service absente de la configuration.' }, 500);
  if (!appelService(req, cles)) return json({ status: 'error', summary: 'Appel réservé au service.' }, 401);

  let userIds: string[] | undefined;
  try {
    const corps = await req.json() as { user_ids?: unknown };
    if (Array.isArray(corps?.user_ids)) userIds = corps.user_ids.filter((x): x is string => typeof x === 'string').slice(0, 100);
  } catch { /* corps vide : cas nominal du cron */ }

  const url = Deno.env.get('SUPABASE_URL');
  if (!url) return json({ status: 'error', summary: 'SUPABASE_URL absent.' }, 500);
  const now = new Date();
  const db = createClient(url, cles[0], { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const resultats = await executerProactif(depotSupabase(db, now), now, userIds);
    const stats: Record<string, number> = {};
    for (const r of resultats) stats[r.resultat] = (stats[r.resultat] ?? 0) + 1;
    for (const r of resultats) if (r.resultat === 'erreur') console.error('[agent-proactif]', r.user_id, r.message);
    return json({
      status: 'ok',
      summary: `${resultats.length} utilisateur(s) examiné(s) : ${stats.mission ?? 0} mission(s), ${stats.briefing ?? 0} briefing(s), ${stats.rien ?? 0} sans nouveauté.`,
      stats,
      resultats,
    });
  } catch (e) {
    console.error('[agent-proactif] échec global', e);
    return json({ status: 'error', summary: e instanceof Error ? e.message : String(e) });
  }
});
