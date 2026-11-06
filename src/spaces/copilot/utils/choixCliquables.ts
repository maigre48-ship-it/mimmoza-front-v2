// src/spaces/copilot/utils/choixCliquables.ts
// LOT CHOIX-CLIQUABLES (06/11/2026) — réponses cliquables aux questions à choix de Mimmo.
//
// Constat du 06/11 : Mimmo posait ses questions à choix EN TEXTE (« Façade : enduit clair, brique… ?
// Balcons : … ? ») et l'utilisateur devait tout retaper. Désormais, une question à choix fermés est
// suivie, à la toute fin de la réponse, d'un bloc :
//
//   ```mimmoza-choix
//   {"v":1,"questions":[{"id":"facade","libelle":"Façade","options":["Enduit clair","Brique"],
//     "multiple":false,"defaut":"Enduit clair"}],"libre":true,"a_toi_de_choisir":true}
//   ```
//
// Le bloc n'est jamais affiché tel quel : le fil le remplace par des puces cliquables. Cliquer
// n'envoie rien : les choix remplissent le champ de saisie (« Façade : Brique · Balcons : Loggias »),
// l'utilisateur complète puis envoie. Un bloc invalide est ignoré (le texte reste lisible).
// Logique PURE (aucun import React) : testée par choixCliquables.test.ts.

export const LANGUE_BLOC_CHOIX = 'mimmoza-choix';
export const CHOIX_VERSION = 1;
export const CHOIX_QUESTIONS_MAX = 6;
export const CHOIX_OPTIONS_MIN = 2;
export const CHOIX_OPTIONS_MAX = 10;
export const CHOIX_OPTION_LONGUEUR_MAX = 60;
export const CHOIX_LIBELLE_LONGUEUR_MAX = 60;
export const CHOIX_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
/** Bloc brut au-delà : ignoré (protection contre un JSON démesuré). */
export const CHOIX_BLOC_LONGUEUR_MAX = 6000;
/** Libellé de la délégation, repris tel quel dans le champ de saisie. */
export const LIBELLE_A_TOI = 'À toi de choisir';

export interface QuestionChoix {
  id: string;
  libelle: string;
  options: string[];
  multiple: boolean;
  /** Suggestion(s) de Mimmo (toujours parmi les options) ; signalée(s), jamais présélectionnée(s). */
  defaut: string[];
}

export interface BlocChoix {
  questions: QuestionChoix[];
  /** L'utilisateur peut compléter en texte libre (indication sous les puces). Défaut : true. */
  libre: boolean;
  /** Bouton « À toi de choisir ». Défaut : false. */
  aToiDeChoisir: boolean;
}

export interface EtatChoix {
  /** id de question → options choisies (ordre des options du bloc). */
  selections: Record<string, string[]>;
  aToi: boolean;
}

const RE_BLOC_FERME = /```mimmoza-choix[ \t]*\r?\n([\s\S]*?)```/g;
const OUVERTURE = '```' + LANGUE_BLOC_CHOIX;

const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Texte ramené à une forme comparable : sans accents, minuscules, espaces réduits. */
export function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

function texteCourt(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t || t.length > max) return null;
  return t;
}

/**
 * Valide un bloc déjà décodé. Champs obligatoires invalides → null (bloc ignoré) ;
 * champs facultatifs invalides (defaut hors liste, booléens d'un autre type) → valeur par défaut.
 */
