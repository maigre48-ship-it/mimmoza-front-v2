// src/lib/studio/modeleBatiment.ts — VIS-25 lot A : CONTRAT « modèle du bâtiment » (ModeleBatiment v1).
// COPIE À L'IDENTIQUE dans les deux dépôts (même octet pour octet) :
//   mimmoza-front-v2/src/lib/studio/modeleBatiment.ts   (front + fonction Edge, chemin relatif)
//   mimmozia-studio/src/core/echange/modeleBatiment.ts  (Studio : construction 3D, src/core/modele/)
// =============================================================================
// JOURNAL DES CHANGEMENTS DE LA FORME PUBLIQUE (l'agent du lot B le relit ; ajouter une ligne à CHAQUE changement)
//   2026-11-23  v1 posée (lot A) : types, validerModele, resumerModele, empreinteModele, appliquerRetouche(s),
//               versDescriptionBatiment, depuisDescriptionBatiment, bloc ```mimmoza-modele```, aides géométriques.
//   2026-11-23  OptionsValidation.refsConnues accepte aussi `undefined` explicite (élargissement, sans effet sur les appelants).
// =============================================================================
//
// POURQUOI. VIS-22 faisait remplir à Mimmo un contrat FERMÉ (DescriptionBatiment : 6 formes, 3 styles reproduits,
// ~12 éléments) ; tout le reste finissait en « Pas encore ». Ici le bâtiment est COMPOSÉ de briques libres :
//   - des VOLUMES (autant qu'il faut) : plan rectangle | L | polygone | cercle | arc, posés sur le terrain ;
//   - un TOIT par volume : plat, terrasse, 1 pan, 2 pans, 4 pans, Mansart, conique, pyramide ;
//   - des OUVERTURES par volume, par façade et par niveau ;
//   - des MATIÈRES par partie (référence du catalogue extérieur VIS-24, ou couleur libre + famille) ;
//   - des ÉLÉMENTS : typés avec dimensions (balcon, pergola, tourelle…) OU décomposés en BRIQUES
//     (boîte, plaque, poteau, cylindre, cône, pyramide, prisme). Un élément inconnu devient « autre » + briques :
//     il n'est JAMAIS refusé.
//
// REPÈRE (mètres). Repère local du terrain, vu de dessus :
//   x : le long de la rue, vers la DROITE quand on regarde le bâtiment depuis la rue ;
//   y : en profondeur, de la rue vers le fond du terrain (y croissant = on s'éloigne de la rue) ;
//   z : vers le haut, 0 = sol fini.
//   Origine libre (en pratique : coin avant gauche du terrain ou centre du bâtiment principal).
//   rotation : degrés, sens trigonométrique vu de dessus (de x vers y), autour de la `position` du volume.
// FAÇADES d'un volume (avant rotation) : 'avant' = côté rue (y min), 'arriere', 'gauche' (x min), 'droite' (x max) ;
//   ou un NUMÉRO de côté du contour (0, 1, 2… dans l'ordre des points, sens trigonométrique).
//   Sur une façade, `position` = distance (m) entre l'extrémité GAUCHE de la façade VUE DE L'EXTÉRIEUR et le CENTRE
//   de l'objet ; null = centré (ou réparti régulièrement quand `nombre` > 1).
// NIVEAUX : 0 = rez-de-chaussée ; niveau n = de altitudeBase + n × hauteurEtage à +hauteurEtage.
//
// PUR : seul import, le contrat VIS-22 voisin (chemin relatif .ts, valable pour Vite, tsx, vitest et Deno).
// Aucune E/S, aucun React, aucune exception : toute lecture passe par `validerModele`, qui CORRIGE et le DIT.
// =============================================================================

import {
  DESCRIPTION_VERSION, STYLES_BATIMENT, TYPES_BATIMENT, validerDescription,
  type CouleurBois, type Cote, type DescriptionBatiment, type FacadeBatiment, type FormeBatiment, type FormeToit,
  type MenuiseriesBatiment, type StyleBatiment, type TypeBatiment, type TypeElement, type Volets,
} from './descriptionBatiment.ts';

export const MODELE_VERSION = 1;
/** Langue du bloc JSON porté par un message (```mimmoza-modele```), relu par `modeleDuMessage` (mode strict). */
export const MODELE_BLOC_LANGUE = 'mimmoza-modele';

// ---- Listes fermées (les seules) ----------------------------------------------

export const ORIGINES_MODELE = ['texte', 'photo', 'description', 'retouche'] as const;
export const TYPES_PLAN = ['rectangle', 'L', 'polygone', 'cercle', 'arc'] as const;
export const COINS_PLAN = ['avant_gauche', 'avant_droit', 'arriere_gauche', 'arriere_droit'] as const;
export const ROLES_VOLUME = ['principal', 'aile', 'annexe', 'garage', 'tourelle', 'attique', 'autre'] as const;
export const COTES_FACADE = ['avant', 'arriere', 'gauche', 'droite'] as const;
export const FORMES_TOIT_MODELE = ['plat', 'terrasse', 'un_pan', 'deux_pans', 'quatre_pans', 'mansart', 'conique', 'pyramide'] as const;
export const FAITAGES = ['largeur', 'profondeur'] as const;
export const TYPES_OUVERTURE = ['fenetre', 'porte_fenetre', 'baie', 'porte', 'porte_garage', 'lucarne', 'oeil_de_boeuf'] as const;
export const VOLETS_MODELE = ['aucun', 'battants', 'persiennes', 'roulants', 'coulissants'] as const;
export const FAMILLES_MATIERE = ['enduit', 'brique', 'pierre', 'beton', 'bois', 'metal', 'verre', 'tuile', 'ardoise', 'zinc', 'vegetal', 'autre'] as const;
export const PARTIES_MATIERE = ['murs', 'toiture', 'menuiseries', 'volets', 'soubassement', 'boiseries', 'garde_corps', 'sol'] as const;
export const TYPES_ELEMENT_MODELE = [
  'balcon', 'loggia', 'garde_corps', 'auvent', 'pergola', 'veranda', 'porche', 'escalier_exterieur', 'cheminee', 'volets',
  'tourelle', 'bow_window', 'colonnes', 'corniche', 'bandeau', 'colombages', 'autre',
] as const;
export const FORMES_BRIQUE = ['boite', 'plaque', 'poteau', 'cylindre', 'cone', 'pyramide', 'prisme'] as const;

export type OrigineModele = typeof ORIGINES_MODELE[number];
export type TypePlan = typeof TYPES_PLAN[number];
export type CoinPlan = typeof COINS_PLAN[number];
export type RoleVolume = typeof ROLES_VOLUME[number];
export type CoteFacade = typeof COTES_FACADE[number];
export type FormeToitModele = typeof FORMES_TOIT_MODELE[number];
export type Faitage = typeof FAITAGES[number];
export type TypeOuverture = typeof TYPES_OUVERTURE[number];
export type VoletsModele = typeof VOLETS_MODELE[number];
export type FamilleMatiere = typeof FAMILLES_MATIERE[number];
export type PartieMatiere = typeof PARTIES_MATIERE[number];
export type TypeElementModele = typeof TYPES_ELEMENT_MODELE[number];
export type FormeBrique = typeof FORMES_BRIQUE[number];

// ---- Types ---------------------------------------------------------------------

export type Point2 = readonly [number, number];

/** Plan d'un volume, en coordonnées LOCALES centrées sur `position` (avant rotation). */
export type PlanVolume =
  /** Rectangle centré : largeur selon x, profondeur selon y. */
  | { type: 'rectangle'; largeur: number; profondeur: number }
  /**
   * L : rectangle englobant largeur × profondeur (centré) privé du rectangle du `coinVide`.
   * epaisseurX = épaisseur de la branche « verticale » (mesurée selon x, côté opposé au coin vide) ;
   * epaisseurY = épaisseur de la branche « horizontale » (mesurée selon y, côté opposé au coin vide).
   * Ex. coinVide 'arriere_droit' : une barre le long de la rue + une aile qui part vers le fond à gauche.
   */
  | { type: 'L'; largeur: number; profondeur: number; epaisseurX: number; epaisseurY: number; coinVide: CoinPlan }
  /** Polygone simple (3 à 64 points), coordonnées locales ; remis dans le sens trigonométrique par la validation. */
  | { type: 'polygone'; points: Point2[] }
  /** Cercle centré (tourelle, kiosque). */
  | { type: 'cercle'; rayon: number }
  /** Secteur d'anneau centré : angles en degrés (0 = +x, sens trigonométrique) ; rayonInterieur 0 = part de tarte. */
  | { type: 'arc'; rayonExterieur: number; rayonInterieur: number; angleDebut: number; angleFin: number };

/** Matière : référence du catalogue extérieur VIS-24 (`refStudio`, ex. « av-brique-rouge ») et/ou couleur + famille. */
export interface Matiere {
  refStudio: string | null;
  /** #rrggbb (minuscules). */
  couleur: string | null;
  famille: FamilleMatiere | null;
}
export type MatieresParPartie = Partial<Record<PartieMatiere, Matiere>>;

export interface ToitModele {
  forme: FormeToitModele;
  /** Degrés (0 pour plat / terrasse). Mansart : pente du terrasson (le brisis est à 70°). */
  pente: number;
  /** Débord des rives et de l'égout (m). */
  debord: number;
  /** Faîtage parallèle à la largeur (x local, donc à la rue pour un volume non tourné) ou à la profondeur (y local). */
  faitage: Faitage;
  /** Un pan : côté de l'égout BAS. */
  basVers: CoteFacade;
  /** Plat / terrasse : hauteur de l'acrotère (m). */
  acrotere: number;
  vegetalise: boolean;
  matiere: Matiere | null;
}

export interface VolumeModele {
  id: string;
  nom: string | null;
  role: RoleVolume;
  plan: PlanVolume;
  /** Position (m) de l'origine du plan dans le repère du terrain. */
  position: { x: number; y: number };
  /** Degrés, sens trigonométrique. */
  rotation: number;
  /** Altitude (m) du dessous du volume : 0 = posé au sol ; sinon il DOIT reposer sur un autre volume. */
  altitudeBase: number;
  niveaux: number;
  hauteurEtage: number;
  /** Hauteur des murs (m) = niveaux × hauteurEtage (recalculée par la validation ; donnée seule, elle fixe hauteurEtage). */
  hauteur: number;
  /** Hauteur du soubassement (m), 0 = aucun. */
  soubassement: number;
  toit: ToitModele;
  /** Matières propres au volume (sinon celles du modèle). */
  matieres: MatieresParPartie;
}

/** Façade : un des quatre côtés, ou le numéro d'un côté du contour. */
export type RefFacade = CoteFacade | number;

export interface OuvertureModele {
  id: string;
  volume: string;
  facade: RefFacade;
  /** 0 = rez-de-chaussée. Lucarne : ignoré (posée dans le toit, niveau = combles). */
  niveau: number;
  type: TypeOuverture;
  largeur: number;
  hauteur: number;
  /** Hauteur du bas de l'ouverture au-dessus du plancher du niveau (portes : 0). Lucarne : au-dessus du haut des murs. */
  allege: number;
  /** Centre le long de la façade depuis sa gauche vue de l'extérieur (m) ; null = centré / réparti. */
  position: number | null;
  /** Ouvertures identiques côte à côte (1 à 40). */
  nombre: number;
  /** Distance entre centres quand nombre > 1 ; null = réparties sur toute la façade. */
  entraxe: number | null;
  volets: VoletsModele;
  matiere: Matiere | null;
}

/** Brique libre : coordonnées du TERRAIN (x, y = centre du pied ; z = altitude du dessous). */
export interface BriqueModele {
  forme: FormeBrique;
  x: number; y: number; z: number;
  /** Selon x avant rotation ; poteau, cylindre, cône : diamètre. */
  largeur: number;
  /** Selon y avant rotation (ignorée pour cylindre et cône). */
  profondeur: number;
  hauteur: number;
  /** Degrés autour de z. */
  rotation: number;
  matiere: Matiere | null;
}

export interface ElementModele {
  id: string;
  type: TypeElementModele;
  /** Nom libre (« four à pain », « marquise ») : obligatoire de fait pour « autre ». */
  nom: string | null;
  /** Volume porteur (null : posé librement au `point`). */
  volume: string | null;
  facade: RefFacade | null;
  niveau: number | null;
  position: number | null;
  /** Point d'ancrage libre dans le repère du terrain (pergola au jardin, cheminée) ; prime sur la façade. */
  point: { x: number; y: number; z: number } | null;
  largeur: number | null;
  profondeur: number | null;
  hauteur: number | null;
  /** Paramètres propres au type (garde-corps : 'metal'|'verre'|'plein'|'bois' ; volets : type ; colonnes : nombre…). */
  parametres: Record<string, number | string | boolean>;
  /** Décomposition libre : si non vide, l'élément est construit avec ses briques (et pas par son générateur typé). */
  briques: BriqueModele[];
  matiere: Matiere | null;
}

export interface ModeleBatiment {
  v: typeof MODELE_VERSION;
  origine: OrigineModele;
  nom: string | null;
  type: TypeBatiment;
  style: StyleBatiment;
  /** Style dit mais hors liste (« colonial », « mas camarguais ») : gardé en clair. */
  styleLibre: string | null;
  /** Matières par défaut de tout le bâtiment. */
  matieres: MatieresParPartie;
  volumes: VolumeModele[];
  ouvertures: OuvertureModele[];
  elements: ElementModele[];
  remarques: string | null;
  /**
   * VIS-63 — PROGRAMME DE LA FICHE (facultatif) : nombre de logements visé et typologies demandées (« 22 logements du T1
   * au T4 », `charge.programme.typologies`). Absent : le découpage d'un collectif suit le mix par défaut du moteur,
   * EXACTEMENT comme avant. Présent : le découpage ne pose aucune typologie hors de la liste et vise ces nombres
   * (interieurArchitecte/decoupageCollectif.ts, quotas par niveau calculés dans archviz/enrich.ts).
   */
  programme?: ProgrammeModele;
}

/** VIS-63 — programme de logements de la fiche (nombres par typologie, T1 = studio). */
export interface ProgrammeModele {
  /** Nombre de logements visé (somme des typologies si absent). */
  logements: number | null;
  typologies: Partial<Record<'T1' | 'T2' | 'T3' | 'T4' | 'T5', number>>;
}

/** VIS-63 — lecture du programme (borné, nombres entiers ≥ 0) ; null si rien d'utilisable. */
export function lireProgrammeModele(v: unknown): ProgrammeModele | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const typologies: Partial<Record<'T1' | 'T2' | 'T3' | 'T4' | 'T5', number>> = {};
  const brut = o['typologies'];
  const poser = (t: string, n: unknown) => {
    const k = t === 'studio' ? 'T1' : t === 'T5+' ? 'T5' : t;
    if (k !== 'T1' && k !== 'T2' && k !== 'T3' && k !== 'T4' && k !== 'T5') return;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return;
    typologies[k] = (typologies[k] ?? 0) + Math.min(500, Math.round(n));
  };
  /* Deux formes admises : { T1: 3, T2: 7 } ou [{ type: 'T1', nombre: 3 }] (forme de `charge.programme.typologies`). */
  if (Array.isArray(brut)) for (const x of brut) { if (typeof x === 'object' && x !== null) poser(String((x as Record<string, unknown>)['type']), (x as Record<string, unknown>)['nombre']); }
  else if (typeof brut === 'object' && brut !== null) for (const [t, n] of Object.entries(brut)) poser(t, n);
  const somme = Object.values(typologies).reduce((a, n) => a + (n ?? 0), 0);
  if (!(somme > 0)) return null;
  const l = o['logements'];
  const logements = typeof l === 'number' && Number.isFinite(l) && l >= 1 ? Math.min(1000, Math.round(l)) : null;
  return { logements, typologies };
}

