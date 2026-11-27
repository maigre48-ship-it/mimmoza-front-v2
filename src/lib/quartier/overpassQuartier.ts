// src/lib/quartier/overpassQuartier.ts
// =============================================================================
// VIS-70 — requête Overpass (OpenStreetMap) des catégories que la BPE locale ne couvre pas (restaurants et cafés,
// parcs et loisirs, médecins) et des arrêts de bus / tram HORS Île-de-France (gtfs_stops ne couvre que l'IDF).
// Mêmes serveurs que smartscore-enriched-v3 et market-study-promoteur-v1. Licence : ODbL 1.0, attribution
// « © les contributeurs d'OpenStreetMap » (affichée par la page et reprise dans le dossier).
// Module PUR : construit la requête et lit la réponse ; l'appel réseau est fait par l'appelant (site ou Edge).
// =============================================================================
import { classerOsm } from './categoriesQuartier.ts';
import type { LieuBrut } from './atoutsQuartier.ts';

export const SERVEURS_OVERPASS: readonly string[] = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export const DELAI_OVERPASS_S = 20;

/** Requête Overpass QL (POST `data=`), `out center` pour placer aussi les parcs (polygones). */
export function requeteOverpass(lat: number, lon: number, rayonM: number, o: { transports?: boolean } = {}): string {
  const r = Math.round(Math.min(Math.max(rayonM, 200), 3000));
  const a = `(around:${r},${lat.toFixed(6)},${lon.toFixed(6)})`;
  const lignes = [
    `nwr["amenity"~"^(restaurant|cafe|bar|pub|cinema|theatre|library|doctors|marketplace)$"]${a};`,
    `nwr["leisure"~"^(park|garden|playground|sports_centre|stadium|swimming_pool)$"]["access"!~"private"]${a};`,
    `nwr["natural"="beach"]${a};`,
  ];
  if (o.transports !== false) {
    lignes.push(`node["highway"="bus_stop"]${a};`, `node["railway"~"^(tram_stop|station|halt)$"]${a};`, `node["amenity"="bicycle_rental"]${a};`);
  }
  return `[out:json][timeout:${DELAI_OVERPASS_S}];(${lignes.join('')});out center tags 400;`;
}

/** Lieux bruts d'une réponse Overpass ; éléments sans nom écartés (sauf arrêts nommés par leur ligne). */
export function lieuxDepuisOverpass(reponse: unknown): LieuBrut[] {
  const els = typeof reponse === 'object' && reponse !== null && Array.isArray((reponse as { elements?: unknown }).elements)
    ? (reponse as { elements: unknown[] }).elements : [];
  const out: LieuBrut[] = [];
  for (const e of els) {
    if (typeof e !== 'object' || e === null) continue;
    const el = e as { type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> };
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const c = classerOsm(tags);
    if (!c) continue;
    const nom = tags.name ?? tags['name:fr'] ?? null;
    // Un parc ou un restaurant sans nom ne se vend pas ; un arrêt sans nom non plus (doublon de quai le plus souvent).
    if (!nom && c.categorie !== 'loisirs') continue;
    if (!nom && c.sousType !== 'Aire de jeux') continue;
    const { mode, ...classement } = c;
    const lignes = tags.route_ref ? tags.route_ref.split(/[;,]/).map((x) => x.trim()).filter(Boolean) : undefined;
    out.push({
      source: 'osm', nom, lat, lon, classement, ...(mode ? { mode } : {}), ...(lignes?.length ? { lignes } : {}),
      adresse: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ') || null,
      id: `osm:${el.type ?? 'n'}${el.id ?? `${lat},${lon}`}`,
    });
  }
  return out;
}
