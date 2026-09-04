// =============================================================================
// LOYERS DE RÉFÉRENCE ANIL/DHUP — accès depuis le front
// =============================================================================
//
// Le manque comblé
// ----------------
// L'edge function `loyers-reference-v1` lit la table `loyers_reference`
// (~34 900 communes, Carte des loyers ANIL/DHUP). Elle était appelée UNIQUEMENT
// par le serveur — `copilot-chat` et `etude-parcelle-v1`. Aucun fichier de
// `src/` ne l'invoquait.
//
// Résultat : le copilote répondait avec la donnée ANIL de la commune, pendant
// que les écrans affichaient un barème départemental codé en dur couvrant
// 42 départements sur ~101, et retombant sinon sur une moyenne nationale de
// 11 €/m²/mois — la Creuse au tarif de Rouen. Deux loyers de référence pour le
// même bien, selon qu'on lisait le chat ou la page.
//
// Ce module est le canal manquant. Les appelants qui disposent d'un code INSEE
// peuvent alimenter `OpportunityInput.loyerReferenceEurM2Mois`, qui prime alors
// sur le barème de repli du moteur d'opportunités.
// =============================================================================

import { supabase } from '@/lib/supabaseClient';

const EDGE_FUNCTION = 'loyers-reference-v1';

export interface LoyerReference {
  codeInsee: string | null;
  communeNom: string | null;
  /** Millésime du jeu de données ANIL/DHUP. */
  millesime: string | number | null;
  /** Loyer médian toutes typologies, en €/m²/mois. */
  loyerMedianGlobal: number | null;
  /** true quand la médiane globale a été reconstituée depuis appartement/maison. */
  loyerMedianGlobalEstime: boolean;
  loyerMedianAppartement: number | null;
  loyerMedianMaison: number | null;
  nbObservations: number | null;
  /** Paris / Lyon / Marseille : la réponse porte sur les arrondissements. */
  estPlm: boolean;
  source: string;
}

function nombreOuNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function texteOuNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Loyer de référence d'une commune.
 *
 * @param params au moins l'un des trois : code INSEE (le plus fiable),
 *   nom de commune, ou code postal.
 *
 * Retourne `null` — jamais une valeur de repli — quand la commune n'est pas
 * couverte ou que le service est indisponible. C'est à l'appelant de décider
 * quoi afficher, et de le dire : une estimation de loyer silencieusement
 * remplacée par une moyenne nationale est exactement ce que ce module corrige.
 */
export async function fetchLoyerReference(params: {
  codeInsee?: string | null;
  commune?: string | null;
  codePostal?: string | null;
}): Promise<LoyerReference | null> {
  const codeInsee = texteOuNull(params.codeInsee);
  const commune = texteOuNull(params.commune);
  const codePostal = texteOuNull(params.codePostal);
  if (!codeInsee && !commune && !codePostal) return null;

  try {
    const { data, error } = await supabase.functions.invoke(EDGE_FUNCTION, {
      body: {
        ...(codeInsee ? { code_insee: codeInsee } : {}),
        ...(commune ? { commune } : {}),
        ...(codePostal ? { zip_code: codePostal } : {}),
      },
    });
    if (error) {
      console.warn('[loyers-reference] service indisponible :', error.message);
      return null;
    }

    const payload = data as { status?: string; stats?: Record<string, unknown> } | null;
    if (!payload || payload.status !== 'ok' || !payload.stats) return null;

    const s = payload.stats;
    const global = nombreOuNull(s.loyer_median_global);
    const app = nombreOuNull(s.loyer_median_appartement);
    const maison = nombreOuNull(s.loyer_median_maison);

    // Une réponse sans aucune médiane exploitable ne vaut pas mieux qu'une
    // absence de réponse : on ne renvoie pas une coquille vide.
    if (global == null && app == null && maison == null) return null;

    return {
      codeInsee: texteOuNull(s.code_insee),
      communeNom: texteOuNull(s.commune_nom),
      millesime: (s.millesime as string | number | null) ?? null,
      loyerMedianGlobal: global,
      loyerMedianGlobalEstime: s.loyer_median_global_estime === true,
      loyerMedianAppartement: app,
      loyerMedianMaison: maison,
      nbObservations: nombreOuNull(s.nb_observations),
      estPlm: s.is_plm === true,
      source: texteOuNull(s.source) ?? 'Carte des loyers ANIL/DHUP',
    };
  } catch (e) {
    console.warn('[loyers-reference] appel impossible :', e);
    return null;
  }
}

/**
 * Loyer en €/m²/mois à retenir pour une typologie donnée.
 *
 * Préfère la médiane de la typologie demandée, puis la médiane globale. Sur
 * Paris, Lyon et Marseille, la réponse porte sur les arrondissements : la
 * médiane globale y est une moyenne de la ville, à manier avec prudence.
 */
export function loyerEurM2Mois(
  ref: LoyerReference | null,
  typologie?: 'appartement' | 'maison',
): number | null {
  if (!ref) return null;
  if (typologie === 'appartement' && ref.loyerMedianAppartement != null) {
    return ref.loyerMedianAppartement;
  }
  if (typologie === 'maison' && ref.loyerMedianMaison != null) {
    return ref.loyerMedianMaison;
  }
  return ref.loyerMedianGlobal ?? ref.loyerMedianAppartement ?? ref.loyerMedianMaison;
}