/** Bornes du contrat. */
export const BORNES_MODELE = {
  volumesMax: 24, ouverturesMax: 400, elementsMax: 80, briquesParElementMax: 60, briquesMax: 600,
  coordMax: 500, dimMin: 0.5, dimMax: 200, surfaceMin: 1, niveauxMax: 30, hauteurEtageMin: 2.2, hauteurEtageMax: 6,
  altitudeMax: 150, penteMax: 75, debordMax: 2, acrotereMax: 1.5, soubassementMax: 2,
  pointsMax: 64, ouvertureDimMax: 12, nombreMax: 40, briqueDimMin: 0.02, briqueDimMax: 60, texteMax: 80, remarquesMax: 300,
  parametresMax: 20,
} as const;

// ---- Valeurs par défaut ---------------------------------------------------------

export const HAUTEUR_ETAGE_DEFAUT = 2.8;
export const TOIT_DEFAUT: ToitModele = {
  forme: 'deux_pans', pente: 35, debord: 0.4, faitage: 'largeur', basVers: 'arriere', acrotere: 0, vegetalise: false, matiere: null,
};
/** Pente par défaut par forme (degrés). */
export const PENTE_DEFAUT: Record<FormeToitModele, number> = {
  plat: 0, terrasse: 0, un_pan: 15, deux_pans: 35, quatre_pans: 30, mansart: 30, conique: 55, pyramide: 40,
};
export const toitEnPente = (f: FormeToitModele): boolean => f !== 'plat' && f !== 'terrasse';

/** Dimensions par défaut de chaque ouverture : largeur, hauteur, allège (m). */
export const OUVERTURE_DEFAUT: Record<TypeOuverture, { largeur: number; hauteur: number; allege: number }> = {
  fenetre: { largeur: 1.0, hauteur: 1.35, allege: 0.95 },
  porte_fenetre: { largeur: 1.2, hauteur: 2.15, allege: 0 },
  baie: { largeur: 2.4, hauteur: 2.2, allege: 0 },
  porte: { largeur: 0.95, hauteur: 2.15, allege: 0 },
  porte_garage: { largeur: 2.5, hauteur: 2.1, allege: 0 },
  lucarne: { largeur: 0.9, hauteur: 1.1, allege: 0.3 },
  oeil_de_boeuf: { largeur: 0.6, hauteur: 0.6, allege: 1.5 },
};
const OUVERTURE_AU_SOL: readonly TypeOuverture[] = ['porte_fenetre', 'baie', 'porte', 'porte_garage'];

/** Dimensions par défaut des éléments typés (largeur, profondeur, hauteur ; null = déduit). */
export const ELEMENT_DEFAUT: Record<TypeElementModele, { largeur: number | null; profondeur: number | null; hauteur: number | null; facade: boolean; niveau: number | null }> = {
  balcon: { largeur: 3, profondeur: 1.2, hauteur: 1.0, facade: true, niveau: 1 },
  loggia: { largeur: 3, profondeur: 1.5, hauteur: null, facade: true, niveau: 1 },
  garde_corps: { largeur: null, profondeur: 0.05, hauteur: 1.0, facade: true, niveau: null },
  auvent: { largeur: 2, profondeur: 1, hauteur: 2.4, facade: true, niveau: 0 },
  pergola: { largeur: 4, profondeur: 3, hauteur: 2.6, facade: true, niveau: 0 },
  veranda: { largeur: 4, profondeur: 3, hauteur: 2.7, facade: true, niveau: 0 },
  porche: { largeur: 2.5, profondeur: 1.8, hauteur: 2.8, facade: true, niveau: 0 },
  escalier_exterieur: { largeur: 1.2, profondeur: 3, hauteur: null, facade: true, niveau: 0 },
  cheminee: { largeur: 0.6, profondeur: 0.6, hauteur: 1.0, facade: false, niveau: null },
  volets: { largeur: null, profondeur: null, hauteur: null, facade: false, niveau: null },
  tourelle: { largeur: 3, profondeur: null, hauteur: null, facade: true, niveau: 0 },
  bow_window: { largeur: 2.4, profondeur: 0.8, hauteur: 2.2, facade: true, niveau: 1 },
  colonnes: { largeur: 3, profondeur: 0.35, hauteur: 2.8, facade: true, niveau: 0 },
  corniche: { largeur: null, profondeur: 0.25, hauteur: 0.3, facade: false, niveau: null },
  bandeau: { largeur: null, profondeur: 0.06, hauteur: 0.2, facade: false, niveau: 1 },
  colombages: { largeur: null, profondeur: null, hauteur: null, facade: false, niveau: null },
  autre: { largeur: null, profondeur: null, hauteur: null, facade: false, niveau: null },
};

// ---- Aides géométriques (exportées : le moteur 3D du Studio s'en sert) ----------

const EPS = 1e-6;
const rad = (d: number): number => (d * Math.PI) / 180;
const r2 = (v: number): number => Math.round(v * 100) / 100;
const r1 = (v: number): number => Math.round(v * 10) / 10;
/** Nombre de côtés d'un cercle (et d'un arc complet) dans le contour. */
export const SEGMENTS_CERCLE = 12;

function aireSignee(pts: readonly Point2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i]!; const q = pts[(i + 1) % pts.length]!; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
export const airePolygone = (pts: readonly Point2[]): number => Math.abs(aireSignee(pts));

/** Contour LOCAL du plan (sens trigonométrique, sans rotation ni translation). */
export function contourPlan(plan: PlanVolume): Point2[] {
  switch (plan.type) {
    case 'rectangle': {
      const a = plan.largeur / 2; const b = plan.profondeur / 2;
      return [[-a, -b], [a, -b], [a, b], [-a, b]];
    }
    case 'L': {
      const a = plan.largeur / 2; const b = plan.profondeur / 2;
      const ex = plan.epaisseurX; const ey = plan.epaisseurY;
      // Contour pour coinVide = 'arriere_droit', puis symétries.
      let pts: Point2[] = [[-a, -b], [a, -b], [a, -b + ey], [-a + ex, -b + ey], [-a + ex, b], [-a, b]];
      const miroirX = plan.coinVide === 'arriere_gauche' || plan.coinVide === 'avant_gauche';
      const miroirY = plan.coinVide === 'avant_droit' || plan.coinVide === 'avant_gauche';
      if (miroirX) pts = pts.map(([x, y]) => [-x, y] as Point2);
      if (miroirY) pts = pts.map(([x, y]) => [x, -y] as Point2);
      if (miroirX !== miroirY) pts.reverse();
      return remettreDepart(pts);
    }
    case 'polygone': return plan.points.map(([x, y]) => [x, y] as Point2);
    case 'cercle': {
      const out: Point2[] = [];
      for (let i = 0; i < SEGMENTS_CERCLE; i++) {
        // Côté 0 centré sur l'avant (normale -y) : un côté par direction franche.
        const t = -Math.PI / 2 - Math.PI / SEGMENTS_CERCLE + (i / SEGMENTS_CERCLE) * 2 * Math.PI;
        out.push([plan.rayon * Math.cos(t), plan.rayon * Math.sin(t)]);
      }
      return out;
    }
    case 'arc': {
      const d = rad(plan.angleDebut); let f = rad(plan.angleFin);
      while (f <= d + EPS) f += 2 * Math.PI;
      const n = Math.max(2, Math.ceil(((f - d) / (2 * Math.PI)) * SEGMENTS_CERCLE));
      const out: Point2[] = [];
      for (let i = 0; i <= n; i++) { const t = d + ((f - d) * i) / n; out.push([plan.rayonExterieur * Math.cos(t), plan.rayonExterieur * Math.sin(t)]); }
      if (plan.rayonInterieur > EPS) for (let i = n; i >= 0; i--) { const t = d + ((f - d) * i) / n; out.push([plan.rayonInterieur * Math.cos(t), plan.rayonInterieur * Math.sin(t)]); }
      else out.push([0, 0]);
      return out;
    }
  }
}
/** Fait commencer le contour par le point le plus « avant gauche » (côté 0 = façade avant quand c'est possible). */
function remettreDepart(pts: Point2[]): Point2[] {
  let k = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!; const q = pts[k]!;
    if (p[1] < q[1] - EPS || (Math.abs(p[1] - q[1]) <= EPS && p[0] < q[0])) k = i;
  }
  return [...pts.slice(k), ...pts.slice(0, k)];
}

/** Local → terrain (rotation puis translation). */
export function versTerrain(v: Pick<VolumeModele, 'position' | 'rotation'>, p: Point2): Point2 {
  const c = Math.cos(rad(v.rotation)); const s = Math.sin(rad(v.rotation));
  return [v.position.x + p[0] * c - p[1] * s, v.position.y + p[0] * s + p[1] * c];
}
/** Contour du volume dans le repère du terrain (sens trigonométrique). */
export function contourVolume(v: Pick<VolumeModele, 'plan' | 'position' | 'rotation'>): Point2[] {
  return contourPlan(v.plan).map((p) => versTerrain(v, p));
}
export const aireVolume = (v: Pick<VolumeModele, 'plan'>): number => airePolygone(contourPlan(v.plan));
/** Rectangle englobant local du plan. */
export function englobantLocal(plan: PlanVolume): { minX: number; maxX: number; minY: number; maxY: number } {
  const pts = contourPlan(plan);
  return {
    minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])),
    minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])),
  };
}
export function englobantTerrain(pts: readonly Point2[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])),
    minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])),
  };
}

/** Une façade résolue : segment droit du contour, vu de l'extérieur de gauche à droite. */
export interface FacadeResolue {
  /** Numéro du côté dans le contour. */
  index: number;
  /** Côté nommé dont la normale est la plus proche (avant rotation). */
  cote: CoteFacade;
  /** Extrémités dans le repère du terrain, gauche puis droite vues de l'extérieur. */
  gauche: Point2;
  droite: Point2;
  longueur: number;
  /** Normale sortante (terrain, unitaire). */
  normale: Point2;
}

function coteDeNormale(nx: number, ny: number): CoteFacade {
  if (Math.abs(ny) >= Math.abs(nx) - EPS) return ny < 0 ? 'avant' : 'arriere';
  return nx < 0 ? 'gauche' : 'droite';
}
/** Toutes les façades (côtés du contour) d'un volume. */
export function facadesVolume(v: Pick<VolumeModele, 'plan' | 'position' | 'rotation'>): FacadeResolue[] {
  const loc = contourPlan(v.plan);
  const out: FacadeResolue[] = [];
  for (let i = 0; i < loc.length; i++) {
    const a = loc[i]!; const b = loc[(i + 1) % loc.length]!;
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L = Math.hypot(dx, dy);
    if (L < EPS) continue;
    const nxl = dy / L; const nyl = -dx / L; // normale sortante locale (contour trigonométrique)
    const c = Math.cos(rad(v.rotation)); const s = Math.sin(rad(v.rotation));
    out.push({
      index: i, cote: coteDeNormale(nxl, nyl), gauche: versTerrain(v, a), droite: versTerrain(v, b), longueur: L,
      normale: [nxl * c - nyl * s, nxl * s + nyl * c],
    });
  }
  return out;
}
/** Façade désignée : numéro de côté, ou côté nommé (le plus long côté orienté ainsi). null si introuvable. */
export function resoudreFacade(v: Pick<VolumeModele, 'plan' | 'position' | 'rotation'>, ref: RefFacade): FacadeResolue | null {
  const toutes = facadesVolume(v);
  if (typeof ref === 'number') return toutes.find((f) => f.index === ref) ?? null;
  const candidates = toutes.filter((f) => f.cote === ref);
  if (!candidates.length) return null;
  // Cercle / arc : côtés courts nombreux ; on prend le plus long, puis le plus central (normale la plus franche).
  return candidates.reduce((m, f) => (f.longueur > m.longueur + 1e-3 ? f : m), candidates[0]!);
}

export const hauteurMurs = (v: Pick<VolumeModele, 'niveaux' | 'hauteurEtage'>): number => r2(v.niveaux * v.hauteurEtage);
/** Hauteur du toit au-dessus des murs (m), selon la forme et la pente. */
export function hauteurToit(v: Pick<VolumeModele, 'plan' | 'toit'>): number {
  const t = v.toit;
  const e = englobantLocal(v.plan);
  const lx = e.maxX - e.minX; const ly = e.maxY - e.minY;
  const tan = Math.tan(rad(t.pente));
  switch (t.forme) {
    case 'plat': case 'terrasse': return t.acrotere;
    case 'un_pan': return r2(((t.basVers === 'avant' || t.basVers === 'arriere') ? ly : lx) * tan);
    case 'deux_pans': return r2(((t.faitage === 'largeur' ? ly : lx) / 2) * tan);
    case 'quatre_pans': return r2((Math.min(lx, ly) / 2) * tan);
    case 'pyramide': return r2((Math.min(lx, ly) / 2) * tan);
    case 'conique': return r2((Math.max(lx, ly) / 2) * tan);
    case 'mansart': { const brisis = Math.min(lx, ly) * 0.15; return r2(brisis * Math.tan(rad(70)) + ((Math.min(lx, ly) / 2 - brisis) * tan)); }
  }
}
/** Altitude du haut des murs et du sommet du toit. */
export const hautMurs = (v: VolumeModele): number => r2(v.altitudeBase + hauteurMurs(v));
export const sommetVolume = (v: VolumeModele): number => r2(hautMurs(v) + hauteurToit(v));

