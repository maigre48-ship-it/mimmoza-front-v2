// src/lib/studioNouveauProjet.ts
//
// BOUTON « STUDIO 3D » DE L'EN-TÊTE — ouvrir MimmozIA Studio sur un NOUVEAU PROJET VIERGE,
// sans passer par une conversation, et revenir à Mimmoza en un clic.
//
// Contrat d'adresse avec Studio (src/ui/layout/jarvisReturn.ts côté mimmozia-studio) :
//   <origine>/studio/?nouveau=1&retour=<chemin Mimmoza>
//   - `nouveau=1` : Studio ouvre l'atelier sur un projet vierge ; le projet Studio précédent
//     (sauvegarde automatique) est MIS DE CÔTÉ, intact, et rouvrable d'un clic ;
//   - `retour`    : chemin de la page Mimmoza à retrouver (« ← Mimmoza » dans Studio). Chemin
//     de la même origine uniquement : Studio le revalide et retombe sur /mimmozia sinon.
//
// Studio est servi à la même origine (/studio/, vercel.json) : un seul produit, une seule adresse.
// Aucune dépendance (ni Vite ni React) : testable par `node --test --experimental-strip-types`.

export const PARAM_NOUVEAU_PROJET = "nouveau";
export const PARAM_RETOUR = "retour";
/** Page Mimmoza de repli : l'accueil MimmozIA (toujours servie, jamais de 404). */
export const RETOUR_PAR_DEFAUT = "/mimmozia";
/** Au-delà, l'adresse est jugée anormale et l'on revient à l'accueil MimmozIA. */
export const LONGUEUR_MAX_RETOUR = 1024;

const UUID = /^[0-9a-f-]{36}$/i;
/** Pages vers lesquelles on ne « revient » pas : Studio lui-même, la connexion, la vitrine. */
const SANS_RETOUR = /^\/(?:studio|connexion)(?:\/|$)/;

/**
 * Chemin de la page Mimmoza à retrouver en revenant de Studio.
 * Sur /mimmozia, la conversation ouverte est ajoutée (`?conversation=`, lue par MimmozIAPage) :
 * l'utilisateur retrouve son fil exactement là où il l'a laissé.
 */
export function cheminRetourMimmoza(pathname: string, search = "", conversationId: string | null = null): string {
  const cheminSur = typeof pathname === "string" && pathname.startsWith("/") && !pathname.startsWith("//")
    && !pathname.includes("\\") && !/[\u0000-\u001f]/.test(pathname);
  if (!cheminSur || pathname === "/" || SANS_RETOUR.test(pathname)) return avecConversation(RETOUR_PAR_DEFAUT, "", conversationId);
  return avecConversation(pathname, search, conversationId);
}

function avecConversation(chemin: string, search: string, conversationId: string | null): string {
  const params = new URLSearchParams(search);
  if (chemin === RETOUR_PAR_DEFAUT && conversationId && UUID.test(conversationId)) params.set("conversation", conversationId);
  const requete = params.toString();
  const retour = requete ? `${chemin}?${requete}` : chemin;
  return retour.length <= LONGUEUR_MAX_RETOUR ? retour : RETOUR_PAR_DEFAUT;
}

/** Adresse de Studio pour un nouveau projet vierge (`urlStudio` = sortie de studioConfig.urlStudio()). */
export function adresseNouveauProjetStudio(urlStudio: string, retour: string): string {
  const url = new URL(urlStudio);
  url.searchParams.set(PARAM_NOUVEAU_PROJET, "1");
  url.searchParams.set(PARAM_RETOUR, retour);
  url.hash = "";
  return url.href;
}
