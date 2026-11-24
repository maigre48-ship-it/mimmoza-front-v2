// src/spaces/copilot/studio3d/selectionCatalogue.ts
// =============================================================================
// VIS-33 — « Ma sélection » : les matières choisies dans la page catalogue extérieur (/mimmozia/catalogue-exterieur,
// ouverte dans un NOUVEL onglet depuis le chat) et la carte d'habillage de l'étape 4 (CarteBriefCreatif) partagent UNE
// sélection par conversation. Règle d'Albé : « si c'est validé d'un côté, ça l'est de l'autre ».
//
//   projet    = ce qui est dans l'habillage du projet (la carte l'applique et l'écrit) ;
//   brouillon = choix faits dans la page, pas encore envoyés (« Utiliser dans mon projet » les verse dans `projet`) ;
//               null pour une partie = retrait demandé ;
//   refus     = choix de la page que la carte n'a pas pu appliquer (ex. garde-corps sans balcon), avec la raison.
//
// Stockage : localStorage (clé par conversation ; « sans conversation » si la page est ouverte seule) ; diffusion :
// BroadcastChannel (autres onglets), événement `storage` (repli), événement de fenêtre (même onglet). Pas de prix ni de
// validation ici : le brief reste validé dans le chat. Module LÉGER (pas de catalogue) : la carte l'importe sans
// télécharger le catalogue ; la traduction d'une matière en valeurs du brief est injectée (`resoudre`), voir
// appliquerProjetAEtat.
// =============================================================================
import {
  PARTIES_MATIERE, choisirMatiereCatalogue, retirerMatiereCatalogue,
  type ChoixBrief, type DemandeBrief, type EtatBrief, type MatiereCatalogueChoisie, type PartieMatiere,
} from './briefCreatif.ts';

export interface ChoixPartie { readonly ref: string; readonly nom: string }
export type ChoixParPartie = Partial<Record<PartieMatiere, ChoixPartie>>;
export interface SelectionCatalogue {
  readonly v: 1;
  readonly projet: ChoixParPartie;
  readonly brouillon: Partial<Record<PartieMatiere, ChoixPartie | null>>;
  readonly refus: Partial<Record<PartieMatiere, string>>;
  /** Horodatage de la dernière écriture (ms). */
  readonly maj: number;
  /** Identifiant de l'écrivain (onglet + composant) : on ignore ses propres échos. */
  readonly auteur: string;
}

export const SELECTION_VIDE: SelectionCatalogue = { v: 1, projet: {}, brouillon: {}, refus: {}, maj: 0, auteur: '' };
export const CANAL_SELECTION = 'mimmozia-selection-catalogue';
export const EVENEMENT_SELECTION = 'mimmozia:selection-catalogue';
const PREFIXE_CLE = 'mimmozia.selectionCatalogue.v1:';
export const SANS_CONVERSATION = 'sans-conversation';

export const cleSelection = (conversation: string | null | undefined): string => PREFIXE_CLE + (conversation || SANS_CONVERSATION);

/** Adresse de la page catalogue pour une conversation (la sélection y revient). */
export function adresseCatalogueConversation(conversation: string | null | undefined, base = '/mimmozia/catalogue-exterieur'): string {
  return conversation ? `${base}?conversation=${encodeURIComponent(conversation)}` : base;
}
/** Conversation lue dans l'adresse de la page (?conversation=…) ; null si absente ou illisible. */
export function conversationDepuisAdresse(recherche: string): string | null {
  const c = new URLSearchParams(recherche).get('conversation');
  return c && /^[A-Za-z0-9_-]{1,80}$/.test(c) ? c : null;
}

// ── Pur ──────────────────────────────────────────────────────────────────────
const estPartie = (p: string): p is PartieMatiere => (PARTIES_MATIERE as readonly string[]).includes(p);
const choixValide = (v: unknown): v is ChoixPartie =>
  !!v && typeof v === 'object' && typeof (v as ChoixPartie).ref === 'string' && (v as ChoixPartie).ref.length > 0 && (v as ChoixPartie).ref.length <= 80
  && typeof (v as ChoixPartie).nom === 'string';

/** Lecture tolérante (JSON abîmé, ancienne forme) ; les brouillons égaux au projet sont retirés. */
export function lireSelectionBrute(brut: string | null): SelectionCatalogue {
  if (!brut) return SELECTION_VIDE;
  let o: Record<string, unknown>;
  try { o = JSON.parse(brut) as Record<string, unknown>; } catch { return SELECTION_VIDE; }
  if (!o || typeof o !== 'object') return SELECTION_VIDE;
  const projet: Partial<Record<PartieMatiere, ChoixPartie>> = {};
  const brouillon: Partial<Record<PartieMatiere, ChoixPartie | null>> = {};
  const refus: Partial<Record<PartieMatiere, string>> = {};
  for (const [p, v] of Object.entries((o.projet as Record<string, unknown>) ?? {})) if (estPartie(p) && choixValide(v)) projet[p] = { ref: v.ref, nom: v.nom };
  for (const [p, v] of Object.entries((o.brouillon as Record<string, unknown>) ?? {})) if (estPartie(p) && (v === null || choixValide(v))) brouillon[p] = v === null ? null : { ref: v.ref, nom: v.nom };
  for (const [p, v] of Object.entries((o.refus as Record<string, unknown>) ?? {})) if (estPartie(p) && typeof v === 'string') refus[p] = v.slice(0, 300);
  return normaliser({ v: 1, projet, brouillon, refus, maj: typeof o.maj === 'number' ? o.maj : 0, auteur: typeof o.auteur === 'string' ? o.auteur : '' });
}

