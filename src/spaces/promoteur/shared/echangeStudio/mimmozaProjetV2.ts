/**
 * CONTRAT D'ÉCHANGE MIMMOZA ↔ STUDIO — `mimmoza-projet-v2` (lot L3).
 *
 * Ce fichier est COPIÉ À L'IDENTIQUE (octet pour octet) dans les deux dépôts :
 *   - mimmoza-front-v2 : src/spaces/promoteur/shared/echangeStudio/mimmozaProjetV2.ts
 *   - mimmozia-studio  : src/core/echange/mimmozaProjetV2.ts
 * Un test de chaque côté compare les deux copies (empreinte SHA-256). Toute
 * modification se fait dans les deux copies en même temps.
 *
 * C'est un FORMAT D'ÉCHANGE, pas un second modèle : chaque application le
 * produit depuis son propre modèle (éditeur 2D / store Studio) et l'applique à
 * son propre modèle. Aucune dépendance : TypeScript pur, sans API de Vite, de
 * Node ou du navigateur hormis TextEncoder/TextDecoder/btoa/atob/URL.
 *
 * Conventions :
 *   - coordonnées géographiques en WGS 84, `{ lon, lat }` en degrés ;
 *   - rotations en degrés, dans le repère « x = est, y = sud » vu du dessus,
 *     sens x → y (même sens que `rotatePoint` du Studio et `rectCorners` du
 *     front) ; 0° = largeur alignée sur l'axe est ;
 *   - longueurs en mètres ;
 *   - `nature` distingue une valeur MESURÉE (relief IGN…), MODÉLISÉE (présente
 *     dans la maquette), ESTIMÉE (calcul indicatif) et VISÉE (objectif du
 *     programme : « 12 logements visés » ne prouve pas 12 logements aménagés) ;
 *   - le contrôle d'implantation transmis est TOUJOURS indicatif : le
 *     destinataire le recalcule avec ses propres règles avant de l'afficher.
 */

export const FORMAT_PROJET = 'mimmoza-projet-v2' as const;
export const VERSION_PROJET = 2 as const;
export const FORMAT_MESSAGE = 'mimmoza-echange-v2' as const;

/** Ancres d'adresse : `#projet=<base64url>`, `#projet-attente=<session>`, `#studio-retour=<base64url>`. */
export const ANCRE_PROJET = 'projet=';
export const ANCRE_PROJET_ATTENTE = 'projet-attente=';
export const ANCRE_RETOUR = 'studio-retour=';
/** Au-delà, la charge ne passe plus par l'adresse : poignée de main `postMessage`. */
export const TAILLE_MAX_URL = 32_000;
/** Au-delà, refus pur et simple (protection mémoire). */
export const TAILLE_MAX_CHARGE = 2_000_000;

export type Nature = 'mesure' | 'modelise' | 'estime' | 'vise';
export type OrigineProjet = 'mimmoza-front' | 'mimmoza-studio';
export type VerdictV2 = 'respecte' | 'non-respecte' | 'a-verifier';
export type StatutValidation = 'non-validee' | 'validee' | 'rejetee';
export type ProvenanceRegle = 'document' | 'saisie' | 'ia' | 'defaut' | 'inconnue';
export type TypePhoto = 'photo' | 'facade' | 'plan' | 'panorama';
export type TypeAcces = 'pieton' | 'vehicule';

export interface LonLat { readonly lon: number; readonly lat: number }

export type GeometrieParcelle =
  | { readonly type: 'Polygon'; readonly coordinates: readonly (readonly (readonly number[])[])[] }
  | { readonly type: 'MultiPolygon'; readonly coordinates: readonly (readonly (readonly (readonly number[])[])[])[] };

export interface ParcelleV2 {
  /** Identifiant cadastral (ex. « 64065000AI0001 »). */
  readonly id: string;
  /** Contour WGS 84 ; null = géométrie non transmise (jamais inventée). */
  readonly geometrie: GeometrieParcelle | null;
}

export interface ReliefV2 {
  readonly nature: 'mesure';
  readonly fournisseur: string;
  readonly renderBounds: readonly [number, number, number, number];
  readonly parcelBounds: readonly [number, number, number, number];
  readonly grille: { readonly n: number; readonly z: readonly (readonly number[])[] };
  readonly altitudeMin: number;
  readonly altitudeMax: number;
  readonly penteMoyenne: number | null;
}

export interface SiteV2 {
  readonly communeInsee: string | null;
  readonly adresse: string | null;
  readonly pointAdresse: LonLat | null;
  readonly parcelles: readonly ParcelleV2[];
  readonly relief: ReliefV2 | null;
  /** Relief volontairement omis d'un retour (inchangé) : le destinataire garde le sien. */
  readonly reliefOmis: boolean;
}

/** Repère local d'implantation de l'émetteur (information ; les positions font foi en WGS 84). */
export interface RepereV2 {
  readonly origine: LonLat;
  readonly rotationDeg: number;
  readonly echelle: number;
  readonly axes: 'x-est-y-sud';
}

export interface AileV2 {
  readonly nom: string;
  readonly largeurM: number;
  readonly profondeurM: number;
  readonly niveaux: number;
  readonly niveauDepart: number;
  readonly retraitM: number;
  /** Décalage du centre de l'aile dans le repère du bâtiment (m). */
  readonly x: number;
  readonly y: number;
}

export interface NiveauEntreeV2 {
  /** Cote d'entrée relative au terrain naturel sous le centre (m). */
  readonly relatifTerrainM: number | null;
  /** Cote d'entrée absolue (m, référentiel du relief) si connue. */
  readonly coteM: number | null;
}

export interface BatimentV2 {
  /** Identifiant stable dans l'échange (ne change pas d'un aller-retour à l'autre). */
  readonly id: string;
  readonly nom: string;
  readonly nature: Nature;
  readonly centre: LonLat;
  readonly rotationDeg: number;
  readonly largeurM: number;
  readonly profondeurM: number;
  /** Niveaux hors sol, rez-de-chaussée compris. */
  readonly niveaux: number;
  readonly hauteurM: number | null;
  readonly niveauEntree: NiveauEntreeV2;
  readonly ailes: readonly AileV2[];
  /** Emprise au sol : anneaux [lon, lat] (ailes réunies) ; vide si non calculée. */
  readonly emprise: readonly (readonly (readonly number[])[])[];
  /** Identifiants natifs de chaque côté (correspondance, jamais d'identité supposée). */
  readonly refs: { readonly front: string | null; readonly studio: string | null };
}

export interface AccesV2 {
  readonly id: string;
  readonly type: TypeAcces;
  readonly position: LonLat;
  readonly largeurM: number | null;
  readonly nature: Nature;
}

export interface ValeurNature { readonly valeur: number; readonly nature: Nature }

export interface ProgrammeV2 {
  readonly logementsVises: number | null;
  readonly logementsModelises: number | null;
  readonly surfacePlancherM2: ValeurNature | null;
  readonly brief: string | null;
  readonly commandeArchitecture: string | null;
}

export interface PhotoV2 {
  readonly id: string;
  readonly nom: string;
  readonly type: TypePhoto;
  /** Adresse https (lien signé) ; jamais de donnée binaire ni d'URI `data:`. */
  readonly url: string | null;
  readonly priseLe: string | null;
  readonly position: LonLat | null;
  readonly directionDeg: number | null;
}

export interface SourceRegleV2 {
  readonly documentId: string | null;
  readonly intitule: string | null;
  readonly article: string | null;
  readonly extrait: string | null;
  readonly page: number | null;
  readonly date: string | null;
}

export interface RegleV2 {
  readonly id: string;
  /** Chemin du champ (ex. « reculs.voirie.min_m »). */
  readonly champ: string;
  readonly categorie: string | null;
  readonly valeur: number | null;
  readonly unite: string | null;
  readonly zone: string | null;
  readonly source: SourceRegleV2;
  readonly provenance: ProvenanceRegle;
  readonly validation: { readonly statut: StatutValidation; readonly par: string | null; readonly le: string | null };
  /**
   * R3 — « contradictoire » : plusieurs règles divergentes de même catégorie coexistent
   * (aucune n'est écartée) ; le verdict qui en dépend est « à vérifier ».
   */
  readonly etat: EtatRegle;
}

export type EtatRegle = 'ordinaire' | 'contradictoire';

export interface LigneControleV2 {
  readonly batimentId: string;
  readonly limiteId: string;
  readonly categorie: string;
  readonly distanceM: number | null;
  readonly minimumM: number | null;
  readonly verdict: VerdictV2;
  readonly raison: string | null;
}

export interface ControleV2 {
  readonly calculePar: OrigineProjet;
  readonly calculeLe: string;
  readonly niveau: string;
  readonly libelle: string;
  readonly lignes: readonly LigneControleV2[];
  /** Toujours vrai : le destinataire recalcule. */
  readonly indicatif: true;
}

export interface SessionV2 {
  readonly id: string;
  readonly conversationId: string | null;
  /** Origine de la page Mimmoza à qui répondre (contrôlée par liste blanche). */
  readonly retourOrigine: string | null;
  /** Adresse (sans ancre) où renvoyer le projet si la fenêtre Mimmoza a été fermée. */
  readonly retourUrl: string | null;
}

/** Champs du format v1 sans équivalent v2 direct, conservés pour ne rien perdre. */
export interface ExtensionsV1 {
  readonly implantation: { readonly lon: number; readonly lat: number; readonly orientationDeg: number; readonly entryOffsetM: number } | null;
  readonly compositionArchitecture: readonly { readonly name: string; readonly commande: string; readonly centreZ: number }[] | null;
  readonly volumeAiles: readonly { readonly name: string; readonly largeurM: number; readonly profondeurM: number; readonly niveaux: number; readonly retraitM: number; readonly x: number; readonly z: number; readonly fromLevelIndex: number | null }[] | null;
}

