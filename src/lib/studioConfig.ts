// src/lib/studioConfig.ts
//
// R1 — POINT UNIQUE de configuration de l'adresse de MimmozIA Studio dans le front.
// Tout code qui ouvre Studio, compare son origine ou construit un lien vers lui passe par ici
// (ouvrirStudio3D.ts délègue à ce module ; EchangeStudioPanel et MimmozIAPage passent par lui).
//
// Studio est servi sous /studio/, À LA MÊME ORIGINE que Mimmoza :
//   - production Vercel : vercel.json réécrit /studio/* vers le déploiement statique de Studio ;
//   - développement : vite.config.ts relaie /studio vers le Vite de Studio (port 5174) ;
//   - vite preview : idem, vers le preview de Studio (port 4174).
// Sans configuration, l'adresse est donc `<origine de la page>/studio/`, quel que soit le domaine.
//
// VITE_MIMMOZIA_STUDIO_URL (facultative, lue au build) remplace ce défaut :
//   - un chemin ("/studio/") est résolu sur l'origine de la page ;
//   - LIAISON 03/11/2026 — sur un DOMAINE PUBLIC, une adresse absolue n'est gardée que si elle est
//     de la MÊME ORIGINE que la page ; toute autre (autre domaine, adresse technique
//     `mimmozia-studio*.vercel.app`, http, poste local, adresse invalide) est IGNORÉE au profit de
//     `<origine de la page>/studio/`. Panne du 03/11 : `VITE_MIMMOZIA_STUDIO_URL=https://mimmozia-studio-preview.vercel.app`
//     chargeait Studio sur une autre origine, qui refusait les messages de Mimmoza (« Ouverture de Studio… »
//     sans fin) — et Studio quitte de lui-même son adresse technique pour mimmoza.vercel.app/studio/.
//   - sur un POSTE LOCAL (localhost, 127.x…) ou hors navigateur, une adresse absolue reste acceptée telle
//     quelle (développement : Studio Vite lancé seul sur http://localhost:5174, par exemple) ; une adresse
//     invalide y lève ErreurStudio3D, pour être vue tout de suite par le développeur.
//
// Aucune dépendance (ni Vite ni React) : importable tel quel par `node --test --experimental-strip-types`.

/** Chemin de Studio sur l'origine Mimmoza. */
export const STUDIO_CHEMIN = "/studio/";
/** Port FIXE du serveur de développement du front (vite.config.ts, strictPort). */
export const FRONT_PORT_DEV = 5173;
/** Port FIXE du serveur de développement de Studio, relayé par le front sous /studio. */
export const STUDIO_PORT_DEV = 5174;
/** Adresse de Studio quand aucune page n'est connue (hors navigateur) : le front local, même origine. */
export const STUDIO_URL_LOCALE_DEFAUT = `http://localhost:${FRONT_PORT_DEV}${STUDIO_CHEMIN}`;

/** CAD04 — erreur destinée à l'utilisateur (message affichable tel quel). */
export class ErreurStudio3D extends Error {
  constructor(message: string) { super(message); this.name = "ErreurStudio3D"; }
}