/** Point dans polygone (pair-impair). */
export function pointDansPolygone(p: Point2, pts: readonly Point2[]): boolean {
  let dedans = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!; const b = pts[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] + 1e-12) + a[0]) dedans = !dedans;
  }
  return dedans;
}
/** Surface (m²) commune à deux contours, estimée par échantillonnage régulier (déterministe). */
export function surfaceCommune(a: readonly Point2[], b: readonly Point2[]): number {
  const ea = englobantTerrain(a); const eb = englobantTerrain(b);
  const minX = Math.max(ea.minX, eb.minX); const maxX = Math.min(ea.maxX, eb.maxX);
  const minY = Math.max(ea.minY, eb.minY); const maxY = Math.min(ea.maxY, eb.maxY);
  if (maxX - minX <= EPS || maxY - minY <= EPS) return 0;
  const n = 24; let k = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const p: Point2 = [minX + ((i + 0.5) / n) * (maxX - minX), minY + ((j + 0.5) / n) * (maxY - minY)];
    if (pointDansPolygone(p, a) && pointDansPolygone(p, b)) k++;
  }
  return (k / (n * n)) * (maxX - minX) * (maxY - minY);
}
/** Distance entre deux rectangles englobants (0 s'ils se touchent ou se recouvrent). */
function distanceEnglobants(a: ReturnType<typeof englobantTerrain>, b: ReturnType<typeof englobantTerrain>): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX); const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY);
  return Math.hypot(dx, dy);
}
function segmentsSeCoupent(p1: Point2, p2: Point2, p3: Point2, p4: Point2): boolean {
  const o = (a: Point2, b: Point2, c: Point2): number => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return o(p1, p2, p3) * o(p1, p2, p4) < 0 && o(p3, p4, p1) * o(p3, p4, p2) < 0;
}
function polygoneSimple(pts: readonly Point2[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
    if (segmentsSeCoupent(pts[i]!, pts[(i + 1) % n]!, pts[j]!, pts[(j + 1) % n]!)) return false;
  }
  return true;
}
function enveloppeConvexe(pts: readonly Point2[]): Point2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const croix = (o: Point2, a: Point2, b: Point2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const bas: Point2[] = []; const haut: Point2[] = [];
  for (const q of p) { while (bas.length >= 2 && croix(bas[bas.length - 2]!, bas[bas.length - 1]!, q) <= 0) bas.pop(); bas.push(q); }
  for (const q of [...p].reverse()) { while (haut.length >= 2 && croix(haut[haut.length - 2]!, haut[haut.length - 1]!, q) <= 0) haut.pop(); haut.push(q); }
  return [...bas.slice(0, -1), ...haut.slice(0, -1)];
}

/** Une ouverture posée : centre le long de la façade, bas et haut (altitudes du terrain). */
export interface OuverturePosee {
  id: string;
  /** Rang dans le groupe (0 … nombre-1). */
  rang: number;
  type: TypeOuverture;
  facade: FacadeResolue;
  /** Distance du centre depuis la gauche de la façade. */
  centre: number;
  largeur: number;
  hauteur: number;
  /** Altitude du bas (terrain). */
  bas: number;
}
/** Centres (le long de la façade) des ouvertures d'un groupe. */
export function centresGroupe(longueur: number, position: number | null, nombre: number, entraxe: number | null): number[] {
  if (nombre <= 1) return [position ?? longueur / 2];
  const e = entraxe ?? longueur / nombre;
  const milieu = position ?? longueur / 2;
  const debut = milieu - (e * (nombre - 1)) / 2;
  return Array.from({ length: nombre }, (_, i) => debut + i * e);
}
/** Ouvertures d'un modèle VALIDÉ, une par une, avec leur place exacte. */
export function ouverturesPosees(m: ModeleBatiment): OuverturePosee[] {
  const out: OuverturePosee[] = [];
  for (const o of m.ouvertures) {
    const v = m.volumes.find((x) => x.id === o.volume); if (!v) continue;
    const f = resoudreFacade(v, o.facade); if (!f) continue;
    const plancher = o.type === 'lucarne' ? hautMurs(v) : v.altitudeBase + o.niveau * v.hauteurEtage;
    centresGroupe(f.longueur, o.position, o.nombre, o.entraxe).forEach((c, rang) => {
      out.push({ id: o.id, rang, type: o.type, facade: f, centre: r2(c), largeur: o.largeur, hauteur: o.hauteur, bas: r2(plancher + o.allege) });
    });
  }
  return out;
}

// ---- Validation sans confiance ------------------------------------------------

export interface OptionsValidation {
  /** Bloc relu d'un message : la moindre correction est une ERREUR (jamais devinée). */
  strict?: boolean;
  /** Identifiants `refStudio` connus (catalogue VIS-24) : une référence inconnue est retirée (couleur/famille gardées). */
  refsConnues?: readonly string[] | undefined;
}
export type ValidationModele =
  | { ok: true; modele: ModeleBatiment; /** « Ce que j'ai corrigé », en français simple. */ corrections: string[]; /** Ce qui semble étrange mais est gardé. */ avertissements: string[] }
  | { ok: false; erreur: string; corrections: string[]; avertissements: string[] };

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const dans = <T extends string>(liste: readonly T[], v: unknown): v is T => typeof v === 'string' && (liste as readonly string[]).includes(v);
function texteCourt(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = Array.from(v, (ch) => (ch.charCodeAt(0) < 32 || ch === '`' ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}
const nombreFini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Lit un nombre ; absent : défaut (sans note) ; illisible : défaut (noté) ; hors bornes : ramené (noté). Arrondi au cm. */
function lireNombre(v: unknown, min: number, max: number, defaut: number, note: (m: string) => void, quoi: string, arrondi: (x: number) => number = r2): number {
  if (v === undefined || v === null) return defaut;
  let x = v;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x.replace(',', '.')))) x = Number(x.replace(',', '.'));
  if (!nombreFini(x)) { note(`${quoi} illisible : ${String(defaut).replace('.', ',')} retenu`); return defaut; }
  const y = arrondi(Math.max(min, Math.min(max, x)));
  if (Math.abs(arrondi(x) - y) > 1e-9) note(`${quoi} ramené(e) à ${String(y).replace('.', ',')}`);
  return y;
}
const normaliserAngle = (a: number): number => { let x = ((a % 360) + 360) % 360; if (x > 180) x -= 360; return r1(x); };
const RE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const RE_COULEUR = /^#[0-9a-fA-F]{6}$/;

/** Familles déduites d'une référence de catalogue (préfixes av-/qm- et noms Unreal). */
export function familleDeRef(ref: string): FamilleMatiere | null {
  const r = ref.toLowerCase();
  if (r.includes('brique')) return 'brique';
  if (r.includes('pierre') || r.includes('marbre') || r.includes('gres') || r.includes('meuliere')) return 'pierre';
  if (r.includes('beton')) return 'beton';
  if (r.includes('bois') || r.includes('bardage')) return 'bois';
  if (r.includes('enduit')) return 'enduit';
  if (r.includes('zinc')) return r.includes('facade') ? 'metal' : 'zinc';
  if (r.includes('metal') || r.includes('alu') || r.includes('acier')) return 'metal';
  if (r.includes('verre') || r.includes('vitr')) return 'verre';
  if (r.includes('ardoise')) return 'ardoise';
  if (r.includes('tuile')) return 'tuile';
  if (r.includes('vegetal')) return 'vegetal';
  return null;
}

function lireMatiere(v: unknown, quoi: string, note: (m: string) => void, refs: readonly string[] | undefined): Matiere | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') {
    // Tolérance : une chaîne seule = couleur (#rrggbb) ou référence.
    if (RE_COULEUR.test(v)) return { refStudio: null, couleur: v.toLowerCase(), famille: null };
    v = { refStudio: v };
  }
  if (!estObj(v)) { note(`matière ${quoi} illisible : ignorée`); return null; }
  let refStudio = texteCourt(v.refStudio ?? v.ref, 60);
  if (refStudio && refs && !refs.includes(refStudio)) { note(`matière ${quoi} : référence « ${refStudio} » inconnue du catalogue, retirée`); refStudio = null; }
  let couleur: string | null = null;
  if (v.couleur !== undefined && v.couleur !== null) {
    if (typeof v.couleur === 'string' && RE_COULEUR.test(v.couleur)) couleur = v.couleur.toLowerCase();
    else note(`matière ${quoi} : couleur illisible (#rrggbb attendu), ignorée`);
  }
  let famille: FamilleMatiere | null = null;
  if (v.famille !== undefined && v.famille !== null) {
    if (dans(FAMILLES_MATIERE, v.famille)) famille = v.famille;
    else { famille = 'autre'; note(`matière ${quoi} : famille « ${String(v.famille).slice(0, 20)} » inconnue, notée « autre »`); }
  }
  if (!refStudio && !couleur && !famille) return null;
  return { refStudio, couleur, famille };
}
function lireMatieres(v: unknown, quoi: string, note: (m: string) => void, refs: readonly string[] | undefined): MatieresParPartie {
  const out: MatieresParPartie = {};
  if (v === undefined || v === null) return out;
  if (!estObj(v)) { note(`matières ${quoi} illisibles : ignorées`); return out; }
  for (const [k, x] of Object.entries(v)) {
    if (!dans(PARTIES_MATIERE, k)) { note(`matières ${quoi} : partie « ${k.slice(0, 20)} » inconnue, ignorée`); continue; }
    const m = lireMatiere(x, `${quoi} (${k})`, note, refs);
    if (m) out[k] = m;
  }
  return out;
}

function lirePlan(v: unknown, quoi: string, note: (m: string) => void): PlanVolume | null {
  const B = BORNES_MODELE;
  if (!estObj(v)) return null;
  const n = (x: unknown, min: number, max: number, d: number, nom: string): number => lireNombre(x, min, max, d, note, `${quoi} : ${nom}`);
  const type = v.type === 'l' ? 'L' : v.type;
  switch (type) {
    case 'rectangle': return { type, largeur: n(v.largeur, B.dimMin, B.dimMax, 10, 'largeur'), profondeur: n(v.profondeur, B.dimMin, B.dimMax, 8, 'profondeur') };
    case 'L': {
      const largeur = n(v.largeur, 2, B.dimMax, 14, 'largeur'); const profondeur = n(v.profondeur, 2, B.dimMax, 12, 'profondeur');
      const epaisseurX = n(v.epaisseurX, B.dimMin, largeur - B.dimMin, r2(Math.min(largeur - B.dimMin, Math.max(B.dimMin, largeur * 0.45))), 'épaisseur de branche (x)');
      const epaisseurY = n(v.epaisseurY, B.dimMin, profondeur - B.dimMin, r2(Math.min(profondeur - B.dimMin, Math.max(B.dimMin, profondeur * 0.45))), 'épaisseur de branche (y)');
      let coinVide: CoinPlan = 'arriere_droit';
      if (v.coinVide !== undefined && v.coinVide !== null) { if (dans(COINS_PLAN, v.coinVide)) coinVide = v.coinVide; else note(`${quoi} : coin vide inconnu, « arrière droit » retenu`); }
      return { type, largeur, profondeur, epaisseurX, epaisseurY, coinVide };
    }
    case 'polygone': {
      if (!Array.isArray(v.points)) return null;
      let pts: Point2[] = [];
      for (const p of v.points.slice(0, B.pointsMax)) {
        const x = Array.isArray(p) ? p[0] : estObj(p) ? p.x : undefined; const y = Array.isArray(p) ? p[1] : estObj(p) ? p.y : undefined;
        if (!nombreFini(x) || !nombreFini(y)) continue;
        const q: Point2 = [r2(Math.max(-B.dimMax, Math.min(B.dimMax, x))), r2(Math.max(-B.dimMax, Math.min(B.dimMax, y)))];
        const prec = pts[pts.length - 1];
        if (!prec || Math.hypot(prec[0] - q[0], prec[1] - q[1]) > 0.01) pts.push(q);
      }
      if (v.points.length > B.pointsMax) note(`${quoi} : ${B.pointsMax} points au plus, le reste est ignoré`);
      while (pts.length > 1 && Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]) <= 0.01) pts.pop();
      if (pts.length < 3) return null;
      if (!polygoneSimple(pts)) { pts = enveloppeConvexe(pts); note(`${quoi} : contour qui se croisait, remplacé par son enveloppe`); }
      if (aireSignee(pts) < 0) pts.reverse();
      return { type: 'polygone', points: remettreDepart(pts) };
    }
    case 'cercle': return { type, rayon: n(v.rayon ?? (nombreFini(v.diametre) ? v.diametre / 2 : undefined), 0.3, B.dimMax / 2, 2, 'rayon') };
    case 'arc': {
      const rayonExterieur = n(v.rayonExterieur ?? v.rayon, 1, B.dimMax / 2, 10, 'rayon extérieur');
      const rayonInterieur = n(v.rayonInterieur, 0, rayonExterieur - B.dimMin, 0, 'rayon intérieur');
      const angleDebut = normaliserAngle(nombreFini(v.angleDebut) ? v.angleDebut : 0);
      let angleFin = normaliserAngle(nombreFini(v.angleFin) ? v.angleFin : 90);
      if (Math.abs(angleFin - angleDebut) < 5) { angleFin = normaliserAngle(angleDebut + 90); note(`${quoi} : arc trop fermé, ouvert à 90°`); }
      return { type, rayonExterieur, rayonInterieur, angleDebut, angleFin };
    }
    default: return null;
  }
}

function lireToit(v: unknown, quoi: string, note: (m: string) => void, refs: readonly string[] | undefined): ToitModele {
  const B = BORNES_MODELE;
  const t: Obj = estObj(v) ? v : typeof v === 'string' ? { forme: v } : {};
  if (v !== undefined && v !== null && !estObj(v) && typeof v !== 'string') note(`${quoi} illisible : toit à deux pans`);
  let forme: FormeToitModele = TOIT_DEFAUT.forme;
  if (t.forme !== undefined && t.forme !== null) {
    const alias: Record<string, FormeToitModele> = { mansarde: 'mansart', monopente: 'un_pan', croupes: 'quatre_pans', cone: 'conique', vegetalisee: 'terrasse' };
    const f = typeof t.forme === 'string' ? (alias[t.forme] ?? t.forme) : t.forme;
    if (dans(FORMES_TOIT_MODELE, f)) forme = f;
    else note(`${quoi} : forme « ${String(t.forme).slice(0, 20)} » inconnue, deux pans retenus`);
  }
  const pente = toitEnPente(forme) ? lireNombre(t.pente, 5, forme === 'conique' ? 80 : B.penteMax, PENTE_DEFAUT[forme], note, `${quoi} : pente`, r1) : 0;
  const debord = lireNombre(t.debord, 0, B.debordMax, toitEnPente(forme) ? TOIT_DEFAUT.debord : 0, note, `${quoi} : débord`);
  let faitage: Faitage = 'largeur';
  if (t.faitage !== undefined && t.faitage !== null) { if (dans(FAITAGES, t.faitage)) faitage = t.faitage; else note(`${quoi} : faîtage inconnu, parallèle à la largeur`); }
  let basVers: CoteFacade = 'arriere';
  if (t.basVers !== undefined && t.basVers !== null) { if (dans(COTES_FACADE, t.basVers)) basVers = t.basVers; else note(`${quoi} : côté bas inconnu, vers l'arrière`); }
  const acrotere = toitEnPente(forme) ? 0 : lireNombre(t.acrotere, 0, B.acrotereMax, forme === 'terrasse' ? 0.5 : 0.15, note, `${quoi} : acrotère`);
  const vegetalise = !toitEnPente(forme) && (t.vegetalise === true || t.forme === 'vegetalisee');
  const matiere = lireMatiere(t.matiere, `${quoi}`, note, refs);
  return { forme, pente, debord, faitage, basVers, acrotere, vegetalise, matiere };
}

