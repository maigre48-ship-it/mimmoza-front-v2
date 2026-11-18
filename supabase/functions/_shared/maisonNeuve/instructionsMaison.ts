// supabase/functions/_shared/maisonNeuve/instructionsMaison.ts
// =============================================================================
// LOT G10 (18/11/2026) — Maison individuelle NEUVE : lecture des demandes de l'utilisateur. Module PUR, sans LLM.
//
// Rôle : reconnaître une demande de construction de maison (« construire une maison », « faire bâtir », « maison neuve
// sur mon terrain ») et en tirer UNIQUEMENT les valeurs dites explicitement (surface habitable, niveaux, toit, style,
// menuiseries). Une formulation ambiguë n'est pas reprise : la question sera posée. Rien n'est deviné ni complété.
// Chaque valeur reprise porte le statut « confirmee » (dite par l'utilisateur) et la source « votre message ».
// =============================================================================

import type { Donnee, FormeToit } from '../extension/contrat.ts';

export type NiveauxMaison = 1 | 2;
export type StyleMaison = 'traditionnel' | 'contemporain';
export type MenuiseriesMaison = 'anthracite' | 'blanc' | 'bois';

export interface DemandeMaison {
  readonly surfaceHabitableM2?: Donnee<number>;
  readonly niveaux?: Donnee<NiveauxMaison>;
  readonly toit?: Donnee<FormeToit>;
  readonly style?: Donnee<StyleMaison>;
  readonly menuiseries?: Donnee<MenuiseriesMaison>;
}

/** Bornes de surface habitable acceptées pour une maison individuelle (en dehors : la question est reposée). */
export const BORNES_SURFACE_HABITABLE_M2 = [30, 400] as const;

export function normaliser(t: string): string {
  return (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
}

const RE_CONSTRUIRE = /\b(?:construire|construction|batir|faire batir|faire construire|edifier)\b/;
const RE_MAISON = /\b(?:maison|pavillon|villa|habitation)\b/;
const RE_NEUF = /\b(?:neuve?|nouvelle|nouveau|sur (?:mon|le|ce) terrain|terrain nu|terrain a batir)\b/;
const RE_EXTENSION = /\b(?:agrandi\w*|extension|surelev\w*|rehauss\w*|veranda|garage accole)\b/;

/**
 * Demande de MAISON NEUVE ? Vrai pour « construire une maison », « faire bâtir un pavillon », « une maison neuve sur
 * mon terrain ». Faux pour un agrandissement (le parcours d'extension s'en charge) et pour un immeuble. Pur.
 */
export function detecterIntentionMaisonNeuve(texte: string | null | undefined): boolean {
  const t = normaliser(texte ?? '');
  if (!t || RE_EXTENSION.test(t)) return false;
  if (/\b(?:immeuble|logements|collectif|residence)\b/.test(t)) return false;
  if (!RE_MAISON.test(t)) return false;
  return RE_CONSTRUIRE.test(t) || RE_NEUF.test(t);
}

const D = <T,>(valeur: T, source = 'votre message'): Donnee<T> => ({ valeur, statut: 'confirmee', source });

/** Surface habitable dite explicitement (« 120 m² habitables », « maison de 110 m2 »). Pur. */
export function lireSurfaceHabitable(t: string): number | null {
  // Une surface de TERRAIN (« terrain de 600 m² ») n'est pas une surface habitable.
  const sans = t.replace(/\b(?:terrain|parcelle|jardin)\s+(?:de\s+|d'environ\s+)?\d+(?:[.,]\d+)?\s*(?:m2|m²|metres? carres?)/g, ' ');
  const m = /(\d{2,3}(?:[.,]\d+)?)\s*(?:m2|m²|metres? carres?)(?![a-z0-9])/.exec(sans);
  if (!m) return null;
  const v = Number(m[1]!.replace(',', '.'));
  return v >= BORNES_SURFACE_HABITABLE_M2[0] && v <= BORNES_SURFACE_HABITABLE_M2[1] ? v : null;
}

/** Niveaux dits explicitement. R+2 et plus : renvoyé tel quel (le parcours le plafonne à R+1 et le dit). Pur. */
export function lireNiveaux(t: string): NiveauxMaison | 3 | null {
  if (/\bplain[- ]?pied\b|\bsans etage\b|\bde plain pied\b/.test(t)) return 1;
  if (/\br\s*\+\s*([2-9])\b|\b(?:deux|2|trois|3) etages\b/.test(t)) return 3;
  if (/\br\s*\+\s*1\b|\b(?:un|1) etage\b|\ba etage\b|\bavec etage\b|\bsur (?:deux|2) niveaux\b/.test(t)) return 2;
  return null;
}

/** Forme du toit dite explicitement. Pur. */
export function lireToit(t: string): FormeToit | null {
  if (/\b(?:toit|toiture)[- ](?:terrasse|plat)\b|\btoit plat\b/.test(t)) return 'plat';
  if (/\bmono[- ]?pente\b|\bun (?:seul )?pan\b/.test(t)) return 'monopente';
  if (/\b(?:4|quatre) pans\b|\bcroupes?\b/.test(t)) return 'quatre-pans';
  if (/\b(?:2|deux) pans\b|\bdouble pente\b/.test(t)) return 'deux-pans';
  return null;
}

export function lireStyle(t: string): StyleMaison | null {
  if (/\bcontemporaine?\b|\bmoderne\b/.test(t)) return 'contemporain';
  if (/\btraditionnel(?:le)?\b|\bclassique\b|\bneo[- ]?(?:bretonne|provencale|basque)\b/.test(t)) return 'traditionnel';
  return null;
}

export function lireMenuiseries(t: string): MenuiseriesMaison | null {
  const m = /\bmenuiseries?\s+(?:en\s+)?(anthracite|gris anthracite|noires?|blanches?|blanc|bois|chene)\b/.exec(t);
  if (!m) return null;
  const v = m[1]!;
  if (/anthracite|noir/.test(v)) return 'anthracite';
  if (/blanc/.test(v)) return 'blanc';
  return 'bois';
}

/** Valeurs reprises du message (seulement celles dites explicitement), et leur résumé lisible. Pur. */
export function lireInstructionsMaison(texte: string | null | undefined): { demande: DemandeMaison; reprises: string[]; niveauxPlafonnes: boolean } {
  const t = normaliser(texte ?? '');
  const reprises: string[] = [];
  const d: { -readonly [K in keyof DemandeMaison]: DemandeMaison[K] } = {};
  const s = lireSurfaceHabitable(t);
  if (s !== null) { d.surfaceHabitableM2 = D(s); reprises.push(`surface habitable ${s} m²`); }
  const n = lireNiveaux(t);
  let niveauxPlafonnes = false;
  if (n === 1 || n === 2) { d.niveaux = D(n); reprises.push(n === 1 ? 'plain-pied' : 'un étage (R+1)'); }
  else if (n === 3) niveauxPlafonnes = true;
  const toit = lireToit(t);
  if (toit) { d.toit = D(toit); reprises.push(`toit ${LIBELLES_TOIT[toit].toLowerCase()}`); }
  const st = lireStyle(t);
  if (st) { d.style = D(st); reprises.push(`style ${st}`); }
  const me = lireMenuiseries(t);
  if (me) { d.menuiseries = D(me); reprises.push(`menuiseries ${me}`); }
  return { demande: d, reprises, niveauxPlafonnes };
}

export const LIBELLES_TOIT: Readonly<Record<FormeToit, string>> = {
  'deux-pans': '2 pans',
  'quatre-pans': '4 pans',
  plat: 'Toit plat',
  monopente: 'Monopente',
};
