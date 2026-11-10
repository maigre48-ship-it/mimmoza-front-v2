/**
 * LOT INT-01 — Base de règles v1 (aménagement intérieur, logement neuf de promoteur).
 *
 * - L'agent ne déplace pas les cloisons : les règles portent sur le mobilier placé (LayoutPlan) dans un plan figé.
 * - `check.kind` ∈ CHECK_KINDS (src/data/schemas.ts) ; sémantique exacte dans src/data/CHECKS.md.
 * - Sources : `toVerify:false` UNIQUEMENT si la valeur a été lue sur le texte officiel (Légifrance) ;
 *   la NF C 15-100 (norme AFNOR payante) n'est jamais reproduite : exigences reformulées, toVerify:true.
 *
 * Champ d'application de l'arrêté du 24 décembre 2015 (lu sur Légifrance, version consolidée) :
 * - art. 11 : « Tous les logements » (circulations intérieures, portes, commandes, prises).
 * - art. 13 : logements situés au rez-de-chaussée ou en étages desservis par ascenseur (unité de vie).
 * - maisons individuelles : concernées si construites pour être louées, mises à disposition ou vendues ;
 *   exclues si le propriétaire construit pour son propre usage (CCH ancien art. R.111-18-4, version 2019-2021,
 *   abrogé par le décret n° 2021-872 — numéro actuel après recodification NON vérifié ; l'art. 15 de l'arrêté
 *   reprend la même exclusion). Cible Mimmoza (promoteur, vente) => maisons concernées.
 * - En collectif, tous les logements desservis ne sont pas livrés « accessibles » (logements évolutifs, art. 16) ;
 *   le plan ne dit pas lequel l'est : les règles art. 13 sur appartement ne s'appliquent que si le brief indique pmr.
 */
import type { Rule, RuleApplicability, RuleFamily, RuleNature, RuleSource, RuleCheck, FurnitureCategory, RoomRole } from '../types';

const ARRETE_2015 = 'Arrêté du 24 décembre 2015 relatif à l\'accessibilité aux personnes handicapées des bâtiments d\'habitation collectifs et des maisons individuelles lors de leur construction';
const ARRETE_2015_URL = 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000031692481';
const ARRETE_2015_ART11_URL = 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000031830907';
const NFC15100 = 'NF C 15-100 (norme AFNOR, partie relative aux locaux d\'habitation — numéro de section non vérifié)';
const LEGRAND_PRISES_URL = 'https://www.legrand.fr/questions-frequentes/combien-de-prises-de-courant-doit-on-installer-dans-chaque-piece';
const BAREME = 'barème Mimmoza 2026 (hypothèse)';
const REGLE_ART = 'Règle de l\'art (usage professionnel des architectes d\'intérieur)';

const officiel = (article: string, url = ARRETE_2015_URL): RuleSource => ({ reference: `${ARRETE_2015}, ${article}`, url, toVerify: false });
const usagePro = (precision?: string): RuleSource => ({ reference: precision ? `${REGLE_ART} — ${precision}` : REGLE_ART, toVerify: true });
const hypothese = (precision?: string): RuleSource => ({ reference: precision ? `${BAREME} — ${precision}` : BAREME, toVerify: true });

const NEUF_TOUS: RuleApplicability = { construction: ['neuf'], kind: ['appartement', 'maison'], pmr: 'toujours' };
const TOUS: RuleApplicability = { construction: ['neuf', 'existant'], kind: ['appartement', 'maison'], pmr: 'toujours' };
/** Art. 13, lecture réglementaire : maison neuve vendue/louée (niveau d'accès = unité de vie). */
const ART13_MAISON: RuleApplicability = { construction: ['neuf'], kind: ['maison'], pmr: 'toujours' };
/** Art. 13, usage réel meublé : occupant PMR déclaré dans le brief (appartement ou maison). */
const ART13_PMR: RuleApplicability = { construction: ['neuf', 'existant'], kind: ['appartement', 'maison'], pmr: 'si_pmr' };

const CHAMBRES = ['chambre', 'chambre_parentale'] as const;
/** INT-07 — équipements techniques hors palette décorative (STY-01, STY-04). */
const ELECTROMENAGER: FurnitureCategory[] = ['refrigerateur', 'lave_vaisselle', 'lave_linge'];
const EQUIPEMENTS_TECHNIQUES: FurnitureCategory[] = ['wc', 'douche', 'baignoire', 'lave_mains', ...ELECTROMENAGER];
const SEJOURS = ['sejour', 'sejour_cuisine'] as const;
const CUISINES = ['cuisine', 'sejour_cuisine'] as const;
const BAINS = ['salle_de_bain', 'salle_d_eau'] as const;
const PIECES_PRINCIPALES = ['sejour', 'sejour_cuisine', 'cuisine', 'chambre', 'chambre_parentale', 'bureau'] as const;

/** Mobilier déplaçable par l'occupant : ignoré pour la lecture réglementaire (plan livré) des exigences art. 13. */
const MOBILIER_MOBILE: FurnitureCategory[] = [
  'chevet', 'armoire', 'commode', 'canape', 'fauteuil', 'table_basse', 'meuble_tv', 'table_repas', 'chaise',
  'bureau', 'chaise_bureau', 'bibliotheque', 'meuble_entree', 'banc', 'tapis', 'luminaire_sol', 'plante', 'dressing',
];
const MOBILIER_MOBILE_SAUF_LIT = MOBILIER_MOBILE; // le lit n'y figure pas : il reste un obstacle
const CUISINE_FIXE: FurnitureCategory[] = ['cuisine_lineaire', 'ilot', 'refrigerateur', 'lave_vaisselle'];
/** Satellites : utilisés depuis leur meuble parent (lit, table, bureau) — obstacles mais pas cibles de passage (INT-05b). */
const SATELLITES: FurnitureCategory[] = ['chevet', 'chaise', 'chaise_bureau'];

interface R {
  id: string; family: RuleFamily; nature: RuleNature; title: string; source: RuleSource;
  applicability: RuleApplicability; weight: number; check: RuleCheck; requirement: string; interpretation: string;
  /** Version de la règle (1 par défaut ; incrémentée à chaque recalibrage). */
  version?: number;
}
const BLOQUANTES: RuleFamily[] = ['usage', 'circulation', 'technique'];
const rule = (r: R): Rule => ({ ...r, version: r.version ?? 1, severity: BLOQUANTES.includes(r.family) ? 'bloquante' : 'degradante' });
const roles = (...groups: ReadonlyArray<readonly RoomRole[]>): RoomRole[] => groups.flat();

