// supabase/functions/copilot-chat/agent/quartier-vente.ts
// =============================================================================
// VIS-70 (27/11/2026) — PAGE QUARTIER / PLAN MASSE de l'outil de vente. Outil `quartier_atouts` : Mimmo assemble « les
// atouts du quartier » du projet (Transports, Commerces, Écoles, Santé, Parcs et loisirs, Restaurants et cafés, Emploi,
// avec distance et temps à pied / à vélo / en transport), les résume dans une carte du chat et ouvre la page
// « Quartier » de l'Espace 3D (/mimmozia/quartier?conversation=…).
//
// LECTURE SEULE : BPE (public.bpe_equipements), gares (public.mobility_stops), GTFS IDF (get_nearby_gtfs_stops), OSM
// (Overpass), SIRENE (etablissements-sirene-v1 via l'appel interne de l'index). Rien n'est écrit, aucun jeton débité.
// Logique partagée avec le site : src/lib/quartier/* (module pur, mêmes chiffres que la page).
// Branchement dans index.ts : décrit (AVANT/APRÈS) dans le rapport VIS-70, non appliqué (fichier partagé).
// =============================================================================
import type { OutilDef, ResultatOutil } from './types.ts';
import {
  assemblerAtouts, lieuxDepuisBpe, lieuxDepuisMobilite, lieuxDepuisSirene, projetDepuisPreparation, RAYON_DEFAUT_M,
  type AtoutsQuartier, type EtatSource, type LieuBrut, type ProjetQuartier, type SourceQuartier,
} from '../../../../src/lib/quartier/atoutsQuartier.ts';
import { lieuxDepuisOverpass, requeteOverpass, SERVEURS_OVERPASS } from '../../../../src/lib/quartier/overpassQuartier.ts';
import { CARTE_QUARTIER, lignesSynthese, OUTIL_QUARTIER_VENTE, resumePourMimmo } from '../../../../src/lib/quartier/texteAtouts.ts';
import { adressePageQuartier } from '../../../../src/lib/quartier/navigationVente.ts';

export { OUTIL_QUARTIER_VENTE };
export const SOURCE_QUARTIER = 'MimmozIA · Quartier';
export const LIBELLE_BOUTON_QUARTIER = 'Ouvrir la page Quartier';
/** Lieux par catégorie renvoyés au modèle et à la carte (la page recharge la liste complète). */
export const LIEUX_PAR_CATEGORIE_CHAT = 5;

export const OUTIL_QUARTIER_VENTE_DEF: OutilDef = {
  name: OUTIL_QUARTIER_VENTE,
  description:
    'QUARTIER / PLAN MASSE (outil de vente) : assemble les atouts RÉELS du quartier du projet — transports, commerces, écoles, ' +
    'santé, parcs et loisirs, restaurants et cafés, emploi — avec distance et temps estimés à pied, à vélo et en transport, ' +
    'et ouvre la page « Quartier » de l’Espace 3D (vue aérienne, catégories cliquables, menu Plan masse · Situation · ' +
    'Extérieur · Plans · Intérieur · Galerie). QUAND : l’utilisateur demande ce qu’il y a autour du projet, les atouts ou ' +
    'commodités du quartier, la situation, le plan masse, un argumentaire de localisation pour ses acquéreurs. ' +
    'Sans paramètre, la parcelle du projet de la conversation est utilisée. APRÈS L’APPEL : une carte « Le quartier » ' +
    's’affiche sous ta réponse ; résume en 2 phrases au plus (la phrase « À 5 min à pied : … » et le transport le plus ' +
    'proche), propose le bouton « Ouvrir la page Quartier ». Ne cite QUE des lieux présents dans la sortie ; une catégorie ' +
    '« indisponible » n’est pas une absence ; dis « environ » pour les temps.',
  input_schema: {
    type: 'object',
    properties: {
      lat: { type: 'number', description: 'Latitude, si l’utilisateur donne un autre point que le projet.' },
      lng: { type: 'number', description: 'Longitude, avec lat.' },
      cadastral_ref: { type: 'string', description: 'Référence cadastrale (14 caractères), si ce n’est pas la parcelle du projet.' },
      rayon_m: { type: 'number', description: 'Rayon de recherche en mètres (500 à 3000, défaut 2000).' },
    },
  },
  available_in_modes: ['quick', 'advanced', 'report'],
};

/** Accès aux sources (injecté : tests sur données factices, Supabase en production). Chaque méthode lève en cas d'échec. */
export interface DepotQuartier {
  projetConversation(conversationId: string): Promise<ProjetQuartier | null>;
  bpe(lat: number, lon: number, rayonM: number): Promise<Record<string, unknown>[]>;
  gares(lat: number, lon: number, rayonM: number): Promise<Record<string, unknown>[]>;
  gtfs(lat: number, lon: number): Promise<Record<string, unknown>[]>;
  osm(lat: number, lon: number, rayonM: number): Promise<unknown>;
  /** Items de etablissements-sirene-v1 ; absent si COPILOT_FN_SIRENE n'est pas branché. */
  sirene?(lat: number, lon: number): Promise<Record<string, unknown>[]>;
}

