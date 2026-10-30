// supabase/functions/rechercher-parcelles-v1/logique.ts
// =============================================================================
// Mimmoza — PROSPECTION FONCIÈRE : repérer les parcelles candidates d'un secteur
// -----------------------------------------------------------------------------
// Logique pure, sans Deno.serve : tout l'accès réseau passe par `deps.fetch`,
// ce qui permet de la tester sans réseau (fixtures, voir logique.test.ts).
//
// SOURCES (toutes sans jeton) :
//   1. Cadastre — commune entière : fichier Etalab unique par commune
//        https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/{INSEE}/geojson/parcelles
//      (déjà utilisé en production par cadastre-parcelles-bbox-v1, 1 requête,
//      champs id = IDU 14 car., commune, section, numero, contenance).
//      Repli : API Carto IGN /api/cadastre/parcelle?code_insee=…&_limit=1000&_start=…
//      (doc IGNF/apicarto : _limit entre 1 et 1000, _start = décalage).
//   2. Cadastre — rectangle ou cercle : API Carto /api/cadastre/parcelle?geom=<Polygon>
//      paginé de la même façon.
//   3. Zonage : API Carto GPU /api/gpu/zone-urba?geom=<GeoJSON> (geom OU partition
//      requis, pas de pagination documentée). On envoie UNE fois le rectangle
//      englobant des candidates et on lit la zone au CENTROÏDE de chaque parcelle
//      localement (point dans polygone). Repli si l'appel échoue : une requête par
//      point, plafonnée à GPU_POINT_MAX candidates.
//   4. Bâti : BD TOPO V3 (IGN) en WFS public data.geopf.fr, couche
//      BDTOPO_V3:batiment, interrogée par rectangle de parcelle, plafonnée à
//      BATI_MAX parcelles. Si la source ne répond pas : bati_detecte = null et
//      on NE FILTRE PAS (on le dit).
//
// STRATÉGIE POUR UNE COMMUNE DE 30 000 PARCELLES (budget < 22 s) :
//   a. une seule lecture du cadastre (Etalab) ou pagination API Carto en vagues
//      parallèles de 4 pages de 1 000, arrêtée à CADASTRE_BUDGET_MS → couverture
//      « partielle » SIGNALÉE ;
//   b. filtre SURFACE en mémoire d'abord (c'est le filtre le plus sélectif et le
//      seul gratuit) ;
//   c. pré-tri (surface + forme) puis zonage sur au plus MAX_CANDIDATS_ZONAGE
//      parcelles (1 appel GPU) ;
//   d. bâti seulement sur les meilleures, jusqu'à remplir `limite`.
//
// TRI DÉTERMINISTE (score_tri sur 100, documenté dans stats.tri) :
//   · zonage  (40 pts) : U 40 · AUc 30 · AU 25 · inconnu 15 · AUs 10 · A/N 0
//   · surface (30 pts) : 30 × clamp(log10(surface/100) / log10(50), 0, 1)
//                         → 100 m² = 0 pt, 5 000 m² et plus = 30 pts
//   · forme   (30 pts) : 30 × clamp(compacité / 0,785, 0, 1), compacité =
//                         4π·aire / périmètre² (1 = disque, 0,785 = carré)
//   Égalités : surface décroissante, puis IDU croissant (ordre total, stable).
//
// JAMAIS DE DONNÉE INVENTÉE : un zonage non lu vaut null avec son motif
// (zonage_statut), un bâti non vérifié vaut null, une surface qui ne vient pas
// de la contenance cadastrale est marquée « calculee_geometrie ».
// =============================================================================

import { reparerEncodageProfond } from '../_shared/texte/reparerEncodage.ts';

// ─── Réglages ────────────────────────────────────────────────────────────────
export const REGLAGES = {
  BUDGET_MS: 22000,             // tout doit être rendu avant (copilot coupe à 25 s)
  CADASTRE_BUDGET_MS: 12000,    // au-delà, on arrête de paginer
  ETALAB_TIMEOUT_MS: 9000,
  APICARTO_TIMEOUT_MS: 7000,
  APICARTO_PAGE: 1000,          // maximum documenté de _limit
  APICARTO_VAGUE: 4,            // pages demandées en parallèle
  APICARTO_MAX_PAGES: 40,       // 40 000 parcelles au plus
  MAX_CANDIDATS_ZONAGE: 1500,
  GPU_BBOX_TIMEOUT_MS: 8000,
  GPU_POINT_MAX: 40,
  GPU_POINT_TIMEOUT_MS: 4000,
  BATI_MAX: 60,
  BATI_TIMEOUT_MS: 4000,
  PARALLELE: 8,
  LIMITE_DEFAUT: 20,
  LIMITE_MAX: 50,
  RAYON_MAX_M: 2000,
  BBOX_MAX_KM2: 9,
  GEO_TIMEOUT_MS: 4000,
} as const;

export const URLS = {
  etalab: (insee: string) =>
    `https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/${insee}/geojson/parcelles`,
  apicartoCadastre: 'https://apicarto.ign.fr/api/cadastre/parcelle',
  apicartoGpu: 'https://apicarto.ign.fr/api/gpu',
  geoApi: 'https://geo.api.gouv.fr/communes',
  wfsGeopf: 'https://data.geopf.fr/wfs/ows',
};

export const TRI_DOC =
  'score_tri /100 = zonage (U 40, AUc 30, AU 25, inconnu 15, AUs 10, A/N 0) + surface ' +
  '(30 × clamp(log10(surface/100)/log10(50),0,1) : 100 m² → 0, ≥ 5 000 m² → 30) + forme ' +
  '(30 × clamp(compacité/0,785,0,1), compacité = 4π·aire/périmètre²). Égalités : surface ' +
  'décroissante puis IDU croissant.';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface Entree {
  code_insee?: string;
  commune?: string;
  cp?: string;
  code_postal?: string;
  bbox?: number[];          // [minLon, minLat, maxLon, maxLat]
  centre?: number[];        // [lon, lat]
  rayon_m?: number;
  surface_min_m2?: number;
  surface_max_m2?: number;
  zonages?: string[];       // 'U', 'AU', 'A', 'N' ou codes PLU ('UB', '1AU'…)
  exclure_bati?: boolean;
  limite?: number;
}

