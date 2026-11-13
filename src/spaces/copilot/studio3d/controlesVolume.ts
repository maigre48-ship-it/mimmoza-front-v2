// src/spaces/copilot/studio3d/controlesVolume.ts
// =============================================================================
// VÉRIFICATIONS PLU D'UN VOLUME D'ÉTUDE — logique PURE (testée par node --test et par
// les tests deno de copilot-chat/agent/studio.test.ts).
//
// Déplacé tel quel de supabase/functions/copilot-chat/agent/studio.ts (lot fiche-3d) :
// le serveur (outil studio_preparer_3d) et la fiche « Espace 3D » du chat appellent
// maintenant LA MÊME fonction controlerVolume. Quand l'utilisateur modifie les
// dimensions dans la fiche, les verdicts sont recalculés par ce code, jamais par l'IA.
//
// Règles tenues :
//   - jamais « conforme » ;
//   - « dans la limite de la règle citée » seulement pour une règle CONFIRMÉE et CITÉE
//     (article renseigné) sans condition complémentaire non vérifiée ;
//   - sinon « à vérifier » (règle estimée, condition complémentaire) ou « non contrôlé ».
// Aucune I/O ici.
//
// Lot C7c — règles « par bande » : les textes disent l'état RÉEL du volume. La bande principale n'est tenue pour
// appliquée que si verifierBandeVolume le PROUVE sur la géométrie du volume contrôlé (tous les bâtiments dans la
// bande, emprise sous le plafond de la bande) — y compris pour un volume modifié dans la fiche. Sinon l'emprise
// est rapportée au plafond prudent (taux le plus contraignant sur toute la parcelle). Le verdict reste « à
// vérifier » dans les deux cas : le côté voie est présumé d'après le cadastre, pas constaté.
//
// Lot C10 —
//   · hauteur, niveaux et pleine terre PAR BANDE suivent la même règle que l'emprise : la valeur de la bande
//     principale ne vaut que pour des bâtiments prouvés dans cette bande ; sinon la valeur la plus contraignante
//     des bandes (reglesVolume, controlerVolume, limiteSelonBande) ;
//   · reculs : quand le volume porte le côté voie, la distance à la voie et la distance aux autres limites sont
//     MESURÉES sur ses bâtiments (mesurerReculsVolume) et jugées chacune contre sa règle ;
//   · implantationDesRegles : ce que les règles lues établissent du recul à la voie (alignement explicite
//     seulement), pour le moteur. Rien n'y est supposé.
//
// Lot C11 (décisions prises pour Albé le 10/11/2026, après la mission réelle de Montreuil) —
//   · recul sur voie « non réglementé », CONFIRMÉ et CITÉ : l'implantation est libre par rapport à la voie ; le
//     moteur retient l'alignement (implantationDesRegles) et l'hypothèse le dit, avec la règle complémentaire lue ;
//   · « sur limite séparative ou en retrait », CONFIRMÉ et CITÉ : l'implantation en limite est transmise au moteur,
//     qui l'applique aux limites latérales dans la bande principale ; le contrôle du recul aux limites juge alors
//     chaque limite latérale (touchée, ou au retrait) et le fond de parcelle (retrait de la formule) ;
//   · pleine terre PAR BANDE : le moteur ne la contrôle pas ; le contrôle donne la part NON BÂTIE de chaque bande
//     (ce n'est pas la pleine terre) quand le volume est prouvé dans la bande principale ;
//   · formule de recul « H/2 et 3 mètres minimum » : le minimum écrit APRÈS le nombre est lu (il était perdu).
// =============================================================================

import { HYPOTHESES_VOLUME, libelleNiveaux, regleValide, type ReglePlu, type ReglesPluVolume, type VolumePropose } from './volumeParcelle.ts';
import { estConditionBande, mentionBandes, optionBandePrincipale, optionBandeSecondaire, profondeurBandePrincipaleM, type OptionBande } from './reglesParBande.ts';
import type { MesureBandes } from './coteVoie.ts';
import { CONTACT_LIMITE_M, mesurerReculsVolume, verifierBandeVolume, type ImplantationVoie } from './bandePrincipale.ts';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const txt = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const fr = (v: number, d = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });

/** Règle de conception telle que stockée (agent_conceptions.regles_plu), lue sans confiance. */
export interface RegleLue {
  cle: string;
  valeur: number | string | null;
  statut: 'confirme' | 'estime' | 'manquant';
  source: string;
  article: string | null;
  nature: string | null;
  texte: string | null;
  regle_relative: string | null;
  /** Lot C6 : options de la règle (bandes, façades, choix), telles que stockées. Vide si aucune. */
  alternatives?: OptionBande[];
}

const UNITES_BANDE: Record<string, string> = {
  hauteur_max_m: 'm', niveaux_max: 'niveaux', emprise_sol_max_pct: '%', pleine_terre_min_pct: '%', recul_voie_m: 'm', recul_limites_m: 'm',
};

/** Fin de la condition d'une règle par bande, écrite à la lecture (le volume n'est pas encore connu). */
const VOIE_NON_IDENTIFIEE = ' ; côté voie non identifié par le volume';
/** Lot C7c : ce qui la remplace quand le volume contrôlé est PROUVÉ dans la bande principale. */
const VOLUME_DANS_BANDE = ' ; volume d’étude contenu dans la bande principale (vérifié par le calcul), côté voie présumé d’après le cadastre, à confirmer';

function lireOptions(v: unknown): OptionBande[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((e): OptionBande[] =>
    estObj(e) && typeof e.libelle === 'string' && e.libelle.trim() && fini(e.valeur) ? [{ libelle: e.libelle.trim().slice(0, 80), valeur: e.valeur }] : []).slice(0, 6);
}

export function lireRegles(brut: unknown): RegleLue[] {
  if (!Array.isArray(brut)) return [];
  return brut.flatMap((e): RegleLue[] => {
    if (!estObj(e) || typeof e.cle !== 'string') return [];
    const statut = e.statut === 'confirme' || e.statut === 'estime' ? e.statut : 'manquant';
    let valeur = fini(e.valeur) || typeof e.valeur === 'string' ? e.valeur as number | string : null;
    let relative = txt(e.regle_relative, 300);
    const alternatives = lireOptions(e.alternatives);
    // Lot C6 : règle PAR BANDE → la valeur du projet est celle de la bande principale (même pour une règle
    // stockée avant le lot avec la valeur du fond), et la condition de bande reste « à vérifier ».
    if (statut !== 'manquant' && estConditionBande(alternatives)) {
      const p = optionBandePrincipale(alternatives);
      if (p) valeur = p.valeur;
      const mention = `${mentionBandes(alternatives, UNITES_BANDE[e.cle] ?? '', txt(e.texte, 600))}${VOIE_NON_IDENTIFIEE}`;
      relative = (relative ? `${relative} ; ${mention}` : mention).slice(0, 400);
    }
    return [{
      cle: e.cle, valeur, statut, source: txt(e.source, 300) ?? 'source non précisée', article: txt(e.article, 120),
      nature: txt(e.nature, 40), texte: txt(e.texte, 300), regle_relative: relative, alternatives,
    }];
  });
}

