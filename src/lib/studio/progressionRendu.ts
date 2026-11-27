// src/lib/studio/progressionRendu.ts
// =============================================================================
// VIS-57 (26/11/2026) — BARRE DE PROGRESSION D'UN RENDU (cartes du chat et du parcours). Module PUR, sans import
// (front Vite, tsx, Deno).
//
// Source : les colonnes RÉELLES de `studio_jobs` écrites par la machine de rendu (`progression` 0–100, `etape` en
// français, `demarre_le`, `maj_le`), relues en direct par l'abonnement temps réel / le sondage existants
// (travaux.ts › suivreTravail). Rien n'est inventé :
//   · en attente : pas de pourcentage (le rendu n'a pas démarré) ;
//   · en cours  : pourcentage écrit par la machine, étape en clair, temps restant ESTIMÉ par extrapolation linéaire
//     (temps écoulé depuis le démarrage × reste / fait), dit « estimation » — absent tant qu'il n'est pas calculable
//     (démarrage inconnu, moins de 3 %, moins de 30 s) ou quand la machine ne donne plus de nouvelles (≥ 15 min).
// =============================================================================

export interface TravailProgression {
  readonly statut: string;
  readonly progression: number | null | undefined;
  readonly etape: string | null | undefined;
  readonly demarre_le?: string | null;
  readonly maj_le?: string | null;
}

export interface VueProgression {
  /** La barre est à montrer (en attente ou en cours). */
  readonly visible: boolean;
  /** 0–100 ; null : pas encore démarré (barre indéterminée). */
  readonly pourcentage: number | null;
  /** Étape en clair (« Rendu du film », « En file d'attente »). */
  readonly etape: string;
  /** « environ 12 min restantes (estimation) » ; null : non calculable (rien n'est affiché). */
  readonly reste: string | null;
  /** Texte d'accessibilité (aria-valuetext). */
  readonly texte: string;
}

/** Au-delà, la machine ne donne plus de nouvelles : l'estimation est suspendue (elle serait fausse). */
export const SILENCE_ESTIMATION_MS = 15 * 60_000;
const MIN_ECOULE_MS = 30_000;
const MIN_POURCENT = 3;

export function bornerPourcentage(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** « 45 s », « 12 min », « 1 h 05 ». */
export function dureeCourte(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const mn = Math.round(s / 60);
  if (mn < 60) return `${mn} min`;
  const h = Math.floor(mn / 60);
  const r = mn % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

/** Étape écrite par la machine → libellé lisible (jamais vide). */
export function etapeEnClair(etape: string | null | undefined, statut: string): string {
  if (statut === 'en_attente') return 'En file d’attente';
  const t = typeof etape === 'string' ? etape.replace(/\s+/g, ' ').trim() : '';
  if (!t) return 'Préparation';
  const propre = t.replace(/^\[[^\]]*\]\s*/, '').replace(/[_]+/g, ' ');
  const court = propre.length > 90 ? `${propre.slice(0, 89)}…` : propre;
  return court.charAt(0).toUpperCase() + court.slice(1);
}

export function vueProgression(t: TravailProgression | null, maintenant: number): VueProgression {
  if (!t || (t.statut !== 'en_attente' && t.statut !== 'en_cours')) {
    return { visible: false, pourcentage: null, etape: '', reste: null, texte: '' };
  }
  const etape = etapeEnClair(t.etape, t.statut);
  if (t.statut === 'en_attente') return { visible: true, pourcentage: null, etape, reste: null, texte: 'En attente de la machine de rendu' };
  const p = bornerPourcentage(t.progression);
  const debut = t.demarre_le ? Date.parse(t.demarre_le) : NaN;
  const dernier = t.maj_le ? Date.parse(t.maj_le) : debut;
  const ecoule = Number.isFinite(debut) ? maintenant - debut : NaN;
  const silence = Number.isFinite(dernier) ? maintenant - dernier : NaN;
  let reste: string | null = null;
  if (Number.isFinite(ecoule) && ecoule >= MIN_ECOULE_MS && p >= MIN_POURCENT && p < 100 && !(silence >= SILENCE_ESTIMATION_MS)) {
    const restant = (ecoule * (100 - p)) / p;
    reste = restant < 60_000 ? 'moins d’une minute restante (estimation)' : restant > 6 * 3_600_000 ? 'plus de 6 h restantes (estimation)' : `environ ${dureeCourte(restant)} restantes (estimation)`;
  }
  return { visible: true, pourcentage: p, etape, reste, texte: `${etape} — ${p} %${reste ? `, ${reste}` : ''}` };
}
