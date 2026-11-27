// src/lib/quartier/categoriesQuartier.ts
// =============================================================================
// VIS-70 (27/11/2026) — PAGE QUARTIER / PLAN MASSE. Catégories de la page « Quartier » de l'outil de vente
// (Transports, Commerces, Écoles, Santé, Parcs et loisirs, Restaurants et cafés, Emploi), leurs pictogrammes,
// et le classement des lieux venus des sources DÉJÀ utilisées par Mimmoza :
//   · BPE INSEE (table public.bpe_equipements : familles A services, B commerces, C enseignement, D santé) ;
//   · mobilité (gtfs_stops Île-de-France, mobility_stops gares TER / TGV et métro) ;
//   · OSM / Overpass (arrêts de bus et tram hors Île-de-France, parcs, loisirs, restaurants, médecins) ;
//   · SIRENE / RNE (etablissements-sirene-v1) pour l'emploi.
// Module PUR (aucune E/S, imports relatifs en .ts : Vite, tsx, Deno).
// =============================================================================

export type CategorieQuartier = 'transports' | 'commerces' | 'ecoles' | 'sante' | 'loisirs' | 'restaurants' | 'emploi';

export const CATEGORIES_QUARTIER: readonly CategorieQuartier[] = ['transports', 'commerces', 'ecoles', 'sante', 'loisirs', 'restaurants', 'emploi'];

export interface DefinitionCategorie {
  readonly id: CategorieQuartier;
  readonly libelle: string;
  /** Libellé court (pastilles, carte du chat). */
  readonly court: string;
  /** Couleur du pictogramme et des repères (fond foncé lisible en blanc). */
  readonly couleur: string;
  /** Tracé SVG 24×24 (trait, style lucide) : aucun import d'icônes dans le module pur. */
  readonly picto: string;
}

