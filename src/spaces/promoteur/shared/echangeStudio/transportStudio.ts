// src/spaces/promoteur/shared/echangeStudio/transportStudio.ts
//
// LOT L3 — transport Mimmoza ↔ Studio, entre ORIGINES DIFFÉRENTES.
//
// Aller  : le projet voyage dans l'ancre de l'adresse (`#projet=…`, jamais envoyée
//          au serveur). Trop gros (> 32 000 caractères) : l'ancre annonce seulement
//          la session (`#projet-attente=<id>`) et le projet suit par postMessage.
// Retour : l'onglet Studio est ouvert SANS opener (`onglet.opener = null`, Studio
//          ne peut ni lire ni rediriger Mimmoza). Mimmoza garde la poignée de
//          l'onglet et lui envoie « bonjour » (cible = origine exacte du Studio)
//          jusqu'à recevoir « prêt » ; Studio répond à `event.source`, puis y
//          envoie ses retours. Chaque message reçu est filtré : origine en liste
//          blanche, forme validée, session connue. Jamais de cible « * ».
//          Repli si la fenêtre Mimmoza a été fermée : Studio rouvre Mimmoza avec
//          `#studio-retour=<projet>` (voir EchangeStudioPanel).

import {
  creerMessage, depuisBase64Url, lireMessageEchange, origineAutorisee, parserOrigines, sessionIdValide,
  type ProjetMimmozaV2,
} from "./mimmozaProjetV2.ts";

/** Liste blanche des origines Studio : `VITE_STUDIO_ORIGINES_AUTORISEES` + l'origine de l'adresse Studio configurée. */
export function originesStudio(brutEnv: string | null | undefined, urlStudio: string | null): string[] {
  const liste = parserOrigines(brutEnv);
  if (urlStudio) {
    try { const o = new URL(urlStudio).origin; if (!liste.includes(o)) liste.push(o); } catch { /* adresse invalide : ignorée */ }
  }
  return liste;
}

export type DecisionMessage =
  | { readonly type: "ignore"; readonly raison: string }
  | { readonly type: "pret"; readonly sessionId: string; readonly attendProjet: boolean }
  | { readonly type: "retour"; readonly sessionId: string; readonly projet: ProjetMimmozaV2 };

/** Filtre pur d'un MessageEvent reçu par la page Mimmoza. */
export function examinerMessageStudio(
  evt: { readonly origin: string; readonly data: unknown },
  autorisees: readonly string[],
  originePage: string | null,
  sessions: ReadonlySet<string>,
  devLocal = false,
): DecisionMessage {
  if (!origineAutorisee(evt.origin, autorisees, originePage, devLocal)) return { type: "ignore", raison: `origine non autorisée (${String(evt.origin)})` };
  const lu = lireMessageEchange(evt.data);
  if (!lu.ok) return { type: "ignore", raison: lu.erreur };
  const m = lu.message;
  if (!sessions.has(m.sessionId)) return { type: "ignore", raison: "session inconnue" };
  if (m.canal === "pret") return { type: "pret", sessionId: m.sessionId, attendProjet: m.attendProjet };
  if (m.canal === "retour" && m.projet) {
    if (m.projet.origine !== "mimmoza-studio") return { type: "ignore", raison: "retour qui ne vient pas de Studio" };
    return { type: "retour", sessionId: m.sessionId, projet: m.projet };
  }
  return { type: "ignore", raison: `canal « ${m.canal} » non attendu côté Mimmoza` };
}

export interface FenetreCible {
  postMessage(message: unknown, targetOrigin: string): void;
  readonly closed?: boolean;
}

export interface Minuterie {
  setInterval(f: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  maintenant(): number;
}

const minuterieNavigateur: Minuterie = {
  setInterval: (f, ms) => globalThis.setInterval(f, ms),
  clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>),
  maintenant: () => Date.now(),
};