/** Règle CITÉE : confirmée (règlement lu avec son article, ou utilisateur) ET article renseigné. */
export const regleCitee = (r: RegleLue | undefined): boolean => !!r && r.statut === 'confirme' && !!r.article;

/** Lot C10 : règles dont la valeur dépend de la bande, et sens de « la plus contraignante » ('min' : plafond ; 'max' : minimum exigé). */
const SENS_PAR_BANDE: Record<string, 'min' | 'max'> = { hauteur_max_m: 'min', niveaux_max: 'min', emprise_sol_max_pct: 'min', pleine_terre_min_pct: 'max' };

export interface LimiteSelonBande {
  /** Valeur à laquelle comparer le volume : bande principale si elle est prouvée, sinon la plus contraignante des bandes. */
  valeur: number;
  /** Vrai si la règle est une règle par bande. */
  parBande: boolean;
  /** Règle par bande, bande non prouvée : valeur la MOINS contraignante des bandes (au-delà, le dépassement est certain) ; sinon null. */
  plusPermissive: number | null;
}

/**
 * Lot C10 — valeur d'une règle chiffrée à opposer à un volume, selon que ses bâtiments sont PROUVÉS dans la bande
 * principale ou non. Règle ordinaire : sa valeur. Règle par bande : valeur de la bande principale si
 * `bandeProuvee`, sinon la plus contraignante des options (jamais la valeur de la bande principale appliquée à un
 * bâtiment qui peut être en bande secondaire). null si la règle n'est pas chiffrée.
 */
export function limiteSelonBande(regle: RegleLue | undefined, bandeProuvee: boolean): LimiteSelonBande | null {
  if (!regle || !fini(regle.valeur)) return null;
  const alts = regle.alternatives ?? [];
  const sens = SENS_PAR_BANDE[regle.cle];
  if (!sens || !estConditionBande(alts)) return { valeur: regle.valeur, parBande: false, plusPermissive: null };
  if (bandeProuvee) return { valeur: optionBandePrincipale(alts)?.valeur ?? regle.valeur, parBande: true, plusPermissive: null };
  const vals = alts.map((a) => a.valeur).filter(fini);
  if (!vals.length) return { valeur: regle.valeur, parBande: true, plusPermissive: null };
  return sens === 'min' ? { valeur: Math.min(...vals), parBande: true, plusPermissive: Math.max(...vals) }
    : { valeur: Math.max(...vals), parBande: true, plusPermissive: Math.min(...vals) };
}

/** Lot C10 : condition d'une règle par bande, dite selon l'état réel du volume (bande prouvée ou non). */
export function conditionSelonBande(regle: RegleLue, bandeProuvee: boolean): string | null {
  const c = regle.regle_relative;
  return c && bandeProuvee && c.endsWith(VOIE_NON_IDENTIFIEE) ? `${c.slice(0, -VOIE_NON_IDENTIFIEE.length)}${VOLUME_DANS_BANDE}` : c;
}

/**
 * Lot C10 — ce que les règles LUES établissent de l'implantation par rapport à la voie et aux limites, pour le
 * moteur (BandeVoie.implantation). Prudence :
 *   · alignement (recul 0 m sur la voie) retenu SEULEMENT pour une règle `recul_voie_m` chiffrée à 0, confirmée
 *     et citée (article) ; une règle positive passe par les règles du volume (reglesVolume), pas par ici ;
 *   · règle absente, « non réglementée », non chiffrée ou seulement estimée : rien n'est établi, le moteur garde
 *     son recul prudent côté voie, et `note` dit pourquoi ;
 *   · lot C11 — recul sur voie « non réglementé », règle CONFIRMÉE et CITÉE : l'implantation est libre par rapport
 *     à la voie ; l'alignement est RETENU (`reculVoieM: 0`, `motifVoie: 'non_reglementee'`) et `note` le dit, avec
 *     la règle complémentaire non chiffrée si elle a été lue. Non confirmée ou non citée : rien n'est établi ;
 *   · lot C11 — « sur limite séparative ou en retrait » (valeur 0 m ET option à 0 m dont le libellé parle de
 *     « limite », forme écrite par le lot C9) : transmis au moteur (`limiteSeparativePermise`) seulement si la
 *     règle est CONFIRMÉE et CITÉE ; sinon `noteLimites` dit pourquoi le retrait est gardé.
 */
