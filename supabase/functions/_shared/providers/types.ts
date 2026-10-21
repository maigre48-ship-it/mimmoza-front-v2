// Types communs des fournisseurs de données (smartscore-enriched-v3).
// Fichier recréé le 21/10/2026 : il était importé mais absent des deux dépôts,
// ce qui empêchait de redéployer smartscore-enriched-v3 depuis le code source.

/** État de couverture d'une source pour une adresse donnée. */
export type Coverage = "ok" | "no_data" | "not_covered" | "error";
