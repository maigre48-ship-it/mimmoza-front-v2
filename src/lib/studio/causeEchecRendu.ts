// src/lib/studio/causeEchecRendu.ts
// =============================================================================
// VIS-57 (26/11/2026) — LA VRAIE CAUSE D'UN RENDU EN ÉCHEC. Module PUR, sans import (front Vite, tsx, Deno).
//
// Constat : la machine de rendu (worker/src/erreurs.ts › erreurDepuisCodeFilm, worker/src/moteur.ts) écrit dans
// `studio_jobs.erreur` deux messages GÉNÉRIQUES qui accusent l'utilisateur à tort :
//   « … (aucun plan de caméra exploitable). Vérifiez la description du bâtiment dans la conversation. »
//   « Le projet n’a pas pu être construit à partir de la fiche. Vérifiez la description du bâtiment dans la conversation. »
// alors que la cause réelle (projet non publié vers Unreal, storyboard vide, plans refusés, arrêt de l'étape scène…)
// n'a rien à voir avec la description. La cause technique va à `client_errors` (VIS-28 : `message` =
// « worker_<étape> — <première ligne du détail> », lisible par la clé service seulement).
//
// Ici : on remplace ces deux messages par la cause RÉELLE — tirée du détail technique quand il est connu (Edge
// copilot-chat, ou RPC `studio_job_cause_echec` si la migration VIS-57 est appliquée), sinon formulée sans accuser la
// description. Les autres messages de la machine (déjà précis) sont gardés tels quels.
// =============================================================================

export const RE_MESSAGE_TROMPEUR = /V[ée]rifiez la description du b[âa]timent/i;
const RE_MISE_EN_SCENE = /mis en sc[èe]ne pour le film|aucun plan de cam[ée]ra/i;
const RE_CONSTRUCTION = /construit [àa] partir de la fiche/i;

export interface EchecTravail {
  readonly erreur: string | null | undefined;
  readonly etape?: string | null;
  readonly type?: string | null;
  /** Détail technique (client_errors.message ou .stack), s'il a pu être lu ; jamais montré brut. */
  readonly detail?: string | null;
}

export interface CauseEchec {
  /** Phrase pour l'utilisateur (sans « Vérifiez la description du bâtiment » quand ce n'est pas la cause). */
  readonly phrase: string;
  /** Le message d'origine était trompeur et a été remplacé. */
  readonly corrigee: boolean;
  /** Extrait technique nettoyé (chemins, identifiants retirés) ; null si inconnu. */
  readonly technique: string | null;
}

/** Retire chemins de fichiers, identifiants et adresses ; borne la longueur. */
export function nettoyerDetail(d: string | null | undefined, max = 220): string | null {
  if (typeof d !== 'string') return null;
  let t = d.split(/\r?\n/)[0] ?? '';
  t = t.replace(/^worker_[a-z0-9_-]+\s+—\s+/i, '')
    .replace(/[A-Za-z]:\\[^\s'"|]+/g, '…')
    .replace(/(?:\/[\w.@-]+){2,}/g, '…')
    .replace(/https?:\/\/\S+/g, '…')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '#')
    .replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const refusDe = (d: string): string | null => {
  const m = /REFUS\s*:\s*([^·|]+)/i.exec(d) ?? /erreur\s*:\s*([^·|]+)/i.exec(d);
  return m ? m[1]!.trim() : null;
};

function causeMiseEnScene(detail: string | null): string {
  const d = detail ?? '';
  if (/n[’']est pas publi[ée]|publiez d[’']abord/i.test(d)) return 'le projet 3D n’avait pas été publié vers le moteur de rendu (Unreal) au moment du tournage : la machine de rendu n’avait rien à filmer';
  if (/storyboard vide/i.test(d)) return 'aucun plan du scénario n’a pu être placé dans la scène (storyboard vide) : les caméras demandées ne trouvent pas leur sujet dans la maquette publiée';
  if (/plans? refus[ée]s?/i.test(d)) {
    const r = refusDe(d);
    return `les plans de caméra du scénario ont été refusés par le contrôle automatique${r ? ` (${nettoyerDetail(r, 160)})` : ''}`;
  }
  return 'aucun plan de caméra exploitable n’a été produit par la machine de rendu (projet non publié vers Unreal, ou plans du scénario refusés par le contrôle)';
}

function causeConstruction(detail: string | null, etape: string | null): string {
  const d = detail ?? '';
  const m = /sc[èe]ne\s*:\s*(.+?)(?:\s+—\s+|$)/i.exec(d);
  const brute = m ? m[1]!.trim() : null;
  if (brute && /^code\s+\d+$/i.test(brute)) return `la construction de la scène 3D s’est arrêtée sur la machine de rendu (${brute}, pendant « ${etape?.trim() || 'Préparation de la scène'} »)`;
  if (brute && /d[ée]lai|timeout|temps imparti/i.test(brute)) return 'la construction de la scène 3D a dépassé le temps imparti sur la machine de rendu';
  if (brute) return `la construction de la scène 3D a été interrompue : ${nettoyerDetail(brute, 160)}`;
  return `la machine de rendu n’a pas pu construire la scène 3D du projet (étape « ${etape?.trim() || 'Préparation de la scène'} ») — la cause technique est enregistrée pour l’équipe Mimmoza`;
}

/**
 * Phrase d'échec à afficher. Le message de la machine est gardé s'il est précis ; les deux messages génériques qui
 * renvoient à « la description du bâtiment » sont remplacés par la cause réelle (détail connu) ou par une phrase qui
 * ne l'accuse pas (détail inconnu).
 */
export function causeEchecRendu(e: EchecTravail): CauseEchec {
  const erreur = typeof e.erreur === 'string' ? e.erreur.trim() : '';
  const technique = nettoyerDetail(e.detail);
  if (!erreur) return { phrase: 'La préparation n’a pas abouti. Vous pouvez relancer.', corrigee: false, technique };
  if (!RE_MESSAGE_TROMPEUR.test(erreur)) return { phrase: erreur, corrigee: false, technique };
  const detail = typeof e.detail === 'string' ? e.detail : null;
  const cause = RE_MISE_EN_SCENE.test(erreur) ? causeMiseEnScene(detail)
    : RE_CONSTRUCTION.test(erreur) ? causeConstruction(detail, e.etape ?? null)
      : 'la machine de rendu s’est arrêtée sur une erreur interne';
  const quoi = e.type === 'film' ? 'Le film' : e.type === 'visite360' ? 'La visite 360°' : e.type === 'image' ? 'L’image' : 'Le rendu';
  return {
    phrase: `${quoi} n’a pas pu être produit${e.type === 'image' || e.type === 'visite360' ? 'e' : ''} : ${cause}. Rien n’indique que la description du bâtiment soit en cause. Vous pouvez relancer.`,
    corrigee: true, technique,
  };
}
