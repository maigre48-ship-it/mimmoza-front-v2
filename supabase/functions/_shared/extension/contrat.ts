// supabase/functions/_shared/extension/contrat.ts
// COPIE (lot X3, 14/11/2026) de mimmozia-studio/src/core/extension/contrat.ts @ 0d3a044 (sha256 du fichier source : cee60519cff3189f32f725c4bd1b4c02ab75a531c00cd40bbb421583bc7b3853).
// Copie VERBATIM (aucune ligne modifiée) : même validation au site (Deno et navigateur), au Studio et au worker.
// Le Studio fait foi : toute évolution du contrat se fait d'abord dans le Studio, puis est recopiée ici.
// ----- DÉBUT DE LA COPIE -----
/**
 * CONTRAT « PROJET D'EXTENSION » (lot X0, 13/11/2026). Module PUR, sans dépendance (copiable tel quel côté site, Deno).
 *
 * Ce contrat dit, pour UN projet, ce qu'on fait du bâti existant de la parcelle et, s'il s'agit d'une extension,
 * ce qu'on ajoute. Il circule site → fiche du travail (`studio_jobs`) → Studio → worker. Il ne place AUCUNE géométrie :
 * il porte des intentions et des valeurs, chacune avec son STATUT et sa SOURCE. Le placement est fait par du code
 * déterministe (lot X2), jamais par un LLM.
 *
 * Rétrocompatibilité : une fiche sans bloc `projet` (toutes les fiches existantes) se lit comme un projet NEUF dont
 * l'existant éventuel est EFFACÉ (démolition-reconstruction), c'est-à-dire exactement le comportement des lots P1–P9.
 *
 * Transport (proposé, lot X3/X4 — voir CONTRAT-EXTENSION.md) : `studio_jobs.fiche.projet_extension` (à côté de
 * `habillage_batiments`, sans toucher au contrat « mimmoza-projet-v2 ») et option de travail `existant` ; côté Studio,
 * même bloc dans le message d'échange du site. Format distinct (`mimmoza-projet-extension`) pour ne pas le confondre
 * avec le projet v2.
 *
 * Généricité : `existants` est une LISTE (un pavillon, ou plusieurs bâtiments dont l'un est conservé et l'autre démoli
 * chez un promoteur) et les dimensions sont en mètres sans hypothèse « maison » : le même contrat sert aux immeubles
 * et au futur moteur de plans (lots D1–D4), qui lira l'existant à conserver / démolir pour le plan de masse.
 *
 * Statuts d'une donnée (décision Albé 13/11 : rien d'inventé sans le dire) :
 *   · `mesuree`   : valeur PUBLIÉE par une source (BD TOPO, BDNB, cadastre) et reprise sans calcul ;
 *   · `estimee`   : calculée par une règle documentée à partir de valeurs mesurées ;
 *   · `supposee`  : valeur par défaut ou hypothèse sans mesure (ex. pente de toit 35°) ;
 *   · `confirmee` : saisie ou validée explicitement par l'utilisateur (prime sur tout le reste).
 */

export const PROJET_EXTENSION_FORMAT = 'mimmoza-projet-extension' as const;
export const PROJET_EXTENSION_VERSION = 1 as const;

export type StatutDonnee = 'mesuree' | 'estimee' | 'supposee' | 'confirmee';
export const STATUTS_DONNEE: readonly StatutDonnee[] = ['mesuree', 'estimee', 'supposee', 'confirmee'];

/** Une valeur, son statut et sa source lisible (« BD TOPO hauteur », « règle R3 », « saisie utilisateur »). */
export interface Donnee<T> {
  readonly valeur: T;
  readonly statut: StatutDonnee;
  readonly source: string;
}