export function validerBlocChoix(brut: unknown): BlocChoix | null {
  if (!estObj(brut)) return null;
  if (brut.v !== undefined && brut.v !== CHOIX_VERSION) return null;
  const qs = brut.questions;
  if (!Array.isArray(qs) || qs.length === 0 || qs.length > CHOIX_QUESTIONS_MAX) return null;
  const questions: QuestionChoix[] = [];
  const ids = new Set<string>();
  const libelles = new Set<string>();
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    if (!estObj(q)) return null;
    const libelle = texteCourt(q.libelle, CHOIX_LIBELLE_LONGUEUR_MAX);
    if (!libelle) return null;
    const id = q.id === undefined ? `q${i + 1}` : typeof q.id === 'string' && CHOIX_ID_RE.test(q.id) ? q.id : null;
    if (!id || ids.has(id) || libelles.has(normaliser(libelle))) return null;
    if (!Array.isArray(q.options) || q.options.length < CHOIX_OPTIONS_MIN || q.options.length > CHOIX_OPTIONS_MAX) return null;
    const options: string[] = [];
    const vues = new Set<string>();
    for (const o of q.options) {
      const t = texteCourt(o, CHOIX_OPTION_LONGUEUR_MAX);
      if (!t || t.includes('·') || vues.has(normaliser(t))) return null;
      vues.add(normaliser(t));
      options.push(t);
    }
    const multiple = q.multiple === true;
    const defautsBruts = Array.isArray(q.defaut) ? q.defaut : q.defaut === undefined || q.defaut === null ? [] : [q.defaut];
    const defaut = options.filter((o) => defautsBruts.some((d) => typeof d === 'string' && normaliser(d) === normaliser(o)));
    ids.add(id); libelles.add(normaliser(libelle));
    questions.push({ id, libelle, options, multiple, defaut: multiple ? defaut : defaut.slice(0, 1) });
  }
  return {
    questions,
    libre: brut.libre !== false,
    aToiDeChoisir: brut.a_toi_de_choisir === true,
  };
}

/**
 * Bloc de choix d'un message assistant. `visible` : le texte SANS aucun bloc mimmoza-choix
 * (blocs fermés retirés ; une ouverture jamais refermée — streaming, coupure — est coupée jusqu'à la fin).
 * `bloc` : le DERNIER bloc fermé valide, ou null.
 */
export function lireBlocChoix(texte: string): { visible: string; bloc: BlocChoix | null } {
  if (!texte || !texte.includes(OUVERTURE)) return { visible: texte, bloc: null };
  let bloc: BlocChoix | null = null;
  RE_BLOC_FERME.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_BLOC_FERME.exec(texte)) !== null) {
    if (m[1].length > CHOIX_BLOC_LONGUEUR_MAX) continue;
    try {
      const v = validerBlocChoix(JSON.parse(m[1]));
      if (v) bloc = v;
    } catch { /* JSON invalide : bloc ignoré, le texte reste */ }
  }
  let visible = texte.replace(RE_BLOC_FERME, '');
  const ouvert = visible.indexOf(OUVERTURE);
  if (ouvert !== -1) visible = visible.slice(0, ouvert);
  return { visible: visible.replace(/\n{3,}/g, '\n\n').trim(), bloc };
}

/** Texte sans bloc de choix (exports, lecture vocale). */
export function sansBlocsChoix(texte: string): string {
  return lireBlocChoix(texte).visible;
}

export function etatVide(): EtatChoix {
  return { selections: {}, aToi: false };
}

/** Clic sur une option : choix unique → sélectionne (ou désélectionne si déjà choisie) ; multiple → bascule. */
export function basculerOption(etat: EtatChoix, bloc: BlocChoix, questionId: string, option: string): EtatChoix {
  const q = bloc.questions.find((x) => x.id === questionId);
  if (!q || !q.options.includes(option)) return etat;
  const actuel = etat.selections[questionId] ?? [];
  let suivant: string[];
  if (q.multiple) {
    const choisies = actuel.includes(option) ? actuel.filter((o) => o !== option) : [...actuel, option];
    suivant = q.options.filter((o) => choisies.includes(o));
  } else {
    suivant = actuel.length === 1 && actuel[0] === option ? [] : [option];
  }
  const selections = { ...etat.selections };
  if (suivant.length) selections[questionId] = suivant; else delete selections[questionId];
  return { ...etat, selections };
}

export function basculerAToi(etat: EtatChoix): EtatChoix {
  return { ...etat, aToi: !etat.aToi };
}