/**
 * Poignée de main initiée par Mimmoza : « bonjour » toutes les `intervalleMs`
 * vers l'onglet Studio (cible = origine Studio exacte), jusqu'à « prêt » ou
 * `dureeMaxMs`. Si Studio attend la charge (`attendProjet`), elle lui est envoyée
 * une fois. `maintenir` : après « prêt », un « bonjour » continue d'être envoyé
 * (toutes les `intervalleMaintienMs`) tant que l'onglet est ouvert, pour que
 * Studio retrouve sa fenêtre de retour après un rechargement.
 */
export function demarrerPoigneeDeMain(
  onglet: FenetreCible,
  origineStudio: string,
  sessionId: string,
  projetAttendu: ProjetMimmozaV2 | null,
  options: { readonly intervalleMs?: number; readonly dureeMaxMs?: number; readonly maintenir?: boolean; readonly intervalleMaintienMs?: number; readonly minuterie?: Minuterie } = {},
): { surPret(attendProjet: boolean): void; arreter(): void; readonly actif: () => boolean; readonly connecte: () => boolean } {
  const m = options.minuterie ?? minuterieNavigateur;
  const debut = m.maintenant();
  let actif = true;
  let connecte = false;
  let projetEnvoye = false;
  let id: unknown = null;
  const arreter = (): void => { if (actif) { actif = false; if (id !== null) m.clearInterval(id); id = null; } };
  const bonjour = (): void => {
    if (!actif) return;
    if (onglet.closed) { arreter(); return; }
    if (!connecte && m.maintenant() - debut > (options.dureeMaxMs ?? 60_000)) { arreter(); return; }
    try { onglet.postMessage(creerMessage("bonjour", sessionId), origineStudio); } catch { /* onglet pas encore à l'origine Studio */ }
  };
  id = m.setInterval(bonjour, options.intervalleMs ?? 500);
  return {
    surPret(attendProjet: boolean): void {
      if (!actif) return;
      if (attendProjet && projetAttendu && !projetEnvoye) {
        projetEnvoye = true;
        onglet.postMessage(creerMessage("projet", sessionId, projetAttendu), origineStudio);
      }
      if (!options.maintenir) { arreter(); return; }
      if (!connecte) {
        connecte = true;
        if (id !== null) m.clearInterval(id);
        id = m.setInterval(bonjour, options.intervalleMaintienMs ?? 2000);
      }
    },
    arreter,
    actif: () => actif,
    connecte: () => connecte,
  };
}

/**
 * Charge v1 (`#parcelles=…`, atelier 3D du tchat) : la même poignée de main donne
 * à Studio une fenêtre de retour même si l'onglet a été ouvert sans opener et sur
 * une autre origine. Le retour v1 (`mzia-studio-volume-v1`) reste filtré par
 * `MimmozIAPage` (origine du Studio).
 */
export function sessionDeChargeV1(url: string): string | null {
  try {
    const h = new URL(url).hash.replace(/^#/, "");
    const i = h.indexOf("parcelles=");
    if (i < 0) return null;
    const v = JSON.parse(depuisBase64Url(h.slice(i + "parcelles=".length).split("&")[0] ?? "")) as Record<string, unknown>;
    return sessionIdValide(v["bridgeSessionId"]) ? v["bridgeSessionId"] : null;
  } catch {
    return null;
  }
}

export function poigneeDeMainDepuisAdresse(onglet: Window, url: string, fenetre: Window = window): void {
  const sid = sessionDeChargeV1(url);
  if (!sid) return;
  const origine = new URL(url).origin;
  const poignee = demarrerPoigneeDeMain(onglet, origine, sid, null);
  const onMessage = (evt: MessageEvent): void => {
    if (evt.source !== onglet || evt.origin !== origine) return;
    const lu = lireMessageEchange(evt.data);
    if (lu.ok && lu.message.canal === "pret" && lu.message.sessionId === sid) {
      poignee.surPret(false);
      fenetre.removeEventListener("message", onMessage);
    }
  };
  fenetre.addEventListener("message", onMessage);
  fenetre.setTimeout(() => { poignee.arreter(); fenetre.removeEventListener("message", onMessage); }, 61_000);
}
