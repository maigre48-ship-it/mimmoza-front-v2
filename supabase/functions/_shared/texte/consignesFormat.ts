// supabase/functions/_shared/texte/consignesFormat.ts
// =============================================================================
// LOT F1 — Lisibilité : consignes de FORMAT injectées dans les prompts.
// -----------------------------------------------------------------------------
// Une seule source pour le chat (buildSystemPrompt, copilot-chat/index.ts) et
// pour les missions (systemeMission / doctrine, agent/prompt-promoteur.ts).
// Courtes et explicites : le filet de sécurité déterministe reste
// `mettreEnForme` (./miseEnForme.ts), appliqué au serveur et à l'affichage.
// =============================================================================

/** Section « Format de réponse » du prompt système du chat. */
export const FORMAT_REPONSE_CHAT = [
  '# FORMAT DE RÉPONSE — lisibilité (s\'applique à toutes tes réponses)',
  '- LA RÉPONSE D\'ABORD : tes 1 à 3 premières phrases répondent directement à la question posée (oui / non / le chiffre / la recommandation). Le détail vient ensuite. Quand une structure imposée commence par « ## Ce qu\'il faut retenir », la première phrase de cette section EST cette réponse.',
  '- Une énumération = une liste, UN élément PAR LIGNE, chaque ligne commençant par « - ». Jamais « (1) … ; (2) … » ni « 1. … 2. … » dans un même paragraphe.',
  '- Numérotation « 1. » seulement pour des étapes à suivre dans l\'ordre, une étape par ligne (sauf format imposé plus haut, comme les points en gras « **1. Titre.** »).',
  '- Aucun paragraphe de plus de 4 lignes : découpe, ou passe en liste.',
  '- Sous-titres courts (« ## … ») pour une réponse longue ; gras parcimonieux, réservé aux mots qui portent la décision.',
  '- Concision : aucune répétition. Ce qui a déjà été dit, affiché par une carte ou dans un tableau ne se redit pas.',
  '- Une question à l\'utilisateur : une phrase interrogative claire en premier, puis les options en liste « - », une par ligne.',
  // LOT D1 — une réponse longue s'affiche comme un DOCUMENT (conclusion encadrée, sections numérotées, réserves et sources en pied).
  '- Réponse longue (analyse, étude, bilan, estimation) : elle s\'affiche comme un document professionnel. Ordre : 1 à 3 phrases de conclusion SANS titre ; puis des sections « ## Titre » courtes et SANS numéro (la numérotation est automatique) ; chiffres comparés en tableau Markdown ; puis « ## Réserves » et « ## Sources » en dernier.',
].join('\n');

/** Consignes de format des textes de mission affichés (objectif, plan, questions, synthèse). */
export const FORMAT_TEXTES_MISSION = [
  '# FORMAT DES TEXTES AFFICHÉS À L\'UTILISATEUR',
  '- Objectif de mission (`proposer_mission`) : une phrase de synthèse, puis les points à traiter en liste, un par ligne commençant par « - ». Jamais « (1) … ; (2) … » en ligne.',
  '- Question (`demander_utilisateur`) : une phrase interrogative claire en premier, puis les options ou éléments repérés en liste « - », un par ligne.',
  '- Synthèse : la première phrase répond directement à l\'objectif ; une énumération passe en liste « - », un élément par ligne ; aucun paragraphe de plus de 4 lignes.',
].join('\n');
