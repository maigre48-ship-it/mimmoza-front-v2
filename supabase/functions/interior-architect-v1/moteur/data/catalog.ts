/**
 * LOT INT-02 — Catalogue dimensionnel v1 (marché français, logement neuf).
 *
 * Conventions (voir src/types.ts) :
 * - w = largeur (axe x local), d = profondeur (axe y local), h = hauteur, en mètres.
 * - Le « devant » (côté usage) est +y local ; un meuble adossé (anchor 'mur_dos' / 'angle') a son dos à -y.
 * - Pour un lit : w = largeur de couchage, d = longueur ; tête de lit au dos (-y), pied de lit = devant (+y),
 *   grands côtés = gauche (-x) / droite (+x).
 * - Pour une table : w = longueur ; les grands côtés (où l'on s'assoit) sont devant / derrière.
 * - Pour une chaise : le devant regarde la table ; le recul se mesure derrière (-y).
 * - Les dégagements (clearances) sont ceux que l'implanteur réserve ; les seuils réglementaires (PMR, etc.)
 *   sont contrôlés par les règles (src/data/rules.ts), pas par le catalogue.
 * - Les éléments hauts de cuisine (meubles hauts, colonnes) ne sont pas modélisés : h = hauteur plan de travail.
 * - Dimensions : valeurs courantes du marché, non garanties pour un modèle précis (`dimensionSource`).
 */
import type { FurnitureSpec, RoomRole, Gamme, UsageFunction, Clearances } from '../types';

/** Pièces où un meuble `needsWater` peut être placé (pièces humides / équipées d'eau). */
export const WET_ROLES: RoomRole[] = ['cuisine', 'sejour_cuisine', 'salle_de_bain', 'salle_d_eau', 'wc', 'buanderie', 'cellier'];

const ALL: Gamme[] = ['economique', 'standard', 'premium'];
const ECO_STD: Gamme[] = ['economique', 'standard'];
const STD_PREM: Gamme[] = ['standard', 'premium'];
const PREM: Gamme[] = ['premium'];

const CHAMBRES: RoomRole[] = ['chambre', 'chambre_parentale'];
const SEJOURS: RoomRole[] = ['sejour', 'sejour_cuisine'];
const CUISINES: RoomRole[] = ['cuisine', 'sejour_cuisine'];
const BAINS: RoomRole[] = ['salle_de_bain', 'salle_d_eau'];
const REPAS_ROLES: RoomRole[] = ['sejour', 'sejour_cuisine', 'cuisine'];

const SRC_PRO = 'usage professionnel (dimensions courantes du marché français)';
const SRC_FAB = 'dimensions types fabricant (valeurs courantes du marché français, non liées à un modèle)';
const SRC_ARR = 'dimensions types fabricant ; gabarit aligné sur la zone de douche accessible 0,90 × 1,20 m (arrêté du 24 décembre 2015, art. 15)';
const SRC_HYP = 'hypothèse Mimmoza (barème Mimmoza 2026)';

const C = (front: number, back = 0, left = 0, right = 0): Clearances => ({ front, back, left, right });

interface Def {
  id: string; label: string; category: FurnitureSpec['category'];
  w: number; d: number; h: number; c: Clearances; anchor: FurnitureSpec['anchor'];
  underWindow: boolean; roles: RoomRole[]; provides: UsageFunction[];
  seats?: number; sleeps?: number; water?: boolean; gammes: Gamme[]; src: string;
}
const spec = (x: Def): FurnitureSpec => ({
  id: x.id, label: x.label, category: x.category,
  size: { w: x.w, d: x.d, h: x.h }, clearances: x.c, anchor: x.anchor,
  allowedUnderWindow: x.underWindow, allowedRoles: x.roles, provides: x.provides,
  ...(x.seats !== undefined ? { seats: x.seats } : {}),
  ...(x.sleeps !== undefined ? { sleeps: x.sleeps } : {}),
  needsWater: x.water ?? false, gammes: x.gammes, dimensionSource: x.src,
});

// Dégagements types de lit : pied (devant) et grands côtés 0,60 m (usage courant hors PMR).
const LIT_DOUBLE = C(0.6, 0, 0.6, 0.6);
const LIT_SIMPLE = C(0.6, 0, 0, 0.6); // posé en angle : grand côté gauche contre le mur
const TABLE = C(0.75, 0.75, 0, 0);     // 0,45–0,50 m de chaise + 0,30 m de recul de chaque grand côté

