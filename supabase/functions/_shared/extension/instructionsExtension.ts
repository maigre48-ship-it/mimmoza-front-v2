// supabase/functions/_shared/extension/instructionsExtension.ts
// =============================================================================
// LOT G3 (17/11/2026) — « J'envoie une photo avec mes instructions » : les INSTRUCTIONS écrites librement par
// l'utilisateur (« ajoute une extension de 4 × 5 m à gauche, même hauteur, baie vitrée anthracite ») préremplissent le
// parcours d'extension. Module PUR et DÉTERMINISTE.
//
// Aucun modèle de langage : seules des formulations EXPLICITES du message de l'utilisateur sont reprises (le parcours ne
// prend jamais une valeur proposée par le modèle). Une formulation ambiguë ou contradictoire (« à gauche » ET « à
// droite ») n'est pas reprise : la question reste posée. Les réponses aux puces (« Libellé : option ») et les blocs
// techniques (```…```) sont ignorés ici : ils sont lus par `lireReponses`.
// Les dimensions (« 4 × 5 m ») et la hauteur à l'égout (« égout 5,2 m ») sont déjà lues par `lireReponses`.
// Le toit de la maison n'est JAMAIS repris d'une instruction libre (« toit plat » peut décrire l'extension) : sa forme
// est confirmée par la question du parcours.
// =============================================================================

export type TypeInstruction = 'laterale' | 'arriere' | 'surelevation' | 'garage' | 'veranda';
export type CoteInstruction = 'gauche' | 'droite' | 'arriere' | 'rue';
export type MenuiserieInstruction = 'av-aluminium-noir' | 'av-aluminium-blanc' | 'av-chene-porte';

/** Valeurs reprises du message (absente = non dite, ou ambiguë). */
export interface InstructionsLues {
  readonly conserver?: boolean;
  readonly type?: TypeInstruction;
  readonly facade?: CoteInstruction;
  readonly memeHauteur?: true;
  readonly niveauxExtension?: 1 | 2;
  readonly menuiserie?: MenuiserieInstruction;
  readonly baies?: 'auto' | 'aucune';
}

/** Sous-ensemble de l'état du parcours que les instructions peuvent compléter (champs encore vides seulement). */
export interface EtatComplete {
  readonly conserver: boolean | null;
  readonly type: TypeInstruction | null;
  readonly facade: CoteInstruction | null;
  readonly niveauxExtension: number | null;
  readonly memeHauteur?: boolean;
  readonly menuiserie?: MenuiserieInstruction | 'inconnue' | null;
  readonly baies?: 'auto' | 'aucune' | 'inconnue' | null;
}

