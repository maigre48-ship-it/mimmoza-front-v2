// src/spaces/promoteur/shared/echangeStudio/persistanceEchange.ts
//
// LOT L3 — dernier état échangé avec Studio, PAR UTILISATEUR ET PAR ÉTUDE.
// Le stockage est injecté : `userStorage` en production (clé préfixée par
// l'utilisateur connecté), un stockage simulé dans les tests. Survit à la
// fermeture du navigateur (localStorage).
//
//   base      : dernière version acceptée des deux côtés (envoyée, ou reçue puis appliquée) ;
//   enAttente : dernier retour de Studio pas encore confirmé par l'utilisateur ;
//   refsFront : identifiant de contrat → identifiant du bâtiment dans l'éditeur 2D.

import type { StockageEcriture, StockageLecture } from "../../implantation/rulesetReculs.ts";
import {
  comparerProjets, completerDepuisBase, empreinteProjet, etatSynchronisation, memeContenu, revisionVraisemblable, sessionIdValide, validerProjet,
  type Changement, type EtatSynchro, type ProjetMimmozaV2,
} from "./mimmozaProjetV2.ts";
import { idPropre } from "./projetPromoteur.ts";

export interface EchangeStocke {
  readonly version: 1;
  readonly projetId: string;
  readonly etudeId: string | null;
  readonly base: ProjetMimmozaV2 | null;
  readonly enAttente: ProjetMimmozaV2 | null;
  readonly sessionId: string | null;
  readonly refsFront: Readonly<Record<string, string>>;
  /** R2 — empreinte du dernier retour de Studio accepté : le prochain envoi en « repart » (pas de faux conflit côté Studio). */
  readonly parentStudio: string | null;
  readonly majLe: string;
}

export const cleEchange = (etudeId: string | null): string => `mimmoza.studio.echange_v2.${etudeId ?? "sans-etude"}`;

/**
 * R2 — identifiant de projet IMPRÉVISIBLE (aléatoire, sans l'identifiant d'étude en clair).
 * Il est créé une fois puis conservé avec l'échange de l'étude : rouvrir la même étude
 * réutilise le même projet dans Studio (pas de doublon).
 */
export const projetIdPourEtude = (_etudeId: string | null, aleatoire: () => string): string => idPropre(`mz-${aleatoire()}`);

export function nouvelEchange(etudeId: string | null, aleatoire: () => string, maintenant: string): EchangeStocke {
  return { version: 1, projetId: projetIdPourEtude(etudeId, aleatoire), etudeId, base: null, enAttente: null, sessionId: null, refsFront: {}, parentStudio: null, majLe: maintenant };
}

function projetOuNull(v: unknown): ProjetMimmozaV2 | null {
  if (v === null || v === undefined) return null;
  const lu = validerProjet(v);
  return lu.ok ? lu.projet : null;
}

/** Relit l'échange d'une étude ; null si absent ou illisible (jamais d'exception). */
export function lireEchangeStocke(storage: StockageLecture, etudeId: string | null): EchangeStocke | null {
  try {
    const brut = storage.getItem(cleEchange(etudeId));
    if (!brut) return null;
    const o = JSON.parse(brut) as Record<string, unknown>;
    if (o["version"] !== 1 || typeof o["projetId"] !== "string") return null;
    const refs = o["refsFront"] && typeof o["refsFront"] === "object" ? (o["refsFront"] as Record<string, unknown>) : {};
    return {
      version: 1,
      projetId: o["projetId"],
      etudeId,
      base: projetOuNull(o["base"]),
      enAttente: projetOuNull(o["enAttente"]),
      sessionId: sessionIdValide(o["sessionId"]) ? o["sessionId"] : null,
      refsFront: Object.fromEntries(Object.entries(refs).filter((e): e is [string, string] => typeof e[1] === "string")),
      parentStudio: typeof o["parentStudio"] === "string" && /^[0-9a-f]{16}$/.test(o["parentStudio"]) ? o["parentStudio"] : null,
      majLe: typeof o["majLe"] === "string" ? o["majLe"] : "",
    };
  } catch {
    return null;
  }
}

export function ecrireEchangeStocke(storage: StockageEcriture, e: EchangeStocke): boolean {
  try {
    storage.setItem(cleEchange(e.etudeId), JSON.stringify(e));
    return true;
  } catch {
    return false;
  }
}

