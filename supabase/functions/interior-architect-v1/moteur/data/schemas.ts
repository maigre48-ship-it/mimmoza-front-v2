/**
 * Schémas zod de la base de règles et du catalogue dimensionnel (INT-01 / INT-02).
 * Le détail sémantique de chaque `check.kind` est dans src/data/CHECKS.md (contrat du critique).
 */
import { z } from 'zod';
import { ROOM_ROLES, FUNCTIONS } from '../types';
import type { Rule, FurnitureSpec, FurnitureCategory } from '../types';

// ───────────── Énumérations ─────────────

export const FURNITURE_CATEGORIES = [
  'lit', 'chevet', 'armoire', 'commode', 'canape', 'fauteuil', 'table_basse',
  'meuble_tv', 'table_repas', 'chaise', 'bureau', 'chaise_bureau', 'bibliotheque',
  'cuisine_lineaire', 'ilot', 'refrigerateur', 'lave_vaisselle', 'lave_linge',
  'meuble_vasque', 'douche', 'baignoire', 'wc', 'lave_mains', 'meuble_entree',
  'banc', 'tapis', 'luminaire_sol', 'plante', 'dressing',
] as const satisfies readonly FurnitureCategory[];

/** Vérification à la compilation : la liste couvre exactement FurnitureCategory. */
type _MissingCategory = Exclude<FurnitureCategory, (typeof FURNITURE_CATEGORIES)[number]>;
const _categoriesComplete: _MissingCategory extends never ? true : false = true;
void _categoriesComplete;

export const FIXTURE_KINDS = [
  'gaine', 'arrivee_eau', 'evacuation', 'radiateur', 'tableau_electrique',
  'cheminee', 'poteau', 'chaudiere', 'bouche_vmc',
] as const;

export const RoomRoleSchema = z.enum(ROOM_ROLES);
export const UsageFunctionSchema = z.enum(FUNCTIONS);
export const FurnitureCategorySchema = z.enum(FURNITURE_CATEGORIES);
/** Liste de catégories ; '*' = toutes les catégories. */
const CategoryList = z.array(z.union([FurnitureCategorySchema, z.literal('*')])).min(1);
const CategoryListOpt = z.array(FurnitureCategorySchema);
const FixtureKindSchema = z.enum(FIXTURE_KINDS);
const meters = z.number().min(0).max(20);
const ratio = z.number().min(0).max(1);

// ───────────── Kinds de contrôle (ensemble fermé) ─────────────

export const CHECK_KINDS = [
  'emprise_valide',
  'passage_min',
  'cercle_manoeuvre',
  'degagement_categorie',
  'debattement_libre',
  'ouverture_non_obstruee',
  'distance_fixture',
  'fonctions_requises',
  'capacite_occupants',
  'triangle_cuisine',
  'ratio_dimension',
  'distance_entre_categories',
  'zonage_jour_nuit',
  'recommandation_prises',
  'style_coherence',
  'vis_a_vis',
  'adossement',
] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