export interface ProjetMimmozaV2 {
  readonly format: typeof FORMAT_PROJET;
  readonly version: typeof VERSION_PROJET;
  readonly projetId: string;
  readonly etudeId: string | null;
  /** Compteur incrémenté par chaque côté à chaque nouvel envoi. */
  readonly revision: number;
  /** Empreinte de contenu de la version dont celle-ci dérive (null : premier envoi). */
  readonly parentEmpreinte: string | null;
  readonly horodatage: string;
  readonly origine: OrigineProjet;
  readonly session: SessionV2 | null;
  readonly site: SiteV2;
  readonly repere: RepereV2 | null;
  readonly batiments: readonly BatimentV2[];
  readonly acces: readonly AccesV2[];
  readonly programme: ProgrammeV2;
  readonly photos: readonly PhotoV2[];
  readonly regles: readonly RegleV2[];
  readonly controle: ControleV2 | null;
  readonly extensionsV1: ExtensionsV1;
  /**
   * R2 — ce qu'un retour PAR ADRESSE a volontairement retiré (données personnelles,
   * liens signés) : le destinataire le reprend de sa base (`completerDepuisBase`).
   */
  readonly omissions: { readonly validations: boolean; readonly liensPhotos: boolean };
}

export type LectureProjet =
  | { readonly ok: true; readonly projet: ProjetMimmozaV2; readonly migreDepuisV1: boolean; readonly avertissements: readonly string[] }
  | { readonly ok: false; readonly erreur: string };

/* ------------------------------------------------------------------ */
/* Validation stricte                                                  */
/* ------------------------------------------------------------------ */

class ErreurContrat extends Error {}

function echec(chemin: string, motif: string): never {
  throw new ErreurContrat(`${chemin} : ${motif}`);
}

function objet(v: unknown, chemin: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) echec(chemin, 'objet attendu');
  return v as Record<string, unknown>;
}

function tableau(v: unknown, chemin: string, max: number): readonly unknown[] {
  if (!Array.isArray(v)) echec(chemin, 'liste attendue');
  if (v.length > max) echec(chemin, `plus de ${String(max)} éléments`);
  return v;
}

function nombre(v: unknown, chemin: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) echec(chemin, 'nombre fini attendu');
  if (v < min || v > max) echec(chemin, `hors bornes [${String(min)} ; ${String(max)}]`);
  return v;
}

function entier(v: unknown, chemin: string, min: number, max: number): number {
  const n = nombre(v, chemin, min, max);
  if (!Number.isInteger(n)) echec(chemin, 'entier attendu');
  return n;
}

function nombreOuNull(v: unknown, chemin: string, min: number, max: number): number | null {
  return v === null || v === undefined ? null : nombre(v, chemin, min, max);
}

function texte(v: unknown, chemin: string, max: number): string {
  if (typeof v !== 'string') echec(chemin, 'texte attendu');
  if (v.length > max) echec(chemin, `texte de plus de ${String(max)} caractères`);
  return v;
}

function texteNonVide(v: unknown, chemin: string, max: number): string {
  const t = texte(v, chemin, max);
  if (t.trim().length === 0) echec(chemin, 'texte vide');
  return t;
}

function texteOuNull(v: unknown, chemin: string, max: number): string | null {
  return v === null || v === undefined ? null : texte(v, chemin, max);
}

function parmi<T extends string>(v: unknown, chemin: string, valeurs: readonly T[]): T {
  if (typeof v !== 'string' || !(valeurs as readonly string[]).includes(v)) echec(chemin, `valeur attendue parmi ${valeurs.join(', ')}`);
  return v as T;
}

function horodatageValide(v: unknown, chemin: string): string {
  const t = texte(v, chemin, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(t) || Number.isNaN(Date.parse(t))) echec(chemin, 'date ISO 8601 UTC attendue');
  return t;
}

function horodatageOuNull(v: unknown, chemin: string): string | null {
  if (v === null || v === undefined) return null;
  const t = texte(v, chemin, 40);
  if (Number.isNaN(Date.parse(t))) echec(chemin, 'date illisible');
  return t;
}

const RE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
function identifiant(v: unknown, chemin: string): string {
  const t = texte(v, chemin, 80);
  if (!RE_ID.test(t)) echec(chemin, 'identifiant invalide');
  return t;
}
function identifiantOuNull(v: unknown, chemin: string): string | null {
  return v === null || v === undefined ? null : identifiant(v, chemin);
}

const RE_SESSION = /^[A-Za-z0-9-]{8,64}$/;
export function sessionIdValide(v: unknown): v is string {
  return typeof v === 'string' && RE_SESSION.test(v);
}

function lonLat(v: unknown, chemin: string): LonLat {
  const o = objet(v, chemin);
  return { lon: nombre(o['lon'], `${chemin}.lon`, -180, 180), lat: nombre(o['lat'], `${chemin}.lat`, -90, 90) };
}
function lonLatOuNull(v: unknown, chemin: string): LonLat | null {
  return v === null || v === undefined ? null : lonLat(v, chemin);
}

function position(v: unknown, chemin: string): number[] {
  const t = tableau(v, chemin, 3);
  if (t.length < 2) echec(chemin, 'position [lon, lat] attendue');
  return [nombre(t[0], `${chemin}[0]`, -180, 180), nombre(t[1], `${chemin}[1]`, -90, 90)];
}

function anneau(v: unknown, chemin: string): number[][] {
  const t = tableau(v, chemin, 5000);
  if (t.length < 4) echec(chemin, 'anneau de moins de 4 positions');
  return t.map((p, i) => position(p, `${chemin}[${String(i)}]`));
}

function polygone(v: unknown, chemin: string): number[][][] {
  const t = tableau(v, chemin, 100);
  if (t.length < 1) echec(chemin, 'polygone vide');
  return t.map((a, i) => anneau(a, `${chemin}[${String(i)}]`));
}

function geometrie(v: unknown, chemin: string): GeometrieParcelle | null {
  if (v === null || v === undefined) return null;
  const o = objet(v, chemin);
  if (o['type'] === 'Polygon') return { type: 'Polygon', coordinates: polygone(o['coordinates'], `${chemin}.coordinates`) };
  if (o['type'] === 'MultiPolygon') {
    const t = tableau(o['coordinates'], `${chemin}.coordinates`, 200);
    if (t.length < 1) echec(chemin, 'MultiPolygon vide');
    return { type: 'MultiPolygon', coordinates: t.map((p, i) => polygone(p, `${chemin}.coordinates[${String(i)}]`)) };
  }
  return echec(chemin, 'Polygon ou MultiPolygon attendu');
}

function bornes4(v: unknown, chemin: string): readonly [number, number, number, number] {
  const t = tableau(v, chemin, 4);
  if (t.length !== 4) echec(chemin, '4 bornes attendues');
  return [nombre(t[0], chemin, -1e8, 1e8), nombre(t[1], chemin, -1e8, 1e8), nombre(t[2], chemin, -1e8, 1e8), nombre(t[3], chemin, -1e8, 1e8)];
}

function relief(v: unknown, chemin: string): ReliefV2 | null {
  if (v === null || v === undefined) return null;
  const o = objet(v, chemin);
  if (o['nature'] !== 'mesure') echec(`${chemin}.nature`, '« mesure » attendu');
  const g = objet(o['grille'], `${chemin}.grille`);
  const n = entier(g['n'], `${chemin}.grille.n`, 2, 200);
  const lignes = tableau(g['z'], `${chemin}.grille.z`, 200);
  if (lignes.length !== n) echec(`${chemin}.grille.z`, `${String(n)} lignes attendues`);
  const z = lignes.map((l, i) => {
    const ligne = tableau(l, `${chemin}.grille.z[${String(i)}]`, 200);
    if (ligne.length !== n) echec(`${chemin}.grille.z[${String(i)}]`, `${String(n)} valeurs attendues`);
    return ligne.map((x, j) => nombre(x, `${chemin}.grille.z[${String(i)}][${String(j)}]`, -500, 9000));
  });
  return {
    nature: 'mesure',
    fournisseur: texte(o['fournisseur'], `${chemin}.fournisseur`, 80),
    renderBounds: bornes4(o['renderBounds'], `${chemin}.renderBounds`),
    parcelBounds: bornes4(o['parcelBounds'], `${chemin}.parcelBounds`),
    grille: { n, z },
    altitudeMin: nombre(o['altitudeMin'], `${chemin}.altitudeMin`, -500, 9000),
    altitudeMax: nombre(o['altitudeMax'], `${chemin}.altitudeMax`, -500, 9000),
    penteMoyenne: nombreOuNull(o['penteMoyenne'], `${chemin}.penteMoyenne`, 0, 1000),
  };
}

const NATURES: readonly Nature[] = ['mesure', 'modelise', 'estime', 'vise'];
const ORIGINES: readonly OrigineProjet[] = ['mimmoza-front', 'mimmoza-studio'];

function site(v: unknown): SiteV2 {
  const o = objet(v, 'site');
  const parcelles = tableau(o['parcelles'], 'site.parcelles', 40).map((p, i) => {
    const r = objet(p, `site.parcelles[${String(i)}]`);
    return { id: texteNonVide(r['id'], `site.parcelles[${String(i)}].id`, 64), geometrie: geometrie(r['geometrie'], `site.parcelles[${String(i)}].geometrie`) };
  });
  const ids = new Set(parcelles.map((p) => p.id));
  if (ids.size !== parcelles.length) echec('site.parcelles', 'identifiant cadastral en double');
  const rel = relief(o['relief'], 'site.relief');
  if (rel && parcelles.length === 0) echec('site.relief', 'relief sans parcelle pour le situer');
  return {
    communeInsee: texteOuNull(o['communeInsee'], 'site.communeInsee', 10),
    adresse: texteOuNull(o['adresse'], 'site.adresse', 300),
    pointAdresse: lonLatOuNull(o['pointAdresse'], 'site.pointAdresse'),
    parcelles,
    relief: rel,
    reliefOmis: o['reliefOmis'] === true,
  };
}

