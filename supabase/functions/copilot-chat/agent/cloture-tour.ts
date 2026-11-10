// supabase/functions/copilot-chat/agent/cloture-tour.ts
// =============================================================
// Lot C1 « synthèse finale » (essai témoin du 10/11/2026, Montreuil).
//
// Constat : quand la boucle d'outils du chat s'arrête sur l'échéance ou sur le
// plafond d'itérations, la passe finale (sans outils) recevait l'historique tel
// quel. Le modèle ne savait pas que c'était sa dernière passe : il annonçait
// encore une lecture (« je les lis en parallèle… ») et tentait un outil. La
// réponse se terminait sans aucune conclusion, pour 38 jetons.
//
// Ce module est PUR (aucun accès réseau, aucune dépendance) :
//   · avecConsigneCloture : ajoute la consigne de clôture au dernier message
//     utilisateur (celui qui porte les résultats d'outils), sans muter l'entrée ;
//   · AVIS_SANS_CONCLUSION : texte affiché si, malgré la consigne, la passe
//     finale ne rédige rien ou réclame encore un outil.
// =============================================================

export const CONSIGNE_CLOTURE_TOUR =
  "[NOTE DU SERVEUR — pas un message de l'utilisateur] Le temps ou le nombre d'étapes de cette réponse est épuisé : " +
  "plus AUCUN outil ni aucune lecture ne sera exécuté dans cette réponse. Rédige MAINTENANT la réponse finale avec ce " +
  "que tu as déjà obtenu. D'abord ce qui est établi, avec sa source. Ensuite, sous le titre « ## Ce qui manque », la " +
  "liste de ce qui a été demandé et n'a PAS pu être obtenu dans cette réponse, et pour chaque point comment l'obtenir " +
  "(relancer la demande sur ce seul point, joindre le document, lancer une mission). N'annonce aucune action à venir " +
  "(« je lis », « je lance », « je consulte ») : rien d'autre ne sera exécuté. N'invente aucune donnée manquante.";

export const AVIS_SANS_CONCLUSION =
  "\n\n_[Réponse interrompue avant sa conclusion : le temps alloué à cette réponse est épuisé. Les cartes ci-dessus " +
  "restent valables, mais la synthèse n'a pas été rédigée. Relancez la demande sur un seul point à la fois, ou " +
  "demandez une mission pour une étude complète.]_";

interface MessageMinimal { role: string; content: unknown }

/**
 * Renvoie une COPIE de `messages` où le dernier message utilisateur porte en plus la consigne de clôture.
 *   · dernier message 'user' à contenu tableau (résultats d'outils) : un bloc texte est ajouté APRÈS les blocs existants ;
 *   · dernier message 'user' à contenu texte : la consigne est ajoutée à la suite ;
 *   · sinon (dernier message 'assistant', liste vide) : la liste est renvoyée telle quelle — on n'insère jamais un
 *     message utilisateur derrière un tour assistant en cours (reprise `pause_turn`).
 * L'entrée n'est jamais mutée.
 */
export function avecConsigneCloture<M extends MessageMinimal>(messages: M[]): M[] {
  const dernier = messages[messages.length - 1];
  if (!dernier || dernier.role !== 'user') return messages;
  const bloc = { type: 'text', text: CONSIGNE_CLOTURE_TOUR };
  let contenu: unknown;
  if (Array.isArray(dernier.content)) contenu = [...dernier.content, bloc];
  else if (typeof dernier.content === 'string') contenu = `${dernier.content}\n\n${CONSIGNE_CLOTURE_TOUR}`;
  else return messages;
  return [...messages.slice(0, -1), { ...dernier, content: contenu }];
}

/**
 * Vrai si la passe finale n'a pas produit de conclusion exploitable : aucun texte, ou arrêt sur une demande d'outil
 * (qui ne sera pas exécutée). `pause_turn` est traité à part par l'appelant.
 */
export function clotureSansConclusion(texteCloture: string, raisonArret: string): boolean {
  if (raisonArret === 'pause_turn') return false;
  return raisonArret === 'tool_use' || !texteCloture.trim();
}