/** PUB-A — hôte de poste local (localhost, *.localhost, 127.x, ::1, 0.0.0.0). */
export function estHoteLocal(hote: string): boolean {
  const h = hote.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "0.0.0.0" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** La page Mimmoza qui ouvre Studio (origine complète, port compris). */
export interface PageStudio {
  readonly origin: string;
  readonly hostname: string;
}

/** VITE_MIMMOZIA_STUDIO_URL brute ; undefined si absente ou vide (et hors Vite). */
export const STUDIO_URL_CONFIGUREE: string | undefined = (() => {
  const brute = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_MIMMOZIA_STUDIO_URL;
  return typeof brute === "string" && brute.trim() !== "" ? brute.trim() : undefined;
})();

/** Adresse absolue lue dans la configuration ; null si absente, relative ou invalide (http/https seulement). */
function adresseAbsolue(brute: string): URL | null {
  if (!brute || (brute.startsWith("/") && !brute.startsWith("//"))) return null;
  try {
    const url = new URL(brute);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch { return null; }
}

/**
 * LIAISON 03/11 — vrai quand l'adresse configurée est IGNORÉE pour cette page : page sur un domaine
 * public et adresse configurée qui n'est ni vide, ni un chemin, ni une adresse de la même origine.
 * (Sert au diagnostic : urlStudio() le signale une fois dans la console.)
 */
export function adresseConfigureeIgnoree(configuree: string | null | undefined, page: PageStudio | null): boolean {
  if (!page || estHoteLocal(page.hostname)) return false;
  const brute = (configuree ?? "").trim();
  if (!brute || (brute.startsWith("/") && !brute.startsWith("//"))) return false;
  const url = adresseAbsolue(brute);
  return !url || url.origin !== page.origin;
}

/**
 * Adresse absolue de Studio pour une page donnée (null = hors navigateur, traité comme le poste local).
 * Domaine public : TOUJOURS la même origine que la page (jamais d'erreur, jamais une autre origine).
 * Poste local : lève ErreurStudio3D si l'adresse configurée est invalide.
 */
export function resoudreUrlStudio(configuree: string | null | undefined, page: PageStudio | null): string {
  const pageLocale = !page || estHoteLocal(page.hostname);
  const brute = (configuree ?? "").trim();
  const origineParDefaut = page ? page.origin : `http://localhost:${FRONT_PORT_DEV}`;
  const parDefaut = new URL(STUDIO_CHEMIN, origineParDefaut).href;

  // Défaut : même origine que la page, sous /studio/.
  if (!brute) return parDefaut;

  // Chemin relatif (« /studio/ ») : même origine, par construction.
  if (brute.startsWith("/") && !brute.startsWith("//")) {
    const relative = new URL(brute, origineParDefaut);
    relative.hash = "";
    return relative.href;
  }

  const url = adresseAbsolue(brute);

  // LIAISON 03/11 — domaine public : une adresse d'une AUTRE origine (ou inutilisable) est ignorée.
  if (!pageLocale && page) {
    if (!url || url.origin !== page.origin) return parDefaut;
    url.hash = "";
    return url.href;
  }

  // Poste local (développement) : l'adresse configurée est respectée, mais doit être valide.
  if (!url) throw new ErreurStudio3D(`Studio 3D indisponible : adresse de studio invalide (« ${brute} »).`);
  url.hash = "";
  return url.href;
}

/** La page courante, ou null hors navigateur. */
export function pageCourante(): PageStudio | null {
  if (typeof window === "undefined" || !window.location) return null;
  const { origin, hostname } = window.location;
  return typeof origin === "string" && origin !== "" && origin !== "null" && typeof hostname === "string" ? { origin, hostname } : null;
}

/** Une seule mise en garde console par chargement de page. */
let avertissementDonne = false;

/**
 * Adresse de Studio pour la page courante. Sur un domaine public : toujours `<origine>/studio/` (ou une
 * adresse de la même origine). Lève ErreurStudio3D seulement sur un poste local mal configuré.
 */
export function urlStudio(): string {
  const page = pageCourante();
  if (!avertissementDonne && adresseConfigureeIgnoree(STUDIO_URL_CONFIGUREE, page)) {
    avertissementDonne = true;
    console.warn(`[Studio] VITE_MIMMOZIA_STUDIO_URL (« ${STUDIO_URL_CONFIGUREE} ») n'est pas de la même origine que la page : ignorée, Studio est ouvert sur ${page?.origin}${STUDIO_CHEMIN}. Videz cette variable dans Vercel.`);
  }
  return resoudreUrlStudio(STUDIO_URL_CONFIGUREE, page);
}

/** Origine de Studio pour la page courante ; null si l'adresse est inutilisable. */
export function origineStudio(): string | null {
  try { return new URL(urlStudio()).origin; } catch { return null; }
}

/** Vrai quand Studio est servi à la même origine que la page (cas nominal depuis R1). */
export function studioMemeOrigine(): boolean {
  const page = pageCourante();
  return page !== null && origineStudio() === page.origin;
}
