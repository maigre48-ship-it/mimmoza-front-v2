// src/lib/quartier/atoutsQuartier.ts
// =============================================================================
// VIS-70 (27/11/2026) — « LES ATOUTS DU QUARTIER » d'un projet, pour la page Quartier / Plan masse de l'outil de vente,
// la carte du chat (outil Edge `quartier_atouts`) et le dossier client.
//
// Entrée : le point du projet (adresse ou centroïde de parcelle, contour facultatif) et les lieux BRUTS lus dans les
// sources (BPE, GTFS / gares, OSM, SIRENE), chacune avec son état (« ok » ou « indisponible »).
// Sortie : 7 catégories (Transports, Commerces, Écoles, Santé, Parcs et loisirs, Restaurants et cafés, Emploi), chacune
// avec ses lieux réels triés par distance (distance, ≈ temps à pied / à vélo / en transport), le plus proche, un état
// honnête (« indisponible » ≠ « aucun lieu »), la synthèse « À 5 min à pied : … » et les sources avec licence.
//
// Module PUR (aucune E/S) : même code côté site (tsx, Vite) et côté Edge (Deno).
// =============================================================================
import {
  CATEGORIES_QUARTIER, DEFINITIONS_CATEGORIES, LIBELLES_MODE, classerBpe, classerEmploi, classerMode,
  type CategorieQuartier, type Classement, type ModeTransport,
} from './categoriesQuartier.ts';
import { distanceM, minutesPied, minutesTransport, minutesVelo, type ArretDepart, type Point } from './tempsTrajet.ts';

export type SourceQuartier = 'bpe' | 'gtfs' | 'mobilite' | 'osm' | 'sirene';

/** Sources ouvertes utilisées, avec leur licence (affichées en pied de page et dans le dossier). */
export const SOURCES_QUARTIER: Readonly<Record<SourceQuartier, { libelle: string; licence: string; attribution: string }>> = {
  bpe: { libelle: 'Base permanente des équipements (INSEE)', licence: 'Licence Ouverte Etalab 2.0', attribution: 'INSEE, BPE' },
  gtfs: { libelle: 'Horaires GTFS des réseaux de transport (Île-de-France Mobilités)', licence: 'ODbL 1.0', attribution: 'Île-de-France Mobilités' },
  mobilite: { libelle: 'Gares et stations (SNCF Open Data, GTFS)', licence: 'ODbL 1.0', attribution: 'SNCF Voyageurs' },
  osm: { libelle: 'OpenStreetMap (via Overpass)', licence: 'ODbL 1.0', attribution: '© les contributeurs d’OpenStreetMap' },
  sirene: { libelle: 'SIRENE / RNE — API Recherche d’entreprises (DINUM)', licence: 'Licence Ouverte Etalab 2.0', attribution: 'INSEE, DINUM' },
};

/** Ordre de préférence quand deux sources décrivent le même lieu. */
const RANG_SOURCE: Readonly<Record<SourceQuartier, number>> = { bpe: 0, gtfs: 1, mobilite: 1, sirene: 2, osm: 3 };

export interface LieuBrut {
  readonly source: SourceQuartier;
  readonly nom: string | null;
  /** Coordonnées ; absentes pour SIRENE (seule la distance est connue) : le lieu est listé, pas placé sur la carte. */
  readonly lat: number | null;
  readonly lon: number | null;
  /** Distance fournie par la source, quand les coordonnées manquent. */
  readonly distance_m?: number | null;
  readonly classement: Classement;
  readonly mode?: ModeTransport;
  readonly lignes?: readonly string[];
  readonly adresse?: string | null;
  readonly id?: string;
}

export interface EtatSource { readonly source: SourceQuartier; readonly ok: boolean; readonly message?: string }