export const CATALOG: FurnitureSpec[] = [
  // ───────── Lits ─────────
  spec({ id: 'lit_90x190', label: 'Lit 1 place 90 × 190', category: 'lit', w: 0.9, d: 1.9, h: 0.5, c: LIT_SIMPLE, anchor: 'angle', underWindow: true, roles: [...CHAMBRES, 'bureau'], provides: ['dormir'], sleeps: 1, gammes: ALL, src: SRC_PRO }),
  spec({ id: 'lit_90x200', label: 'Lit 1 place 90 × 200', category: 'lit', w: 0.9, d: 2.0, h: 0.5, c: LIT_SIMPLE, anchor: 'angle', underWindow: true, roles: [...CHAMBRES, 'bureau'], provides: ['dormir'], sleeps: 1, gammes: ALL, src: SRC_PRO }),
  spec({ id: 'lit_120x190', label: 'Lit 1 place ½ 120 × 190', category: 'lit', w: 1.2, d: 1.9, h: 0.5, c: LIT_SIMPLE, anchor: 'angle', underWindow: true, roles: CHAMBRES, provides: ['dormir'], sleeps: 1, gammes: ALL, src: SRC_PRO }),
  spec({ id: 'lit_140x190', label: 'Lit 2 places 140 × 190', category: 'lit', w: 1.4, d: 1.9, h: 0.5, c: LIT_DOUBLE, anchor: 'mur_dos', underWindow: true, roles: CHAMBRES, provides: ['dormir', 'dormir_double'], sleeps: 2, gammes: ALL, src: SRC_PRO }),
  spec({ id: 'lit_140x200', label: 'Lit 2 places 140 × 200', category: 'lit', w: 1.4, d: 2.0, h: 0.5, c: LIT_DOUBLE, anchor: 'mur_dos', underWindow: true, roles: CHAMBRES, provides: ['dormir', 'dormir_double'], sleeps: 2, gammes: ALL, src: SRC_PRO }),
  spec({ id: 'lit_160x200', label: 'Lit 2 places 160 × 200', category: 'lit', w: 1.6, d: 2.0, h: 0.5, c: LIT_DOUBLE, anchor: 'mur_dos', underWindow: true, roles: CHAMBRES, provides: ['dormir', 'dormir_double'], sleeps: 2, gammes: STD_PREM, src: SRC_PRO }),
  spec({ id: 'lit_180x200', label: 'Lit 2 places 180 × 200', category: 'lit', w: 1.8, d: 2.0, h: 0.5, c: LIT_DOUBLE, anchor: 'mur_dos', underWindow: true, roles: CHAMBRES, provides: ['dormir', 'dormir_double'], sleeps: 2, gammes: PREM, src: SRC_PRO }),
  spec({ id: 'lit_superpose_90x190', label: 'Lits superposés 2 × 90 × 190', category: 'lit', w: 0.98, d: 2.0, h: 1.6, c: LIT_SIMPLE, anchor: 'angle', underWindow: false, roles: ['chambre'], provides: ['dormir'], sleeps: 2, gammes: ECO_STD, src: SRC_FAB }),

  // ───────── Chevets ─────────
  spec({ id: 'chevet_45', label: 'Chevet 45 cm', category: 'chevet', w: 0.45, d: 0.35, h: 0.55, c: C(0.4), anchor: 'mur_dos', underWindow: true, roles: CHAMBRES, provides: ['chevet'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'chevet_40', label: 'Chevet compact 40 cm', category: 'chevet', w: 0.4, d: 0.3, h: 0.5, c: C(0.4), anchor: 'mur_dos', underWindow: true, roles: CHAMBRES, provides: ['chevet'], gammes: ECO_STD, src: SRC_FAB }),

  // ───────── Armoires / dressings / commodes ─────────
  // INT-05b : commodes admises en séjour-cuisine (studio : rangement de vêtements dans la pièce de vie, usage courant).
  spec({ id: 'armoire_1p', label: 'Armoire 1 porte battante 50 cm', category: 'armoire', w: 0.5, d: 0.6, h: 2.0, c: C(0.7), anchor: 'mur_dos', underWindow: false, roles: [...CHAMBRES, 'entree', 'bureau', 'dressing'], provides: ['rangement_vetements', 'rangement_general'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'armoire_2p', label: 'Armoire 2 portes battantes 100 cm', category: 'armoire', w: 1.0, d: 0.6, h: 2.0, c: C(0.7), anchor: 'mur_dos', underWindow: false, roles: [...CHAMBRES, 'entree', 'bureau', 'dressing'], provides: ['rangement_vetements', 'rangement_general'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'armoire_3p', label: 'Armoire 3 portes battantes 150 cm', category: 'armoire', w: 1.5, d: 0.6, h: 2.0, c: C(0.7), anchor: 'mur_dos', underWindow: false, roles: [...CHAMBRES, 'dressing'], provides: ['rangement_vetements', 'rangement_general'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'armoire_coulissante_160', label: 'Armoire 2 portes coulissantes 160 cm', category: 'armoire', w: 1.6, d: 0.65, h: 2.2, c: C(0.7), anchor: 'mur_dos', underWindow: false, roles: [...CHAMBRES, 'dressing'], provides: ['rangement_vetements', 'rangement_general'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'armoire_coulissante_200', label: 'Armoire 2 portes coulissantes 200 cm', category: 'armoire', w: 2.0, d: 0.65, h: 2.2, c: C(0.7), anchor: 'mur_dos', underWindow: false, roles: [...CHAMBRES, 'dressing'], provides: ['rangement_vetements', 'rangement_general'], gammes: STD_PREM, src: SRC_FAB }),
  spec({ id: 'commode_80', label: 'Commode 4 tiroirs 80 cm', category: 'commode', w: 0.8, d: 0.45, h: 0.85, c: C(0.8), anchor: 'mur_dos', underWindow: true, roles: [...CHAMBRES, ...SEJOURS, 'entree', 'bureau'], provides: ['rangement_vetements', 'rangement_general'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'commode_120', label: 'Commode 6 tiroirs 120 cm', category: 'commode', w: 1.2, d: 0.5, h: 0.8, c: C(0.8), anchor: 'mur_dos', underWindow: true, roles: [...CHAMBRES, ...SEJOURS, 'bureau'], provides: ['rangement_vetements', 'rangement_general'], gammes: STD_PREM, src: SRC_FAB }),
  spec({ id: 'dressing_ouvert_120', label: 'Dressing ouvert 120 cm', category: 'dressing', w: 1.2, d: 0.5, h: 2.1, c: C(0.8), anchor: 'mur_dos', underWindow: false, roles: [...CHAMBRES, 'dressing'], provides: ['rangement_vetements'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'dressing_ouvert_200', label: 'Dressing ouvert 200 cm', category: 'dressing', w: 2.0, d: 0.5, h: 2.1, c: C(0.8), anchor: 'mur_dos', underWindow: false, roles: [...CHAMBRES, 'dressing'], provides: ['rangement_vetements'], gammes: STD_PREM, src: SRC_FAB }),
  spec({ id: 'dressing_ouvert_240', label: 'Dressing ouvert 240 cm', category: 'dressing', w: 2.4, d: 0.55, h: 2.2, c: C(0.8), anchor: 'mur_dos', underWindow: false, roles: [...CHAMBRES, 'dressing'], provides: ['rangement_vetements'], gammes: PREM, src: SRC_FAB }),

  // ───────── Salon ─────────
  spec({ id: 'canape_compact_2p', label: 'Canapé compact 2 places 140 cm', category: 'canape', w: 1.4, d: 0.85, h: 0.82, c: C(0.4), anchor: 'mur_dos', underWindow: true, roles: [...SEJOURS, 'bureau'], provides: ['assise_salon'], seats: 2, gammes: ECO_STD, src: SRC_FAB }),
  spec({ id: 'canape_2p', label: 'Canapé 2 places 160 cm', category: 'canape', w: 1.6, d: 0.9, h: 0.85, c: C(0.4), anchor: 'mur_dos', underWindow: true, roles: SEJOURS, provides: ['assise_salon'], seats: 2, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'canape_3p', label: 'Canapé 3 places 210 cm', category: 'canape', w: 2.1, d: 0.95, h: 0.85, c: C(0.4), anchor: 'mur_dos', underWindow: true, roles: SEJOURS, provides: ['assise_salon'], seats: 3, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'canape_angle', label: "Canapé d'angle 250 × 160 cm", category: 'canape', w: 2.5, d: 1.6, h: 0.85, c: C(0.4), anchor: 'angle', underWindow: true, roles: SEJOURS, provides: ['assise_salon'], seats: 4, gammes: STD_PREM, src: SRC_FAB }),
  spec({ id: 'canape_convertible_2p', label: 'Canapé convertible 2 places (couchage 140 × 190 déplié)', category: 'canape', w: 1.8, d: 0.95, h: 0.85, c: C(0.4), anchor: 'mur_dos', underWindow: true, roles: [...SEJOURS, 'bureau'], provides: ['assise_salon', 'dormir', 'dormir_double'], seats: 2, sleeps: 2, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'fauteuil_standard', label: 'Fauteuil 80 cm', category: 'fauteuil', w: 0.8, d: 0.85, h: 0.85, c: C(0.4), anchor: 'libre', underWindow: true, roles: [...SEJOURS, ...CHAMBRES, 'bureau'], provides: ['assise_salon'], seats: 1, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'fauteuil_compact', label: 'Fauteuil compact 65 cm', category: 'fauteuil', w: 0.65, d: 0.7, h: 0.8, c: C(0.4), anchor: 'libre', underWindow: true, roles: [...SEJOURS, ...CHAMBRES, 'bureau'], provides: ['assise_salon'], seats: 1, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'table_basse_70', label: 'Table basse 70 × 50', category: 'table_basse', w: 0.7, d: 0.5, h: 0.4, c: C(0.4), anchor: 'libre', underWindow: true, roles: SEJOURS, provides: [], gammes: ECO_STD, src: SRC_FAB }),
  spec({ id: 'table_basse_100', label: 'Table basse 100 × 55', category: 'table_basse', w: 1.0, d: 0.55, h: 0.4, c: C(0.4), anchor: 'libre', underWindow: true, roles: SEJOURS, provides: [], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'table_basse_120', label: 'Table basse 120 × 60', category: 'table_basse', w: 1.2, d: 0.6, h: 0.38, c: C(0.4), anchor: 'libre', underWindow: true, roles: SEJOURS, provides: [], gammes: STD_PREM, src: SRC_FAB }),
  spec({ id: 'table_basse_ronde_80', label: 'Table basse ronde Ø 80', category: 'table_basse', w: 0.8, d: 0.8, h: 0.4, c: C(0.4), anchor: 'libre', underWindow: true, roles: SEJOURS, provides: [], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'meuble_tv_120', label: 'Meuble TV 120 cm', category: 'meuble_tv', w: 1.2, d: 0.4, h: 0.5, c: C(0.6), anchor: 'mur_dos', underWindow: true, roles: [...SEJOURS, ...CHAMBRES], provides: ['tv', 'rangement_general'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'meuble_tv_160', label: 'Meuble TV 160 cm', category: 'meuble_tv', w: 1.6, d: 0.42, h: 0.5, c: C(0.6), anchor: 'mur_dos', underWindow: true, roles: SEJOURS, provides: ['tv', 'rangement_general'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'meuble_tv_200', label: 'Meuble TV 200 cm', category: 'meuble_tv', w: 2.0, d: 0.45, h: 0.5, c: C(0.6), anchor: 'mur_dos', underWindow: true, roles: SEJOURS, provides: ['tv', 'rangement_general'], gammes: STD_PREM, src: SRC_FAB }),

  // ───────── Repas ─────────
  spec({ id: 'table_2_couverts', label: 'Table 2 couverts 70 × 70', category: 'table_repas', w: 0.7, d: 0.7, h: 0.75, c: TABLE, anchor: 'libre', underWindow: true, roles: REPAS_ROLES, provides: ['repas'], seats: 2, gammes: ALL, src: SRC_PRO }),
  spec({ id: 'table_4_couverts', label: 'Table 4 couverts 120 × 80', category: 'table_repas', w: 1.2, d: 0.8, h: 0.75, c: TABLE, anchor: 'libre', underWindow: true, roles: REPAS_ROLES, provides: ['repas'], seats: 4, gammes: ALL, src: SRC_PRO }),
  spec({ id: 'table_6_couverts', label: 'Table 6 couverts 160 × 90', category: 'table_repas', w: 1.6, d: 0.9, h: 0.75, c: TABLE, anchor: 'libre', underWindow: true, roles: REPAS_ROLES, provides: ['repas'], seats: 6, gammes: ALL, src: SRC_PRO }),
  spec({ id: 'table_8_couverts', label: 'Table 8 couverts 200 × 100', category: 'table_repas', w: 2.0, d: 1.0, h: 0.75, c: C(0.75, 0.75, 0.75, 0.75), anchor: 'libre', underWindow: true, roles: REPAS_ROLES, provides: ['repas'], seats: 8, gammes: STD_PREM, src: SRC_PRO }),
  spec({ id: 'table_ronde_4', label: 'Table ronde 4 couverts Ø 110', category: 'table_repas', w: 1.1, d: 1.1, h: 0.75, c: C(0.75, 0.75, 0.75, 0.75), anchor: 'centre_piece', underWindow: true, roles: REPAS_ROLES, provides: ['repas'], seats: 4, gammes: ALL, src: SRC_PRO }),
  spec({ id: 'table_exterieur_2', label: 'Table de balcon 2 couverts 70 × 70', category: 'table_repas', w: 0.7, d: 0.7, h: 0.72, c: TABLE, anchor: 'libre', underWindow: true, roles: ['exterieur'], provides: ['repas'], seats: 2, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'chaise_repas', label: 'Chaise de repas', category: 'chaise', w: 0.45, d: 0.5, h: 0.85, c: C(0, 0.3), anchor: 'libre', underWindow: true, roles: REPAS_ROLES, provides: [], gammes: ALL, src: SRC_PRO }),
  spec({ id: 'tabouret_haut', label: 'Tabouret haut (îlot / snack)', category: 'chaise', w: 0.4, d: 0.4, h: 0.75, c: C(0, 0.3), anchor: 'libre', underWindow: true, roles: CUISINES, provides: [], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'chaise_exterieur', label: 'Chaise de balcon', category: 'chaise', w: 0.5, d: 0.55, h: 0.85, c: C(0, 0.3), anchor: 'libre', underWindow: true, roles: ['exterieur'], provides: [], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'banc_repas_140', label: 'Banc de table 140 cm', category: 'banc', w: 1.4, d: 0.38, h: 0.45, c: C(0, 0.3), anchor: 'libre', underWindow: true, roles: REPAS_ROLES, provides: [], seats: 3, gammes: ALL, src: SRC_FAB }),

  // ───────── Travail / rangement général ─────────
  spec({ id: 'bureau_080', label: 'Bureau compact 80 × 50', category: 'bureau', w: 0.8, d: 0.5, h: 0.75, c: C(0.8), anchor: 'mur_dos', underWindow: true, roles: ['bureau', ...CHAMBRES, ...SEJOURS], provides: ['travail'], gammes: ECO_STD, src: SRC_FAB }),
  spec({ id: 'bureau_100', label: 'Bureau 100 × 60', category: 'bureau', w: 1.0, d: 0.6, h: 0.75, c: C(0.8), anchor: 'mur_dos', underWindow: true, roles: ['bureau', ...CHAMBRES, ...SEJOURS], provides: ['travail'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'bureau_120', label: 'Bureau 120 × 60', category: 'bureau', w: 1.2, d: 0.6, h: 0.75, c: C(0.8), anchor: 'mur_dos', underWindow: true, roles: ['bureau', ...CHAMBRES, ...SEJOURS], provides: ['travail'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'bureau_140', label: 'Bureau 140 × 70', category: 'bureau', w: 1.4, d: 0.7, h: 0.75, c: C(0.8), anchor: 'mur_dos', underWindow: true, roles: ['bureau', ...CHAMBRES], provides: ['travail'], gammes: STD_PREM, src: SRC_FAB }),
  spec({ id: 'chaise_bureau_standard', label: 'Chaise de bureau à roulettes', category: 'chaise_bureau', w: 0.6, d: 0.6, h: 1.0, c: C(0, 0.3), anchor: 'libre', underWindow: true, roles: ['bureau', ...CHAMBRES, ...SEJOURS], provides: [], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'chaise_bureau_compacte', label: 'Chaise de bureau compacte', category: 'chaise_bureau', w: 0.5, d: 0.5, h: 0.9, c: C(0, 0.3), anchor: 'libre', underWindow: true, roles: ['bureau', ...CHAMBRES, ...SEJOURS], provides: [], gammes: ECO_STD, src: SRC_FAB }),
  spec({ id: 'bibliotheque_80', label: 'Bibliothèque 80 × 35 × 180', category: 'bibliotheque', w: 0.8, d: 0.35, h: 1.8, c: C(0.6), anchor: 'mur_dos', underWindow: false, roles: [...SEJOURS, ...CHAMBRES, 'bureau', 'entree', 'degagement'], provides: ['rangement_general', 'decoration'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'bibliotheque_120', label: 'Bibliothèque 120 × 35 × 200', category: 'bibliotheque', w: 1.2, d: 0.35, h: 2.0, c: C(0.6), anchor: 'mur_dos', underWindow: false, roles: [...SEJOURS, ...CHAMBRES, 'bureau'], provides: ['rangement_general', 'decoration'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'etagere_basse_160', label: 'Étagère basse 160 × 35 × 80', category: 'bibliotheque', w: 1.6, d: 0.35, h: 0.8, c: C(0.6), anchor: 'mur_dos', underWindow: true, roles: [...SEJOURS, ...CHAMBRES, 'bureau'], provides: ['rangement_general', 'decoration'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'etagere_rangement_90', label: 'Étagère de rangement 90 × 45 × 180', category: 'bibliotheque', w: 0.9, d: 0.45, h: 1.8, c: C(0.6), anchor: 'mur_dos', underWindow: false, roles: ['cellier', 'buanderie', 'degagement', 'dressing'], provides: ['rangement_general'], gammes: ALL, src: SRC_FAB }),

  // ───────── Cuisine ─────────
  spec({ id: 'kitchenette_120', label: 'Kitchenette 120 cm (évier, 2 feux, réfrigérateur sous plan)', category: 'cuisine_lineaire', w: 1.2, d: 0.6, h: 0.9, c: C(0.9), anchor: 'mur_dos', underWindow: true, roles: CUISINES, provides: ['evier', 'cuisson', 'froid', 'plan_de_travail', 'rangement_cuisine'], water: true, gammes: ECO_STD, src: SRC_FAB }),
  spec({ id: 'cuisine_180', label: 'Cuisine linéaire 1,80 m (évier, plaque, rangements bas)', category: 'cuisine_lineaire', w: 1.8, d: 0.6, h: 0.9, c: C(0.9), anchor: 'mur_dos', underWindow: true, roles: CUISINES, provides: ['evier', 'cuisson', 'plan_de_travail', 'rangement_cuisine'], water: true, gammes: ALL, src: SRC_PRO }),
  spec({ id: 'cuisine_240', label: 'Cuisine linéaire 2,40 m (dont lave-vaisselle 60 intégré)', category: 'cuisine_lineaire', w: 2.4, d: 0.6, h: 0.9, c: C(0.9), anchor: 'mur_dos', underWindow: true, roles: CUISINES, provides: ['evier', 'cuisson', 'plan_de_travail', 'rangement_cuisine', 'lavage_vaisselle'], water: true, gammes: ALL, src: SRC_PRO }),
  spec({ id: 'cuisine_300', label: 'Cuisine linéaire 3,00 m (dont lave-vaisselle 60 intégré)', category: 'cuisine_lineaire', w: 3.0, d: 0.6, h: 0.9, c: C(0.9), anchor: 'mur_dos', underWindow: true, roles: CUISINES, provides: ['evier', 'cuisson', 'plan_de_travail', 'rangement_cuisine', 'lavage_vaisselle'], water: true, gammes: ALL, src: SRC_PRO }),
  spec({ id: 'cuisine_360', label: 'Cuisine linéaire 3,60 m (dont lave-vaisselle 60 intégré)', category: 'cuisine_lineaire', w: 3.6, d: 0.6, h: 0.9, c: C(0.9), anchor: 'mur_dos', underWindow: true, roles: CUISINES, provides: ['evier', 'cuisson', 'plan_de_travail', 'rangement_cuisine', 'lavage_vaisselle'], water: true, gammes: STD_PREM, src: SRC_PRO }),
  spec({ id: 'ilot_120', label: 'Îlot central 120 × 80', category: 'ilot', w: 1.2, d: 0.8, h: 0.9, c: C(0.9, 0.9, 0.6, 0.6), anchor: 'centre_piece', underWindow: true, roles: CUISINES, provides: ['plan_de_travail', 'rangement_cuisine'], gammes: STD_PREM, src: SRC_FAB }),
  spec({ id: 'ilot_180_snack', label: 'Îlot 180 × 90 avec coin snack (2 tabourets)', category: 'ilot', w: 1.8, d: 0.9, h: 0.9, c: C(0.9, 0.9, 0.6, 0.6), anchor: 'centre_piece', underWindow: true, roles: CUISINES, provides: ['plan_de_travail', 'rangement_cuisine', 'repas'], seats: 2, gammes: STD_PREM, src: SRC_FAB }),
  spec({ id: 'ilot_evier_200', label: 'Îlot 200 × 95 avec évier', category: 'ilot', w: 2.0, d: 0.95, h: 0.9, c: C(0.9, 0.9, 0.6, 0.6), anchor: 'centre_piece', underWindow: true, roles: CUISINES, provides: ['plan_de_travail', 'rangement_cuisine', 'evier'], water: true, gammes: PREM, src: SRC_FAB }),
  spec({ id: 'frigo_table_top', label: 'Réfrigérateur table top 55 cm', category: 'refrigerateur', w: 0.55, d: 0.58, h: 0.85, c: C(0.9), anchor: 'mur_dos', underWindow: true, roles: [...CUISINES, 'cellier'], provides: ['froid'], gammes: ECO_STD, src: SRC_FAB }),
  spec({ id: 'frigo_combine_60', label: 'Réfrigérateur combiné 60 cm', category: 'refrigerateur', w: 0.6, d: 0.65, h: 1.85, c: C(0.9), anchor: 'mur_dos', underWindow: false, roles: [...CUISINES, 'cellier'], provides: ['froid'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'frigo_americain', label: 'Réfrigérateur américain 91 cm', category: 'refrigerateur', w: 0.91, d: 0.72, h: 1.78, c: C(1.0), anchor: 'mur_dos', underWindow: false, roles: [...CUISINES, 'cellier'], provides: ['froid'], gammes: PREM, src: SRC_FAB }),
  spec({ id: 'lv_60', label: 'Lave-vaisselle 60 cm', category: 'lave_vaisselle', w: 0.6, d: 0.6, h: 0.85, c: C(0.9), anchor: 'mur_dos', underWindow: true, roles: CUISINES, provides: ['lavage_vaisselle'], water: true, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'lv_45', label: 'Lave-vaisselle 45 cm', category: 'lave_vaisselle', w: 0.45, d: 0.6, h: 0.85, c: C(0.9), anchor: 'mur_dos', underWindow: true, roles: CUISINES, provides: ['lavage_vaisselle'], water: true, gammes: ALL, src: SRC_FAB }),

  // ───────── Linge ─────────
  spec({ id: 'll_frontal_60', label: 'Lave-linge frontal 60 cm', category: 'lave_linge', w: 0.6, d: 0.6, h: 0.85, c: C(0.9), anchor: 'mur_dos', underWindow: true, roles: [...BAINS, 'buanderie', 'cellier', 'wc', ...CUISINES], provides: ['lavage_linge'], water: true, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'll_top_40', label: 'Lave-linge top 40 cm', category: 'lave_linge', w: 0.4, d: 0.6, h: 0.85, c: C(0.6), anchor: 'mur_dos', underWindow: true, roles: [...BAINS, 'buanderie', 'cellier', 'wc', ...CUISINES], provides: ['lavage_linge'], water: true, gammes: ECO_STD, src: SRC_FAB }),
  spec({ id: 'colonne_ll_sl', label: 'Colonne lave-linge + sèche-linge 60 cm', category: 'lave_linge', w: 0.6, d: 0.65, h: 1.75, c: C(0.9), anchor: 'mur_dos', underWindow: false, roles: [...BAINS, 'buanderie', 'cellier'], provides: ['lavage_linge'], water: true, gammes: STD_PREM, src: SRC_FAB }),

  // ───────── Salle de bains / salle d'eau / WC ─────────
  spec({ id: 'vasque_60', label: 'Meuble vasque 60 cm', category: 'meuble_vasque', w: 0.6, d: 0.46, h: 0.85, c: C(0.7), anchor: 'mur_dos', underWindow: true, roles: BAINS, provides: ['lavabo'], water: true, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'vasque_80', label: 'Meuble vasque 80 cm', category: 'meuble_vasque', w: 0.8, d: 0.46, h: 0.85, c: C(0.7), anchor: 'mur_dos', underWindow: true, roles: BAINS, provides: ['lavabo'], water: true, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'vasque_double_120', label: 'Meuble double vasque 120 cm', category: 'meuble_vasque', w: 1.2, d: 0.46, h: 0.85, c: C(0.7), anchor: 'mur_dos', underWindow: true, roles: BAINS, provides: ['lavabo'], water: true, gammes: STD_PREM, src: SRC_FAB }),
  spec({ id: 'vasque_double_140', label: 'Meuble double vasque 140 cm', category: 'meuble_vasque', w: 1.4, d: 0.5, h: 0.85, c: C(0.7), anchor: 'mur_dos', underWindow: true, roles: BAINS, provides: ['lavabo'], water: true, gammes: PREM, src: SRC_FAB }),
  spec({ id: 'douche_70x90', label: 'Douche 70 × 90', category: 'douche', w: 0.9, d: 0.7, h: 2.0, c: C(0.7), anchor: 'angle', underWindow: false, roles: BAINS, provides: ['douche'], water: true, gammes: ECO_STD, src: SRC_FAB }),
  spec({ id: 'douche_80x80', label: 'Douche 80 × 80', category: 'douche', w: 0.8, d: 0.8, h: 2.0, c: C(0.7), anchor: 'angle', underWindow: false, roles: BAINS, provides: ['douche'], water: true, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'douche_90x90', label: 'Douche 90 × 90', category: 'douche', w: 0.9, d: 0.9, h: 2.0, c: C(0.7), anchor: 'angle', underWindow: false, roles: BAINS, provides: ['douche'], water: true, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'douche_90x120', label: 'Douche extra-plate 90 × 120 (zone de douche accessible)', category: 'douche', w: 1.2, d: 0.9, h: 2.0, c: C(0.9), anchor: 'mur_dos', underWindow: false, roles: BAINS, provides: ['douche'], water: true, gammes: ALL, src: SRC_ARR }),
  spec({ id: 'douche_italienne_140x90', label: "Douche à l'italienne 140 × 90", category: 'douche', w: 1.4, d: 0.9, h: 2.0, c: C(0.9), anchor: 'mur_dos', underWindow: false, roles: BAINS, provides: ['douche'], water: true, gammes: STD_PREM, src: SRC_FAB }),
  spec({ id: 'baignoire_160x70', label: 'Baignoire 160 × 70', category: 'baignoire', w: 1.6, d: 0.7, h: 0.55, c: C(0.7), anchor: 'mur_dos', underWindow: true, roles: ['salle_de_bain'], provides: ['bain'], water: true, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'baignoire_170x70', label: 'Baignoire 170 × 70', category: 'baignoire', w: 1.7, d: 0.7, h: 0.55, c: C(0.7), anchor: 'mur_dos', underWindow: true, roles: ['salle_de_bain'], provides: ['bain'], water: true, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'baignoire_180x80', label: 'Baignoire 180 × 80', category: 'baignoire', w: 1.8, d: 0.8, h: 0.58, c: C(0.7), anchor: 'mur_dos', underWindow: true, roles: ['salle_de_bain'], provides: ['bain'], water: true, gammes: PREM, src: SRC_FAB }),
  spec({ id: 'wc_suspendu', label: 'WC suspendu (cuvette, bâti-support dans le coffrage)', category: 'wc', w: 0.36, d: 0.54, h: 0.4, c: C(0.6, 0, 0.2, 0.2), anchor: 'mur_dos', underWindow: true, roles: ['wc', ...BAINS], provides: ['toilette'], water: true, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'wc_pose', label: 'WC posé avec réservoir attenant', category: 'wc', w: 0.37, d: 0.68, h: 0.78, c: C(0.6, 0, 0.2, 0.2), anchor: 'mur_dos', underWindow: true, roles: ['wc', ...BAINS], provides: ['toilette'], water: true, gammes: ECO_STD, src: SRC_FAB }),
  spec({ id: 'wc_pmr_espace_gauche', label: 'WC suspendu avec espace latéral 0,80 m à gauche', category: 'wc', w: 0.36, d: 0.54, h: 0.4, c: C(0.6, 0, 0.8, 0.2), anchor: 'mur_dos', underWindow: true, roles: ['wc', ...BAINS], provides: ['toilette'], water: true, gammes: ALL, src: 'dimensions types fabricant ; espace latéral 0,80 × 1,30 m (arrêté du 24 décembre 2015, art. 13)' }),
  spec({ id: 'wc_pmr_espace_droite', label: 'WC suspendu avec espace latéral 0,80 m à droite', category: 'wc', w: 0.36, d: 0.54, h: 0.4, c: C(0.6, 0, 0.2, 0.8), anchor: 'mur_dos', underWindow: true, roles: ['wc', ...BAINS], provides: ['toilette'], water: true, gammes: ALL, src: 'dimensions types fabricant ; espace latéral 0,80 × 1,30 m (arrêté du 24 décembre 2015, art. 13)' }),
  spec({ id: 'lave_mains_40', label: 'Lave-mains 40 × 22', category: 'lave_mains', w: 0.4, d: 0.22, h: 0.85, c: C(0.5), anchor: 'mur_dos', underWindow: true, roles: ['wc', ...BAINS], provides: ['lavabo'], water: true, gammes: ALL, src: SRC_FAB }),
  spec({ id: 'lave_mains_angle', label: "Lave-mains d'angle 30 × 30", category: 'lave_mains', w: 0.3, d: 0.3, h: 0.85, c: C(0.5), anchor: 'angle', underWindow: true, roles: ['wc', ...BAINS], provides: ['lavabo'], water: true, gammes: ECO_STD, src: SRC_FAB }),

  // ───────── Entrée ─────────
  spec({ id: 'vestiaire_100', label: 'Meuble vestiaire 100 cm', category: 'meuble_entree', w: 1.0, d: 0.4, h: 1.9, c: C(0.7), anchor: 'mur_dos', underWindow: false, roles: ['entree', 'degagement'], provides: ['rangement_entree'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'meuble_chaussures_80', label: 'Meuble à chaussures 80 cm (faible profondeur)', category: 'meuble_entree', w: 0.8, d: 0.3, h: 1.0, c: C(0.5), anchor: 'mur_dos', underWindow: true, roles: ['entree', 'degagement'], provides: ['rangement_entree'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'console_90', label: "Console d'entrée 90 × 30", category: 'meuble_entree', w: 0.9, d: 0.3, h: 0.8, c: C(0.5), anchor: 'mur_dos', underWindow: true, roles: ['entree', 'degagement', 'sejour'], provides: ['rangement_entree', 'decoration'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'banc_entree_100', label: "Banc d'entrée à chaussures 100 cm", category: 'banc', w: 1.0, d: 0.35, h: 0.45, c: C(0.6), anchor: 'mur_dos', underWindow: true, roles: ['entree'], provides: ['rangement_entree'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'banc_pied_de_lit', label: 'Banc de pied de lit 120 cm', category: 'banc', w: 1.2, d: 0.4, h: 0.45, c: C(0.4), anchor: 'libre', underWindow: true, roles: CHAMBRES, provides: ['decoration'], gammes: STD_PREM, src: SRC_FAB }),

  // ───────── Décoration / éclairage ─────────
  spec({ id: 'tapis_entree_60x90', label: "Tapis d'entrée 60 × 90", category: 'tapis', w: 0.9, d: 0.6, h: 0.01, c: C(0), anchor: 'libre', underWindow: true, roles: ['entree'], provides: ['decoration'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'tapis_120x170', label: 'Tapis 120 × 170', category: 'tapis', w: 1.7, d: 1.2, h: 0.01, c: C(0), anchor: 'centre_piece', underWindow: true, roles: [...SEJOURS, ...CHAMBRES, 'bureau'], provides: ['decoration'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'tapis_160x230', label: 'Tapis 160 × 230', category: 'tapis', w: 2.3, d: 1.6, h: 0.01, c: C(0), anchor: 'centre_piece', underWindow: true, roles: [...SEJOURS, ...CHAMBRES], provides: ['decoration'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'tapis_200x290', label: 'Tapis 200 × 290', category: 'tapis', w: 2.9, d: 2.0, h: 0.01, c: C(0), anchor: 'centre_piece', underWindow: true, roles: SEJOURS, provides: ['decoration'], gammes: STD_PREM, src: SRC_FAB }),
  spec({ id: 'tapis_rond_160', label: 'Tapis rond Ø 160', category: 'tapis', w: 1.6, d: 1.6, h: 0.01, c: C(0), anchor: 'centre_piece', underWindow: true, roles: [...SEJOURS, ...CHAMBRES], provides: ['decoration'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'lampadaire', label: 'Lampadaire', category: 'luminaire_sol', w: 0.35, d: 0.35, h: 1.7, c: C(0), anchor: 'libre', underWindow: false, roles: [...SEJOURS, ...CHAMBRES, 'bureau', 'entree'], provides: ['eclairage_appoint'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'liseuse', label: 'Lampadaire liseuse', category: 'luminaire_sol', w: 0.3, d: 0.3, h: 1.4, c: C(0), anchor: 'libre', underWindow: false, roles: [...SEJOURS, ...CHAMBRES, 'bureau'], provides: ['eclairage_appoint'], gammes: ALL, src: SRC_FAB }),
  spec({ id: 'plante_grande', label: "Plante d'intérieur grande (pot Ø 45)", category: 'plante', w: 0.45, d: 0.45, h: 1.4, c: C(0), anchor: 'libre', underWindow: false, roles: [...SEJOURS, ...CHAMBRES, 'bureau', 'entree', 'exterieur'], provides: ['decoration'], gammes: ALL, src: SRC_HYP }),
  spec({ id: 'plante_moyenne', label: "Plante d'intérieur moyenne (pot Ø 30)", category: 'plante', w: 0.3, d: 0.3, h: 0.7, c: C(0), anchor: 'libre', underWindow: true, roles: [...SEJOURS, ...CHAMBRES, 'bureau', 'entree', 'exterieur', 'salle_de_bain'], provides: ['decoration'], gammes: ALL, src: SRC_HYP }),
];

/**
 * Chaînes de repli (de la plus grande à la plus petite variante, même catégorie).
 * Le programme peut proposer comme `fallbacks` les éléments qui suivent une spec dans sa chaîne.
 */
export const FALLBACK_CHAINS: string[][] = [
  ['lit_180x200', 'lit_160x200', 'lit_140x200', 'lit_140x190'],
  ['lit_120x190', 'lit_90x200', 'lit_90x190'],
  ['canape_angle', 'canape_3p', 'canape_2p', 'canape_compact_2p'],
  ['fauteuil_standard', 'fauteuil_compact'],
  ['table_basse_120', 'table_basse_100', 'table_basse_70'],
  ['meuble_tv_200', 'meuble_tv_160', 'meuble_tv_120'],
  ['table_8_couverts', 'table_6_couverts', 'table_4_couverts', 'table_2_couverts'],
  ['cuisine_360', 'cuisine_300', 'cuisine_240', 'cuisine_180', 'kitchenette_120'],
  ['ilot_evier_200', 'ilot_180_snack', 'ilot_120'],
  ['frigo_americain', 'frigo_combine_60', 'frigo_table_top'],
  ['lv_60', 'lv_45'],
  ['ll_frontal_60', 'll_top_40'],
  ['douche_italienne_140x90', 'douche_90x120', 'douche_90x90', 'douche_80x80', 'douche_70x90'],
  ['baignoire_180x80', 'baignoire_170x70', 'baignoire_160x70'],
  ['vasque_double_140', 'vasque_double_120', 'vasque_80', 'vasque_60'],
  ['armoire_3p', 'armoire_2p', 'armoire_1p'],
  ['armoire_coulissante_200', 'armoire_coulissante_160'],
  ['dressing_ouvert_240', 'dressing_ouvert_200', 'dressing_ouvert_120'],
  ['commode_120', 'commode_80'],
  ['bureau_140', 'bureau_120', 'bureau_100', 'bureau_080'],
  ['bibliotheque_120', 'bibliotheque_80'],
  ['tapis_200x290', 'tapis_160x230', 'tapis_120x170'],
  ['vestiaire_100', 'meuble_chaussures_80'],
];

const BY_ID = new Map(CATALOG.map((s) => [s.id, s]));

/** Spec par id (undefined si inconnue). */
export function getSpec(id: string): FurnitureSpec | undefined {
  return BY_ID.get(id);
}

/** Specs fournissant une fonction, éventuellement restreintes à un rôle de pièce (ordre du catalogue, déterministe). */
export function specsProviding(fn: UsageFunction, role?: RoomRole): FurnitureSpec[] {
  return CATALOG.filter((s) => s.provides.includes(fn) && (role === undefined || s.allowedRoles.includes(role)));
}

/** Replis possibles d'une spec (variantes plus petites de sa chaîne), du plus proche au plus éloigné. */
export function fallbacksFor(id: string): string[] {
  for (const chain of FALLBACK_CHAINS) {
    const i = chain.indexOf(id);
    if (i >= 0) return chain.slice(i + 1);
  }
  return [];
}
