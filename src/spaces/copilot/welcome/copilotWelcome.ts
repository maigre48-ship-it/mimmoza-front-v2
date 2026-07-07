// src/spaces/copilot/welcome/copilotWelcome.ts
// Bot scripte de la page d'accueil : questions/reponses predefinies, 0 IA, 0 credit.

/** Page d'accueil post-connexion. Ajuste si ta home a une autre route. */
export function isLandingRoute(pathname: string): boolean {
  return pathname === '/dashboard' || pathname === '/' || pathname === '';
}

export interface ScriptedQA {
  key: string;
  q: string;
  a: string;
}

export const COPILOT_HOME = {
  title: 'Bienvenue sur Mimmoza',
  intro:
    "Je suis votre guide. Mimmoza transforme une adresse, une parcelle ou un projet en analyse decisionnelle en moins de 2 minutes. Choisissez une question ci-dessous.",
  askAILabel: "Parler à l'Analyste Mimmoza",
  qa: [
    {
      key: 'how',
      q: 'Comment fonctionne Mimmoza ?',
      a: "Entrez une adresse, une parcelle ou une ville dans la barre de recherche, puis lancez l'analyse. Mimmoza croise les donnees publiques (PLU, DVF, INSEE, IGN, Georisques...) pour produire un diagnostic complet : urbanisme, faisabilite, marche, rentabilite, risques et valorisation.",
    },
    {
      key: 'rapide',
      q: "Qu'est-ce que l'analyse rapide ?",
      a: "C'est le diagnostic instantane d'une adresse : score d'opportunite, valeur estimee par le moteur Mimmoza et qualite d'emplacement. Ideal pour une premiere lecture avant d'aller plus loin dans un espace metier.",
    },
    {
      key: 'spaces',
      q: 'Quels sont les espaces disponibles ?',
      a: "Quatre espaces, chacun avec ses outils : Investisseur (rentabilite, sourcing), Promoteur (faisabilite, massing 3D), Rehabilitation (analyse de plans, travaux) et Apporteur. Choisissez celui qui correspond a votre metier dans le menu du haut.",
    },
    {
      key: 'data',
      q: 'Quelles donnees utilisez-vous ?',
      a: "Uniquement des sources publiques officielles : DVF (transactions), PLU (urbanisme), INSEE (socio-economie), IGN (terrain/relief), Georisques (risques), BPE (equipements) et d'autres. Elles sont croisees et enrichies par les moteurs Mimmoza.",
    },
    {
      key: 'start',
      q: 'Comment lancer une premiere analyse ?',
      a: "Tapez une adresse dans la barre de recherche au centre de la page, puis cliquez sur \u00ab Analyse rapide \u00bb. Vous obtenez en quelques secondes un premier diagnostic, que vous pouvez ensuite approfondir.",
    },
    {
      key: 'copilot',
      q: "L'Analyste Mimmoza, c'est quoi ?",
      a: "Une fois une parcelle selectionnee dans un espace metier, l'Analyste Mimmoza repond a vos questions precises (zone PLU, reculs, hauteur, comparables...) et peut lancer des analyses. Ici, sur l'accueil, il n'y a pas encore de parcelle : je reste donc un guide.",
    },
  ] as ScriptedQA[],
};