/** Lit un identifiant ; absent, invalide ou en double : un identifiant neuf (noté s'il était donné). */
function fabriqueIds(): { lire: (v: unknown, prefixe: string, quoi: string, note: (m: string) => void) => string; reserver: (id: string) => void } {
  const pris = new Set<string>();
  const compteurs: Record<string, number> = {};
  const neuf = (prefixe: string): string => { let k = compteurs[prefixe] ?? 1; while (pris.has(`${prefixe}${k}`)) k++; compteurs[prefixe] = k + 1; return `${prefixe}${k}`; };
  return {
    reserver: (id) => { pris.add(id); },
    lire: (v, prefixe, quoi, note) => {
      const brut = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : null;
      if (brut && RE_ID.test(brut) && !pris.has(brut)) { pris.add(brut); return brut; }
      const id = neuf(prefixe); pris.add(id);
      if (brut) note(`${quoi} : identifiant « ${brut.slice(0, 20)} » ${pris.has(brut) ? 'en double' : 'invalide'}, renommé « ${id} »`);
      return id;
    },
  };
}

function lireRefFacade(v: unknown): RefFacade | null {
  if (dans(COTES_FACADE, v)) return v;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 200) return v;
  if (typeof v === 'string' && /^\d{1,3}$/.test(v)) return Number(v);
  const alias: Record<string, CoteFacade> = { rue: 'avant', devant: 'avant', fond: 'arriere', derriere: 'arriere', jardin: 'arriere', 'arrière': 'arriere' };
  if (typeof v === 'string' && alias[v]) return alias[v]!;
  return null;
}

function lireBrique(v: unknown, quoi: string, note: (m: string) => void, refs: readonly string[] | undefined): BriqueModele | null {
  const B = BORNES_MODELE;
  if (!estObj(v)) return null;
  let forme: FormeBrique = 'boite';
  if (dans(FORMES_BRIQUE, v.forme)) forme = v.forme;
  else if (v.forme !== undefined) note(`${quoi} : forme « ${String(v.forme).slice(0, 20)} » inconnue, boîte retenue`);
  const d = (x: unknown, def: number, nom: string): number => lireNombre(x, B.briqueDimMin, B.briqueDimMax, def, note, `${quoi} : ${nom}`);
  const c = (x: unknown, nom: string): number => lireNombre(x, -B.coordMax, B.coordMax, 0, note, `${quoi} : ${nom}`);
  const largeur = d(v.largeur ?? v.diametre, forme === 'poteau' ? 0.2 : 1, 'largeur');
  const profondeur = forme === 'cylindre' || forme === 'cone' || forme === 'poteau' ? largeur : d(v.profondeur, forme === 'plaque' ? 1 : 1, 'profondeur');
  const hauteur = d(v.hauteur ?? v.epaisseur, forme === 'plaque' ? 0.15 : 1, 'hauteur');
  return {
    forme, x: c(v.x, 'x'), y: c(v.y, 'y'), z: lireNombre(v.z, 0, B.altitudeMax, 0, note, `${quoi} : altitude`),
    largeur, profondeur, hauteur, rotation: normaliserAngle(nombreFini(v.rotation) ? v.rotation : 0), matiere: lireMatiere(v.matiere, quoi, note, refs),
  };
}

function lireParametres(v: unknown, quoi: string, note: (m: string) => void): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  if (v === undefined || v === null) return out;
  if (!estObj(v)) { note(`${quoi} : paramètres illisibles, ignorés`); return out; }
  let n = 0;
  for (const [k, x] of Object.entries(v)) {
    if (n >= BORNES_MODELE.parametresMax) { note(`${quoi} : ${BORNES_MODELE.parametresMax} paramètres au plus`); break; }
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,29}$/.test(k)) continue;
    if (typeof x === 'boolean') out[k] = x;
    else if (nombreFini(x)) out[k] = r2(Math.max(-1000, Math.min(1000, x)));
    else if (typeof x === 'string') { const t = texteCourt(x, 40); if (t) out[k] = t; }
    else continue;
    n++;
  }
  return out;
}

/** Rectangle englobant 3D d'une brique (approché, rotation comprise). */
function boiteBrique(b: BriqueModele): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  const c = Math.abs(Math.cos(rad(b.rotation))); const s = Math.abs(Math.sin(rad(b.rotation)));
  const hx = (b.largeur * c + b.profondeur * s) / 2; const hy = (b.largeur * s + b.profondeur * c) / 2;
  return { minX: b.x - hx, maxX: b.x + hx, minY: b.y - hy, maxY: b.y + hy, minZ: b.z, maxZ: b.z + b.hauteur };
}

const TOLERANCE_APPUI = 0.3;

/**
 * Brut (proposé par le modèle de langue, relu d'un bloc ou reçu du site) → modèle VALIDÉ.
 * Jamais d'exception. Hors mode strict : tout ce qui est illisible est écarté ou ramené dans les bornes, et DIT dans
 * `corrections` (phrases françaises simples, pour la liste « Ce que j'ai corrigé »). Idempotent : valider un modèle
 * déjà validé ne produit aucune correction.
 */
export function validerModele(brut: unknown, options: OptionsValidation = {}): ValidationModele {
  const corrections: string[] = [];
  const avertissements: string[] = [];
  const note = (m: string): void => { if (!corrections.includes(m)) corrections.push(m); };
  const remarquer = (m: string): void => { if (!avertissements.includes(m)) avertissements.push(m); };
  const echec = (erreur: string): ValidationModele => ({ ok: false, erreur, corrections, avertissements });
  try {
    return validerInterne(brut, options, note, remarquer, corrections, avertissements, echec);
  } catch {
    return echec('Modèle illisible.');
  }
}

