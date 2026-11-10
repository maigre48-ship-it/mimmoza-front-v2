/**
 * @mimmoza/interior-core — CONTRAT DE DONNÉES COMMUN (v0.2)
 *
 * Règles non négociables :
 * - TypeScript pur : aucune dépendance à Blender, Unreal, GPU, réseau, ni au LLM.
 * - Unités : mètres, degrés. Repère plan 2D : x vers la droite, y vers le haut (vue de dessus).
 * - Polygones de pièces : sens anti-horaire, sans répétition du premier point.
 * - Rien n'est inventé : une donnée absente va dans `missing`, une supposition dans `assumptions`.
 * - Tout calcul est déterministe (même entrée + même graine => même sortie).
 */

export type Vec2 = [number, number];

// ───────────────────────────── Rôles et fonctions ─────────────────────────────

export const ROOM_ROLES = [
  'entree', 'sejour', 'cuisine', 'sejour_cuisine', 'chambre', 'chambre_parentale',
  'salle_de_bain', 'salle_d_eau', 'wc', 'degagement', 'cellier', 'bureau',
  'dressing', 'buanderie', 'exterieur',
] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];

/** Fonctions d'usage qu'un meuble fournit et qu'une pièce exige. */
export const FUNCTIONS = [
  'dormir', 'dormir_double', 'assise_salon', 'repas', 'cuisson', 'lavage_vaisselle',
  'evier', 'froid', 'plan_de_travail', 'rangement_cuisine', 'rangement_vetements',
  'rangement_general', 'rangement_entree', 'travail', 'toilette', 'douche', 'bain',
  'lavabo', 'lavage_linge', 'tv', 'chevet', 'eclairage_appoint', 'decoration',
] as const;
export type UsageFunction = (typeof FUNCTIONS)[number];

// ───────────────────────────── Plan d'entrée ─────────────────────────────

export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  /** null = inconnu (ne jamais supposer « non porteur »). */
  loadBearing: boolean | null;
  exterior?: boolean;
  /**
   * Niveau du mur (0 = RDC). Facultatif : absent => le mur est commun à tous les niveaux
   * (cas des plans à un seul niveau). Indispensable pour les maisons à étage, où les murs
   * de deux niveaux se superposent en plan.
   */
  level?: number;
}

export type OpeningKind = 'door' | 'window' | 'french_window' | 'opening';

export interface Opening {
  id: string;
  kind: OpeningKind;
  wallId: string;
  /** Distance (m) depuis wall.a jusqu'au BORD de l'ouverture le plus proche de a. */
  offset: number;
  width: number;
  /** Hauteur d'allège (fenêtres). */
  sillHeight?: number;
  /** Battant : pièce dans laquelle s'ouvre le vantail, côté de la charnière vu depuis cette pièce. */
  swing?: { into: string | null; hinge: 'a' | 'b' } | null;
  /** Les deux pièces reliées (null = extérieur / palier). */
  connects: [string | null, string | null];
}

export type FixtureKind =
  | 'gaine' | 'arrivee_eau' | 'evacuation' | 'radiateur' | 'tableau_electrique'
  | 'cheminee' | 'poteau' | 'chaudiere' | 'bouche_vmc';

export interface Fixture {
  id: string;
  kind: FixtureKind;
  roomId: string;
  position: Vec2;
  /** Emprise au sol (m), facultative. */
  size?: { w: number; d: number };
  /**
   * Équipement SUPPOSÉ par Mimmoza, absent du plan d'origine (FACULTATIF, ajout INT-09b ; absent = false).
   * Posé par `supposerPointsEau` (src/hypotheses) ; le critique le signale dans `assumptions` (« à confirmer »).
   */
  supposed?: boolean;
  /** Raison de la supposition (français), renseignée quand `supposed` est vrai (ajout INT-09b). */
  reason?: string;
}

export interface RoomInput {
  id: string;
  name?: string;
  declaredRole: RoomRole | null;
  polygon: Vec2[];
  level: number;
}

export interface PlanInput {
  id: string;
  label: string;
  typology: 'studio' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6+';
  kind: 'appartement' | 'maison';
  construction: 'neuf' | 'existant';
  /** Angle du nord en degrés, sens horaire depuis +y. null = inconnu. */
  northDeg: number | null;
  ceilingHeight: number;
  walls: Wall[];
  rooms: RoomInput[];
  openings: Opening[];
  fixtures: Fixture[];
}

// ───────────────────────────── Brief ─────────────────────────────

export type Target = 'famille' | 'primo_accedant' | 'investisseur_locatif' | 'senior' | 'couple' | 'etudiant';
export type Gamme = 'economique' | 'standard' | 'premium';
export type StyleId = 'contemporain' | 'scandinave' | 'industriel' | 'japandi' | 'classique_chic' | 'mediterraneen';

