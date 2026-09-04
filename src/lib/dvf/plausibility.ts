// =============================================================================
// DVF — bornes de plausibilité du prix au m² (côté front)
// =============================================================================
//
// ⚠️ MIROIR de `supabase/functions/_shared/dvf/stats.ts`, qui fait foi.
//
// Ces deux constantes y sont dupliquées faute de pouvoir partager du code entre
// les edge functions (Deno, imports par URL) et le front (Vite, résolution npm).
// Toute modification doit être portée des deux côtés — le fichier serveur en
// premier, puisque c'est lui qui filtre à la source.
//
// Pourquoi elles existent : le front retenait 300–40 000 €/m² là où les
// fonctions serveur bornaient à 500–25 000. Une mutation à 350 €/m² — typiquement
// une dépendance vendue avec sa surface bâtie — entrait donc dans la médiane de
// l'analyse rapide mais pas dans celle de l'étude de marché, pour le même bien.
// =============================================================================

/** Plancher du prix au m² habitable exploitable, en €. */
export const DVF_PRIX_M2_MIN = 500;

/** Plafond du prix au m² habitable exploitable, en €. */
export const DVF_PRIX_M2_MAX = 25000;

/** Le prix au m² est-il dans la plage exploitable ? */
export function prixM2Plausible(prixM2: number): boolean {
  return Number.isFinite(prixM2) && prixM2 >= DVF_PRIX_M2_MIN && prixM2 <= DVF_PRIX_M2_MAX;
}