/** Schéma des params de chaque kind (strict : tout param inconnu est refusé). Voir CHECKS.md. */
export const CHECK_PARAM_SCHEMAS = {
  emprise_valide: z.object({
    overlapAllowedCategories: CategoryListOpt,
    overlapTolerance: meters,
    checkFixtures: z.boolean(),
    checkAllowedRoles: z.boolean(),
  }).strict(),

  passage_min: z.object({
    minWidth: meters,
    targets: z.enum(['portes', 'portes_et_usages']),
    ignoreCategories: CategoryListOpt,
    satelliteCategories: CategoryListOpt.optional(),
    uniteDeVie: z.boolean().optional(),
  }).strict(),

  cercle_manoeuvre: z.object({
    diameter: meters,
    scope: z.enum(['chaque_piece', 'au_moins_une_piece']),
    ignoreCategories: CategoryListOpt,
    swingAllowed: z.boolean(),
    includeSejourIfNoChambre: z.boolean().optional(),
    uniteDeVie: z.boolean().optional(),
  }).strict(),

  degagement_categorie: z.object({
    categories: CategoryList,
    requireProvides: UsageFunctionSchema.optional(),
    minFront: meters.optional(),
    minBack: meters.optional(),
    minLeft: meters.optional(),
    minRight: meters.optional(),
    altMinFront: meters.optional(),
    altMinLeft: meters.optional(),
    altMinRight: meters.optional(),
    lateralMode: z.enum(['tous', 'au_moins_un', 'tous_si_double']).optional(),
    sideZoneLength: meters.optional(),
    useSpecClearances: z.boolean().optional(),
    ignoreCategories: CategoryListOpt,
    swingCounts: z.boolean(),
    swingTolerance: meters.optional(),
    scope: z.enum(['chaque_placement', 'au_moins_un_logement']),
    relaxOneSideIfSinglePiece: z.boolean().optional(),
    uniteDeVie: z.boolean().optional(),
  }).strict(),

  debattement_libre: z.object({
    ignoreCategories: CategoryListOpt,
    toleranceArea: z.number().min(0).max(1),
  }).strict(),

  ouverture_non_obstruee: z.object({
    depth: meters,
    heightTolerance: meters,
    frenchWindowDepth: meters,
    ignoreCategories: CategoryListOpt,
  }).strict(),

  distance_fixture: z.object({
    mode: z.enum(['min', 'max', 'piece_humide', 'zone_avant']),
    fixtureKinds: z.array(FixtureKindSchema),
    distance: meters.optional(),
    zoneWidth: meters.optional(),
    categories: CategoryList,
    minHeight: meters.optional(),
    requireNeedsWater: z.boolean().optional(),
  }).strict(),

  fonctions_requises: z.object({
    functions: z.array(UsageFunctionSchema),
    anyOf: z.array(UsageFunctionSchema).optional(),
    scope: z.enum(['chaque_piece', 'logement']),
    acceptAdjacentRoles: z.array(RoomRoleSchema).optional(),
    fallbackToEntranceRoom: z.boolean().optional(),
    whenBrief: z.enum(['toujours', 'teletravail', 'pmr', 'animaux']),
  }).strict(),

  capacite_occupants: z.object({
    measure: z.enum(['sleeps', 'seats']),
    providing: UsageFunctionSchema,
    aggregate: z.enum(['somme', 'max']),
    bound: z.enum(['min', 'max']),
    margin: z.number().int().min(-10).max(10),
    ignoreCategories: CategoryListOpt,
    ignoreOnlyIfRoles: z.array(RoomRoleSchema).optional(),
  }).strict(),

  triangle_cuisine: z.object({
    minLeg: meters,
    maxLeg: meters,
    maxPerimeter: meters,
  }).strict(),

  ratio_dimension: z.object({
    numerator: z.enum(['largeur', 'surface']),
    categories: CategoryList,
    reference: z.enum(['mur', 'categorie', 'piece']),
    referenceCategories: CategoryListOpt.optional(),
    min: z.number().min(0).max(5).optional(),
    max: z.number().min(0).max(5).optional(),
    ignoreCategories: CategoryListOpt,
    wallTolerance: meters.optional(),
  }).strict(),

  distance_entre_categories: z.object({
    from: CategoryListOpt.min(1),
    to: CategoryListOpt.min(1),
    measure: z.enum(['bord_a_bord', 'faces_avant', 'centres']),
    min: meters.optional(),
    max: meters.optional(),
    sameRoomOnly: z.boolean(),
  }).strict(),

  zonage_jour_nuit: z.object({
    maxJourCrossings: z.number().int().min(0).max(5),
  }).strict(),

  recommandation_prises: z.object({
    minCount: z.number().int().min(0).max(20).optional(),
    m2PerSocket: z.number().min(0).max(50).optional(),
    maxRequired: z.number().int().min(0).max(30).optional(),
    smallAreaThreshold: z.number().min(0).max(50).optional(),
    smallAreaCount: z.number().int().min(0).max(20).optional(),
    minAboveWorktop: z.number().int().min(0).max(20).optional(),
    nearSwitch: z.boolean().optional(),
    dedicatedFor: z.array(UsageFunctionSchema).optional(),
    nearFunctions: z.array(UsageFunctionSchema).optional(),
  }).strict(),

  style_coherence: z.object({
    aspect: z.enum(['palette_60_30_10', 'essences_bois_max', 'materiaux_max', 'materiau_commun']),
    scope: z.enum(['piece', 'logement']),
    max: z.number().int().min(1).max(10).optional(),
    dominantMin: ratio.optional(),
    dominantMax: ratio.optional(),
    secondaryMin: ratio.optional(),
    secondaryMax: ratio.optional(),
    accentMax: ratio.optional(),
    colorTolerance: z.number().min(0).max(442).optional(),
    /** INT-07 : catégories ignorées par ce contrôle (ex. sanitaires et électroménager pour la palette). */
    excludeCategories: CategoryListOpt.optional(),
    /** INT-07 (palette) : nombre minimal de placements colorés (hors exclus) pour évaluer une pièce. */
    minPlacements: z.number().int().min(1).max(50).optional(),
  }).strict(),

  vis_a_vis: z.object({
    from: CategoryListOpt.min(1),
    to: CategoryListOpt.min(1),
    maxLateralOffset: meters,
    sameRoomOnly: z.boolean(),
  }).strict(),

  adossement: z.object({
    categories: CategoryListOpt.min(1),
    maxGap: meters,
    side: z.enum(['back']),
  }).strict(),
} satisfies Record<CheckKind, z.ZodTypeAny>;

