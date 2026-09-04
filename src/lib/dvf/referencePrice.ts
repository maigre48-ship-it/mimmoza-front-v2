// =============================================================================
// PRIX DE RÉFÉRENCE — une seule règle d'arbitrage entre sources
// =============================================================================
//
// Le désordre corrigé
// -------------------
// Trois écrans du même parcours choisissaient leur prix au m² de référence
// dans trois ordres différents :
//
//   useValuationEngine        SmartScore  >  DVF
//   PromoteurSynthesePage     DVF local   >  étude de marché
//   EvaluationPage            SmartScore  >  étude de marché  >  DVF local
//
// Le €/m² affiché changeait donc selon l'onglet ouvert, pour le même bien.
//
// La règle retenue, et pourquoi
// -----------------------------
// Deux critères, dans cet ordre :
//
//   1. PÉRIMÈTRE — le plus étroit gagne. Une médiane calculée sur la parcelle
//      et ses abords décrit mieux le bien qu'une médiane communale, qui
//      elle-même bat une médiane départementale. C'est la seule hiérarchie qui
//      était déjà argumentée dans le code (PromoteurSynthesePage la
//      documentait explicitement), et c'est la seule qui repose sur un fait
//      vérifiable plutôt que sur une préférence d'écran.
//
//   2. DIRECTITUDE, à périmètre égal — une médiane DVF mesurée bat un score
//      dérivé. `SmartScore.localPricePerSqm` est lui-même calculé À PARTIR de
//      DVF : le préférer à DVF, c'est préférer une donnée retraitée à sa
//      source, sans rien y gagner.
//
// Un nombre suffisant de transactions départage à égalité : sous
// MIN_VENTES_FIABLE, la source est jugée fragile et cède devant une source
// plus fournie de périmètre immédiatement supérieur.
// =============================================================================

/** Périmètres géographiques, du plus étroit au plus large. */
export type PerimetrePrix = 'parcelle' | 'quartier' | 'commune' | 'departement' | 'national';

const RANG_PERIMETRE: Record<PerimetrePrix, number> = {
  parcelle: 0,
  quartier: 1,
  commune: 2,
  departement: 3,
  national: 4,
};

/** Nature de la mesure, du plus direct au plus dérivé. */
export type NaturePrix = 'dvf_mesure' | 'etude_marche' | 'score_derive' | 'bareme';

const RANG_NATURE: Record<NaturePrix, number> = {
  dvf_mesure: 0,
  etude_marche: 1,
  score_derive: 2,
  bareme: 3,
};

/** En dessous, l'échantillon est jugé trop mince pour primer sur mieux fourni. */
export const MIN_VENTES_FIABLE = 5;

export interface CandidatPrix {
  /** Prix au m², en €. Ignoré si absent ou non positif. */
  prixM2: number | null | undefined;
  perimetre: PerimetrePrix;
  nature: NaturePrix;
  /** Nombre de transactions ayant servi au calcul, si connu. */
  nbVentes?: number | null;
  /** Libellé affichable de la source. */
  label: string;
}

export interface PrixReference {
  prixM2: number;
  perimetre: PerimetrePrix;
  nature: NaturePrix;
  label: string;
  /** true si l'échantillon est sous MIN_VENTES_FIABLE — à signaler à l'écran. */
  echantillonFaible: boolean;
}

/**
 * Choisit le prix de référence parmi plusieurs candidats.
 *
 * Retourne `null` quand aucun candidat n'est exploitable — plutôt qu'un
 * chiffre dont personne ne saurait dire d'où il vient.
 */
export function choisirPrixReference(candidats: readonly CandidatPrix[]): PrixReference | null {
  const valides = candidats.filter(
    (c) => typeof c.prixM2 === 'number' && Number.isFinite(c.prixM2) && c.prixM2 > 0,
  );
  if (valides.length === 0) return null;

  const trie = [...valides].sort((a, b) => {
    const fragileA = (a.nbVentes ?? Infinity) < MIN_VENTES_FIABLE ? 1 : 0;
    const fragileB = (b.nbVentes ?? Infinity) < MIN_VENTES_FIABLE ? 1 : 0;
    // Un échantillon trop mince recule d'un cran, sans jamais passer devant
    // une source de périmètre plus étroit ET correctement fournie.
    const rangA = RANG_PERIMETRE[a.perimetre] + fragileA;
    const rangB = RANG_PERIMETRE[b.perimetre] + fragileB;
    if (rangA !== rangB) return rangA - rangB;

    // À rang égal, la source correctement fournie l'emporte : c'est tout
    // l'objet de la pénalité ci-dessus. Sans ce départage, une médiane sur
    // deux ventes de quartier battait encore une médiane communale sur
    // soixante, l'égalité étant tranchée par l'ordre d'écriture des candidats.
    if (fragileA !== fragileB) return fragileA - fragileB;

    if (RANG_NATURE[a.nature] !== RANG_NATURE[b.nature]) {
      return RANG_NATURE[a.nature] - RANG_NATURE[b.nature];
    }

    // Dernier départage : le plus gros échantillon.
    return (b.nbVentes ?? 0) - (a.nbVentes ?? 0);
  });

  const gagnant = trie[0];
  return {
    prixM2: Math.round(gagnant.prixM2 as number),
    perimetre: gagnant.perimetre,
    nature: gagnant.nature,
    label: gagnant.label,
    echantillonFaible: (gagnant.nbVentes ?? Infinity) < MIN_VENTES_FIABLE,
  };
}