function validerInterne(
  brut: unknown, options: OptionsValidation, note: (m: string) => void, remarquer: (m: string) => void,
  corrections: string[], avertissements: string[], echec: (e: string) => ValidationModele,
): ValidationModele {
  const B = BORNES_MODELE;
  const refs = options.refsConnues;
  if (!estObj(brut)) return echec('Modèle illisible : objet attendu.');
  if (brut.v !== undefined && brut.v !== MODELE_VERSION) return echec('Modèle d’une version inconnue.');
  const ids = fabriqueIds();
  const origine: OrigineModele = dans(ORIGINES_MODELE, brut.origine) ? brut.origine : 'texte';
  if (brut.origine !== undefined && !dans(ORIGINES_MODELE, brut.origine)) note('origine inconnue : « texte » retenu');
  const nom = texteCourt(brut.nom, B.texteMax);
  let type: TypeBatiment = 'maison';
  if (brut.type !== undefined && brut.type !== null) { if (dans(TYPES_BATIMENT, brut.type)) type = brut.type; else { type = 'autre'; note('type de bâtiment inconnu : « autre bâtiment »'); } }
  let style: StyleBatiment = 'contemporain';
  let styleLibre = texteCourt(brut.styleLibre, B.texteMax);
  if (brut.style !== undefined && brut.style !== null) {
    if (dans(STYLES_BATIMENT, brut.style)) style = brut.style;
    else { style = 'autre'; styleLibre ??= texteCourt(brut.style, B.texteMax); }
  }
  if (style !== 'autre') styleLibre = null;
  const matieres = lireMatieres(brut.matieres, 'du bâtiment', note, refs);
  const remarques = texteCourt(brut.remarques, B.remarquesMax);

  // ---- Volumes
  const volumes: VolumeModele[] = [];
  const volBruts = Array.isArray(brut.volumes) ? brut.volumes : [];
  if (brut.volumes !== undefined && !Array.isArray(brut.volumes)) note('volumes illisibles');
  if (volBruts.length > B.volumesMax) note(`${B.volumesMax} volumes au plus : les suivants sont ignorés`);
  volBruts.slice(0, B.volumesMax).forEach((vb, i) => {
    const quoi = `volume ${estObj(vb) && typeof vb.nom === 'string' ? `« ${texteCourt(vb.nom, 30)} »` : `n° ${i + 1}`}`;
    if (!estObj(vb)) { note(`${quoi} illisible : écarté`); return; }
    const plan = lirePlan(vb.plan, quoi, note);
    if (!plan) { note(`${quoi} : plan illisible, volume écarté`); return; }
    const aire = airePolygone(contourPlan(plan));
    if (aire < B.surfaceMin) { note(`${quoi} : plan de moins de ${B.surfaceMin} m², volume écarté`); return; }
    const pos = estObj(vb.position) ? vb.position : {};
    const position = {
      x: lireNombre(pos.x, -B.coordMax, B.coordMax, 0, note, `${quoi} : position x`),
      y: lireNombre(pos.y, -B.coordMax, B.coordMax, 0, note, `${quoi} : position y`),
    };
    const rotation = normaliserAngle(nombreFini(vb.rotation) ? vb.rotation : 0);
    const altitudeBase = lireNombre(vb.altitudeBase, 0, B.altitudeMax, 0, note, `${quoi} : altitude de base`);
    // Niveaux / hauteur d'étage / hauteur : la hauteur seule fixe l'étage ; les trois doivent s'accorder.
    const hDonnee = nombreFini(vb.hauteur) ? Math.max(B.hauteurEtageMin, Math.min(B.niveauxMax * B.hauteurEtageMax, vb.hauteur)) : null;
    let niveaux = lireNombre(vb.niveaux, 1, B.niveauxMax, hDonnee ? Math.max(1, Math.round(hDonnee / HAUTEUR_ETAGE_DEFAUT)) : 1, note, `${quoi} : niveaux`, Math.round);
    let hauteurEtage = lireNombre(vb.hauteurEtage, B.hauteurEtageMin, B.hauteurEtageMax, hDonnee ? r2(Math.max(B.hauteurEtageMin, Math.min(B.hauteurEtageMax, hDonnee / niveaux))) : HAUTEUR_ETAGE_DEFAUT, note, `${quoi} : hauteur d’étage`);
    if (hDonnee !== null && Math.abs(niveaux * hauteurEtage - hDonnee) > 0.05) {
      if (vb.hauteurEtage === undefined || vb.hauteurEtage === null) {
        hauteurEtage = r2(Math.max(B.hauteurEtageMin, Math.min(B.hauteurEtageMax, hDonnee / niveaux)));
        if (Math.abs(niveaux * hauteurEtage - hDonnee) > 0.05) { niveaux = Math.max(1, Math.min(B.niveauxMax, Math.round(hDonnee / hauteurEtage))); }
      }
      if (Math.abs(niveaux * hauteurEtage - hDonnee) > 0.05) note(`${quoi} : hauteur ${String(r2(hDonnee)).replace('.', ',')} m incompatible avec ${niveaux} niveau(x) de ${String(hauteurEtage).replace('.', ',')} m, recalculée`);
    }
    const role: RoleVolume = dans(ROLES_VOLUME, vb.role) ? vb.role : i === 0 ? 'principal' : 'annexe';
    if (vb.role !== undefined && vb.role !== null && !dans(ROLES_VOLUME, vb.role)) note(`${quoi} : rôle inconnu`);
    const toit = lireToit(vb.toit, `${quoi} : toit`, note, refs);
    const soubassement = lireNombre(vb.soubassement, 0, Math.min(B.soubassementMax, hauteurEtage), 0, note, `${quoi} : soubassement`);
    volumes.push({
      id: ids.lire(vb.id, 'v', quoi, note), nom: texteCourt(vb.nom, B.texteMax), role, plan, position, rotation, altitudeBase,
      niveaux, hauteurEtage, hauteur: r2(niveaux * hauteurEtage), soubassement, toit, matieres: lireMatieres(vb.matieres, quoi, note, refs),
    });
  });
  if (!volumes.length) return echec('Aucun volume lisible : il faut au moins un volume (plan, position, niveaux).');
  if (!volumes.some((v) => v.role === 'principal')) {
    const plusGrand = volumes.reduce((m, v) => (aireVolume(v) > aireVolume(m) ? v : m), volumes[0]!);
    plusGrand.role = 'principal';
  }
  const libelleVol = (v: VolumeModele): string => `« ${v.nom ?? v.id} »`;

  // Volumes dans le terrain.
  for (const v of volumes) {
    const e = englobantTerrain(contourVolume(v));
    if (Math.max(Math.abs(e.minX), Math.abs(e.maxX), Math.abs(e.minY), Math.abs(e.maxY)) > B.coordMax) {
      v.position = { x: r2(Math.max(-B.coordMax / 2, Math.min(B.coordMax / 2, v.position.x))), y: r2(Math.max(-B.coordMax / 2, Math.min(B.coordMax / 2, v.position.y))) };
      note(`volume ${libelleVol(v)} hors du terrain : rapproché`);
    }
  }

  // Doublons exacts.
  for (let i = volumes.length - 1; i > 0; i--) {
    const a = volumes[i]!;
    const twin = volumes.slice(0, i).find((b) => JSON.stringify({ ...b, id: '', nom: '', role: '' }) === JSON.stringify({ ...a, id: '', nom: '', role: '' }));
    if (twin) { volumes.splice(i, 1); note(`volume ${libelleVol(a)} identique à ${libelleVol(twin)} : retiré`); }
  }

  // Rien ne flotte : un volume surélevé repose sur un autre volume (dessus de ses murs) ; sinon il descend.
  const contours = new Map(volumes.map((v) => [v.id, contourVolume(v)] as const));
  const ordre = [...volumes].sort((a, b) => a.altitudeBase - b.altitudeBase);
  for (const v of ordre) {
    if (v.altitudeBase <= 0.05) { if (v.altitudeBase !== 0) v.altitudeBase = 0; continue; }
    const c = contours.get(v.id)!;
    const sous = volumes.filter((w) => w !== v && w.altitudeBase < v.altitudeBase - 0.01 && surfaceCommune(c, contours.get(w.id)!) > 0.2);
    const appui = sous.find((w) => Math.abs(hautMurs(w) - v.altitudeBase) <= TOLERANCE_APPUI);
    if (appui) { const h = hautMurs(appui); if (Math.abs(h - v.altitudeBase) > 0.001) v.altitudeBase = h; continue; }
    const plusHaut = sous.filter((w) => hautMurs(w) < v.altitudeBase).reduce<VolumeModele | null>((m, w) => (!m || hautMurs(w) > hautMurs(m) ? w : m), null);
    if (plusHaut) { v.altitudeBase = hautMurs(plusHaut); note(`volume ${libelleVol(v)} flottait : posé sur ${libelleVol(plusHaut)}`); }
    else if (sous.length) { /* repose dans un volume plus haut (ex. attique encastré) : gardé */ }
    else { v.altitudeBase = 0; note(`volume ${libelleVol(v)} flottait : posé au sol`); }
  }

  // Chevauchements absurdes (signalés, pas corrigés : la composition reste celle demandée).
  for (let i = 0; i < volumes.length; i++) for (let j = i + 1; j < volumes.length; j++) {
    const a = volumes[i]!; const b = volumes[j]!;
    const za = [a.altitudeBase, hautMurs(a)]; const zb = [b.altitudeBase, hautMurs(b)];
    if (Math.min(za[1]!, zb[1]!) - Math.max(za[0]!, zb[0]!) <= 0.1) continue;
    const commun = surfaceCommune(contours.get(a.id)!, contours.get(b.id)!);
    const petit = Math.min(aireVolume(a), aireVolume(b));
    if (commun >= 0.95 * petit) {
      const [p, g] = aireVolume(a) <= aireVolume(b) ? [a, b] : [b, a];
      if (hautMurs(p) <= hautMurs(g) + 0.05 && p.altitudeBase >= g.altitudeBase - 0.05) remarquer(`le volume ${libelleVol(p)} est entièrement caché dans ${libelleVol(g)}`);
      else remarquer(`le volume ${libelleVol(p)} est posé à l’intérieur de ${libelleVol(g)} et le dépasse`);
    } else if (commun > 0.5 * petit) remarquer(`les volumes ${libelleVol(a)} et ${libelleVol(b)} se chevauchent largement`);
  }

  // ---- Ouvertures
  const ouvertures: OuvertureModele[] = [];
  const ouvBruts = Array.isArray(brut.ouvertures) ? brut.ouvertures : [];
  if (brut.ouvertures !== undefined && brut.ouvertures !== null && !Array.isArray(brut.ouvertures)) note('ouvertures illisibles');
  if (ouvBruts.length > B.ouverturesMax) note(`${B.ouverturesMax} ouvertures au plus : les suivantes sont ignorées`);
  const principal = volumes.find((v) => v.role === 'principal')!;
  const occupes = new Map<string, [number, number, string][]>();
  ouvBruts.slice(0, B.ouverturesMax).forEach((ob, i) => {
    if (!estObj(ob)) { note(`ouverture n° ${i + 1} illisible : écartée`); return; }
    const alias: Record<string, TypeOuverture> = { porte_entree: 'porte', baie_vitree: 'baie', garage: 'porte_garage', oeil_boeuf: 'oeil_de_boeuf', hublot: 'oeil_de_boeuf', fenetre_toit: 'lucarne', chien_assis: 'lucarne' };
    let typeO: TypeOuverture = 'fenetre';
    const tb = typeof ob.type === 'string' ? (alias[ob.type] ?? ob.type) : ob.type;
    if (dans(TYPES_OUVERTURE, tb)) typeO = tb; else note(`ouverture n° ${i + 1} : type inconnu, fenêtre retenue`);
    const quoi = `ouverture « ${typeof ob.id === 'string' ? ob.id.slice(0, 20) : `n° ${i + 1}`} » (${LIBELLES_OUVERTURE[typeO].toLowerCase()})`;
    let v = volumes.find((x) => x.id === ob.volume);
    if (!v) {
      if (ob.volume !== undefined && ob.volume !== null) note(`${quoi} : volume inconnu, posée sur le volume principal`);
      v = principal;
    }
    let facade = lireRefFacade(ob.facade);
    if (facade === null) { if (ob.facade !== undefined) note(`${quoi} : façade inconnue, façade avant retenue`); facade = 'avant'; }
    let f = resoudreFacade(v, facade);
    if (!f) { note(`${quoi} : façade introuvable sur ${libelleVol(v)}, façade avant retenue`); facade = 'avant'; f = resoudreFacade(v, 'avant') ?? facadesVolume(v)[0]!; }
    // Lucarne : seulement dans un toit en pente, sur un pan (pas sur un pignon).
    if (typeO === 'lucarne') {
      if (!toitEnPente(v.toit.forme) || v.toit.forme === 'conique') { typeO = 'fenetre'; note(`${quoi} : pas de toit en pente pour une lucarne, fenêtre au dernier niveau à la place`); }
      else if (v.toit.forme === 'deux_pans' && typeof facade === 'string') {
        const pignons: CoteFacade[] = v.toit.faitage === 'largeur' ? ['gauche', 'droite'] : ['avant', 'arriere'];
        if (pignons.includes(facade)) { const nf: CoteFacade = v.toit.faitage === 'largeur' ? 'avant' : 'gauche'; note(`${quoi} : une lucarne ne se pose pas sur un pignon, déplacée côté ${nf}`); facade = nf; f = resoudreFacade(v, nf) ?? f; }
      } else if (v.toit.forme === 'un_pan' && typeof facade === 'string' && facade !== v.toit.basVers) {
        note(`${quoi} : une lucarne se pose sur le pan, déplacée côté ${v.toit.basVers}`); facade = v.toit.basVers; f = resoudreFacade(v, facade) ?? f;
      }
    }
    const D = OUVERTURE_DEFAUT[typeO];
    let niveau = typeO === 'lucarne' ? v.niveaux : lireNombre(ob.niveau, 0, v.niveaux - 1, 0, note, `${quoi} : niveau`, Math.round);
    if (typeO === 'porte_garage' && niveau !== 0) { niveau = 0; note(`${quoi} : une porte de garage est au rez-de-chaussée`); }
    let largeur = lireNombre(ob.largeur, 0.3, B.ouvertureDimMax, D.largeur, note, `${quoi} : largeur`);
    let hauteur = lireNombre(ob.hauteur, 0.3, B.ouvertureDimMax, D.hauteur, note, `${quoi} : hauteur`);
    let allege = OUVERTURE_AU_SOL.includes(typeO) ? 0 : lireNombre(ob.allege, 0, 10, D.allege, note, `${quoi} : allège`);
    if (OUVERTURE_AU_SOL.includes(typeO) && nombreFini(ob.allege) && ob.allege > 0.01) note(`${quoi} : une porte part du sol, allège mise à 0`);
    // Tenir dans la hauteur de l'étage (ou sous le faîtage pour une lucarne).
    const haut = typeO === 'lucarne' ? Math.max(0.6, hauteurToit(v) - 0.3) : v.hauteurEtage - 0.15;
    if (allege + hauteur > haut + 0.001) {
      const h2 = r2(Math.max(0.3, haut - allege));
      if (h2 >= 0.3 && haut - allege >= 0.3) { hauteur = h2; note(`${quoi} : trop haute pour l’étage, hauteur ramenée à ${String(h2).replace('.', ',')} m`); }
      else { allege = r2(Math.max(0, haut - hauteur)); if (allege + hauteur > haut + 0.001) hauteur = r2(Math.max(0.3, haut - allege)); note(`${quoi} : trop haute pour l’étage, allège et hauteur ajustées`); }
    }
    // Tenir dans la façade (largeur du groupe).
    let nombre = lireNombre(ob.nombre, 1, B.nombreMax, 1, note, `${quoi} : nombre`, Math.round);
    let entraxe = nombre > 1 && ob.entraxe !== undefined && ob.entraxe !== null ? lireNombre(ob.entraxe, 0.3, B.dimMax, largeur + 1, note, `${quoi} : entraxe`) : null;
    const marge = 0.15;
    const dispo = f.longueur - 2 * marge;
    if (largeur > dispo) { largeur = r2(Math.max(0.3, dispo)); note(`${quoi} : plus large que la façade, largeur ramenée à ${String(largeur).replace('.', ',')} m`); }
    if (largeur > dispo + 0.001) { note(`${quoi} : façade trop étroite (${String(r2(f.longueur)).replace('.', ',')} m), ouverture retirée`); return; }
    if (entraxe !== null && entraxe < largeur + 0.1) { entraxe = r2(largeur + 0.1); note(`${quoi} : ouvertures collées, entraxe porté à ${String(entraxe).replace('.', ',')} m`); }
    const pasMin = entraxe ?? (largeur + 0.3);
    const nMax = Math.max(1, Math.floor((dispo - largeur) / Math.max(pasMin, 0.01)) + 1);
    if (entraxe === null && nombre > 1 && (f.longueur / nombre) < largeur + 0.3) {
      const n2 = Math.max(1, Math.floor(f.longueur / (largeur + 0.3)));
      if (n2 < nombre) { note(`${quoi} : ${nombre} ouvertures ne tiennent pas sur la façade, ${n2} gardées`); nombre = n2; }
    } else if (entraxe !== null && nombre > nMax) { note(`${quoi} : ${nombre} ouvertures ne tiennent pas sur la façade, ${nMax} gardées`); nombre = nMax; }
    if (nombre === 1) entraxe = null;
    let position: number | null = ob.position === undefined || ob.position === null ? null : lireNombre(ob.position, -B.dimMax, B.dimMax * 2, f.longueur / 2, note, `${quoi} : position`);
    const largeurGroupe = (nombre - 1) * (entraxe ?? f.longueur / nombre) + largeur;
    if (position !== null) {
      const min = marge + largeurGroupe / 2; const max = f.longueur - marge - largeurGroupe / 2;
      const p2 = r2(Math.max(min, Math.min(max, position)));
      if (Math.abs(p2 - position) > 0.01) { note(`${quoi} : dépassait de la façade, recentrée`); }
      position = p2;
    }
    let volets: VoletsModele = 'aucun';
    if (ob.volets !== undefined && ob.volets !== null) { if (dans(VOLETS_MODELE, ob.volets)) volets = ob.volets; else note(`${quoi} : volets inconnus, ignorés`); }
    if (volets !== 'aucun' && (typeO === 'lucarne' || typeO === 'oeil_de_boeuf' || typeO === 'porte_garage' || typeO === 'porte')) { volets = 'aucun'; note(`${quoi} : pas de volets sur ce type d’ouverture`); }
    // Pas de chevauchement entre ouvertures d'une même façade et d'un même niveau.
    const cle = `${v.id}|${f.index}|${niveau}`;
    const pris = occupes.get(cle) ?? [];
    const centres = centresGroupe(f.longueur, position, nombre, entraxe);
    const intervalles = centres.map((c) => [c - largeur / 2, c + largeur / 2] as [number, number]);
    const conflit = pris.find(([a, b]) => intervalles.some(([x, y]) => Math.min(y, b) - Math.max(x, a) > 0.02));
    const id = ids.lire(ob.id, 'o', quoi, note);
    if (conflit) {
      note(`ouverture « ${id} » chevauchait « ${conflit[2]} » sur la même façade : retirée`);
      return;
    }
    for (const [a, b] of intervalles) pris.push([a, b, id]);
    occupes.set(cle, pris);
    ouvertures.push({
      id, volume: v.id, facade, niveau, type: typeO, largeur, hauteur, allege, position, nombre, entraxe, volets,
      matiere: lireMatiere(ob.matiere, quoi, note, refs),
    });
  });

  // ---- Éléments
  const elements: ElementModele[] = [];
  const elBruts = Array.isArray(brut.elements) ? brut.elements : [];
  if (brut.elements !== undefined && brut.elements !== null && !Array.isArray(brut.elements)) note('éléments illisibles');
  if (elBruts.length > B.elementsMax) note(`${B.elementsMax} éléments au plus : les suivants sont ignorés`);
  let briquesTotal = 0;
  elBruts.slice(0, B.elementsMax).forEach((eb, i) => {
    if (!estObj(eb)) { note(`élément n° ${i + 1} illisible : écarté`); return; }
    const alias: Record<string, TypeElementModele> = { garde_corps_toit: 'garde_corps', marquise: 'auvent', escalier: 'escalier_exterieur', bow: 'bow_window', bowwindow: 'bow_window', colonne: 'colonnes', piliers: 'colonnes', volet: 'volets', jardin_hiver: 'veranda', tour: 'tourelle' };
    const tb = typeof eb.type === 'string' ? (alias[eb.type] ?? eb.type) : eb.type;
    let typeE: TypeElementModele = 'autre';
    let nomE = texteCourt(eb.nom, B.texteMax);
    if (dans(TYPES_ELEMENT_MODELE, tb)) typeE = tb;
    else if (typeof eb.type === 'string') nomE ??= texteCourt(eb.type.replace(/_/g, ' '), B.texteMax); // inconnu : « autre », jamais refusé
    const quoi = `élément « ${nomE ?? (typeof eb.id === 'string' ? eb.id.slice(0, 20) : typeE)} »`;
    let volume: string | null = null;
    if (eb.volume !== undefined && eb.volume !== null) {
      if (volumes.some((v) => v.id === eb.volume)) volume = eb.volume as string;
      else note(`${quoi} : volume inconnu, rattaché au volume principal`);
    }
    const D = ELEMENT_DEFAUT[typeE];
    let facade: RefFacade | null = eb.facade === undefined || eb.facade === null ? null : lireRefFacade(eb.facade);
    if (eb.facade !== undefined && eb.facade !== null && facade === null) note(`${quoi} : façade inconnue`);
    let point: ElementModele['point'] = null;
    if (estObj(eb.point)) point = {
      x: lireNombre(eb.point.x, -B.coordMax, B.coordMax, 0, note, `${quoi} : point x`),
      y: lireNombre(eb.point.y, -B.coordMax, B.coordMax, 0, note, `${quoi} : point y`),
      z: lireNombre(eb.point.z, 0, B.altitudeMax, 0, note, `${quoi} : point z`),
    };
    const briquesBrutes = Array.isArray(eb.briques) ? eb.briques : [];
    if (briquesBrutes.length > B.briquesParElementMax) note(`${quoi} : ${B.briquesParElementMax} briques au plus`);
    const briques: BriqueModele[] = [];
    for (const [k, bb] of briquesBrutes.slice(0, B.briquesParElementMax).entries()) {
      if (briquesTotal >= B.briquesMax) { note(`${B.briquesMax} briques au plus pour tout le bâtiment : les suivantes sont ignorées`); break; }
      const b = lireBrique(bb, `${quoi}, brique ${k + 1}`, note, refs);
      if (b) { briques.push(b); briquesTotal++; } else note(`${quoi} : brique ${k + 1} illisible, ignorée`);
    }
    if (!volume && !point && (D.facade || facade !== null || typeE === 'cheminee' || typeE === 'corniche' || typeE === 'bandeau' || typeE === 'colombages') && !briques.length) volume = principal.id;
    const vol = volume ? volumes.find((v) => v.id === volume)! : null;
    if (vol && D.facade && facade === null && !point && !briques.length) facade = 'avant';
    if (vol && facade !== null && !resoudreFacade(vol, facade)) { note(`${quoi} : façade introuvable, façade avant retenue`); facade = 'avant'; }
    let niveau: number | null = null;
    if (vol) {
      const nDef = D.niveau === null ? null : Math.min(D.niveau, vol.niveaux - (typeE === 'bandeau' ? 1 : 0));
      if (eb.niveau !== undefined && eb.niveau !== null) niveau = lireNombre(eb.niveau, 0, vol.niveaux - (typeE === 'garde_corps' ? 0 : 1), nDef ?? 0, note, `${quoi} : niveau`, Math.round);
      else niveau = nDef !== null && nDef >= 0 ? nDef : null;
      if (typeE === 'balcon' && vol.niveaux === 1) note(`${quoi} : un seul niveau, le balcon est posé au rez-de-chaussée (terrasse surélevée)`);
    }
    const dim = (x: unknown, d: number | null, nom: string, min = 0.05): number | null =>
      x === undefined || x === null ? d : lireNombre(x, min, B.dimMax, d ?? 1, note, `${quoi} : ${nom}`);
    let largeur = dim(eb.largeur ?? eb.diametre, D.largeur, 'largeur');
    const profondeur = dim(eb.profondeur ?? eb.saillie, D.profondeur, 'profondeur', 0.02);
    const hauteur = dim(eb.hauteur, D.hauteur, 'hauteur', 0.05);
    let position: number | null = null;
    if (vol && facade !== null) {
      const f = resoudreFacade(vol, facade)!;
      if (largeur !== null && largeur > f.longueur && D.facade && typeE !== 'pergola' && typeE !== 'veranda') { largeur = r2(f.longueur); note(`${quoi} : plus large que la façade, ramené à ${String(largeur).replace('.', ',')} m`); }
      if (eb.position !== undefined && eb.position !== null) {
        const p = lireNombre(eb.position, -B.dimMax, B.dimMax * 2, f.longueur / 2, note, `${quoi} : position`);
        const demi = typeE === 'tourelle' ? 0 : Math.min((largeur ?? 0) / 2, f.longueur / 2);
        position = r2(Math.max(demi, Math.min(f.longueur - demi, p)));
        if (Math.abs(position - p) > 0.01) note(`${quoi} : dépassait de la façade, recentré`);
      }
    }
    const parametres = lireParametres(eb.parametres, quoi, note);
    if (typeE === 'volets' && !dans(VOLETS_MODELE, parametres.type)) { if (parametres.type !== undefined) note(`${quoi} : type de volets inconnu, battants retenus`); parametres.type = 'battants'; }
    if (typeE === 'autre' && !briques.length) remarquer(`${quoi} n’a ni type connu ni briques : noté, mais pas dessiné`);
    elements.push({
      id: ids.lire(eb.id, 'e', quoi, note), type: typeE, nom: nomE, volume, facade, niveau, position, point,
      largeur, profondeur, hauteur, parametres, briques, matiere: lireMatiere(eb.matiere, quoi, note, refs),
    });
  });

  // Rien ne flotte (briques) : une brique au-dessus du sol touche un volume, ou une brique qui tient (de proche en proche).
  const boitesVol = volumes.map((v) => ({ e: englobantTerrain(contours.get(v.id)!), zMin: v.altitudeBase, zMax: sommetVolume(v) + v.toit.debord }));
  const toutes = elements.flatMap((e) => e.briques.map((b) => ({ e, b })));
  const tient = new Set<BriqueModele>();
  const tol = 0.12;
  const toucheVol = (b: BriqueModele): boolean => {
    const bb = boiteBrique(b);
    return boitesVol.some((bv) => distanceEnglobants(bv.e, bb) <= TOLERANCE_APPUI && bb.minZ <= bv.zMax + tol && bb.maxZ >= bv.zMin - tol);
  };
  for (const { b } of toutes) if (b.z <= 0.05 || toucheVol(b)) tient.add(b);
  let change = true;
  while (change) {
    change = false;
    for (const { b } of toutes) {
      if (tient.has(b)) continue;
      const bb = boiteBrique(b);
      for (const o of tient) {
        const ob = boiteBrique(o);
        if (distanceEnglobants(bb, ob) <= tol && bb.minZ <= ob.maxZ + tol && bb.maxZ >= ob.minZ - tol) { tient.add(b); change = true; break; }
      }
    }
  }
  const elementsFlottants = new Set<ElementModele>();
  for (const { e, b } of toutes) if (!tient.has(b)) { b.z = 0; elementsFlottants.add(e); }
  for (const e of elementsFlottants) note(`élément « ${e.nom ?? e.id} » : des briques flottaient dans le vide, posées au sol`);
  for (const e of elements) for (const b of e.briques) if (b.z !== 0 && b.z <= 0.05) b.z = 0;

  const modele: ModeleBatiment = {
    v: MODELE_VERSION, origine, nom, type, style, styleLibre, matieres, volumes, ouvertures, elements, remarques,
  };
  /* VIS-63 — programme de la fiche : gardé seulement s'il est lisible (absent : modèle EXACTEMENT comme avant). */
  if (brut.programme !== undefined && brut.programme !== null) {
    const programme = lireProgrammeModele(brut.programme);
    if (programme) modele.programme = programme; else note('programme de logements illisible : ignoré');
  }
  if (options.strict && corrections.length) return echec(`Modèle refusé : ${corrections[0]}.`);
  return { ok: true, modele, corrections, avertissements };
}

