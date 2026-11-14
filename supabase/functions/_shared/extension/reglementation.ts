// supabase/functions/_shared/extension/reglementation.ts
// =============================================================================
// LOT X3 (14/11/2026) — Régime d'autorisation INDICATIF d'une extension (DP / PC) et recours à l'architecte.
// Module PUR et déterministe. Ce n'est PAS un avis juridique : chaque sortie porte ses sources et la mention
// « à vérifier auprès de la mairie ».
//
// SOURCES (lues le 14/11/2026) :
//   · service-public.gouv.fr F36777 « Quelle autorisation pour un agrandissement extérieur ou une surélévation ? »
//     (page vérifiée le 11/12/2024) — surface CRÉÉE comptée en emprise au sol OU en surface de plancher :
//       - zone U d'un PLU (hors site protégé) : jusqu'à 40 m² → déclaration préalable (DP) ; toutefois PC si la
//         surface créée dépasse 20 m² ET porte la surface totale au-delà de 150 m² ; au-delà de 40 m² → PC ;
//       - hors zone U d'un PLU (ou site protégé) : jusqu'à 20 m² → DP ; au-delà → PC.
//     (Code de l'urbanisme, art. R*421-14 et R*421-17.)
//   · service-public.gouv.fr F20568 « Dans quel cas doit-on faire appel à un architecte ? » (vérifiée le 07/09/2026) :
//       - jamais pour une déclaration préalable ;
//       - particulier, agrandissement soumis à PC : obligatoire si la surface de plancher dépasse 150 m² AVANT ou
//         APRÈS travaux ;
//       - personne morale : obligatoire pour TOUT projet soumis à permis de construire.
//
// DÉCISIONS D'ALBÉ (13/11/2026) appliquées :
//   · l'alerte « architecte obligatoire » n'est FERME que sur la surface de plancher existante SAISIE par
//     l'utilisateur (statut « confirmée ») ; une estimation (BD TOPO / BDNB) ne donne qu'un « à confirmer » ;
//   · dossier sans architecte possible pour un particulier sous 150 m² (mention) ; personne morale = architecte
//     toujours (dès qu'il y a permis).
// La surface CRÉÉE est elle-même une estimation (surface de plancher : murs SUPPOSÉS, ± 15 %) : quand la fourchette
// enjambe un seuil, le verdict le dit (« proche du seuil »).
// =============================================================================

import type { StatutDonnee } from './contrat.ts';

export const SOURCE_F36777 = {
  titre: 'Service-public.gouv.fr — Agrandissement extérieur ou surélévation : quelle autorisation ? (F36777, vérifiée le 11/12/2024)',
  url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F36777',
} as const;
export const SOURCE_F20568 = {
  titre: 'Service-public.gouv.fr — Dans quel cas doit-on faire appel à un architecte ? (F20568, vérifiée le 07/09/2026)',
  url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/f20568',
} as const;

export const SEUILS = { dpZoneUM2: 40, dpHorsZoneUM2: 20, palierZoneUM2: 20, architecteM2: 150 } as const;

export const MENTION_INDICATIVE =
  'Indicatif, d’après service-public.gouv.fr (fiches F36777 et F20568) : à vérifier auprès du service urbanisme de la mairie ' +
  '(un site protégé, un secteur des Architectes des Bâtiments de France ou une règle locale peuvent changer le régime). Ce n’est pas un avis juridique.';

export type Regime = 'DP' | 'PC' | 'DP ou PC' | 'inconnu';
export type Architecte = 'obligatoire' | 'non-obligatoire' | 'a-confirmer';

export interface EntreeRegime {
  /** Surface CRÉÉE : emprise au sol (largeur × profondeur saisies) et surface de plancher estimée (fourchette). */
  readonly creee: { readonly empriseM2: number | null; readonly sdpM2: number | null; readonly sdpMinM2?: number | null; readonly sdpMaxM2?: number | null };
  /** Surface de plancher EXISTANTE : saisie (confirmée) ou estimée (fourchette). Emprise existante facultative. */
  readonly existant: { readonly sdpM2: number | null; readonly statut: StatutDonnee | null; readonly minM2?: number | null; readonly maxM2?: number | null; readonly empriseM2?: number | null };
  /** Zone U d'un PLU : vrai, faux, ou inconnu (null) — avec sa source. */
  readonly zoneU: { readonly valeur: boolean | null; readonly source: string };
  readonly demandeur: 'particulier' | 'personne-morale' | null;
}

