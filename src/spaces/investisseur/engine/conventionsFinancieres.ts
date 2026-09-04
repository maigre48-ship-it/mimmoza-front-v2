// =============================================================================
// CONVENTIONS FINANCIÈRES — ce qui s'unifie, et ce qui ne doit surtout pas
// =============================================================================
//
// L'audit relevait « trois dénominateurs de rendement, quatre formules de TRI,
// deux conventions de marge ». Après lecture, ces trois constats n'appellent
// pas le même traitement — et les confondre produirait des chiffres faux.
//
// 1. TRI ANNUALISÉ — vraie duplication, corrigée ici.
//    `computeTriAnnualise` existait en DEUX COPIES littéralement identiques
//    dans FinancialEngineTab.tsx et InvestmentPackTab.tsx. Rien ne garantissait
//    qu'elles restent synchronisées. Elles sont remplacées par la fonction
//    ci-dessous.
//
//    Les autres « TRI » du code ne sont pas des doublons :
//      • rentabilite.engine.ts   → rendement linéaire sur coût total, assumé
//      • strategyEngine.ts       → vrai TRI par dichotomie sur les flux equity
//    Ce sont trois indicateurs différents. Le défaut n'est pas qu'ils
//    coexistent, c'est qu'ils portaient tous le nom « TRI » à l'écran.
//
// 2. TAUX DE MARGE — divergence LÉGITIME, à ne pas unifier.
//    Le promoteur calcule marge / chiffre d'affaires ; le marchand de biens
//    calcule marge / coût de revient. Ce sont les deux conventions du métier,
//    et les forcer à une seule rendrait les chiffres faux pour l'un des deux.
//    Le vrai risque est ailleurs : 15 % promoteur ≈ 17,6 % marchand, et les
//    seuils de décision étaient comparés entre eux comme s'ils étaient
//    homogènes. D'où les helpers de conversion explicites ci-dessous, à
//    utiliser dès qu'une marge franchit la frontière entre deux espaces.
//
// 3. RENDEMENT NET — un seul site vivant.
//    Les abattements 0,75 / 0,77 / 0,78 relevés par l'audit se répartissaient
//    entre `opportunityEngine` (vivant), `valuationEngine.service.ts` (code
//    mort, aucun import) et l'edge function `valuation-engine` (serveur, hors
//    de portée du front). Il n'y avait donc pas trois conventions en
//    production, mais une seule côté client — celle du moteur d'opportunités.
//    Elle est nommée ici plutôt que laissée en nombre magique.
// =============================================================================

/**
 * TRI annualisé approché, à partir d'un apport et d'une marge de sortie.
 *
 * Hypothèse : un flux sortant unique en t=0 (l'apport) et un flux entrant
 * unique en t=N (apport + marge). C'est une approximation — elle ignore les
 * flux intermédiaires — mais elle est cohérente et rapide pour comparer des
 * scénarios de revente.
 *
 * Retourne `null`, jamais 0, quand le calcul n'a pas de sens : sans apport,
 * sans durée, ou quand les fonds propres sont entièrement détruits.
 */
export function triAnnualisePct(
  apport: number,
  margeBrute: number,
  dureeAnnees: number,
): number | null {
  const a = Number(apport) || 0;
  const duree = Number(dureeAnnees) || 0;
  if (a <= 0 || duree <= 0) return null;

  const fluxFinal = a + (Number(margeBrute) || 0);
  if (fluxFinal <= 0) return null;

  return (Math.pow(fluxFinal / a, 1 / duree) - 1) * 100;
}

/**
 * Abattement forfaitaire du rendement brut vers le rendement net.
 *
 * Couvre charges non récupérables, taxe foncière, gestion et vacance. C'est un
 * ordre de grandeur de dégrossissage, pas un calcul fiscal : dès que les
 * charges réelles sont saisies, c'est le moteur de rentabilité qui fait foi.
 */
export const ABATTEMENT_RENDEMENT_NET = 0.75;

/** Rendement net indicatif à partir d'un rendement brut, en points de %. */
export function rendementNetIndicatifPct(rendementBrutPct: number): number | null {
  const brut = Number(rendementBrutPct);
  if (!Number.isFinite(brut) || brut <= 0) return null;
  return brut * ABATTEMENT_RENDEMENT_NET;
}

// ─── Conversion entre conventions de marge ───────────────────────────────────

/**
 * Convertit une marge exprimée en % du CHIFFRE D'AFFAIRES (convention
 * promoteur) vers un % du COÛT DE REVIENT (convention marchand).
 *
 * 15 % de CA correspond à ≈ 17,6 % de coût. Sans cette conversion, comparer
 * un bilan promoteur à un seuil marchand sous-estime la performance.
 */
export function margeCaVersCout(margeSurCaPct: number): number | null {
  const m = Number(margeSurCaPct);
  if (!Number.isFinite(m) || m >= 100) return null;
  return (m / (100 - m)) * 100;
}

/** Conversion inverse : marge en % du coût de revient → % du CA. */
export function margeCoutVersCa(margeSurCoutPct: number): number | null {
  const m = Number(margeSurCoutPct);
  if (!Number.isFinite(m) || m <= -100) return null;
  return (m / (100 + m)) * 100;
}