export interface ProjetQuartier extends Point {
  readonly libelle?: string | null;
  readonly adresse?: string | null;
  readonly communeInsee?: string | null;
  /** Contour de la parcelle (anneau extérieur [lon, lat]) pour la mise en évidence ; facultatif. */
  readonly contour?: readonly (readonly [number, number])[] | null;
  readonly precision?: 'parcelle' | 'adresse' | 'point' | 'centre_commune';
}

export interface LieuQuartier {
  readonly id: string;
  readonly nom: string;
  readonly sousType: string;
  readonly categorie: CategorieQuartier;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly distance_m: number;
  readonly pied_min: number;
  readonly velo_min: number | null;
  readonly transport_min: number | null;
  readonly source: SourceQuartier;
  readonly mode?: ModeTransport;
  readonly lignes?: readonly string[];
  readonly adresse?: string | null;
  readonly poids: number;
}

export type EtatCategorie = 'ok' | 'vide' | 'indisponible';

export interface CategorieAtouts {
  readonly id: CategorieQuartier;
  readonly libelle: string;
  readonly etat: EtatCategorie;
  readonly lieux: readonly LieuQuartier[];
  /** Nombre de lieux dans le rayon (avant troncature de l'affichage). */
  readonly total: number;
  readonly plusProche: LieuQuartier | null;
  /** Phrase courte : « Boulangerie-pâtisserie Au Croissant de la Rhune à 3 min à pied ». */
  readonly phrase: string;
  readonly sources: readonly SourceQuartier[];
}

export interface SyntheseQuartier {
  /** Sous-types joignables à pied en 5 min au plus, par ordre d'intérêt (« boulangerie-pâtisserie », « école primaire »…). */
  readonly a5minPied: readonly { sousType: string; minutes: number; categorie: CategorieQuartier }[];
  readonly a10minPied: readonly { sousType: string; minutes: number; categorie: CategorieQuartier }[];
  readonly a10minVelo: readonly { sousType: string; minutes: number; categorie: CategorieQuartier }[];
  /** Phrase d'accroche : « À 5 min à pied : une boulangerie, une école primaire et une pharmacie. » */
  readonly phrase: string;
  readonly phraseTransports: string;
}

export interface AtoutsQuartier {
  readonly version: 1;
  readonly projet: ProjetQuartier;
  readonly urbain: boolean;
  readonly rayon_m: number;
  readonly categories: readonly CategorieAtouts[];
  readonly synthese: SyntheseQuartier;
  readonly sources: readonly { source: SourceQuartier; libelle: string; licence: string; ok: boolean }[];
  readonly avertissements: readonly string[];
  readonly calcule_le: string;
}

export interface OptionsAtouts {
  readonly rayon_m?: number;
  readonly maxParCategorie?: number;
  readonly maintenant?: Date;
}

export const RAYON_DEFAUT_M = 2000;
export const MAX_PAR_CATEGORIE = 12;

const SOURCES_PAR_CATEGORIE: Readonly<Record<CategorieQuartier, readonly SourceQuartier[]>> = {
  transports: ['gtfs', 'mobilite', 'osm'], commerces: ['bpe', 'osm'], ecoles: ['bpe', 'osm'], sante: ['bpe', 'osm'],
  loisirs: ['osm'], restaurants: ['osm'], emploi: ['sirene'],
};

export const AVERTISSEMENT_TEMPS =
  'Temps estimés (distance à vol d’oiseau corrigée d’un détour, 4,5 km/h à pied, 15 km/h à vélo, attente moyenne en transport) : ' +
  'indicatifs et non contractuels.';