export interface Deps {
  fetch: typeof fetch;
  maintenant?: () => number;
}

type Anneau = number[][];
type Poly = Anneau[];          // [extérieur, trous…]

export interface Parcelle {
  idu: string;
  code_insee: string;
  commune: string | null;
  section: string;
  numero: string;
  surface_m2: number;
  surface_source: 'contenance_cadastrale' | 'calculee_geometrie';
  compacite: number;
  centroide: [number, number];
  emprise: [number, number, number, number];   // bbox lon/lat
  polys: Poly[];
}

export interface Zone {
  type_zone: string | null;
  zonage_plu: string | null;
  libelle_zone: string | null;
  document: string | null;
}

export interface Item {
  idu: string;
  commune: string | null;
  code_insee: string;
  section: string;
  numero: string;
  surface_m2: number;
  surface_source: Parcelle['surface_source'];
  zonage_plu: string | null;
  type_zone: string | null;
  libelle_zone: string | null;
  zonage_statut: 'lu' | 'hors_zone_publiee' | 'non_verifie';
  centroide: [number, number];
  compacite: number;
  bati_detecte: boolean | null;
  emprise_batie_m2: number | null;
  score_tri: number;
  raisons: string[];
}

export interface Sortie {
  status: 'ok' | 'no_data' | 'error';
  summary: string;
  stats: Record<string, unknown>;
  items: Item[];
  avertissements: string[];
  sources: string[];
}

// ─── Petits utilitaires ──────────────────────────────────────────────────────
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}
function txt(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t : null;
}
function clamp(x: number, a: number, b: number): number { return Math.max(a, Math.min(b, x)); }
function arrondi(x: number, d = 0): number { const p = 10 ** d; return Math.round(x * p) / p; }
function sansAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function m2(n: number): string { return `${Math.round(n).toLocaleString('fr-FR')} m²`; }

type Rep = { ok: true; data: any } | { ok: false; status?: number; erreur: string };

async function fetchJson(deps: Deps, url: string, timeoutMs: number): Promise<Rep> {
  if (timeoutMs < 300) return { ok: false, erreur: 'budget temps épuisé' };
  try {
    const r = await deps.fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { ok: false, status: r.status, erreur: `HTTP ${r.status}` };
    return { ok: true, data: await r.json() };
  } catch (e) {
    const nom = e instanceof Error ? e.name : '';
    return { ok: false, erreur: nom === 'TimeoutError' || nom === 'AbortError' ? 'délai dépassé' : (e instanceof Error ? e.message : String(e)) };
  }
}

/** Exécute fn sur chaque élément, `n` à la fois ; ne lance plus rien après `stopApres()`. */
async function enParallele<T, R>(elements: T[], n: number, stop: () => boolean, fn: (x: T, i: number) => Promise<R>): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(elements.length);
  let i = 0;
  const ouvriers = Array.from({ length: Math.min(n, elements.length) }, async () => {
    while (i < elements.length && !stop()) {
      const k = i++;
      out[k] = await fn(elements[k], k);
    }
  });
  await Promise.all(ouvriers);
  return out;
}

// ─── Géométrie (petites surfaces : projection locale équirectangulaire) ─────
export function polysDe(geom: any): Poly[] {
  if (!geom) return [];
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) return [geom.coordinates];
  if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) return geom.coordinates;
  return [];
}
function facteurs(lat0: number): [number, number] {
  return [111320 * Math.cos((lat0 * Math.PI) / 180), 110574];
}
function aireAnneau(r: Anneau, kx: number, ky: number): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    a += (r[j][0] * kx) * (r[i][1] * ky) - (r[i][0] * kx) * (r[j][1] * ky);
  }
  return Math.abs(a) / 2;
}
function perimetreAnneau(r: Anneau, kx: number, ky: number): number {
  let p = 0;
  for (let i = 1; i < r.length; i++) {
    p += Math.hypot((r[i][0] - r[i - 1][0]) * kx, (r[i][1] - r[i - 1][1]) * ky);
  }
  return p;
}
/** Aire (m², trous déduits) et périmètre extérieur (m). */
export function mesurer(polys: Poly[]): { aire: number; perimetre: number } {
  const premier = polys[0]?.[0]?.[0];
  if (!premier) return { aire: 0, perimetre: 0 };
  const [kx, ky] = facteurs(premier[1]);
  let aire = 0, perimetre = 0;
  for (const p of polys) {
    if (!p[0] || p[0].length < 4) continue;
    aire += aireAnneau(p[0], kx, ky);
    for (let h = 1; h < p.length; h++) aire -= aireAnneau(p[h], kx, ky);
    perimetre += perimetreAnneau(p[0], kx, ky);
  }
  return { aire: Math.max(0, aire), perimetre };
}
/** Compacité de Polsby-Popper : 4π·A/P² (1 = disque, ≈ 0,785 = carré). */
export function compacite(polys: Poly[]): number {
  const { aire, perimetre } = mesurer(polys);
  return perimetre > 0 ? clamp((4 * Math.PI * aire) / (perimetre * perimetre), 0, 1) : 0;
}
/** Centroïde surfacique de l'anneau extérieur du plus grand polygone. */
export function centroide(polys: Poly[]): [number, number] | null {
  let meilleur: Anneau | null = null, aireMax = -1;
  for (const p of polys) {
    const r = p[0];
    if (!Array.isArray(r) || r.length < 3) continue;
    const a = aireAnneau(r, 1, 1);
    if (a > aireMax) { aireMax = a; meilleur = r; }
  }
  if (!meilleur) return null;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = meilleur.length - 1; i < meilleur.length; j = i++) {
    const f = meilleur[j][0] * meilleur[i][1] - meilleur[i][0] * meilleur[j][1];
    a += f; cx += (meilleur[j][0] + meilleur[i][0]) * f; cy += (meilleur[j][1] + meilleur[i][1]) * f;
  }
  if (Math.abs(a) < 1e-14) {
    let sx = 0, sy = 0;
    for (const c of meilleur) { sx += c[0]; sy += c[1]; }
    return [sx / meilleur.length, sy / meilleur.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}
export function emprise(polys: Poly[]): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of polys) for (const r of p) for (const pt of r) {
    if (pt[0] < a) a = pt[0]; if (pt[1] < b) b = pt[1];
    if (pt[0] > c) c = pt[0]; if (pt[1] > d) d = pt[1];
  }
  return [a, b, c, d];
}
function dansAnneau(x: number, y: number, r: Anneau): boolean {
  let dedans = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}
