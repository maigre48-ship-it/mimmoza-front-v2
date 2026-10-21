// src/spaces/copilot/studio3d/projetChat.ts
//
// R2 — LE TCHAT PASSE AU CONTRAT `mimmoza-projet-v2`.
//
// L'atelier 3D du tchat produisait une charge v1 (`#parcelles=`, identifiant de
// projet aléatoire côté Studio). Il produit désormais un projet v2 complet :
//   - identifiant de projet COMMUN front/Studio, dérivé de la conversation
//     (`mzchat-<conversationId>`) : rouvrir « Voir en 3D » reprend le même projet ;
//   - révision croissante par conversation (ce poste) ;
//   - session de retour (conversation, origine, adresse de la page) ;
//   - ce que la v1 portait sans équivalent v2 (commande, composition de N
//     bâtiments, ailes, implantation) dans `extensionsV1`, sans rien perdre.
// La v1 reste l'adaptateur : on construit la charge v1 historique puis on la
// migre avec `migrerV1versV2` (le même code que Studio), ce qui garantit que
// les deux applications lisent exactement les mêmes champs.

import { migrerV1versV2, validerProjet, type ProjetMimmozaV2 } from "../../promoteur/shared/echangeStudio/mimmozaProjetV2.ts";
import type { ParcelleStudio, PointAdresse, TerrainStudio } from "../../promoteur/shared/ouvrirStudio3D.ts";

export const COMPOSITION_MAX_V2 = 8;

/** Identifiant de projet commun front/Studio pour une conversation du tchat. */
export function projetIdChat(conversationId: string): string {
  return `mzchat-${conversationId}`.slice(0, 80);
}

export interface PoseChat { lon: number; lat: number; orientationDeg: number; entryOffsetM: number }

export interface EntreeProjetChat {
  conversationId: string;
  /** R4/R5 — étude promoteur rattachée à la conversation (métré → bilan sans clic) ; null si aucune. */
  etudeId?: string | null;
  sessionId: string;
  /** Origine de la page Mimmoza (retour Studio → tchat). */
  origine: string;
  /** Adresse de la page du tchat, sans ancre. */
  retourUrl: string | null;
  revision: number;
  horodatage: string;
  parcelles: readonly ParcelleStudio[];
  communeInsee: string | null;
  adresse: string | null;
  pointAdresse: PointAdresse | null;
  /** Relief déjà connu (cache ou mesure) ; `null` : il suivra par message (relief différé). */
  relief: TerrainStudio | null;
  implantation?: PoseChat | null;
  accesses?: readonly { kind: "pieton" | "vehicule"; lon: number; lat: number }[];
  brief?: string | null;
  commandeArchitecture?: string | null;
  compositionArchitecture?: readonly { name: string; commande: string; centreZ: number }[] | null;
  volumeAiles?: readonly { name: string; largeurM: number; profondeurM: number; niveaux: number; retraitM: number; x: number; z: number; fromLevelIndex?: number }[] | null;
  plans?: readonly { url: string; nom: string }[];
  facades?: readonly { url: string; nom: string }[];
  panoramas?: readonly { url: string; nom: string }[];
}

/** Charge v1 équivalente (adaptateur) — mêmes bornes que `adresseStudio3D`, sans troncature silencieuse. */
export function chargeV1Chat(e: EntreeProjetChat): Record<string, unknown> {
  const composition = (e.compositionArchitecture ?? []).filter((c) => c.commande.trim());
  if (composition.length > COMPOSITION_MAX_V2) throw new Error(`Composition de ${composition.length} bâtiments : ${COMPOSITION_MAX_V2} au plus.`);
  const ailes = e.volumeAiles ?? [];
  const brief = (e.brief ?? "").trim().slice(0, 2000);
  const commande = (e.commandeArchitecture ?? "").trim().slice(0, 1000);
  const avecRelief = e.relief !== null && e.parcelles.length > 0;
  // L'implantation exige un relief mesuré et une seule parcelle (règle Studio CAD03) ; sinon elle suit avec le relief.
  const pose = avecRelief && e.parcelles.length === 1 && e.implantation ? e.implantation : null;
  return {
    version: 1,
    source: "mimmoza-front-v2",
    bridgeSessionId: e.sessionId,
    conversationId: e.conversationId,
    openerOrigin: e.origine,
    communeInsee: e.communeInsee,
    adresse: e.adresse,
    pointAdresse: e.pointAdresse ? { lat: e.pointAdresse.lat, lon: e.pointAdresse.lon } : null,
    parcels: e.parcelles.map((p) => ({ id: p.id, feature: p.feature })),
    ...(avecRelief ? { terrainData: e.relief } : {}),
    ...(pose ? { implantation: pose } : {}),
    ...(pose && e.accesses?.length ? { accesses: e.accesses.slice(0, 2) } : {}),
    ...(e.panoramas?.length ? { panoramas: e.panoramas.slice(0, 10) } : {}),
    ...(brief ? { brief } : {}),
    ...(commande && composition.length < 2 ? { commandeArchitecture: commande } : {}),
    ...(composition.length >= 2 ? { compositionArchitecture: composition.map((c) => ({ name: c.name.slice(0, 60), commande: c.commande.trim().slice(0, 1000), centreZ: Math.max(-200, Math.min(200, c.centreZ)) })) } : {}),
    ...(ailes.length >= 2 ? { volumeAiles: ailes.slice(0, 12) } : {}),
    ...(e.facades?.length ? { facades: e.facades.slice(0, 4) } : {}),
    ...(e.plans?.length ? { plans: e.plans.slice(0, 6) } : {}),
  };
}

