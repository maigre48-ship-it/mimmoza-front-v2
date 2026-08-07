// src/spaces/shared/risques/index.ts
// Point d'entrée du socle partagé de l'étude de risques.
// Consommé par :
//   • src/spaces/promoteur/etudes/risques/RisquesPage.tsx
//   • src/spaces/investisseur/pages/analyse/InvestisseurRisquesPanel.tsx
//
// Ces deux écrans étaient des clones. Toute correction de nullabilité ne
// s'appliquait qu'à l'un des deux ; le second continuait de présenter une
// donnée absente comme un fait. Le socle supprime ce chemin de divergence.

// ── État de la mutualisation ────────────────────────────────────────────────
//   InvestisseurRisquesPanel v1.4.0 : types + helpers + cartes → socle. ✅
//   RisquesPage v1.3.1          : helpers + niveauAleaToDb → socle. ✅
//                                 types et cartes encore locaux. ⏳
// RESTE À FAIRE : supprimer de RisquesPage ses interfaces locales et ses neuf
// composants de présentation au profit de ceux d'ici. Tant que ce n'est pas
// fait, `RiskStudyCards.tsx` et RisquesPage contiennent deux rendus jumeaux —
// le socle ne protège de la divergence que les écrans qui le consomment.
// Les cartes du socle vont plus loin que celles de RisquesPage sur trois
// points, à reporter lors de la bascule : couverture GASPAR testée AVANT les
// décomptes, décomptes de sources muettes rendus « — », et « Zone null - » /
// « Classe null » supprimés.

export * from "./riskStudy.types";
export * from "./riskDisplay";
export * from "./RiskStudyCards";