export function pointDansPolys(pt: [number, number], polys: Poly[]): boolean {
  for (const p of polys) {
    if (!p[0] || !dansAnneau(pt[0], pt[1], p[0])) continue;
    let dansTrou = false;
    for (let h = 1; h < p.length; h++) if (dansAnneau(pt[0], pt[1], p[h])) { dansTrou = true; break; }
    if (!dansTrou) return true;
  }
  return false;
}
function distanceM(a: [number, number], b: [number, number]): number {
  const [kx, ky] = facteurs((a[1] + b[1]) / 2);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * ky);
}
function rectanglePolygon(b: number[]): { type: 'Polygon'; coordinates: number[][][] } {
  const [x1, y1, x2, y2] = b;
  return { type: 'Polygon', coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]] };
}

// ─── Normalisation d'une parcelle (Etalab ou API Carto) ─────────────────────
export function normaliserParcelle(f: any): Parcelle | null {
  const p = f?.properties ?? {};
  const polys = polysDe(f?.geometry);
  if (!polys.length) return null;

  let idu = txt(p.idu) ?? txt(p.id);
  const section = txt(p.section);
  const numero = txt(p.numero);
  if (!idu || idu.length !== 14) {
    // API Carto sans idu : code_dep(2) + code_com(3) + com_abs(3) + section(2) + numero(4)
    const dep = txt(p.code_dep), com = txt(p.code_com);
    if (!dep || !com || !section || !numero) return null;
    idu = `${dep}${com}`.slice(0, 5).padEnd(5, '0') + (txt(p.com_abs) ?? '000').padStart(3, '0') +
      section.padStart(2, '0') + numero.padStart(4, '0');
  }
  idu = idu.toUpperCase();
  if (!/^(\d{5}|2[AB]\d{3})[0-9A-Z]{9}$/.test(idu)) return null;

  const c = centroide(polys);
  if (!c) return null;
  const contenance = num(p.contenance);
  const { aire } = mesurer(polys);
  const avecContenance = contenance !== null && contenance > 0;
  return {
    idu,
    code_insee: idu.slice(0, 5),
    commune: txt(p.nom_com),
    section: (section ?? idu.slice(8, 10)).toUpperCase(),
    numero: (numero ?? idu.slice(10, 14)).padStart(4, '0'),
    surface_m2: avecContenance ? Math.round(contenance as number) : Math.round(aire),
    surface_source: avecContenance ? 'contenance_cadastrale' : 'calculee_geometrie',
    compacite: arrondi(compacite(polys), 3),
    centroide: [arrondi(c[0], 7), arrondi(c[1], 7)],
    emprise: emprise(polys),
    polys,
  };
}

// ─── Score ───────────────────────────────────────────────────────────────────
export function pointsZone(typeZone: string | null, statut: Item['zonage_statut']): number {
  if (statut !== 'lu' || !typeZone) return 15;
  const t = typeZone.toUpperCase();
  if (t === 'U') return 40;
  if (t === 'AUC') return 30;
  if (t === 'AU') return 25;
  if (t === 'AUS') return 10;
  if (t.startsWith('AU')) return 25;
  if (t === 'A' || t === 'N') return 0;
  return 15;
}
export function pointsSurface(s: number): number {
  return 30 * clamp(Math.log10(Math.max(s, 1) / 100) / Math.log10(50), 0, 1);
}
export function pointsForme(c: number): number {
  return 30 * clamp(c / 0.785, 0, 1);
}
export function comparer(a: { score_tri: number; surface_m2: number; idu: string }, b: { score_tri: number; surface_m2: number; idu: string }): number {
  if (b.score_tri !== a.score_tri) return b.score_tri - a.score_tri;
  if (b.surface_m2 !== a.surface_m2) return b.surface_m2 - a.surface_m2;
  return a.idu < b.idu ? -1 : a.idu > b.idu ? 1 : 0;
}

/** Une zone correspond-elle au filtre ? 'U','AU','A','N' visent le TYPE ; sinon le code PLU (préfixe, insensible à la casse). */
export function zoneCorrespond(z: Zone, filtres: string[]): boolean {
  const type = (z.type_zone ?? '').toUpperCase();
  const code = (z.zonage_plu ?? '').toUpperCase().replace(/\s+/g, '');
  for (const brut of filtres) {
    const f = brut.toUpperCase().replace(/\s+/g, '');
    if (!f) continue;
    if (f === 'U' && type === 'U') return true;
    if (f === 'AU' && (type === 'AU' || type === 'AUC' || type === 'AUS')) return true;
    if ((f === 'AUC' || f === 'AUS') && type === f) return true;
    if (f === 'A' && type === 'A') return true;
    if (f === 'N' && type === 'N') return true;
    if (!['U', 'AU', 'AUC', 'AUS', 'A', 'N'].includes(f) && code && code.startsWith(f)) return true;
  }
  return false;
}

