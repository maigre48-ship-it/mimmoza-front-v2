// supabase/functions/copilot-chat/agent/choix.ts
// =============================================================
// LOT CHOIX-CLIQUABLES (06/11/2026) — réponses cliquables aux questions à choix de Mimmo.
//
// Le front (src/spaces/copilot/utils/choixCliquables.ts) remplace un bloc ```mimmoza-choix
// placé en fin de réponse par des puces : cliquer écrit la réponse dans le champ de saisie
// (« Façade : Brique · Balcons : Loggias »), l'utilisateur complète puis envoie. Un bloc invalide
// est ignoré par le front : la question doit rester lisible dans le texte, sans le bloc.
// Les bornes ci-dessous sont celles du validateur du front (mêmes valeurs).
// =============================================================

export const LANGUE_BLOC_CHOIX = 'mimmoza-choix';
export const CHOIX_QUESTIONS_MAX = 6;
export const CHOIX_OPTIONS_MAX = 10;
export const CHOIX_OPTION_LONGUEUR_MAX = 60;

/** Règle de format, ajoutée au prompt système du chat (index.ts, buildSystemPrompt). */
export const CONSIGNE_CHOIX = [
  'QUESTIONS À CHOIX — RÉPONSES CLIQUABLES. Quand tu poses une ou plusieurs questions à choix FERMÉS (options connues d’avance), ' +
    'écris la question normalement, lisible sans aide (jamais de liste « (1)… (2)… » en ligne, n’invente pas de numérotation des options), ' +
    `puis termine ta réponse — tout à la fin, après un éventuel bloc mimmoza-3d — par UN bloc \`\`\`${LANGUE_BLOC_CHOIX} contenant UNIQUEMENT du JSON :`,
  '```' + LANGUE_BLOC_CHOIX,
  '{"v":1,"questions":[{"id":"programme","libelle":"Programme","options":["Logements","Bureaux","Mixte"],"multiple":false,"defaut":"Logements"}],"libre":true,"a_toi_de_choisir":true}',
  '```',
  `Bornes : 1 à ${CHOIX_QUESTIONS_MAX} questions ; id court et unique (lettres, chiffres, _ ou -) ; libelle de 60 caractères au plus ; ` +
    `2 à ${CHOIX_OPTIONS_MAX} options COURTES (${CHOIX_OPTION_LONGUEUR_MAX} caractères au plus, sans « · », sans doublon) ; ` +
    'multiple: true seulement si plusieurs réponses ont un sens ; defaut (facultatif) : ta suggestion, prise parmi les options ; ' +
    'libre: true si l’utilisateur peut préciser en texte ; a_toi_de_choisir: true si tu peux décider à sa place. ' +
    'L’utilisateur voit des boutons ; sa réponse arrive sous la forme « Libellé : option · Libellé : option », parfois suivie de précisions, ' +
    'ou « À toi de choisir » : lis-la comme une réponse normale. Pas de bloc pour une question ouverte (adresse, montant, texte libre) ' +
    'ni pour l’accord sur un devis (sa carte a ses boutons). Ne présente jamais ce JSON comme du texte à lire. ' +
    'Exception : l’HABILLAGE d’un rendu Studio (façade, balcons, attique, rez-de-chaussée, ambiance) ne se demande jamais ainsi — ' +
    'appelle studio_lancer_rendu, qui affiche sa propre carte.',
].join('\n');