export type IssueProjetChat = { ok: true; projet: ProjetMimmozaV2; avertissements: readonly string[] } | { ok: false; erreur: string };

/** Projet v2 du tchat, validé par le contrat (même code que Studio). */
export function construireProjetChat(e: EntreeProjetChat): IssueProjetChat {
  let v1: Record<string, unknown>;
  try { v1 = chargeV1Chat(e); } catch (err) { return { ok: false, erreur: err instanceof Error ? err.message : String(err) }; }
  const etudeId = e.etudeId && RE_ETUDE.test(e.etudeId) ? e.etudeId : null;
  const m = migrerV1versV2(v1, { projetId: projetIdChat(e.conversationId), etudeId, horodatage: e.horodatage });
  if (!m.ok) return { ok: false, erreur: m.erreur };
  const brut = {
    ...m.projet,
    revision: Math.max(0, Math.floor(e.revision)),
    session: { id: e.sessionId, conversationId: e.conversationId, retourOrigine: e.origine, retourUrl: e.retourUrl },
  };
  const lu = validerProjet(brut);
  return lu.ok ? { ok: true, projet: lu.projet, avertissements: m.avertissements } : { ok: false, erreur: lu.erreur };
}

/** Format d'identifiant d'étude accepté par Studio (`?etude=`, contrat R4/R5). */
export const RE_ETUDE = /^[\w-]{1,128}$/;

/** Adresse de Studio intégré : projet (et étude) annoncés, projet transmis par poignée de main. */
export function adresseStudioIntegre(base: string, projetId: string, sessionId: string, etudeId: string | null = null): string {
  const url = new URL(base);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.searchParams.set("mzprojet", projetId);
  if (etudeId && RE_ETUDE.test(etudeId)) url.searchParams.set("etude", etudeId);
  url.hash = `projet-attente=${sessionId}`;
  return url.href;
}

/* ------------------------------------------------------------------ */
/* Révision par conversation (stockage injectable pour les tests)      */
/* ------------------------------------------------------------------ */

export interface StockageCle { getItem(k: string): string | null; setItem(k: string, v: string): void }

const cleRevision = (conversationId: string) => `mzia.studio.revision.${conversationId}`;

/** Révision suivante pour la conversation (1, 2, 3…). Sans stockage : 1. */
export function prochaineRevision(conversationId: string, stockage: StockageCle | null): number {
  let n = 0;
  try { n = Number(stockage?.getItem(cleRevision(conversationId)) ?? "0"); } catch { n = 0; }
  const suivante = Number.isInteger(n) && n >= 0 && n < 1_000_000 ? n + 1 : 1;
  try { stockage?.setItem(cleRevision(conversationId), String(suivante)); } catch { /* révision en mémoire seulement */ }
  return suivante;
}

/* ------------------------------------------------------------------ */
/* Message de relief différé (format décrit dans CONTRAT-REFONTE §R2)  */
/* ------------------------------------------------------------------ */

export const TYPE_MESSAGE_RELIEF = "mimmoza-relief-v1" as const;

export function messageRelief(sessionId: string, issue: { ok: true; terrain: TerrainStudio } | { ok: false; message: string }, implantation: PoseChat | null = null): Record<string, unknown> {
  return issue.ok
    ? { type: TYPE_MESSAGE_RELIEF, sessionId, etat: "mesure", terrainData: issue.terrain, implantation }
    : { type: TYPE_MESSAGE_RELIEF, sessionId, etat: "indisponible", raison: issue.message.slice(0, 300) };
}

export const TYPE_FERMETURE_STUDIO = "mimmoza-studio-fermer-v1" as const;

/** Message « Retour au projet / Bilan » envoyé par Studio intégré ; `null` si ce n'en est pas un. */
export function lireFermetureStudio(data: unknown): "projet" | "bilan" | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (o.type !== TYPE_FERMETURE_STUDIO) return null;
  return o.vers === "bilan" ? "bilan" : "projet";
}

/* ------------------------------------------------------------------ */
/* R4/R5 — étude rattachée à la conversation                           */
/* ------------------------------------------------------------------ */

const cleEtude = (conversationId: string) => `mzia.studio.etude.${conversationId}`;

/**
 * Étude du projet du tchat, FIGÉE par conversation au premier « Voir en 3D » :
 * l'étude déjà rattachée si elle existe, sinon l'étude promoteur active (celle
 * que le copilote crée ou ouvre avec ses actions), sinon aucune (le Bilan
 * proposera alors « Relier ce modèle à l'étude », un clic, une fois).
 * Aucune étude n'est créée en base ici.
 */
export function etudeDuChat(conversationId: string, etudeActive: string | null, stockage: StockageCle | null): string | null {
  try {
    const deja = stockage?.getItem(cleEtude(conversationId)) ?? null;
    if (deja && RE_ETUDE.test(deja)) return deja;
  } catch { /* stockage indisponible */ }
  if (!etudeActive || !RE_ETUDE.test(etudeActive)) return null;
  try { stockage?.setItem(cleEtude(conversationId), etudeActive); } catch { /* rattachement en mémoire seulement */ }
  return etudeActive;
}