function repere(v: unknown): RepereV2 | null {
  if (v === null || v === undefined) return null;
  const o = objet(v, 'repere');
  if (o['axes'] !== 'x-est-y-sud') echec('repere.axes', '« x-est-y-sud » attendu');
  return {
    origine: lonLat(o['origine'], 'repere.origine'),
    rotationDeg: nombre(o['rotationDeg'], 'repere.rotationDeg', -360, 360),
    echelle: nombre(o['echelle'], 'repere.echelle', 0.5, 2),
    axes: 'x-est-y-sud',
  };
}

function aile(v: unknown, chemin: string): AileV2 {
  const o = objet(v, chemin);
  const niveaux = entier(o['niveaux'], `${chemin}.niveaux`, 1, 60);
  const niveauDepart = entier(o['niveauDepart'], `${chemin}.niveauDepart`, 0, 59);
  if (niveauDepart >= niveaux) echec(`${chemin}.niveauDepart`, 'doit être inférieur au nombre de niveaux');
  return {
    nom: texte(o['nom'], `${chemin}.nom`, 80),
    largeurM: nombre(o['largeurM'], `${chemin}.largeurM`, 0.5, 300),
    profondeurM: nombre(o['profondeurM'], `${chemin}.profondeurM`, 0.5, 300),
    niveaux,
    niveauDepart,
    retraitM: nombre(o['retraitM'], `${chemin}.retraitM`, -50, 50),
    x: nombre(o['x'], `${chemin}.x`, -300, 300),
    y: nombre(o['y'], `${chemin}.y`, -300, 300),
  };
}

function batiment(v: unknown, i: number): BatimentV2 {
  const c = `batiments[${String(i)}]`;
  const o = objet(v, c);
  const ne = objet(o['niveauEntree'], `${c}.niveauEntree`);
  const refs = objet(o['refs'], `${c}.refs`);
  const emprise = tableau(o['emprise'], `${c}.emprise`, 50).map((a, k) => anneau(a, `${c}.emprise[${String(k)}]`));
  return {
    id: identifiant(o['id'], `${c}.id`),
    nom: texte(o['nom'], `${c}.nom`, 80),
    nature: parmi(o['nature'], `${c}.nature`, NATURES),
    centre: lonLat(o['centre'], `${c}.centre`),
    rotationDeg: nombre(o['rotationDeg'], `${c}.rotationDeg`, -360, 360),
    largeurM: nombre(o['largeurM'], `${c}.largeurM`, 0.5, 300),
    profondeurM: nombre(o['profondeurM'], `${c}.profondeurM`, 0.5, 300),
    niveaux: entier(o['niveaux'], `${c}.niveaux`, 1, 60),
    hauteurM: nombreOuNull(o['hauteurM'], `${c}.hauteurM`, 0, 300),
    niveauEntree: {
      relatifTerrainM: nombreOuNull(ne['relatifTerrainM'], `${c}.niveauEntree.relatifTerrainM`, -10, 10),
      coteM: nombreOuNull(ne['coteM'], `${c}.niveauEntree.coteM`, -500, 9000),
    },
    ailes: tableau(o['ailes'], `${c}.ailes`, 12).map((a, k) => aile(a, `${c}.ailes[${String(k)}]`)),
    emprise,
    refs: { front: identifiantOuNull(refs['front'], `${c}.refs.front`), studio: identifiantOuNull(refs['studio'], `${c}.refs.studio`) },
  };
}

function acces(v: unknown, i: number): AccesV2 {
  const c = `acces[${String(i)}]`;
  const o = objet(v, c);
  return {
    id: identifiant(o['id'], `${c}.id`),
    type: parmi(o['type'], `${c}.type`, ['pieton', 'vehicule'] as const),
    position: lonLat(o['position'], `${c}.position`),
    largeurM: nombreOuNull(o['largeurM'], `${c}.largeurM`, 0.5, 30),
    nature: parmi(o['nature'], `${c}.nature`, NATURES),
  };
}

function valeurNature(v: unknown, chemin: string): ValeurNature | null {
  if (v === null || v === undefined) return null;
  const o = objet(v, chemin);
  return { valeur: nombre(o['valeur'], `${chemin}.valeur`, 0, 1e7), nature: parmi(o['nature'], `${chemin}.nature`, NATURES) };
}

function programme(v: unknown): ProgrammeV2 {
  const o = objet(v, 'programme');
  const lv = o['logementsVises'];
  const lm = o['logementsModelises'];
  return {
    logementsVises: lv === null || lv === undefined ? null : entier(lv, 'programme.logementsVises', 0, 20_000),
    logementsModelises: lm === null || lm === undefined ? null : entier(lm, 'programme.logementsModelises', 0, 20_000),
    surfacePlancherM2: valeurNature(o['surfacePlancherM2'], 'programme.surfacePlancherM2'),
    brief: texteOuNull(o['brief'], 'programme.brief', 2000),
    commandeArchitecture: texteOuNull(o['commandeArchitecture'], 'programme.commandeArchitecture', 1000),
  };
}

/** Une adresse de photo : https, sans donnée binaire embarquée. */
export function urlPhotoAdmise(u: unknown): u is string {
  if (typeof u !== 'string' || u.length > 2000) return false;
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
}

function photo(v: unknown, i: number): PhotoV2 {
  const c = `photos[${String(i)}]`;
  const o = objet(v, c);
  const url = o['url'];
  if (url !== null && url !== undefined && !urlPhotoAdmise(url)) echec(`${c}.url`, 'adresse https attendue (aucune donnée binaire)');
  return {
    id: identifiant(o['id'], `${c}.id`),
    nom: texte(o['nom'], `${c}.nom`, 200),
    type: parmi(o['type'], `${c}.type`, ['photo', 'facade', 'plan', 'panorama'] as const),
    url: (url ?? null) as string | null,
    priseLe: horodatageOuNull(o['priseLe'], `${c}.priseLe`),
    position: lonLatOuNull(o['position'], `${c}.position`),
    directionDeg: nombreOuNull(o['directionDeg'], `${c}.directionDeg`, -360, 360),
  };
}

/** R2/R3 — mots qui ne désignent personne (comparaison mot à mot, sans accents, casse ni chiffres). */
const VALIDATEURS_FACTICES: ReadonlySet<string> = new Set([
  'test', 'tests', 'testeur', 'admin', 'administrateur', 'administrator', 'root', 'user', 'users', 'utilisateur', 'utilisatrice',
  'inconnu', 'inconnue', 'anonyme', 'anonymous', 'na', 'nd', 'aucun', 'aucune', 'personne', 'moi', 'me', 'system', 'systeme',
  'auto', 'automatique', 'ia', 'ai', 'llm', 'gpt', 'chatgpt', 'claude', 'assistant', 'assistante', 'bot', 'robot', 'agent',
  'mimmo', 'mimmoza', 'mimmozia', 'studio', 'jarvis', 'demo', 'exemple', 'example', 'todo', 'tbd', 'completer', 'definir',
  'valideur', 'validateur', 'default', 'defaut', 'null', 'undefined', 'none', 'nobody', 'foo', 'bar', 'toto', 'tata', 'titi',
]);

/**
 * Un validateur exploitable : au moins 4 lettres, et au moins un mot (chiffres retirés)
 * qui ne soit ni générique (admin, test, user, Mimmoza, IA, assistant…) ni une lettre répétée.
 */
export function validateurExploitable(par: string | null): boolean {
  if (par === null) return false;
  const t = par.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if ((t.match(/[a-z]/g) ?? []).length < 4) return false;
  return t.split(' ').some((mot) => mot.length >= 2 && !VALIDATEURS_FACTICES.has(mot) && !/^(.)\1*$/.test(mot));
}

/**
 * R2 — « validée » ou « rejetée » exige un auteur réel ET une date lisible ;
 * sinon la règle redevient « non validée » (déterministe, idempotent).
 */
export function validationNormalisee(statut: StatutValidation, par: string | null, le: string | null): RegleV2['validation'] {
  if (statut === 'non-validee') return { statut, par: null, le: null };
  if (!validateurExploitable(par) || le === null || Number.isNaN(Date.parse(le))) return { statut: 'non-validee', par: null, le: null };
  return { statut, par, le };
}

function regle(v: unknown, i: number): RegleV2 {
  const c = `regles[${String(i)}]`;
  const o = objet(v, c);
  const s = objet(o['source'], `${c}.source`);
  const val = objet(o['validation'], `${c}.validation`);
  const page = s['page'];
  return {
    id: identifiant(o['id'], `${c}.id`),
    champ: texteNonVide(o['champ'], `${c}.champ`, 120),
    categorie: texteOuNull(o['categorie'], `${c}.categorie`, 40),
    valeur: nombreOuNull(o['valeur'], `${c}.valeur`, -1e6, 1e6),
    unite: texteOuNull(o['unite'], `${c}.unite`, 20),
    zone: texteOuNull(o['zone'], `${c}.zone`, 40),
    source: {
      documentId: texteOuNull(s['documentId'], `${c}.source.documentId`, 120),
      intitule: texteOuNull(s['intitule'], `${c}.source.intitule`, 300),
      article: texteOuNull(s['article'], `${c}.source.article`, 120),
      extrait: texteOuNull(s['extrait'], `${c}.source.extrait`, 600),
      page: page === null || page === undefined ? null : entier(page, `${c}.source.page`, 0, 100_000),
      date: texteOuNull(s['date'], `${c}.source.date`, 40),
    },
    provenance: parmi(o['provenance'], `${c}.provenance`, ['document', 'saisie', 'ia', 'defaut', 'inconnue'] as const),
    etat: o['etat'] === undefined || o['etat'] === null ? 'ordinaire' : parmi(o['etat'], `${c}.etat`, ['ordinaire', 'contradictoire'] as const),
    validation: validationNormalisee(
      parmi(val['statut'], `${c}.validation.statut`, ['non-validee', 'validee', 'rejetee'] as const),
      texteOuNull(val['par'], `${c}.validation.par`, 120),
      // R3 — une date illisible n'invalide pas le projet : la règle devient simplement « non validée ».
      texteOuNull(val['le'], `${c}.validation.le`, 40),
    ),
  };
}

