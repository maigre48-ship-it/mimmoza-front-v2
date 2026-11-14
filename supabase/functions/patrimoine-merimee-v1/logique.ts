// supabase/functions/patrimoine-merimee-v1/logique.ts
// =============================================================
// LOT P11 — logique de patrimoine-merimee-v1, testable sans réseau (fetch injecté).
//
// Pourquoi ce fichier existe — panne constatée en production :
//   L'ancienne source (API Explore v2.1 Opendatasoft de data.culture.gouv.fr,
//   jeu « liste-des-immeubles-proteges-au-titre-des-monuments-historiques »)
//   ne répond plus : l'adresse est redirigée (302) vers la page d'accueil
//   https://culture.data.gouv.fr/ (HTML). `fetch` suit la redirection, reçoit
//   200 + HTML, et `res.json()` levait « Unexpected token '<', "<!doctype"… ».
//   Tous les appels réels de get_monuments_historiques échouent ainsi depuis le
//   26/09/2026 (table copilot_tool_calls).
//
// Nouvelle source (vérifiée le 14/11/2026) :
//   Jeu « Immeubles protégés au titre des Monuments Historiques » publié par le
//   Ministère de la Culture sur data.gouv.fr (id 5af120e5b595087cfabcde81,
//   licence « lov2 » = Licence Ouverte / Open Licence 2.0 d'Etalab, mise à jour
//   hebdomadaire), ressource CSV 3a52af4a-f9da-4dcc-8110-b07774dfb3bc, interrogée
//   par l'API tabulaire de data.gouv.fr (bêta) :
//     https://tabular-api.data.gouv.fr/api/resources/<id>/data/
//   Réponse : { data: [...], links: { next, ... }, meta: { page, page_size, total } }.
//   page_size maximal : 50.
//
// Recherche géographique : l'API tabulaire n'a AUCUN filtre géographique. La
// colonne `coordonnees_au_format_WGS84` est une CHAÎNE « lat,lon ». On filtre
// une BANDE de latitude par comparaison de chaînes (__greater / __less, constaté
// fonctionnel le 14/11/2026 : bande 43.4877–43.4978 → 65 lignes, dont les 14
// monuments à moins de 500 m de la cathédrale de Bayonne), puis on calcule la
// distance réelle (haversine) et on ne garde que le rayon demandé.
//   Pourquoi pas le code INSEE ? `COG_Insee_lors_de_la_protection` est le code
//   de la commune AU MOMENT DE LA PROTECTION : les monuments d'une commune
//   fusionnée gardent l'ancien code (constaté : Annecy-le-Vieux = 74011 dans la
//   base, alors que la commune actuelle est Annecy 74010). Une recherche par
//   code actuel en oublierait — et conclurait à tort « aucun monument ».
//
// Règle : une panne de la source n'est JAMAIS présentée comme « aucun monument ».
// =============================================================

export const RESSOURCE_MERIMEE_ID = '3a52af4a-f9da-4dcc-8110-b07774dfb3bc';
export const TABULAR_BASE = `https://tabular-api.data.gouv.fr/api/resources/${RESSOURCE_MERIMEE_ID}/data/`;
export const SOURCE_LIBELLE =
  "Base Mérimée — « Immeubles protégés au titre des Monuments Historiques » (Ministère de la Culture, " +
  'data.gouv.fr, Licence Ouverte 2.0), via l’API tabulaire data.gouv.fr';

export const PERIMETRE_ABF_M = 500;
/** Rayon maximal servi : au-delà, la bande de latitude d'une grande ville dépasse le plafond de pages. */
export const RAYON_MAX_M = 1000;
export const PAGE_SIZE = 50; // maximum de l'API tabulaire
export const MAX_PAGES = 30; // 1 500 lignes : la bande la plus dense mesurée (Paris, ±500 m) en compte ~674
export const PAGES_EN_PARALLELE = 6;
export const DELAI_REQUETE_MS = 8000;

/** Colonnes demandées (paramètre `columns`) : allège fortement la réponse. */
export const COLONNES = [
  'Reference',
  'Titre_editorial_de_la_notice',
  'Denomination_de_l_edifice',
  'Autre_appellation_de_l_edifice',
  'Typologie_de_la_protection',
  'Date_et_typologie_de_la_protection',
  'Adresse_forme_editoriale',
  'Commune_forme_editoriale',
  'Format_abrege_du_siecle_de_construction',
  'coordonnees_au_format_WGS84',
] as const;