// ---- Libellés -----------------------------------------------------------------

export const LIBELLES_OUVERTURE: Record<TypeOuverture, string> = {
  fenetre: 'Fenêtre', porte_fenetre: 'Porte-fenêtre', baie: 'Baie vitrée', porte: 'Porte', porte_garage: 'Porte de garage', lucarne: 'Lucarne', oeil_de_boeuf: 'Œil-de-bœuf',
};
export const LIBELLES_TOIT_MODELE: Record<FormeToitModele, string> = {
  plat: 'toit plat', terrasse: 'toit-terrasse', un_pan: 'toit à un pan', deux_pans: 'toit à deux pans', quatre_pans: 'toit à quatre pans',
  mansart: 'toit à la Mansart', conique: 'toit conique', pyramide: 'toit en pyramide',
};
export const LIBELLES_ELEMENT_MODELE: Record<TypeElementModele, string> = {
  balcon: 'balcon', loggia: 'loggia', garde_corps: 'garde-corps', auvent: 'auvent', pergola: 'pergola', veranda: 'véranda', porche: 'porche',
  escalier_exterieur: 'escalier extérieur', cheminee: 'cheminée', volets: 'volets', tourelle: 'tourelle', bow_window: 'bow-window',
  colonnes: 'colonnes', corniche: 'corniche', bandeau: 'bandeau', colombages: 'colombages', autre: 'élément',
};
export const LIBELLES_PLAN: Record<TypePlan, string> = { rectangle: 'rectangulaire', L: 'en L', polygone: 'polygonal', cercle: 'rond', arc: 'en arc' };

const fr = (x: number): string => String(r1(x)).replace('.', ',');
const niveauxTexte = (n: number): string => (n <= 1 ? 'RDC' : `R+${n - 1}`);
function dimsPlan(p: PlanVolume): string {
  switch (p.type) {
    case 'rectangle': case 'L': return `${fr(p.largeur)} × ${fr(p.profondeur)} m`;
    case 'cercle': return `Ø ${fr(p.rayon * 2)} m`;
    case 'arc': return `rayon ${fr(p.rayonExterieur)} m`;
    case 'polygone': return `${p.points.length} côtés, ${fr(airePolygone(p.points))} m²`;
  }
}

/** Résumé lisible (une phrase par volume + compte des ouvertures et éléments), pour la carte du chat et le journal. */
export function resumerModele(m: ModeleBatiment): string {
  const style = m.style === 'autre' ? (m.styleLibre ? ` (${m.styleLibre})` : '') : m.style === 'contemporain' ? ' contemporain' : ` de style ${m.style.replace('_', ' ')}`;
  const dejaDit = !!m.nom && (m.style === 'contemporain' ? /contemporain/i.test(m.nom) : m.nom.toLowerCase().includes((m.styleLibre ?? m.style.replace('_', ' ')).toLowerCase()));
  const tete = `${m.nom ?? (m.type === 'maison' ? 'Maison' : m.type === 'collectif' ? 'Immeuble' : 'Bâtiment')}${dejaDit ? '' : style}`;
  const vols = m.volumes.map((v) => {
    const t = v.toit;
    const toit = toitEnPente(t.forme) ? `${LIBELLES_TOIT_MODELE[t.forme]} ${fr(t.pente)}°` : `${LIBELLES_TOIT_MODELE[t.forme]}${t.vegetalise ? ' végétalisé' : ''}`;
    return `${v.nom ?? v.id} ${LIBELLES_PLAN[v.plan.type]} ${dimsPlan(v.plan)}, ${niveauxTexte(v.niveaux)} (${fr(v.hauteur)} m), ${toit}`;
  });
  const parType = new Map<string, number>();
  for (const o of m.ouvertures) parType.set(LIBELLES_OUVERTURE[o.type].toLowerCase(), (parType.get(LIBELLES_OUVERTURE[o.type].toLowerCase()) ?? 0) + o.nombre);
  const ouv = [...parType].map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`.replace(/(œil-de-bœuf)s/, '$1').replace(/porte-fenêtres/, 'portes-fenêtres').replace(/porte de garages/, 'portes de garage').replace(/baie vitrées/, 'baies vitrées'));
  const els = m.elements.map((e) => (e.type === 'autre' ? e.nom ?? 'élément' : LIBELLES_ELEMENT_MODELE[e.type]) + (e.briques.length ? ` (${e.briques.length} brique${e.briques.length > 1 ? 's' : ''})` : ''));
  return [
    `${tete} : ${m.volumes.length} volume${m.volumes.length > 1 ? 's' : ''} — ${vols.join(' ; ')}.`,
    ouv.length ? `Ouvertures : ${ouv.join(', ')}.` : 'Aucune ouverture.',
    els.length ? `Éléments : ${els.join(', ')}.` : null,
  ].filter(Boolean).join(' ');
}

/** Empreinte stable (FNV-1a 32 bits sur le JSON aux clés triées) : « mb1-xxxxxxxx ». */
export function empreinteModele(m: ModeleBatiment): string {
  const canon = (x: unknown): string => {
    if (Array.isArray(x)) return `[${x.map(canon).join(',')}]`;
    if (estObj(x)) return `{${Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(x[k])}`).join(',')}}`;
    return JSON.stringify(x);
  };
  const s = canon(m);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `mb1-${h.toString(16).padStart(8, '0')}`;
}

// ---- Retouches par différences ------------------------------------------------

export type Retouche =
  /** Ajoute un volume, une ouverture ou un élément (objet au format du contrat ; id facultatif, créé si absent). */
  | { action: 'ajouter'; quoi: 'volume' | 'ouverture' | 'element'; objet: unknown }
  /** Retire l'objet identifié (un volume retire aussi ses ouvertures et ses éléments rattachés). */
  | { action: 'retirer'; id: string }
  /**
   * Déplace l'objet identifié. Volume : dx / dy / dz (m, repère du terrain) ou `vers` {x, y} ; ses éléments à briques
   * suivent. Ouverture / élément de façade : `decalage` (m le long de la façade, + = vers la droite vue de l'extérieur),
   * ou `position`, `facade`, `niveau`, `volume`. Élément libre : dx / dy / dz déplacent son point et ses briques.
   */
  | { action: 'deplacer'; id: string; dx?: number; dy?: number; dz?: number; vers?: { x?: number; y?: number }; decalage?: number; position?: number; facade?: RefFacade; niveau?: number; volume?: string }
  /** Modifie des champs de l'objet identifié (fusion profonde ; les listes sont remplacées). */
  | { action: 'modifier'; id: string; champs: Record<string, unknown> }
  /** Modifie le bâtiment lui-même (nom, type, style, styleLibre, matieres, remarques). */
  | { action: 'modifier_modele'; champs: Record<string, unknown> };

export type ResultatRetouche =
  | { ok: true; modele: ModeleBatiment; /** Ce qui a été fait, en clair. */ fait: string[]; corrections: string[]; avertissements: string[] }
  | { ok: false; erreur: string; modele: ModeleBatiment };

function fusion(a: unknown, b: unknown): unknown {
  if (estObj(a) && estObj(b)) { const out: Obj = { ...a }; for (const [k, v] of Object.entries(b)) out[k] = fusion(a[k], v); return out; }
  return b === undefined ? a : b;
}
const copie = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Applique UNE retouche puis revalide tout le modèle. Jamais d'exception ; échec : modèle d'origine rendu tel quel. */
export function appliquerRetouche(modele: ModeleBatiment, retouche: unknown, options: OptionsValidation = {}): ResultatRetouche {
  return appliquerRetouches(modele, [retouche], options);
}

