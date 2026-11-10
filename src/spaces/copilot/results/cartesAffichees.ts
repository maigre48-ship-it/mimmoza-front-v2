// src/spaces/copilot/results/cartesAffichees.ts
// =============================================================================
// LOT C3 — Cartes du chat : une carte par CONTENU, pas une carte par appel.
//
// Constat (essai témoin du 10/11/2026, Montreuil) : trois cartes « Règles du
// PLU » presque identiques dans une même réponse, dont une restée sur
// « Recherche en cours ». Le fil affichait une carte par appel d'outil : quand
// le modèle interroge trois fois la même source (une lecture de règlement se
// fait en plusieurs appels), trois cartes au contenu identique s'empilaient.
//
// Logique PURE, testée par cartesAffichees.test.ts (`node --test`) :
//   · deux appels du même outil dont la carte aurait EXACTEMENT le même contenu
//     visible ne donnent qu'une carte (la première), avec le nombre d'appels ;
//   · un appel encore « en cours » alors que la réponse est terminée est dit
//     « interrompu » : plus rien ne viendra le compléter.
// Seules les cartes de résultat (outils connus de apiResultModel) sont
// concernées : devis, actions, recherches web et cartes Studio gardent leur
// propre logique dans CopilotMessage.
// =============================================================================

import type { ActiveToolCall, ChatMessageStatus } from '../types/copilot.types';
import { buildApiResult } from './apiResultModel.ts';

export interface CarteAffichee {
  /** Carte non rendue : une carte identique est déjà affichée plus haut dans la même réponse. */
  masquee: boolean;
  /** Nombre d'appels au contenu identique que cette carte représente (1 = pas de doublon). */
  occurrences: number;
  /** Appel resté « en cours » alors que la réponse n'est plus en cours de réception. */
  interrompue: boolean;
}

/**
 * Décide, pour chaque appel d'outil d'une réponse, si sa carte de résultat est
 * affichée. Clé de comparaison : le nom de l'outil et le modèle d'affichage
 * complet (titre, périmètre, résumé, chiffres, tableaux, notes, source, date).
 * Deux cartes qui diffèrent d'un seul caractère visible restent toutes deux affichées.
 */
export function preparerCartes(appels: readonly ActiveToolCall[], statutMessage: ChatMessageStatus): Map<string, CarteAffichee> {
  const cartes = new Map<string, CarteAffichee>();
  const premiere = new Map<string, CarteAffichee>();
  for (const appel of appels) {
    const carte: CarteAffichee = { masquee: false, occurrences: 1, interrompue: false };
    cartes.set(appel.id, carte);
    if (appel.status === 'running') {
      // Pendant la réception, la recherche est réellement en cours : rien à dire de plus.
      carte.interrompue = statutMessage !== 'streaming';
      continue;
    }
    const modele = buildApiResult(appel);
    if (!modele) continue;
    const cle = `${appel.name}\u0000${JSON.stringify(modele)}`;
    const deja = premiere.get(cle);
    if (deja) { deja.occurrences += 1; carte.masquee = true; }
    else premiere.set(cle, carte);
  }
  return cartes;
}
