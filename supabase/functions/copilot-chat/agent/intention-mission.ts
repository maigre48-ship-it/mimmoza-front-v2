// supabase/functions/copilot-chat/agent/intention-mission.ts
// =============================================================
// Intention « mission » dans le chat (logique pure, testée).
//
// Incident du 02/11 : « trouve les 4 meilleurs terrains pour faire un immeuble
// social de 40 logements à Nanterre » → le chat a fait lui-même rechercher +
// SRU + 4 get_etude_parcelle, puis a proposé la mission EN TEXTE, sans carte de
// devis. Deux garde-fous déterministes :
//   1. detecterIntentionMission : une demande multi-terrains (prospection,
//      « les N meilleurs », comparaison, dossier multi-parcelles) restreint le
//      tour aux outils de cadrage + proposer_mission, qui devient obligatoire
//      après au plus un tour de cadrage ;
//   2. proposeMissionEnTexte : filet si la réponse finale propose une mission
//      en texte sans avoir appelé l'outil → un tour forcé sur proposer_mission.
// =============================================================

import type { TypeMission } from './types.ts';

export interface IntentionMission {
  mission: boolean;
  type?: TypeMission;
  motif?: string;
}

/** Minuscules, sans accents, apostrophes et tirets normalisés. */
export function normaliser(t: string): string {
  return (t ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Objets fonciers au PLURIEL (ou nombre ≥ 2 devant).
const NOMS = '(?:terrains?|parcelles?|fonciers?|emprises?|sites?|lots?|tenements?|unites? foncieres?)';
const PLURIEL = '(?:terrains|parcelles|fonciers|emprises|sites|tenements|unites foncieres)';
const NOMBRE = '(?:[2-9]|[1-9]\\d|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|quelques|plusieurs)';

const RE_REFUS = /\b(sans (?:lancer (?:de |une )?)?mission|pas de mission|ne lance pas de mission|hors mission|(?:fais|faites|reponds|repondez)[- ]?(?:le|la|les|moi)? (?:ici|directement|dans le chat))\b/;
const RE_MISSION_EXISTANTE = /\b(etat|statut|avancement|resultat|ou en est|annule|annuler)\b[^.?!]{0,30}\bmission\b|\bmes missions\b/;

const RE_CHERCHER = new RegExp(
  `\\b(?:trouve|trouver|trouvez|cherche|chercher|cherchez|recherche|rechercher|identifie|identifier|identifiez|` +
  `selectionne|selectionner|repere|reperer|reperez|deniche|denicher|propose|proposez|proposer|liste|lister|listez|` +
  `donne|donnez|sors|sortez|quels sont|quelles sont|ou (?:puis|peut|pourrais|pourrait)[- ](?:je|on)? ?(?:construire|faire|batir|realiser))\\b`);
// « les 4 meilleurs terrains », « top 5 des parcelles »… (classement explicite).
const RE_MEILLEURS = new RegExp(
  `\\b(?:${NOMBRE} )?(?:meilleur(?:e)?s|plus (?:beaux|interessants|adaptes|pertinents)|top ?\\d*)\\b[^.?!]{0,40}\\b${NOMS}`);
// « trouve-moi des terrains », « cherche 3 parcelles » : verbe de recherche FORT + pluriel indéfini ou nombre.
const RE_CHERCHER_FORT = /\b(?:trouve|trouver|trouvez|cherche|chercher|cherchez|recherche|rechercher|identifie|identifier|identifiez|selectionne|selectionner|repere|reperer|reperez|deniche|denicher)\b/;
const RE_INDEFINI = new RegExp(`\\b(?:${NOMBRE}|des|d'autres) ${PLURIEL}\\b`);
const RE_PROSPECTION = /\bprospect(?:ion|er|e|ez|ons)\b/;
const RE_FONCIER = new RegExp(`\\b${NOMS}\\b|\\bfonciere?\\b|\\bcommunes?\\b|\\bsecteur\\b`);
const RE_COMPARER = /\b(?:compar\w*|classe(?:r|ment|z)?|departage\w*|hierarchise\w*|lequel est le meilleur|laquelle est la meilleure|quel est le meilleur|quelle est la meilleure)\b/;
const RE_PLUSIEURS = new RegExp(
  `\\b(?:${NOMBRE}) ${NOMS}\\b|\\b${PLURIEL}\\b|\\bces (?:${NOMBRE} )?${NOMS}\\b|\\b(?:entre|parmi) (?:ces|les|mes)\\b`);
const RE_DOSSIER = /\b(?:dossier complet|dossiers complets|faisabilite|etude complete|etudes completes|instruire|instruction)\b/;
const RE_MULTI = new RegExp(`\\bmulti[- ]?(?:parcelles?|sites?|terrains?)\\b|\\b(?:${NOMBRE}) ${NOMS}\\b|\\bchacun(?:e)? des\\b|\\bces ${PLURIEL}\\b`);

/**
 * Vrai pour une demande qui, par nature, dépasse le chat : prospection
 * foncière, « les N meilleurs terrains », comparaison/classement de plusieurs
 * terrains, dossier complet ou faisabilité sur plusieurs parcelles.
 * Faux pour une parcelle unique, une question de marché, une demande d'état de
 * mission, ou quand l'utilisateur refuse explicitement la mission.
 */
export function detecterIntentionMission(message: string): IntentionMission {
  const t = normaliser(message);
  if (!t || t.length < 12) return { mission: false };
  if (RE_REFUS.test(t)) return { mission: false, motif: 'refus explicite de mission' };
  if (RE_MISSION_EXISTANTE.test(t)) return { mission: false, motif: 'question sur une mission existante' };

  if (RE_COMPARER.test(t) && RE_PLUSIEURS.test(t)) {
    return { mission: true, type: 'faisabilite', motif: 'comparaison de plusieurs terrains' };
  }
  if (RE_DOSSIER.test(t) && RE_MULTI.test(t)) {
    return { mission: true, type: 'faisabilite', motif: 'dossier complet multi-parcelles' };
  }
  if (RE_PROSPECTION.test(t) && RE_FONCIER.test(t)) {
    return { mission: true, type: 'prospection_fonciere', motif: 'prospection foncière' };
  }
  if ((RE_CHERCHER.test(t) && RE_MEILLEURS.test(t)) || (RE_CHERCHER_FORT.test(t) && RE_INDEFINI.test(t))) {
    return { mission: true, type: 'prospection_fonciere', motif: 'recherche de plusieurs terrains' };
  }
  return { mission: false };
}

/**
 * Vrai si la réponse PROPOSE une mission en texte (« Souhaitez-vous que je
 * lance une mission… ? »). Ne compte pas « mission de service public » ni
 * « lettre de mission ».
 */
export function proposeMissionEnTexte(texte: string): boolean {
  const t = normaliser(texte)
    .replace(/missions? de service public/g, '')
    .replace(/lettres? de mission/g, '')
    .replace(/charges? de mission/g, '');
  if (!/\bmission\b/.test(t)) return false;
  return /\b(?:souhaitez|voulez|souhaites|veux|aimeriez|desirez)[- ]vous\b[^?]{0,160}\bmission\b/.test(t)
    || /\b(?:souhaites|veux)[- ]tu\b[^?]{0,160}\bmission\b/.test(t)
    || /\b(?:je (?:peux|pourrais|vous propose de|te propose de)|nous pouvons|on peut)\b[^.?!]{0,80}\bmission\b/.test(t)
    || /\b(?:lancer|lance|lancons|confier|declencher|ouvrir|programmer)\b[^.?!]{0,50}\bmission (?:approfondie|autonome|complete|de prospection|d'instruction|d'etude|foncier)/.test(t);
}

/** Outils autorisés pendant un tour « intention mission » (cadrage léger + agent). */
export const OUTILS_CADRAGE_MISSION: ReadonlySet<string> = new Set([
  'rechercher_parcelles', 'get_logement_social', 'get_contexte_commune', 'get_zonage_abc',
  'get_parcelle_depuis_adresse',
  'proposer_mission', 'etat_mission', 'lister_missions', 'memoriser',
]);

/** Consigne ajoutée au prompt système quand l'intention est détectée. */
export function consigneIntentionMission(i: IntentionMission): string {
  return [
    '# DEMANDE MULTI-TERRAINS DÉTECTÉE PAR LE SERVEUR' + (i.motif ? ` (${i.motif})` : ''),
    'Cette demande relève d\'une MISSION : tu appelles `proposer_mission` dans ce tour (type suggéré : ' +
      `${i.type ?? 'prospection_fonciere'}).`,
    '- Avant, AU PLUS un appel de cadrage léger (rechercher_parcelles, get_logement_social…) s\'il précise utilement les critères. Les études détaillées (get_etude_parcelle, marché, DVF, risques) ne sont pas disponibles dans ce tour : la mission les fera.',
    '- Objectif précis et critères complets : commune(s), programme, nombre de logements, part sociale, surfaces, zonage, nombre de terrains voulus, contraintes citées.',
    '- Ensuite, réponds en 3 à 6 lignes : ce que la mission va faire, les critères retenus, le devis affiché à valider (bouton « Lancer la mission »). Si le cadrage a donné des candidats, cite-les sans les classer ni conclure. Ne dis jamais que la mission a démarré.',
    '- S\'il manque une information indispensable (la commune, par exemple), pose UNE question au lieu d\'appeler l\'outil.',
  ].join('\n');
}

/** Message « utilisateur » technique du tour de rattrapage (filet). */
export const CONSIGNE_FILET_MISSION =
  "[NOTE DU SERVEUR — pas un message de l'utilisateur] Ta réponse propose une mission en texte, mais aucun devis " +
  "n'a été affiché : sans l'outil, l'utilisateur ne peut pas la lancer. Appelle maintenant `proposer_mission` avec " +
  "un objectif précis et les critères de cette demande. N'écris rien d'autre.";

/** Texte affiché après la carte de devis produite par le filet. */
export const TEXTE_APRES_FILET_MISSION =
  '\n\nLe devis de cette mission est affiché ci-dessous : rien n\'est lancé ni débité tant que vous ne le validez pas.';
