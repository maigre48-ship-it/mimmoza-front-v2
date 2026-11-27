// src/lib/quartier/chargerQuartier.ts
// =============================================================================
// VIS-70 — chargement des atouts du quartier CÔTÉ SITE (E/S). Toutes les sources sont déjà utilisées par Mimmoza :
//   · BPE : lecture directe de public.bpe_equipements (politique bpe_equipements_read_auth, rectangle borné) ;
//   · GTFS Île-de-France : RPC get_nearby_gtfs_stops (gtfs_stops lisible par les comptes connectés) ;
//   · gares : RPC mobility_nearby_stops — NB : mobility_stops a la RLS active SANS politique de lecture, la RPC renvoie
//     donc 0 ligne à un compte connecté ; migration proposée (non appliquée) :
//     supabase/migrations/20261127120000_vis70_mobility_stops_lecture.sql. L'outil Edge (clé service) lit les gares.
//   · OSM : Overpass (restaurants, parcs, loisirs, bus / tram hors IDF) ;
//   · SIRENE : fonction etablissements-sirene-v1 (Emploi).
// Une source en échec est signalée « indisponible » (jamais « aucun lieu »). Les atouts calculés par Mimmo (carte du
// chat) sont repris tels quels via le stockage de session : la page s'ouvre instantanément sur les mêmes chiffres.
// =============================================================================
import { supabase } from '@/lib/supabaseClient';
import {
  assemblerAtouts, lieuxDepuisBpe, lieuxDepuisMobilite, lieuxDepuisSirene, lireAtouts, projetDepuisPreparation, RAYON_DEFAUT_M,
  type AtoutsQuartier, type EtatSource, type LieuBrut, type ProjetQuartier,
} from './atoutsQuartier.ts';
import { lieuxDepuisOverpass, requeteOverpass, SERVEURS_OVERPASS } from './overpassQuartier.ts';

const CLE_SESSION = 'mimmoza:quartier:';
const cleSession = (p: { lat: number; lon: number }) => `${CLE_SESSION}${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

export function ecrireAtoutsSession(a: AtoutsQuartier): void {
  try { sessionStorage.setItem(cleSession(a.projet), JSON.stringify(a)); } catch { /* stockage plein ou indisponible */ }
}

export function lireAtoutsSession(p: { lat: number; lon: number }): AtoutsQuartier | null {
  try { return lireAtouts(JSON.parse(sessionStorage.getItem(cleSession(p)) ?? 'null')); } catch { return null; }
}

/** Projet de la conversation : parcelle de la dernière préparation Studio (contour + centroïde). */
export async function lireProjetConversation(conversationId: string): Promise<ProjetQuartier | null> {
  const { data, error } = await supabase.from('studio_preparations').select('idu,entree').eq('conversation_id', conversationId)
    .order('maj_le', { ascending: false }).limit(1);
  if (error || !data?.length) return null;
  return projetDepuisPreparation((data[0] as { entree?: unknown }).entree);
}

async function bpe(p: ProjetQuartier, rayon: number): Promise<LieuBrut[]> {
  const dLat = rayon / 111_320, dLon = rayon / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  const { data, error } = await supabase.from('bpe_equipements').select('typequ,nomrs,latitude,longitude,libcom')
    .gte('latitude', p.lat - dLat).lte('latitude', p.lat + dLat).gte('longitude', p.lon - dLon).lte('longitude', p.lon + dLon).limit(3000);
  if (error) throw new Error(error.message);
  return lieuxDepuisBpe((data ?? []) as Record<string, unknown>[]);
}

async function gtfs(p: ProjetQuartier): Promise<LieuBrut[]> {
  const { data, error } = await supabase.rpc('get_nearby_gtfs_stops', { p_lat: p.lat, p_lon: p.lon, p_max_distance_km: 1, p_limit: 60 });
  if (error) throw new Error(error.message);
  return lieuxDepuisMobilite((data ?? []) as Record<string, unknown>[], 'gtfs');
}

async function gares(p: ProjetQuartier): Promise<LieuBrut[]> {
  const { data, error } = await supabase.rpc('mobility_nearby_stops', { p_lat: p.lat, p_lon: p.lon, p_radius_m: 15000, p_limit: 40 });
  if (error) throw new Error(error.message);
  // La RPC ne renvoie pas les coordonnées : les gares sont listées avec leur distance, sans repère sur la carte.
  return lieuxDepuisMobilite(((data ?? []) as Record<string, unknown>[]).filter((r) => r.mode === 'ter' || r.mode === 'tgv'), 'mobilite');
}

async function osm(p: ProjetQuartier, rayon: number, signal?: AbortSignal): Promise<LieuBrut[]> {
  const corps = new URLSearchParams({ data: requeteOverpass(p.lat, p.lon, Math.min(rayon, 1500)) });
  let derniere: unknown = null;
  for (const url of SERVEURS_OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: corps, signal: signal ?? AbortSignal.timeout(25_000) });
      if (r.ok) return lieuxDepuisOverpass(await r.json());
      derniere = new Error(`Overpass HTTP ${r.status}`);
    } catch (e) { derniere = e; }
  }
  throw derniere instanceof Error ? derniere : new Error('Overpass injoignable');
}

async function sirene(p: ProjetQuartier): Promise<LieuBrut[]> {
  const { data, error } = await supabase.functions.invoke('etablissements-sirene-v1', { body: { latitude: p.lat, longitude: p.lon, radius_km: 1.5, limit: 100 } });
  if (error) throw new Error(error.message);
  const d = data as { status?: string; items?: Record<string, unknown>[] } | null;
  if (d?.status !== 'ok') throw new Error('SIRENE indisponible');
  return lieuxDepuisSirene(d.items ?? []);
}

/** Lit toutes les sources en parallèle et assemble les atouts. Ne lève jamais : les échecs deviennent des états. */
export async function chargerAtoutsQuartier(p: ProjetQuartier, o: { rayon_m?: number; signal?: AbortSignal } = {}): Promise<AtoutsQuartier> {
  const rayon = o.rayon_m ?? RAYON_DEFAUT_M;
  const appels: [EtatSource['source'], Promise<LieuBrut[]>][] = [
    ['bpe', bpe(p, rayon)], ['gtfs', gtfs(p)], ['mobilite', gares(p)], ['osm', osm(p, rayon, o.signal)], ['sirene', sirene(p)],
  ];
  const res = await Promise.allSettled(appels.map(([, pr]) => pr));
  const lieux: LieuBrut[] = [];
  const etats: EtatSource[] = res.map((r, i) => {
    const source = appels[i]![0];
    if (r.status === 'fulfilled') { lieux.push(...r.value); return { source, ok: true }; }
    return { source, ok: false, message: r.reason instanceof Error ? r.reason.message : String(r.reason) };
  });
  const a = assemblerAtouts(p, lieux, etats, { rayon_m: rayon });
  ecrireAtoutsSession(a);
  return a;
}
