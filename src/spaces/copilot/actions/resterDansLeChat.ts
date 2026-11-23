// src/spaces/copilot/actions/resterDansLeChat.ts
// =============================================================================
// VIS-20 (23/11/2026) — « Le parcours ne quitte jamais le chat ». Sur la page MimmozIA (chat Mimmo + Espace 3D),
// une carte d'action de Mimmo ne fait JAMAIS sortir de la page pour le terrain, la conception ou l'implantation :
//   · create_operation : l'opération est créée (si l'utilisateur la valide), mais on reste dans le chat ;
//   · run_step         : jamais de navigation (le calcul de ces pages se fait par les missions du chat) ;
//   · open_page        : refusée vers les pages Foncier / PLU, Implantation et Programmation ; les autres pages
//                        demandées explicitement (veille, contacts, paramètres…) restent ouvrables.
// Pur (node --test). Le serveur applique la même règle (copilot-chat/agent/rester-dans-le-chat.ts) : il ne propose
// plus ces actions sur cette page ; ce garde-fou couvre une fonction pas encore redéployée et les cartes en attente.
// =============================================================================

/** Routes des étapes 1–3 du parcours : jamais ouvertes depuis la page MimmozIA. */
export const ROUTES_HORS_CHAT: readonly string[] = ['/promoteur/foncier', '/promoteur/implantation-2d', '/promoteur/programmation'];

/** Page MimmozIA (chat Mimmo + panneau Espace 3D). */
export function estPageMimmozIA(pathname: string | null | undefined): boolean {
  const p = (pathname ?? '').split('?')[0].replace(/\/+$/, '');
  return p === '/mimmozia' || p === '/accueil';
}

/** La carte d'action peut-elle naviguer vers `navigateTo` depuis `pathname` ? */
export function navigationPermise(kind: string, navigateTo: string | null | undefined, pathname: string | null | undefined): boolean {
  if (!navigateTo) return false;
  if (!estPageMimmozIA(pathname)) return true;
  if (kind === 'create_operation' || kind === 'run_step') return false;
  const chemin = navigateTo.split('?')[0].replace(/\/+$/, '');
  return !ROUTES_HORS_CHAT.some((r) => chemin === r || chemin.startsWith(`${r}/`));
}

/** Compte rendu quand la navigation est retenue : on reste dans le chat. */
export function messageSansNavigation(message: string): string {
  return `${message.trim()} On continue ici, dans le chat.`.trim();
}