export interface RegimeIndicatif {
  readonly regime: Regime;
  readonly architecte: Architecte;
  /** Vrai si la conclusion « architecte » repose sur la surface existante SAISIE (jamais sur une estimation). */
  readonly ferme: boolean;
  /** Surface créée retenue pour les seuils (m²) : max(emprise, surface de plancher). */
  readonly surfaceCreeeM2: number | null;
  /** Surface de plancher totale après travaux (m²), si calculable, avec sa nature. */
  readonly totalApresM2: number | null;
  readonly lignes: readonly string[];
  readonly sources: readonly { readonly titre: string; readonly url: string }[];
  readonly mention: string;
}

const fr = (v: number, d = 0): string => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR', { maximumFractionDigits: d }).replace(/ | /g, ' ');
const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Régime selon F36777 pour une surface créée, une zone et une surface totale après travaux (SDP ou emprise). */
export function regimeSelonZone(creeeM2: number, zoneU: boolean, totalApresM2: number | null): 'DP' | 'PC' {
  if (!zoneU) return creeeM2 > SEUILS.dpHorsZoneUM2 ? 'PC' : 'DP';
  if (creeeM2 > SEUILS.dpZoneUM2) return 'PC';
  if (creeeM2 > SEUILS.palierZoneUM2 && totalApresM2 !== null && totalApresM2 > SEUILS.architecteM2) return 'PC';
  return 'DP';
}

