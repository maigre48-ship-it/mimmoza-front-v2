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

import { migrerV1versV2, validerProjet, type BatimentV2, type ProjetMimmozaV2 } from "../../promoteur/shared/echangeStudio/mimmozaProjetV2.ts";
import type { ParcelleStudio, PointAdresse, TerrainStudio } from "../../promoteur/shared/ouvrirStudio3D.ts";

export const COMPOSITION_MAX_V2 = 8;
/** Bâtiments au plus dans Studio (ARCHITECTURE_LIMITS.maxBuildings) ; le contrat v2 en admet 20. */
export const BATIMENTS_MAX_STUDIO = 12;

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
  /**
   * Volume d'étude multi-bâtiments du Dossier 3D (batimentsStudio.ts) : TOUS les bâtiments,
   * géoréférencés, dans `batiments` du projet v2. Deux au moins ; sinon chemin historique
   * (commande + implantation). Avec eux, l'implantation unique et les accès ne partent pas.
   */
  batiments?: readonly BatimentV2[] | null;
  /** Programme chiffré du volume (logements visés / modélisés, SDP estimée). */
  programmeVolume?: { logementsVises: number | null; logementsModelises: number | null; sdpM2: number | null } | null;
}

/**
 * Lot formes-batiment : la liste `batiments` part au Studio dès DEUX bâtiments, ou pour UN bâtiment à ailes
 * (en L, en U, cour fermée, redans : contrat v2 `ailes`, archétype multi_wing du Studio).
 */
export const transportParBatiments = (b: readonly Pick<BatimentV2, 'ailes'>[] | null | undefined): boolean =>
  (b?.length ?? 0) >= 2 || ((b?.length ?? 0) === 1 && b![0].ailes.length >= 2);
const multiBatiments = (e: EntreeProjetChat) => transportParBatiments(e.batiments);

/**
 * Bâtiments du Dossier 3D transportés avec le terrain confirmé jusqu'à la charge Studio
 * (construits par batimentsStudio.ts). Défini ici : chargeVoirEn3D n'a pas d'autre dépendance.
 */
export interface VolumeBatimentsStudio {
  /** Fiche 3D dont proviennent ces bâtiments (objectif + dimensions). */
  signatureFiche: string;
  batiments: BatimentV2[];
  logementsVises: number | null;
  logementsModelises: number | null;
  sdpM2: number | null;
}

/** Signature d'une fiche 3D : les bâtiments ne valent que pour la fiche tirée du même volume. */
export const signatureFiche = (fiche: { objectif?: string | null; dimensions?: string | null }) =>
  `${(fiche.objectif ?? "").trim()}|${(fiche.dimensions ?? "").trim()}`;

