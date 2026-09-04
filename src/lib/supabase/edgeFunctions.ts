// =============================================================================
// EDGE FUNCTIONS — noms appelés par le front, et état de déploiement
// =============================================================================
//
// Pourquoi ce fichier existe
// --------------------------
// Les noms d'edge functions étaient des chaînes libres, écrites au fil de l'eau
// dans une trentaine de fichiers. Rien ne reliait ce que le front APPELLE à ce
// qui est réellement DÉPLOYÉ, et un nom périmé — une version bumpée sans
// redéploiement, une fonction jamais mise en ligne — produisait un 404 muet ou
// un repli silencieux que personne ne remarquait.
//
// Un contrôle du 29 août 2026 sur les 143 fonctions déployées a trouvé cinq
// appels sans cible. Ils sont listés ci-dessous, avec ce qu'il faut en faire.
//
// Comment s'en servir
// -------------------
// Importez `EDGE` plutôt que d'écrire le nom en dur. Quand un nom change,
// il change ici, et `NON_DEPLOYEES` documente ce qui est cassé plutôt que de
// le laisser se découvrir en production.
// =============================================================================

/**
 * Fonctions appelées par le front dont la CIBLE N'EXISTE PAS côté Supabase.
 *
 * Ce ne sont pas des noms à corriger mécaniquement : chacune demande une
 * décision. Elles sont nommées ici pour qu'un lecteur du code sache que
 * l'échec est connu, et non pour légitimer l'appel.
 */
export const NON_DEPLOYEES = {
  /**
   * 🔴 BLOQUANT — le parcours d'abonnement ne peut pas aboutir.
   *
   * `stripe-create-checkout` et `stripe-webhook` existent dans le dépôt
   * (`supabase/functions/`) mais n'ont JAMAIS été déployés : aucune fonction
   * contenant « stripe » n'est en ligne. Conséquences :
   *   • `createCheckoutSession` échoue → personne ne peut souscrire ;
   *   • le webhook n'existe pas → `billing_profiles` n'est jamais mis à jour
   *     par Stripe, ce qui explique en partie pourquoi le plan avait fini par
   *     être caché dans le localStorage côté front.
   * → ACTION : déployer les deux fonctions et configurer l'endpoint webhook
   *   dans Stripe. Rien à corriger dans le code appelant.
   */
  STRIPE_CHECKOUT: 'stripe-create-checkout',
  STRIPE_BILLING_PORTAL: 'stripe-billing-portal',

  /**
   * Narration du bilan promoteur. Jamais déployée, pas de source dans le
   * dépôt non plus. La page dégrade proprement (bilan sans texte généré).
   * → ACTION : écrire et déployer la fonction, ou retirer l'appel.
   */
  BILAN_NARRATIVE: 'promoteur-bilan-narrative-v1',

  /**
   * Données marché + risques agrégées. Jamais déployée. Le service retourne
   * déjà une réponse d'erreur propre et le panneau affiche son repli — le
   * comportement est donc correct, mais la fonctionnalité est absente.
   * → ACTION : déployer, ou rebrancher sur `risk-study-v1` + `market-study-*`.
   */
  MARKET_RISK: 'market-risk-v1',
} as const;

/**
 * Noms canoniques des fonctions RÉELLEMENT déployées et appelées par le front.
 * À compléter au fil des besoins — la liste n'a pas vocation à être exhaustive
 * de suite, mais tout nouveau nom devrait passer par ici.
 */
export const EDGE = {
  // ── Marché / veille ──────────────────────────────────────────────────────
  /**
   * Déduplication des annonces de veille.
   *
   * ⚠️ Le front appelait `market-dedupe-v3`, qui n'a jamais été déployé : seule
   * la v1 est en ligne. La déduplication ne tournait donc pas, et les doublons
   * d'annonces restaient dans la veille.
   */
  MARKET_DEDUPE: 'market-dedupe-v1',
  MARKET_PRICE_HISTORY: 'market-price-history-v1',
  MARKET_STOCK_HISTORY: 'market-stock-history-v1',
  MARKET_METRICS_ZONE: 'market-metrics-zone-v1',
  MARKET_OPPORTUNITY_REFRESH: 'market-opportunity-refresh-v1',
  MARKET_REFRESH_ZONE: 'market-refresh-zone-v1',
  MARKET_STUDY_INVESTISSEUR: 'market-study-investisseur-v1',
  MARKET_STUDY_PROMOTEUR: 'market-study-promoteur-v1',

  // ── Données publiques ────────────────────────────────────────────────────
  LOYERS_REFERENCE: 'loyers-reference-v1',
  DVF_COMPARABLES: 'dvf-comparables-v1',
  RISK_STUDY: 'risk-study-v1',
  BANQUE_RISQUES: 'banque-risques-v1',
  SMARTSCORE: 'smartscore-enriched-v3',
  CONTACTS_MAIRIES: 'recherche-contacts-mairies-v1',
} as const;