export interface InteriorBrief {
  version: 1;
  target: Target;
  occupants: { adults: number; children: number };
  style: StyleId;
  gamme: Gamme;
  constraints: {
    teletravail: boolean;
    pmr: boolean;
    animaux: boolean;
  };
  /** Ids de FurnitureSpec imposés / interdits par l'utilisateur. */
  imposed: string[];
  forbidden: string[];
  /** Texte libre d'origine conservé tel quel. */
  sourceText?: string;
}

// ───────────────────────────── Base de règles ─────────────────────────────

export type RuleFamily = 'usage' | 'circulation' | 'technique' | 'echelle' | 'organisation' | 'style';
export type RuleNature = 'norme' | 'usage_professionnel' | 'hypothese_mimmoza';

/** Familles bloquantes : une violation impose un verdict défavorable (absorbant). */
export const BLOCKING_FAMILIES: RuleFamily[] = ['usage', 'circulation', 'technique'];

export interface RuleSource {
  /** Ex. « Arrêté du 24 décembre 2015, art. 9 » ou « barème Mimmoza 2026 (hypothèse) ». */
  reference: string;
  url?: string;
  /** true tant que la valeur n'a pas été recoupée sur le texte officiel. */
  toVerify: boolean;
}

export interface RuleApplicability {
  construction: Array<'neuf' | 'existant'>;
  kind: Array<'appartement' | 'maison'>;
  /** 'toujours' | 'si_pmr' (brief.constraints.pmr) */
  pmr: 'toujours' | 'si_pmr';
  roles?: RoomRole[];
}

/**
 * Contrôle exécutable. `kind` doit être implémenté dans le registre du critique
 * (src/critic/checks.ts). Un kind inconnu fait échouer les tests de la base.
 */
export interface RuleCheck {
  kind: string;
  params: Record<string, number | string | boolean | string[]>;
}

export interface Rule {
  id: string;
  version: number;
  family: RuleFamily;
  nature: RuleNature;
  title: string;
  source: RuleSource;
  applicability: RuleApplicability;
  severity: 'bloquante' | 'degradante';
  /** Poids dans le score de la famille (0..1). */
  weight: number;
  check: RuleCheck;
  /** Exigence reformulée (jamais le texte d'une norme NF payante reproduit). */
  requirement: string;
  /** Hypothèse d'interprétation retenue par Mimmoza. */
  interpretation: string;
}

// ───────────────────────────── Catalogue dimensionnel ─────────────────────────────

export type FurnitureCategory =
  | 'lit' | 'chevet' | 'armoire' | 'commode' | 'canape' | 'fauteuil' | 'table_basse'
  | 'meuble_tv' | 'table_repas' | 'chaise' | 'bureau' | 'chaise_bureau' | 'bibliotheque'
  | 'cuisine_lineaire' | 'ilot' | 'refrigerateur' | 'lave_vaisselle' | 'lave_linge'
  | 'meuble_vasque' | 'douche' | 'baignoire' | 'wc' | 'lave_mains' | 'meuble_entree'
  | 'banc' | 'tapis' | 'luminaire_sol' | 'plante' | 'dressing';

export interface Clearances {
  /** Dégagement libre requis devant (côté usage), derrière, à gauche, à droite (m). */
  front: number;
  back: number;
  left: number;
  right: number;
}

export type Anchor = 'mur_dos' | 'libre' | 'angle' | 'centre_piece';

export interface FurnitureSpec {
  id: string;
  label: string;
  category: FurnitureCategory;
  /** w = largeur (axe x local), d = profondeur (axe y local, le « devant » est +y local), h = hauteur. */
  size: { w: number; d: number; h: number };
  clearances: Clearances;
  anchor: Anchor;
  /** Peut-il être placé devant une fenêtre dont l'allège est plus haute que lui ? */
  allowedUnderWindow: boolean;
  allowedRoles: RoomRole[];
  provides: UsageFunction[];
  /** Places assises / couchages offerts (pour les contrôles d'occupants). */
  seats?: number;
  sleeps?: number;
  needsWater: boolean;
  gammes: Gamme[];
  /** Source des dimensions (usage professionnel / fabricant type / hypothèse). */
  dimensionSource: string;
}

// ───────────────────────────── Analyse du plan ─────────────────────────────

export interface WallRun {
  /** Segment de mur intérieur à la pièce, sans ouverture ni débattement, utilisable pour adosser un meuble. */
  roomId: string;
  wallId: string;
  a: Vec2;
  b: Vec2;
  length: number;
  /** Normale unitaire pointant vers l'intérieur de la pièce. */
  inwardNormal: Vec2;
}

export interface SwingZone {
  openingId: string;
  roomId: string;
  /** Polygone approché (secteur de quart de cercle) à garder libre. */
  polygon: Vec2[];
}