// ─── Étape 1 : périmètre ─────────────────────────────────────────────────────
type Perimetre =
  | { mode: 'commune'; code_insee: string; commune: string | null }
  | { mode: 'bbox'; bbox: number[] }
  | { mode: 'cercle'; centre: [number, number]; rayon_m: number; bbox: number[] };

const COMMUNES_A_ARRONDISSEMENTS: Record<string, string> = {
  '75056': 'Paris (75101 à 75120)',
  '69123': 'Lyon (69381 à 69389)',
  '13055': 'Marseille (13201 à 13216)',
};

async function resoudrePerimetre(e: Entree, deps: Deps, fin: () => number):
  Promise<{ ok: true; p: Perimetre; avert: string[] } | { ok: false; summary: string; stats?: Record<string, unknown> }> {
  const avert: string[] = [];
  const insee = txt(e.code_insee)?.toUpperCase() ?? null;

  if (insee) {
    if (!/^(\d{5}|2[AB]\d{3})$/.test(insee)) return { ok: false, summary: `Code INSEE invalide : « ${insee} » (5 caractères attendus).` };
    if (COMMUNES_A_ARRONDISSEMENTS[insee]) {
      return { ok: false, summary: `Le cadastre de ${COMMUNES_A_ARRONDISSEMENTS[insee].split(' ')[0]} est découpé par arrondissement : indique le code INSEE de l'arrondissement ${COMMUNES_A_ARRONDISSEMENTS[insee].slice(COMMUNES_A_ARRONDISSEMENTS[insee].indexOf('('))}.` };
    }
    const r = await fetchJson(deps, `${URLS.geoApi}/${insee}?fields=nom,code`, Math.min(REGLAGES.GEO_TIMEOUT_MS, fin()));
    const nom = r.ok ? txt(r.data?.nom) : null;
    if (!r.ok) avert.push("Nom de la commune non résolu (geo.api.gouv.fr injoignable) : seul le code INSEE est affiché.");
    return { ok: true, p: { mode: 'commune', code_insee: insee, commune: nom }, avert };
  }

  const nomCommune = txt(e.commune);
  if (nomCommune) {
    const cp = txt(e.cp) ?? txt(e.code_postal);
    const q = `nom=${encodeURIComponent(nomCommune)}${cp ? `&codePostal=${encodeURIComponent(cp)}` : ''}&fields=nom,code,codesPostaux&boost=population&limit=10`;
    const r = await fetchJson(deps, `${URLS.geoApi}?${q}`, Math.min(REGLAGES.GEO_TIMEOUT_MS, fin()));
    if (!r.ok) return { ok: false, summary: `Impossible de résoudre la commune « ${nomCommune} » (geo.api.gouv.fr : ${r.erreur}). Donne le code INSEE.` };
    const liste: any[] = Array.isArray(r.data) ? r.data : [];
    const exacts = liste.filter((c) => sansAccents(String(c?.nom ?? '')) === sansAccents(nomCommune));
    const retenus = exacts.length ? exacts : liste;
    if (retenus.length === 0) return { ok: false, summary: `Commune « ${nomCommune}${cp ? ` (${cp})` : ''} » introuvable dans le référentiel officiel.` };
    if (retenus.length > 1) {
      return {
        ok: false,
        summary: `« ${nomCommune} » est ambigu (${retenus.length} communes). Précise le code postal ou le code INSEE.`,
        stats: { communes_possibles: retenus.slice(0, 8).map((c) => ({ nom: c.nom, code_insee: c.code, codes_postaux: c.codesPostaux })) },
      };
    }
    const code = String(retenus[0].code);
    if (COMMUNES_A_ARRONDISSEMENTS[code]) {
      return { ok: false, summary: `Le cadastre de ${retenus[0].nom} est découpé par arrondissement : indique le code INSEE de l'arrondissement ${COMMUNES_A_ARRONDISSEMENTS[code].slice(COMMUNES_A_ARRONDISSEMENTS[code].indexOf('('))}.` };
    }
    return { ok: true, p: { mode: 'commune', code_insee: code, commune: txt(retenus[0].nom) }, avert };
  }

  if (Array.isArray(e.bbox) && e.bbox.length === 4 && e.bbox.every((v) => num(v) !== null)) {
    const [x1, y1, x2, y2] = e.bbox.map(Number);
    const b = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    if (b[0] < -180 || b[2] > 180 || b[1] < -90 || b[3] > 90) return { ok: false, summary: 'bbox hors limites : [minLon, minLat, maxLon, maxLat] en degrés WGS84.' };
    const [kx, ky] = facteurs((b[1] + b[3]) / 2);
    const km2 = ((b[2] - b[0]) * kx * (b[3] - b[1]) * ky) / 1e6;
    if (km2 > REGLAGES.BBOX_MAX_KM2) return { ok: false, summary: `Rectangle trop grand (${arrondi(km2, 1)} km², maximum ${REGLAGES.BBOX_MAX_KM2} km²). Restreins-le ou cherche par commune.` };
    return { ok: true, p: { mode: 'bbox', bbox: b }, avert };
  }

  if (Array.isArray(e.centre) && e.centre.length === 2 && e.centre.every((v) => num(v) !== null)) {
    const lon = Number(e.centre[0]), lat = Number(e.centre[1]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false, summary: 'centre invalide : [lon, lat] en degrés WGS84.' };
    let rayon = num(e.rayon_m) ?? 500;
    if (rayon > REGLAGES.RAYON_MAX_M) { avert.push(`Rayon ramené de ${rayon} m à ${REGLAGES.RAYON_MAX_M} m (maximum).`); rayon = REGLAGES.RAYON_MAX_M; }
    rayon = Math.max(50, rayon);
    const [kx, ky] = facteurs(lat);
    const dx = rayon / kx, dy = rayon / ky;
    return { ok: true, p: { mode: 'cercle', centre: [lon, lat], rayon_m: rayon, bbox: [lon - dx, lat - dy, lon + dx, lat + dy] }, avert };
  }

  return { ok: false, summary: 'Périmètre manquant : donne code_insee, ou commune (+ cp), ou bbox [minLon,minLat,maxLon,maxLat], ou centre [lon,lat] + rayon_m.' };
}