function controle(v: unknown): ControleV2 | null {
  if (v === null || v === undefined) return null;
  const o = objet(v, 'controle');
  if (o['indicatif'] !== true) echec('controle.indicatif', 'un contrôle transmis est toujours indicatif');
  return {
    calculePar: parmi(o['calculePar'], 'controle.calculePar', ORIGINES),
    calculeLe: horodatageValide(o['calculeLe'], 'controle.calculeLe'),
    niveau: texte(o['niveau'], 'controle.niveau', 60),
    libelle: texte(o['libelle'], 'controle.libelle', 300),
    lignes: tableau(o['lignes'], 'controle.lignes', 2000).map((l, i) => {
      const c = `controle.lignes[${String(i)}]`;
      const r = objet(l, c);
      return {
        batimentId: texte(r['batimentId'], `${c}.batimentId`, 80),
        limiteId: texte(r['limiteId'], `${c}.limiteId`, 80),
        categorie: texte(r['categorie'], `${c}.categorie`, 40),
        distanceM: nombreOuNull(r['distanceM'], `${c}.distanceM`, -1e4, 1e4),
        minimumM: nombreOuNull(r['minimumM'], `${c}.minimumM`, 0, 1e3),
        verdict: parmi(r['verdict'], `${c}.verdict`, ['respecte', 'non-respecte', 'a-verifier'] as const),
        raison: texteOuNull(r['raison'], `${c}.raison`, 300),
      };
    }),
    indicatif: true,
  };
}

/** Origine web (schéma + hôte + port), http(s) uniquement. */
export function origineWebValide(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 200) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === v;
  } catch { return false; }
}

function session(v: unknown): SessionV2 | null {
  if (v === null || v === undefined) return null;
  const o = objet(v, 'session');
  if (!sessionIdValide(o['id'])) echec('session.id', 'identifiant de session invalide');
  const ro = o['retourOrigine'];
  if (ro !== null && ro !== undefined && !origineWebValide(ro)) echec('session.retourOrigine', 'origine web invalide');
  const ru = o['retourUrl'];
  if (ru !== null && ru !== undefined) {
    let ok = false;
    try {
      const u = new URL(texte(ru, 'session.retourUrl', 2000));
      ok = (u.protocol === 'https:' || u.protocol === 'http:') && u.hash === '' && (ro === null || ro === undefined || u.origin === ro);
    } catch { ok = false; }
    if (!ok) echec('session.retourUrl', 'adresse http(s) sans ancre, de la même origine que retourOrigine, attendue');
  }
  const conv = o['conversationId'];
  if (conv !== null && conv !== undefined && !sessionIdValide(conv)) echec('session.conversationId', 'identifiant invalide');
  return {
    id: o['id'] as string,
    conversationId: (conv ?? null) as string | null,
    retourOrigine: (ro ?? null) as string | null,
    retourUrl: (ru ?? null) as string | null,
  };
}

function extensionsV1(v: unknown): ExtensionsV1 {
  if (v === null || v === undefined) return { implantation: null, compositionArchitecture: null, volumeAiles: null };
  const o = objet(v, 'extensionsV1');
  let implantation: ExtensionsV1['implantation'] = null;
  if (o['implantation'] !== null && o['implantation'] !== undefined) {
    const p = objet(o['implantation'], 'extensionsV1.implantation');
    implantation = {
      lon: nombre(p['lon'], 'extensionsV1.implantation.lon', -180, 180),
      lat: nombre(p['lat'], 'extensionsV1.implantation.lat', -90, 90),
      orientationDeg: nombre(p['orientationDeg'], 'extensionsV1.implantation.orientationDeg', -360, 360),
      entryOffsetM: nombre(p['entryOffsetM'], 'extensionsV1.implantation.entryOffsetM', -2, 5),
    };
  }
  const comp = o['compositionArchitecture'];
  const compositionArchitecture = comp === null || comp === undefined ? null : tableau(comp, 'extensionsV1.compositionArchitecture', 8).map((x, i) => {
    const c = `extensionsV1.compositionArchitecture[${String(i)}]`;
    const r = objet(x, c);
    return { name: texte(r['name'], `${c}.name`, 60), commande: texte(r['commande'], `${c}.commande`, 1000), centreZ: nombre(r['centreZ'], `${c}.centreZ`, -200, 200) };
  });
  const va = o['volumeAiles'];
  const volumeAiles = va === null || va === undefined ? null : tableau(va, 'extensionsV1.volumeAiles', 12).map((x, i) => {
    const c = `extensionsV1.volumeAiles[${String(i)}]`;
    const r = objet(x, c);
    const fl = r['fromLevelIndex'];
    return {
      name: texte(r['name'], `${c}.name`, 60),
      largeurM: nombre(r['largeurM'], `${c}.largeurM`, 1, 100),
      profondeurM: nombre(r['profondeurM'], `${c}.profondeurM`, 1, 100),
      niveaux: entier(r['niveaux'], `${c}.niveaux`, 1, 30),
      retraitM: nombre(r['retraitM'], `${c}.retraitM`, 0, 20),
      x: nombre(r['x'], `${c}.x`, -150, 150),
      z: nombre(r['z'], `${c}.z`, -150, 150),
      fromLevelIndex: fl === null || fl === undefined ? null : entier(fl, `${c}.fromLevelIndex`, 0, 29),
    };
  });
  return { implantation, compositionArchitecture, volumeAiles };
}

/** R2 — identifiants uniques (règles, photos) : un doublon est refusé, jamais départagé au hasard. */
function unicite<T extends { readonly id: string }>(liste: T[], chemin: string): T[] {
  if (new Set(liste.map((x) => x.id)).size !== liste.length) echec(chemin, 'identifiant en double');
  return liste;
}

function omissions(v: unknown): ProjetMimmozaV2['omissions'] {
  if (v === null || v === undefined) return { validations: false, liensPhotos: false };
  const o = objet(v, 'omissions');
  return { validations: o['validations'] === true, liensPhotos: o['liensPhotos'] === true };
}

const CLES: Readonly<Record<string, readonly string[]>> = {
  projet: ['format', 'version', 'projetId', 'etudeId', 'revision', 'parentEmpreinte', 'horodatage', 'origine', 'session', 'site', 'repere', 'batiments', 'acces', 'programme', 'photos', 'regles', 'controle', 'extensionsV1', 'omissions'],
  site: ['communeInsee', 'adresse', 'pointAdresse', 'parcelles', 'relief', 'reliefOmis'],
  batiments: ['id', 'nom', 'nature', 'centre', 'rotationDeg', 'largeurM', 'profondeurM', 'niveaux', 'hauteurM', 'niveauEntree', 'ailes', 'emprise', 'refs'],
  acces: ['id', 'type', 'position', 'largeurM', 'nature'],
  programme: ['logementsVises', 'logementsModelises', 'surfacePlancherM2', 'brief', 'commandeArchitecture'],
  photos: ['id', 'nom', 'type', 'url', 'priseLe', 'position', 'directionDeg'],
  regles: ['id', 'champ', 'categorie', 'valeur', 'unite', 'zone', 'source', 'provenance', 'validation', 'etat'],
};

/** R3 — avertit des champs inconnus (version future enrichie) : ils ne sont pas conservés. */
function champsInconnus(o: Record<string, unknown>): string[] {
  const inconnus: string[] = [];
  const verifier = (v: unknown, cles: readonly string[], chemin: string): void => {
    if (typeof v !== 'object' || v === null) return;
    for (const k of Object.keys(v)) if (!cles.includes(k)) inconnus.push(`${chemin}${k}`);
  };
  verifier(o, CLES['projet']!, '');
  verifier(o['site'], CLES['site']!, 'site.');
  verifier(o['programme'], CLES['programme']!, 'programme.');
  for (const liste of ['batiments', 'acces', 'photos', 'regles'] as const) {
    const t = o[liste];
    if (Array.isArray(t)) t.forEach((x, i) => verifier(x, CLES[liste]!, `${liste}[${String(i)}].`));
  }
  return inconnus.length > 0 ? [`champs inconnus ignorés (version plus récente ?) : ${inconnus.slice(0, 20).join(', ')}${inconnus.length > 20 ? '…' : ''}`] : [];
}