export function implantationDesRegles(regles: readonly RegleLue[]): ImplantationVoie {
  const rv = regles.find((x) => x.cle === 'recul_voie_m' && x.statut !== 'manquant');
  const out: ImplantationVoie = { reculVoieM: null, sourceVoie: null, limiteSeparativePermise: false, note: null };
  const prudent = 'alignement non supposé, recul prudent conservé côté voie';
  if (!rv) out.note = `Recul à la voie : règle non lue — ${prudent}.`;
  else if (rv.nature === 'non_reglementee') {
    if (regleCitee(rv)) {
      out.reculVoieM = 0; out.sourceVoie = libelleRegle(rv); out.motifVoie = 'non_reglementee';
      // La règle complémentaire non chiffrée (« tenir compte de l'implantation des constructions voisines »…) est
      // reprise telle qu'elle a été lue ; rien n'est ajouté quand elle manque.
      const complement = [rv.regle_relative, rv.texte].find((t) => !!t && !/^(?:il\s+n['’]est\s+pas\s+fix[ée]|non\s+r[ée]glement)/iu.test(t.trim())) ?? null;
      const suite = !complement ? 'aucune règle complémentaire lue ; implantation réelle à vérifier sur place'
        : /constructions?\s+voisines?/iu.test(complement) ? 'le règlement demande de tenir compte de l’implantation des constructions voisines — à vérifier sur place'
          : `règle complémentaire non chiffrée du règlement : « ${complement.replace(/\s+/g, ' ').trim().slice(0, 160)} » — à vérifier sur place`;
      out.note = `Recul sur voie non réglementé (${rv.article}) : alignement retenu ; ${suite}.`;
    } else out.note = `Recul à la voie non réglementé (${libelleRegle(rv)}), règle ${rv.statut === 'confirme' ? 'sans article cité' : 'non confirmée (estimée)'} — ${prudent}.`;
  } else if (fini(rv.valeur) && rv.valeur === 0) {
    if (regleCitee(rv)) { out.reculVoieM = 0; out.sourceVoie = libelleRegle(rv); out.motifVoie = 'regle'; }
    else out.note = `Recul à la voie de 0 m (alignement) non confirmé (${rv.statut === 'confirme' ? 'article non cité' : 'règle estimée'}) — ${prudent}.`;
  } else if (!fini(rv.valeur)) out.note = `Recul à la voie non chiffré (${libelleRegle(rv)}) — ${prudent}.`;
  const rl = regles.find((x) => x.cle === 'recul_limites_m' && x.statut !== 'manquant');
  if (rl && fini(rl.valeur) && rl.valeur === 0 && (rl.alternatives ?? []).some((a) => a.valeur === 0 && /\blimites?\b/iu.test(a.libelle))) {
    if (regleCitee(rl)) { out.limiteSeparativePermise = true; out.sourceLimites = libelleRegle(rl); }
    else out.noteLimites = `Implantation en limite séparative lue mais ${rl.statut === 'confirme' ? 'sans article cité' : 'non confirmée (règle estimée)'} (${libelleRegle(rl)}) — non appliquée, retrait conservé sur les limites séparatives.`;
  }
  return out;
}

/** « H/2 min 4 m » → { diviseur: 2, minimumM: 4 } (même lecture que reglesPlu.ts). */
export function formuleRecul(v: string): { diviseur: number; minimumM: number | null } | null {
  const f = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const m = /\bh\s*\/\s*([1-4])\b/.exec(f);
  if (!m) return null;
  // Lot C11 : le minimum peut être écrit APRÈS le nombre (« H/2 et 3 mètres minimum », forme du PLUi Est Ensemble).
  const min = /(?:min(?:imum)?\.?|≥|>=)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*m/.exec(f)
    ?? /(\d+(?:[.,]\d+)?)\s*m(?:etres?)?\.?\s*(?:au\s+)?min(?:imum)?\b/.exec(f.slice(m.index + m[0].length));
  return { diviseur: Number(m[1]), minimumM: min ? Number(min[1].replace(',', '.')) : null };
}

export const libelleRegle = (r: RegleLue) => `${r.source}${r.article ? `, ${r.article}` : ''}`;

export type Verdict = 'dans_la_limite' | 'au_dela' | 'a_verifier' | 'non_controle';
export interface ControleVolume {
  cle: string;
  libelle: string;
  valeur_volume: string | null;
  regle: string | null;
  verdict: Verdict;
  explication: string;
}

const LIBELLES: Record<string, string> = {
  hauteur_max_m: 'Hauteur', niveaux_max: 'Niveaux', emprise_sol_max_pct: 'Emprise au sol', recul_voie_m: 'Recul à la voie',
  recul_limites_m: 'Recul aux limites séparatives', pleine_terre_min_pct: 'Pleine terre', stationnement_par_logement: 'Stationnement',
  mixite_sociale_pct: 'Mixité sociale',
};

/**
 * Confronte le volume aux règles de la conception. « dans_la_limite » exige une règle CONFIRMÉE et CITÉE
 * et aucune condition complémentaire non vérifiée ; tout le reste est « à vérifier » ou « non contrôlé ».
 */
export function controlerVolume(v: VolumePropose, regles: RegleLue[], logements: number | null): ControleVolume[] {
  const r = (cle: string) => regles.find((x) => x.cle === cle && (x.statut !== 'manquant'));
  const out: ControleVolume[] = [];
  const surface = v.surfaceParcelleM2;
  const emprise = v.kpi?.empriseTotaleM2 ?? v.emprise?.surfaceM2 ?? 0;
  const ratioPct = surface > 0 ? Math.round(emprise / surface * 1000) / 10 : null;
  // Lot C7c : la bande principale est-elle PROUVÉE pour ce volume (géométrie revérifiée, pas seulement déclarée) ?
  const preuveBande = verifierBandeVolume(v);
  /** Condition d'une règle, mise à jour selon l'état réel du volume (règle par bande : voie identifiée ou non). */
  const conditionDe = (regle: RegleLue): string | null => {
    const c = regle.regle_relative;
    return c && preuveBande.prouvee && c.endsWith(VOIE_NON_IDENTIFIEE) ? `${c.slice(0, -VOIE_NON_IDENTIFIEE.length)}${VOLUME_DANS_BANDE}` : c;
  };
  /**
   * Lot C10 — hauteur et niveaux PAR BANDE quand la bande principale n'est pas prouvée : le volume est comparé à
   * la valeur la plus contraignante des bandes (« à vérifier » au-dessus, « au-delà » seulement au-dessus de la
   * plus haute, dépassement alors certain). Bande prouvée, ou règle ordinaire : jugement habituel.
   */
  const jugerParBande = (regle: RegleLue, mesure: number, valeur: string, unite: (x: number) => string, cle: string, precision = ''): ControleVolume | null => {
    const l = limiteSelonBande(regle, preuveBande.prouvee);
    if (!l || !l.parBande || preuveBande.prouvee || l.plusPermissive === null) return null;
    const mention = mentionBandes(regle.alternatives ?? [], UNITES_BANDE[cle] ?? '', regle.texte);
    const Mention = `Rappel : ${mention}`;
    const base = { cle, libelle: LIBELLES[cle], valeur_volume: valeur, regle: `${unite(l.valeur)} (valeur la plus contraignante des bandes) — ${mention} (${libelleRegle(regle)})` };
    const pourquoi = preuveBande.raison ? ` (${preuveBande.raison})` : '';
    if (mesure > l.plusPermissive + 1e-9) return { ...base, verdict: 'au_dela', explication: `Le volume d’étude dépasse la règle : ${valeur}, plus que la valeur la plus élevée des bandes (${unite(l.plusPermissive)}). ${Mention}.${precision}` };
    return { ...base, verdict: 'a_verifier', explication: (mesure <= l.valeur + 1e-9
      ? `${valeur} : sous la valeur la plus contraignante des bandes (${unite(l.valeur)}), appliquée à tout le volume.`
      : `${valeur} : au-dessus de la valeur la plus contraignante des bandes (${unite(l.valeur)}) ; admissible seulement pour un bâtiment situé dans la bande principale (${unite(l.plusPermissive)}), ce que le calcul ne prouve pas ici.`) +
      ` Les bâtiments du volume ne sont pas prouvés dans la bande principale${pourquoi} : à vérifier. ${Mention}.${precision}` };
  };
  const juger = (regle: RegleLue, respecte: boolean, valeur: string, limite: string, cle: string, precision = ''): ControleVolume => {
    const relative = conditionDe(regle);
    const condition = relative ? ` ${preuveBande.prouvee && relative.endsWith(VOLUME_DANS_BANDE) ? 'Condition complémentaire' : 'Condition complémentaire non vérifiée'} : ${relative}.` : '';
    if (!respecte) return { cle, libelle: LIBELLES[cle], valeur_volume: valeur, regle: `${limite} (${libelleRegle(regle)})`, verdict: 'au_dela', explication: `Le volume d’étude dépasse la règle (${valeur} pour ${limite}).${condition}` };
    const sure = regleCitee(regle) && !regle.regle_relative;
    return {
      cle, libelle: LIBELLES[cle], valeur_volume: valeur, regle: `${limite} (${libelleRegle(regle)})`,
      verdict: sure ? 'dans_la_limite' : 'a_verifier',
      explication: sure
        ? `${valeur} : dans la limite de la règle citée (${limite}, ${regle.article}).${precision}`
        : `${valeur} pour ${limite} : ${regleCitee(regle) ? 'règle citée mais' : 'règle non confirmée (estimée) —'} à vérifier.${condition}${precision}`,
    };
  };
  const nonControle = (cle: string, explication: string): ControleVolume => ({ cle, libelle: LIBELLES[cle], valeur_volume: null, regle: null, verdict: 'non_controle', explication });

  // Hauteur (indicative : niveaux × hauteur d'étage supposée)
  const h = r('hauteur_max_m');
  const precisionH = ` Hauteur indicative (${v.niveaux} niveaux × ${fr(HYPOTHESES_VOLUME.hauteurEtageM)} m d’étage supposés, toit plat) : à mesurer sur le modèle du Studio.`;
  if (h && fini(h.valeur)) out.push(jugerParBande(h, v.hauteurM, `≈ ${fr(v.hauteurM, 1)} m`, (x) => `${fr(x, 1)} m max.`, 'hauteur_max_m', precisionH)
    ?? juger(h, v.hauteurM <= h.valeur + 1e-9, `≈ ${fr(v.hauteurM, 1)} m`, `${fr(h.valeur, 1)} m max.`, 'hauteur_max_m', precisionH));
  else out.push(nonControle('hauteur_max_m', `Hauteur maximale inconnue : non contrôlée (volume ≈ ${fr(v.hauteurM, 1)} m).`));
  // Niveaux
  const n = r('niveaux_max');
  if (n && fini(n.valeur)) out.push(jugerParBande(n, v.niveaux, `${v.niveaux} niveaux (${libelleNiveaux(v.niveaux)})`, (x) => `${fr(x)} niveaux max.`, 'niveaux_max')
    ?? juger(n, v.niveaux <= n.valeur, `${v.niveaux} niveaux (${libelleNiveaux(v.niveaux)})`, `${fr(n.valeur)} niveaux max.`, 'niveaux_max'));
  // Emprise
  const e = r('emprise_sol_max_pct');
  if (e && e.nature === 'non_reglementee' && e.article) {
    out.push({ cle: 'emprise_sol_max_pct', libelle: LIBELLES.emprise_sol_max_pct, valeur_volume: ratioPct !== null ? `${fr(ratioPct, 1)} %` : null,
      regle: `non réglementée (${libelleRegle(e)})`, verdict: regleCitee(e) ? 'dans_la_limite' : 'a_verifier',
      explication: `Emprise non réglementée${regleCitee(e) ? ` (${e.article})` : ' (règle non confirmée)'} : aucun plafond ; le volume occupe ${ratioPct !== null ? `${fr(ratioPct, 1)} %` : '?'} de la parcelle, borné par la pleine terre et les reculs.` });
  } else if (e && fini(e.valeur) && ratioPct !== null && estConditionBande(e.alternatives ?? [])) {
    // Lot C7c — emprise PAR BANDE : « 80 % » vaut dans la bande principale, pas sur toute la parcelle.
    const alts = e.alternatives ?? [];
    const taux = alts.map((a) => a.valeur).filter((x) => x >= 0 && x <= 100);
    const p = optionBandePrincipale(alts);
    const prudent = taux.length ? Math.min(...taux) : e.valeur, plusHaut = taux.length ? Math.max(...taux) : e.valeur;
    const mention = mentionBandes(alts, '%', e.texte);
    const base = { cle: 'emprise_sol_max_pct', libelle: LIBELLES.emprise_sol_max_pct };
    const plafond = v.bande?.empriseMaxM2 ?? null;
    if (preuveBande.prouvee && plafond !== null) {
      // Prouvé par le calcul : tous les bâtiments dans la bande principale, emprise ≤ plafond de la bande.
      const profondeur = v.bande?.profondeurM ?? null;
      out.push({
        ...base, valeur_volume: `${fr(preuveBande.empriseM2, 1)} m² dans la bande principale (${fr(ratioPct, 1)} % de la parcelle)`,
        regle: `${fr(plafond)} m² max. dans la bande principale${p ? ` (${fr(p.valeur, 1)} % de la bande${profondeur ? ` de ${fr(profondeur, 1)} m` : ''})` : ''} (${libelleRegle(e)})`,
        verdict: 'a_verifier',
        explication: `${fr(preuveBande.empriseM2, 1)} m² pour ${fr(plafond)} m² au plus : tous les bâtiments du volume d’étude sont dans la bande principale` +
          `${preuveBande.distanceMaxVoieM !== null && profondeur ? ` (à ${fr(preuveBande.distanceMaxVoieM, 2)} m au plus du côté voie, pour ${fr(profondeur, 1)} m)` : ''}` +
          ' et leur emprise tient sous le maximum de cette bande — vérifié par le calcul. Reste à vérifier : le côté voie est présumé d’après le cadastre ' +
          `(limite sans parcelle mitoyenne), et la bande secondaire n’est pas construite. ${mention.charAt(0).toUpperCase()}${mention.slice(1)}.`,
      });
    } else {
      // Non prouvé : plafond prudent (taux le plus contraignant sur toute la parcelle). Au-delà du taux le plus
      // élevé des bandes, le dépassement est certain ; entre les deux, seule la part d'emprise dans la bande
      // principale pourrait le justifier, et le calcul ne la prouve pas.
      const pourquoi = preuveBande.raison ? ` (${preuveBande.raison})` : '';
      const regle = `${fr(prudent, 1)} % de la parcelle (plafond prudent) — ${mention} (${libelleRegle(e)})`;
      if (ratioPct > plusHaut + 1e-9) {
        out.push({ ...base, valeur_volume: `${fr(ratioPct, 1)} %`, regle, verdict: 'au_dela',
          explication: `Le volume d’étude dépasse la règle : ${fr(ratioPct, 1)} % de la parcelle, plus que le taux le plus élevé des bandes (${fr(plusHaut, 1)} %). ${mention.charAt(0).toUpperCase()}${mention.slice(1)}.` });
      } else {
        out.push({ ...base, valeur_volume: `${fr(ratioPct, 1)} %`, regle, verdict: 'a_verifier',
          explication: (ratioPct <= prudent + 1e-9
            ? `${fr(ratioPct, 1)} % de la parcelle : sous le plafond prudent de ${fr(prudent, 1)} % (taux le plus contraignant, appliqué à toute la parcelle).`
            : `${fr(ratioPct, 1)} % de la parcelle : au-dessus du plafond prudent de ${fr(prudent, 1)} % (taux le plus contraignant, appliqué à toute la parcelle) ; ` +
              `admissible seulement pour la part d’emprise située dans la bande principale${p ? ` (${fr(p.valeur, 1)} %)` : ''}, ce que le calcul ne prouve pas ici.`) +
            ` Les bâtiments du volume ne sont pas prouvés dans la bande principale${pourquoi} : à vérifier. ${mention.charAt(0).toUpperCase()}${mention.slice(1)}.` });
      }
    }
  } else if (e && fini(e.valeur) && ratioPct !== null) {
    out.push(juger(e, ratioPct <= e.valeur + 1e-9, `${fr(ratioPct, 1)} %`, `${fr(e.valeur, 1)} % max.`, 'emprise_sol_max_pct'));
  } else {
    out.push(nonControle('emprise_sol_max_pct', `Emprise maximale inconnue : plafond par défaut de ${fr(HYPOTHESES_VOLUME.cesDefaut * 100)} % appliqué au volume (hypothèse).`));
  }
  // Reculs : le volume tient à ≥ reculM de TOUTES les limites (côté voie non identifié).
  // Lot formes-batiment : bâtiment à ailes (L, U, cour, redans) → reculM est la plus petite distance de ses
  // AILES (rectangles réels) aux limites, emprise = réunion des ailes : on le dit dans l'explication.
  const recul = v.reculM;
  const ailes = (v.batiments ?? []).some((b) => (b.ailes?.length ?? 0) >= 2);
  const surContour = ailes ? ' Mesuré aile par aile sur le contour réel du bâtiment (pas sur son rectangle englobant).' : '';
  // Lot C10 : le volume porte le côté voie (bande appliquée) → distances MESURÉES sur ses bâtiments, à la voie d'une
  // part, aux autres limites d'autre part (mesure indépendante du placement, valable aussi pour un volume modifié
  // dans la fiche). Sinon : `reculM`, distance à toutes les limites, comme avant.
  // Lot P9 : volume posé au recul sur voie (poseVoie) → mêmes mesures que la bande, sur les limites présumées sur voie.
  const mesures = v.bande?.statut === 'appliquee' ? mesurerReculsVolume(v)
    : v.poseVoie && v.poseVoie.statut !== 'impossible' && v.poseVoie.facades.length
      ? mesurerReculsVolume({ ...v, bande: { statut: 'appliquee', raison: null, profondeurM: null, longueurFacadeM: null, angleVoieDeg: null, distanceMaxVoieM: null, empriseMaxM2: null, facades: v.poseVoie.facades } })
      : null;
  const tolerance = mesures ? 0.02 : 0.01;
  const reculVoie = mesures ? mesures.voieM : recul;
  const reculLimites = mesures && mesures.limitesM !== null ? mesures.limitesM : recul;
  const valeurVoie = mesures ? `${fr(reculVoie, 2)} m du côté voie présumé (mesuré)` : `${fr(recul, 1)} m de toutes les limites`;
  const valeurLimites = mesures && mesures.limitesM !== null ? `${fr(reculLimites, 2)} m des limites autres que la voie (mesuré)` : `${fr(recul, 1)} m de toutes les limites`;
  const precisionVoie = mesures ? ' Côté voie présumé d’après le cadastre (limite sans parcelle mitoyenne), à confirmer ; distance mesurée sur les bâtiments du volume.'
    : preuveBande.prouvee ? ' Côté voie présumé d’après le cadastre ; recul uniforme sur toutes les limites, côté voie compris.' : ' Côté voie non identifié sur le cadastre : recul uniforme.';
  const rv = r('recul_voie_m');
  if (rv && fini(rv.valeur)) out.push(juger(rv, reculVoie + tolerance >= rv.valeur, valeurVoie, rv.valeur === 0 ? 'alignement autorisé (0 m)' : `${fr(rv.valeur, 1)} m min.`, 'recul_voie_m',
    `${precisionVoie}${surContour}`));
  else if (rv && rv.nature === 'non_reglementee' && rv.article) {
    // Lot C10 : « non réglementé » n'est pas « inconnu » : aucun minimum n'est lu.
    // Lot C11 : règle confirmée et citée, côté voie identifié → le volume retient l'alignement (`bande.reculVoieM` à 0) et
    // le contrôle le dit ; sinon il garde son recul prudent, et le dit aussi. La règle complémentaire non chiffrée
    // (constructions voisines…) n'est pas vérifiable par le calcul : verdict « à vérifier » quand elle existe.
    const aligne = mesures !== null && v.bande?.reculVoieM === 0;
    const complement = [rv.regle_relative, rv.texte].find((t) => !!t && !/^(?:il\s+n['’]est\s+pas\s+fix[ée]|non\s+r[ée]glement)/iu.test(t.trim())) ?? null;
    out.push({ cle: 'recul_voie_m', libelle: LIBELLES.recul_voie_m, valeur_volume: valeurVoie, regle: `non réglementé (${libelleRegle(rv)})`,
      verdict: regleCitee(rv) && !(aligne && complement) ? 'dans_la_limite' : 'a_verifier',
      explication: `Recul à la voie non réglementé${regleCitee(rv) ? ` (${rv.article})` : ' (règle non confirmée)'} : aucun minimum chiffré à respecter. ` +
        (aligne
          ? `Le volume d’étude retient l’implantation à l’alignement (${fr(reculVoie, 2)} m mesuré côté voie).` +
            (complement ? ` Règle complémentaire non chiffrée, non vérifiée par le calcul : « ${complement.replace(/\s+/g, ' ').trim().slice(0, 200)} » — à vérifier sur place.` : '')
          : `Le volume d’étude n’en déduit pas l’implantation à l’alignement : il garde ${mesures ? `${fr(reculVoie, 2)} m` : `${fr(recul, 1)} m`} côté voie.`) +
        `${mesures ? precisionVoie : ''}${surContour}` });
  } else out.push(nonControle('recul_voie_m', 'Recul à la voie inconnu : non contrôlé.'));
  const rl = r('recul_limites_m');
  // Lot C11 — implantation en limite appliquée par le volume (`bande.reculLateralM`) : chaque limite latérale doit
  // être touchée ou tenue au retrait de la formule ; le fond de parcelle garde le retrait. Mesuré bâtiment par bâtiment.
  const lat = mesures?.laterales && v.bande?.reculLateralM !== undefined ? mesures.laterales : null;
  if (rl && fini(rl.valeur) && rl.valeur === 0 && lat && lat.length) {
    const rf = r('recul_limites_formule');
    const f = rf && typeof rf.valeur === 'string' ? formuleRecul(rf.valeur) : null;
    // Retrait dû là où le bâtiment n'est pas en limite : la formule lue ; à défaut, le retrait que le volume déclare avoir tenu.
    const exige = f ? Math.max(f.minimumM ?? 0, v.hauteurM / f.diviseur) : v.bande?.reculLimitesM ?? recul;
    const tous = lat.flatMap((l) => l.distancesM);
    const touchees = tous.filter((d) => d <= CONTACT_LIMITE_M + 1e-9).length;
    const entreDeux = tous.filter((d) => d > CONTACT_LIMITE_M + 1e-9 && d < exige - tolerance);
    const fondOk = mesures!.limitesM === null || mesures!.limitesM + tolerance >= exige;
    const vide = Math.max(0, ...lat.map((l) => l.videMaxM));
    const valeur = `${touchees} limite${touchees > 1 ? 's' : ''} latérale${touchees > 1 ? 's' : ''} touchée${touchees > 1 ? 's' : ''} sur ${tous.length}` +
      `${mesures!.limitesM !== null ? `, ${fr(mesures!.limitesM, 2)} m du fond de parcelle et des autres limites (mesuré)` : ''}`;
    const regle = `en limite séparative ou en retrait${f ? ` (${String(rf!.valeur)}, soit ${fr(exige, 1)} m pour ≈ ${fr(v.hauteurM, 1)} m)` : ` (retrait retenu ${fr(exige, 1)} m)`} (${libelleRegle(rl)})`;
    const base = { cle: 'recul_limites_m', libelle: LIBELLES.recul_limites_m, valeur_volume: valeur, regle };
    if (entreDeux.length || !fondOk) {
      out.push({ ...base, verdict: 'au_dela', explication: `Le volume d’étude dépasse la règle : ` +
        (entreDeux.length ? `un bâtiment est à ${fr(Math.min(...entreDeux), 2)} m d’une limite latérale, ni en limite ni au retrait de ${fr(exige, 1)} m. ` : '') +
        (!fondOk ? `Le fond de parcelle (ou une autre limite) est à ${fr(mesures!.limitesM ?? 0, 2)} m pour ${fr(exige, 1)} m de retrait.` : '') + surContour });
    } else {
      out.push({ ...base, verdict: 'a_verifier', explication: `Implantation en limite séparative permise par la règle citée (${rl.article ?? 'article non cité'}) et appliquée aux limites latérales : ` +
        `chaque limite latérale est touchée par le bâtiment ou tenue à ${fr(exige, 1)} m au moins ; le fond de parcelle est à ${mesures!.limitesM !== null ? `${fr(mesures!.limitesM, 2)} m` : 'distance non mesurable'} pour ${fr(exige, 1)} m de retrait — vérifié par le calcul. ` +
        (vide > CONTACT_LIMITE_M ? `Une limite touchée n’est pas parallèle au pignon : contact en un point, vide en biais jusqu’à ${fr(vide, 2)} m, à traiter au plan (pignon suivant la limite, ou retrait réglementaire). ` : '') +
        'Reste à vérifier : limites latérales et fond présumés d’après le cadastre ; vues, prospects et servitudes sur les fonds voisins non examinés.' + surContour });
    }
  } else if (rl && fini(rl.valeur)) out.push(juger(rl, reculLimites + tolerance >= rl.valeur, valeurLimites, `${fr(rl.valeur, 1)} m min.`, 'recul_limites_m', surContour));
  else {
    const rf = r('recul_limites_formule');
    const f = rf && typeof rf.valeur === 'string' ? formuleRecul(rf.valeur) : null;
    if (rf && f) {
      const exige = Math.max(f.minimumM ?? 0, v.hauteurM / f.diviseur);
      out.push(juger(rf, reculLimites + tolerance >= exige, valeurLimites, `${String(rf.valeur)} soit ${fr(exige, 1)} m pour ≈ ${fr(v.hauteurM, 1)} m`, 'recul_limites_m', surContour));
    } else out.push(nonControle('recul_limites_m', 'Recul aux limites inconnu : non contrôlé.'));
  }
  // Pleine terre : jamais affirmée (voirie, stationnement, dalles non déduits).
  const pt = r('pleine_terre_min_pct');
  const surfaceBande = v.bande?.surfaceBandeM2 ?? null;
  if (pt && fini(pt.valeur) && ratioPct !== null && estConditionBande(pt.alternatives ?? []) && preuveBande.prouvee && surfaceBande !== null && surfaceBande > 0 && surface > surfaceBande) {
    // Lot C11 — pleine terre PAR BANDE, volume prouvé dans la bande principale : le moteur ne contrôle pas la pleine
    // terre bande par bande. On donne la part NON BÂTIE de chaque bande (mesure), qui n'est pas la pleine terre.
    const alts = pt.alternatives ?? [];
    const p = optionBandePrincipale(alts), s = optionBandeSecondaire(alts);
    const libreP = Math.max(0, surfaceBande - preuveBande.empriseM2), pctP = Math.round(libreP / surfaceBande * 1000) / 10;
    const secondaire = surface - surfaceBande;
    const manque = p !== null && p !== undefined && pctP + 1e-9 < p.valeur;
    out.push({ cle: 'pleine_terre_min_pct', libelle: LIBELLES.pleine_terre_min_pct,
      valeur_volume: `≤ ${fr(pctP, 1)} % non bâti dans la bande principale (${fr(libreP)} m² sur ${fr(surfaceBande)} m²) ; bande secondaire non construite (${fr(secondaire)} m²)`,
      regle: `${mentionBandes(alts, '%', pt.texte)} (${libelleRegle(pt)})`, verdict: manque ? 'au_dela' : 'a_verifier',
      explication: `Pleine terre par bande : NON contrôlée par le moteur de volume. Mesure : ${fr(libreP)} m² non bâtis dans la bande principale, soit ${fr(pctP, 1)} %` +
        `${p ? ` pour ${fr(p.valeur, 1)} % de pleine terre exigés` : ''}${manque ? ' — insuffisant même sans voirie ni stationnement' : ''} ; la bande secondaire (${fr(secondaire)} m²) n’est pas construite` +
        `${s ? ` (${fr(s.valeur, 1)} % de pleine terre exigés)` : ''}. Surface non bâtie n’est pas pleine terre : voirie, stationnement, dalles et sous-sols ne sont pas déduits — à vérifier.` });
  } else if (pt && fini(pt.valeur) && ratioPct !== null) {
    out.push({ cle: 'pleine_terre_min_pct', libelle: LIBELLES.pleine_terre_min_pct, valeur_volume: `≤ ${fr(100 - ratioPct, 1)} % non bâti`,
      regle: `${fr(pt.valeur, 1)} % min. (${libelleRegle(pt)})`, verdict: 100 - ratioPct + 1e-9 < pt.valeur ? 'au_dela' : 'a_verifier',
      explication: `Emprise bâtie ${fr(ratioPct, 1)} % : au plus ${fr(100 - ratioPct, 1)} % de la parcelle reste non bâti ; voirie, stationnement et dalles ne sont pas déduits — pleine terre réelle à vérifier.` });
  } else out.push(nonControle('pleine_terre_min_pct', 'Pleine terre minimale inconnue : non contrôlée.'));
  // Stationnement : non modélisé.
  const st = r('stationnement_par_logement');
  if (st && fini(st.valeur)) {
    const places = logements !== null ? Math.ceil(logements * st.valeur) : null;
    out.push({ cle: 'stationnement_par_logement', libelle: LIBELLES.stationnement_par_logement, valeur_volume: null,
      regle: `${fr(st.valeur, 2)} place(s)/logement (${libelleRegle(st)})`, verdict: 'non_controle',
      explication: `${places !== null ? `${places} places requises pour ${logements} logements` : 'Nombre de places à déterminer'} : stationnement non modélisé dans le volume d’étude.` });
  }
  return out;
}

// ── Règles de conception → règles du volume ─────────────────────────────────
// Lot formes-batiment : déplacés TELS QUELS de supabase/functions/copilot-chat/agent/studio.ts (réexportés
// par studio-front.ts et studio.ts : API du serveur inchangée). La fiche « Espace 3D » en a besoin pour placer
// les formes du bâtiment (formesBatiment.ts) avec les MÊMES contraintes que le moteur (contraintesPlu).

const CLES_VOLUME: Record<string, ReglePlu['cle']> = {
  hauteur_max_m: 'hauteur_max_m', niveaux_max: 'niveaux_max', emprise_sol_max_pct: 'emprise_max_ratio',
  recul_voie_m: 'recul_voie_m', recul_limites_m: 'recul_limites_m', recul_limites_formule: 'recul_limites_formule',
  pleine_terre_min_pct: 'pleine_terre_min_ratio',
};

/**
 * Règles de conception → règles du volume (ReglesPluVolume du Dossier 3D).
 * Même conversion que reglesPlu.ts (reglesConception) : statut confirme → « lue », sinon « estimée » ;
 * pourcentages → ratios ; formule « H/k min m ». Ajout E1 : une emprise « non réglementée » CITÉE
 * devient un plafond de 100 % (aucun plafond ; la pleine terre borne l'emprise), au lieu du 40 % par défaut.
 * Le gabarit du programme (R+n), s'il est fixé, plafonne les niveaux (choix du projet, pas une règle PLU).
 */
export function reglesVolume(regles: RegleLue[], gabaritNiveaux: number | null, bandes: MesureBandes | null = null,
  options: { /** Lot C7c : l'appelant GARANTIT que les bâtiments sont placés dans la bande principale (moteur avec `bande`, résultat « appliquee »). */ implantationDansBande?: boolean } = {}): ReglesPluVolume {
  const out: ReglePlu[] = [];
  const non: string[] = [];
  for (const r of regles) {
    const cle = CLES_VOLUME[r.cle];
    if (!cle) {
      if (r.cle === 'stationnement_par_logement' || r.cle === 'mixite_sociale_pct') {
        non.push(r.statut === 'manquant' ? `${r.cle === 'mixite_sociale_pct' ? 'Mixité sociale' : 'Stationnement'} : règle inconnue`
          : `${r.cle === 'mixite_sociale_pct' ? 'Mixité sociale' : 'Stationnement'} : ${String(r.valeur)} ${r.cle === 'mixite_sociale_pct' ? '%' : 'place(s)/logement'} (${libelleRegle(r)}) — non modélisé dans le volume`);
      }
      continue;
    }
    const statut: ReglePlu['statut'] = r.statut === 'confirme' ? 'lue' : 'estimee';
    const base = { source: r.source, reference: r.article, statut };
    if (r.cle === 'emprise_sol_max_pct' && r.nature === 'non_reglementee' && r.article && r.statut !== 'manquant') {
      out.push({ cle, valeur: 1, ...base, source: `${r.source} — emprise non réglementée` });
      continue;
    }
    if (r.statut === 'manquant') {
      non.push(`${r.cle} : ${r.nature === 'par_secteur' ? 'valeur selon le secteur, à préciser' : 'règle inconnue'}`);
      continue;
    }
    // Lot C6 — emprise PAR BANDE : « 80 % de la bande principale de 18 m » n'est pas « 80 % de la parcelle ».
    // Le volume d'étude ne sait pas de quel côté est la voie : il ne peut donc pas placer le bâtiment dans la
    // bande principale. On ne devine pas : le taux le plus contraignant est appliqué à toute la parcelle, et
    // on DIT que le volume sous-estime la constructibilité tant que le côté voie n'est pas identifié.
    if (r.cle === 'emprise_sol_max_pct' && estConditionBande(r.alternatives ?? [])) {
      const alts = r.alternatives ?? [];
      const p = optionBandePrincipale(alts);
      const s = optionBandeSecondaire(alts);
      const prof = profondeurBandePrincipaleM(alts, r.texte);
      // Lot C7 : côté voie identifié d'après le cadastre ET profondeur de bande lue → l'emprise de la bande
      // principale est mesurée (m²), puis rapportée à la parcelle. La bande secondaire n'est pas construite par
      // le volume d'étude : on ne lui prête pas la hauteur de la bande principale.
      if (bandes && p && prof && Math.abs(bandes.profondeurM - prof) < 0.01 && p.valeur > 0 && p.valeur <= 100 && bandes.surfaceParcelleM2 > 0) {
        const empriseM2 = Math.floor(bandes.bandePrincipaleM2 * p.valeur / 100);
        const ratio = Math.floor(empriseM2 / bandes.surfaceParcelleM2 * 1000) / 1000;
        if (ratio > 0 && ratio <= 1) {
          out.push({ cle: 'emprise_max_ratio', valeur: ratio, ...base, source: `${r.source} — ${fr(p.valeur, 1)} % de la bande principale de ${fr(prof, 1)} m (${fr(bandes.bandePrincipaleM2)} m² mesurés depuis le côté voie présumé)` });
          non.push(`Emprise par bande : ${fr(p.valeur, 1)} % de la bande principale (${fr(bandes.bandePrincipaleM2)} m² à moins de ${fr(prof, 1)} m de la voie) = ${fr(empriseM2)} m², ` +
            `soit ${fr(ratio * 100, 1)} % de la parcelle de ${fr(bandes.surfaceParcelleM2)} m²`);
          non.push(`Bande secondaire (${fr(bandes.bandeSecondaireM2)} m²${s ? `, emprise ${fr(s.valeur, 1)} %` : ''}) : non construite dans le volume d’étude`);
          non.push(options.implantationDansBande
            ? 'Côté voie présumé d’après le cadastre (limite sans parcelle mitoyenne), à confirmer ; les bâtiments du volume d’étude sont contenus dans la bande principale (vérifié par le calcul)'
            : 'Côté voie présumé d’après le cadastre (limite sans parcelle mitoyenne) ; le volume n’est pas encore contraint à rester dans la bande principale — implantation à vérifier');
          continue;
        }
      }
      const min = Math.min(...alts.map((a) => a.valeur));
      if (min > 0 && min <= 100) {
        out.push({ cle: 'emprise_max_ratio', valeur: min / 100, ...base, source: `${r.source} — emprise par bande, côté voie non identifié : taux le plus contraignant appliqué à la parcelle` });
      }
      non.push(`Emprise par bande${p ? ` : ${fr(p.valeur, 1)} % dans la bande principale${prof ? ` de ${fr(prof, 1)} m depuis la voie` : ''}` : ''}` +
        `${s ? `, ${fr(s.valeur, 1)} % dans la bande secondaire` : ''} — le volume d’étude ne situe pas la voie : ${fr(min, 1)} % appliqué à toute la parcelle, ` +
        'ce qui SOUS-ESTIME l’emprise possible sur rue');
      continue;
    }
    if (cle === 'recul_limites_formule') {
      const f = typeof r.valeur === 'string' ? formuleRecul(r.valeur) : null;
      if (f) out.push({ cle, valeur: f.diviseur, minimumM: f.minimumM, ...base });
      else non.push(`Recul aux limites (formule « ${String(r.valeur)} ») : non chiffrable par le volume`);
      continue;
    }
    // Lot C10 (défaut D) — hauteur, niveaux, pleine terre PAR BANDE : la valeur de la bande principale (retenue
    // par lireRegles) ne vaut que pour un volume destiné à la bande principale, c'est-à-dire quand l'appelant
    // passe les bandes mesurées (l'emprise est alors celle de la bande principale) ou garantit l'implantation
    // dans la bande. Sinon (calcul prudent, côté voie non situé) un bâtiment peut se trouver en bande
    // secondaire : la valeur la PLUS CONTRAIGNANTE des bandes est appliquée à tout le volume, et c'est dit.
    if (SENS_PAR_BANDE[r.cle] && r.cle !== 'emprise_sol_max_pct' && estConditionBande(r.alternatives ?? []) && !options.implantationDansBande && !bandes) {
      const l = limiteSelonBande(r, false);
      if (l && l.plusPermissive !== null) {
        const ratio = cle === 'pleine_terre_min_ratio';
        const prudente: ReglePlu = { cle, valeur: ratio ? l.valeur / 100 : l.valeur, ...base, source: `${r.source} — règle par bande, bâtiments non situés dans la bande principale : valeur la plus contraignante des bandes` };
        if (regleValide(prudente)) {
          out.push(prudente);
          const u = UNITES_BANDE[r.cle] ?? '';
          // « Règle par bande, … » en tête : la fiche du site retire les lignes commençant par « Pleine terre » quand la notion est trouvée.
          non.push(`Règle par bande, ${(LIBELLES[r.cle] ?? r.cle).toLowerCase()} (${mentionBandes(r.alternatives ?? [], u, r.texte).replace(/^règle par bande — /u, '')}) — le volume d’étude n’est pas situé dans la bande principale : ` +
            `${fr(l.valeur, 1)}${u ? ` ${u}` : ''} appliqué${l.valeur !== l.plusPermissive ? `, et non ${fr(l.plusPermissive, 1)}${u ? ` ${u}` : ''}` : ''}`);
          continue;
        }
      }
    }
    const v = fini(r.valeur) ? r.valeur : null;
    if (v === null) {
      // Lot C11 : recul sur voie « non réglementé », confirmé et cité, volume destiné à la bande principale → l'alignement est retenu (hypothèses).
      non.push(r.cle === 'recul_voie_m' && r.nature === 'non_reglementee' && regleCitee(r) && options.implantationDansBande
        ? `recul_voie_m : non réglementé (${libelleRegle(r)}) — aucune valeur chiffrée ; alignement retenu côté voie dans la bande principale, voir les hypothèses`
        : `${r.cle} : valeur non chiffrée`);
      continue;
    }
    const regle: ReglePlu = { cle, valeur: cle === 'emprise_max_ratio' || cle === 'pleine_terre_min_ratio' ? v / 100 : v, ...base };
    // Lot C11 — pleine terre PAR BANDE, volume destiné à la bande principale : le moteur n'applique que la valeur de
    // la bande principale, comme une part de TOUTE la parcelle. Il ne contrôle pas la pleine terre bande par bande : dit ici.
    if (r.cle === 'pleine_terre_min_pct' && estConditionBande(r.alternatives ?? []) && regleValide(regle)) {
      non.push(`Règle par bande, pleine terre (${mentionBandes(r.alternatives ?? [], '%', r.texte).replace(/^règle par bande — /u, '')}) — NON contrôlée bande par bande par le moteur de volume : ` +
        `${fr(v, 1)} % (bande principale) appliqué comme part non bâtie de toute la parcelle ; la part non bâtie de chaque bande est donnée dans les vérifications, voirie et stationnement non déduits`);
    }
    if (regleValide(regle)) out.push(regle);
    else if (v === 0 && cle === 'recul_limites_m') non.push(options.implantationDansBande
      // Lot C11 : dans la bande principale, l'implantation en limite est appliquée aux limites latérales si la règle est confirmée et citée.
      ? 'recul_limites_m : 0 m (implantation en limite séparative permise) — appliqué aux limites latérales dans la bande principale seulement si la règle est confirmée et citée, voir les hypothèses ; retrait conservé sur le fond de parcelle'
      : 'recul_limites_m : 0 m (implantation en limite séparative permise) — non appliqué : le volume garde un retrait sur les limites séparatives');
    else if (v === 0 && cle.startsWith('recul')) non.push(options.implantationDansBande
      ? `${r.cle} : 0 m (implantation à l’alignement autorisée) — appliqué côté voie seulement si la règle est confirmée et citée, voir les hypothèses`
      : `${r.cle} : 0 m (implantation à l’alignement autorisée) — le volume garde le recul des limites séparatives`);
    else non.push(`${r.cle} : ${String(r.valeur)} hors bornes, ignorée`);
  }
  if (gabaritNiveaux !== null) {
    out.push({ cle: 'niveaux_max', valeur: gabaritNiveaux, source: `Programme de la conception (gabarit ${libelleNiveaux(gabaritNiveaux)}) — choix du projet, pas une règle PLU`, reference: null, statut: 'estimee' });
  }
  return { source: out.some((r) => !r.source.startsWith('Programme de la conception')) ? 'plu-chiffre' : 'aucune', regles: out, nonAppliquees: non };
}

/** « R+4 » → 5 niveaux ; « RDC » / « R+0 » → 1 ; sinon null. */
export function niveauxDuGabarit(g: unknown): number | null {
  const s = txt(g, 40);
  if (!s) return null;
  const m = /\bR\s*\+\s*(\d{1,2})\b/i.exec(s);
  if (m) { const n = Number(m[1]) + 1; return n >= 1 && n <= 30 ? n : null; }
  return /\b(rdc|rez[\s-]de[\s-]chauss[ée]e|plain[\s-]pied)\b/i.test(s) ? 1 : null;
}