/** Applique une suite de retouches (dans l'ordre), puis revalide. Une retouche impossible fait tout échouer. */
export function appliquerRetouches(modele: ModeleBatiment, retouches: readonly unknown[], options: OptionsValidation = {}): ResultatRetouche {
  const m = copie(modele) as unknown as Obj & { volumes: Obj[]; ouvertures: Obj[]; elements: Obj[] };
  const fait: string[] = [];
  const refuser = (erreur: string): ResultatRetouche => ({ ok: false, erreur, modele });
  const trouver = (id: unknown): { liste: Obj[]; i: number; quoi: 'volume' | 'ouverture' | 'element' } | null => {
    if (typeof id !== 'string') return null;
    for (const quoi of ['volume', 'ouverture', 'element'] as const) {
      const liste = quoi === 'volume' ? m.volumes : quoi === 'ouverture' ? m.ouvertures : m.elements;
      const i = liste.findIndex((x) => x.id === id);
      if (i >= 0) return { liste, i, quoi };
    }
    return null;
  };
  const nomDe = (o: Obj): string => `« ${typeof o.nom === 'string' && o.nom ? o.nom : String(o.id)} »`;
  const tousIds = (): Set<string> => new Set([...m.volumes, ...m.ouvertures, ...m.elements].map((x) => String(x.id)));
  const idNeuf = (prefixe: string): string => { const pris = tousIds(); let k = 1; while (pris.has(`${prefixe}${k}`)) k++; return `${prefixe}${k}`; };
  try {
    for (const r of retouches) {
      if (!estObj(r)) return refuser('Retouche illisible.');
      switch (r.action) {
        case 'ajouter': {
          if (!dans(['volume', 'ouverture', 'element'] as const, r.quoi) || !estObj(r.objet)) return refuser('Ajout illisible : quoi (volume, ouverture, element) et objet attendus.');
          const o = copie(r.objet);
          const prefixe = r.quoi === 'volume' ? 'v' : r.quoi === 'ouverture' ? 'o' : 'e';
          if (typeof o.id !== 'string' || tousIds().has(o.id) || !RE_ID.test(o.id)) o.id = idNeuf(prefixe);
          (r.quoi === 'volume' ? m.volumes : r.quoi === 'ouverture' ? m.ouvertures : m.elements).push(o);
          fait.push(`ajouté : ${r.quoi === 'ouverture' ? (dans(TYPES_OUVERTURE, o.type) ? LIBELLES_OUVERTURE[o.type].toLowerCase() : 'ouverture') : r.quoi === 'element' ? (dans(TYPES_ELEMENT_MODELE, o.type) && o.type !== 'autre' ? LIBELLES_ELEMENT_MODELE[o.type] : String(o.nom ?? o.type ?? 'élément')) : `volume ${nomDe(o)}`} (${o.id})`);
          break;
        }
        case 'retirer': {
          const t = trouver(r.id); if (!t) return refuser(`Rien ne porte l’identifiant « ${String(r.id).slice(0, 30)} ».`);
          const o = t.liste[t.i]!;
          if (t.quoi === 'volume') {
            if (m.volumes.length <= 1) return refuser('Impossible de retirer le dernier volume.');
            const avant = m.ouvertures.length + m.elements.length;
            m.ouvertures = m.ouvertures.filter((x) => x.volume !== o.id);
            m.elements = m.elements.filter((x) => x.volume !== o.id);
            const enleves = avant - m.ouvertures.length - m.elements.length;
            t.liste.splice(t.i, 1);
            fait.push(`retiré : volume ${nomDe(o)}${enleves ? ` et ses ${enleves} ouverture(s) / élément(s)` : ''}`);
          } else { t.liste.splice(t.i, 1); fait.push(`retiré : ${nomDe(o)}`); }
          break;
        }
        case 'deplacer': {
          const t = trouver(r.id); if (!t) return refuser(`Rien ne porte l’identifiant « ${String(r.id).slice(0, 30)} ».`);
          const o = t.liste[t.i]!;
          const dx = nombreFini(r.dx) ? r.dx : 0; const dy = nombreFini(r.dy) ? r.dy : 0; const dz = nombreFini(r.dz) ? r.dz : 0;
          if (t.quoi === 'volume') {
            const p = estObj(o.position) ? o.position : { x: 0, y: 0 };
            const px = nombreFini(p.x) ? p.x : 0; const py = nombreFini(p.y) ? p.y : 0;
            const vers = estObj(r.vers) ? r.vers : {};
            const nx = nombreFini(vers.x) ? vers.x : px + dx; const ny = nombreFini(vers.y) ? vers.y : py + dy;
            const ddx = nx - px; const ddy = ny - py;
            o.position = { x: r2(nx), y: r2(ny) };
            if (dz) o.altitudeBase = r2(Math.max(0, (nombreFini(o.altitudeBase) ? o.altitudeBase : 0) + dz));
            for (const e of m.elements) if (e.volume === o.id) {
              if (Array.isArray(e.briques)) for (const b of e.briques) if (estObj(b)) { b.x = r2((nombreFini(b.x) ? b.x : 0) + ddx); b.y = r2((nombreFini(b.y) ? b.y : 0) + ddy); if (dz) b.z = r2(Math.max(0, (nombreFini(b.z) ? b.z : 0) + dz)); }
              if (estObj(e.point)) { e.point = { ...e.point, x: r2((nombreFini(e.point.x) ? e.point.x : 0) + ddx), y: r2((nombreFini(e.point.y) ? e.point.y : 0) + ddy) }; }
            }
            fait.push(`déplacé : volume ${nomDe(o)} de ${fr(ddx)} m en x et ${fr(ddy)} m en y`);
          } else {
            if (typeof r.volume === 'string') o.volume = r.volume;
            if (r.facade !== undefined) o.facade = r.facade;
            if (nombreFini(r.niveau)) o.niveau = r.niveau;
            if (nombreFini(r.position)) o.position = r.position;
            if (nombreFini(r.decalage)) {
              // Position actuelle (centrée si null) + décalage.
              const v = (m.volumes as unknown as VolumeModele[]).find((x) => x.id === o.volume);
              const ref = lireRefFacade(o.facade);
              const f = v && ref !== null ? resoudreFacade(v, ref) : null;
              const base = nombreFini(o.position) ? o.position : f ? f.longueur / 2 : 0;
              o.position = r2(base + r.decalage);
            }
            if (t.quoi === 'element' && (dx || dy || dz)) {
              if (estObj(o.point)) o.point = { ...o.point, x: r2((nombreFini(o.point.x) ? o.point.x : 0) + dx), y: r2((nombreFini(o.point.y) ? o.point.y : 0) + dy), z: r2(Math.max(0, (nombreFini(o.point.z) ? o.point.z : 0) + dz)) };
              if (Array.isArray(o.briques)) for (const b of o.briques) if (estObj(b)) { b.x = r2((nombreFini(b.x) ? b.x : 0) + dx); b.y = r2((nombreFini(b.y) ? b.y : 0) + dy); b.z = r2(Math.max(0, (nombreFini(b.z) ? b.z : 0) + dz)); }
            }
            fait.push(`déplacé : ${nomDe(o)}`);
          }
          break;
        }
        case 'modifier': {
          const t = trouver(r.id); if (!t) return refuser(`Rien ne porte l’identifiant « ${String(r.id).slice(0, 30)} ».`);
          if (!estObj(r.champs)) return refuser('Modification illisible : champs attendus.');
          const champs = { ...r.champs }; delete champs.id;
          const avant = t.liste[t.i]!;
          // Hauteur donnée seule pour un volume : elle prime (niveaux / étage recalculés).
          if (t.quoi === 'volume' && champs.hauteur !== undefined && champs.niveaux === undefined && champs.hauteurEtage === undefined) { delete avant.hauteurEtage; }
          if (t.quoi === 'volume' && (champs.niveaux !== undefined || champs.hauteurEtage !== undefined) && champs.hauteur === undefined) delete avant.hauteur;
          // Changement de forme du plan ou du toit : on repart des champs donnés (pas de mélange d'anciens paramètres).
          if (estObj(champs.plan) && estObj(avant.plan) && champs.plan.type !== undefined && champs.plan.type !== avant.plan.type) avant.plan = {};
          if (estObj(champs.toit) && estObj(avant.toit) && champs.toit.forme !== undefined && champs.toit.forme !== avant.toit.forme && champs.toit.pente === undefined) delete avant.toit.pente;
          t.liste[t.i] = fusion(avant, champs) as Obj;
          fait.push(`modifié : ${nomDe(t.liste[t.i]!)} (${Object.keys(champs).join(', ')})`);
          break;
        }
        case 'modifier_modele': {
          if (!estObj(r.champs)) return refuser('Modification illisible : champs attendus.');
          const permis = ['nom', 'type', 'style', 'styleLibre', 'matieres', 'remarques', 'origine'];
          for (const [k, x] of Object.entries(r.champs)) if (permis.includes(k)) m[k] = fusion(m[k], x);
          fait.push(`modifié : le bâtiment (${Object.keys(r.champs).filter((k) => permis.includes(k)).join(', ')})`);
          break;
        }
        default: return refuser('Retouche inconnue : ajouter, retirer, deplacer, modifier ou modifier_modele.');
      }
    }
  } catch {
    return refuser('Retouche illisible.');
  }
  const v = validerModele(m, { refsConnues: options.refsConnues });
  if (!v.ok) return refuser(v.erreur);
  return { ok: true, modele: v.modele, fait, corrections: v.corrections, avertissements: v.avertissements };
}

// ---- Compatibilité VIS-22 (DescriptionBatiment v1) ------------------------------

/** Matières du chat VIS-22 → références du catalogue extérieur VIS-24 (vérifiées par le test front). */
export const REF_FACADE_DESCRIPTION: Record<FacadeBatiment, { refStudio: string | null; famille: FamilleMatiere; claire?: string; foncee?: string }> = {
  enduit_clair: { refStudio: 'av-enduit-beige', famille: 'enduit' },
  enduit_blanc: { refStudio: 'av-enduit-blanc', famille: 'enduit' },
  brique: { refStudio: 'av-brique-rouge', famille: 'brique', claire: 'av-brique-claire' },
  pierre: { refStudio: 'av-pierre-calcaire', famille: 'pierre' },
  beton: { refStudio: 'av-beton-brut', famille: 'beton', claire: 'av-beton-clair' },
  bardage_bois: { refStudio: 'av-bardage-bois-brun', famille: 'bois', foncee: 'av-bardage-bois-noirci' },
  verre: { refStudio: null, famille: 'verre' },
};
const COULEURS_BOIS_HEX: Record<CouleurBois, string> = {
  rouge: '#8b1e1e', vert: '#2f5d34', brun: '#5a3a22', bleu: '#2c4a7a', blanc: '#f2f2ee', gris: '#7d7f80', noir: '#1e1e1e', naturel: '#a07850',
};
const MENUISERIES_HEX: Record<MenuiseriesBatiment, string> = { gris: '#8a8d90', anthracite: '#383e42', blanc: '#f4f4f2', bronze: '#5b4a3a' };

function plusProche<T extends string>(hex: string, table: Record<T, string>): T {
  const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = rgb(hex);
  let best: T | null = null; let d = Infinity;
  for (const [k, h] of Object.entries(table) as [T, string][]) { const b = rgb(h); const x = (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2; if (x < d) { d = x; best = k; } }
  return best!;
}

/** Volume principal (rôle « principal », sinon le plus grand). */
export function volumePrincipal(m: ModeleBatiment): VolumeModele {
  return m.volumes.find((v) => v.role === 'principal') ?? m.volumes.reduce((a, b) => (aireVolume(b) > aireVolume(a) ? b : a), m.volumes[0]!);
}
const matiereDe = (m: ModeleBatiment, v: VolumeModele | null, partie: PartieMatiere): Matiere | null => (v?.matieres[partie] ?? m.matieres[partie] ?? null);

/** Façade du chat VIS-22 la plus proche d'une matière libre. */
function facadeDescription(mat: Matiere | null): { materiau: FacadeBatiment; teinte: 'naturelle' | 'claire' | 'foncee'; couleur: string | null } {
  if (!mat) return { materiau: 'enduit_clair', teinte: 'naturelle', couleur: null };
  for (const [k, x] of Object.entries(REF_FACADE_DESCRIPTION) as [FacadeBatiment, typeof REF_FACADE_DESCRIPTION[FacadeBatiment]][]) {
    if (mat.refStudio && mat.refStudio === x.refStudio) return { materiau: k, teinte: 'naturelle', couleur: mat.couleur };
    if (mat.refStudio && mat.refStudio === x.claire) return { materiau: k, teinte: 'claire', couleur: mat.couleur };
    if (mat.refStudio && mat.refStudio === x.foncee) return { materiau: k, teinte: 'foncee', couleur: mat.couleur };
  }
  const fam = mat.famille ?? (mat.refStudio ? familleDeRef(mat.refStudio) : null);
  const blanc = mat.couleur ? parseInt(mat.couleur.slice(1, 3), 16) > 225 && parseInt(mat.couleur.slice(3, 5), 16) > 225 && parseInt(mat.couleur.slice(5, 7), 16) > 220 : false;
  const materiau: FacadeBatiment = fam === 'brique' ? 'brique' : fam === 'pierre' ? 'pierre' : fam === 'beton' ? 'beton' : fam === 'bois' ? 'bardage_bois' : fam === 'verre' ? 'verre' : blanc ? 'enduit_blanc' : 'enduit_clair';
  return { materiau, teinte: 'naturelle', couleur: mat.couleur };
}

/** Forme VIS-22 du volume principal (et des ailes accolées). */
function formeDescription(m: ModeleBatiment): FormeBatiment | null {
  const p = volumePrincipal(m);
  if (p.plan.type === 'L') return 'l';
  if (p.plan.type === 'rectangle') {
    const ailes = m.volumes.filter((v) => v !== p && v.role === 'aile' && v.altitudeBase === 0);
    if (ailes.length === 1) return 'l';
    if (ailes.length === 2) return 'u';
    const r = Math.max(p.plan.largeur, p.plan.profondeur) / Math.min(p.plan.largeur, p.plan.profondeur);
    return r >= 2.2 ? 'barre' : 'plot';
  }
  if (p.plan.type === 'polygone') {
    // U : 8 sommets, deux concaves ; L : 6 sommets, un concave.
    const pts = p.plan.points; let concaves = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]!; const b = pts[i]!; const c = pts[(i + 1) % pts.length]!;
      if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -EPS) concaves++;
    }
    if (pts.length === 6 && concaves === 1) return 'l';
    if (pts.length === 8 && concaves === 2) return 'u';
    if (concaves >= 3) return 'redans';
  }
  return null;
}

const TOIT_VERS_DESCRIPTION: Record<FormeToitModele, FormeToit> = {
  plat: 'terrasse', terrasse: 'terrasse', un_pan: 'monopente', deux_pans: 'deux_pans', quatre_pans: 'quatre_pans', mansart: 'mansarde', conique: 'quatre_pans', pyramide: 'quatre_pans',
};
const ELEMENT_VERS_DESCRIPTION: Partial<Record<TypeElementModele, TypeElement>> = {
  colombages: 'colombages', cheminee: 'cheminee', veranda: 'veranda', pergola: 'pergola', auvent: 'auvent', porche: 'porche',
  bow_window: 'bow_window', tourelle: 'tourelle', escalier_exterieur: 'escalier_exterieur',
};

/** Côté (vu de la rue) d'un volume par rapport au volume principal. */
function coteRelatif(p: VolumeModele, v: VolumeModele): Cote {
  const a = englobantTerrain(contourVolume(p)); const b = englobantTerrain(contourVolume(v));
  const cx = (b.minX + b.maxX) / 2 - (a.minX + a.maxX) / 2; const cy = (b.minY + b.maxY) / 2 - (a.minY + a.maxY) / 2;
  if (Math.abs(cx) >= Math.abs(cy)) return cx < 0 ? 'gauche' : 'droite';
  return cy < 0 ? 'avant' : 'arriere';
}

/**
 * Modèle → description VIS-22 la plus proche (le passé continue de marcher : carte, brief d'habillage, clauses du
 * Studio). Approximation honnête : ce que la description ne sait pas dire part en éléments « autre » ou en remarques.
 * Le résultat est REVALIDÉ par `validerDescription` (non strict) : toujours une description valide.
 */
export function versDescriptionBatiment(m: ModeleBatiment): DescriptionBatiment {
  const p = volumePrincipal(m);
  const murs = matiereDe(m, p, 'murs');
  const fac = facadeDescription(murs);
  const toitMat = p.toit.matiere ?? matiereDe(m, p, 'toiture');
  const famToit = toitMat?.famille ?? (toitMat?.refStudio ? familleDeRef(toitMat.refStudio) : null);
  const couverture = famToit === 'ardoise' ? 'ardoise' : famToit === 'zinc' || famToit === 'metal' ? 'zinc' : 'tuiles';
  const formeToit: FormeToit = p.toit.vegetalise ? 'vegetalisee' : TOIT_VERS_DESCRIPTION[p.toit.forme];
  const posees = m.ouvertures;
  const nb = (t: TypeOuverture): number => posees.filter((o) => o.type === t).reduce((s, o) => s + o.nombre, 0);
  const typeOuv = nb('baie') > nb('fenetre') ? 'baies_vitrees' : 'fenetres_verticales';
  const elVolets = m.elements.find((e) => e.type === 'volets');
  const voletsOuv = posees.find((o) => o.volets !== 'aucun')?.volets ?? null;
  const volets: Volets = (elVolets ? String(elVolets.parametres.type ?? 'battants') : voletsOuv ?? 'aucun') as Volets;
  const matVolets = elVolets?.matiere ?? matiereDe(m, null, 'volets');
  const couleurVolets = volets !== 'aucun' && matVolets?.couleur ? plusProche(matVolets.couleur, COULEURS_BOIS_HEX) : null;
  const matMen = matiereDe(m, null, 'menuiseries');
  const menuiseries: MenuiseriesBatiment = matMen?.couleur ? plusProche(matMen.couleur, MENUISERIES_HEX) : 'gris';
  const balcon = m.elements.find((e) => e.type === 'balcon'); const loggia = m.elements.find((e) => e.type === 'loggia');
  const gc = String((balcon ?? loggia)?.parametres.gardeCorps ?? 'metal');
  const elements: { type: TypeElement; couleur: CouleurBois | null; cote: Cote | null; precision: string | null }[] = [];
  const colomb = m.elements.find((e) => e.type === 'colombages');
  for (const e of m.elements) {
    const t = ELEMENT_VERS_DESCRIPTION[e.type];
    const mat = e.matiere ?? (e.type === 'colombages' ? matiereDe(m, null, 'boiseries') : null);
    if (t) elements.push({ type: t, couleur: mat?.couleur ? plusProche(mat.couleur, COULEURS_BOIS_HEX) : null, cote: null, precision: e === colomb ? null : e.nom });
    else if (e.type === 'autre' || e.type === 'colonnes' || e.type === 'corniche' || e.type === 'bandeau') elements.push({ type: 'autre', couleur: null, cote: null, precision: e.nom ?? LIBELLES_ELEMENT_MODELE[e.type] });
  }
  if (posees.some((o) => o.type === 'lucarne')) elements.push({ type: 'lucarnes', couleur: null, cote: null, precision: null });
  for (const v of m.volumes) if (v.role === 'garage') elements.push({ type: 'garage_accole', couleur: null, cote: coteRelatif(p, v), precision: null });
  for (const v of m.volumes) if (v.role === 'tourelle' && !elements.some((e) => e.type === 'tourelle')) elements.push({ type: 'tourelle', couleur: null, cote: coteRelatif(p, v), precision: null });
  const brut = {
    v: DESCRIPTION_VERSION, origine: m.origine === 'photo' ? 'photo' : 'texte', type: m.type, forme: formeDescription(m),
    niveaux: Math.max(...m.volumes.filter((v) => v.role === 'principal' || v.role === 'aile').map((v) => v.niveaux), p.niveaux),
    style: m.style,
    toiture: { forme: formeToit, couverture: toitEnPente(p.toit.forme) ? couverture : null },
    facade: { ...fac, couleur: fac.couleur },
    ouvertures: { type: typeOuv, menuiseries, volets, couleurVolets },
    balcons: { type: loggia ? 'loggias' : balcon ? ((balcon.largeur ?? 0) >= 0.8 * (resoudreFacade(p, balcon.facade ?? 'avant')?.longueur ?? Infinity) ? 'balcons_filants' : 'balcons') : 'aucun', gardeCorps: ['metal', 'verre', 'plein'].includes(gc) ? gc : 'metal' },
    attique: m.volumes.some((v) => v.role === 'attique') && !toitEnPente(p.toit.forme),
    rdc: 'logements',
    soubassement: p.soubassement > 0 ? (matiereDe(m, p, 'soubassement')?.famille === 'brique' ? 'brique' : matiereDe(m, p, 'soubassement')?.famille === 'beton' ? 'beton' : 'pierre') : 'aucun',
    elements: elements.slice(0, 8),
    remarques: [m.styleLibre ? `style ${m.styleLibre}` : null, m.remarques].filter(Boolean).join(' ; ') || null,
    incertains: [],
  };
  const v = validerDescription(brut, false);
  if (v.ok) return v.valeur;
  // Ne doit pas arriver (non strict) : description minimale.
  const d = validerDescription({ origine: 'texte', type: m.type }, false);
  return (d as { ok: true; valeur: DescriptionBatiment }).valeur;
}