export function normaliserInstructions(t: string): string {
  return (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * Texte LIBRE du message : blocs ```…``` retirés, segments « Libellé connu : valeur » (réponses aux puces) retirés.
 * `libelles` : libellés des questions du parcours (normalisés ou non).
 */
export function texteLibre(texte: string, libelles: readonly string[]): string {
  const sansBlocs = (texte ?? '').replace(/```[\s\S]*?```/g, ' ');
  const connus = libelles.map(normaliserInstructions);
  return sansBlocs.split(/[·\n;]/).filter((s) => {
    const i = s.indexOf(':');
    if (i < 0) return true;
    const cle = normaliserInstructions(s.slice(0, i));
    return !connus.some((l) => cle === l || cle.endsWith(l));
  }).join(' . ');
}

const un = <T,>(candidats: readonly (T | null)[]): T | undefined => {
  const v = [...new Set(candidats.filter((x): x is T => x !== null))];
  return v.length === 1 ? v[0] : undefined;
};

/** Instructions explicites du message (texte libre seulement). */
export function lireInstructions(texte: string, libelles: readonly string[] = []): InstructionsLues {
  const t = normaliserInstructions(texteLibre(texte, libelles));
  if (!t) return {};
  const out: { -readonly [K in keyof InstructionsLues]: InstructionsLues[K] } = {};

  // Maison conservée ou démolie.
  const conserve = /\b(?:je (?:la |veux la )?(?:conserve|garde)|(?:conserver|garder) (?:la|ma) maison|maison (?:existante )?(?:conservee|gardee)|tout (?:est )?conserve|on (?:la )?garde)\b/.test(t);
  const demolit = /\b(?:demolir|demolition|raser|detruire) (?:la|ma) maison\b|\bmaison (?:a )?demolir\b/.test(t);
  if (conserve !== demolit) out.conserver = conserve;

  // Côté (vu de la rue, comme la question du parcours).
  const gauche = /\b(?:a|sur la|du cote|cote|coté|partie) gauche\b|\bgauche de la maison\b|\ba gauche\b/.test(t) ? 'gauche' : null;
  const droite = /\b(?:a|sur la|du cote|cote|partie) droite\b|\bdroite de la maison\b|\ba droite\b/.test(t) ? 'droite' : null;
  const arriere = /\b(?:a|sur|vers) l'arriere\b|\bderriere (?:la|ma) maison\b|\bcote jardin\b|\bextension arriere\b/.test(t) ? 'arriere' : null;
  const rue = /\bcote rue\b|\bsur (?:la )?rue\b|\bdevant (?:la|ma) maison\b|\ben facade sur rue\b/.test(t) ? 'rue' : null;
  const cote = un<CoteInstruction>([gauche, droite, arriere, rue]);
  if (cote) out.facade = cote;

  // Type d'agrandissement.
  const surelev = /\b(?:surelev\w*|rehauss\w*|ajouter un etage|un etage de plus|monter d'un etage)\b/.test(t) ? 'surelevation' : null;
  const garage = /\bgarage\b/.test(t) ? 'garage' : null;
  const veranda = /\bveranda\b/.test(t) ? 'veranda' : null;
  const laterale = /\blateral\w*\b/.test(t) ? 'laterale' : null;
  const arr = /\bextension arriere\b|\bagrandissement arriere\b/.test(t) ? 'arriere' : null;
  const type = un<TypeInstruction>([surelev, garage, veranda, laterale, arr]);
  if (type) out.type = type;
  else if (!surelev && !garage && !veranda && !laterale && !arr && /\b(?:extension|agrandi\w*|agrandissement|ajout\w*)\b/.test(t)) {
    // « Extension à gauche » = latérale ; « extension à l'arrière » = arrière (même lecture que la question « Façade »).
    if (cote === 'gauche' || cote === 'droite') out.type = 'laterale';
    else if (cote === 'arriere') out.type = 'arriere';
  }
  if (out.type === 'surelevation') delete out.facade;

  // Hauteur de l'extension : « même hauteur », « plain-pied », « sur 2 niveaux » (jamais « R+1 », qui décrit souvent la maison).
  const meme = /\b(?:meme hauteur|aussi haute?|a la hauteur de la maison|alignee? sur la maison)\b/.test(t);
  const plain = /\b(?:de |en )?plain[- ]pied\b/.test(t);
  const deux = /\b(?:sur|en|de) (?:2|deux) niveaux\b|\ba etage\b|\bavec (?:un )?etage\b/.test(t);
  if ([meme, plain, deux].filter(Boolean).length === 1) {
    if (meme) out.memeHauteur = true;
    else if (plain) out.niveauxExtension = 1;
    else out.niveauxExtension = 2;
  }

  // Menuiseries : seulement si le message parle de menuiseries, fenêtres ou châssis (« baie » seule ne suffit pas).
  if (/\b(?:menuiser\w*|fenetres?|chassis|huisser\w*|alu(?:minium)?)\b/.test(t)) {
    const noir = /\b(?:anthracite|gris(?: fonce)?|noire?s?)\b/.test(t) ? 'av-aluminium-noir' : null;
    const blanc = /\bblanc(?:he)?s?\b/.test(t) ? 'av-aluminium-blanc' : null;
    const bois = /\b(?:bois|chene)\b/.test(t) ? 'av-chene-porte' : null;
    const m = un<MenuiserieInstruction>([noir, blanc, bois]);
    if (m) out.menuiserie = m;
  }

  // Baie vitrée.
  const sansBaie = /\bsans (?:grande )?baie\b|\bmurs? pleins?\b/.test(t);
  const avecBaie = /\b(?:baies? vitrees?|grande baie|baie coulissante|avec (?:une )?baie)\b/.test(t);
  if (sansBaie) out.baies = 'aucune';
  else if (avecBaie) out.baies = 'auto';
  return out;
}

const LIB_TYPE: Readonly<Record<TypeInstruction, string>> = { laterale: 'extension latérale', arriere: 'extension arrière', surelevation: 'surélévation', garage: 'garage', veranda: 'véranda' };
const LIB_COTE: Readonly<Record<CoteInstruction, string>> = { gauche: 'à gauche (vu de la rue)', droite: 'à droite (vu de la rue)', arriere: 'à l’arrière', rue: 'côté rue' };
const LIB_MENUISERIE: Readonly<Record<MenuiserieInstruction, string>> = { 'av-aluminium-noir': 'menuiseries anthracite', 'av-aluminium-blanc': 'menuiseries blanches', 'av-chene-porte': 'menuiseries bois' };

/**
 * Complète l'état avec les instructions du message, champ VIDE par champ vide (une réponse déjà donnée n'est jamais
 * remplacée). Renvoie le nouvel état et, en mots simples, ce qui a été repris (pour le dire à l'utilisateur).
 */
export function completerParInstructions<E extends EtatComplete>(etat: E, texte: string, libelles: readonly string[] = []): { etat: E; reprises: string[] } {
  const ins = lireInstructions(texte, libelles);
  const e = { ...etat } as Record<string, unknown>;
  const reprises: string[] = [];
  if (ins.conserver !== undefined && etat.conserver === null) { e.conserver = ins.conserver; reprises.push(ins.conserver ? 'maison conservée' : 'maison démolie'); }
  if (ins.type && etat.type === null) { e.type = ins.type; reprises.push(LIB_TYPE[ins.type]); }
  if (ins.facade && etat.facade === null) { e.facade = ins.facade; reprises.push(LIB_COTE[ins.facade]); }
  if (etat.niveauxExtension === null && !etat.memeHauteur) {
    if (ins.memeHauteur) { e.memeHauteur = true; reprises.push('même hauteur que la maison'); }
    else if (ins.niveauxExtension) { e.niveauxExtension = ins.niveauxExtension; reprises.push(ins.niveauxExtension === 1 ? 'de plain-pied' : 'sur 2 niveaux'); }
  }
  if (ins.menuiserie && (etat.menuiserie ?? null) === null) { e.menuiserie = ins.menuiserie; reprises.push(LIB_MENUISERIE[ins.menuiserie]); }
  if (ins.baies && (etat.baies ?? null) === null) { e.baies = ins.baies; reprises.push(ins.baies === 'auto' ? 'avec baie vitrée' : 'sans baie vitrée'); }
  return { etat: e as E, reprises };
}