export type NatureProjet = 'neuf' | 'extension';
/** `partiel` : RÉSERVÉ (démolition partielle, lot ultérieur) — refusé à la validation tant qu'il n'est pas livré. */
export type ModeExistant = 'conserver' | 'effacer' | 'partiel';
export const MODES_EXISTANT: readonly ModeExistant[] = ['conserver', 'effacer', 'partiel'];
export const MODES_EXISTANT_DISPONIBLES: readonly ModeExistant[] = ['conserver', 'effacer'];

/** `veranda` : RÉSERVÉ (lot X2b) — accepté par le contrat, refusé par le moteur tant qu'il n'existe pas. */
export type TypeExtension = 'laterale' | 'arriere' | 'surelevation' | 'garage' | 'veranda';
export const TYPES_EXTENSION: readonly TypeExtension[] = ['laterale', 'arriere', 'surelevation', 'garage', 'veranda'];

export type FormeToit = 'deux-pans' | 'quatre-pans' | 'plat' | 'monopente';
export const FORMES_TOIT: readonly FormeToit[] = ['deux-pans', 'quatre-pans', 'plat', 'monopente'];
/** Toiture de l'EXTENSION : les formes ci-dessus, plus le prolongement de la toiture existante (surélévation, aile). */
export type FormeToitExtension = FormeToit | 'prolongement';
export const FORMES_TOIT_EXTENSION: readonly FormeToitExtension[] = [...FORMES_TOIT, 'prolongement'];

export type OrientationFaitage = 'grand-axe' | 'petit-axe';

/**
 * Façade de l'existant à laquelle s'accroche l'extension, dite par rapport à la RUE (vue depuis la rue) : c'est ce que
 * l'utilisateur comprend et ce que le site sait (limite sur voie, lot C7). `arete` : indice d'arête de l'emprise BD TOPO,
 * résolu par le Studio (lot X2) — facultatif, prime s'il est fourni et valide.
 */
export type CoteFacade = 'rue' | 'arriere' | 'gauche' | 'droite';
export const COTES_FACADE: readonly CoteFacade[] = ['rue', 'arriere', 'gauche', 'droite'];
export interface FacadeAccroche {
  readonly cote: CoteFacade;
  readonly arete?: number;
}

/** Données publiées par la BDNB (CSTB), si le site les a obtenues (fonction `batiment-bdnb-v1`). Toutes facultatives. */
export interface DonneesBdnb {
  readonly batimentGroupeId?: string;
  readonly nbNiveaux?: number;
  readonly hauteurMoyenneM?: number;
  readonly empriseSolM2?: number;
  readonly materiauToit?: string;
  readonly anneeConstruction?: number;
}

/** Un bâtiment existant sur la parcelle et ce qu'on en fait. */
export interface ExistantProjet {
  /** `cleabs` BD TOPO (BATIMENT…), ou identifiant libre si l'utilisateur l'a dessiné (`source = utilisateur`). */
  readonly id: string;
  readonly source: 'bdtopo' | 'utilisateur';
  readonly mode: ModeExistant;
  /** Valeurs connues ou corrigées (le Studio estime le reste, lot X1). Hauteurs au-dessus du sol du bâtiment, m. */
  readonly hauteurEgoutM?: Donnee<number>;
  readonly hauteurFaitageM?: Donnee<number>;
  readonly formeToit?: Donnee<FormeToit>;
  readonly penteToitDeg?: Donnee<number>;
  readonly orientationFaitage?: Donnee<OrientationFaitage>;
  readonly niveaux?: Donnee<number>;
  readonly surfacePlancherM2?: Donnee<number>;
  readonly bdnb?: DonneesBdnb;
}

export interface ReculsExtension {
  /** Recul minimal à la voie, aux limites séparatives, au fond de parcelle (m). Absent = non connu (le moteur le dit). */
  readonly voieM?: Donnee<number>;
  readonly limitesSeparativesM?: Donnee<number>;
  readonly fondM?: Donnee<number>;
}

