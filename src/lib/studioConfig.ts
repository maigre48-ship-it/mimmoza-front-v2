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
//   - une adresse absolue est contrôlée : sur un domaine public, https obligatoire et jamais un poste local.
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

/**
 * Adresse absolue de Studio pour une page donnée (null = hors navigateur, traité comme le poste local).
 * Lève ErreurStudio3D si l'adresse configurée est inutilisable sur cette page.
 */
export function resoudreUrlStudio(configuree: string | null | undefined, page: PageStudio | null): string {
  const pageLocale = !page || estHoteLocal(page.hostname);
  const brute = (configuree ?? "").trim();
  const prefixe = "Studio 3D indisponible sur ce domaine public : ";
  const origineParDefaut = page ? page.origin : `http://localhost:${FRONT_PORT_DEV}`;

  // Défaut : même origine que la page, sous /studio/.
  if (!brute) return new URL(STUDIO_CHEMIN, origineParDefaut).href;

  // Chemin relatif (« /studio/ ») : même origine, par construction.
  if (brute.startsWith("/") && !brute.startsWith("//")) {
    const relative = new URL(brute, origineParDefaut);
    relative.hash = "";
    return relative.href;
  }

  let url: URL | null = null;
  try { url = new URL(brute); } catch { /* adresse invalide, signalée ci-dessous */ }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new ErreurStudio3D(`${pageLocale ? "Studio 3D indisponible : " : prefixe}adresse de studio invalide (« ${brute} »).`);
  }
  if (!pageLocale) {
    if (estHoteLocal(url.hostname)) throw new ErreurStudio3D(`${prefixe}l'adresse de studio configurée pointe vers un poste local (${url.host}).`);
    if (url.protocol !== "https:") throw new ErreurStudio3D(`${prefixe}l'adresse de studio doit être en https (${url.host}).`);
  }
  url.hash = "";
  return url.href;
}

/** La page courante, ou null hors navigateur. */
export function pageCourante(): PageStudio | null {
  if (typeof window === "undefined" || !window.location) return null;
  const { origin, hostname } = window.location;
  return typeof origin === "string" && origin !== "" && origin !== "null" && typeof hostname === "string" ? { origin, hostname } : null;
}

/** Adresse de Studio pour la page courante ; lève ErreurStudio3D si elle est inutilisable. */
export function urlStudio(): string {
  return resoudreUrlStudio(STUDIO_URL_CONFIGUREE, pageCourante());
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
