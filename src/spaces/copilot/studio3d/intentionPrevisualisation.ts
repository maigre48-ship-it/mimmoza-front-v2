// src/spaces/copilot/studio3d/intentionPrevisualisation.ts
//
// CH2 — « Génère la prévisualisation » dans le tchat ouvre la préparation du
// Studio 3D au lieu de partir vers le modèle. Il faut un verbe ET l'objet 3D.

const sansAccents = (t: string): string => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// CH3 — « studio » seul n'est un objet que juste après un verbe d'ouverture
// (« tu peux ouvrir studio ? », « ouvre studio »).
// CH4 — la marque s'écrit aussi « Mimmoza Studio » (sans i) ; un studio
// suivi de « à louer / à vendre / meublé / de 25 m² » reste une annonce.
const OUVERTURE_STUDIO = /\b(ouvre|ouvrir|ouvrez|lance|lancer|lancez|demarre|demarrer|demarrez|affiche|afficher|affichez)\s+(?:moi\s+|nous\s+)?(?:le\s+|l'|mon\s+|ton\s+|votre\s+)?(?:mimmozia\s+|mimmoza\s+)?studio\b(?!\s+(?:a louer|a vendre|meuble|de \d))/;

// Questions explicatives (« qu'est-ce que Studio ? », « comment fonctionne
// Studio ? ») : elles restent au modèle même si elles citent un verbe.
const QUESTION_EXPLICATIVE = /^\s*(qu'est-ce|qu'est ce|c'est quoi|comment|pourquoi|a quoi|quel|quelle|quels|quelles)\b/;

export function demandePrevisualisation(texte: string): boolean {
  const t = sansAccents(texte).replace(/[’`]/g, "'");
  if (QUESTION_EXPLICATIVE.test(t)) return false;
  if (OUVERTURE_STUDIO.test(t)) return true;
  const verbe = /\b(genere|generer|generez|lance|lancer|lancez|cree|creer|creez|fais|faire|faites|ouvre|ouvrir|prepare|preparer|montre|montrer|realise|realiser|je veux|j'aimerais|peux-tu|pouvez-vous)\b/.test(t);
  const objet = /\b(previsualisation|previsu|preview|maquette 3d|modele 3d|studio 3d|vue 3d|en 3d|rendu 3d|mimmozia studio|mimmoza studio)\b/.test(t);
  return verbe && objet;
}
