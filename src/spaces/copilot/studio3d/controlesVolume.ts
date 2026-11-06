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
// =============================================================================

import { HYPOTHESES_VOLUME, libelleNiveaux, type VolumePropose } from './volumeParcelle.ts';

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
}

export function lireRegles(brut: unknown): RegleLue[] {
  if (!Array.isArray(brut)) return [];
  return brut.flatMap((e): RegleLue[] => {
    if (!estObj(e) || typeof e.cle !== 'string') return [];
    const statut = e.statut === 'confirme' || e.statut === 'estime' ? e.statut : 'manquant';
    const valeur = fini(e.valeur) || typeof e.valeur === 'string' ? e.valeur as number | string : null;
    return [{
      cle: e.cle, valeur, statut, source: txt(e.source, 300) ?? 'source non précisée', article: txt(e.article, 120),
      nature: txt(e.nature, 40), texte: txt(e.texte, 300), regle_relative: txt(e.regle_relative, 300),
    }];
  });
}

/** Règle CITÉE : confirmée (règlement lu avec son article, ou utilisateur) ET article renseigné. */
export const regleCitee = (r: RegleLue | undefined): boolean => !!r && r.statut === 'confirme' && !!r.article;

/** « H/2 min 4 m » → { diviseur: 2, minimumM: 4 } (même lecture que reglesPlu.ts). */
export function formuleRecul(v: string): { diviseur: number; minimumM: number | null } | null {
  const f = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const m = /\bh\s*\/\s*([1-4])\b/.exec(f);
  if (!m) return null;
  const min = /(?:min(?:imum)?\.?|≥|>=)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*m/.exec(f);
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
  const juger = (regle: RegleLue, respecte: boolean, valeur: string, limite: string, cle: string, precision = ''): ControleVolume => {
    const condition = regle.regle_relative ? ` Condition complémentaire non vérifiée : ${regle.regle_relative}.` : '';
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
  if (h && fini(h.valeur)) out.push(juger(h, v.hauteurM <= h.valeur + 1e-9, `≈ ${fr(v.hauteurM, 1)} m`, `${fr(h.valeur, 1)} m max.`, 'hauteur_max_m', precisionH));
  else out.push(nonControle('hauteur_max_m', `Hauteur maximale inconnue : non contrôlée (volume ≈ ${fr(v.hauteurM, 1)} m).`));
  // Niveaux
  const n = r('niveaux_max');
  if (n && fini(n.valeur)) out.push(juger(n, v.niveaux <= n.valeur, `${v.niveaux} niveaux (${libelleNiveaux(v.niveaux)})`, `${fr(n.valeur)} niveaux max.`, 'niveaux_max'));
  // Emprise
  const e = r('emprise_sol_max_pct');
  if (e && e.nature === 'non_reglementee' && e.article) {
    out.push({ cle: 'emprise_sol_max_pct', libelle: LIBELLES.emprise_sol_max_pct, valeur_volume: ratioPct !== null ? `${fr(ratioPct, 1)} %` : null,
      regle: `non réglementée (${libelleRegle(e)})`, verdict: regleCitee(e) ? 'dans_la_limite' : 'a_verifier',
      explication: `Emprise non réglementée${regleCitee(e) ? ` (${e.article})` : ' (règle non confirmée)'} : aucun plafond ; le volume occupe ${ratioPct !== null ? `${fr(ratioPct, 1)} %` : '?'} de la parcelle, borné par la pleine terre et les reculs.` });
  } else if (e && fini(e.valeur) && ratioPct !== null) {
    out.push(juger(e, ratioPct <= e.valeur + 1e-9, `${fr(ratioPct, 1)} %`, `${fr(e.valeur, 1)} % max.`, 'emprise_sol_max_pct'));
  } else {
    out.push(nonControle('emprise_sol_max_pct', `Emprise maximale inconnue : plafond par défaut de ${fr(HYPOTHESES_VOLUME.cesDefaut * 100)} % appliqué au volume (hypothèse).`));
  }
  // Reculs : le volume tient à ≥ reculM de TOUTES les limites (côté voie non identifié).
  const recul = v.reculM;
  const rv = r('recul_voie_m');
  if (rv && fini(rv.valeur)) out.push(juger(rv, recul + 0.01 >= rv.valeur, `${fr(recul, 1)} m de toutes les limites`, rv.valeur === 0 ? 'alignement autorisé (0 m)' : `${fr(rv.valeur, 1)} m min.`, 'recul_voie_m', ' Côté voie non identifié sur le cadastre : recul uniforme.'));
  else out.push(nonControle('recul_voie_m', 'Recul à la voie inconnu : non contrôlé.'));
  const rl = r('recul_limites_m');
  if (rl && fini(rl.valeur)) out.push(juger(rl, recul + 0.01 >= rl.valeur, `${fr(recul, 1)} m de toutes les limites`, `${fr(rl.valeur, 1)} m min.`, 'recul_limites_m'));
  else {
    const rf = r('recul_limites_formule');
    const f = rf && typeof rf.valeur === 'string' ? formuleRecul(rf.valeur) : null;
    if (rf && f) {
      const exige = Math.max(f.minimumM ?? 0, v.hauteurM / f.diviseur);
      out.push(juger(rf, recul + 0.01 >= exige, `${fr(recul, 1)} m de toutes les limites`, `${String(rf.valeur)} soit ${fr(exige, 1)} m pour ≈ ${fr(v.hauteurM, 1)} m`, 'recul_limites_m'));
    } else out.push(nonControle('recul_limites_m', 'Recul aux limites inconnu : non contrôlé.'));
  }
  // Pleine terre : jamais affirmée (voirie, stationnement, dalles non déduits).
  const pt = r('pleine_terre_min_pct');
  if (pt && fini(pt.valeur) && ratioPct !== null) {
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
