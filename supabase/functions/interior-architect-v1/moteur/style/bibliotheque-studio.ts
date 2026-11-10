/**
 * LOT INT-07 — Instantané des identifiants de la bibliothèque PBR du Studio.
 *
 * Source (lecture seule) : mimmozia-studio/src/core/materials/archvizLibrary.ts, relevé le 2026-11-06
 * (ids des appels `mat({ id: … })` et `peinture('…')`, dans l'ordre du fichier, sans doublon : les variantes
 * conditionnelles d'av-asphalte, av-moquette et av-tomettes portent le même id). Ce sont les SEULS identifiants de
 * matériaux autorisés dans src/style. tests/style.test.ts recoupe cet instantané avec le fichier du Studio quand
 * il est lisible (variable d'environnement MIMMOZIA_STUDIO_LIB, sinon le chemin de relevé).
 */
export const STUDIO_MATERIAL_IDS: readonly string[] = [
  'av-enduit-blanc', 'av-enduit-creme', 'av-beton-clair', 'av-beton-brut',
  'av-brique-rouge', 'av-brique-claire', 'av-pierre-calcaire', 'av-pierre-de-taille',
  'av-pierre-moulure', 'av-pierre-grise', 'av-bardage-bois-brun', 'av-bardage-bois-clair',
  'av-bardage-bois-noirci', 'av-panneaux-metalliques', 'av-zinc-facade', 'av-membrane-sombre',
  'av-zinc-anthracite', 'av-tuiles-terre-cuite', 'av-ardoise', 'av-toiture-vegetalisee',
  'av-chene-porte', 'av-bois-exterieur', 'av-rive-sombre', 'av-terrasse-bois',
  'av-beton-sol', 'av-pierre-sol', 'av-gravier', 'av-paves',
  'av-asphalte', 'av-gazon', 'av-prairie', 'av-terre',
  'av-cheminement', 'av-parquet', 'av-parquet-clair', 'av-carrelage',
  'av-beton-cire', 'av-mur-peint', 'av-mur-peint-sombre', 'av-bois-interieur',
  'av-metal-interieur', 'av-tissu-interieur', 'av-plafond', 'av-mur-peint-blanc-pur',
  'av-mur-peint-blanc-chaud', 'av-mur-peint-lin', 'av-mur-peint-grege', 'av-mur-peint-taupe',
  'av-mur-peint-gris-perle', 'av-mur-peint-anthracite', 'av-mur-peint-vert-eau', 'av-mur-peint-sauge',
  'av-mur-peint-olive', 'av-mur-peint-vert-foret', 'av-mur-peint-bleu-gris', 'av-mur-peint-bleu-nuit',
  'av-mur-peint-terracotta', 'av-mur-peint-ocre', 'av-mur-peint-rose', 'av-mur-enduit-chaux',
  'av-mur-beton-cire', 'av-mur-brique', 'av-mur-papier-peint', 'av-mur-lambris',
  'av-mur-faience', 'av-moquette', 'av-tomettes', 'av-parquet-batons-rompus',
  'av-carrelage-grand-format', 'av-verre-clair', 'av-verre-teinte', 'av-verre-depoli',
  'av-garde-corps-verre', 'av-persienne-metal', 'av-bois-peint-blanc', 'av-aluminium-blanc',
  'av-aluminium-noir', 'av-aluminium-bronze', 'av-aluminium-gris', 'av-acier',
  'av-acier-noir', 'av-feuillage', 'av-feuillage-clair', 'av-tronc',
  'av-arbuste', 'av-herbe-haute', 'av-fleurs',
];

const SET = new Set(STUDIO_MATERIAL_IDS);
export const isStudioMaterial = (id: string): boolean => SET.has(id);