/**
 * Ligne lisible écrite dans le champ de saisie, dans l'ordre des questions :
 * « Façade : Brique · Balcons : Loggias, Balcons filants · Pour le reste : à toi de choisir ».
 * Rien de choisi → chaîne vide.
 */
export function composerReponse(bloc: BlocChoix, etat: EtatChoix): string {
  const parties: string[] = [];
  for (const q of bloc.questions) {
    const choisies = q.options.filter((o) => (etat.selections[q.id] ?? []).includes(o));
    if (choisies.length) parties.push(`${q.libelle} : ${choisies.join(', ')}`);
  }
  const complet = bloc.questions.every((q) => (etat.selections[q.id] ?? []).length > 0);
  if (etat.aToi) {
    if (!parties.length) return `${LIBELLE_A_TOI}.`;
    if (!complet) parties.push('Pour le reste : à toi de choisir');
  }
  return parties.join(' · ');
}

/**
 * Nouveau contenu du champ de saisie. `ancienne` : la ligne écrite au clic précédent (remplacée sur place
 * si elle est encore présente, pour garder les détails tapés autour) ; sinon la ligne passe en tête.
 */
export function fusionnerSaisie(actuel: string, ancienne: string, nouvelle: string): string {
  if (ancienne && actuel.includes(ancienne)) {
    const remplace = actuel.replace(ancienne, nouvelle);
    return nouvelle ? remplace : remplace.replace(/^\s*\n/, '').replace(/\n\s*$/, '').replace(/\n{3,}/g, '\n\n');
  }
  if (!nouvelle) return actuel;
  if (!actuel.trim()) return nouvelle;
  return `${nouvelle}\n${actuel}`;
}

/**
 * Réponse donnée (message utilisateur suivant) → état figé des puces. Reconnaît la ligne composée
 * (« Libellé : option, option · … ») et la délégation ; une option non reconnue est ignorée.
 */
export function reponsesDepuisTexte(bloc: BlocChoix, texte: string): EtatChoix {
  const etat = etatVide();
  if (!texte) return etat;
  const parties = texte.split(/\n|\s·\s/);
  for (const partie of parties) {
    const m = /^\s*([^:]{1,80}?)\s*:\s*(.+)$/.exec(partie);
    if (!m) continue;
    const q = bloc.questions.find((x) => normaliser(x.libelle) === normaliser(m[1]));
    if (!q) continue;
    let reste = ` ${normaliser(m[2])} `;
    const trouvees: string[] = [];
    // Les options les plus longues d'abord : « Balcons filants » avant « Balcons ».
    for (const o of [...q.options].sort((a, b) => b.length - a.length)) {
      const n = normaliser(o);
      const re = new RegExp(`(^|[\\s,;.(])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s,;.)!?])`);
      if (re.test(reste)) { trouvees.push(o); reste = reste.replace(re, '$1 '); }
    }
    const choisies = q.options.filter((o) => trouvees.includes(o));
    if (choisies.length) etat.selections[q.id] = q.multiple ? choisies : choisies.slice(0, 1);
  }
  etat.aToi = normaliser(texte).includes(normaliser(LIBELLE_A_TOI));
  return etat;
}

/**
 * Les puces ne sont actives que sur le DERNIER message du fil, s'il vient de Mimmo et qu'il est complet.
 * `reponse` : texte du message utilisateur qui suit (pour l'affichage figé), ou null.
 */
export function situationChoix(messages: readonly { id: string; role: string; text: string; status?: string }[], messageId: string): { actif: boolean; reponse: string | null } {
  const i = messages.findIndex((m) => m.id === messageId);
  if (i === -1) return { actif: false, reponse: null };
  const m = messages[i];
  const suivant = messages.slice(i + 1).find((x) => x.role === 'user') ?? null;
  const actif = i === messages.length - 1 && m.role === 'assistant' && (m.status === undefined || m.status === 'complete');
  return { actif, reponse: suivant ? suivant.text : null };
}