export interface DimensionsExtension {
  /** Le long de la façade d'accroche (m). Surélévation : sans objet (emprise existante). */
  readonly largeurM?: Donnee<number>;
  /** Perpendiculaire à la façade d'accroche (m). */
  readonly profondeurM?: Donnee<number>;
  /** Surface de plancher visée (m²) : alternative à largeur × profondeur, le moteur en déduit les dimensions. */
  readonly surfacePlancherM2?: Donnee<number>;
  readonly niveaux?: Donnee<number>;
  /** Hauteur à l'égout (m au-dessus du sol). Absent : alignée sur l'égout de l'existant (règle X2, dite). */
  readonly hauteurEgoutM?: Donnee<number>;
}

export interface ToitureExtension {
  readonly forme: Donnee<FormeToitExtension>;
  readonly penteDeg?: Donnee<number>;
}

export interface ExtensionDemandee {
  readonly type: TypeExtension;
  /** Obligatoire sauf pour la surélévation. */
  readonly facade?: FacadeAccroche;
  /** Bâtiment existant auquel on s'accroche (id d'un `existants[]` au mode `conserver`). */
  readonly existantId: string;
  readonly dimensions: DimensionsExtension;
  readonly toiture?: ToitureExtension;
  readonly reculs?: ReculsExtension;
}

export interface ProjetExtension {
  readonly format: typeof PROJET_EXTENSION_FORMAT;
  readonly version: typeof PROJET_EXTENSION_VERSION;
  readonly nature: NatureProjet;
  /** Mode appliqué aux bâtiments existants NON listés dans `existants` (défaut : effacer pour du neuf, conserver pour une extension). */
  readonly modeExistantParDefaut: ModeExistant;
  readonly existants: readonly ExistantProjet[];
  /** Présent si et seulement si `nature = extension`. */
  readonly extension?: ExtensionDemandee;
  /** Demandeur, pour les alertes réglementaires (lot X3) : personne morale ⇒ architecte toujours obligatoire. */
  readonly demandeur?: 'particulier' | 'personne-morale';
}

/** Projet NEUF implicite d'une fiche sans bloc `projet` : comportement inchangé (existant effacé). */
export const PROJET_NEUF_PAR_DEFAUT: ProjetExtension = {
  format: PROJET_EXTENSION_FORMAT,
  version: PROJET_EXTENSION_VERSION,
  nature: 'neuf',
  modeExistantParDefaut: 'effacer',
  existants: [],
};

/* ------------------------------------------------------------------ */
/* Validation (sans dépendance : même code au site, Deno, et au Studio) */
/* ------------------------------------------------------------------ */

export type LectureProjet =
  | { readonly ok: true; readonly projet: ProjetExtension; readonly avertissements: readonly string[] }
  | { readonly ok: false; readonly erreurs: readonly string[] };

type Brut = Record<string, unknown>;
const estObjet = (v: unknown): v is Brut => typeof v === 'object' && v !== null && !Array.isArray(v);
const dans = <T extends string>(v: unknown, liste: readonly T[]): v is T => typeof v === 'string' && (liste as readonly string[]).includes(v);

/** Bornes de plausibilité (m, m², niveaux) : au-delà, la valeur est refusée, jamais tronquée en silence. */
export const BORNES = {
  hauteurM: [0.5, 200],
  penteDeg: [0, 75],
  niveaux: [1, 60],
  surfaceM2: [1, 100_000],
  longueurM: [0.5, 500],
  reculM: [0, 100],
} as const;