export const RULES: Rule[] = [
  // ═════════════════════════ CIRCULATION (bloquante) ═════════════════════════
  rule({
    id: 'CIR-01', family: 'circulation', nature: 'norme',
    title: 'Circulations intérieures du logement : largeur libre ≥ 0,90 m',
    source: officiel('art. 11, II, 1°', ARRETE_2015_ART11_URL),
    applicability: { ...NEUF_TOUS, roles: ['entree', 'degagement'] }, weight: 1,
    check: { kind: 'passage_min', params: { minWidth: 0.9, targets: 'portes', ignoreCategories: ['tapis'] } },
    requirement: 'Dans tous les logements neufs, les circulations intérieures ont une largeur minimale de 0,90 m.',
    interpretation: 'Le mobilier placé dans l\'entrée et les dégagements ne doit pas réduire la largeur libre sous 0,90 m entre les portes de la pièce.',
  }),
  rule({
    id: 'CIR-02', family: 'circulation', nature: 'usage_professionnel',
    title: 'Passage ≥ 0,70 m vers les portes et les zones d\'usage des meubles',
    source: usagePro('passage minimal courant entre meubles'),
    applicability: { ...TOUS, roles: roles(PIECES_PRINCIPALES) }, weight: 0.8,
    check: { kind: 'passage_min', params: { minWidth: 0.7, targets: 'portes_et_usages', ignoreCategories: ['tapis'], satelliteCategories: SATELLITES } },
    requirement: 'Chaque porte de la pièce et la zone d\'usage avant de chaque meuble sont reliées par un passage libre d\'au moins 0,70 m.',
    interpretation: 'Seuil minimal d\'usage hors PMR ; le confort (0,90 m) est contrôlé par ORG-08. Les satellites (chevets, chaises) s\'utilisent depuis leur meuble parent (lit, table, bureau) : ils restent des obstacles mais ne sont pas des cibles (INT-05b, CHECKS.md D18).',
  }),
  rule({
    id: 'CIR-03', family: 'circulation', nature: 'usage_professionnel',
    title: 'Débattement des portes libre de tout meuble',
    source: usagePro('une porte doit pouvoir s\'ouvrir complètement'),
    applicability: TOUS, weight: 1,
    check: { kind: 'debattement_libre', params: { ignoreCategories: ['tapis'], toleranceArea: 0.01 } },
    requirement: 'Aucun meuble n\'empiète sur la zone de débattement d\'un vantail de porte.',
    interpretation: 'Tolérance de 0,01 m² pour les arrondis ; les tapis sont ignorés.',
  }),
  rule({
    id: 'CIR-04a', family: 'circulation', nature: 'norme',
    title: 'Cuisine : passage ≥ 1,50 m entre équipements fixes et parois (maison neuve)',
    source: officiel('art. 13, II, 1°'),
    applicability: { ...ART13_MAISON, roles: roles(CUISINES) }, weight: 1,
    check: { kind: 'degagement_categorie', params: { categories: CUISINE_FIXE, minFront: 1.5, ignoreCategories: MOBILIER_MOBILE, swingCounts: true, swingTolerance: 0.25, scope: 'chaque_placement', uniteDeVie: true } },
    requirement: 'Dans la cuisine de l\'unité de vie, un passage d\'au moins 1,50 m est ménagé entre les appareils ménagers installés ou prévus, les meubles fixes et les parois, hors débattement de porte.',
    interpretation: 'Lecture réglementaire du plan livré : seuls les équipements de cuisine (fixes) et les parois comptent ; le mobilier mobile (table, chaises) est ignoré. Le texte tolère un léger empiètement sur le débattement (0,25 m retenu) et sous l\'évier (non modélisé : contrôle plus sévère).',
  }),
  rule({
    id: 'CIR-04b', family: 'circulation', nature: 'norme',
    title: 'Cuisine meublée : passage ≥ 1,50 m (occupant PMR)',
    source: officiel('art. 13, II, 1°'),
    applicability: { ...ART13_PMR, roles: roles(CUISINES) }, weight: 1,
    check: { kind: 'degagement_categorie', params: { categories: CUISINE_FIXE, minFront: 1.5, ignoreCategories: ['tapis'], swingCounts: true, swingTolerance: 0.25, scope: 'chaque_placement', uniteDeVie: true } },
    requirement: 'Même exigence que CIR-04a, vérifiée sur la cuisine meublée.',
    interpretation: 'Brief pmr : tout meuble placé (table, chaises comprises) compte comme obstacle, car l\'occupant en fauteuil doit réellement circuler.',
  }),
  rule({
    id: 'CIR-05a', family: 'circulation', nature: 'norme',
    title: 'Chambre : espace de manœuvre avec demi-tour Ø 1,50 m hors lit (maison neuve)',
    source: officiel('art. 13, II, 1° et annexe 2'),
    applicability: { ...ART13_MAISON, roles: roles(CHAMBRES) }, weight: 1,
    check: { kind: 'cercle_manoeuvre', params: { diameter: 1.5, scope: 'au_moins_une_piece', ignoreCategories: MOBILIER_MOBILE_SAUF_LIT, swingAllowed: false, includeSejourIfNoChambre: true, uniteDeVie: true } },
    requirement: 'Au moins une chambre de l\'unité de vie offre, en dehors de l\'emprise du lit, un espace de manœuvre avec possibilité de demi-tour (cercle de 1,50 m).',
    interpretation: 'Lecture réglementaire : seuls le lit et les parois sont des obstacles. Le cercle doit rester hors débattement de porte (lecture prudente). Studio : la pièce principale tient lieu de chambre.',
  }),
  rule({
    id: 'CIR-05b', family: 'circulation', nature: 'norme',
    title: 'Chambre meublée : cercle de demi-tour Ø 1,50 m (occupant PMR)',
    source: officiel('art. 13, II, 1° et annexe 2'),
    applicability: { ...ART13_PMR, roles: roles(CHAMBRES) }, weight: 1,
    check: { kind: 'cercle_manoeuvre', params: { diameter: 1.5, scope: 'au_moins_une_piece', ignoreCategories: ['tapis'], swingAllowed: false, includeSejourIfNoChambre: true, uniteDeVie: true } },
    requirement: 'Au moins une chambre meublée conserve un cercle libre de 1,50 m de diamètre.',
    interpretation: 'Brief pmr : tout le mobilier placé compte comme obstacle (hors tapis).',
  }),
  rule({
    id: 'CIR-06a', family: 'circulation', nature: 'norme',
    title: 'Salle d\'eau : espace de manœuvre avec demi-tour Ø 1,50 m (maison neuve)',
    source: officiel('art. 13, II, 1° et annexe 2'),
    applicability: { ...ART13_MAISON, roles: roles(BAINS) }, weight: 1,
    check: { kind: 'cercle_manoeuvre', params: { diameter: 1.5, scope: 'au_moins_une_piece', ignoreCategories: MOBILIER_MOBILE, swingAllowed: false, uniteDeVie: true } },
    requirement: 'Au moins une salle d\'eau de l\'unité de vie offre un espace de manœuvre avec possibilité de demi-tour (cercle de 1,50 m).',
    interpretation: 'Les appareils sanitaires et le lave-linge sont des obstacles ; le mobilier mobile est ignoré.',
  }),
  rule({
    id: 'CIR-06b', family: 'circulation', nature: 'norme',
    title: 'Salle d\'eau meublée : cercle de demi-tour Ø 1,50 m (occupant PMR)',
    source: officiel('art. 13, II, 1° et annexe 2'),
    applicability: { ...ART13_PMR, roles: roles(BAINS) }, weight: 1,
    check: { kind: 'cercle_manoeuvre', params: { diameter: 1.5, scope: 'au_moins_une_piece', ignoreCategories: ['tapis'], swingAllowed: false, uniteDeVie: true } },
    requirement: 'Au moins une salle d\'eau équipée et meublée conserve un cercle libre de 1,50 m.',
    interpretation: 'Brief pmr : tout meuble placé est un obstacle (hors tapis).',
  }),
  rule({
    id: 'CIR-07a', family: 'circulation', nature: 'norme',
    title: 'Chambre : passages 0,90 m sur les grands côtés et 1,20 m au pied du lit (ou l\'inverse) — maison neuve',
    source: officiel('art. 13, II, 1°'),
    applicability: { ...ART13_MAISON, roles: roles(CHAMBRES) }, weight: 1,
    check: { kind: 'degagement_categorie', params: { categories: ['lit'], minLeft: 0.9, minRight: 0.9, minFront: 1.2, altMinLeft: 1.2, altMinRight: 1.2, altMinFront: 0.9, lateralMode: 'tous', ignoreCategories: MOBILIER_MOBILE, swingCounts: false, scope: 'au_moins_un_logement', relaxOneSideIfSinglePiece: true, uniteDeVie: true } },
    requirement: 'Dans au moins une chambre, un passage d\'au moins 0,90 m le long des deux grands côtés du lit et de 1,20 m le long du petit côté libre (ou l\'inverse) ; un seul grand côté suffit dans un logement d\'une seule pièce principale.',
    interpretation: 'Mesuré autour du lit réellement placé (le texte raisonne sur un lit 1,40 × 1,90 m, ou 0,90 × 1,90 m pour une personne seule) : plus sévère si le lit est plus grand.',
  }),
  rule({
    id: 'CIR-07b', family: 'circulation', nature: 'norme',
    title: 'Chambre meublée : passages PMR autour du lit (occupant PMR)',
    source: officiel('art. 13, II, 1°'),
    applicability: { ...ART13_PMR, roles: roles(CHAMBRES) }, weight: 1,
    check: { kind: 'degagement_categorie', params: { categories: ['lit'], minLeft: 0.9, minRight: 0.9, minFront: 1.2, altMinLeft: 1.2, altMinRight: 1.2, altMinFront: 0.9, lateralMode: 'tous', ignoreCategories: ['tapis', 'chevet'], swingCounts: false, scope: 'au_moins_un_logement', relaxOneSideIfSinglePiece: true, uniteDeVie: true } },
    requirement: 'Même exigence que CIR-07a, vérifiée avec le mobilier placé.',
    interpretation: 'Les chevets (contre la tête de lit) sont tolérés ; tout autre meuble compte comme obstacle.',
  }),

  // ═════════════════════════ USAGE (bloquante) ═════════════════════════
  rule({
    id: 'USA-01', family: 'usage', nature: 'usage_professionnel',
    title: 'Emprise valide : meuble dans sa pièce, sans chevauchement, rôle autorisé',
    source: usagePro('cohérence géométrique élémentaire'),
    applicability: TOUS, weight: 1,
    check: { kind: 'emprise_valide', params: { overlapAllowedCategories: ['tapis'], overlapTolerance: 0.01, checkFixtures: true, checkAllowedRoles: true } },
    requirement: 'Chaque meuble est entièrement dans sa pièce, ne chevauche ni un autre meuble ni un équipement fixe, et son type est autorisé dans ce rôle de pièce.',
    interpretation: 'Seuls les tapis peuvent être recouverts ; tolérance 1 cm.',
  }),
  rule({
    id: 'USA-02', family: 'usage', nature: 'usage_professionnel',
    title: 'Dégagements d\'usage du catalogue respectés',
    source: usagePro('dégagements types du catalogue Mimmoza (src/data/catalog.ts)'),
    applicability: TOUS, weight: 0.6,
    check: { kind: 'degagement_categorie', params: { categories: ['*'], useSpecClearances: true, ignoreCategories: ['tapis', 'chaise', 'chaise_bureau', 'chevet', 'banc'], swingCounts: false, scope: 'chaque_placement' } },
    requirement: 'La zone de dégagement déclarée au catalogue autour de chaque meuble (devant, côtés, arrière) reste libre.',
    interpretation: 'Les assises et chevets peuvent occuper le dégagement de leur meuble porteur (table, bureau, lit).',
  }),
  rule({
    id: 'USA-03', family: 'usage', nature: 'usage_professionnel',
    title: 'Lit : accès latéral ≥ 0,60 m (deux côtés pour un lit double)',
    source: usagePro('passage courant le long d\'un lit'),
    applicability: { ...TOUS, roles: roles(CHAMBRES) }, weight: 1,
    check: { kind: 'degagement_categorie', params: { categories: ['lit'], minLeft: 0.6, minRight: 0.6, lateralMode: 'tous_si_double', ignoreCategories: ['tapis', 'chevet'], swingCounts: false, scope: 'chaque_placement' } },
    requirement: 'Un lit simple est accessible par au moins un grand côté, un lit double par ses deux grands côtés, avec un passage d\'au moins 0,60 m.',
    interpretation: 'Lit double = spec fournissant « dormir_double ». Les chevets sont tolérés dans le passage.',
  }),
  rule({
    id: 'USA-04', family: 'usage', nature: 'usage_professionnel',
    title: 'Cuisine : dégagement ≥ 0,90 m devant les équipements',
    source: usagePro('dégagement devant plan de travail et portes d\'électroménager'),
    applicability: { ...TOUS, roles: roles(CUISINES) }, weight: 1,
    check: { kind: 'degagement_categorie', params: { categories: CUISINE_FIXE, minFront: 0.9, ignoreCategories: ['tapis', 'chaise'], swingCounts: true, scope: 'chaque_placement' } },
    requirement: 'Un dégagement libre d\'au moins 0,90 m est maintenu devant la cuisine, l\'îlot, le réfrigérateur et le lave-vaisselle.',
    interpretation: 'Permet l\'ouverture des portes d\'électroménager et le travail d\'une personne ; 1,20 m au confort (ECH-08).',
  }),
  rule({
    id: 'USA-05', family: 'usage', nature: 'usage_professionnel',
    title: 'Recul ≥ 0,30 m derrière chaque chaise',
    source: usagePro('environ 0,75–0,80 m entre le bord de table et l\'obstacle'),
    applicability: TOUS, weight: 0.8,
    check: { kind: 'degagement_categorie', params: { categories: ['chaise', 'chaise_bureau'], minBack: 0.3, ignoreCategories: ['tapis'], swingCounts: false, scope: 'chaque_placement' } },
    requirement: 'Derrière chaque chaise placée à table ou au bureau, un recul libre d\'au moins 0,30 m permet de s\'asseoir et de se lever.',
    interpretation: 'Chaise de 0,45–0,50 m + 0,30 m de recul ≈ 0,75–0,80 m depuis le bord de table.',
  }),
  rule({
    id: 'USA-06', family: 'usage', nature: 'usage_professionnel',
    title: 'Fenêtres et portes-fenêtres non obstruées',
    source: usagePro('accès à la manœuvre des ouvrants et à l\'éclairement'),
    applicability: TOUS, weight: 1,
    check: { kind: 'ouverture_non_obstruee', params: { depth: 0.4, heightTolerance: 0, frenchWindowDepth: 0.9, ignoreCategories: ['tapis'] } },
    requirement: 'Devant une fenêtre, seul un meuble autorisé sous fenêtre et plus bas que l\'allège est admis ; devant une porte-fenêtre, une zone de 0,90 m reste libre.',
    interpretation: 'Allège inconnue : seul allowedUnderWindow est contrôlé (hypothèse consignée). L\'art. 11 de l\'arrêté de 2015 admet une commande de fenêtre hors 0,90–1,30 m au-dessus d\'un meuble fixe : non concerné ici (mobilier mobile).',
  }),
  rule({
    id: 'USA-07', family: 'usage', nature: 'usage_professionnel',
    title: 'Chaque chambre a un couchage',
    source: usagePro(),
    applicability: { ...TOUS, roles: roles(CHAMBRES) }, weight: 1,
    check: { kind: 'fonctions_requises', params: { functions: ['dormir'], scope: 'chaque_piece', whenBrief: 'toujours' } },
    requirement: 'Toute pièce désignée comme chambre reçoit au moins un lit.',
    interpretation: 'Une chambre transformée en bureau doit être déclarée « bureau » dans le plan.',
  }),
  rule({
    id: 'USA-08', family: 'usage', nature: 'usage_professionnel',
    title: 'Cuisine fonctionnelle : évier, cuisson, froid, plan de travail',
    source: usagePro(),
    applicability: { ...TOUS, roles: roles(CUISINES) }, weight: 1,
    check: { kind: 'fonctions_requises', params: { functions: ['evier', 'cuisson', 'froid', 'plan_de_travail'], scope: 'chaque_piece', whenBrief: 'toujours' } },
    requirement: 'La cuisine (ou la partie cuisine du séjour) réunit évier, cuisson, froid et plan de travail.',
    interpretation: 'Fonctions fournies par un ou plusieurs meubles de la pièce.',
  }),
  rule({
    id: 'USA-09', family: 'usage', nature: 'usage_professionnel',
    title: 'Salle de bains / salle d\'eau : lavabo et douche ou baignoire',
    source: usagePro(),
    applicability: { ...TOUS, roles: roles(BAINS) }, weight: 1,
    check: { kind: 'fonctions_requises', params: { functions: ['lavabo'], anyOf: ['douche', 'bain'], scope: 'chaque_piece', whenBrief: 'toujours' } },
    requirement: 'Chaque salle de bains ou salle d\'eau comporte un lavabo et au moins une douche ou une baignoire.',
    interpretation: 'Rôle salle_d_eau : douche attendue en pratique, la baignoire est acceptée.',
  }),
  rule({
    id: 'USA-10', family: 'usage', nature: 'usage_professionnel',
    title: 'WC équipé',
    source: usagePro(),
    applicability: { ...TOUS, roles: ['wc'] }, weight: 1,
    check: { kind: 'fonctions_requises', params: { functions: ['toilette'], scope: 'chaque_piece', whenBrief: 'toujours' } },
    requirement: 'Chaque pièce WC reçoit une cuvette.',
    interpretation: 'Une cuvette intégrée à la salle de bains n\'est pas exigée par cette règle (pièce WC uniquement).',
  }),
  rule({
    id: 'USA-11', family: 'usage', nature: 'usage_professionnel',
    title: 'Séjour équipé d\'assises de salon',
    source: usagePro(),
    applicability: { ...TOUS, roles: roles(SEJOURS) }, weight: 1,
    check: { kind: 'fonctions_requises', params: { functions: ['assise_salon'], scope: 'chaque_piece', whenBrief: 'toujours' } },
    requirement: 'Le séjour reçoit au moins une assise de salon (canapé ou fauteuil).',
    interpretation: 'Le nombre de places est contrôlé par ORG-05.',
  }),
  rule({
    id: 'USA-12', family: 'usage', nature: 'hypothese_mimmoza',
    title: 'Couchages permanents ≥ nombre d\'occupants',
    source: hypothese('canapé convertible non compté comme couchage permanent'),
    applicability: TOUS, weight: 1,
    check: { kind: 'capacite_occupants', params: { measure: 'sleeps', providing: 'dormir', aggregate: 'somme', bound: 'min', margin: 0, ignoreCategories: ['canape'], ignoreOnlyIfRoles: ['chambre', 'chambre_parentale'] } },
    requirement: 'Le total des couchages (hors canapé convertible) est au moins égal au nombre d\'occupants du brief.',
    interpretation: 'Occupants = adultes + enfants ; un lit double compte 2 couchages. Studio / T1 sans chambre : le canapé convertible de la pièce principale EST le couchage permanent prévu par le programme ; il est alors compté (recalibrage INT-05b, CHECKS.md D21).',
  }),
  rule({
    id: 'USA-13', family: 'usage', nature: 'hypothese_mimmoza',
    title: 'Une table permet à tous les occupants de manger ensemble',
    source: hypothese(),
    applicability: { ...TOUS, roles: ['sejour', 'sejour_cuisine', 'cuisine'] }, weight: 0.8,
    check: { kind: 'capacite_occupants', params: { measure: 'seats', providing: 'repas', aggregate: 'max', bound: 'min', margin: 0, ignoreCategories: [] } },
    requirement: 'Le meuble de repas le plus grand offre au moins autant de couverts que d\'occupants.',
    interpretation: 'Absence de table = 0 couvert = violation ; la table de balcon (rôle extérieur) n\'est pas comptée.',
  }),
  rule({
    id: 'USA-14a', family: 'usage', nature: 'norme',
    title: 'WC : espace libre 0,80 × 1,30 m latéral à la cuvette (maison neuve)',
    source: officiel('art. 13, II, 1°'),
    applicability: { ...ART13_MAISON, roles: ['wc', 'salle_de_bain', 'salle_d_eau'] }, weight: 1,
    check: { kind: 'degagement_categorie', params: { categories: ['wc'], minLeft: 0.8, minRight: 0.8, lateralMode: 'au_moins_un', sideZoneLength: 1.3, ignoreCategories: [...MOBILIER_MOBILE, 'lave_linge'], swingCounts: true, scope: 'au_moins_un_logement', uniteDeVie: true } },
    requirement: 'Au moins un cabinet d\'aisances de l\'unité de vie offre, latéralement à la cuvette et hors débattement de porte, un espace libre d\'au moins 0,80 × 1,30 m.',
    interpretation: 'Le texte admet que cet espace serve à d\'autres usages à la livraison si sa réintégration est simple : le mobilier mobile et le lave-linge y sont tolérés en lecture réglementaire.',
  }),
  rule({
    id: 'USA-14b', family: 'usage', nature: 'norme',
    title: 'WC meublé : espace latéral 0,80 × 1,30 m dégagé (occupant PMR)',
    source: officiel('art. 13, II, 1°'),
    applicability: { ...ART13_PMR, roles: ['wc', 'salle_de_bain', 'salle_d_eau'] }, weight: 1,
    check: { kind: 'degagement_categorie', params: { categories: ['wc'], minLeft: 0.8, minRight: 0.8, lateralMode: 'au_moins_un', sideZoneLength: 1.3, ignoreCategories: ['tapis'], swingCounts: true, scope: 'au_moins_un_logement', uniteDeVie: true } },
    requirement: 'Même exigence que USA-14a, l\'espace devant être réellement libre.',
    interpretation: 'Brief pmr : aucun meuble ni lave-linge dans l\'espace latéral.',
  }),

  // ═════════════════════════ TECHNIQUE (bloquante) ═════════════════════════
  rule({
    id: 'TEC-01', family: 'technique', nature: 'hypothese_mimmoza',
    title: 'Radiateur non masqué par un meuble',
    source: hypothese('principe de convection : ne pas masquer un émetteur'),
    applicability: TOUS, weight: 0.8,
    check: { kind: 'distance_fixture', params: { mode: 'min', fixtureKinds: ['radiateur'], distance: 0.3, categories: ['canape', 'armoire', 'dressing', 'bibliotheque', 'commode', 'lit', 'meuble_tv', 'meuble_entree', 'refrigerateur'] } },
    requirement: 'Aucun meuble volumineux à moins de 0,30 m d\'un radiateur.',
    interpretation: 'Bureaux, chaises et tables (ajourés) sont tolérés. Radiateur sans emprise : distance au point.',
  }),
  rule({
    id: 'TEC-02', family: 'technique', nature: 'hypothese_mimmoza',
    title: 'Tableau électrique accessible',
    source: hypothese('principe d\'accessibilité du tableau (NF C 15-100, non vérifié)'),
    applicability: TOUS, weight: 1,
    check: { kind: 'distance_fixture', params: { mode: 'zone_avant', fixtureKinds: ['tableau_electrique'], distance: 0.7, zoneWidth: 0.6, categories: ['armoire', 'dressing', 'bibliotheque', 'meuble_entree', 'commode', 'refrigerateur', 'lave_linge', 'canape', 'lit', 'table_repas', 'bureau', 'cuisine_lineaire'] } },
    requirement: 'Une zone libre de 0,70 m de profondeur est maintenue devant le tableau électrique (sur 0,60 m de large si sa largeur est inconnue).',
    interpretation: 'Valeur Mimmoza ; l\'exigence exacte d\'accessibilité figure dans la NF C 15-100 (non reproduite, non vérifiée). Recalibrage INT-05b : l\'accès se juge DEVANT la face du tableau (manœuvre, intervention) ; l\'ancien rayon de 0,70 m tout autour interdisait tout rangement d\'entrée dans les entrées de 1,20–1,30 m du banc, où un professionnel pose un meuble bas à côté du tableau (CHECKS.md D20).',
  }),
  rule({
    id: 'TEC-03', family: 'technique', nature: 'hypothese_mimmoza',
    title: 'Chaudière accessible pour l\'entretien',
    source: hypothese(),
    applicability: TOUS, weight: 0.8,
    check: { kind: 'distance_fixture', params: { mode: 'min', fixtureKinds: ['chaudiere'], distance: 0.6, categories: ['armoire', 'dressing', 'bibliotheque', 'refrigerateur', 'lave_linge', 'commode', 'meuble_entree'] } },
    requirement: 'Un espace d\'au moins 0,60 m reste libre de meuble haut devant la chaudière.',
    interpretation: 'Entretien annuel ; les meubles de cuisine bas sont tolérés (souvent sous la chaudière).',
  }),
  rule({
    id: 'TEC-04', family: 'technique', nature: 'usage_professionnel',
    title: 'Meubles nécessitant l\'eau placés en pièce humide',
    source: usagePro(),
    applicability: TOUS, weight: 1,
    check: { kind: 'distance_fixture', params: { mode: 'piece_humide', fixtureKinds: [], categories: ['*'], requireNeedsWater: true } },
    requirement: 'Tout meuble raccordé à l\'eau (évier, sanitaires, lave-linge, lave-vaisselle) est placé dans une pièce disposant de l\'eau.',
    interpretation: 'Pièce humide = AnalyzedRoom.hasWater ; on ne crée pas de réseau.',
  }),
  rule({
    id: 'TEC-05', family: 'technique', nature: 'hypothese_mimmoza',
    title: 'Cuisine à ≤ 3,00 m d\'une gaine ou d\'une évacuation',
    source: hypothese('limitation des longueurs d\'évacuation en pente'),
    applicability: { ...TOUS, roles: roles(CUISINES) }, weight: 0.8,
    check: { kind: 'distance_fixture', params: { mode: 'max', fixtureKinds: ['gaine', 'evacuation', 'arrivee_eau'], distance: 3.0, categories: ['cuisine_lineaire', 'lave_vaisselle', 'ilot'], requireNeedsWater: true } },
    requirement: 'Les équipements de cuisine raccordés sont à 3,00 m au plus d\'une gaine, évacuation ou arrivée d\'eau de la pièce.',
    interpretation: 'Pièce sans équipement d\'eau renseigné : règle ignorée (donnée manquante).',
  }),
  rule({
    id: 'TEC-06', family: 'technique', nature: 'hypothese_mimmoza',
    title: 'WC à ≤ 1,00 m d\'une chute (gaine / évacuation)',
    source: hypothese('évacuation Ø 100 courte'),
    applicability: { ...TOUS, roles: ['wc', 'salle_de_bain', 'salle_d_eau'] }, weight: 1,
    check: { kind: 'distance_fixture', params: { mode: 'max', fixtureKinds: ['gaine', 'evacuation'], distance: 1.0, categories: ['wc'], requireNeedsWater: true } },
    requirement: 'La cuvette est à 1,00 m au plus d\'une gaine ou évacuation de la pièce.',
    interpretation: 'Sanibroyeur non envisagé en neuf.',
  }),
  rule({
    id: 'TEC-07', family: 'technique', nature: 'hypothese_mimmoza',
    title: 'Sanitaires et lave-linge à ≤ 2,50 m d\'un point d\'eau',
    source: hypothese(),
    applicability: { ...TOUS, roles: ['salle_de_bain', 'salle_d_eau', 'wc', 'buanderie', 'cellier'] }, weight: 0.8,
    check: { kind: 'distance_fixture', params: { mode: 'max', fixtureKinds: ['gaine', 'evacuation', 'arrivee_eau'], distance: 2.5, categories: ['meuble_vasque', 'douche', 'baignoire', 'lave_mains', 'lave_linge'], requireNeedsWater: true } },
    requirement: 'Vasques, douche, baignoire, lave-mains et lave-linge sont à 2,50 m au plus d\'une gaine, évacuation ou arrivée d\'eau.',
    interpretation: 'Pièce sans équipement d\'eau renseigné : règle ignorée.',
  }),
  rule({
    id: 'TEC-08', family: 'technique', nature: 'norme',
    title: 'Recommandation : prises du séjour (5 si < 28 m², 7 au-delà)',
    source: { reference: `${NFC15100} ; source secondaire : Legrand (fabricant), page « Combien de prises de courant doit-on installer dans chaque pièce ? »`, url: LEGRAND_PRISES_URL, toVerify: true },
    applicability: { ...NEUF_TOUS, roles: roles(SEJOURS) }, weight: 0,
    check: { kind: 'recommandation_prises', params: { smallAreaThreshold: 28, smallAreaCount: 5, minCount: 7, nearFunctions: ['tv', 'travail', 'eclairage_appoint'] } },
    requirement: 'Prévoir au moins 5 prises de courant dans un séjour de moins de 28 m², 7 au-delà, dont près du meuble TV.',
    interpretation: 'Mimmoza ne place pas de prises : la règle produit une recommandation, jamais une violation (poids 0).',
  }),
  rule({
    id: 'TEC-09', family: 'technique', nature: 'norme',
    title: 'Recommandation : prises de chambre (3 minimum)',
    source: { reference: `${NFC15100} ; source secondaire : Legrand (fabricant)`, url: LEGRAND_PRISES_URL, toVerify: true },
    applicability: { ...NEUF_TOUS, roles: roles(CHAMBRES, ['bureau']) }, weight: 0,
    check: { kind: 'recommandation_prises', params: { minCount: 3, nearFunctions: ['chevet', 'travail'] } },
    requirement: 'Prévoir au moins 3 prises de courant par chambre, à placer près des chevets et du bureau.',
    interpretation: 'Recommandation uniquement.',
  }),
  rule({
    id: 'TEC-10', family: 'technique', nature: 'norme',
    title: 'Recommandation : prises de cuisine (3 si ≤ 4 m², sinon 6 dont 4 au-dessus du plan)',
    source: { reference: `${NFC15100} ; source secondaire : Legrand (fabricant)`, url: LEGRAND_PRISES_URL, toVerify: true },
    applicability: { ...NEUF_TOUS, roles: roles(CUISINES) }, weight: 0,
    check: { kind: 'recommandation_prises', params: { smallAreaThreshold: 4, smallAreaCount: 3, minCount: 6, minAboveWorktop: 4, nearFunctions: ['plan_de_travail'] } },
    requirement: 'Prévoir 3 prises dans une cuisine de 4 m² au plus, 6 au-delà dont 4 au-dessus du plan de travail.',
    interpretation: 'Recommandation uniquement ; pour une pièce séjour-cuisine, la surface retenue est celle de la pièce (approximation).',
  }),
  rule({
    id: 'TEC-11', family: 'technique', nature: 'usage_professionnel',
    title: 'Recommandation : circuits spécialisés cuisson, lave-vaisselle, lave-linge',
    source: { reference: `${REGLE_ART} — d'après la NF C 15-100 (exigence non reproduite, non vérifiée)`, toVerify: true },
    applicability: NEUF_TOUS, weight: 0,
    check: { kind: 'recommandation_prises', params: { dedicatedFor: ['cuisson', 'lavage_vaisselle', 'lavage_linge'] } },
    requirement: 'Prévoir une alimentation dédiée à l\'emplacement de chaque appareil de cuisson, lave-vaisselle et lave-linge placé.',
    interpretation: 'Recommandation uniquement, émise pour chaque placement fournissant ces fonctions.',
  }),
  rule({
    id: 'TEC-12', family: 'technique', nature: 'norme',
    title: 'Recommandation : prise à proximité de l\'interrupteur d\'entrée de chaque pièce de l\'unité de vie',
    source: officiel('art. 11, II, 2°', ARRETE_2015_ART11_URL),
    applicability: { ...NEUF_TOUS, roles: ['sejour', 'sejour_cuisine', 'cuisine', 'chambre', 'chambre_parentale', 'wc', 'salle_de_bain', 'salle_d_eau'] }, weight: 0,
    check: { kind: 'recommandation_prises', params: { nearSwitch: true } },
    requirement: 'Dans chaque pièce de l\'unité de vie, une prise de courant est disposée à proximité immédiate de l\'interrupteur de commande d\'éclairage situé à l\'entrée de la pièce.',
    interpretation: 'Recommandation : signaler de ne pas bloquer cette prise (meuble haut à côté de la porte).',
  }),
  rule({
    id: 'TEC-13', family: 'technique', nature: 'norme',
    title: 'Recommandation : 1 prise dans les autres pièces de plus de 4 m² (hors WC)',
    source: { reference: `${NFC15100} ; source secondaire : Legrand (fabricant)`, url: LEGRAND_PRISES_URL, toVerify: true },
    applicability: { ...NEUF_TOUS, roles: ['entree', 'degagement', 'salle_de_bain', 'salle_d_eau', 'bureau', 'cellier', 'buanderie', 'dressing'] }, weight: 0,
    check: { kind: 'recommandation_prises', params: { smallAreaThreshold: 4, smallAreaCount: 0, minCount: 1 } },
    requirement: 'Prévoir au moins une prise dans toute autre pièce de plus de 4 m², WC exceptés.',
    interpretation: 'Recommandation uniquement.',
  }),

  // ═════════════════════════ ÉCHELLE (dégradante) ═════════════════════════
  rule({
    id: 'ECH-01', family: 'echelle', nature: 'usage_professionnel',
    title: 'Canapé ≤ 2/3 de la longueur du mur d\'adossement',
    source: usagePro('règle des deux tiers'),
    applicability: { ...TOUS, roles: roles(SEJOURS) }, weight: 0.6,
    check: { kind: 'ratio_dimension', params: { numerator: 'largeur', categories: ['canape'], reference: 'mur', max: 0.667, ignoreCategories: [], wallTolerance: 0.3 } },
    requirement: 'La largeur du canapé n\'excède pas les deux tiers de la longueur du mur contre lequel il est adossé.',
    interpretation: 'Canapé non adossé (à plus de 0,30 m d\'un mur) : non contrôlé.',
  }),
  rule({
    id: 'ECH-02', family: 'echelle', nature: 'usage_professionnel',
    title: 'Table basse entre 1/2 et 3/4 de la largeur du canapé',
    source: usagePro('proportion courante table basse / canapé'),
    applicability: { ...TOUS, roles: roles(SEJOURS) }, weight: 0.4,
    check: { kind: 'ratio_dimension', params: { numerator: 'largeur', categories: ['table_basse'], reference: 'categorie', referenceCategories: ['canape'], min: 0.5, max: 0.75, ignoreCategories: [] } },
    requirement: 'La largeur de la table basse est comprise entre la moitié et les trois quarts de celle du canapé le plus proche.',
    interpretation: 'Contrôlé seulement si un canapé est présent dans la pièce.',
  }),
  rule({
    id: 'ECH-03', family: 'echelle', nature: 'hypothese_mimmoza',
    title: 'Séjour : emprise du mobilier ≤ 40 % de la surface',
    source: hypothese(),
    applicability: { ...TOUS, roles: roles(SEJOURS) }, weight: 0.6,
    check: { kind: 'ratio_dimension', params: { numerator: 'surface', categories: ['*'], reference: 'piece', max: 0.4, ignoreCategories: ['tapis'] } },
    requirement: 'La somme des emprises au sol du mobilier (hors tapis) ne dépasse pas 40 % de la surface du séjour.',
    interpretation: 'Indicateur de surcharge ; à recalibrer sur le banc de plans.',
  }),
  rule({
    id: 'ECH-04', family: 'echelle', nature: 'hypothese_mimmoza',
    title: 'Chambre : emprise du mobilier ≤ 50 % de la surface',
    source: hypothese(),
    applicability: { ...TOUS, roles: roles(CHAMBRES) }, weight: 0.5,
    check: { kind: 'ratio_dimension', params: { numerator: 'surface', categories: ['*'], reference: 'piece', max: 0.5, ignoreCategories: ['tapis'] } },
    requirement: 'La somme des emprises au sol du mobilier (hors tapis) ne dépasse pas 50 % de la surface de la chambre.',
    interpretation: 'Indicateur de surcharge.',
  }),
  rule({
    id: 'ECH-05', family: 'echelle', nature: 'hypothese_mimmoza',
    title: 'Lit proportionné à la chambre (≤ 30 % de la surface)',
    source: hypothese(),
    applicability: { ...TOUS, roles: roles(CHAMBRES) }, weight: 0.5,
    check: { kind: 'ratio_dimension', params: { numerator: 'surface', categories: ['lit'], reference: 'piece', max: 0.3, ignoreCategories: [] } },
    requirement: 'L\'emprise du lit n\'excède pas 30 % de la surface de la chambre (ex. lit 160 × 200 => chambre ≥ 10,7 m²).',
    interpretation: 'Sinon, privilégier la variante de repli (160 → 140).',
  }),
  rule({
    id: 'ECH-06', family: 'echelle', nature: 'hypothese_mimmoza',
    title: 'Table de repas non surdimensionnée (≤ occupants + 2)',
    source: hypothese(),
    applicability: { ...TOUS, roles: ['sejour', 'sejour_cuisine', 'cuisine'] }, weight: 0.4,
    check: { kind: 'capacite_occupants', params: { measure: 'seats', providing: 'repas', aggregate: 'max', bound: 'max', margin: 2, ignoreCategories: [] } },
    requirement: 'Le meuble de repas le plus grand n\'offre pas plus de deux couverts au-delà du nombre d\'occupants.',
    interpretation: 'Complète USA-13 (minimum).',
  }),
  rule({
    id: 'ECH-07', family: 'echelle', nature: 'hypothese_mimmoza',
    title: 'Distance canapé – meuble TV entre 1,80 et 3,50 m',
    source: hypothese('taille d\'écran inconnue'),
    applicability: { ...TOUS, roles: roles(SEJOURS) }, weight: 0.5,
    check: { kind: 'distance_entre_categories', params: { from: ['canape'], to: ['meuble_tv'], measure: 'faces_avant', min: 1.8, max: 3.5, sameRoomOnly: true } },
    requirement: 'La distance entre la face avant du canapé et celle du meuble TV est comprise entre 1,80 et 3,50 m.',
    interpretation: 'Contrôlé seulement si les deux meubles sont dans la même pièce.',
  }),
  rule({
    id: 'ECH-08', family: 'echelle', nature: 'usage_professionnel',
    title: 'Confort : 1,20 m devant la cuisine',
    source: usagePro('deux personnes peuvent se croiser'),
    applicability: { ...TOUS, roles: roles(CUISINES) }, weight: 0.4,
    check: { kind: 'degagement_categorie', params: { categories: ['cuisine_lineaire'], minFront: 1.2, ignoreCategories: ['tapis', 'chaise'], swingCounts: true, scope: 'chaque_placement' } },
    requirement: 'Un dégagement de 1,20 m devant la cuisine linéaire permet à deux personnes de se croiser.',
    interpretation: 'Le minimum bloquant est 0,90 m (USA-04).',
  }),
  rule({
    id: 'ECH-09', family: 'echelle', nature: 'usage_professionnel',
    title: 'Confort : 0,70 m le long du lit',
    source: usagePro(),
    applicability: { ...TOUS, roles: roles(CHAMBRES) }, weight: 0.4,
    check: { kind: 'degagement_categorie', params: { categories: ['lit'], minLeft: 0.7, minRight: 0.7, lateralMode: 'tous_si_double', ignoreCategories: ['tapis', 'chevet'], swingCounts: false, scope: 'chaque_placement' } },
    requirement: 'Passage confortable de 0,70 m le long des grands côtés accessibles du lit.',
    interpretation: 'Le minimum bloquant est 0,60 m (USA-03).',
  }),

  // ═════════════════════════ ORGANISATION (dégradante) ═════════════════════════
  rule({
    id: 'ORG-01', family: 'organisation', nature: 'usage_professionnel',
    title: 'Séparation jour / nuit',
    source: usagePro(),
    applicability: TOUS, weight: 0.5,
    check: { kind: 'zonage_jour_nuit', params: { maxJourCrossings: 0 } },
    requirement: 'Les chambres sont accessibles depuis l\'entrée sans traverser une pièce de jour.',
    interpretation: 'Défaut du plan (cloisons non déplacées) : signalé, sans action possible sur le mobilier.',
  }),
  rule({
    id: 'ORG-02', family: 'organisation', nature: 'usage_professionnel',
    title: 'Entrée équipée d\'un rangement',
    source: usagePro(),
    applicability: { ...TOUS, roles: ['entree'] }, weight: 0.6,
    check: { kind: 'fonctions_requises', params: { functions: ['rangement_entree'], scope: 'chaque_piece', fallbackToEntranceRoom: true, whenBrief: 'toujours' } },
    requirement: 'L\'entrée (ou, à défaut, la pièce desservie par la porte palière) reçoit un rangement d\'entrée.',
    interpretation: 'Un placard maçonné du plan n\'est pas encore pris en compte (limite v1).',
  }),
  rule({
    id: 'ORG-03', family: 'organisation', nature: 'usage_professionnel',
    title: 'Chaque chambre a un rangement de vêtements',
    source: usagePro(),
    applicability: { ...TOUS, roles: roles(CHAMBRES) }, weight: 0.6,
    check: { kind: 'fonctions_requises', params: { functions: ['rangement_vetements'], scope: 'chaque_piece', acceptAdjacentRoles: ['dressing'], whenBrief: 'toujours' } },
    requirement: 'Chaque chambre dispose d\'un rangement de vêtements, dans la pièce ou dans un dressing attenant.',
    interpretation: 'Dressing attenant = pièce de rôle dressing reliée directement à la chambre.',
  }),
  rule({
    id: 'ORG-04', family: 'organisation', nature: 'usage_professionnel',
    title: 'Chevets accolés au lit',
    source: usagePro(),
    applicability: { ...TOUS, roles: roles(CHAMBRES) }, weight: 0.3,
    check: { kind: 'distance_entre_categories', params: { from: ['chevet'], to: ['lit'], measure: 'bord_a_bord', max: 0.1, sameRoomOnly: true } },
    requirement: 'Chaque chevet est à 0,10 m au plus d\'un lit.',
    interpretation: 'Évite des chevets isolés.',
  }),
  rule({
    id: 'ORG-05', family: 'organisation', nature: 'hypothese_mimmoza',
    title: 'Places assises de salon ≥ nombre d\'occupants',
    source: hypothese(),
    applicability: { ...TOUS, roles: roles(SEJOURS) }, weight: 0.6,
    check: { kind: 'capacite_occupants', params: { measure: 'seats', providing: 'assise_salon', aggregate: 'somme', bound: 'min', margin: 0, ignoreCategories: [] } },
    requirement: 'Le total des places de salon (canapés et fauteuils du séjour) est au moins égal au nombre d\'occupants.',
    interpretation: 'Chaises de repas non comptées.',
  }),
  rule({
    id: 'ORG-06', family: 'organisation', nature: 'hypothese_mimmoza',
    title: 'Télétravail : un poste de travail dans le logement',
    source: hypothese(),
    applicability: TOUS, weight: 0.6,
    check: { kind: 'fonctions_requises', params: { functions: ['travail'], scope: 'logement', whenBrief: 'teletravail' } },
    requirement: 'Si le brief indique du télétravail, le logement comporte au moins un bureau.',
    interpretation: 'Sans télétravail au brief : règle non applicable (rulesSkipped).',
  }),
  rule({
    id: 'ORG-07', family: 'organisation', nature: 'hypothese_mimmoza',
    title: 'Emplacement de lave-linge prévu',
    source: hypothese(),
    applicability: TOUS, weight: 0.5,
    check: { kind: 'fonctions_requises', params: { functions: ['lavage_linge'], scope: 'logement', whenBrief: 'toujours' } },
    requirement: 'Le logement comporte un emplacement de lave-linge.',
    interpretation: 'Placé en pièce humide (contrôlé par TEC-04).',
  }),
  rule({
    id: 'ORG-08', family: 'organisation', nature: 'usage_professionnel',
    title: 'Confort : passage ≥ 0,90 m vers les portes et zones d\'usage',
    source: usagePro(),
    applicability: { ...TOUS, roles: roles(PIECES_PRINCIPALES) }, weight: 0.4,
    check: { kind: 'passage_min', params: { minWidth: 0.9, targets: 'portes_et_usages', ignoreCategories: ['tapis'], satelliteCategories: SATELLITES } },
    requirement: 'Les portes et les zones d\'usage des meubles sont reliées par un passage de 0,90 m.',
    interpretation: 'Le minimum bloquant est 0,70 m (CIR-02).',
  }),
  rule({
    id: 'ORG-09', family: 'organisation', nature: 'usage_professionnel',
    title: 'Triangle d\'activité de la cuisine (évier – cuisson – froid)',
    source: usagePro('triangle d\'activité'),
    applicability: { ...TOUS, roles: roles(CUISINES) }, weight: 0.5,
    check: { kind: 'triangle_cuisine', params: { minLeg: 0.3, maxLeg: 2.7, maxPerimeter: 7.0 } },
    requirement: 'Chaque côté du triangle évier – cuisson – froid mesure entre 0,30 et 2,70 m et le périmètre ne dépasse pas 7,00 m.',
    interpretation: 'Pôles fournis par un même meuble : positions conventionnelles (CHECKS.md).',
  }),

  // ── Composition (INT-05b) : zones fonctionnelles et alignements, règles de l'art ──
  rule({
    id: 'ORG-10', family: 'organisation', nature: 'usage_professionnel',
    title: 'Électroménager dans le linéaire de cuisine',
    source: usagePro('réfrigérateur et lave-vaisselle intégrés à la composition de cuisine'),
    applicability: { ...TOUS, roles: roles(CUISINES) }, weight: 0.5,
    check: { kind: 'distance_entre_categories', params: { from: ['refrigerateur', 'lave_vaisselle'], to: ['cuisine_lineaire', 'ilot'], measure: 'bord_a_bord', max: 0.05, sameRoomOnly: true } },
    requirement: 'Le réfrigérateur et le lave-vaisselle indépendants sont contigus à la cuisine (dans son alignement ou en retour d\'angle).',
    interpretation: 'Contigu = à 5 cm au plus, bord à bord, d\'un élément de cuisine de la même pièce ; un réfrigérateur isolé au milieu d\'un séjour est un défaut de composition.',
  }),
  rule({
    id: 'ORG-11', family: 'organisation', nature: 'usage_professionnel',
    title: 'Chaises disposées à leur poste (table, îlot, bureau)',
    source: usagePro('chaises rangées au bord de la table ou du bureau, face à lui'),
    applicability: TOUS, weight: 0.4,
    check: { kind: 'distance_entre_categories', params: { from: ['chaise', 'chaise_bureau'], to: ['table_repas', 'ilot', 'bureau'], measure: 'bord_a_bord', max: 0.1, sameRoomOnly: true } },
    requirement: 'Chaque chaise (de repas ou de bureau) est au bord d\'une table, d\'un îlot ou d\'un bureau, à 0,10 m au plus.',
    interpretation: 'Évite les chaises « flottantes » ; le recul derrière la chaise est contrôlé par USA-05, la répartition par couverts par le solveur.',
  }),
  rule({
    id: 'ORG-12', family: 'organisation', nature: 'usage_professionnel',
    title: 'Salon : canapé et meuble TV en vis-à-vis',
    source: usagePro('composition du coin salon'),
    applicability: { ...TOUS, roles: roles(SEJOURS) }, weight: 0.5,
    check: { kind: 'vis_a_vis', params: { from: ['canape'], to: ['meuble_tv'], maxLateralOffset: 0.5, sameRoomOnly: true } },
    requirement: 'Le meuble TV fait face au canapé, dans son axe (décalage latéral ≤ 0,50 m).',
    interpretation: 'La distance de vision est contrôlée par ECH-07 ; décalage mesuré entre les milieux des faces avant.',
  }),
  rule({
    id: 'ORG-13', family: 'organisation', nature: 'usage_professionnel',
    title: 'Tête de lit contre un mur',
    source: usagePro('tête de lit adossée à un mur plein'),
    applicability: { ...TOUS, roles: roles(CHAMBRES) }, weight: 0.5,
    check: { kind: 'adossement', params: { categories: ['lit'], maxGap: 0.05, side: 'back' } },
    requirement: 'La tête de chaque lit est adossée à un mur sur toute sa largeur.',
    interpretation: 'Un lit « flottant » au milieu de la chambre est un défaut de composition ; le choix du mur (hors mur de porte, hors vue directe depuis la porte) relève du scoring du solveur.',
  }),

  // ═════════════════════════ STYLE (dégradante) ═════════════════════════
  rule({
    id: 'STY-01', version: 2, family: 'style', nature: 'usage_professionnel',
    title: 'Palette 60 / 30 / 10',
    source: usagePro('règle des couleurs 60/30/10'),
    applicability: TOUS, weight: 0.5,
    check: { kind: 'style_coherence', params: { aspect: 'palette_60_30_10', scope: 'piece', dominantMin: 0.5, dominantMax: 0.7, secondaryMin: 0.2, secondaryMax: 0.5, accentMax: 0.15, colorTolerance: 60, excludeCategories: [...EQUIPEMENTS_TECHNIQUES], minPlacements: 3 } },
    requirement: 'Dans chaque pièce, la couleur dominante couvre ~60 % de la surface apparente du mobilier, la secondaire ~30 %, l\'accent ~10 %.',
    interpretation: 'Mesuré sur le mobilier seul (murs et sols non modélisés), à partir de Placement.finish.color. '
      + 'Recalibrage INT-07 (hypothèse Mimmoza 2026) : (1) sanitaires et électroménager exclus — blanc ou inox imposé par la notice '
      + 'descriptive du promoteur, hors choix décoratif ; (2) pièce évaluée à partir de 3 meubles colorés — en deçà, les parts sont dictées '
      + 'par les tailles et non par les couleurs (une entrée « meuble + tapis » ne peut pas faire 60/30) ; (3) plafond de la secondaire '
      + 'porté de 40 à 50 % (borne déjà impliquée par dominante ≥ 50 %) — dans une chambre sans tapis, lit et armoire font ~90 % de la '
      + 'surface et se partagent ~55/45 quelles que soient les couleurs ; la dominante reste bornée à 50–70 %, la secondaire à ≥ 20 %, '
      + 'chaque accent à ≤ 15 %.',
  }),
  rule({
    id: 'STY-02', family: 'style', nature: 'hypothese_mimmoza',
    title: 'Au plus 2 essences de bois par pièce',
    source: hypothese(),
    applicability: TOUS, weight: 0.4,
    check: { kind: 'style_coherence', params: { aspect: 'essences_bois_max', scope: 'piece', max: 2 } },
    requirement: 'Une pièce ne mélange pas plus de deux essences de bois.',
    interpretation: 'Lu sur Placement.finish.woodSpecies.',
  }),
  rule({
    id: 'STY-03', family: 'style', nature: 'usage_professionnel',
    title: 'Au plus 3 matériaux principaux par pièce',
    source: usagePro(),
    applicability: TOUS, weight: 0.4,
    check: { kind: 'style_coherence', params: { aspect: 'materiaux_max', scope: 'piece', max: 3 } },
    requirement: 'Une pièce ne compte pas plus de trois matériaux principaux.',
    interpretation: 'Lu sur Placement.finish.material.',
  }),
  rule({
    id: 'STY-04', version: 2, family: 'style', nature: 'hypothese_mimmoza',
    title: 'Matériau dominant commun aux pièces de jour',
    source: hypothese(),
    applicability: { ...TOUS, roles: ['entree', 'sejour', 'sejour_cuisine', 'cuisine'] }, weight: 0.3,
    check: { kind: 'style_coherence', params: { aspect: 'materiau_commun', scope: 'logement', excludeCategories: ['tapis', ...ELECTROMENAGER] } },
    requirement: 'Les pièces de jour partagent le même matériau dominant.',
    interpretation: 'Continuité visuelle entrée – séjour – cuisine. Recalibrage INT-07 : tapis et électroménager ignorés — un tapis '
      + '(jusqu\'à 3,7 m² de surface apparente) faisait du « tissu » le matériau dominant de tout séjour meublé, et la continuité '
      + 'visée est celle du mobilier (celle des sols est assurée par la feuille de style : sol continu dans les pièces sèches).',
  }),
];