// ─── Étape 2 : lecture du cadastre ───────────────────────────────────────────
interface LectureCadastre {
  features: any[];
  source: string;
  complete: boolean;
  erreur?: string;
}

async function paginerApiCarto(base: string, deps: Deps, finCadastre: () => number): Promise<LectureCadastre> {
  const features: any[] = [];
  let page = 0, termine = false, erreur: string | undefined;
  while (!termine && page < REGLAGES.APICARTO_MAX_PAGES && finCadastre() > 500) {
    const vague = Array.from({ length: Math.min(REGLAGES.APICARTO_VAGUE, REGLAGES.APICARTO_MAX_PAGES - page) }, (_, k) => page + k);
    const reps = await Promise.all(vague.map((p) =>
      fetchJson(deps, `${base}&_limit=${REGLAGES.APICARTO_PAGE}&_start=${p * REGLAGES.APICARTO_PAGE}`, Math.min(REGLAGES.APICARTO_TIMEOUT_MS, finCadastre()))));
    for (const r of reps) {
      if (!r.ok) { erreur = r.erreur; termine = true; break; }
      const lot: any[] = Array.isArray(r.data?.features) ? r.data.features : [];
      features.push(...lot);
      if (lot.length < REGLAGES.APICARTO_PAGE) { termine = true; break; }
    }
    page += vague.length;
  }
  const complete = termine && !erreur;
  return { features, source: 'API Carto IGN — cadastre (PCI)', complete, erreur: erreur ?? (complete ? undefined : 'pagination interrompue (temps ou plafond)') };
}

async function lireCadastre(p: Perimetre, deps: Deps, finCadastre: () => number): Promise<LectureCadastre> {
  if (p.mode === 'commune') {
    const r = await fetchJson(deps, URLS.etalab(p.code_insee), Math.min(REGLAGES.ETALAB_TIMEOUT_MS, finCadastre()));
    if (r.ok && Array.isArray(r.data?.features) && r.data.features.length > 0) {
      return { features: r.data.features, source: 'Cadastre Etalab (cadastre.data.gouv.fr)', complete: true };
    }
    const repli = await paginerApiCarto(`${URLS.apicartoCadastre}?code_insee=${p.code_insee}`, deps, finCadastre);
    if (!r.ok && repli.features.length === 0) repli.erreur = `Etalab : ${r.erreur} ; API Carto : ${repli.erreur ?? 'aucune parcelle'}`;
    return repli;
  }
  const geom = encodeURIComponent(JSON.stringify(rectanglePolygon(p.bbox)));
  return await paginerApiCarto(`${URLS.apicartoCadastre}?geom=${geom}`, deps, finCadastre);
}

// ─── Étape 3 : zonage GPU ────────────────────────────────────────────────────
interface ZoneGeo { zone: Zone; polys: Poly[]; emprise: [number, number, number, number] }

function zoneDeProps(props: any): Zone {
  const p = reparerEncodageProfond(props ?? {});
  return {
    type_zone: txt(p.typezone),
    zonage_plu: txt(p.libelle),
    libelle_zone: txt(p.libelong),
    document: txt(p.idurba),
  };
}

interface ResultatZonage {
  parIdu: Map<string, Zone | null>;     // null = interrogé, aucune zone publiée au point
  methode: 'rectangle' | 'points' | 'aucune';
  commune_rnu: boolean | null;
  erreur?: string;
}

async function zoner(cands: Parcelle[], deps: Deps, fin: () => number): Promise<ResultatZonage> {
  const parIdu = new Map<string, Zone | null>();
  if (!cands.length) return { parIdu, methode: 'aucune', commune_rnu: null };

  // a) un seul appel sur le rectangle englobant
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of cands) {
    b = [Math.min(b[0], c.centroide[0]), Math.min(b[1], c.centroide[1]), Math.max(b[2], c.centroide[0]), Math.max(b[3], c.centroide[1])];
  }
  const marge = 0.0005;
  const rect = rectanglePolygon([b[0] - marge, b[1] - marge, b[2] + marge, b[3] + marge]);
  const r = await fetchJson(deps, `${URLS.apicartoGpu}/zone-urba?geom=${encodeURIComponent(JSON.stringify(rect))}`,
    Math.min(REGLAGES.GPU_BBOX_TIMEOUT_MS, fin() - 3000));

  if (r.ok && Array.isArray(r.data?.features)) {
    const zones: ZoneGeo[] = [];
    for (const f of r.data.features) {
      const polys = polysDe(f?.geometry);
      if (polys.length) zones.push({ zone: zoneDeProps(f?.properties), polys, emprise: emprise(polys) });
    }
    // ordre déterministe en cas de recouvrement : code PLU puis document
    zones.sort((x, y) => `${x.zone.zonage_plu}|${x.zone.document}`.localeCompare(`${y.zone.zonage_plu}|${y.zone.document}`));
    let communeRnu: boolean | null = null;
    if (zones.length === 0) {
      const c = cands[0].centroide;
      const m = await fetchJson(deps, `${URLS.apicartoGpu}/municipality?geom=${encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: c }))}`,
        Math.min(REGLAGES.GPU_POINT_TIMEOUT_MS, fin() - 2000));
      if (m.ok) communeRnu = m.data?.features?.[0]?.properties?.is_rnu === true;
    }
    for (const c of cands) {
      const [x, y] = c.centroide;
      const z = zones.find((zg) => x >= zg.emprise[0] && x <= zg.emprise[2] && y >= zg.emprise[1] && y <= zg.emprise[3] && pointDansPolys(c.centroide, zg.polys));
      parIdu.set(c.idu, z ? z.zone : null);
    }
    return { parIdu, methode: 'rectangle', commune_rnu: communeRnu };
  }

  // b) repli : un appel par point, plafonné
  const cibles = cands.slice(0, REGLAGES.GPU_POINT_MAX);
  let echecs = 0;
  await enParallele(cibles, REGLAGES.PARALLELE, () => fin() < 3000, async (c) => {
    const g = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: c.centroide }));
    const rp = await fetchJson(deps, `${URLS.apicartoGpu}/zone-urba?geom=${g}`, Math.min(REGLAGES.GPU_POINT_TIMEOUT_MS, fin() - 2000));
    if (!rp.ok) { echecs++; return; }
    const feats: any[] = Array.isArray(rp.data?.features) ? rp.data.features : [];
    const zs = feats.map((f) => zoneDeProps(f?.properties))
      .sort((x, y) => `${x.zonage_plu}|${x.document}`.localeCompare(`${y.zonage_plu}|${y.document}`));
    parIdu.set(c.idu, zs[0] ?? null);
  });
  const lu = parIdu.size > 0;
  return {
    parIdu,
    methode: lu ? 'points' : 'aucune',
    commune_rnu: null,
    erreur: `appel GPU sur le rectangle : ${r.ok ? 'réponse illisible' : r.erreur}${echecs ? ` ; ${echecs} point(s) en échec` : ''}`,
  };
}