export interface AnalyzedRoom {
  id: string;
  role: RoomRole;
  roleSource: 'declare' | 'deduit';
  roleConfidence: number; // 0..1
  area: number;
  polygon: Vec2[];
  bbox: { min: Vec2; max: Vec2 };
  wallRuns: WallRun[];
  swingZones: SwingZone[];
  windows: Array<{ openingId: string; a: Vec2; b: Vec2; sillHeight: number | null }>;
  doors: Array<{ openingId: string; a: Vec2; b: Vec2; to: string | null }>;
  fixtures: Fixture[];
  hasWater: boolean;
  zone: 'jour' | 'nuit' | 'service' | 'circulation' | 'exterieur';
}

export interface PlanAnalysis {
  planId: string;
  rooms: AnalyzedRoom[];
  adjacency: Array<{ a: string; b: string | null; viaOpening: string }>;
  totalArea: number;
  missing: string[];
  assumptions: string[];
}

// ───────────────────────────── Programme ─────────────────────────────

export interface ProgramItem {
  specId: string;
  priority: 'obligatoire' | 'souhaite' | 'optionnel';
  reason: string;
  /** Spec de repli si l'élément ne tient pas (ex. lit 140 au lieu de 160). */
  fallbacks: string[];
}

export interface RoomProgram {
  roomId: string;
  role: RoomRole;
  requiredFunctions: UsageFunction[];
  items: ProgramItem[];
  notes: string[];
}

// ───────────────────────────── Implantation ─────────────────────────────

/**
 * Finition d'un meuble placé (FACULTATIVE, ajout INT-01). Seules les règles de la famille
 * « style » la lisent ; si aucun placement n'a de finition, ces règles vont dans `rulesSkipped`.
 */
export interface PlacementFinish {
  /** Matériau principal visible, identifiant libre en minuscules (ex. 'bois', 'metal', 'tissu', 'laque', 'verre', 'pierre', 'cuir', 'rotin'). */
  material: string;
  /** Essence si material === 'bois' (ex. 'chene', 'noyer', 'frene', 'pin', 'teck'), sinon null/absent. */
  woodSpecies?: string | null;
  /** Couleur dominante du meuble, hexadécimal '#RRGGBB'. */
  color?: string;
  /**
   * Identifiant du matériau PBR de la bibliothèque du Studio (FACULTATIF, ajout INT-07, ex. 'av-bois-interieur').
   * Rempli par applyStyle (src/style) ; ignoré par le critique.
   */
  materialId?: string;
}

export interface Placement {
  id: string;
  specId: string;
  roomId: string;
  /** Centre de l'emprise au sol. */
  center: Vec2;
  /** Rotation : le « devant » local (+y) est tourné de rotationDeg (0, 90, 180, 270). */
  rotationDeg: 0 | 90 | 180 | 270;
  anchoredTo?: { wallRunIndex: number } | null;
  /**
   * Symétrie gauche/droite (FACULTATIVE, ajout INT-05b) : true => les dégagements latéraux de la spec sont
   * permutés (clearances.left s'applique à droite et inversement). Sert aux meubles à dégagements
   * asymétriques (lit 1 place posé en angle contre un mur à droite plutôt qu'à gauche). Absent = false.
   */
  mirrored?: boolean;
  /** Finition facultative (règles de style uniquement). */
  finish?: PlacementFinish;
}

export interface FamilyScore {
  family: RuleFamily;
  score: number; // 0..100
  violations: string[]; // ids de Violation
}

export interface Repair {
  step: number;
  action: string;
  placementId?: string;
  reason: string;
}

export interface LayoutPlan {
  version: 1;
  planId: string;
  variant: string;
  seed: number;
  placements: Placement[];
  /** Éléments du programme non placés, avec raison (jamais masqués). */
  unplaced: Array<{ roomId: string; specId: string; reason: string }>;
  repairs: Repair[];
}

// ───────────────────────────── Rapport ─────────────────────────────

export interface Violation {
  id: string;
  ruleId: string;
  family: RuleFamily;
  severity: 'bloquante' | 'degradante';
  roomId: string | null;
  placementIds: string[];
  message: string;
  measured?: number;
  expected?: number;
}

export type Verdict = 'favorable' | 'reserve' | 'defavorable';

export interface RoomVerdict {
  roomId: string;
  verdict: Verdict;
  scores: FamilyScore[];
}

export interface InteriorReport {
  version: 1;
  planId: string;
  variant: string;
  verdict: Verdict;
  rooms: RoomVerdict[];
  violations: Violation[];
  rulesChecked: string[];
  /** Règles non applicables faute de donnée (ex. murs porteurs inconnus). */
  rulesSkipped: Array<{ ruleId: string; reason: string }>;
  assumptions: string[];
  missing: string[];
  unplaced: LayoutPlan['unplaced'];
  recommendations: string[];
}