// ───────────── Rule ─────────────

const RuleCheckSchema = z.object({
  kind: z.enum(CHECK_KINDS),
  params: z.record(z.union([z.number(), z.string(), z.boolean(), z.array(z.string())])),
}).superRefine((c, ctx) => {
  const schema = CHECK_PARAM_SCHEMAS[c.kind];
  const r = schema.safeParse(c.params);
  if (!r.success) {
    for (const issue of r.error.issues) ctx.addIssue({ ...issue, path: ['params', ...issue.path] });
  }
});

export const RuleSchema = z.object({
  id: z.string().regex(/^(USA|CIR|TEC|ECH|ORG|STY)-\d{2}[a-z]?$/),
  version: z.number().int().min(1),
  family: z.enum(['usage', 'circulation', 'technique', 'echelle', 'organisation', 'style']),
  nature: z.enum(['norme', 'usage_professionnel', 'hypothese_mimmoza']),
  title: z.string().min(5),
  source: z.object({
    reference: z.string().min(5),
    url: z.string().url().optional(),
    toVerify: z.boolean(),
  }).strict(),
  applicability: z.object({
    construction: z.array(z.enum(['neuf', 'existant'])).min(1),
    kind: z.array(z.enum(['appartement', 'maison'])).min(1),
    pmr: z.enum(['toujours', 'si_pmr']),
    roles: z.array(RoomRoleSchema).min(1).optional(),
  }).strict(),
  severity: z.enum(['bloquante', 'degradante']),
  weight: z.number().min(0).max(1),
  check: RuleCheckSchema,
  requirement: z.string().min(10),
  interpretation: z.string().min(10),
}).strict().superRefine((r, ctx) => {
  if (!r.source.toVerify && !r.source.url) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'toVerify:false exige une URL de source officielle', path: ['source', 'url'] });
  if (r.nature === 'hypothese_mimmoza' && !/barème Mimmoza 2026 \(hypothèse\)/.test(r.source.reference))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'une hypothèse Mimmoza doit citer « barème Mimmoza 2026 (hypothèse) »', path: ['source', 'reference'] });
  if (r.nature !== 'norme' && !r.source.toVerify)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'seule une norme lue sur le texte officiel peut être toVerify:false', path: ['source', 'toVerify'] });
});

// ───────────── FurnitureSpec ─────────────

const dim = (min: number, max: number) => z.number().min(min).max(max);

export const FurnitureSpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  label: z.string().min(3),
  category: FurnitureCategorySchema,
  size: z.object({ w: dim(0.2, 4), d: dim(0.2, 4), h: dim(0.005, 2.6) }).strict(),
  clearances: z.object({ front: dim(0, 2), back: dim(0, 2), left: dim(0, 2), right: dim(0, 2) }).strict(),
  anchor: z.enum(['mur_dos', 'libre', 'angle', 'centre_piece']),
  allowedUnderWindow: z.boolean(),
  allowedRoles: z.array(RoomRoleSchema).min(1),
  provides: z.array(UsageFunctionSchema),
  seats: z.number().int().min(0).max(12).optional(),
  sleeps: z.number().int().min(0).max(4).optional(),
  needsWater: z.boolean(),
  gammes: z.array(z.enum(['economique', 'standard', 'premium'])).min(1),
  dimensionSource: z.string().min(5),
}).strict();

// ───────────── Garde-fous de typage (les schémas restent alignés sur types.ts) ─────────────

/**
 * zod infère `x?: T | undefined` pour un champ `.optional()` ; sous `exactOptionalPropertyTypes` (tsconfig
 * de MimmozIA Studio) ce type n'est pas assignable à `x?: T`. On retire `undefined` des champs avant la
 * comparaison : le garde-fou reste actif sur les noms, les types et le caractère facultatif des champs.
 */
type SansUndefined<T> = T extends readonly unknown[] ? { [K in keyof T]: SansUndefined<T[K]> }
  : T extends object ? { [K in keyof T]: SansUndefined<Exclude<T[K], undefined>> } : T;
type RuleFromSchema = SansUndefined<z.infer<typeof RuleSchema>>;
type SpecFromSchema = SansUndefined<z.infer<typeof FurnitureSpecSchema>>;
const _ruleAssignable = (r: RuleFromSchema): Rule => r;
const _specAssignable = (s: SpecFromSchema): FurnitureSpec => s;
void _ruleAssignable; void _specAssignable;