export const DEFINITIONS_CATEGORIES: Readonly<Record<CategorieQuartier, DefinitionCategorie>> = {
  transports: { id: 'transports', libelle: 'Transports', court: 'Transports', couleur: '#1d4ed8',
    picto: 'M8 6v6M16 6v6M2 12h19.6M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3M9 18h5M7 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM18 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z' },
  commerces: { id: 'commerces', libelle: 'Commerces', court: 'Commerces', couleur: '#b45309',
    picto: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0' },
  ecoles: { id: 'ecoles', libelle: 'Écoles', court: 'Écoles', couleur: '#7c3aed',
    picto: 'M22 10 12 5 2 10l10 5 10-5zM6 12v5c3 3 9 3 12 0v-5' },
  sante: { id: 'sante', libelle: 'Santé', court: 'Santé', couleur: '#dc2626',
    picto: 'M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h5v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2z' },
  loisirs: { id: 'loisirs', libelle: 'Parcs et loisirs', court: 'Loisirs', couleur: '#15803d',
    picto: 'M12 22v-7M9 15h6M12 2l-5 8h3l-3 5h10l-3-5h3z' },
  restaurants: { id: 'restaurants', libelle: 'Restaurants et cafés', court: 'Restaurants', couleur: '#c2410c',
    picto: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7' },
  emploi: { id: 'emploi', libelle: 'Emploi', court: 'Emploi', couleur: '#0f766e',
    picto: 'M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' },
};

/** Sous-type affiché (« Boulangerie », « École élémentaire », « Arrêt de tram »…) et catégorie. */
export interface Classement { readonly categorie: CategorieQuartier; readonly sousType: string; /** Poids de mise en avant (synthèse « à 5 min »). */ readonly poids: number }

// ─── BPE (INSEE) ────────────────────────────────────────────────────────────
// Codes des millésimes 2021-2024 présents dans public.bpe_equipements, plus les codes des millésimes antérieurs
// (B101/B102/B203/C101/C104/D201/D301) : la table a été chargée en plusieurs fois. Les codes non listés ici
// (pompes funèbres, police, formation continue…) ne servent pas l'argumentaire de vente : ils sont écartés.
const BPE: Readonly<Record<string, Classement>> = {
  B101: { categorie: 'commerces', sousType: 'Hypermarché', poids: 3 },
  B104: { categorie: 'commerces', sousType: 'Hypermarché', poids: 3 },
  B102: { categorie: 'commerces', sousType: 'Supermarché', poids: 5 },
  B105: { categorie: 'commerces', sousType: 'Supermarché', poids: 5 },
  B201: { categorie: 'commerces', sousType: 'Supérette', poids: 4 },
  B202: { categorie: 'commerces', sousType: 'Épicerie', poids: 4 },
  B203: { categorie: 'commerces', sousType: 'Boulangerie', poids: 6 },
  B207: { categorie: 'commerces', sousType: 'Boulangerie-pâtisserie', poids: 6 },
  B204: { categorie: 'commerces', sousType: 'Boucherie-charcuterie', poids: 3 },
  B206: { categorie: 'commerces', sousType: 'Poissonnerie', poids: 2 },
  B311: { categorie: 'commerces', sousType: 'Fleuriste', poids: 1 },
  B304: { categorie: 'commerces', sousType: 'Magasin de chaussures', poids: 1 },
  B103: { categorie: 'commerces', sousType: 'Grande surface de bricolage', poids: 1 },
  A203: { categorie: 'commerces', sousType: 'Banque', poids: 2 },
  A206: { categorie: 'commerces', sousType: 'Bureau de poste', poids: 3 },
  A207: { categorie: 'commerces', sousType: 'Relais poste', poids: 2 },
  A208: { categorie: 'commerces', sousType: 'Agence postale', poids: 2 },
  C101: { categorie: 'ecoles', sousType: 'École maternelle', poids: 6 },
  C107: { categorie: 'ecoles', sousType: 'École maternelle', poids: 6 },
  C108: { categorie: 'ecoles', sousType: 'École primaire', poids: 6 },
  C104: { categorie: 'ecoles', sousType: 'École élémentaire', poids: 6 },
  C109: { categorie: 'ecoles', sousType: 'École élémentaire', poids: 6 },
  C201: { categorie: 'ecoles', sousType: 'Collège', poids: 5 },
  C301: { categorie: 'ecoles', sousType: 'Lycée général et technologique', poids: 4 },
  C302: { categorie: 'ecoles', sousType: 'Lycée professionnel', poids: 3 },
  C303: { categorie: 'ecoles', sousType: 'Lycée agricole', poids: 2 },
  C401: { categorie: 'ecoles', sousType: 'BTS - classes préparatoires', poids: 2 },
  C409: { categorie: 'ecoles', sousType: 'Université (UFR)', poids: 3 },
  C503: { categorie: 'ecoles', sousType: 'École d’ingénieurs', poids: 2 },
  C504: { categorie: 'ecoles', sousType: 'Enseignement supérieur', poids: 2 },
  C509: { categorie: 'ecoles', sousType: 'Enseignement supérieur', poids: 2 },
  D101: { categorie: 'sante', sousType: 'Hôpital', poids: 4 },
  D102: { categorie: 'sante', sousType: 'Établissement de soins de suite', poids: 1 },
  D106: { categorie: 'sante', sousType: 'Urgences', poids: 4 },
  D107: { categorie: 'sante', sousType: 'Maternité', poids: 2 },
  D108: { categorie: 'sante', sousType: 'Centre de santé', poids: 4 },
  D201: { categorie: 'sante', sousType: 'Médecin généraliste', poids: 6 },
  D265: { categorie: 'sante', sousType: 'Médecin généraliste', poids: 6 },
  D301: { categorie: 'sante', sousType: 'Pharmacie', poids: 6 },
  D307: { categorie: 'sante', sousType: 'Pharmacie', poids: 6 },
  D302: { categorie: 'sante', sousType: 'Laboratoire d’analyses', poids: 3 },
};

/**
 * Classement d'un équipement BPE. Le nom tranche quand le code a changé de sens d'un millésime à l'autre
 * (ex. D307 : « Pharmacie » dans la BPE 2023, « hébergement personnes âgées » dans une table de correspondance
 * plus ancienne) : un nom « PHARMACIE … » est toujours une pharmacie, un nom « EHPAD » jamais.
 */
export function classerBpe(typeCode: string, nom?: string | null): Classement | null {
  const code = typeCode.trim().toUpperCase();
  const n = (nom ?? '').toUpperCase();
  if (/\bPHARMACIE\b/.test(n)) return BPE.D301!;
  if (/\bEHPAD\b|MAISON DE RETRAITE|RESIDENCE AUTONOMIE/.test(n)) return null;
  return BPE[code] ?? null;
}

// ─── Mobilité (GTFS Île-de-France, gares SNCF) ──────────────────────────────
/**
 * `arret` et `gare` : modes PRUDENTS pour les données dont le mode n'est pas fiable. Constat VIS-70 (27/11/2026) sur
 * public.mobility_stops : les 54 620 arrêts « metro » regroupent en réalité métro, bus et entrées de station
 * (route_type vide, gtfs_stop_times vide : impossible de relier un arrêt à ses lignes), et « tgv » est posé sur des
 * gares TER (Lyon Jean Macé, Lyon Vaise). On affiche donc « Arrêt de transport en commun » / « Gare SNCF » ; un mode
 * précis vient d'OSM (station=subway, railway=tram_stop…) quand Overpass répond.
 */
export type ModeTransport = 'metro' | 'rer' | 'transilien' | 'tram' | 'bhns' | 'bus' | 'ter' | 'tgv' | 'car' | 'velo_libre' | 'arret' | 'gare';

export const LIBELLES_MODE: Readonly<Record<ModeTransport, string>> = {
  metro: 'Station de métro', rer: 'Gare RER', transilien: 'Gare Transilien', tram: 'Arrêt de tramway', bhns: 'Arrêt de bus à haut niveau de service',
  bus: 'Arrêt de bus', ter: 'Gare TER', tgv: 'Gare TGV', car: 'Arrêt de car', velo_libre: 'Station de vélos en libre-service',
  arret: 'Arrêt de transport en commun', gare: 'Gare SNCF',
};

const POIDS_MODE: Readonly<Record<ModeTransport, number>> = { metro: 7, rer: 7, tgv: 6, tram: 6, transilien: 6, ter: 5, bhns: 5, bus: 3, car: 2, velo_libre: 2, arret: 4, gare: 5 };

export function classerMode(mode: ModeTransport): Classement {
  return { categorie: 'transports', sousType: LIBELLES_MODE[mode], poids: POIDS_MODE[mode] };
}

// ─── OSM ────────────────────────────────────────────────────────────────────
/** Classement d'un objet OSM d'après ses étiquettes (tags) ; null si l'objet ne sert pas la page. */
export function classerOsm(tags: Readonly<Record<string, string>>): (Classement & { mode?: ModeTransport }) | null {
  const a = tags.amenity, l = tags.leisure, s = tags.shop, h = tags.highway, r = tags.railway, pt = tags.public_transport;
  if (r === 'tram_stop' || (pt === 'platform' && tags.tram === 'yes')) return { ...classerMode('tram'), mode: 'tram' };
  if (r === 'station' || r === 'halt') {
    if (tags.station === 'subway' || tags.subway === 'yes') return { ...classerMode('metro'), mode: 'metro' };
    if (tags.station === 'light_rail' || tags.light_rail === 'yes') return { ...classerMode('tram'), mode: 'tram' };
    return { ...classerMode('gare'), mode: 'gare' };
  }
  if (h === 'bus_stop' || (pt === 'platform' && tags.bus === 'yes')) return { ...classerMode('bus'), mode: 'bus' };
  if (a === 'bicycle_rental') return { ...classerMode('velo_libre'), mode: 'velo_libre' };
  if (l === 'park' || l === 'garden') return { categorie: 'loisirs', sousType: l === 'garden' ? 'Jardin public' : 'Parc', poids: 6 };
  if (l === 'playground') return { categorie: 'loisirs', sousType: 'Aire de jeux', poids: 4 };
  if (l === 'sports_centre' || l === 'stadium') return { categorie: 'loisirs', sousType: 'Équipement sportif', poids: 4 };
  if (l === 'swimming_pool' && tags.access !== 'private') return { categorie: 'loisirs', sousType: 'Piscine', poids: 4 };
  if (l === 'fitness_centre') return { categorie: 'loisirs', sousType: 'Salle de sport', poids: 2 };
  if (a === 'cinema') return { categorie: 'loisirs', sousType: 'Cinéma', poids: 4 };
  if (a === 'theatre') return { categorie: 'loisirs', sousType: 'Théâtre', poids: 3 };
  if (a === 'library') return { categorie: 'loisirs', sousType: 'Médiathèque', poids: 3 };
  if (tags.natural === 'beach') return { categorie: 'loisirs', sousType: 'Plage', poids: 6 };
  if (a === 'restaurant') return { categorie: 'restaurants', sousType: 'Restaurant', poids: 4 };
  if (a === 'cafe') return { categorie: 'restaurants', sousType: 'Café', poids: 4 };
  if (a === 'bar' || a === 'pub') return { categorie: 'restaurants', sousType: 'Bar', poids: 2 };
  if (a === 'fast_food') return { categorie: 'restaurants', sousType: 'Restauration rapide', poids: 1 };
  if (a === 'doctors' || tags['healthcare'] === 'doctor') return { categorie: 'sante', sousType: 'Cabinet médical', poids: 5 };
  if (a === 'pharmacy') return { categorie: 'sante', sousType: 'Pharmacie', poids: 6 };
  if (a === 'hospital') return { categorie: 'sante', sousType: 'Hôpital', poids: 4 };
  if (a === 'school') return { categorie: 'ecoles', sousType: 'École', poids: 5 };
  if (a === 'kindergarten') return { categorie: 'ecoles', sousType: 'Crèche - maternelle', poids: 4 };
  if (s === 'bakery') return { categorie: 'commerces', sousType: 'Boulangerie', poids: 6 };
  if (s === 'supermarket') return { categorie: 'commerces', sousType: 'Supermarché', poids: 5 };
  if (s === 'convenience') return { categorie: 'commerces', sousType: 'Supérette', poids: 4 };
  if (a === 'marketplace') return { categorie: 'commerces', sousType: 'Marché', poids: 5 };
  return null;
}

/** Sections NAF retenues pour « Emploi » (grands employeurs du tertiaire, de la santé, de l'industrie). */
export function classerEmploi(effectif: string | null | undefined): Classement | null {
  const e = (effectif ?? '').toLowerCase();
  // Seuls les établissements d'au moins 50 salariés sont des « pôles d'emploi » pour un acquéreur.
  const m = e.match(/(\d[\d\s]*)\s*(?:à|-|a)\s*(\d[\d\s]*)/) ?? e.match(/(\d[\d\s]*)\s*(?:salari|et plus)/);
  const bas = m ? Number(m[1]!.replace(/\s/g, '')) : NaN;
  if (!Number.isFinite(bas) || bas < 50) return null;
  return { categorie: 'emploi', sousType: bas >= 500 ? 'Grand employeur' : 'Employeur', poids: bas >= 500 ? 5 : 3 };
}
