// src/lib/billing/actionCosts.ts
// Source de verite FRONT des couts en jetons par action IA.
// Sert a : afficher les prix + piloter spendCredits cote client.
//
// ATTENTION SYNCHRO : le Copilot debite cote serveur via CREDIT_COST
// dans supabase/functions/copilot-chat/index.ts. Si tu changes
// copilot_quick ou copilot_advanced ici, change AUSSI CREDIT_COST la-bas.
// Les deux doivent toujours correspondre, sinon affichage != debit reel.

export const ACTION_COSTS = {
  copilot_quick:      3,
  copilot_advanced:   15,
  analyse_rapide:     3,
  facade_low:         10,
  facade_medium:      20,
  facade_high:        40,
  scan_opportunites:  5,    // lecture portal_snapshots + scoring (data deja en base)
  refresh_veille:     30,   // ingestion Stream Estate (~0,50 â‚¬ reel, marge ~x2)
  rendu_ia:           15,   // rendu IA avant/apres (aligne facade ; cout API a confirmer au branchement)
} as const;

export type ActionCostKey = keyof typeof ACTION_COSTS;

/** Cout en jetons d'une facade selon la qualite choisie. */
export function facadeCost(quality: "low" | "medium" | "high"): number {
  return ACTION_COSTS[`facade_${quality}` as ActionCostKey];
}

/** Cout total d'un scan Opportunites, avec ou sans rafraichissement Stream Estate. */
export function opportunityScanCost(withIngest: boolean): number {
  return ACTION_COSTS.scan_opportunites + (withIngest ? ACTION_COSTS.refresh_veille : 0);
}