function lireDonnee<T>(
  v: unknown,
  chemin: string,
  erreurs: string[],
  valeur: (x: unknown) => x is T,
  attendu: string,
): Donnee<T> | undefined {
  if (v === undefined) return undefined;
  if (!estObjet(v)) {
    erreurs.push(`${chemin} : objet { valeur, statut, source } attendu.`);
    return undefined;
  }
  const inconnues = Object.keys(v).filter((k) => !['valeur', 'statut', 'source'].includes(k));
  if (inconnues.length) erreurs.push(`${chemin} : clé(s) inconnue(s) ${inconnues.join(', ')}.`);
  if (!valeur(v['valeur'])) erreurs.push(`${chemin}.valeur : ${attendu}.`);
  if (!dans(v['statut'], STATUTS_DONNEE)) erreurs.push(`${chemin}.statut : l'un de ${STATUTS_DONNEE.join(' | ')}.`);
  if (typeof v['source'] !== 'string' || v['source'].trim() === '' || v['source'].length > 300) erreurs.push(`${chemin}.source : texte de 1 à 300 caractères.`);
  return valeur(v['valeur']) && dans(v['statut'], STATUTS_DONNEE) && typeof v['source'] === 'string'
    ? { valeur: v['valeur'], statut: v['statut'], source: v['source'] }
    : undefined;
}