// ─── Étape 4 : bâti BD TOPO (WFS Géoplateforme) ──────────────────────────────
interface Bati { detecte: boolean; emprise_m2: number; nb: number }

async function batiDe(c: Parcelle, deps: Deps, fin: () => number): Promise<Bati | null> {
  const [x1, y1, x2, y2] = c.emprise;
  // WFS 2.0 + EPSG:4326 en URN : ordre des axes lat,lon dans BBOX ; la géométrie GeoJSON revient en lon,lat.
  const bbox = `${y1},${x1},${y2},${x2},urn:ogc:def:crs:EPSG::4326`;
  const url = `${URLS.wfsGeopf}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment` +
    `&BBOX=${encodeURIComponent(bbox)}&COUNT=200&outputFormat=application/json`;
  const r = await fetchJson(deps, url, Math.min(REGLAGES.BATI_TIMEOUT_MS, fin() - 500));
  if (!r.ok || !Array.isArray(r.data?.features)) return null;
  let nb = 0, aire = 0;
  for (const f of r.data.features) {
    if (f?.properties?.construction_legere === true) continue;   // abris, auvents : ignorés
    const polys = polysDe(f?.geometry);
    const cb = centroide(polys.map((p) => p.map((an) => an.map((pt) => [pt[0], pt[1]]))));
    if (!cb || !pointDansPolys(cb, c.polys)) continue;
    nb++;
    aire += mesurer(polys).aire;
  }
  return { detecte: nb > 0, emprise_m2: Math.round(aire), nb };
}

