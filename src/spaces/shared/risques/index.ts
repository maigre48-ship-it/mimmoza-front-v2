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
//   RisquesPage v1.4.0              : types + helpers + cartes → socle. ✅
//
// Les deux écrans consomment désormais le même exemplaire. RisquesPage a perdu
// ses 21 interfaces locales et ses neuf cartes jumelles (2584 → ~1660 lignes),
// et gagné au passage trois correctifs que seul le socle portait :
//   • « Zone null - » (séisme) et « Classe null - » (radon) ne s'impriment plus ;
//   • la couverture GASPAR est testée AVANT les décomptes ;
//   • un décompte issu d'une source muette se rend « — », pas « 0 ».
// Sa garde `pollution_sols` a été alignée sur celle d'Investisseur : « aucun
// site pollué » n'est affirmé que si la base SIS a répondu.
//
// ── Reste à trancher ────────────────────────────────────────────────────────
// Les deux écrans écrivent dans le même `patchModule("risks")` avec des
// libellés différents : RisquesPage compose « Score sécurité: X/100 - Commune »
// à la main, le socle expose `summarizeGlobalScore` qui rend « Étude de
// risques : X/100 de sécurité », sans la commune. Unifier suppose de choisir
// lequel des deux fait foi — arbitrage laissé ouvert, `summarizeGlobalScore`
// n'est donc pas encore consommé par RisquesPage.

export * from "./riskStudy.types";
export * from "./riskDisplay";
export * from "./RiskStudyCards";
export * from "./RiskErrorBoundary";
export * from "./riskReport";