/** Valide une valeur supposée v2 ; rend une copie propre (ordre de clés fixe). */
export function validerProjet(v: unknown): LectureProjet {
  try {
    const o = objet(v, 'projet');
    if (o['format'] !== FORMAT_PROJET || o['version'] !== VERSION_PROJET) echec('projet', `format ${FORMAT_PROJET} version 2 attendu`);
    const batiments = tableau(o['batiments'], 'batiments', 20).map(batiment);
    if (new Set(batiments.map((b) => b.id)).size !== batiments.length) echec('batiments', 'identifiant de bâtiment en double');
    const accesListe = tableau(o['acces'], 'acces', 10).map(acces);
    if (new Set(accesListe.map((a) => a.id)).size !== accesListe.length) echec('acces', 'identifiant d’accès en double');
    const pe = o['parentEmpreinte'];
    if (pe !== null && pe !== undefined && (typeof pe !== 'string' || !/^[0-9a-f]{16}$/.test(pe))) echec('parentEmpreinte', 'empreinte invalide');
    const projet: ProjetMimmozaV2 = {
      format: FORMAT_PROJET,
      version: VERSION_PROJET,
      projetId: identifiant(o['projetId'], 'projetId'),
      etudeId: identifiantOuNull(o['etudeId'], 'etudeId'),
      revision: entier(o['revision'], 'revision', 0, 1e9),
      parentEmpreinte: (pe ?? null) as string | null,
      horodatage: horodatageValide(o['horodatage'], 'horodatage'),
      origine: parmi(o['origine'], 'origine', ORIGINES),
      session: session(o['session']),
      site: site(o['site']),
      repere: repere(o['repere']),
      batiments,
      acces: accesListe,
      programme: programme(o['programme']),
      photos: unicite(tableau(o['photos'], 'photos', 30).map(photo), 'photos'),
      regles: unicite(tableau(o['regles'], 'regles', 200).map(regle), 'regles'),
      controle: controle(o['controle']),
      extensionsV1: extensionsV1(o['extensionsV1']),
      omissions: omissions(o['omissions']),
    };
    return { ok: true, projet, migreDepuisV1: false, avertissements: champsInconnus(o) };
  } catch (e) {
    if (e instanceof ErreurContrat) return { ok: false, erreur: `projet Mimmoza invalide — ${e.message}` };
    return { ok: false, erreur: 'projet Mimmoza illisible' };
  }
}

/* ------------------------------------------------------------------ */
/* Encodage base64url (UTF-8)                                          */
/* ------------------------------------------------------------------ */