function normaliser(s: SelectionCatalogue): SelectionCatalogue {
  const brouillon = { ...s.brouillon };
  for (const p of PARTIES_MATIERE) {
    if (!(p in brouillon)) continue;
    const b = brouillon[p];
    if ((b === null && !s.projet[p]) || (b && s.projet[p]?.ref === b.ref)) delete brouillon[p];
  }
  return { ...s, brouillon };
}

/** Ce que montre « Ma sélection » : par partie, le choix en vigueur et son état. */
export type EtatLigne = 'projet' | 'a_envoyer' | 'retrait_a_envoyer';
export interface LigneSelection { readonly partie: PartieMatiere; readonly choix: ChoixPartie; readonly etat: EtatLigne; readonly refus: string | null }
export function lignesSelection(s: SelectionCatalogue): LigneSelection[] {
  const out: LigneSelection[] = [];
  for (const p of PARTIES_MATIERE) {
    const refus = s.refus[p] ?? null;
    if (p in s.brouillon) {
      const b = s.brouillon[p];
      if (b) out.push({ partie: p, choix: b, etat: 'a_envoyer', refus });
      else if (s.projet[p]) out.push({ partie: p, choix: s.projet[p]!, etat: 'retrait_a_envoyer', refus });
    } else if (s.projet[p]) out.push({ partie: p, choix: s.projet[p]!, etat: 'projet', refus });
  }
  return out;
}
/** Choix en vigueur d'une partie (brouillon d'abord) ; null = rien ou retrait demandé. */
export function choixEnVigueur(s: SelectionCatalogue, p: PartieMatiere): ChoixPartie | null {
  return p in s.brouillon ? s.brouillon[p] ?? null : s.projet[p] ?? null;
}
export const aEnvoyer = (s: SelectionCatalogue): boolean => Object.keys(s.brouillon).length > 0;

/** Page : choisit une matière pour une partie (brouillon). */
export function choisirDansPage(s: SelectionCatalogue, p: PartieMatiere, choix: ChoixPartie): SelectionCatalogue {
  const refus = { ...s.refus }; delete refus[p];
  return normaliser({ ...s, brouillon: { ...s.brouillon, [p]: { ref: choix.ref, nom: choix.nom } }, refus });
}
/** Page : retire le choix d'une partie (annule un brouillon, ou demande le retrait de ce qui est dans le projet). */
export function retirerDansPage(s: SelectionCatalogue, p: PartieMatiere): SelectionCatalogue {
  const refus = { ...s.refus }; delete refus[p];
  if (p in s.brouillon && s.brouillon[p]) { const b = { ...s.brouillon }; delete b[p]; return normaliser({ ...s, brouillon: b, refus }); }
  return normaliser({ ...s, brouillon: { ...s.brouillon, [p]: null }, refus });
}
/** « Utiliser dans mon projet » : le brouillon passe dans le projet (la carte d'habillage l'applique). */
export function envoyerAuProjet(s: SelectionCatalogue): SelectionCatalogue {
  const projet: Partial<Record<PartieMatiere, ChoixPartie>> = { ...s.projet };
  for (const p of PARTIES_MATIERE) {
    if (!(p in s.brouillon)) continue;
    const b = s.brouillon[p];
    if (b) projet[p] = b; else delete projet[p];
  }
  return { ...s, projet, brouillon: {} };
}

/** Carte : son état (matières du catalogue) → choix du projet. Null tant qu'une matière relue d'un brief n'est pas résolue. */
export function projetDepuisEtat(etat: Pick<EtatBrief, 'matieres'>): ChoixParPartie | null {
  const out: Partial<Record<PartieMatiere, ChoixPartie>> = {};
  for (const p of PARTIES_MATIERE) {
    const m = etat.matieres?.[p];
    if (!m) continue;
    if (m.aResoudre) return null;
    out[p] = { ref: m.ref, nom: m.nom };
  }
  return out;
}
export const memesChoix = (a: ChoixParPartie, b: ChoixParPartie): boolean => PARTIES_MATIERE.every((p) => (a[p]?.ref ?? null) === (b[p]?.ref ?? null));

/** Traduction d'une référence pour une partie (catalogue chargé à la demande : matieresCatalogue.ts) ; null = plus proposée. */
export type ResoudreMatiere = (partie: PartieMatiere, ref: string) => { matiere: MatiereCatalogueChoisie; champs: Partial<ChoixBrief> } | null;