export interface OptionsDepuisDescription {
  /** Emprise disponible (m) : le volume principal y est contenu. */
  largeur?: number;
  profondeur?: number;
}

/**
 * Description VIS-22 → modèle composé (même bâtiment, dit en briques) : volume principal selon la forme, niveaux,
 * toit, matières du catalogue, fenêtres réparties sur chaque façade, porte d'entrée, garage, balcons, attique,
 * lucarnes, cheminée, volets, véranda, pergola… Le résultat passe par `validerModele`.
 */
export function depuisDescriptionBatiment(d: DescriptionBatiment, options: OptionsDepuisDescription = {}): ModeleBatiment {
  const maison = d.type === 'maison';
  const niveaux = d.niveaux ?? (maison ? 2 : 4);
  const he = maison ? 2.7 : 2.9;
  const L0 = options.largeur ?? (d.forme === 'barre' ? 30 : maison ? 12 : 22);
  const P0 = options.profondeur ?? (d.forme === 'barre' ? 12 : maison ? 9 : 16);
  const ref = REF_FACADE_DESCRIPTION[d.facade.materiau];
  const refMur = d.facade.teinte === 'claire' && ref.claire ? ref.claire : d.facade.teinte === 'foncee' && ref.foncee ? ref.foncee : ref.refStudio;
  const matieres: MatieresParPartie = {
    murs: { refStudio: refMur, couleur: d.facade.couleur, famille: ref.famille },
    menuiseries: { refStudio: null, couleur: MENUISERIES_HEX[d.ouvertures.menuiseries], famille: d.ouvertures.menuiseries === 'blanc' ? 'bois' : 'metal' },
  };
  if (d.ouvertures.volets !== 'aucun') matieres.volets = { refStudio: null, couleur: COULEURS_BOIS_HEX[d.ouvertures.couleurVolets ?? 'blanc'], famille: 'bois' };
  const colomb = d.elements.find((e) => e.type === 'colombages');
  if (colomb) matieres.boiseries = { refStudio: null, couleur: COULEURS_BOIS_HEX[colomb.couleur ?? 'brun'], famille: 'bois' };
  if (d.soubassement !== 'aucun') matieres.soubassement = { refStudio: d.soubassement === 'pierre' ? 'av-pierre-calcaire' : d.soubassement === 'brique' ? 'av-brique-rouge' : 'av-beton-brut', couleur: null, famille: d.soubassement };
  const formeToitD = d.toiture.forme;
  const pente = toitEnPenteBatiment22(formeToitD);
  const toitFormeM: FormeToitModele = formeToitD === 'monopente' ? 'un_pan' : formeToitD === 'mansarde' ? 'mansart' : formeToitD === 'vegetalisee' ? 'terrasse' : formeToitD;
  const toit = {
    forme: toitFormeM, vegetalise: formeToitD === 'vegetalisee', faitage: 'largeur',
    matiere: pente ? { refStudio: null, couleur: d.toiture.couverture === 'ardoise' ? '#3c4148' : d.toiture.couverture === 'zinc' ? '#8e9499' : '#a4532e', famille: d.toiture.couverture === 'ardoise' ? 'ardoise' : d.toiture.couverture === 'zinc' ? 'zinc' : 'tuile' } : null,
  };
  let plan: Obj;
  switch (d.forme) {
    case 'l': plan = { type: 'L', largeur: L0, profondeur: P0 + 4, epaisseurX: Math.min(9, L0 / 2), epaisseurY: Math.min(9, P0) , coinVide: 'arriere_droit' }; break;
    case 'u': { const a = L0 / 2; const b = (P0 + 6) / 2; const e = Math.min(8, L0 / 3);
      plan = { type: 'polygone', points: [[-a, -b], [a, -b], [a, b], [a - e, b], [a - e, -b + e], [-a + e, -b + e], [-a + e, b], [-a, b]] }; break; }
    case 'cour': { // Cour fermée : approchée par un U (le contour à trou n'existe pas en v1 ; une cour = 4 volumes).
      const a = L0 / 2; const b = (P0 + 6) / 2; const e = Math.min(8, L0 / 3);
      plan = { type: 'polygone', points: [[-a, -b], [a, -b], [a, b], [a - e, b], [a - e, -b + e], [-a + e, -b + e], [-a + e, b], [-a, b]] }; break; }
    case 'redans': { const a = L0 / 2; const b = P0 / 2; const s = 2.5;
      plan = { type: 'polygone', points: [[-a, -b], [-a / 3, -b], [-a / 3, -b + s], [a / 3, -b + s], [a / 3, -b], [a, -b], [a, b], [-a, b]] }; break; }
    default: plan = { type: 'rectangle', largeur: L0, profondeur: P0 };
  }
  const volumes: Obj[] = [{ id: 'principal', nom: 'Corps principal', role: 'principal', plan, position: { x: 0, y: 0 }, niveaux, hauteurEtage: he, toit, soubassement: d.soubassement !== 'aucun' ? 0.6 : 0 }];
  const ouvertures: Obj[] = [];
  const elements: Obj[] = [];
  const typeFen = d.ouvertures.type === 'baies_vitrees' ? 'baie' : 'fenetre';
  const fenLargeur = d.ouvertures.type === 'fenetres_horizontales' ? 2.4 : typeFen === 'baie' ? 2.4 : 1.0;
  const fenHauteur = d.ouvertures.type === 'fenetres_horizontales' ? 1.0 : typeFen === 'baie' ? 2.2 : 1.35;
  const volets = d.ouvertures.volets;
  const garage = d.elements.find((e) => e.type === 'garage_accole');
  const facadesFen: CoteFacade[] = d.forme === 'l' || d.forme === 'u' || d.forme === 'cour' || d.forme === 'redans' ? ['avant', 'arriere'] : ['avant', 'arriere', 'gauche', 'droite'];
  const volTemp = { plan: plan as unknown as PlanVolume, position: { x: 0, y: 0 }, rotation: 0 };
  for (const c of facadesFen) {
    const f = resoudreFacade(volTemp, c); if (!f) continue;
    const pas = typeFen === 'baie' ? 4.2 : 3.2;
    const n = Math.max(1, Math.floor((f.longueur - 1) / pas));
    if (garage && garage.cote === c) continue;
    for (let niv = 0; niv < niveaux; niv++) {
      if (c === 'avant' && niv === 0) {
        ouvertures.push({ id: 'porte_entree', volume: 'principal', facade: 'avant', niveau: 0, type: 'porte', position: f.longueur / 2 });
        if (n >= 2) {
          const k = Math.floor(n / 2);
          ouvertures.push({ id: `${c}-${niv}-g`, volume: 'principal', facade: c, niveau: niv, type: typeFen, largeur: fenLargeur, hauteur: fenHauteur, nombre: k, entraxe: pas, position: f.longueur / 4, volets });
          ouvertures.push({ id: `${c}-${niv}-d`, volume: 'principal', facade: c, niveau: niv, type: typeFen, largeur: fenLargeur, hauteur: fenHauteur, nombre: n - k, entraxe: pas, position: (3 * f.longueur) / 4, volets });
        }
        continue;
      }
      ouvertures.push({ id: `${c}-${niv}`, volume: 'principal', facade: c, niveau: niv, type: typeFen, largeur: fenLargeur, hauteur: fenHauteur, nombre: n, entraxe: n > 1 ? pas : null, volets });
    }
  }
  if (garage) {
    const e = englobantLocal(plan as unknown as PlanVolume);
    const cote = garage.cote ?? 'gauche';
    const pos = cote === 'gauche' ? { x: e.minX - 3, y: e.minY + 3 } : cote === 'droite' ? { x: e.maxX + 3, y: e.minY + 3 } : cote === 'arriere' ? { x: 0, y: e.maxY + 3 } : { x: 0, y: e.minY - 3 };
    volumes.push({ id: 'garage', nom: 'Garage', role: 'garage', plan: { type: 'rectangle', largeur: 6, profondeur: 6 }, position: pos, niveaux: 1, hauteurEtage: 2.8,
      toit: pente ? { forme: 'un_pan', pente: 15, basVers: cote === 'gauche' || cote === 'droite' ? cote : 'avant', matiere: toit.matiere } : { forme: 'plat' } });
    ouvertures.push({ id: 'porte_garage', volume: 'garage', facade: cote === 'avant' ? 'gauche' : 'avant', niveau: 0, type: 'porte_garage' });
  }
  if (d.attique && !pente) {
    const e = englobantLocal(plan as unknown as PlanVolume);
    volumes.push({ id: 'attique', nom: 'Attique', role: 'attique', plan: { type: 'rectangle', largeur: r2((e.maxX - e.minX) * 0.7), profondeur: r2((e.maxY - e.minY) * 0.6) }, position: { x: 0, y: r2((e.minY + e.maxY) / 2 + 1) }, altitudeBase: niveaux * he, niveaux: 1, hauteurEtage: he, toit: { forme: 'terrasse' } });
  }
  if (d.balcons.type !== 'aucun' && niveaux > 1) {
    const f = resoudreFacade(volTemp, 'avant')!;
    for (let niv = 1; niv < niveaux; niv++) {
      if (d.balcons.type === 'loggias') elements.push({ id: `loggia-${niv}`, type: 'loggia', volume: 'principal', facade: 'avant', niveau: niv, largeur: Math.min(4, f.longueur / 3), parametres: { gardeCorps: d.balcons.gardeCorps } });
      else elements.push({ id: `balcon-${niv}`, type: 'balcon', volume: 'principal', facade: 'avant', niveau: niv, largeur: d.balcons.type === 'balcons_filants' ? r2(f.longueur) : Math.min(3.5, f.longueur / 3), parametres: { gardeCorps: d.balcons.gardeCorps } });
    }
  }
  for (const e of d.elements) {
    switch (e.type) {
      case 'lucarnes': if (pente && formeToitD !== 'monopente') ouvertures.push({ id: 'lucarnes', volume: 'principal', facade: 'avant', type: 'lucarne', nombre: 2, entraxe: 4 }); break;
      case 'cheminee': elements.push({ id: 'cheminee', type: 'cheminee', volume: 'principal' }); break;
      case 'colombages': elements.push({ id: 'colombages', type: 'colombages', volume: 'principal', matiere: matieres.boiseries ?? null }); break;
      case 'veranda': case 'pergola': case 'auvent': case 'porche': case 'bow_window': case 'tourelle': case 'escalier_exterieur':
        elements.push({ id: e.type, type: e.type, volume: 'principal', facade: e.cote === 'arriere' ? 'arriere' : e.cote ?? (e.type === 'veranda' || e.type === 'pergola' ? 'arriere' : 'avant'), nom: e.precision, ...(e.type === 'tourelle' ? { position: 0 } : {}) });
        break;
      case 'autre': elements.push({ type: 'autre', nom: e.precision }); break;
      default: break;
    }
  }
  if (volets !== 'aucun') elements.push({ id: 'volets', type: 'volets', volume: 'principal', parametres: { type: volets }, matiere: matieres.volets ?? null });
  const v = validerModele({
    v: MODELE_VERSION, origine: 'description', nom: null, type: d.type, style: d.style, matieres, volumes, ouvertures, elements,
    remarques: d.remarques,
  });
  if (v.ok) return v.modele;
  // Ne doit pas arriver : un volume au moins est toujours fourni.
  return (validerModele({ volumes: [{ plan: { type: 'rectangle', largeur: 10, profondeur: 8 } }] }) as { ok: true; modele: ModeleBatiment }).modele;
}
const toitEnPenteBatiment22 = (f: FormeToit): boolean => f === 'deux_pans' || f === 'quatre_pans' || f === 'monopente' || f === 'mansarde';

// ---- Bloc du message ----------------------------------------------------------

const RE_BLOC_MODELE = new RegExp('```' + MODELE_BLOC_LANGUE + '[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n?```');

/** Bloc ```mimmoza-modele``` d'un texte → modèle validé en mode STRICT. null : pas de bloc. */
export function modeleDuMessage(texte: unknown, options: Omit<OptionsValidation, 'strict'> = {}): ValidationModele | null {
  if (typeof texte !== 'string') return null;
  const m = RE_BLOC_MODELE.exec(texte);
  if (!m) return null;
  let brut: unknown;
  try { brut = JSON.parse(m[1] ?? ''); } catch { return { ok: false, erreur: 'Bloc de modèle illisible (JSON invalide).', corrections: [], avertissements: [] }; }
  return validerModele(brut, { ...options, strict: true });
}
/** Bloc ```mimmoza-modele``` prêt à joindre à un message. */
export function blocModele(m: ModeleBatiment): string {
  return `\`\`\`${MODELE_BLOC_LANGUE}\n${JSON.stringify(m)}\n\`\`\``;
}
/** Texte sans le bloc de modèle. */
export function sansBlocModele(texte: string): { visible: string; modele: boolean } {
  const m = RE_BLOC_MODELE.exec(texte);
  if (!m) return { visible: texte, modele: false };
  return { visible: (texte.slice(0, m.index) + texte.slice(m.index + m[0].length)).replace(/\n{3,}/g, '\n\n').trim(), modele: true };
}
