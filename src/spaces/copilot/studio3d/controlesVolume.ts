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

import { HYPOTHESES_VOLUME, libelleNiveaux, regleValide, type ReglePlu, type ReglesPluVolume, type VolumePropose } from './volumeParcelle.ts';
import { estConditionBande, mentionBandes, optionBandePrincipale, optionBandeSecondaire, profondeurBandePrincipaleM, type OptionBande } from './reglesParBande.ts';

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
      const mention = `${mentionBandes(alternatives, UNITES_BANDE[e.cle] ?? '', txt(e.texte, 600))} ; côté voie non identifié par le volume`;
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
  // Lot formes-batiment : bâtiment à ailes (L, U, cour, redans) → reculM est la plus petite distance de ses
  // AILES (rectangles réels) aux limites, emprise = réunion des ailes : on le dit dans l'explication.
  const recul = v.reculM;
  const ailes = (v.batiments ?? []).some((b) => (b.ailes?.length ?? 0) >= 2);
  const surContour = ailes ? ' Mesuré aile par aile sur le contour réel du bâtiment (pas sur son rectangle englobant).' : '';
  const rv = r('recul_voie_m');
  if (rv && fini(rv.valeur)) out.push(juger(rv, recul + 0.01 >= rv.valeur, `${fr(recul, 1)} m de toutes les limites`, rv.valeur === 0 ? 'alignement autorisé (0 m)' : `${fr(rv.valeur, 1)} m min.`, 'recul_voie_m', ` Côté voie non identifié sur le cadastre : recul uniforme.${surContour}`));
  else out.push(nonControle('recul_voie_m', 'Recul à la voie inconnu : non contrôlé.'));
  const rl = r('recul_limites_m');
  if (rl && fini(rl.valeur)) out.push(juger(rl, recul + 0.01 >= rl.valeur, `${fr(recul, 1)} m de toutes les limites`, `${fr(rl.valeur, 1)} m min.`, 'recul_limites_m', surContour));
  else {
    const rf = r('recul_limites_formule');
    const f = rf && typeof rf.valeur === 'string' ? formuleRecul(rf.valeur) : null;
    if (rf && f) {
      const exige = Math.max(f.minimumM ?? 0, v.hauteurM / f.diviseur);
      out.push(juger(rf, recul + 0.01 >= exige, `${fr(recul, 1)} m de toutes les limites`, `${String(rf.valeur)} soit ${fr(exige, 1)} m pour ≈ ${fr(v.hauteurM, 1)} m`, 'recul_limites_m', surContour));
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
export function reglesVolume(regles: RegleLue[], gabaritNiveaux: number | null): ReglesPluVolume {
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
    const v = fini(r.valeur) ? r.valeur : null;
    if (v === null) { non.push(`${r.cle} : valeur non chiffrée`); continue; }
    const regle: ReglePlu = { cle, valeur: cle === 'emprise_max_ratio' || cle === 'pleine_terre_min_ratio' ? v / 100 : v, ...base };
    if (regleValide(regle)) out.push(regle);
    else if (v === 0 && cle.startsWith('recul')) non.push(`${r.cle} : 0 m (implantation à l’alignement autorisée) — le volume garde le recul des limites séparatives`);
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