/** Charge v1 équivalente (adaptateur) — mêmes bornes que `adresseStudio3D`, sans troncature silencieuse. */
export function chargeV1Chat(e: EntreeProjetChat): Record<string, unknown> {
  const composition = (e.compositionArchitecture ?? []).filter((c) => c.commande.trim());
  if (composition.length > COMPOSITION_MAX_V2) throw new Error(`Composition de ${composition.length} bâtiments : ${COMPOSITION_MAX_V2} au plus.`);
  const ailes = e.volumeAiles ?? [];
  const brief = (e.brief ?? "").trim().slice(0, 2000);
  const commande = (e.commandeArchitecture ?? "").trim().slice(0, 1000);
  const avecRelief = e.relief !== null && e.parcelles.length > 0;
  // Implantation (centre + orientation) : une seule parcelle suffit ; sans relief, Studio la pose sur le
  // terrain plat supposé et la cote d'entrée est recalée quand le relief arrive (message de relief différé).
  // Plusieurs bâtiments : chacun porte sa position dans `batiments` ; pas de pose unique (elle déplacerait le premier).
  const pose = e.parcelles.length === 1 && e.implantation && !multiBatiments(e) ? e.implantation : null;
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
    // Les accès (tracés sur le relief) restent liés au relief mesuré.
    ...(pose && avecRelief && e.accesses?.length ? { accesses: e.accesses.slice(0, 2) } : {}),
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
  if ((e.batiments?.length ?? 0) > BATIMENTS_MAX_STUDIO) return { ok: false, erreur: `${String(e.batiments!.length)} bâtiments : Studio en accepte ${String(BATIMENTS_MAX_STUDIO)} au plus` };
  const etudeId = e.etudeId && RE_ETUDE.test(e.etudeId) ? e.etudeId : null;
  const m = migrerV1versV2(v1, { projetId: projetIdChat(e.conversationId), etudeId, horodatage: e.horodatage });
  if (!m.ok) return { ok: false, erreur: m.erreur };
  const pv = multiBatiments(e) ? e.programmeVolume ?? null : null;
  const brut = {
    ...m.projet,
    ...(multiBatiments(e) ? {
      batiments: e.batiments!.map((b) => ({ ...b })),
      programme: {
        ...m.projet.programme,
        logementsVises: pv?.logementsVises ?? m.projet.programme.logementsVises,
        logementsModelises: pv?.logementsModelises ?? m.projet.programme.logementsModelises,
        surfacePlancherM2: pv?.sdpM2 ? { valeur: Math.round(pv.sdpM2), nature: "estime" } : m.projet.programme.surfacePlancherM2,
      },
    } : {}),
    revision: Math.max(0, Math.floor(e.revision)),
    session: { id: e.sessionId, conversationId: e.conversationId, retourOrigine: e.origine, retourUrl: e.retourUrl },
  };
  const lu = validerProjet(brut);
  return lu.ok ? { ok: true, projet: lu.projet, avertissements: m.avertissements } : { ok: false, erreur: lu.erreur };
}

/** Format d'identifiant d'étude accepté par Studio (`?etude=`, contrat R4/R5). */
export const RE_ETUDE = /^[\w-]{1,128}$/;

/** Poste local (développement) : localhost, *.localhost, 127.x, ::1. */
function hoteLocal(hote: string): boolean {
  const h = hote.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * LIAISON 03/11/2026 — base de Studio INTÉGRÉ (panneau de la page) : TOUJOURS la même origine
 * que la page (`<origine>/studio/`, servie par la réécriture vercel.json).
 *
 * Cause de la panne du 03/11 : la production du front était construite avec
 * `VITE_MIMMOZIA_STUDIO_URL=https://mimmozia-studio-preview.vercel.app` (autre origine). Le cadre
 * chargeait ce Studio-là, qui refuse les « bonjour » d'une origine hors de sa liste blanche (vide) ;
 * et Studio publié depuis b9151b4 quitte de lui-même toute adresse technique `mimmozia-studio*.vercel.app`
 * pour `mimmoza.vercel.app/studio/` : le cadre change d'origine et les « bonjour » adressés à
 * l'ancienne sont perdus. Dans les deux cas : « Ouverture de Studio… » sans fin, Studio sur l'accueil.
 *
 * Règle : l'adresse configurée n'est gardée que si elle est déjà de la même origine que la page, ou
 * sur un poste local (Studio de développement sur un autre port). Sinon : `<origine de la page>/studio/`.
 */
export function baseStudioIntegre(configuree: string, pageOrigine: string): string {
  let page: URL;
  try { page = new URL(pageOrigine); } catch { return configuree; }
  try { if (new URL(configuree).origin === page.origin) return configuree; } catch { /* adresse invalide : même origine */ }
  if (hoteLocal(page.hostname)) return configuree;
  return new URL("/studio/", page.origin).href;
}

/** LIAISON 03/11 — délai au-delà duquel Studio est déclaré « ne répond pas » (la poignée de main dure 90 s). */
export const DELAI_STUDIO_MUET_MS = 20_000;

/** Message affiché quand Studio n'a pas répondu à la poignée de main (origine en clair pour le diagnostic). */
export function messageStudioMuet(urlStudio: string, originePage: string): string {
  let origine = urlStudio;
  try { origine = new URL(urlStudio).origin; } catch { /* adresse brute */ }
  return origine === originePage
    ? "Studio ne répond pas. Fermez puis rouvrez « Voir en 3D » ; si cela persiste, rechargez la page."
    : `Studio ne répond pas : il est servi par ${origine}, pas par cette page (${originePage}). Vérifiez VITE_MIMMOZIA_STUDIO_URL.`;
}

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