const nombreDans = (b: readonly [number, number]) => (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= b[0] && x <= b[1];
const entierDans = (b: readonly [number, number]) => (x: unknown): x is number => nombreDans(b)(x) && Number.isInteger(x);
const parmi = <T extends string>(l: readonly T[]) => (x: unknown): x is T => dans(x, l);

function verifierCles(o: Brut, permises: readonly string[], chemin: string, erreurs: string[]): void {
  const inconnues = Object.keys(o).filter((k) => !permises.includes(k));
  if (inconnues.length) erreurs.push(`${chemin} : clé(s) inconnue(s) ${inconnues.join(', ')}.`);
}

function lireBdnb(v: unknown, chemin: string, erreurs: string[]): DonneesBdnb | undefined {
  if (v === undefined) return undefined;
  if (!estObjet(v)) {
    erreurs.push(`${chemin} : objet attendu.`);
    return undefined;
  }
  verifierCles(v, ['batimentGroupeId', 'nbNiveaux', 'hauteurMoyenneM', 'empriseSolM2', 'materiauToit', 'anneeConstruction'], chemin, erreurs);
  const out: { -readonly [K in keyof DonneesBdnb]: DonneesBdnb[K] } = {};
  if (v['batimentGroupeId'] !== undefined) {
    if (typeof v['batimentGroupeId'] === 'string' && v['batimentGroupeId'].length <= 80) out.batimentGroupeId = v['batimentGroupeId'];
    else erreurs.push(`${chemin}.batimentGroupeId : texte ≤ 80 caractères.`);
  }
  const num = (k: 'nbNiveaux' | 'hauteurMoyenneM' | 'empriseSolM2' | 'anneeConstruction', ok: (x: unknown) => x is number): void => {
    if (v[k] === undefined) return;
    if (ok(v[k])) out[k] = v[k] as number;
    else erreurs.push(`${chemin}.${k} : valeur hors bornes.`);
  };
  num('nbNiveaux', entierDans(BORNES.niveaux));
  num('hauteurMoyenneM', nombreDans(BORNES.hauteurM));
  num('empriseSolM2', nombreDans(BORNES.surfaceM2));
  num('anneeConstruction', entierDans([1000, 2100]));
  if (v['materiauToit'] !== undefined) {
    if (typeof v['materiauToit'] === 'string' && v['materiauToit'].length <= 120) out.materiauToit = v['materiauToit'];
    else erreurs.push(`${chemin}.materiauToit : texte ≤ 120 caractères.`);
  }
  return out;
}

function lireExistant(v: unknown, i: number, erreurs: string[]): ExistantProjet | null {
  const c = `existants[${i}]`;
  if (!estObjet(v)) {
    erreurs.push(`${c} : objet attendu.`);
    return null;
  }
  verifierCles(v, ['id', 'source', 'mode', 'hauteurEgoutM', 'hauteurFaitageM', 'formeToit', 'penteToitDeg', 'orientationFaitage', 'niveaux', 'surfacePlancherM2', 'bdnb'], c, erreurs);
  const id = v['id'];
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(id)) erreurs.push(`${c}.id : identifiant de 1 à 64 caractères [A-Za-z0-9_.:-].`);
  if (!dans(v['source'], ['bdtopo', 'utilisateur'] as const)) erreurs.push(`${c}.source : bdtopo | utilisateur.`);
  if (!dans(v['mode'], MODES_EXISTANT)) erreurs.push(`${c}.mode : ${MODES_EXISTANT.join(' | ')}.`);
  else if (!dans(v['mode'], MODES_EXISTANT_DISPONIBLES)) erreurs.push(`${c}.mode « partiel » : démolition partielle RÉSERVÉE à un lot ultérieur, pas encore disponible.`);
  const hEgout = lireDonnee(v['hauteurEgoutM'], `${c}.hauteurEgoutM`, erreurs, nombreDans(BORNES.hauteurM), `nombre entre ${BORNES.hauteurM[0]} et ${BORNES.hauteurM[1]} m`);
  const hFaitage = lireDonnee(v['hauteurFaitageM'], `${c}.hauteurFaitageM`, erreurs, nombreDans(BORNES.hauteurM), `nombre entre ${BORNES.hauteurM[0]} et ${BORNES.hauteurM[1]} m`);
  if (hEgout && hFaitage && hFaitage.valeur < hEgout.valeur) erreurs.push(`${c} : le faîtage (${hFaitage.valeur} m) est sous l'égout (${hEgout.valeur} m).`);
  const out: { -readonly [K in keyof ExistantProjet]: ExistantProjet[K] } = {
    id: typeof id === 'string' ? id : '',
    source: v['source'] === 'utilisateur' ? 'utilisateur' : 'bdtopo',
    mode: dans(v['mode'], MODES_EXISTANT) ? v['mode'] : 'effacer',
  };
  if (hEgout) out.hauteurEgoutM = hEgout;
  if (hFaitage) out.hauteurFaitageM = hFaitage;
  const forme = lireDonnee(v['formeToit'], `${c}.formeToit`, erreurs, parmi(FORMES_TOIT), FORMES_TOIT.join(' | '));
  if (forme) out.formeToit = forme;
  const pente = lireDonnee(v['penteToitDeg'], `${c}.penteToitDeg`, erreurs, nombreDans(BORNES.penteDeg), `degrés entre ${BORNES.penteDeg[0]} et ${BORNES.penteDeg[1]}`);
  if (pente) out.penteToitDeg = pente;
  const orient = lireDonnee(v['orientationFaitage'], `${c}.orientationFaitage`, erreurs, parmi(['grand-axe', 'petit-axe'] as const), 'grand-axe | petit-axe');
  if (orient) out.orientationFaitage = orient;
  const niv = lireDonnee(v['niveaux'], `${c}.niveaux`, erreurs, entierDans(BORNES.niveaux), `entier entre ${BORNES.niveaux[0]} et ${BORNES.niveaux[1]}`);
  if (niv) out.niveaux = niv;
  const sdp = lireDonnee(v['surfacePlancherM2'], `${c}.surfacePlancherM2`, erreurs, nombreDans(BORNES.surfaceM2), `m² entre ${BORNES.surfaceM2[0]} et ${BORNES.surfaceM2[1]}`);
  if (sdp) out.surfacePlancherM2 = sdp;
  const bdnb = lireBdnb(v['bdnb'], `${c}.bdnb`, erreurs);
  if (bdnb) out.bdnb = bdnb;
  return out;
}

