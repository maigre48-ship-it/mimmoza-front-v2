// =============================================================
// Mimmoza · PLU Engine — Noms de tables (centralisés)
// Préfixe plu_engine_ : isole le socle de la table plu_rulesets historique.
// =============================================================

export const PLU_TABLES = {
  registry: 'plu_engine_registry',
  rulesets: 'plu_engine_rulesets',
  updateChecks: 'plu_engine_update_checks',
  opportunityCache: 'plu_engine_opportunity_cache',
} as const;