export function versBase64Url(texteJson: string): string {
  const octets = new TextEncoder().encode(texteJson);
  let bin = '';
  for (let i = 0; i < octets.length; i += 0x8000) bin += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function depuisBase64Url(code: string): string {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const octets = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) octets[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(octets);
}

export function encoderProjet(projet: ProjetMimmozaV2): string {
  return versBase64Url(JSON.stringify(projet));
}

/** Décode une charge base64url (v2, ou v1 migrée si `contexteV1` est fourni). */
export function decoderProjet(code: string, contexteV1?: ContexteMigration): LectureProjet {
  if (code.length === 0) return { ok: false, erreur: 'projet Mimmoza absent' };
  if (code.length > TAILLE_MAX_CHARGE) return { ok: false, erreur: 'projet Mimmoza trop volumineux' };
  let valeur: unknown;
  try { valeur = JSON.parse(depuisBase64Url(code)); } catch { return { ok: false, erreur: 'projet Mimmoza illisible' }; }
  return lireEchange(valeur, contexteV1);
}

/* ------------------------------------------------------------------ */
/* Migration v1 → v2 (et retour vers la charge v1 pour les importeurs) */
/* ------------------------------------------------------------------ */

export interface ContexteMigration {
  readonly projetId: string;
  readonly etudeId: string | null;
  readonly horodatage: string;
}

/** Lit une valeur d'échange : v2 telle quelle, v1 migrée (contexte requis). */
export function lireEchange(valeur: unknown, contexteV1?: ContexteMigration): LectureProjet {
  const o = typeof valeur === 'object' && valeur !== null ? (valeur as Record<string, unknown>) : null;
  if (o && o['version'] === 1 && o['source'] === 'mimmoza-front-v2') {
    if (!contexteV1) return { ok: false, erreur: 'charge v1 : contexte de migration absent' };
    return migrerV1versV2(valeur, contexteV1);
  }
  return validerProjet(valeur);
}

function geometrieDeFeature(feature: unknown): unknown {
  if (typeof feature !== 'object' || feature === null) return null;
  const f = feature as Record<string, unknown>;
  const g = f['type'] === 'Feature' ? f['geometry'] : f;
  if (typeof g !== 'object' || g === null) return null;
  const r = g as Record<string, unknown>;
  return { type: r['type'], coordinates: r['coordinates'] };
}

/**
 * v1 (`#parcelles=`, `version: 1, source: "mimmoza-front-v2"`) → v2.
 * Aucun champ v1 n'est perdu : ce qui n'a pas d'équivalent v2 va dans `extensionsV1`.
 */
export function migrerV1versV2(valeur: unknown, ctx: ContexteMigration): LectureProjet {
  const v = typeof valeur === 'object' && valeur !== null ? (valeur as Record<string, unknown>) : null;
  if (!v || v['version'] !== 1 || v['source'] !== 'mimmoza-front-v2') return { ok: false, erreur: 'charge v1 Mimmoza attendue' };
  const td = v['terrainData'] as Record<string, unknown> | null | undefined;
  const grid = td && typeof td === 'object' ? (td['grid'] as Record<string, unknown> | undefined) : undefined;
  const pa = v['pointAdresse'] as Record<string, unknown> | null | undefined;
  const avertissements: string[] = [];
  // R2 — une photo sans adresse https (ex. `data:`) est ÉCARTÉE avec un avertissement, sans faire échouer la migration.
  const photosV1 = (cle: string, type: TypePhoto): unknown[] => (Array.isArray(v[cle]) ? (v[cle] as unknown[]) : []).flatMap((x, i) => {
    const r = typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {};
    if (r['url'] !== null && r['url'] !== undefined && !urlPhotoAdmise(r['url'])) {
      avertissements.push(`${type} n° ${String(i + 1)} ignorée : adresse non https (aucune donnée binaire n'est transmise)`);
      return [];
    }
    return [{ id: `${type}-${String(i + 1)}`, nom: typeof r['nom'] === 'string' ? r['nom'] : 'fichier', type, url: r['url'] ?? null, priseLe: null, position: null, directionDeg: null }];
  });
  const sessionV1 = typeof v['bridgeSessionId'] === 'string'
    ? { id: v['bridgeSessionId'], conversationId: v['conversationId'] ?? null, retourOrigine: v['openerOrigin'] ?? null, retourUrl: null }
    : null;
  const va = v['volumeAiles'];
  const brut = {
    format: FORMAT_PROJET,
    version: VERSION_PROJET,
    projetId: ctx.projetId,
    etudeId: ctx.etudeId,
    revision: 0,
    parentEmpreinte: null,
    horodatage: ctx.horodatage,
    origine: 'mimmoza-front',
    session: sessionV1,
    site: {
      communeInsee: v['communeInsee'] ?? null,
      adresse: v['adresse'] ?? null,
      pointAdresse: pa && typeof pa === 'object' ? { lon: pa['lon'], lat: pa['lat'] } : null,
      parcelles: (Array.isArray(v['parcels']) ? (v['parcels'] as unknown[]) : []).map((p) => {
        const r = typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : {};
        return { id: r['id'], geometrie: geometrieDeFeature(r['feature']) };
      }),
      relief: td && typeof td === 'object'
        ? { nature: 'mesure', fournisseur: td['provider'] ?? 'inconnu', renderBounds: td['renderBounds'], parcelBounds: td['parcelBounds'],
            grille: { n: grid?.['n'], z: grid?.['z'] }, altitudeMin: td['altitudeMin'], altitudeMax: td['altitudeMax'], penteMoyenne: td['penteMoyenne'] ?? null }
        : null,
      reliefOmis: false,
    },
    repere: null,
    batiments: [],
    acces: (Array.isArray(v['accesses']) ? (v['accesses'] as unknown[]) : []).map((a, i) => {
      const r = typeof a === 'object' && a !== null ? (a as Record<string, unknown>) : {};
      return { id: `acces-${String(r['kind'])}-${String(i + 1)}`, type: r['kind'], position: { lon: r['lon'], lat: r['lat'] }, largeurM: null, nature: 'modelise' };
    }),
    programme: {
      logementsVises: null,
      logementsModelises: null,
      surfacePlancherM2: null,
      brief: typeof v['brief'] === 'string' && v['brief'] ? v['brief'] : null,
      commandeArchitecture: typeof v['commandeArchitecture'] === 'string' && v['commandeArchitecture'] ? v['commandeArchitecture'] : null,
    },
    photos: [...photosV1('panoramas', 'panorama'), ...photosV1('facades', 'facade'), ...photosV1('plans', 'plan')],
    regles: [],
    controle: null,
    extensionsV1: {
      implantation: v['implantation'] ?? null,
      compositionArchitecture: v['compositionArchitecture'] ?? null,
      volumeAiles: Array.isArray(va)
        ? va.map((x: unknown) => (typeof x === 'object' && x !== null ? { ...(x as Record<string, unknown>), fromLevelIndex: (x as Record<string, unknown>)['fromLevelIndex'] ?? null } : x))
        : null,
    },
  };
  const lu = validerProjet(brut);
  return lu.ok ? { ok: true, projet: lu.projet, migreDepuisV1: true, avertissements } : { ok: false, erreur: `migration v1 → v2 impossible — ${lu.erreur}` };
}

/** Charge v1 équivalente (pour les importeurs historiques du Studio). Les champs v2 sans équivalent v1 n'y figurent pas. */
export function versChargeV1(p: ProjetMimmozaV2): Record<string, unknown> {
  const photos = (type: TypePhoto): { url: string; nom: string }[] =>
    p.photos.filter((x) => x.type === type && x.url !== null).map((x) => ({ url: x.url as string, nom: x.nom }));
  const r = p.site.relief;
  const ext = p.extensionsV1;
  const panoramas = photos('panorama');
  const facades = photos('facade');
  const plans = photos('plan');
  return {
    version: 1,
    source: 'mimmoza-front-v2',
    ...(p.session && p.session.conversationId && p.session.retourOrigine
      ? { bridgeSessionId: p.session.id, conversationId: p.session.conversationId, openerOrigin: p.session.retourOrigine } : {}),
    communeInsee: p.site.communeInsee,
    adresse: p.site.adresse,
    pointAdresse: p.site.pointAdresse ? { lat: p.site.pointAdresse.lat, lon: p.site.pointAdresse.lon } : null,
    parcels: p.site.parcelles.map((x) => ({ id: x.id, feature: x.geometrie ? { type: 'Feature', properties: {}, geometry: x.geometrie } : null })),
    ...(r ? { terrainData: { provider: r.fournisseur, renderBounds: r.renderBounds, parcelBounds: r.parcelBounds, grid: { z: r.grille.z, n: r.grille.n }, altitudeMin: r.altitudeMin, altitudeMax: r.altitudeMax, penteMoyenne: r.penteMoyenne } } : {}),
    ...(ext.implantation ? { implantation: ext.implantation } : {}),
    ...(p.acces.length > 0 ? { accesses: p.acces.map((a) => ({ kind: a.type, lon: a.position.lon, lat: a.position.lat })) } : {}),
    ...(panoramas.length > 0 ? { panoramas } : {}),
    ...(p.programme.brief ? { brief: p.programme.brief } : {}),
    ...(p.programme.commandeArchitecture ? { commandeArchitecture: p.programme.commandeArchitecture } : {}),
    ...(ext.compositionArchitecture ? { compositionArchitecture: ext.compositionArchitecture } : {}),
    ...(ext.volumeAiles
      ? { volumeAiles: ext.volumeAiles.map((x) => ({ name: x.name, largeurM: x.largeurM, profondeurM: x.profondeurM, niveaux: x.niveaux, retraitM: x.retraitM, x: x.x, z: x.z, ...(x.fromLevelIndex === null ? {} : { fromLevelIndex: x.fromLevelIndex }) })) }
      : {}),
    ...(facades.length > 0 ? { facades } : {}),
    ...(plans.length > 0 ? { plans } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Empreinte de contenu, différences, conflits                          */
/* ------------------------------------------------------------------ */

function arrondi(v: number, pas: number): number {
  return Number((Math.round(v / pas) * pas).toFixed(9)) + 0;
}

/**
 * Contenu comparé (quantifié : 1e-7° ≈ 1 cm, 1 cm, 0,01°), hors métadonnées de transport, hors emprise,
 * hors hauteur dérivée et hors contrôle (recalculés). R2 : mêmes champs que `comparerProjets`.
 */
function contenuCanonique(p: ProjetMimmozaV2): unknown {
  const ll = (x: LonLat | null): number[] | null => (x ? [arrondi(x.lon, 1e-7), arrondi(x.lat, 1e-7)] : null);
  const m = (x: number | null): number | null => (x === null ? null : arrondi(x, 0.01));
  const geo = (g: GeometrieParcelle | null): string | null =>
    g ? JSON.stringify(g, (_k: string, val: unknown) => (typeof val === 'number' ? arrondi(val, 1e-7) : val)) : null;
  return {
    site: [p.site.communeInsee, p.site.adresse, ll(p.site.pointAdresse)],
    parcelles: p.site.parcelles.map((x) => [x.id, geo(x.geometrie)]),
    relief: p.site.reliefOmis ? 'omis' : p.site.relief,
    batiments: [...p.batiments].sort((a, b) => a.id.localeCompare(b.id)).map((b) => [
      b.id, b.nom, b.nature, ll(b.centre), arrondi((((b.rotationDeg % 360) + 360) % 360), 0.01) % 360, m(b.largeurM), m(b.profondeurM), b.niveaux,
      m(b.niveauEntree.relatifTerrainM), m(b.niveauEntree.coteM), b.ailes.map((a) => [a.nom, m(a.largeurM), m(a.profondeurM), a.niveaux, a.niveauDepart, m(a.retraitM), m(a.x), m(a.y)]),
    ]),
    acces: [...p.acces].sort((a, b) => a.id.localeCompare(b.id)).map((a) => [a.id, a.type, ll(a.position), m(a.largeurM), a.nature]),
    programme: p.programme,
    photos: p.photos,
    regles: [...p.regles].sort((a, b) => a.id.localeCompare(b.id)),
    extensionsV1: p.extensionsV1,
  };
}

function fnv1a(texteSource: string, graine: number): string {
  let h = graine >>> 0;
  for (let i = 0; i < texteSource.length; i += 1) {
    h ^= texteSource.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Empreinte de CONTENU (16 hex) : deux projets identiques au centimètre près ont la même. */
export function empreinteProjet(p: ProjetMimmozaV2): string {
  const s = JSON.stringify(contenuCanonique(p));
  return fnv1a(s, 0x811c9dc5) + fnv1a(s, 0x01234567);
}

/** Distance approchée entre deux points WGS 84 (m), équirectangulaire (≈ 0,5 % près). */
export function distanceM(a: LonLat, b: LonLat): number {
  const latM = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dx = (b.lon - a.lon) * 111_320 * Math.cos(latM);
  const dy = (b.lat - a.lat) * 110_574;
  return Math.hypot(dx, dy);
}

export type TypeChangement =
  | 'batiment-ajoute' | 'batiment-supprime' | 'renommage' | 'nature' | 'deplacement' | 'rotation' | 'dimensions' | 'niveaux' | 'hauteur'
  | 'niveau-entree' | 'ailes' | 'acces-ajoute' | 'acces-supprime' | 'acces-deplace' | 'acces-modifie' | 'programme' | 'regle'
  | 'parcelles' | 'site' | 'photos' | 'autre';

export interface Changement {
  readonly type: TypeChangement;
  readonly cible: string;
  readonly libelle: string;
}

export const SEUIL_DEPLACEMENT_M = 0.05;
export const SEUIL_ROTATION_DEG = 0.1;
export const SEUIL_DIMENSION_M = 0.05;

/** Nombre au format français (« 2,3 »). */
export function nombreFr(v: number, decimales = 1): string {
  const t = v.toFixed(decimales).replace('.', ',');
  return /^-0(,0*)?$/.test(t) ? t.slice(1) : t;
}

/** Écart angulaire signé de a vers b, dans ]-180 ; 180]. */
export function ecartAngle(a: number, b: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

const ecartNombre = (a: number | null, b: number | null, tol: number): boolean => (a === null || b === null ? a !== b : Math.abs(a - b) > tol);
const json = (x: unknown): string => JSON.stringify(x);

/**
 * Ce qui a changé de `avant` à `apres`, en phrases lisibles (« bâtiment A déplacé de 2,3 m »).
 * R2 : TOUT champ du contenu est couvert (nom, nature, cote d'entrée, accès, unité et source
 * des règles, programme, photos, site, extensions) ; seuls les métadonnées de transport,
 * le repère, l'emprise (dérivée) et le contrôle (recalculé) sont hors comparaison.
 */
export function comparerProjets(avant: ProjetMimmozaV2, apres: ProjetMimmozaV2): Changement[] {
  const ch: Changement[] = [];
  const fr = nombreFr;
  const nomB = (b: BatimentV2): string => `bâtiment ${b.nom || b.id}`;
  const parId = new Map(avant.batiments.map((b) => [b.id, b] as const));
  for (const b of apres.batiments) {
    const a = parId.get(b.id);
    if (!a) {
      ch.push({ type: 'batiment-ajoute', cible: b.id, libelle: `${nomB(b)} ajouté (${fr(b.largeurM)} × ${fr(b.profondeurM)} m, ${String(b.niveaux)} niveau${b.niveaux > 1 ? 'x' : ''})` });
      continue;
    }
    if (a.nom !== b.nom) ch.push({ type: 'renommage', cible: b.id, libelle: `${nomB(a)} renommé « ${b.nom} »` });
    if (a.nature !== b.nature) ch.push({ type: 'nature', cible: b.id, libelle: `${nomB(b)} : ${a.nature} → ${b.nature}` });
    const d = distanceM(a.centre, b.centre);
    if (d > SEUIL_DEPLACEMENT_M) ch.push({ type: 'deplacement', cible: b.id, libelle: `${nomB(b)} déplacé de ${fr(d)} m` });
    const r = ecartAngle(a.rotationDeg, b.rotationDeg);
    if (Math.abs(r) > SEUIL_ROTATION_DEG) ch.push({ type: 'rotation', cible: b.id, libelle: `${nomB(b)} tourné de ${fr(r)}°` });
    if (Math.abs(a.largeurM - b.largeurM) > SEUIL_DIMENSION_M || Math.abs(a.profondeurM - b.profondeurM) > SEUIL_DIMENSION_M) {
      ch.push({ type: 'dimensions', cible: b.id, libelle: `${nomB(b)} : ${fr(a.largeurM)} × ${fr(a.profondeurM)} m → ${fr(b.largeurM)} × ${fr(b.profondeurM)} m` });
    }
    if (a.niveaux !== b.niveaux) ch.push({ type: 'niveaux', cible: b.id, libelle: `${nomB(b)} : ${String(a.niveaux)} → ${String(b.niveaux)} niveaux` });
    if (ecartNombre(a.hauteurM, b.hauteurM, SEUIL_DIMENSION_M)) {
      ch.push({ type: 'hauteur', cible: b.id, libelle: `${nomB(b)} : hauteur ${a.hauteurM === null ? '?' : fr(a.hauteurM)} → ${b.hauteurM === null ? '?' : fr(b.hauteurM)} m` });
    }
    const ea = a.niveauEntree.relatifTerrainM;
    const eb = b.niveauEntree.relatifTerrainM;
    if (ecartNombre(ea, eb, 0.02)) {
      ch.push({ type: 'niveau-entree', cible: b.id, libelle: `${nomB(b)} : entrée ${ea === null ? '?' : `${fr(ea, 2)} m`} → ${eb === null ? '?' : `${fr(eb, 2)} m`} par rapport au terrain naturel` });
    }
    if (ecartNombre(a.niveauEntree.coteM, b.niveauEntree.coteM, 0.02)) {
      ch.push({ type: 'niveau-entree', cible: b.id, libelle: `${nomB(b)} : cote d’entrée ${a.niveauEntree.coteM === null ? '?' : fr(a.niveauEntree.coteM, 2)} → ${b.niveauEntree.coteM === null ? '?' : fr(b.niveauEntree.coteM, 2)} m` });
    }
    if (json(a.ailes) !== json(b.ailes)) ch.push({ type: 'ailes', cible: b.id, libelle: `${nomB(b)} : ailes modifiées (${String(a.ailes.length)} → ${String(b.ailes.length)})` });
  }
  const nouveaux = new Set(apres.batiments.map((b) => b.id));
  for (const a of avant.batiments) if (!nouveaux.has(a.id)) ch.push({ type: 'batiment-supprime', cible: a.id, libelle: `${nomB(a)} supprimé` });

  const nomAcces = (t: TypeAcces): string => `accès ${t === 'pieton' ? 'piéton' : 'véhicule'}`;
  const accAvant = new Map(avant.acces.map((x) => [x.id, x] as const));
  for (const x of apres.acces) {
    const a = accAvant.get(x.id);
    if (!a) { ch.push({ type: 'acces-ajoute', cible: x.id, libelle: `${nomAcces(x.type)} ajouté` }); continue; }
    const d = distanceM(a.position, x.position);
    if (d > SEUIL_DEPLACEMENT_M) ch.push({ type: 'acces-deplace', cible: x.id, libelle: `${nomAcces(x.type)} déplacé de ${fr(d)} m` });
    if (a.type !== x.type) ch.push({ type: 'acces-modifie', cible: x.id, libelle: `${nomAcces(a.type)} devenu ${nomAcces(x.type)}` });
    if (ecartNombre(a.largeurM, x.largeurM, 0.01)) ch.push({ type: 'acces-modifie', cible: x.id, libelle: `${nomAcces(x.type)} : largeur ${a.largeurM === null ? '?' : fr(a.largeurM)} → ${x.largeurM === null ? '?' : fr(x.largeurM)} m` });
    if (a.nature !== x.nature) ch.push({ type: 'acces-modifie', cible: x.id, libelle: `${nomAcces(x.type)} : ${a.nature} → ${x.nature}` });
  }
  const accApres = new Set(apres.acces.map((x) => x.id));
  for (const a of avant.acces) if (!accApres.has(a.id)) ch.push({ type: 'acces-supprime', cible: a.id, libelle: `${nomAcces(a.type)} supprimé` });

  const pa = avant.programme;
  const pb = apres.programme;
  if (pa.logementsVises !== pb.logementsVises) ch.push({ type: 'programme', cible: 'logementsVises', libelle: `logements visés : ${String(pa.logementsVises ?? '?')} → ${String(pb.logementsVises ?? '?')}` });
  if (pa.logementsModelises !== pb.logementsModelises) ch.push({ type: 'programme', cible: 'logementsModelises', libelle: `logements modélisés : ${String(pa.logementsModelises ?? '?')} → ${String(pb.logementsModelises ?? '?')}` });
  if (json(pa.surfacePlancherM2) !== json(pb.surfacePlancherM2)) ch.push({ type: 'programme', cible: 'surfacePlancherM2', libelle: `surface de plancher : ${pa.surfacePlancherM2 ? `${String(pa.surfacePlancherM2.valeur)} m² (${pa.surfacePlancherM2.nature})` : '?'} → ${pb.surfacePlancherM2 ? `${String(pb.surfacePlancherM2.valeur)} m² (${pb.surfacePlancherM2.nature})` : '?'}` });
  if (pa.brief !== pb.brief) ch.push({ type: 'programme', cible: 'brief', libelle: 'description du projet modifiée' });
  if (pa.commandeArchitecture !== pb.commandeArchitecture) ch.push({ type: 'programme', cible: 'commandeArchitecture', libelle: 'commande d’architecture modifiée' });

  const rAvant = new Map(avant.regles.map((r) => [r.id, r] as const));
  for (const r of apres.regles) {
    const a = rAvant.get(r.id);
    if (!a) ch.push({ type: 'regle', cible: r.id, libelle: `règle ${r.champ} ajoutée (${r.valeur === null ? 'sans valeur' : String(r.valeur)})${r.etat === 'contradictoire' ? ' — contradictoire, à vérifier' : ''}` });
    else if (a.valeur !== r.valeur || a.validation.statut !== r.validation.statut) {
      ch.push({ type: 'regle', cible: r.id, libelle: `règle ${r.champ} : ${String(a.valeur)} (${a.validation.statut}) → ${String(r.valeur)} (${r.validation.statut})` });
    } else if (a.etat !== r.etat) {
      ch.push({ type: 'regle', cible: r.id, libelle: `règle ${r.champ} : ${r.etat === 'contradictoire' ? 'contredite par une autre règle — à vérifier' : 'plus contredite'}` });
    } else if (json(a) !== json(r)) {
      ch.push({ type: 'regle', cible: r.id, libelle: `règle ${r.champ} : unité, catégorie, source, zone ou validation modifiée` });
    }
  }
  const rApres = new Set(apres.regles.map((r) => r.id));
  for (const a of avant.regles) if (!rApres.has(a.id)) ch.push({ type: 'regle', cible: a.id, libelle: `règle ${a.champ} retirée` });

  const idsParcelles = (p: ProjetMimmozaV2): string => p.site.parcelles.map((x) => x.id).join(', ');
  if (idsParcelles(avant) !== idsParcelles(apres)) ch.push({ type: 'parcelles', cible: 'site', libelle: `parcelles : ${idsParcelles(avant) || 'aucune'} → ${idsParcelles(apres) || 'aucune'}` });
  else if (avant.site.parcelles.some((x, i) => json(x.geometrie) !== json(apres.site.parcelles[i]?.geometrie))) {
    ch.push({ type: 'parcelles', cible: 'site', libelle: 'contour des parcelles modifié' });
  }
  if (!apres.site.reliefOmis && !avant.site.reliefOmis && json(avant.site.relief) !== json(apres.site.relief)) ch.push({ type: 'parcelles', cible: 'relief', libelle: 'relief modifié' });
  if (avant.site.communeInsee !== apres.site.communeInsee || avant.site.adresse !== apres.site.adresse
    || (avant.site.pointAdresse === null) !== (apres.site.pointAdresse === null)
    || (avant.site.pointAdresse && apres.site.pointAdresse && distanceM(avant.site.pointAdresse, apres.site.pointAdresse) > SEUIL_DEPLACEMENT_M)) {
    ch.push({ type: 'site', cible: 'site', libelle: 'commune, adresse ou point d’adresse modifié' });
  }
  const phAvant = new Map(avant.photos.map((x) => [x.id, x] as const));
  const phApres = new Set(apres.photos.map((x) => x.id));
  for (const x of apres.photos) {
    const a = phAvant.get(x.id);
    if (!a) ch.push({ type: 'photos', cible: x.id, libelle: `photo ou référence « ${x.nom} » ajoutée` });
    else if (json(a) !== json(x) && !(apres.omissions.liensPhotos && x.url === null && json({ ...a, url: null }) === json(x))) {
      ch.push({ type: 'photos', cible: x.id, libelle: `photo ou référence « ${x.nom} » modifiée` });
    }
  }
  for (const a of avant.photos) if (!phApres.has(a.id)) ch.push({ type: 'photos', cible: a.id, libelle: `photo ou référence « ${a.nom} » retirée` });
  if (json(avant.extensionsV1) !== json(apres.extensionsV1)) ch.push({ type: 'autre', cible: 'extensionsV1', libelle: 'données héritées du tchat (implantation, composition) modifiées' });
  return ch;
}

export type EtatSynchro = 'sans-base' | 'distant-inchange' | 'distant-seul' | 'convergent' | 'conflit';

/** Même contenu à la tolérance de `comparerProjets` (5 cm, 0,1°) : insensible au bruit des projections. */
export function memeContenu(a: ProjetMimmozaV2, b: ProjetMimmozaV2): boolean {
  return comparerProjets(a, b).length === 0;
}

/**
 * Trois versions : `base` = dernier état échangé et accepté, `local` = état
 * actuel de ce côté, `distant` = ce que l'autre côté vient d'envoyer.
 * « conflit » = les deux ont changé, différemment : à signaler, jamais écraser.
 * `dernierEnvoye` (facultatif) : la dernière version envoyée par ce côté ; si
 * l'autre côté en est reparti (`parentEmpreinte`) et que rien n'a bougé ici
 * depuis, ce n'est pas un conflit.
 */
export function etatSynchronisation(
  base: ProjetMimmozaV2 | null,
  local: ProjetMimmozaV2 | null,
  distant: ProjetMimmozaV2,
  dernierEnvoye: ProjetMimmozaV2 | null = null,
): EtatSynchro {
  if (!base) return 'sans-base';
  if (memeContenu(base, distant)) return 'distant-inchange';
  if (!local || memeContenu(base, local)) return 'distant-seul';
  if (memeContenu(local, distant)) return 'convergent';
  if (dernierEnvoye && distant.parentEmpreinte !== null && distant.parentEmpreinte === empreinteProjet(dernierEnvoye) && memeContenu(local, dernierEnvoye)) return 'distant-seul';
  return 'conflit';
}

/** R3 — saut de révision maximal admis entre deux versions reçues. */
export const SAUT_REVISION_MAX = 1_000_000;

/**
 * R3 — une révision reçue est vraisemblable si elle ne saute pas de plus de 10⁶ par
 * rapport à la référence et ne dépasse pas l'horodatage exprimé en secondes.
 */
export function revisionVraisemblable(p: ProjetMimmozaV2, reference: number | null): boolean {
  const secondes = Math.floor(Date.parse(p.horodatage) / 1000);
  return p.revision <= secondes && p.revision - (reference ?? 0) <= SAUT_REVISION_MAX;
}

/** Nouvelle révision émise par `origine` à partir de `p`, dérivée de la base acceptée. */
export function nouvelleRevision(p: ProjetMimmozaV2, origine: OrigineProjet, horodatage: string, base: ProjetMimmozaV2 | null): ProjetMimmozaV2 {
  return { ...p, origine, horodatage, revision: (base ? base.revision : p.revision) + 1, parentEmpreinte: base ? empreinteProjet(base) : null };
}

/* ------------------------------------------------------------------ */
/* Transport : messages, origines, ancres                               */
/* ------------------------------------------------------------------ */

export type CanalEchange = 'bonjour' | 'pret' | 'projet' | 'retour' | 'recu';

export interface MessageEchange {
  readonly format: typeof FORMAT_MESSAGE;
  readonly canal: CanalEchange;
  readonly sessionId: string;
  /** `pret` : le Studio attend la charge (elle n'est pas passée par l'adresse). */
  readonly attendProjet: boolean;
  readonly projet: ProjetMimmozaV2 | null;
}

export function creerMessage(canal: CanalEchange, sessionId: string, projet: ProjetMimmozaV2 | null = null, attendProjet = false): MessageEchange {
  return { format: FORMAT_MESSAGE, canal, sessionId, attendProjet, projet };
}

export type LectureMessage = { readonly ok: true; readonly message: MessageEchange } | { readonly ok: false; readonly erreur: string };

/** Valide la FORME d'un message reçu (l'origine se contrôle à part, AVANT). */
export function lireMessageEchange(data: unknown): LectureMessage {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, erreur: 'message non objet' };
  const o = data as Record<string, unknown>;
  if (o['format'] !== FORMAT_MESSAGE) return { ok: false, erreur: 'format de message inconnu' };
  const canaux: readonly CanalEchange[] = ['bonjour', 'pret', 'projet', 'retour', 'recu'];
  if (typeof o['canal'] !== 'string' || !(canaux as readonly string[]).includes(o['canal'])) return { ok: false, erreur: 'canal inconnu' };
  if (!sessionIdValide(o['sessionId'])) return { ok: false, erreur: 'session invalide' };
  const canal = o['canal'] as CanalEchange;
  let projet: ProjetMimmozaV2 | null = null;
  if (canal === 'projet' || canal === 'retour') {
    const lu = validerProjet(o['projet']);
    if (!lu.ok) return { ok: false, erreur: lu.erreur };
    if (lu.projet.session?.id !== o['sessionId']) return { ok: false, erreur: 'projet d’une autre session' };
    projet = lu.projet;
  } else if (o['projet'] !== null && o['projet'] !== undefined) return { ok: false, erreur: 'projet inattendu sur ce canal' };
  return { ok: true, message: { format: FORMAT_MESSAGE, canal, sessionId: o['sessionId'] as string, attendProjet: o['attendProjet'] === true, projet } };
}

/** R2 — origine de POSTE LOCAL au sens strict : localhost, 127.0.0.1 ou ::1 (pas `*.localhost`). */
export function estOrigineLocale(origine: string): boolean {
  try {
    const h = new URL(origine).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch { return false; }
}

/**
 * Liste blanche depuis une variable d'environnement (« https://a.fr, https://b.fr »).
 * `*` et les adresses invalides sont REFUSÉS (jamais de joker pour des données de projet).
 */
export function parserOrigines(brut: string | null | undefined): string[] {
  if (!brut) return [];
  return [...new Set(brut.split(/[\s,;]+/).map((x) => x.trim().replace(/\/+$/, '')).filter((x) => x !== '' && x !== '*' && origineWebValide(x)))];
}

/**
 * Origine autorisée : présente dans la liste, ou identique à la page.
 * R2 — exception de développement : `devLocal` (vrai seulement hors build de
 * production, `!import.meta.env.PROD`) admet une ORIGINE SOURCE de poste local
 * (localhost / 127.0.0.1 / ::1), quel que soit l'hôte de la page. Désactivée en production.
 */
export function origineAutorisee(origine: unknown, autorisees: readonly string[], originePage: string | null, devLocal = false): boolean {
  if (typeof origine !== 'string' || origine === 'null' || !origineWebValide(origine)) return false;
  if (autorisees.includes(origine)) return true;
  if (originePage !== null && origine === originePage) return true;
  return devLocal && estOrigineLocale(origine);
}

export type Ancre =
  | { readonly type: 'projet'; readonly code: string }
  | { readonly type: 'attente'; readonly sessionId: string }
  | { readonly type: 'retour'; readonly code: string };

/** Lit l'ancre d'adresse (`#projet=…`, `#projet-attente=…`, `#studio-retour=…`) ; null sinon. */
export function lireAncre(hash: string): Ancre | null {
  const brut = hash.replace(/^#/, '');
  for (const morceau of brut.split('&')) {
    if (morceau.startsWith(ANCRE_PROJET_ATTENTE)) {
      const id = morceau.slice(ANCRE_PROJET_ATTENTE.length);
      return sessionIdValide(id) ? { type: 'attente', sessionId: id } : null;
    }
    if (morceau.startsWith(ANCRE_PROJET)) return { type: 'projet', code: morceau.slice(ANCRE_PROJET.length) };
    if (morceau.startsWith(ANCRE_RETOUR)) return { type: 'retour', code: morceau.slice(ANCRE_RETOUR.length) };
  }
  return null;
}

/** R2 — l'ancre d'adresse ne doit porter ni nom de validateur ni lien signé (jeton). */
export function contientDonneesSensibles(p: ProjetMimmozaV2): boolean {
  // R3 — toute adresse de photo est traitée comme sensible (un jeton peut être dans le chemin).
  return p.regles.some((r) => r.validation.par !== null) || p.photos.some((x) => x.url !== null);
}

/** Copie sans nom de validateur ni lien signé, marquée dans `omissions` (à compléter par le destinataire). */
export function sansDonneesSensibles(p: ProjetMimmozaV2): ProjetMimmozaV2 {
  const validations = p.regles.some((r) => r.validation.par !== null);
  const liens = p.photos.some((x) => x.url !== null);
  return {
    ...p,
    regles: validations ? p.regles.map((r) => ({ ...r, validation: { statut: 'non-validee' as const, par: null, le: null } })) : p.regles,
    photos: liens ? p.photos.map((x) => (x.url !== null ? { ...x, url: null } : x)) : p.photos,
    omissions: { validations: p.omissions.validations || validations, liensPhotos: p.omissions.liensPhotos || liens },
  };
}

/**
 * Le destinataire complète un projet reçu par adresse avec sa propre base :
 * relief omis, validations retirées (règle identique hors validation), liens de photos retirés.
 */
export function completerDepuisBase(recu: ProjetMimmozaV2, base: ProjetMimmozaV2 | null): ProjetMimmozaV2 {
  let p = recu;
  if (p.site.reliefOmis) p = { ...p, site: { ...p.site, relief: base?.site.relief ?? null, reliefOmis: false } };
  if (p.omissions.validations) {
    const parId = new Map((base?.regles ?? []).map((r) => [r.id, r] as const));
    p = { ...p, regles: p.regles.map((r) => {
      const b = parId.get(r.id);
      return b && JSON.stringify({ ...b, validation: null }) === JSON.stringify({ ...r, validation: null }) ? { ...r, validation: b.validation } : r;
    }) };
  }
  if (p.omissions.liensPhotos) {
    const parId = new Map((base?.photos ?? []).map((x) => [x.id, x] as const));
    p = { ...p, photos: p.photos.map((x) => (x.url === null && parId.get(x.id)?.url ? { ...x, url: parId.get(x.id)!.url } : x)) };
  }
  return p.omissions.validations || p.omissions.liensPhotos ? { ...p, omissions: { validations: false, liensPhotos: false } } : p;
}

/**
 * Ancre d'envoi : le projet entier s'il tient dans l'adresse ET ne contient ni nom
 * de validateur ni lien signé ; sinon une simple annonce de session (le projet suit
 * par `postMessage` après « prêt »). Sans session : copie sans données sensibles.
 */
export function ancreEnvoi(projet: ProjetMimmozaV2, limite: number = TAILLE_MAX_URL): { readonly ancre: string; readonly parPostMessage: boolean } {
  const sensible = contientDonneesSensibles(projet);
  const code = encoderProjet(sensible && !projet.session ? sansDonneesSensibles(projet) : projet);
  if (code.length <= limite && (!sensible || !projet.session)) return { ancre: `${ANCRE_PROJET}${code}`, parPostMessage: false };
  if (!projet.session) throw new Error('projet trop volumineux pour l’adresse et sans session pour la poignée de main');
  return { ancre: `${ANCRE_PROJET_ATTENTE}${projet.session.id}`, parPostMessage: true };
}

/**
 * Retour par adresse (repli) : sans nom de validateur ni lien signé ; le relief
 * (inchangé) est omis si la charge dépasse la limite ; null si elle reste trop grosse.
 */
export function ancreRetour(projet: ProjetMimmozaV2, limite: number = TAILLE_MAX_URL): string | null {
  const propre = sansDonneesSensibles(projet);
  let code = encoderProjet(propre);
  if (code.length > limite && propre.site.relief) code = encoderProjet({ ...propre, site: { ...propre.site, relief: null, reliefOmis: true } });
  return code.length <= limite ? `${ANCRE_RETOUR}${code}` : null;
}