export interface EnvQuartier {
  conversationId?: string | null;
  depot: DepotQuartier;
  /** Repli de localisation de l'index (resolvePointForTool) : coordonnées, IDU ou centre de la commune. */
  resoudrePoint?(input: Record<string, unknown>): Promise<{ lat: number | null; lon: number | null; precision: 'parcelle' | 'point' | 'centre_commune' }>;
  maintenant?: Date;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Le tour parle-t-il du quartier / de la situation du projet ? (proposition de l'outil, jamais d'appel forcé) */
export function demandeQuartier(texte: string): boolean {
  const t = texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /\b(quartier|plan masse|atouts? (du|de la) (quartier|situation|localisation|secteur)|commodites|a proximite|aux alentours|autour (du|de la|de mon|de notre) (projet|terrain|parcelle|residence|programme)|page (quartier|situation)|qu'?y a-t-il autour|ecoles? (autour|proches?|a proximite)|transports? (autour|proches?|a proximite)|commerces? (autour|proches?|a proximite)|argumentaire de localisation)\b/.test(t);
}

async function localiser(input: Record<string, unknown>, env: EnvQuartier): Promise<ProjetQuartier | null> {
  const lat = num(input.lat), lon = num(input.lng ?? input.lon);
  const explicite = (lat !== null && lon !== null) || typeof input.cadastral_ref === 'string';
  if (!explicite && env.conversationId) {
    const p = await env.depot.projetConversation(env.conversationId).catch(() => null);
    if (p) return p;
  }
  if (lat !== null && lon !== null) return { lat, lon, precision: 'point' };
  if (env.resoudrePoint) {
    const r = await env.resoudrePoint(input);
    if (r.lat !== null && r.lon !== null) return { lat: r.lat, lon: r.lon, precision: r.precision };
  }
  return null;
}

/** Lit les sources en parallèle ; un échec devient un état « indisponible ». */
export async function lireSourcesQuartier(p: ProjetQuartier, depot: DepotQuartier, rayon: number): Promise<{ lieux: LieuBrut[]; etats: EtatSource[] }> {
  const appels: [SourceQuartier, () => Promise<LieuBrut[]>][] = [
    ['bpe', async () => lieuxDepuisBpe(await depot.bpe(p.lat, p.lon, rayon))],
    ['mobilite', async () => lieuxDepuisMobilite(await depot.gares(p.lat, p.lon, 15_000), 'mobilite')],
    ['gtfs', async () => lieuxDepuisMobilite(await depot.gtfs(p.lat, p.lon), 'gtfs')],
    ['osm', async () => lieuxDepuisOverpass(await depot.osm(p.lat, p.lon, Math.min(rayon, 1500)))],
  ];
  if (depot.sirene) { const s = depot.sirene.bind(depot); appels.push(['sirene', async () => lieuxDepuisSirene(await s(p.lat, p.lon))]); }
  const res = await Promise.allSettled(appels.map(([, f]) => f()));
  const lieux: LieuBrut[] = [];
  const etats = res.map((r, i): EtatSource => {
    const source = appels[i]![0];
    if (r.status === 'fulfilled') { lieux.push(...r.value); return { source, ok: true }; }
    return { source, ok: false, message: r.reason instanceof Error ? r.reason.message : String(r.reason) };
  });
  return { lieux, etats };
}

export async function executerOutilQuartier(input: Record<string, unknown>, env: EnvQuartier): Promise<ResultatOutil> {
  const p = await localiser(input, env);
  if (!p) {
    return { status: 'not_found', source: SOURCE_QUARTIER,
      message: 'Aucune localisation exploitable (ni parcelle du projet, ni coordonnées, ni commune). Demande l’adresse ou la référence cadastrale ; n’invente aucun lieu.' };
  }
  const rayon = Math.min(3000, Math.max(500, num(input.rayon_m) ?? RAYON_DEFAUT_M));
  const { lieux, etats } = await lireSourcesQuartier(p, env.depot, rayon);
  if (!etats.some((e) => e.ok)) {
    return { status: 'error', source: SOURCE_QUARTIER, message: 'Aucune source de quartier n’a répondu (BPE, gares, OSM). Dis que la donnée est momentanément indisponible ; ne conclus à aucune absence.' };
  }
  const atouts: AtoutsQuartier = assemblerAtouts(p, lieux, etats, { rayon_m: rayon, maxParCategorie: LIEUX_PAR_CATEGORIE_CHAT, maintenant: env.maintenant });
  const lien = adressePageQuartier({ conversationId: env.conversationId ?? null, ...(env.conversationId && p.precision === 'parcelle' ? {} : { lat: p.lat, lon: p.lon }) });
  return {
    status: 'ok', source: SOURCE_QUARTIER,
    data: {
      carte: CARTE_QUARTIER, lien_page: lien, bouton: LIBELLE_BOUTON_QUARTIER, debit_jetons: 0,
      resume: resumePourMimmo(atouts), lignes: lignesSynthese(atouts), atouts,
    },
    message:
      `${resumePourMimmo(atouts)} La carte « Le quartier » s’affiche sous ta réponse (catégories, lieux réels, temps estimés) avec le bouton ` +
      `« ${LIBELLE_BOUTON_QUARTIER} ». Résume en deux phrases au plus, sans recopier la liste ; temps « environ », jamais garantis.` +
      (atouts.avertissements.length > 1 ? ` Réserves à dire si l’on t’interroge : ${atouts.avertissements.slice(1).join(' ')}` : ''),
  };
}

/* ─── Dépôt de production ─── */

type ClientAdmin = { from: (t: string) => any; rpc: (f: string, a: Record<string, unknown>) => any };

function rectangle(lat: number, lon: number, rayonM: number) {
  const dLat = rayonM / 111_320, dLon = rayonM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { latMin: lat - dLat, latMax: lat + dLat, lonMin: lon - dLon, lonMax: lon + dLon };
}

/**
 * Dépôt Supabase (client service, lecture seule) + Overpass. `sirene` reprend l'appel interne de l'index
 * (callInternalFunction(INTERNAL_FUNCTIONS.sirene, …)) pour ne pas dupliquer la configuration.
 */
export function depotQuartierSupabase(admin: ClientAdmin, o: { fetch?: typeof fetch; sirene?: (lat: number, lon: number) => Promise<unknown> } = {}): DepotQuartier {
  const f = o.fetch ?? fetch;
  const depot: DepotQuartier = {
    async projetConversation(conversationId) {
      const { data, error } = await admin.from('studio_preparations').select('idu,entree').eq('conversation_id', conversationId)
        .order('maj_le', { ascending: false }).limit(1);
      if (error) throw new Error(error.message ?? 'lecture impossible');
      return data?.[0] ? projetDepuisPreparation((data[0] as { entree?: unknown }).entree) : null;
    },
    async bpe(lat, lon, rayonM) {
      const r = rectangle(lat, lon, rayonM);
      const { data, error } = await admin.from('bpe_equipements').select('typequ,nomrs,latitude,longitude,libcom')
        .gte('latitude', r.latMin).lte('latitude', r.latMax).gte('longitude', r.lonMin).lte('longitude', r.lonMax).limit(3000);
      if (error) throw new Error(error.message ?? 'BPE illisible');
      return data ?? [];
    },
    async gares(lat, lon, rayonM) {
      const r = rectangle(lat, lon, rayonM);
      const { data, error } = await admin.from('mobility_stops').select('stop_id,stop_name,lat,lon,mode,line_ids')
        .in('mode', ['ter', 'tgv']).gte('lat', r.latMin).lte('lat', r.latMax).gte('lon', r.lonMin).lte('lon', r.lonMax).limit(60);
      if (error) throw new Error(error.message ?? 'gares illisibles');
      return data ?? [];
    },
    async gtfs(lat, lon) {
      const { data, error } = await admin.rpc('get_nearby_gtfs_stops', { p_lat: lat, p_lon: lon, p_max_distance_km: 1, p_limit: 60 });
      if (error) throw new Error(error.message ?? 'GTFS illisible');
      return data ?? [];
    },
    async osm(lat, lon, rayonM) {
      const corps = new URLSearchParams({ data: requeteOverpass(lat, lon, rayonM) });
      let derniere = 'Overpass injoignable';
      for (const url of SERVEURS_OVERPASS) {
        try {
          const r = await f(url, { method: 'POST', body: corps, headers: { 'User-Agent': 'Mimmoza/1.0 (quartier)' }, signal: AbortSignal.timeout(20_000) });
          if (r.ok) return await r.json();
          derniere = `Overpass HTTP ${r.status}`;
        } catch (e) { derniere = e instanceof Error ? e.message : String(e); }
      }
      throw new Error(derniere);
    },
  };
  if (o.sirene) {
    const appel = o.sirene;
    depot.sirene = async (lat, lon) => {
      const raw = await appel(lat, lon) as { status?: string; items?: Record<string, unknown>[] } | null;
      if (raw?.status !== 'ok') throw new Error('SIRENE indisponible');
      return raw.items ?? [];
    };
  }
  return depot;
}

/** Consigne ajoutée au système quand `demandeQuartier` est vrai (branchement dans index.ts). */
export const CONSIGNE_QUARTIER =
  `QUARTIER (VIS-70) : une question sur ce qu’il y a autour du projet, ses atouts de localisation, la situation ou le plan masse se traite par ` +
  `l’outil ${OUTIL_QUARTIER_VENTE} (lieux réels BPE / OSM / gares / SIRENE), JAMAIS de mémoire. Après l’appel, deux phrases au plus et le bouton ` +
  `« ${LIBELLE_BOUTON_QUARTIER} » de la carte ; une catégorie « indisponible » n’est pas une absence.`;