// ─── Orchestration ───────────────────────────────────────────────────────────
export async function rechercherParcelles(entree: Entree, deps: Deps): Promise<Sortie> {
  const maintenant = deps.maintenant ?? (() => Date.now());
  const t0 = maintenant();
  const fin = () => REGLAGES.BUDGET_MS - (maintenant() - t0);
  const finCadastre = () => REGLAGES.CADASTRE_BUDGET_MS - (maintenant() - t0);
  const avert: string[] = [];
  const sources: string[] = [];
  const e: Entree = entree && typeof entree === 'object' ? entree : {};

  const sMin = num(e.surface_min_m2);
  const sMax = num(e.surface_max_m2);
  if (sMin !== null && sMax !== null && sMin > sMax) {
    return { status: 'error', summary: `surface_min_m2 (${sMin}) supérieure à surface_max_m2 (${sMax}).`, stats: {}, items: [], avertissements: [], sources: [] };
  }
  const limite = Math.trunc(clamp(num(e.limite) ?? REGLAGES.LIMITE_DEFAUT, 1, REGLAGES.LIMITE_MAX));
  const filtresZone = Array.isArray(e.zonages) ? e.zonages.map((z) => String(z).trim()).filter(Boolean).slice(0, 20) : [];
  const exclureBati = e.exclure_bati === true;

  // 1) périmètre
  const per = await resoudrePerimetre(e, deps, fin);
  if (!per.ok) return { status: 'error', summary: per.summary, stats: per.stats ?? {}, items: [], avertissements: [], sources: [] };
  avert.push(...per.avert);
  const p = per.p;

  // 2) cadastre
  const lecture = await lireCadastre(p, deps, finCadastre);
  sources.push(lecture.source);
  if (lecture.features.length === 0) {
    const cause = lecture.erreur ?? 'aucune parcelle';
    const injoignable = !!lecture.erreur && !/aucune parcelle/.test(lecture.erreur);
    return {
      status: injoignable ? 'error' : 'no_data',
      summary: injoignable
        ? `Cadastre injoignable (${cause}) : aucune parcelle n'a pu être lue. Ne conclus rien sur ce secteur.`
        : 'Aucune parcelle cadastrale dans ce périmètre.',
      stats: { perimetre: p }, items: [], avertissements: avert, sources,
    };
  }
  if (!lecture.complete) {
    avert.push(`Lecture du cadastre PARTIELLE (${lecture.features.length} parcelles lues : ${lecture.erreur}). D'autres parcelles du secteur n'ont pas été examinées.`);
  }

  let parcelles: Parcelle[] = [];
  let illisibles = 0;
  const vues = new Set<string>();
  for (const f of lecture.features) {
    const pa = normaliserParcelle(f);
    if (!pa) { illisibles++; continue; }
    if (vues.has(pa.idu)) continue;
    vues.add(pa.idu);
    if (p.mode === 'commune') { pa.commune = pa.commune ?? p.commune; }
    parcelles.push(pa);
  }
  lecture.features.length = 0;   // libère la mémoire des géométries brutes
  const lues = parcelles.length;
  if (p.mode === 'cercle') parcelles = parcelles.filter((x) => distanceM(x.centroide, p.centre) <= p.rayon_m);
  if (p.mode === 'bbox') parcelles = parcelles.filter((x) =>
    x.centroide[0] >= p.bbox[0] && x.centroide[0] <= p.bbox[2] && x.centroide[1] >= p.bbox[1] && x.centroide[1] <= p.bbox[3]);
  const dansPerimetre = parcelles.length;

  // 3) filtre surface (en mémoire, avant tout appel réseau supplémentaire)
  parcelles = parcelles.filter((x) => (sMin === null || x.surface_m2 >= sMin) && (sMax === null || x.surface_m2 <= sMax));
  const apresSurface = parcelles.length;

  // 4) pré-tri sans zonage puis zonage des meilleures
  const pre = parcelles.map((x) => ({ x, score_tri: pointsSurface(x.surface_m2) + pointsForme(x.compacite), surface_m2: x.surface_m2, idu: x.idu }));
  pre.sort(comparer);
  const aZoner = pre.slice(0, REGLAGES.MAX_CANDIDATS_ZONAGE).map((y) => y.x);
  if (pre.length > aZoner.length) {
    avert.push(`${pre.length - aZoner.length} parcelle(s) de la surface cible écartée(s) avant zonage (plafond ${REGLAGES.MAX_CANDIDATS_ZONAGE}, on garde les plus grandes et les plus compactes). Resserre la surface ou le périmètre pour les examiner.`);
  }
  const zonage = aZoner.length && fin() > 4000
    ? await zoner(aZoner, deps, fin)
    : { parIdu: new Map<string, Zone | null>(), methode: 'aucune' as const, commune_rnu: null, erreur: aZoner.length ? 'budget temps épuisé' : undefined };
  if (zonage.methode !== 'aucune') sources.push("Géoportail de l'urbanisme via API Carto (IGN) — zone-urba");
  if (zonage.erreur) avert.push(`Zonage : ${zonage.erreur}.`);
  if (zonage.methode === 'points' && aZoner.length > REGLAGES.GPU_POINT_MAX) {
    avert.push(`Zonage lu point par point sur les ${REGLAGES.GPU_POINT_MAX} meilleures candidates seulement ; les autres sont « non_verifie ».`);
  }
  const nbZonesLues = [...zonage.parIdu.values()].filter((z) => z).length;
  if (zonage.methode === 'rectangle' && nbZonesLues === 0) {
    avert.push(zonage.commune_rnu === true
      ? "Commune au RÈGLEMENT NATIONAL D'URBANISME (pas de PLU) : aucun zonage, constructibilité limitée en principe aux parties urbanisées."
      : "Aucun zonage publié au Géoportail de l'urbanisme sur ce secteur : zonage_plu = null. Ce n'est pas une preuve d'absence de PLU — vérifier en mairie.");
  }

  let candidats: Item[] = aZoner.map((x) => {
    const lu = zonage.parIdu.has(x.idu);
    const z = lu ? zonage.parIdu.get(x.idu) ?? null : null;
    const statut: Item['zonage_statut'] = !lu ? 'non_verifie' : z ? 'lu' : 'hors_zone_publiee';
    const ps = pointsSurface(x.surface_m2), pf = pointsForme(x.compacite), pz = pointsZone(z?.type_zone ?? null, statut);
    const raisons: string[] = [];
    if (statut === 'lu') raisons.push(`zone ${z!.zonage_plu ?? '?'} (type ${z!.type_zone ?? '?'}) lue au centroïde — ${pz} pts`);
    else if (statut === 'hors_zone_publiee') raisons.push(`aucune zone PLU publiée au centroïde — ${pz} pts`);
    else raisons.push(`zonage non vérifié (plafond ou temps) — ${pz} pts`);
    raisons.push(`surface ${m2(x.surface_m2)}${x.surface_source === 'calculee_geometrie' ? ' (calculée sur la géométrie, contenance absente)' : ''}` +
      `${sMin !== null || sMax !== null ? ` dans la cible ${sMin !== null ? m2(sMin) : '0'}–${sMax !== null ? m2(sMax) : '∞'}` : ''} — ${arrondi(ps, 1)} pts`);
    raisons.push(`${x.compacite >= 0.6 ? 'forme compacte' : x.compacite >= 0.35 ? 'forme moyennement compacte' : 'forme étirée ou irrégulière'} (indice ${x.compacite.toFixed(2)}) — ${arrondi(pf, 1)} pts`);
    return {
      idu: x.idu, commune: x.commune, code_insee: x.code_insee, section: x.section, numero: x.numero,
      surface_m2: x.surface_m2, surface_source: x.surface_source,
      zonage_plu: z?.zonage_plu ?? null, type_zone: z?.type_zone ?? null, libelle_zone: z?.libelle_zone ?? null,
      zonage_statut: statut, centroide: x.centroide, compacite: x.compacite,
      bati_detecte: null, emprise_batie_m2: null,
      score_tri: arrondi(pz + ps + pf, 1), raisons,
    };
  });

  // 5) filtre zonage (seules les parcelles dont la zone a été LUE peuvent passer)
  let exclusZonageNonLu = 0, exclusZonageAutre = 0;
  if (filtresZone.length) {
    candidats = candidats.filter((it) => {
      if (it.zonage_statut !== 'lu') { exclusZonageNonLu++; return false; }
      const ok = zoneCorrespond({ type_zone: it.type_zone, zonage_plu: it.zonage_plu, libelle_zone: null, document: null }, filtresZone);
      if (!ok) exclusZonageAutre++;
      return ok;
    });
    if (exclusZonageNonLu) avert.push(`${exclusZonageNonLu} parcelle(s) écartée(s) faute de zonage lu (filtre zonages demandé : on n'affirme pas une zone non vérifiée).`);
  }
  candidats.sort(comparer);

  // 6) bâti sur les meilleures, jusqu'à remplir la limite
  const parcelleParIdu = new Map(aZoner.map((x) => [x.idu, x]));
  const retenus: Item[] = [];
  let batiVerifies = 0, batiAvec = 0, batiExclus = 0, batiEchecs = 0;
  const aExaminer = candidats.slice(0, exclureBati ? REGLAGES.BATI_MAX : Math.min(limite, REGLAGES.BATI_MAX));
  if (aExaminer.length && fin() > 2500) {
    const resultats = await enParallele(aExaminer, REGLAGES.PARALLELE,
      () => fin() < 2000 || (exclureBati && retenus.length >= limite), async (it) => {
        const b = await batiDe(parcelleParIdu.get(it.idu)!, deps, fin);
        if (!b) { batiEchecs++; return null; }
        batiVerifies++;
        it.bati_detecte = b.detecte;
        it.emprise_batie_m2 = b.emprise_m2;
        it.raisons.push(b.detecte
          ? `${b.nb} bâtiment(s) BD TOPO dont le centre est sur la parcelle (emprise ≈ ${m2(b.emprise_m2)})`
          : 'aucun bâtiment BD TOPO détecté sur la parcelle');
        if (b.detecte) batiAvec++;
        if (!(exclureBati && b.detecte)) retenus.push(it);
        return b;
      });
    void resultats;
  }
  if (batiVerifies > 0) sources.push('BD TOPO V3 (IGN) — WFS data.geopf.fr, couche batiment');
  let items: Item[];
  if (exclureBati) {
    batiExclus = aExaminer.filter((it) => it.bati_detecte === true).length;
    if (batiVerifies === 0) {
      avert.push("Source bâti (BD TOPO, WFS data.geopf.fr) injoignable : le filtre « exclure_bati » N'A PAS été appliqué, bati_detecte = null.");
      items = candidats.slice(0, limite);
    } else {
      // garde l'ordre du tri ; une parcelle non vérifiée reste candidate mais signalée
      items = candidats.filter((it) => it.bati_detecte !== true).slice(0, limite);
      const nonVerifs = items.filter((it) => it.bati_detecte === null);
      for (const it of nonVerifs) it.raisons.push('bâti non vérifié (plafond, temps ou source en échec)');
      if (nonVerifs.length) avert.push(`${nonVerifs.length} parcelle(s) retenue(s) sans vérification du bâti.`);
    }
  } else {
    items = candidats.slice(0, limite);
    if (batiEchecs && batiVerifies === 0) avert.push('Source bâti (BD TOPO) injoignable : bati_detecte = null.');
  }
  items.sort(comparer);

  // 7) restitution
  const nbParType: Record<string, number> = {};
  for (const it of candidats) {
    const k = it.zonage_statut === 'lu' ? (it.type_zone ?? '?') : it.zonage_statut;
    nbParType[k] = (nbParType[k] ?? 0) + 1;
  }
  const lieu = p.mode === 'commune'
    ? `${p.commune ?? 'commune'} (${p.code_insee})`
    : p.mode === 'cercle' ? `un rayon de ${p.rayon_m} m` : 'le rectangle demandé';
  const status: Sortie['status'] = items.length ? 'ok' : 'no_data';
  const tete = items.slice(0, 3).map((it) =>
    `${it.idu} (${m2(it.surface_m2)}, ${it.zonage_plu ? `zone ${it.zonage_plu}` : 'zonage inconnu'}${it.bati_detecte === false ? ', sans bâti' : it.bati_detecte ? ', bâti' : ''})`).join(' ; ');
  const summary = status === 'ok'
    ? `${items.length} parcelle(s) candidate(s) sur ${lieu} : ${lues} lues, ${apresSurface} dans la surface cible` +
      `${filtresZone.length ? `, ${candidats.length} dans les zonages ${filtresZone.join('/')}` : ''}` +
      `${exclureBati && batiVerifies ? `, ${batiExclus} écartée(s) car bâties` : ''}. Meilleures : ${tete}. ` +
      `Le zonage est lu au centroïde (une parcelle à cheval sur deux zones n'est pas détectée) ; c'est une constructibilité de PRINCIPE, à confirmer au règlement.`
    : `Aucune parcelle ne remplit les critères sur ${lieu} (${lues} lues, ${apresSurface} dans la surface cible` +
      `${filtresZone.length ? `, 0 dans les zonages ${filtresZone.join('/')}` : ''}). Élargis la surface, le zonage ou le périmètre.`;

  return {
    status,
    summary,
    stats: {
      perimetre: p.mode === 'commune' ? { mode: p.mode, code_insee: p.code_insee, commune: p.commune }
        : p.mode === 'cercle' ? { mode: p.mode, centre: p.centre, rayon_m: p.rayon_m } : { mode: p.mode, bbox: p.bbox },
      parcelles_lues: lues,
      parcelles_illisibles: illisibles,
      dans_perimetre: dansPerimetre,
      source_cadastre: lecture.source,
      couverture_cadastre: lecture.complete ? 'complete' : 'partielle',
      apres_filtre_surface: apresSurface,
      zonage: {
        methode: zonage.methode,
        examinees: aZoner.length,
        lues: nbZonesLues,
        hors_zone_publiee: [...zonage.parIdu.values()].filter((z) => z === null).length,
        non_verifiees: aZoner.length - zonage.parIdu.size,
        commune_rnu: zonage.commune_rnu,
        repartition: nbParType,
      },
      apres_filtre_zonage: candidats.length,
      exclues_zonage_non_lu: exclusZonageNonLu,
      exclues_autre_zonage: exclusZonageAutre,
      bati: { verifiees: batiVerifies, avec_bati: batiAvec, exclues: batiExclus, echecs: batiEchecs, filtre_applique: exclureBati && batiVerifies > 0 },
      retenues: items.length,
      limite,
      tri: TRI_DOC,
      duree_ms: maintenant() - t0,
    },
    items,
    avertissements: avert,
    sources,
  };
}