function lireExtension(v: unknown, erreurs: string[], avert: string[]): ExtensionDemandee | null {
  const c = 'extension';
  if (!estObjet(v)) {
    erreurs.push(`${c} : objet attendu pour un projet d'extension.`);
    return null;
  }
  verifierCles(v, ['type', 'facade', 'existantId', 'dimensions', 'toiture', 'reculs'], c, erreurs);
  const type = v['type'];
  if (!dans(type, TYPES_EXTENSION)) erreurs.push(`${c}.type : ${TYPES_EXTENSION.join(' | ')}.`);
  if (type === 'veranda') avert.push('Véranda : acceptée par le contrat, mais le volume vitré n’existe pas encore dans le moteur (lot X2b) — le travail sera refusé avec cette raison.');
  let facade: FacadeAccroche | undefined;
  if (v['facade'] !== undefined) {
    const f = v['facade'];
    if (!estObjet(f)) erreurs.push(`${c}.facade : objet { cote, arete? } attendu.`);
    else {
      verifierCles(f, ['cote', 'arete'], `${c}.facade`, erreurs);
      if (!dans(f['cote'], COTES_FACADE)) erreurs.push(`${c}.facade.cote : ${COTES_FACADE.join(' | ')}.`);
      if (f['arete'] !== undefined && !entierDans([0, 999])(f['arete'])) erreurs.push(`${c}.facade.arete : entier ≥ 0.`);
      if (dans(f['cote'], COTES_FACADE)) facade = entierDans([0, 999])(f['arete']) ? { cote: f['cote'], arete: f['arete'] } : { cote: f['cote'] };
    }
  }
  if (type !== 'surelevation' && type !== undefined && !facade) erreurs.push(`${c}.facade : obligatoire pour une extension ${String(type)} (côté rue | arriere | gauche | droite).`);
  if (type === 'surelevation' && facade) avert.push('Surélévation : la façade d’accroche est ignorée (la surélévation porte sur toute l’emprise existante).');
  const existantId = v['existantId'];
  if (typeof existantId !== 'string' || existantId === '') erreurs.push(`${c}.existantId : identifiant du bâtiment existant conservé.`);
  const d = v['dimensions'];
  const dims: { -readonly [K in keyof DimensionsExtension]: DimensionsExtension[K] } = {};
  if (!estObjet(d)) erreurs.push(`${c}.dimensions : objet attendu (largeurM, profondeurM, surfacePlancherM2, niveaux, hauteurEgoutM — tous facultatifs).`);
  else {
    verifierCles(d, ['largeurM', 'profondeurM', 'surfacePlancherM2', 'niveaux', 'hauteurEgoutM'], `${c}.dimensions`, erreurs);
    const L = lireDonnee(d['largeurM'], `${c}.dimensions.largeurM`, erreurs, nombreDans(BORNES.longueurM), 'm');
    const P = lireDonnee(d['profondeurM'], `${c}.dimensions.profondeurM`, erreurs, nombreDans(BORNES.longueurM), 'm');
    const S = lireDonnee(d['surfacePlancherM2'], `${c}.dimensions.surfacePlancherM2`, erreurs, nombreDans(BORNES.surfaceM2), 'm²');
    const N = lireDonnee(d['niveaux'], `${c}.dimensions.niveaux`, erreurs, entierDans(BORNES.niveaux), 'entier');
    const H = lireDonnee(d['hauteurEgoutM'], `${c}.dimensions.hauteurEgoutM`, erreurs, nombreDans(BORNES.hauteurM), 'm');
    if (L) dims.largeurM = L;
    if (P) dims.profondeurM = P;
    if (S) dims.surfacePlancherM2 = S;
    if (N) dims.niveaux = N;
    if (H) dims.hauteurEgoutM = H;
    if (type !== 'surelevation' && !S && !(L && P)) avert.push('Dimensions de l’extension incomplètes (ni largeur × profondeur, ni surface) : le moteur (lot X2) proposera des dimensions SUPPOSÉES, à confirmer.');
  }
  let toiture: ToitureExtension | undefined;
  if (v['toiture'] !== undefined) {
    const t = v['toiture'];
    if (!estObjet(t)) erreurs.push(`${c}.toiture : objet { forme, penteDeg? } attendu.`);
    else {
      verifierCles(t, ['forme', 'penteDeg'], `${c}.toiture`, erreurs);
      const forme = lireDonnee(t['forme'], `${c}.toiture.forme`, erreurs, parmi(FORMES_TOIT_EXTENSION), FORMES_TOIT_EXTENSION.join(' | '));
      if (!forme && t['forme'] === undefined) erreurs.push(`${c}.toiture.forme : obligatoire si toiture est fournie.`);
      const pente = lireDonnee(t['penteDeg'], `${c}.toiture.penteDeg`, erreurs, nombreDans(BORNES.penteDeg), 'degrés');
      if (forme) toiture = pente ? { forme, penteDeg: pente } : { forme };
    }
  }
  let reculs: ReculsExtension | undefined;
  if (v['reculs'] !== undefined) {
    const r = v['reculs'];
    if (!estObjet(r)) erreurs.push(`${c}.reculs : objet attendu.`);
    else {
      verifierCles(r, ['voieM', 'limitesSeparativesM', 'fondM'], `${c}.reculs`, erreurs);
      const out: { -readonly [K in keyof ReculsExtension]: ReculsExtension[K] } = {};
      for (const k of ['voieM', 'limitesSeparativesM', 'fondM'] as const) {
        const x = lireDonnee(r[k], `${c}.reculs.${k}`, erreurs, nombreDans(BORNES.reculM), 'm');
        if (x) out[k] = x;
      }
      reculs = out;
    }
  }
  if (!dans(type, TYPES_EXTENSION) || typeof existantId !== 'string') return null;
  return {
    type,
    ...(facade && type !== 'surelevation' ? { facade } : {}),
    existantId,
    dimensions: dims,
    ...(toiture ? { toiture } : {}),
    ...(reculs ? { reculs } : {}),
  };
}

