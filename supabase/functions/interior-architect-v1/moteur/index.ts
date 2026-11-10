/**
 * @mimmoza/interior-core — point d'entrée du paquet (INT-09c).
 *
 * Point d'entrée RECOMMANDÉ : `amenager(plan, brief, options)` (src/pipeline.ts), qui suppose les points d'eau
 * manquants en choisissant leur position selon le résultat de l'aménagement, puis enchaîne analyse → programme →
 * solveur → style → critique. Les étapes restent exportées pour les usages fins (tests, outils).
 * Exports explicites : deux modules définissent `ROLES_HUMIDES` (analyseur : rôles « à point d'eau » ; style :
 * pièces à sol humide) ; seul celui de l'analyseur est réexporté ici, sous son nom.
 */
export { amenager, MAX_CRITIQUES_PIECE } from './pipeline';
export type { ChoixGaine, OptionsAmenager, ResultatAmenager } from './pipeline';
export { analyzePlan, EQUIPEMENTS_EAU, ROLES_HUMIDES } from './analyzer';
export { buildProgram } from './programmer';
export { solveLayout } from './solver';
export { critique } from './critic';
export { applyStyle, buildStyleSheet, STYLES, STYLE_IDS, getStyle, STUDIO_MATERIAL_IDS, isStudioMaterial } from './style';
export type { StyleSheet, RoomStyle, OptionFinition, Revetement } from './style/types';
export { candidatsPointsEau, supposerPointsEau, COTE_GAINE_SUPPOSEE, MAX_CANDIDATS_PIECE } from './hypotheses/pointsEau';
export type { CandidatPointEau, CandidatsPiece, CandidatsPointsEau, PointsEauSupposes } from './hypotheses/pointsEau';
export { CATALOG, getSpec } from './data/catalog';
export { RULES } from './data/rules';
export type * from './types';
