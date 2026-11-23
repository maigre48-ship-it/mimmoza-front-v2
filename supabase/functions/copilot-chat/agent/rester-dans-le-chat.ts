// supabase/functions/copilot-chat/agent/rester-dans-le-chat.ts
// =============================================================================
// VIS-20 (23/11/2026) — « Le parcours ne quitte jamais le chat ». Module PUR (testé par Deno).
//
// Constat (23/11, conversation a7cca310…) : au message « Aide-moi à choisir le terrain… » de l'étape 1, Mimmo a
// proposé action_creer_operation ; la carte d'action a créé l'étude ET ouvert /promoteur/foncier : le fondateur est
// sorti du chat. Sur la page MimmozIA (ctx.route « /mimmozia » ou « /accueil ») :
//   · les outils action_creer_operation et action_lancer_etape ne sont PAS proposés au modèle ;
//   · action_ouvrir_page refuse les pages Foncier / PLU, Implantation et Programmation ;
//   · une consigne rappelle que le terrain (rechercher_parcelles / recuperer_parcelle, assiette) et la conception
//     (proposer_mission type « conception ») se font ICI, et qu'une confirmation de terrain enchaîne sur l'étape 2.
// Même règle côté front : src/spaces/copilot/actions/resterDansLeChat.ts.
// =============================================================================

/** Outils qui font quitter le chat (création d'étude + page Foncier, lancement d'une étape sur sa page). */
export const OUTILS_HORS_CHAT: ReadonlySet<string> = new Set(['action_creer_operation', 'action_lancer_etape']);

/** Routes des étapes terrain / implantation / programme : jamais ouvertes depuis la page MimmozIA. */
export const ROUTES_HORS_CHAT: readonly string[] = ['/promoteur/foncier', '/promoteur/implantation-2d', '/promoteur/programmation'];

export function estPageMimmozIA(route: unknown): boolean {
  if (typeof route !== 'string') return false;
  const p = route.split('?')[0].replace(/\/+$/, '');
  return p === '/mimmozia' || p === '/accueil';
}

/** Outil retiré du tour sur la page MimmozIA. */
export function outilHorsChat(nom: string, route: unknown): boolean {
  return estPageMimmozIA(route) && OUTILS_HORS_CHAT.has(nom);
}

/** Route refusée par action_ouvrir_page depuis la page MimmozIA (null : permise). */
export function refusRouteHorsChat(cible: string, route: unknown): string | null {
  if (!estPageMimmozIA(route)) return null;
  const chemin = (cible ?? '').split('?')[0].replace(/\/+$/, '');
  if (!ROUTES_HORS_CHAT.some((r) => chemin === r || chemin.startsWith(`${r}/`))) return null;
  return 'L’utilisateur est sur la page MimmozIA : cette page ne s’ouvre pas d’ici, tout se fait dans le chat. '
    + 'Terrain : rechercher_parcelles / recuperer_parcelle (plusieurs parcelles = assiette), puis confirmation dans le chat ; '
    + 'conception : proposer_mission (type « conception », idu ou parcel_ids, programme dans les critères). N’ouvre aucune page.';
}

/** Consigne ajoutée au système sur la page MimmozIA. */
export const CONSIGNE_RESTER_DANS_LE_CHAT = [
  '---',
  '# PAGE MIMMOZIA — LE PARCOURS NE QUITTE JAMAIS LE CHAT',
  'L’utilisateur travaille dans le chat, avec le panneau Espace 3D à droite. Ne lui propose JAMAIS d’ouvrir une autre page pour le terrain,',
  'le PLU, l’implantation ou la programmation, et ne crée pas d’opération promoteur (ces actions ne sont pas disponibles ici).',
  '· Étape 1 — Terrain : retrouve la ou les parcelles (rechercher_parcelles, recuperer_parcelle ; plusieurs parcelles contiguës = assiette),',
  '  donne leur surface cadastrale et fais confirmer le terrain dans le chat. L’utilisateur peut aussi les cliquer sur la carte du panneau.',
  '· Dès que l’utilisateur CONFIRME son terrain, enchaîne aussitôt sur l’étape 2 — Programme & conception : appelle proposer_mission',
  '  (type « conception », idu ou parcel_ids, programme connu dans les critères) ; s’il manque l’essentiel du programme (nombre de',
  '  logements ou niveaux), pose UNE question courte, puis propose la mission.',
  '· Étape 2 : la mission de conception se propose et se valide ICI (devis dans le chat), jamais sur la page Programmation.',
  '---',
].join('\n');