/**
 * Lit et valide un bloc `projet` (fiche du travail, message du site). `undefined` / `null` ⇒ projet NEUF par défaut
 * (rétrocompatibilité). Aucune valeur n'est complétée ni corrigée en silence : une erreur refuse le bloc entier.
 */
export function lireProjetExtension(v: unknown): LectureProjet {
  if (v === undefined || v === null) return { ok: true, projet: PROJET_NEUF_PAR_DEFAUT, avertissements: [] };
  const erreurs: string[] = [];
  const avert: string[] = [];
  if (!estObjet(v)) return { ok: false, erreurs: ['projet : objet attendu.'] };
  verifierCles(v, ['format', 'version', 'nature', 'modeExistantParDefaut', 'existants', 'extension', 'demandeur'], 'projet', erreurs);
  if (v['format'] !== PROJET_EXTENSION_FORMAT) erreurs.push(`projet.format : « ${PROJET_EXTENSION_FORMAT} » attendu.`);
  if (v['version'] !== PROJET_EXTENSION_VERSION) erreurs.push(`projet.version : ${PROJET_EXTENSION_VERSION} attendu (version inconnue : mettre à jour le Studio ou le worker).`);
  const nature = v['nature'];
  if (!dans(nature, ['neuf', 'extension'] as const)) erreurs.push('projet.nature : neuf | extension.');
  const defaut = v['modeExistantParDefaut'] ?? (nature === 'extension' ? 'conserver' : 'effacer');
  if (!dans(defaut, MODES_EXISTANT)) erreurs.push(`projet.modeExistantParDefaut : ${MODES_EXISTANT.join(' | ')}.`);
  else if (!dans(defaut, MODES_EXISTANT_DISPONIBLES)) erreurs.push('projet.modeExistantParDefaut « partiel » : démolition partielle RÉSERVÉE à un lot ultérieur.');
  const brutExistants = v['existants'] ?? [];
  const existants: ExistantProjet[] = [];
  if (!Array.isArray(brutExistants) || brutExistants.length > 50) erreurs.push('projet.existants : liste de 0 à 50 bâtiments.');
  else brutExistants.forEach((e, i) => {
    const x = lireExistant(e, i, erreurs);
    if (x) existants.push(x);
  });
  const ids = existants.map((e) => e.id);
  if (new Set(ids).size !== ids.length) erreurs.push('projet.existants : identifiants en double.');
  if (v['demandeur'] !== undefined && !dans(v['demandeur'], ['particulier', 'personne-morale'] as const)) erreurs.push('projet.demandeur : particulier | personne-morale.');
  let extension: ExtensionDemandee | null = null;
  if (nature === 'extension') {
    extension = lireExtension(v['extension'], erreurs, avert);
    if (extension) {
      const cible = existants.find((e) => e.id === extension!.existantId);
      const modeCible = cible ? cible.mode : defaut;
      if (!cible) avert.push(`extension.existantId « ${extension.existantId} » absent de projet.existants : mode par défaut (${String(defaut)}) appliqué.`);
      if (modeCible !== 'conserver') erreurs.push(`extension.existantId « ${extension.existantId} » : on ne peut s’accrocher qu’à un bâtiment CONSERVÉ (mode actuel : ${String(modeCible)}).`);
    }
  } else if (v['extension'] !== undefined) {
    erreurs.push('projet.extension : réservé aux projets de nature « extension ».');
  }
  if (nature === 'neuf' && existants.some((e) => e.mode === 'conserver')) {
    avert.push('Projet neuf avec un bâtiment existant CONSERVÉ : il restera sur la photo et dans la scène, à côté du projet.');
  }
  if (erreurs.length) return { ok: false, erreurs };
  const projet: ProjetExtension = {
    format: PROJET_EXTENSION_FORMAT,
    version: PROJET_EXTENSION_VERSION,
    nature: nature as NatureProjet,
    modeExistantParDefaut: defaut as ModeExistant,
    existants,
    ...(extension ? { extension } : {}),
    ...(v['demandeur'] !== undefined ? { demandeur: v['demandeur'] as 'particulier' | 'personne-morale' } : {}),
  };
  return { ok: true, projet, avertissements: avert };
}

