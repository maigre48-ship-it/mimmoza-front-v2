// =============================================================================
// COÛTS DE CONSTRUCTION — valeurs de référence partagées
// =============================================================================
//
// Rectification d'un constat d'audit
// ----------------------------------
// L'audit signalait « quatre barèmes de coût de construction, dont un facteur
// 1,9 sur le gros œuvre ». En relisant le code, ce n'est que partiellement
// exact, et la partie inexacte est instructive : les quatre valeurs ne
// mesurent PAS la même chose.
//
//   lib/constructionCostModel.ts        1 600 / 1 850 / 2 500 €/m² SDP
//     → coût BÂTIMENT tout compris (gros œuvre + clos-couvert + second œuvre
//       + lots techniques), par typologie et par gamme, avec coefficients
//       régional et de complexité. C'est le modèle documenté de référence.
//
//   bilan-promoteur   worksCostEurM2Sdp   1 800 €/m² SDP
//     → même grandeur : forfait tout compris, utilisé quand aucun métré
//       Massing 3D n'est disponible.
//
//   services/massing  coutConstructionM2  2 200 €/m² SDP
//     → même grandeur encore, dans l'analyse de capacité amont.
//
//   terrain3d/massingConstructionCosts  structure 1 100 €/m² SDP
//     → ⚠️ PAS la même grandeur. C'est la ligne « structure » d'une
//       DÉCOMPOSITION (structure + fondations + façade + toiture + balcons +
//       menuiseries), pas un poste « gros œuvre » comparable aux 32 % ×
//       1 850 = 592 €/m² du modèle de référence. Les deux chemins du Bilan
//       sont d'ailleurs mutuellement exclusifs (`useMassing` dans
//       computeProForma) : il n'y a jamais double compte.
//
// Ce qui est donc unifié ici, et ce qui ne l'est pas
// -------------------------------------------------
// UNIFIÉ : le forfait tout compris €/m² SDP et la taxe d'aménagement, qui sont
// bien la même grandeur exprimée trois fois et deux fois.
//
// NON UNIFIÉ, volontairement : les lignes de la décomposition Massing 3D
// (structure, façade, toiture, balcons, menuiseries, fondations). Les
// rapprocher des postes du modèle de référence supposerait une recalibration
// métré en main, pas une égalisation de constantes — et la somme des lignes
// Massing (~1 400 €/m² SDP sur un R+2 courant) reste dans le même ordre de
// grandeur que le forfait. L'écart est réel mais il relève du calage
// économique, pas de l'incohérence de code. Il est signalé plutôt que masqué.
// =============================================================================

/**
 * Coût bâtiment de référence, en € HT/m² SDP, pour du logement COLLECTIF de
 * gamme STANDARD en coefficient régional national moyen.
 *
 * Reprend `RATIO_BATIMENT.collectif.standard` de
 * `promoteur/lib/constructionCostModel.ts`, seul barème du code assorti d'une
 * décomposition documentée (gros œuvre 32 %, clos-couvert 24 %, second œuvre
 * 24 %, lots techniques 20 %) et de coefficients région / complexité.
 *
 * Il sert de DÉFAUT aux écrans qui affichent un forfait éditable ; il n'a pas
 * vocation à remplacer le modèle complet, qui reste le bon outil dès que la
 * typologie, la gamme et la région sont connues.
 */
export const COUT_BATIMENT_REF_EUR_M2_SDP = 1850;

/**
 * Taxe d'aménagement, en € HT/m² SDP.
 *
 * Valait 80 dans le Bilan promoteur et 120 dans l'analyse de capacité, pour
 * la même assiette — soit 40 k€ d'écart sur 1 000 m² de SDP. La valeur du
 * Bilan est retenue : c'est celle que l'utilisateur voit, édite et valide
 * dans le document financier de sortie.
 *
 * ⚠️ Ordre de grandeur seulement : la taxe réelle dépend de la valeur
 * forfaitaire annuelle, du taux communal et du taux départemental. À
 * confirmer commune par commune.
 */
export const TAXE_AMENAGEMENT_EUR_M2_SDP = 80;

/**
 * Coût plancher d'une cage d'ascenseur, en € HT.
 *
 * Le Bilan promoteur proposait 70 000 € par défaut, soit EN DESSOUS du
 * plancher de 75 000 € que `constructionCostModel` applique explicitement à
 * son propre calcul (ASCENSEUR_MIN). Les deux modules chiffraient donc la
 * même cage de part et d'autre d'une borne que l'un des deux considérait
 * comme infranchissable.
 */
export const ASCENSEUR_COUT_MIN_EUR = 75000;