/** Envoi vers Studio : le projet envoyé devient la base, la session est mémorisée. */
export function enregistrerEnvoi(e: EchangeStocke, projet: ProjetMimmozaV2, maintenant: string): EchangeStocke {
  return { ...e, projetId: projet.projetId, base: projet, parentStudio: null, sessionId: projet.session?.id ?? e.sessionId, enAttente: null, majLe: maintenant };
}

/** Relief, validations et liens de photos omis d'un retour par adresse : repris de la base (rien n'est perdu). */
export function completerRetour(retour: ProjetMimmozaV2, base: ProjetMimmozaV2 | null): ProjetMimmozaV2 {
  return completerDepuisBase(retour, base);
}

export interface AnalyseRetour {
  readonly echange: EchangeStocke;
  readonly retour: ProjetMimmozaV2;
  readonly etat: EtatSynchro;
  readonly changements: readonly Changement[];
  /** Ce que Mimmoza a changé de son côté depuis l'envoi (si conflit). */
  readonly changementsLocaux: readonly Changement[];
  /** R2 — rien à montrer : la fenêtre ne s'ouvre pas et rien n'est mis en attente. */
  readonly aucuneDifference: boolean;
}

/**
 * Un retour de Studio arrive : il est mis EN ATTENTE (persisté), jamais appliqué
 * d'office. L'état dit s'il y a conflit avec des modifications locales.
 */
export function recevoirRetour(e: EchangeStocke, retourBrut: ProjetMimmozaV2, local: ProjetMimmozaV2 | null, maintenant: string): AnalyseRetour | { readonly erreur: string } {
  if (retourBrut.projetId !== e.projetId) return { erreur: "Retour de Studio pour un autre projet : ignoré." };
  // R2 — seul Studio émet un retour, et jamais une révision plus ancienne (rejeu, désordre).
  if (retourBrut.origine !== "mimmoza-studio") return { erreur: "Message de retour qui ne vient pas de Studio : ignoré." };
  if (e.base && retourBrut.revision <= e.base.revision) return { erreur: `Révision ${String(retourBrut.revision)} déjà dépassée (base ${String(e.base.revision)}) : ignorée.` };
  // R3 — révision invraisemblable (saut > 10⁶ depuis la base, ou supérieure à l'horodatage en secondes) : refusée.
  if (!revisionVraisemblable(retourBrut, e.base ? e.base.revision : null)) return { erreur: `Révision ${String(retourBrut.revision)} invraisemblable : ignorée.` };
  if (e.enAttente && retourBrut.revision < e.enAttente.revision) return { erreur: `Révision ${String(retourBrut.revision)} plus ancienne que celle en attente (${String(e.enAttente.revision)}) : ignorée.` };
  const retour = completerRetour(retourBrut, e.base);
  if (e.enAttente && retourBrut.revision === e.enAttente.revision && memeContenu(e.enAttente, retour)) return { erreur: "Retour déjà reçu (rejoué) : ignoré." };
  const etat = etatSynchronisation(e.base, local, retour);
  const reference = e.base ?? local;
  const changements = reference ? comparerProjets(reference, retour) : [];
  const aucuneDifference = etat === "distant-inchange" || (reference !== null && changements.length === 0);
  return {
    echange: aucuneDifference ? { ...e, enAttente: null, majLe: maintenant } : { ...e, enAttente: retour, majLe: maintenant },
    retour,
    etat,
    changements,
    changementsLocaux: e.base && local && etat === "conflit" ? comparerProjets(e.base, local) : [],
    aucuneDifference,
  };
}

/** L'utilisateur a confirmé : le retour devient la base commune. */
export function accepterRetour(e: EchangeStocke, retour: ProjetMimmozaV2, refsFront: Readonly<Record<string, string>>, maintenant: string, retourRecu: ProjetMimmozaV2 | null = null): EchangeStocke {
  return { ...e, base: retour, enAttente: null, refsFront, parentStudio: retourRecu ? empreinteProjet(retourRecu) : null, majLe: maintenant };
}

/** Parent du prochain envoi : le retour Studio accepté s'il y en a un, sinon la base. */
export function parentPourEnvoi(e: EchangeStocke): string | null {
  return e.parentStudio ?? (e.base ? empreinteProjet(e.base) : null);
}

/** L'utilisateur garde sa version : le retour est écarté (Studio sera informé au prochain envoi). */
export function ignorerRetour(e: EchangeStocke, maintenant: string): EchangeStocke {
  return { ...e, enAttente: null, majLe: maintenant };
}