/**
 * Carte : applique le projet partagé à son état. Une partie ajoutée ou changée passe par choisirMatiereCatalogue (mêmes
 * garde-fous qu'un clic dans la carte) ; une partie absente du projet est retirée. Les refus sont rendus, par partie.
 */
export function appliquerProjetAEtat(
  etat: EtatBrief, projet: ChoixParPartie, resoudre: ResoudreMatiere, d: Pick<DemandeBrief, 'ambiances' | 'limites'>,
): { etat: EtatBrief; refus: Partial<Record<PartieMatiere, string>> } {
  let e = etat;
  const refus: Partial<Record<PartieMatiere, string>> = {};
  for (const p of PARTIES_MATIERE) {
    const voulu = projet[p];
    const actuel = e.matieres?.[p];
    if (!voulu) { if (actuel) e = retirerMatiereCatalogue(e, p); continue; }
    if (actuel?.ref === voulu.ref) continue;
    const r = resoudre(p, voulu.ref);
    if (!r) { refus[p] = `« ${voulu.nom} » n’est pas proposée pour : ${p === 'garde_corps' ? 'garde-corps' : p}.`; continue; }
    const c = choisirMatiereCatalogue(e, p, r.matiere, r.champs, d);
    if (c.refus) refus[p] = c.refus; else e = c.etat;
  }
  return { etat: e, refus };
}

// ── Navigateur ───────────────────────────────────────────────────────────────
const stockage = (): Storage | null => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };

export function lireSelection(conversation: string | null | undefined): SelectionCatalogue {
  try { return lireSelectionBrute(stockage()?.getItem(cleSelection(conversation)) ?? null); } catch { return SELECTION_VIDE; }
}

let canal: BroadcastChannel | null = null;
const canalPartage = (): BroadcastChannel | null => {
  if (canal || typeof BroadcastChannel === 'undefined') return canal;
  try { canal = new BroadcastChannel(CANAL_SELECTION); } catch { canal = null; }
  // Node (tests) : le canal partagé ne doit pas garder le processus en vie (sans effet dans un navigateur).
  (canal as unknown as { unref?: () => void } | null)?.unref?.();
  return canal;
};

/** Écrit la sélection d'une conversation et la diffuse (autres onglets + même onglet). */
export function ecrireSelection(conversation: string | null | undefined, s: SelectionCatalogue, auteur: string): SelectionCatalogue {
  const finale: SelectionCatalogue = { ...normaliser(s), maj: Date.now(), auteur };
  const cle = cleSelection(conversation);
  try { stockage()?.setItem(cle, JSON.stringify(finale)); } catch { /* stockage plein ou interdit : la diffusion suffit pour la session */ }
  const message = { cle, selection: finale };
  // Le canal joint aussi les autres composants du MÊME onglet ; l'événement de fenêtre n'est qu'un repli sans canal.
  const c = canalPartage();
  try { if (c) c.postMessage(message); else window.dispatchEvent(new CustomEvent(EVENEMENT_SELECTION, { detail: message })); } catch { /* ignore */ }
  return finale;
}

/** Écoute la sélection d'une conversation (autres onglets, même onglet) ; renvoie la fonction d'arrêt. */
export function ecouterSelection(conversation: string | null | undefined, auteur: string, rappel: (s: SelectionCatalogue) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const cle = cleSelection(conversation);
  const recu = (m: unknown) => {
    const x = m as { cle?: string; selection?: unknown } | null;
    if (!x || x.cle !== cle) return;
    const s = lireSelectionBrute(JSON.stringify(x.selection ?? null));
    if (s.auteur !== auteur) rappel(s);
  };
  const surCanal = (ev: MessageEvent) => recu(ev.data);
  const surFenetre = (ev: Event) => recu((ev as CustomEvent).detail);
  const surStockage = (ev: StorageEvent) => { if (ev.key === cle) { const s = lireSelectionBrute(ev.newValue); if (s.auteur !== auteur) rappel(s); } };
  // Un canal PROPRE à l'écouteur : un BroadcastChannel ne reçoit pas ses propres messages.
  let c: BroadcastChannel | null = null;
  try { c = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CANAL_SELECTION) : null; } catch { c = null; }
  c?.addEventListener('message', surCanal);
  window.addEventListener(EVENEMENT_SELECTION, surFenetre);
  window.addEventListener('storage', surStockage);
  return () => {
    c?.removeEventListener('message', surCanal); c?.close();
    window.removeEventListener(EVENEMENT_SELECTION, surFenetre);
    window.removeEventListener('storage', surStockage);
  };
}

let compteur = 0;
/** Identifiant d'écrivain unique (par composant monté). */
export const nouvelAuteur = (prefixe: string): string => `${prefixe}-${Date.now().toString(36)}-${(compteur += 1)}-${Math.random().toString(36).slice(2, 7)}`;