/** Verdict indicatif complet. */
export function regimeIndicatif(e: EntreeRegime): RegimeIndicatif {
  const lignes: string[] = [];
  const sources = [SOURCE_F36777, SOURCE_F20568];
  const emp = num(e.creee.empriseM2) ? e.creee.empriseM2 : null;
  const sdp = num(e.creee.sdpM2) ? e.creee.sdpM2 : null;
  if (emp === null && sdp === null) {
    return { regime: 'inconnu', architecte: 'a-confirmer', ferme: false, surfaceCreeeM2: null, totalApresM2: null, sources, mention: MENTION_INDICATIVE,
      lignes: ['Surface créée inconnue (dimensions de l’extension non données) : régime non évalué.'] };
  }
  const creee = Math.max(emp ?? 0, sdp ?? 0);
  const sdpMin = num(e.creee.sdpMinM2) ? e.creee.sdpMinM2 : sdp ?? 0;
  const sdpMax = num(e.creee.sdpMaxM2) ? e.creee.sdpMaxM2 : sdp ?? 0;
  const creeeMin = Math.max(emp ?? 0, sdpMin);
  const creeeMax = Math.max(emp ?? 0, sdpMax);
  lignes.push(`Surface créée retenue : ${fr(creee, 1)} m² (le plus grand de l’emprise au sol${emp !== null ? ` ${fr(emp, 1)} m²` : ''} et de la surface de plancher${sdp !== null ? ` estimée ${fr(sdp, 1)} m²` : ''}).`);

  // Surface totale après travaux (seuil de 150 m²), centrale et extrêmes.
  const ex = num(e.existant.sdpM2) ? e.existant.sdpM2 : null;
  const confirmee = e.existant.statut === 'confirmee' && ex !== null;
  const exMin = confirmee ? ex : num(e.existant.minM2) ? e.existant.minM2 : ex;
  const exMax = confirmee ? ex : num(e.existant.maxM2) ? e.existant.maxM2 : ex;
  const total = ex !== null ? ex + (sdp ?? 0) : null;
  const totalMin = exMin !== null ? exMin + sdpMin : null;
  const totalMax = exMax !== null ? exMax + sdpMax : null;
  const empTotale = num(e.existant.empriseM2) && emp !== null ? e.existant.empriseM2 + emp : null;
  const totalPourPalier = (t: number | null): number | null => (t === null && empTotale === null ? null : Math.max(t ?? 0, empTotale ?? 0));

  // Régime selon la zone.
  const verdicts = (zoneU: boolean): Set<'DP' | 'PC'> => new Set([
    regimeSelonZone(creee, zoneU, totalPourPalier(total)),
    regimeSelonZone(creeeMin, zoneU, totalPourPalier(totalMin)),
    regimeSelonZone(creeeMax, zoneU, totalPourPalier(totalMax)),
  ]);
  let regime: Regime;
  if (e.zoneU.valeur === null) {
    const u = verdicts(true), h = verdicts(false);
    const tous = new Set([...u, ...h]);
    regime = tous.size === 1 ? [...tous][0]! : 'DP ou PC';
    lignes.push(`Zone du PLU non établie (${e.zoneU.source}) : en zone U d’un PLU, ${[...u].join(' ou ')} ; hors zone U, ${[...h].join(' ou ')}.`);
  } else {
    const v = verdicts(e.zoneU.valeur);
    regime = v.size === 1 ? [...v][0]! : 'DP ou PC';
    lignes.push(e.zoneU.valeur
      ? `Parcelle en zone U d’un PLU (${e.zoneU.source}) : déclaration préalable jusqu’à 40 m² créés, permis au-delà, et permis dès 20 m² si la surface totale dépasse 150 m².`
      : `Parcelle hors zone U d’un PLU (${e.zoneU.source}) : déclaration préalable jusqu’à 20 m² créés, permis au-delà.`);
    if (v.size > 1) lignes.push('La surface créée estimée est proche d’un seuil (fourchette de ± 15 % sur la surface de plancher) : le régime dépend des surfaces exactes du projet.');
  }
  if (regime === 'DP ou PC' && !confirmee && ex !== null) lignes.push('Le seuil de 150 m² est évalué sur une surface existante ESTIMÉE : indiquez la surface de plancher réelle pour conclure.');

  // Architecte (F20568).
  let architecte: Architecte;
  let ferme = false;
  if (regime === 'DP') {
    architecte = 'non-obligatoire';
    ferme = true;
    lignes.push('Déclaration préalable : le recours à un architecte n’est jamais obligatoire (F20568).');
  } else if (e.demandeur === 'personne-morale') {
    architecte = regime === 'PC' ? 'obligatoire' : 'a-confirmer';
    ferme = regime === 'PC';
    lignes.push(regime === 'PC'
      ? 'Demandeur personne morale (société) : architecte OBLIGATOIRE pour tout permis de construire (F20568).'
      : 'Demandeur personne morale (société) : si le projet relève du permis de construire, l’architecte est OBLIGATOIRE (F20568).');
  } else if (confirmee) {
    const avant = ex!;
    const apresMin = avant + sdpMin;
    const apresMax = avant + sdpMax;
    if (avant > SEUILS.architecteM2 || apresMin > SEUILS.architecteM2) {
      architecte = 'obligatoire';
      ferme = true;
      lignes.push(`Surface de plancher existante SAISIE : ${fr(avant)} m² ; après travaux ≈ ${fr(avant + (sdp ?? 0))} m² (> 150 m²) : en permis de construire, architecte OBLIGATOIRE pour un particulier (F20568).`);
    } else if (apresMax > SEUILS.architecteM2) {
      architecte = 'a-confirmer';
      lignes.push(`Surface de plancher existante SAISIE : ${fr(avant)} m² ; après travaux entre ${fr(apresMin)} et ${fr(apresMax)} m² selon l’estimation de la surface créée : le seuil de 150 m² est proche, à confirmer sur les plans.`);
    } else {
      architecte = 'non-obligatoire';
      ferme = true;
      lignes.push(`Surface de plancher existante SAISIE : ${fr(avant)} m² ; après travaux ≈ ${fr(avant + (sdp ?? 0))} m² (≤ 150 m²) : un particulier peut déposer le dossier sans architecte (F20568).`);
    }
  } else {
    architecte = 'a-confirmer';
    lignes.push(ex !== null
      ? `Surface de plancher existante ESTIMÉE (${fr(ex)} m², entre ${fr(exMin ?? ex)} et ${fr(exMax ?? ex)} m²) : ce n’est pas une mesure. Le seuil de 150 m² (architecte) ne peut être tranché qu’avec la surface réelle (acte, avis de taxe foncière, plans).`
      : 'Surface de plancher existante inconnue : le seuil de 150 m² (architecte) ne peut pas être évalué. Indiquez la surface réelle (acte, avis de taxe foncière, plans).');
  }
  if (e.demandeur === null && regime !== 'DP') lignes.push('Si le demandeur est une société (personne morale), l’architecte est obligatoire pour tout permis de construire.');
  return { regime, architecte, ferme, surfaceCreeeM2: Math.round(creee * 10) / 10, totalApresM2: total !== null ? Math.round(total * 10) / 10 : null, lignes, sources, mention: MENTION_INDICATIVE };
}

/** Libellés courts (cartes, résumé). */
export const LIBELLE_REGIME: Record<Regime, string> = {
  DP: 'Déclaration préalable (probable)',
  PC: 'Permis de construire (probable)',
  'DP ou PC': 'Déclaration préalable ou permis de construire (à préciser)',
  inconnu: 'Régime non évalué',
};
export const LIBELLE_ARCHITECTE: Record<Architecte, string> = {
  obligatoire: 'Architecte obligatoire',
  'non-obligatoire': 'Architecte non obligatoire',
  'a-confirmer': 'Architecte : à confirmer',
};