/** Mode appliqué à un bâtiment existant donné (liste, sinon mode par défaut du projet). */
export function modeDeLExistant(projet: ProjetExtension, id: string): ModeExistant {
  return projet.existants.find((e) => e.id === id)?.mode ?? projet.modeExistantParDefaut;
}

/** Ids des bâtiments existants à CONSERVER parmi ceux trouvés sur la parcelle (BD TOPO). */
export function existantsConserves(projet: ProjetExtension, idsSurParcelle: readonly string[]): string[] {
  return idsSurParcelle.filter((id) => modeDeLExistant(projet, id) === 'conserver');
}

/**
 * Option de travail `existant` (studio_jobs.options, lot X3/X4) : 'conserver' si au moins un existant est conservé,
 * sinon 'effacer'. Absente d'un travail = 'effacer' (comportement P4–P8 inchangé).
 */
export function optionTravailExistant(projet: ProjetExtension): 'conserver' | 'effacer' {
  return projet.modeExistantParDefaut === 'conserver' || projet.existants.some((e) => e.mode === 'conserver') ? 'conserver' : 'effacer';
}

/** Priorité des statuts quand deux valeurs se concurrencent : confirmée > mesurée > estimée > supposée. */
export function prioriteStatut(s: StatutDonnee): number {
  return s === 'confirmee' ? 3 : s === 'mesuree' ? 2 : s === 'estimee' ? 1 : 0;
}

/** Libellé français d'un statut (interface, rapports). */
export function libelleStatut(s: StatutDonnee): string {
  return s === 'mesuree' ? 'mesurée' : s === 'estimee' ? 'estimée' : s === 'supposee' ? 'SUPPOSÉE' : 'confirmée par l’utilisateur';
}