export type MerimeeStatus = 'ok' | 'no_data' | 'no_localization' | 'error';
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface MerimeeInput {
  lat?: unknown;
  lon?: unknown;
  lng?: unknown;
  radius_m?: unknown;
  code_insee?: unknown;
}

export interface MonumentRow {
  reference: string | null;
  nom: string | null;
  denomination: string | null;
  protection: string | null;
  date_protection: string | null;
  adresse: string | null;
  commune: string | null;
  siecle: string | null;
  lat: number | null;
  lon: number | null;
  distance_m: number | null;
}

export interface SortieMerimee {
  status: MerimeeStatus;
  summary: string;
  stats: Record<string, unknown> | null;
  items: Record<string, unknown>[];
  erreur?: 'source_indisponible';
}

/** La source n'a pas pu être lue (HTTP non 2xx, HTML au lieu de JSON, JSON inattendu, réseau, délai). */
export class SourceIndisponible extends Error {
  constructor(motif: string) {
    super(motif);
    this.name = 'SourceIndisponible';
  }
}

export function num(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** « 43.4913114736406,-1.47691382050481 » → { lat, lon } ; null si illisible ou hors bornes. */
export function lireCoordonnees(v: unknown): { lat: number; lon: number } | null {
  if (typeof v !== 'string') return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * Bornes TEXTUELLES de la bande de latitude couvrant le disque (rayon + marge de 0,001° ≈ 111 m).
 * La comparaison de chaînes n'équivaut à la comparaison numérique que si les deux bornes ont le
 * même signe et le même nombre de chiffres avant la virgule (vrai en métropole : 41 à 51) ;
 * sinon → null, et l'appelant refuse de conclure plutôt que de risquer un oubli.
 */
export function bornesBande(lat: number, rayonM: number): { min: string; max: string } | null {
  const delta = rayonM / 111_000 + 0.001;
  const a = (lat - delta).toFixed(5);
  const b = (lat + delta).toFixed(5);
  const forme = (s: string) => `${s.startsWith('-') ? '-' : '+'}${s.replace('-', '').split('.')[0]!.length}`;
  if (forme(a) !== forme(b)) return null;
  // En négatif, l'ordre des chaînes est l'inverse de l'ordre numérique.
  return a < b ? { min: a, max: b } : { min: b, max: a };
}

function urlAvec(params: Record<string, string>): string {
  const qs = new URLSearchParams({ ...params, page_size: String(PAGE_SIZE), columns: COLONNES.join(',') });
  return `${TABULAR_BASE}?${qs.toString()}`;
}

export function urlBande(b: { min: string; max: string }, page = 1): string {
  return urlAvec({
    coordonnees_au_format_WGS84__greater: b.min,
    coordonnees_au_format_WGS84__less: b.max,
    page: String(page),
  });
}

export function urlCommune(codeInsee: string, page = 1): string {
  return urlAvec({ COG_Insee_lors_de_la_protection__exact: codeInsee, page: String(page) });
}

/** Lit UNE page de l'API tabulaire. Lève SourceIndisponible au moindre doute — jamais de crash JSON. */
export async function lirePage(
  fetcher: Fetcher,
  url: string,
  delaiMs = DELAI_REQUETE_MS,
): Promise<{ lignes: Record<string, unknown>[]; total: number }> {
  let res: Response;
  try {
    res = await fetcher(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(delaiMs) });
  } catch (e) {
    const nom = e instanceof Error ? e.name : '';
    throw new SourceIndisponible(
      nom === 'TimeoutError' || nom === 'AbortError'
        ? `délai de ${Math.round(delaiMs / 1000)} s dépassé`
        : `erreur réseau (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new SourceIndisponible(`HTTP ${res.status}`);
  }
  if (!/json/i.test(type)) {
    await res.body?.cancel().catch(() => {});
    throw new SourceIndisponible(`réponse non JSON (Content-Type « ${type || 'absent'} »)`);
  }
  let corps: unknown;
  try {
    corps = await res.json();
  } catch {
    throw new SourceIndisponible('réponse JSON illisible');
  }
  const c = corps as { data?: unknown; meta?: { total?: unknown } } | null;
  if (!c || typeof c !== 'object' || !Array.isArray(c.data)) {
    throw new SourceIndisponible('format de réponse inattendu (pas de tableau « data »)');
  }
  const total = num(c.meta?.total);
  return {
    lignes: c.data.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object'),
    total: total ?? c.data.length,
  };
}

/** Lit toutes les pages d'une requête (pages 2+ en parallèle, par paquets), dans la limite de MAX_PAGES. */
export async function lireToutesPages(
  fetcher: Fetcher,
  urlPage: (page: number) => string,
  maxPages = MAX_PAGES,
): Promise<{ lignes: Record<string, unknown>[]; total: number; tronque: boolean }> {
  const p1 = await lirePage(fetcher, urlPage(1));
  const nbPages = Math.max(1, Math.ceil(p1.total / PAGE_SIZE));
  const aLire = Math.min(nbPages, maxPages);
  const lignes = [...p1.lignes];
  for (let debut = 2; debut <= aLire; debut += PAGES_EN_PARALLELE) {
    const lot: Promise<{ lignes: Record<string, unknown>[] }>[] = [];
    for (let p = debut; p < debut + PAGES_EN_PARALLELE && p <= aLire; p++) lot.push(lirePage(fetcher, urlPage(p)));
    for (const r of await Promise.all(lot)) lignes.push(...r.lignes);
  }
  return { lignes, total: p1.total, tronque: nbPages > maxPages };
}

export function normaliserLigne(raw: Record<string, unknown>, originLat?: number, originLon?: number): MonumentRow {
  const c = lireCoordonnees(raw['coordonnees_au_format_WGS84']);
  const distance_m =
    c && originLat != null && originLon != null ? haversineM(originLat, originLon, c.lat, c.lon) : null;
  return {
    reference: str(raw['Reference']) ?? null,
    nom:
      str(raw['Titre_editorial_de_la_notice']) ??
      str(raw['Denomination_de_l_edifice']) ??
      str(raw['Autre_appellation_de_l_edifice']) ??
      null,
    denomination: str(raw['Denomination_de_l_edifice']) ?? null,
    protection: str(raw['Typologie_de_la_protection']) ?? null,
    date_protection: str(raw['Date_et_typologie_de_la_protection']) ?? null,
    adresse: str(raw['Adresse_forme_editoriale']) ?? null,
    commune: str(raw['Commune_forme_editoriale']) ?? null,
    siecle: str(raw['Format_abrege_du_siecle_de_construction']) ?? null,
    lat: c?.lat ?? null,
    lon: c?.lon ?? null,
    distance_m,
  };
}

function erreurSource(motif: string): SortieMerimee {
  return {
    status: 'error',
    erreur: 'source_indisponible',
    summary:
      `Source Mérimée indisponible (${motif}) : les monuments historiques n'ont PAS pu être vérifiés. ` +
      "Ce résultat ne signifie pas qu'il n'y a aucun monument à proximité — seulement qu'aucune vérification n'a pu être faite. Réessayez plus tard.",
    stats: null,
    items: [],
  };
}

export interface Options {
  /** Réparation d'encodage appliquée aux lignes (injectée pour garder ce module sans dépendance). */
  reparer?: <T>(v: T) => T;
  maxPages?: number;
}

/** Cœur de la fonction : entrée → sortie { status, summary, stats, items } (contrat inchangé). */
export async function rechercherMonuments(
  input: MerimeeInput,
  fetcher: Fetcher,
  opts: Options = {},
): Promise<SortieMerimee> {
  const reparer = opts.reparer ?? (<T>(v: T) => v);
  const lat = num(input.lat);
  const lon = num(input.lon) ?? num(input.lng);
  const codeInsee = str(input.code_insee);
  const rayonDemande = num(input.radius_m);
  const rayonBrut = rayonDemande != null && rayonDemande > 0 ? rayonDemande : PERIMETRE_ABF_M;
  const radiusM = Math.min(rayonBrut, RAYON_MAX_M);
  const rayonLimite = rayonBrut > RAYON_MAX_M;
  const parCoordonnees = lat != null && lon != null;

  if (!parCoordonnees && !codeInsee) {
    return {
      status: 'no_localization',
      summary: 'Localisation insuffisante pour interroger la base Mérimée (ni coordonnées, ni code INSEE).',
      stats: null,
      items: [],
    };
  }
  if (!parCoordonnees && codeInsee && !/^(\d{5}|2[AB]\d{3})$/i.test(codeInsee)) {
    return { status: 'no_localization', summary: `Code INSEE « ${codeInsee} » invalide pour la base Mérimée.`, stats: null, items: [] };
  }

  let lecture: { lignes: Record<string, unknown>[]; total: number; tronque: boolean };
  try {
    if (parCoordonnees) {
      const b = bornesBande(lat, radiusM);
      if (!b) {
        return {
          status: 'error',
          summary:
            'Recherche de monuments historiques impossible à cette latitude avec la source actuelle ' +
            '(filtre par bande de latitude non fiable ici). Aucune conclusion ne peut être tirée.',
          stats: null,
          items: [],
        };
      }
      lecture = await lireToutesPages(fetcher, (p) => urlBande(b, p), opts.maxPages);
    } else {
      lecture = await lireToutesPages(fetcher, (p) => urlCommune(codeInsee!.toUpperCase(), p), opts.maxPages);
    }
  } catch (e) {
    if (e instanceof SourceIndisponible) return erreurSource(e.message);
    return erreurSource(e instanceof Error ? e.message : String(e));
  }

  const lignes = reparer(lecture.lignes);
  let rows = lignes.map((r) => normaliserLigne(r, lat, lon));
  if (parCoordonnees) {
    rows = rows.filter((r) => r.distance_m != null && r.distance_m <= radiusM);
  }
  rows.sort((a, b) => (a.distance_m ?? 1e12) - (b.distance_m ?? 1e12) || (a.nom ?? '').localeCompare(b.nom ?? ''));

  const noteRayon = rayonLimite ? ` (rayon demandé ${rayonBrut} m, limité à ${RAYON_MAX_M} m)` : '';
  const noteCommune = parCoordonnees
    ? ''
    : " Recherche par commune : les monuments enregistrés sous l'ancien code d'une commune fusionnée peuvent manquer.";

  if (lecture.tronque) {
    // On n'a pas tout lu : ne JAMAIS conclure « aucun » ni affirmer « hors abords ».
    if (rows.length === 0) {
      return {
        status: 'error',
        summary:
          `Trop de notices à parcourir (${lecture.total}) : la recherche n'a pas pu être menée jusqu'au bout. ` +
          'Aucune conclusion sur la présence de monuments historiques ne peut être tirée.',
        stats: null,
        items: [],
      };
    }
  }

  if (rows.length === 0) {
    return {
      status: 'no_data',
      summary: parCoordonnees
        ? `Aucun monument historique dans un rayon de ${radiusM} m${noteRayon} dans la base Mérimée. Le terrain n'est pas dans un périmètre d'abords MH connu à cette distance.`
        : `Aucun monument historique recensé pour cette commune dans la base Mérimée.${noteCommune}`,
      stats: null,
      items: [],
    };
  }

  const classes = rows.filter((r) => (r.protection ?? '').toLowerCase().includes('classé'));
  const inscrits = rows.filter((r) => (r.protection ?? '').toLowerCase().includes('inscrit'));
  const plusProche = rows[0]!;
  // Sans coordonnées (recherche par commune), la distance est inconnue : on ne prétend rien.
  const dansPerimetreAbf: boolean | null = parCoordonnees
    ? plusProche.distance_m != null && plusProche.distance_m <= PERIMETRE_ABF_M
    : null;

  const summaryParts = [
    `${rows.length} monument(s) historique(s) trouvé(s)` +
      (parCoordonnees ? ` dans un rayon de ${radiusM} m${noteRayon}.` : ' sur la commune.'),
    plusProche.nom
      ? `Le plus proche : « ${plusProche.nom} »` +
        (plusProche.distance_m != null ? ` à ${plusProche.distance_m} m` : '') +
        (plusProche.protection ? ` (${plusProche.protection}).` : '.')
      : '',
    dansPerimetreAbf
      ? "⚠️ Terrain probablement dans le périmètre des abords (500 m) : tout projet est soumis à l'avis de l'Architecte des Bâtiments de France (ABF)."
      : '',
    lecture.tronque ? '⚠️ INVENTAIRE INCOMPLET : toutes les notices n\'ont pas pu être parcourues ; le décompte est un MINIMUM.' : '',
    noteCommune.trim(),
  ].filter(Boolean);

  return {
    status: 'ok',
    summary: summaryParts.join(' '),
    stats: {
      total: rows.length,
      nb_classes: classes.length,
      nb_inscrits: inscrits.length,
      distance_plus_proche_m: plusProche.distance_m,
      dans_perimetre_abf_500m: dansPerimetreAbf,
      rayon_m: parCoordonnees ? radiusM : null,
      inventaire_complet: !lecture.tronque,
      source: SOURCE_LIBELLE,
    },
    items: rows.slice(0, 10).map((r) => ({
      nom: r.nom,
      denomination: r.denomination,
      protection: r.protection,
      date_protection: r.date_protection,
      adresse: r.adresse,
      commune: r.commune,
      siecle: r.siecle,
      distance_m: r.distance_m,
      reference: r.reference,
    })),
  };
}