/* ─── Normalisation des noms ─── */
const SANS_ACCENT = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const cle = (s: string): string => SANS_ACCENT(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** « AU CROISSANT DE LA RHUNE » → « Au Croissant de la Rhune » (les sources écrivent souvent en capitales). */
export function nomLisible(nom: string | null | undefined, sousType: string): string {
  // Formes juridiques en tête (« SELARL PHARMACIE DES ARCHIVES ») : sans intérêt pour un acquéreur.
  const n = (nom ?? '').replace(/\s+/g, ' ').trim().replace(/^(SELARL|SELAS|SELURL|SARL|SAS|SASU|EURL|SCI|SNC)\s+(?=\S)/, '');
  if (!n) return sousType;
  if (n !== n.toUpperCase() || !/[A-Z]/.test(n)) return n;
  const PETITS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'sur', 'sous', 'à', 'd', 'l']);
  const SIGLES = new Set(['BP', 'SNCF', 'RER', 'TER', 'TGV', 'CHU', 'EHPAD', 'SA', 'SAS', 'SARL', 'LP', 'GDS', 'CIC', 'BNP', 'LCL', 'CPAM', 'CAF', 'IUT']);
  const mots = n.split(' ');
  return mots.map((m, i) => {
    if (/^STE?$/.test(m)) return m.charAt(0) + m.slice(1).toLowerCase();
    const lettres = m.replace(/[^A-Z]/g, '');
    if (SIGLES.has(lettres) || (lettres.length >= 2 && lettres.length <= 4 && !/[AEIOUY]/.test(lettres))) return m;
    const bas = m.toLowerCase();
    // Noms communs des libellés BPE (écrits sans accents, en capitales) : accentués et en minuscules après le 1er mot.
    const commun = MOTS_COMMUNS[bas];
    let j = i - 1;
    while (j > 0 && PETITS.has(mots[j]!.toLowerCase())) j--;
    const precedentCommun = j >= 0 && j < i && MOTS_COMMUNS[mots[j]!.toLowerCase()] !== undefined;
    if (commun) return precedentCommun ? commun : commun.charAt(0).toUpperCase() + commun.slice(1);
    if (i > 0 && PETITS.has(bas)) return bas;
    const elision = bas.match(/^([dl])['’](.+)$/);
    if (elision && i > 0) return `${elision[1]}'${elision[2]!.charAt(0).toUpperCase()}${elision[2]!.slice(1)}`;
    return bas.replace(/(^|[-'’])(\p{L})/gu, (_x, p: string, l: string) => p + l.toUpperCase());
  }).join(' ').replace(/\b([dl])’(\p{L})/gu, (_x, a: string, l: string) => `${a}’${l.toUpperCase()}`).replace(/^(\p{L})/u, (l) => l.toUpperCase());
}

const MOTS_COMMUNS: Readonly<Record<string, string>> = {
  ecole: 'école', college: 'collège', lycee: 'lycée', primaire: 'primaire', elementaire: 'élémentaire', maternelle: 'maternelle',
  privee: 'privée', prive: 'privé', publique: 'publique', public: 'public', general: 'général', generale: 'générale', gen: 'gén.',
  technologique: 'technologique', professionnel: 'professionnel', professionnelle: 'professionnelle', profess: 'profess.',
  pharmacie: 'pharmacie', sante: 'santé', centre: 'centre', dentaire: 'dentaire', hotel: 'hôtel', metiers: 'métiers',
};

/* ─── Conversion des sources (formes des fonctions Mimmoza existantes) ─── */

/** Lignes de public.bpe_equipements (typequ, nomrs, latitude, longitude, libcom) ou de get_bpe_essentiels_radius. */
export function lieuxDepuisBpe(rows: readonly Record<string, unknown>[]): LieuBrut[] {
  const out: LieuBrut[] = [];
  for (const r of rows) {
    const code = String(r.typequ ?? r.type_code ?? '').trim();
    const nom = typeof r.nomrs === 'string' ? r.nomrs : typeof r.nom === 'string' ? r.nom : null;
    const lat = num(r.latitude ?? r.lat), lon = num(r.longitude ?? r.lon);
    const c = code ? classerBpe(code, nom) : null;
    if (!c || lat === null || lon === null) continue;
    out.push({ source: 'bpe', nom, lat, lon, classement: c, adresse: typeof r.libcom === 'string' ? r.libcom : null, id: `bpe:${code}:${lat.toFixed(5)},${lon.toFixed(5)}` });
  }
  return out;
}

/**
 * Mode affiché d'une ligne de mobility_stops / gtfs_stops : prudent (voir ModeTransport). `tgv` n'est gardé que pour
 * une gare principale marquée has_tgv ET dont le nom ne désigne pas une halte de banlieue connue pour être mal typée.
 */
export function modeMobilite(r: Record<string, unknown>, source: 'gtfs' | 'mobilite'): ModeTransport | null {
  const brut = String(r.mode ?? '').toLowerCase();
  if (source === 'gtfs') return 'arret';
  if (brut === 'metro' || brut === 'bus' || brut === 'tram' || brut === 'bhns') return 'arret';
  if (brut === 'ter' || brut === 'tgv' || brut === 'rer' || brut === 'transilien') return 'gare';
  return null;
}

/** Lignes de mobility_nearby_stops (stop_name, mode, distance_m, line_ids…) ou get_nearby_gtfs_stops (stop_lat, stop_lon). */
export function lieuxDepuisMobilite(rows: readonly Record<string, unknown>[], source: 'gtfs' | 'mobilite' = 'mobilite'): LieuBrut[] {
  const out: LieuBrut[] = [];
  for (const r of rows) {
    // Entrées de station (« r. de Lobau ») et quais : pas des arrêts à vendre.
    if (/Entrance|:Quay:/i.test(String(r.stop_id ?? '')) || r.location_type === 2) continue;
    const mode = modeMobilite(r, source);
    if (!mode) continue;
    const lat = num(r.stop_lat ?? r.lat), lon = num(r.stop_lon ?? r.lon);
    const d = num(r.distance_m);
    if ((lat === null || lon === null) && d === null) continue;
    const lignes = Array.isArray(r.line_ids) ? (r.line_ids as unknown[]).filter((x): x is string => typeof x === 'string') : undefined;
    out.push({
      source, nom: typeof r.stop_name === 'string' ? r.stop_name : null, lat, lon, distance_m: d, classement: classerMode(mode), mode,
      ...(lignes?.length ? { lignes } : {}), id: `${source}:${String(r.stop_id ?? `${r.stop_name}:${lat},${lon}`)}`,
    });
  }
  return out;
}

/** Éléments `items` de etablissements-sirene-v1 (nom, activite, adresse, distance_m, effectif). */
export function lieuxDepuisSirene(items: readonly Record<string, unknown>[]): LieuBrut[] {
  const out: LieuBrut[] = [];
  for (const it of items) {
    const c = classerEmploi(typeof it.effectif === 'string' ? it.effectif : null);
    const d = num(it.distance_m);
    if (!c || d === null) continue;
    const activite = typeof it.activite === 'string' ? it.activite.replace(/\s*\(NAF[^)]*\)\s*$/, '') : null;
    out.push({
      source: 'sirene', nom: typeof it.nom === 'string' ? it.nom : null, lat: num(it.lat), lon: num(it.lon), distance_m: d,
      classement: { ...c, sousType: activite ? `${c.sousType} · ${activite}` : c.sousType }, adresse: typeof it.adresse === 'string' ? it.adresse : null,
      id: `sirene:${String(it.nom)}:${d}`,
    });
  }
  return out;
}

function num(x: unknown): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x) : NaN;
  return Number.isFinite(n) ? n : null;
}

/* ─── Assemblage ─── */

/** Le quartier est-il urbain (détour plus faible, transports plus fins) ? */
export function estUrbain(projet: Point, lieux: readonly LieuBrut[]): boolean {
  let proches = 0, arrets = 0;
  for (const l of lieux) {
    const d = l.lat !== null && l.lon !== null ? distanceM(projet, { lat: l.lat, lon: l.lon }) : (l.distance_m ?? Infinity);
    if (d > 600) continue;
    if (l.mode === 'metro' || l.mode === 'tram' || l.mode === 'rer') return true;
    if (l.mode && l.mode !== 'velo_libre' && d <= 400) arrets++;
    proches++;
  }
  // Ville : au moins 3 arrêts à 400 m, ou une forte densité d'équipements à 600 m.
  return arrets >= 3 || proches >= 25;
}

/** Deux lieux bruts décrivent-ils le même endroit ? (même catégorie, nom proche et < 60 m ; arrêts homonymes < 300 m) */
function memeLieu(a: LieuQuartier, b: LieuQuartier): boolean {
  if (a.categorie !== b.categorie) return false;
  const proches = (m: number) => a.lat !== null && b.lat !== null && a.lon !== null && b.lon !== null
    ? distanceM({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }) <= m : Math.abs(a.distance_m - b.distance_m) <= m / 2;
  const ka = cle(a.nom), kb = cle(b.nom);
  if (a.categorie === 'transports') return ka === kb && proches(300);
  if (ka && ka === kb && proches(60)) return true;
  return a.sousType === b.sousType && proches(15);
}

export function assemblerAtouts(
  projet: ProjetQuartier,
  lieuxBruts: readonly LieuBrut[],
  etats: readonly EtatSource[],
  o: OptionsAtouts = {},
): AtoutsQuartier {
  const rayon = o.rayon_m ?? RAYON_DEFAUT_M;
  const maxCat = o.maxParCategorie ?? MAX_PAR_CATEGORIE;
  const urbain = estUrbain(projet, lieuxBruts);

  // 1. Distances, puis arrêt de départ (le plus proche, le plus « lourd » à distance égale) pour le temps en transport.
  const avecDistance = lieuxBruts.map((l) => ({
    l, d: l.lat !== null && l.lon !== null ? distanceM(projet, { lat: l.lat, lon: l.lon }) : (l.distance_m ?? NaN),
  })).filter((x) => Number.isFinite(x.d) && x.d <= (x.l.classement.categorie === 'transports' && (x.l.mode === 'ter' || x.l.mode === 'tgv' || x.l.mode === 'gare') ? Math.max(rayon, 15_000) : rayon));

  const arrets = avecDistance.filter((x) => x.l.mode && x.l.mode !== 'velo_libre' && x.d <= 800)
    .sort((a, b) => (a.d - a.l.classement.poids * 40) - (b.d - b.l.classement.poids * 40));
  const depart: ArretDepart | null = arrets[0] ? { mode: arrets[0].l.mode!, distance_m: arrets[0].d, nom: arrets[0].l.nom } : null;

  // 2. Lieux enrichis, dédoublonnés (la source la mieux classée gagne).
  const tries = avecDistance.sort((a, b) => RANG_SOURCE[a.l.source] - RANG_SOURCE[b.l.source] || a.d - b.d);
  const retenus: LieuQuartier[] = [];
  for (const { l, d } of tries) {
    const c = l.classement;
    const lieu: LieuQuartier = {
      id: l.id ?? `${l.source}:${retenus.length}`, nom: nomLisible(l.nom, c.sousType), sousType: c.sousType, categorie: c.categorie,
      lat: l.lat, lon: l.lon, distance_m: Math.round(d), pied_min: minutesPied(d, urbain), velo_min: minutesVelo(d, urbain),
      transport_min: c.categorie === 'transports' ? null : minutesTransport(d, urbain, depart),
      source: l.source, poids: c.poids,
      ...(l.mode ? { mode: l.mode } : {}), ...(l.lignes?.length ? { lignes: l.lignes } : {}), ...(l.adresse ? { adresse: l.adresse } : {}),
    };
    const i = retenus.findIndex((r) => memeLieu(r, lieu));
    if (i < 0) retenus.push(lieu);
    // Un arrêt OSM au mode précis (métro, tram) remplace l'« arrêt de transport en commun » générique du même nom.
    else if (lieu.categorie === 'transports' && lieu.poids > retenus[i]!.poids) retenus[i] = { ...lieu, ...(retenus[i]!.lignes ? { lignes: retenus[i]!.lignes } : {}) };
  }

  // 3. Catégories.
  const ok = (s: SourceQuartier) => etats.some((e) => e.source === s && e.ok);
  const consultee = (s: SourceQuartier) => etats.some((e) => e.source === s);
  const categories: CategorieAtouts[] = CATEGORIES_QUARTIER.map((id) => {
    const def = DEFINITIONS_CATEGORIES[id];
    const tous = retenus.filter((r) => r.categorie === id).sort((a, b) => a.distance_m - b.distance_m);
    const sourcesCat = SOURCES_PAR_CATEGORIE[id].filter(consultee);
    const sourcesOk = SOURCES_PAR_CATEGORIE[id].filter(ok);
    const etat: EtatCategorie = tous.length ? 'ok' : sourcesOk.length ? 'vide' : 'indisponible';
    const lieux = id === 'transports' ? choisirTransports(tous, maxCat) : tous.slice(0, maxCat);
    const plusProche = id === 'transports' ? (lieux[0] ?? null) : (tous[0] ?? null);
    return { id, libelle: def.libelle, etat, lieux, total: tous.length, plusProche, phrase: phraseCategorie(id, etat, plusProche, rayon), sources: sourcesCat };
  });

  const synthese = construireSynthese(categories, retenus);
  const avertissements = [AVERTISSEMENT_TEMPS];
  for (const c of categories) if (c.etat === 'indisponible') avertissements.push(`${c.libelle} : source momentanément indisponible — catégorie non renseignée (cela ne veut pas dire qu’il n’y a rien).`);
  if (projet.precision === 'centre_commune') avertissements.push('Position approchée (centre de la commune) : les distances sont relatives à ce point, pas au terrain.');

  return {
    version: 1, projet, urbain, rayon_m: rayon, categories, synthese,
    sources: (Object.keys(SOURCES_QUARTIER) as SourceQuartier[]).filter(consultee).map((s) => ({ source: s, libelle: SOURCES_QUARTIER[s].libelle, licence: SOURCES_QUARTIER[s].licence, ok: ok(s) })),
    avertissements, calcule_le: (o.maintenant ?? new Date()).toISOString(),
  };
}

/** Transports : le plus proche de chaque mode d'abord (métro, tram, gare…), puis les autres arrêts. */
function choisirTransports(tous: readonly LieuQuartier[], max: number): LieuQuartier[] {
  const premiers = new Map<string, LieuQuartier>();
  for (const l of tous) if (!premiers.has(l.mode ?? l.sousType)) premiers.set(l.mode ?? l.sousType, l);
  const tete = [...premiers.values()].sort((a, b) => (a.pied_min <= 15 ? 0 : 1) - (b.pied_min <= 15 ? 0 : 1) || b.poids - a.poids || a.distance_m - b.distance_m);
  const reste = tous.filter((l) => !tete.includes(l));
  return [...tete, ...reste].slice(0, max);
}

/** Article indéfini du sous-type (genre grammatical). */
const article = (sousType: string): string =>
  /^(école|épicerie|boulangerie|boucherie|poissonnerie|pharmacie|banque|supérette|médiathèque|piscine|aire|agence|gare|station|plage|salle|maternité|crèche|université|grande surface|agence|station)/i.test(sousType) ? 'une ' : 'un ';
const minuscule = (s: string): string => (/^[A-ZÉ]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

/** « une boulangerie, une école primaire et une pharmacie » */
export function enumerer(sousTypes: readonly string[]): string {
  const items = sousTypes.map((s) => `${article(s)}${minuscule(s)}`);
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

function phraseCategorie(id: CategorieQuartier, etat: EtatCategorie, p: LieuQuartier | null, rayon: number): string {
  const lib = DEFINITIONS_CATEGORIES[id].libelle;
  if (etat === 'indisponible') return `${lib} : donnée momentanément indisponible.`;
  if (!p) return `${lib} : aucun lieu recensé à moins de ${Math.round(rayon / 100) / 10} km.`.replace('.', ',').replace(/,$/, '.');
  const nom = p.nom === p.sousType ? p.sousType : `${p.sousType} ${p.nom}`;
  const temps = p.pied_min <= 20 ? `à ${p.pied_min} min à pied` : p.velo_min !== null ? `à ${p.velo_min} min à vélo` : `à ${(p.distance_m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${nom} ${temps}.`;
}

/** Famille d'un lieu pour la phrase de synthèse (« école » plutôt que « école primaire » ET « école élémentaire »). */
export function familleSynthese(l: Pick<LieuQuartier, 'categorie' | 'sousType' | 'mode'>): string {
  const s = l.sousType.split(' · ')[0]!;
  if (l.categorie === 'transports') return l.mode ? LIBELLES_MODE[l.mode] : s;
  if (/^École|^Crèche/.test(s)) return 'École';
  if (/^Boulangerie/.test(s)) return 'Boulangerie';
  if (/^(Hyper|Super)marché/.test(s)) return 'Supermarché';
  if (/^(Supérette|Épicerie)/.test(s)) return 'Épicerie';
  if (/^Lycée/.test(s)) return 'Lycée';
  if (/^(Bureau de poste|Relais poste|Agence postale)/.test(s)) return 'Bureau de poste';
  if (/^(Médecin|Cabinet médical)/.test(s)) return 'Médecin';
  if (/^(Parc|Jardin)/.test(s)) return 'Parc';
  return s;
}

function construireSynthese(categories: readonly CategorieAtouts[], lieux: readonly LieuQuartier[]): SyntheseQuartier {
  const parSousType = (filtre: (l: LieuQuartier) => number | null, max: number) => {
    const meilleurs = new Map<string, { sousType: string; minutes: number; categorie: CategorieQuartier; poids: number }>();
    for (const l of lieux) {
      const m = filtre(l);
      if (m === null || m > max) continue;
      const k = familleSynthese(l);
      const deja = meilleurs.get(k);
      if (!deja || m < deja.minutes) meilleurs.set(k, { sousType: k, minutes: m, categorie: l.categorie, poids: Math.max(l.poids, deja?.poids ?? 0) });
    }
    return [...meilleurs.values()].sort((a, b) => b.poids - a.poids || a.minutes - b.minutes).map((x) => ({ sousType: x.sousType, minutes: x.minutes, categorie: x.categorie }));
  };
  const a5 = parSousType((l) => l.pied_min, 5);
  const a10 = parSousType((l) => l.pied_min, 10);
  const velo = parSousType((l) => l.velo_min, 10);
  const choix = a5.length >= 2 ? { t: '5 min à pied', l: a5 } : a10.length ? { t: '10 min à pied', l: a10 } : velo.length ? { t: '10 min à vélo', l: velo } : null;
  const phrase = choix ? `À ${choix.t} : ${enumerer(choix.l.slice(0, 4).map((x) => x.sousType))}.` : 'Quartier résidentiel au calme : les commerces et services sont accessibles en voiture.';

  const tr = categories.find((c) => c.id === 'transports');
  const premier = tr?.lieux[0] ?? null;
  const phraseTransports = !tr || tr.etat === 'indisponible' ? 'Transports : donnée momentanément indisponible.'
    : !premier ? 'Aucun arrêt de transport en commun recensé à proximité.'
      : `${premier.mode ? LIBELLES_MODE[premier.mode] : premier.sousType} « ${premier.nom} » à ${premier.pied_min <= 20 ? `${premier.pied_min} min à pied` : premier.velo_min !== null ? `${premier.velo_min} min à vélo` : `${(premier.distance_m / 1000).toFixed(1).replace('.', ',')} km`}.`;
  return { a5minPied: a5, a10minPied: a10, a10minVelo: velo, phrase, phraseTransports };
}

/** Atouts relus (sortie d'outil, stockage de session) : forme minimale vérifiée ; null sinon. */
export function lireAtouts(x: unknown): AtoutsQuartier | null {
  if (typeof x !== 'object' || x === null) return null;
  const a = x as Record<string, unknown>;
  const p = a.projet as Record<string, unknown> | undefined;
  if (a.version !== 1 || !p || num(p.lat) === null || num(p.lon) === null || !Array.isArray(a.categories) || typeof a.synthese !== 'object' || a.synthese === null) return null;
  return x as AtoutsQuartier;
}

/* ─── Projet depuis une parcelle (studio_preparations.entree.parcelle.geometrie, GeoJSON) ─── */

/** Anneau extérieur du plus grand polygone d'une géométrie GeoJSON Polygon / MultiPolygon ; null sinon. */
export function anneauExterieur(geometrie: unknown): [number, number][] | null {
  if (typeof geometrie !== 'object' || geometrie === null) return null;
  const g = geometrie as { type?: string; coordinates?: unknown };
  const polys: unknown[] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' && Array.isArray(g.coordinates) ? g.coordinates : [];
  let meilleur: [number, number][] | null = null, aire = -1;
  for (const p of polys) {
    const ring = Array.isArray(p) && Array.isArray(p[0]) ? (p[0] as unknown[]) : null;
    if (!ring) continue;
    const pts = ring.filter((c): c is [number, number] => Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number').map((c) => [c[0], c[1]] as [number, number]);
    if (pts.length < 3) continue;
    const a = Math.abs(aireSignee(pts));
    if (a > aire) { aire = a; meilleur = pts; }
  }
  return meilleur;
}

function aireSignee(pts: readonly (readonly [number, number])[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i]!; const [x2, y2] = pts[(i + 1) % pts.length]!; s += x1 * y2 - x2 * y1; }
  return s / 2;
}

/** Centroïde (formule des polygones) d'un anneau [lon, lat] ; repli : moyenne des sommets. */
export function centroideAnneau(pts: readonly (readonly [number, number])[]): Point {
  const a = aireSignee(pts);
  if (Math.abs(a) < 1e-14) {
    const n = pts.length;
    return { lon: pts.reduce((s, p) => s + p[0], 0) / n, lat: pts.reduce((s, p) => s + p[1], 0) / n };
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!; const [x2, y2] = pts[(i + 1) % pts.length]!;
    const f = x1 * y2 - x2 * y1; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  return { lon: cx / (6 * a), lat: cy / (6 * a) };
}

/** Projet du quartier depuis l'entrée d'une préparation Studio ({ parcelle: { idu, geometrie } }) ; null si illisible. */
export function projetDepuisPreparation(entree: unknown, extra: { libelle?: string | null; adresse?: string | null } = {}): ProjetQuartier | null {
  if (typeof entree !== 'object' || entree === null) return null;
  const parcelle = (entree as { parcelle?: { idu?: unknown; geometrie?: unknown } }).parcelle;
  const anneau = anneauExterieur(parcelle?.geometrie);
  if (!anneau) return null;
  const c = centroideAnneau(anneau);
  const idu = typeof parcelle?.idu === 'string' ? parcelle.idu : null;
  return {
    lat: +c.lat.toFixed(6), lon: +c.lon.toFixed(6), contour: anneau, precision: 'parcelle',
    communeInsee: idu && /^\d{5}|^2[AB]\d{3}/.test(idu) ? idu.slice(0, 5) : null,
    libelle: extra.libelle ?? (idu ? `Parcelle ${idu}` : null), adresse: extra.adresse ?? null,
  };
}
