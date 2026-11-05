// supabase/functions/copilot-chat/agent/studio.ts
// =============================================================
// LOT E1 — Mimmo pilote le Studio et les rendus.
//
// Trois outils (déclarés dans outils.ts) :
//   · studio_preparer_3d  : fiche de conception (agent_conceptions : parcelle
//     cadastrale, règles PLU, programme) → volume d'étude calculé par le code
//     PUR du Dossier 3D (studio-front.ts : volumeParcelle + implantationProgramme)
//     → table studio_preparations (ouverture en un clic dans le Dossier 3D).
//     Déterministe : mêmes entrées → même volume, même empreinte, même ligne.
//   · studio_lancer_rendu : film / visite 360° / image dans la file studio_jobs,
//     en DEUX TEMPS : devis (rien n'est lancé) puis confirmation dans un tour
//     SUIVANT, portée par un jeton signé (HMAC) lié à l'utilisateur, au type, aux
//     options et à la source. Insertion avec le JWT de l'utilisateur (RLS,
//     déclencheur de protection, plafond de 2 travaux actifs).
//   · studio_etat_rendu   : statut RÉEL (colonnes de studio_jobs écrites par le
//     worker), liens du résultat (URL signées studio-rendus, page publique visite).
//
// Règles tenues ici :
//   - aucune surface, hauteur ou SDP calculée par l'IA : tout vient du moteur ;
//   - jamais « conforme » : un contrôle n'est « dans la limite » que pour une
//     règle CONFIRMÉE et CITÉE (article) ; sinon « à vérifier » ;
//   - jamais un rendu sans accord : le serveur refuse la confirmation dans la
//     même requête que le devis, et une confirmation sans devis valide ;
//   - statuts affichés = colonnes réelles ; la machine de rendu (PC du fondateur)
//     n'a pas de battement de cœur au repos : son état est DÉDUIT de la file
//     (dernière activité, attente) et présenté comme tel.
//
// Aucune dépendance à index.ts : l'accès aux données passe par DepotStudio
// (implémentation Supabase en bas de fichier, mémoire dans studio.test.ts).
// =============================================================

import {
  calculerVolumeProgramme, construireProjetChat, draftBrief, exigerPreparation3D, ficheStudioDepuisVolume,
  HYPOTHESES_VOLUME, libelleNiveaux, programmeBatiDepuisTexte, regleValide, rotationContrat, studioCommand,
  studioComposition, studioSegmentedVolume, volumeBatimentsStudio,
  type GeometrieParcelle, type JarvisDraft, type ProgrammeVolume, type ReglePlu, type ReglesPluVolume, type VolumePropose,
} from './studio-front.ts';
import type { ResultatOutil } from './types.ts';

export const SOURCE_STUDIO = 'MimmozIA · Studio 3D';
/** Version du calcul (entre dans l'empreinte) : à incrémenter si la conversion conception → volume change. */
export const VERSION_CALCUL = 'e1-studio-1';
export const TYPES_RENDU = ['film', 'visite360', 'image'] as const;
export type TypeRendu = typeof TYPES_RENDU[number];
/** Durée de validité d'un devis de rendu. */
export const DEVIS_VALIDITE_MS = 30 * 60_000;
/** Au-delà, un travail en attente sans activité de la machine de rendu est signalé « machine probablement hors ligne ». */
export const ATTENTE_SUSPECTE_MS = 10 * 60_000;
/** Battement du worker pendant un rendu (worker/README : progression au moins toutes les 4 min). */
export const ACTIVITE_RECENTE_MS = 15 * 60_000;
export const NOMBRE_MAX_TRAVAUX_ACTIFS = 2;
export const ORIGINE_MIMMOZA_DEFAUT = 'https://mimmoza.vercel.app';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const txt = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const estUuid = (v: unknown): v is string => typeof v === 'string' && RE_UUID.test(v);
const RE_IDU = /^(2[AB]\d{3}|\d{5})\d{3}[0-9A-Z]{2}\d{4}$/;
const fr = (v: number, d = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });

// =============================================================
// 1. Conception → entrées du moteur du Dossier 3D
// =============================================================

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

const CLES_VOLUME: Record<string, ReglePlu['cle']> = {
  hauteur_max_m: 'hauteur_max_m', niveaux_max: 'niveaux_max', emprise_sol_max_pct: 'emprise_max_ratio',
  recul_voie_m: 'recul_voie_m', recul_limites_m: 'recul_limites_m', recul_limites_formule: 'recul_limites_formule',
  pleine_terre_min_pct: 'pleine_terre_min_ratio',
};

/** « H/2 min 4 m » → { diviseur: 2, minimumM: 4 } (même lecture que reglesPlu.ts). */
export function formuleRecul(v: string): { diviseur: number; minimumM: number | null } | null {
  const f = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const m = /\bh\s*\/\s*([1-4])\b/.exec(f);
  if (!m) return null;
  const min = /(?:min(?:imum)?\.?|≥|>=)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*m/.exec(f);
  return { diviseur: Number(m[1]), minimumM: min ? Number(min[1].replace(',', '.')) : null };
}

const libelleRegle = (r: RegleLue) => `${r.source}${r.article ? `, ${r.article}` : ''}`;

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

/** Programme de conception → programme du volume (lu par programmeBati.ts, le même lecteur que le chat). */
export function programmeVolume(p: unknown): ProgrammeVolume {
  const o = estObj(p) ? p : {};
  const n = fini(o.nb_logements) && o.nb_logements >= 1 ? Math.round(o.nb_logements) : null;
  if (n === null) return { logements: null, libelle: null, origine: null };
  const bati = programmeBatiDepuisTexte(`${n} logements`);
  return bati ? { ...bati, origine: 'fiche' } : { logements: n, libelle: `${n} logements`, origine: 'fiche' };
}

export interface ParcelleLue { idu: string; geometrie: GeometrieParcelle; surface_m2: number | null; source: string }

export function lireParcelle(p: unknown, iduDefaut: string): ParcelleLue | null {
  if (!estObj(p) || !estObj(p.geometrie)) return null;
  const g = p.geometrie;
  if ((g.type !== 'Polygon' && g.type !== 'MultiPolygon') || !Array.isArray(g.coordinates) || !g.coordinates.length) return null;
  return { idu: txt(p.idu, 40) ?? iduDefaut, geometrie: g as unknown as GeometrieParcelle, surface_m2: fini(p.surface_m2) ? p.surface_m2 : null, source: txt(p.source, 200) ?? 'non précisée' };
}

// =============================================================
// 2. Contrôles du volume (jamais « conforme »)
// =============================================================

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

// =============================================================
// 3. Préparation déterministe
// =============================================================

export interface ConceptionLue {
  id: string;
  idu: string;
  commune: string | null;
  parcelle: unknown;
  regles_plu: unknown;
  programme: unknown;
}

export interface EntreePreparation {
  parcelle: ParcelleLue;
  commune: string | null;
  regles: RegleLue[];
  programme: unknown;
  programme_volume: ProgrammeVolume;
  gabarit_niveaux: number | null;
}

export interface ResumePreparation {
  statut: VolumePropose['statut'];
  surface_parcelle_m2: number;
  batiments: number;
  formes: string[];
  niveaux: number;
  gabarit: string;
  hauteur_indicative_m: number;
  emprise_batie_m2: number;
  emprise_pct: number | null;
  sdp_estimee_m2: number;
  logements_places: number | null;
  logements_vises: number | null;
  programme_atteint: boolean | null;
  recul_applique_m: number;
  mention_plu: string;
  hypotheses: string[];
  alertes: string[];
  regles_appliquees: string[];
  regles_non_appliquees: string[];
  controles: ControleVolume[];
}

export type IssuePreparation =
  | { ok: true; entree: EntreePreparation; volume: VolumePropose; resume: ResumePreparation; empreinte: string }
  | { ok: false; raison: string };

/** JSON canonique (clés triées) : base de l'empreinte. */
export function jsonCanonique(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (estObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

export async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function resumerVolume(v: VolumePropose, controles: ControleVolume[], programme: ProgrammeVolume): ResumePreparation {
  const emprise = v.kpi?.empriseTotaleM2 ?? v.emprise?.surfaceM2 ?? 0;
  const batiments = v.batiments?.length ?? (v.emprise ? 1 : 0);
  const formes = v.batiments?.length ? [...new Set(v.batiments.map((b) => b.forme))] : v.emprise ? ['volume unique'] : [];
  return {
    statut: v.statut,
    surface_parcelle_m2: Math.round(v.surfaceParcelleM2),
    batiments, formes, niveaux: v.niveaux, gabarit: libelleNiveaux(v.niveaux),
    hauteur_indicative_m: Math.round(v.hauteurM * 10) / 10,
    emprise_batie_m2: Math.round(emprise),
    emprise_pct: v.surfaceParcelleM2 > 0 ? Math.round(emprise / v.surfaceParcelleM2 * 1000) / 10 : null,
    sdp_estimee_m2: Math.round(v.sdpM2),
    logements_places: v.logementsEstimes,
    logements_vises: programme.logements,
    programme_atteint: v.programmeAtteint,
    recul_applique_m: v.reculM,
    mention_plu: v.mentionPlu,
    hypotheses: v.hypotheses.slice(0, 12),
    alertes: v.alertes.slice(0, 8),
    regles_appliquees: v.reglesAppliquees.slice(0, 12),
    regles_non_appliquees: v.reglesNonAppliquees.slice(0, 12),
    controles,
  };
}

/** Résumé court (mission : résultat d'outil plafonné à 3 000 caractères). */
export function resumeCompact(r: ResumePreparation): Obj {
  return {
    batiments: r.batiments, formes: r.formes, gabarit: r.gabarit, hauteur_indicative_m: r.hauteur_indicative_m,
    emprise_batie_m2: r.emprise_batie_m2, emprise_pct: r.emprise_pct, sdp_estimee_m2: r.sdp_estimee_m2,
    logements_places: r.logements_places, logements_vises: r.logements_vises, programme_atteint: r.programme_atteint,
    alertes: r.alertes.slice(0, 3), controles: r.controles.map((c) => `${c.libelle} : ${c.verdict}`),
  };
}

/** Fiche de conception → volume d'étude (code du Dossier 3D), contrôles et empreinte. Aucune I/O. */
export async function preparerVolume(c: ConceptionLue): Promise<IssuePreparation> {
  const parcelle = lireParcelle(c.parcelle, c.idu);
  if (!parcelle) return { ok: false, raison: 'Le contour cadastral de la parcelle manque dans la conception : relancez l’étape « parcelle » de la mission de conception (recuperer_parcelle).' };
  const regles = lireRegles(c.regles_plu);
  const pv = programmeVolume(c.programme);
  const gabarit = niveauxDuGabarit(estObj(c.programme) ? c.programme.gabarit : null);
  const rv = reglesVolume(regles, gabarit);
  const volume = calculerVolumeProgramme(parcelle.geometrie, pv, rv);
  if (!volume.emprise || volume.niveaux < 1) {
    return { ok: false, raison: `Aucun volume ne tient sur la parcelle avec les règles connues : ${volume.alertes[0] ?? volume.mentionPlu ?? volume.statut}.` };
  }
  const controles = controlerVolume(volume, regles, volume.logementsEstimes ?? pv.logements);
  const entree: EntreePreparation = { parcelle, commune: c.commune, regles, programme: c.programme ?? null, programme_volume: pv, gabarit_niveaux: gabarit };
  const empreinte = await sha256Hex(jsonCanonique({ version: VERSION_CALCUL, conception_id: c.id, entree }));
  return { ok: true, entree, volume, resume: resumerVolume(volume, controles, pv), empreinte };
}

// =============================================================
// 4. Rendus : options, devis, jeton, fiche
// =============================================================

export type Validation<T> = { ok: true; valeur: T } | { ok: false; erreur: string };
const AMBIANCES = ['jour', 'fin_de_journee', 'nuit'];
const VUES = ['trois_quarts_gauche', 'trois_quarts_droite', 'face'];

/** Mêmes règles que _studio_job_options_valides (SQL) et travauxLogique.validerOptions (front). Absentes : défauts. */
export function validerOptionsRendu(type: unknown, brut: unknown): Validation<Obj> {
  if (type !== 'film' && type !== 'visite360' && type !== 'image') return { ok: false, erreur: 'Type de rendu inconnu (film, visite360 ou image).' };
  if (brut !== undefined && brut !== null && !estObj(brut)) return { ok: false, erreur: 'Options illisibles.' };
  const o = (brut ?? {}) as Obj;
  const permises = type === 'film' ? ['duree_s', 'ambiance', 'format', 'interieurs', 'musique'] : type === 'visite360' ? ['ambiance', 'interieurs', 'resolution'] : ['vues', 'ambiance'];
  const inconnue = Object.keys(o).find((k) => !permises.includes(k));
  if (inconnue) return { ok: false, erreur: `Option inconnue : ${inconnue}.` };
  if (type === 'image') {
    const vues = o.vues ?? ['trois_quarts_gauche'];
    if (!Array.isArray(vues) || vues.length < 1 || vues.length > 3 || new Set(vues).size !== vues.length || vues.some((v) => !VUES.includes(v as string))) {
      return { ok: false, erreur: 'Choisissez de 1 à 3 vues : 3/4 gauche, 3/4 droite ou face.' };
    }
    const ambiance = o.ambiance ?? 'jour';
    if (ambiance !== 'jour' && ambiance !== 'fin_de_journee') return { ok: false, erreur: 'Choisissez une lumière : journée ou fin de journée.' };
    return { ok: true, valeur: { vues: VUES.filter((v) => (vues as unknown[]).includes(v)), ambiance } };
  }
  const ambiance = o.ambiance ?? 'jour';
  if (!AMBIANCES.includes(ambiance as string)) return { ok: false, erreur: 'Choisissez une ambiance : journée, fin de journée ou nuit.' };
  const interieurs = o.interieurs ?? true;
  if (typeof interieurs !== 'boolean') return { ok: false, erreur: 'Indiquez si les intérieurs sont inclus.' };
  if (type === 'film') {
    const duree = o.duree_s ?? 60;
    if (duree !== 30 && duree !== 60 && duree !== 90) return { ok: false, erreur: 'La durée du film doit être de 30, 60 ou 90 secondes.' };
    const format = o.format ?? '16:9';
    if (format !== '16:9' && format !== '9:16') return { ok: false, erreur: 'Le format doit être paysage (16:9) ou vertical (9:16).' };
    const musique = o.musique ?? true;
    if (typeof musique !== 'boolean') return { ok: false, erreur: 'Indiquez si le film a une musique.' };
    return { ok: true, valeur: { duree_s: duree, ambiance, format, interieurs, musique } };
  }
  const resolution = o.resolution ?? '6k';
  if (resolution !== '6k' && resolution !== '8k') return { ok: false, erreur: 'La qualité doit être 6K ou 8K.' };
  return { ok: true, valeur: { ambiance, interieurs, resolution } };
}

const LIBELLE_TYPE: Record<TypeRendu, string> = { film: 'Film', visite360: 'Visite 360°', image: 'Image photoréaliste' };

/** Durée annoncée : formule du front pour l'image (travauxLogique.dureeEstimeeImage) ; délais MAXIMAUX du worker sinon. */
export function dureeAnnoncee(type: TypeRendu, options: Obj): string {
  if (type === 'image') {
    const n = Array.isArray(options.vues) ? Math.max(1, Math.min(3, options.vues.length)) : 1;
    const h = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`);
    return `environ ${h(10 + 7 + 20 * n)} à ${h(10 + 7 + 60 * n)} une fois le rendu démarré (préparation, aperçu de contrôle, puis 20 à 60 min par vue)`;
  }
  return type === 'film'
    ? 'plusieurs heures possibles une fois le rendu démarré (aucune estimation fiable ; arrêt automatique au-delà de 12 h de rendu, 18 h au total)'
    : 'plusieurs heures possibles une fois le rendu démarré (aucune estimation fiable ; arrêt automatique au-delà de 6 h de rendu, 18 h au total)';
}

export function resumeOptions(type: TypeRendu, o: Obj): string {
  const amb: Record<string, string> = { jour: 'en journée', fin_de_journee: 'fin de journée', nuit: 'de nuit' };
  if (type === 'image') return `${(o.vues as string[]).map((v) => ({ trois_quarts_gauche: '3/4 gauche', trois_quarts_droite: '3/4 droite', face: 'face' } as Obj)[v]).join(', ')} · ${amb[String(o.ambiance)]}`;
  if (type === 'film') return [`${String(o.duree_s)} s`, amb[String(o.ambiance)], o.format === '9:16' ? 'vertical' : 'paysage', o.interieurs ? 'intérieurs' : null, o.musique ? 'musique' : null].filter(Boolean).join(' · ');
  return [amb[String(o.ambiance)], String(o.resolution).toUpperCase(), o.interieurs ? 'intérieurs' : null].filter(Boolean).join(' · ');
}

/** Statistiques GLOBALES et anonymes de la file (aucune donnée d'un autre utilisateur n'est renvoyée). */
export interface StatsFile {
  attente: number;
  plusAncienneAttente: string | null;
  enCours: number;
  /** Dernière écriture du worker (progression d'un rendu en cours ou dernière fin), ISO. */
  derniereActivite: string | null;
}

export type EtatMachine = 'occupee' | 'active_recemment' | 'silencieuse' | 'inconnue';

/** État DÉDUIT de la machine de rendu (pas de battement de cœur au repos) — formulé comme une déduction. */
export function etatMachine(s: StatsFile | null, maintenant: number): { etat: EtatMachine; phrase: string } {
  if (!s) return { etat: 'inconnue', phrase: 'État de la machine de rendu inconnu (file illisible) : le rendu démarrera quand elle prendra le travail.' };
  const depuis = (iso: string | null) => (iso ? maintenant - Date.parse(iso) : Number.POSITIVE_INFINITY);
  const activite = depuis(s.derniereActivite);
  const attente = depuis(s.plusAncienneAttente);
  const duree = (ms: number) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : ms < 172_800_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 86_400_000)} jours`);
  if (s.enCours > 0 && activite <= ACTIVITE_RECENTE_MS) {
    return { etat: 'occupee', phrase: `La machine de rendu est en ligne et occupée (${s.enCours} rendu en cours, ${s.attente} en attente) : un seul rendu à la fois.` };
  }
  if (s.attente > 0 && attente > ATTENTE_SUSPECTE_MS && activite > ATTENTE_SUSPECTE_MS) {
    return { etat: 'silencieuse', phrase: `La machine de rendu ne donne pas signe de vie (${s.attente} rendu(s) en attente depuis ${duree(attente)}, dernière activité ${Number.isFinite(activite) ? `il y a ${duree(activite)}` : 'inconnue'}) : elle est probablement éteinte. Le rendu restera EN ATTENTE jusqu’à sa reprise.` };
  }
  if (activite <= ACTIVITE_RECENTE_MS) return { etat: 'active_recemment', phrase: `La machine de rendu a été active il y a ${duree(activite)}.` };
  return { etat: 'inconnue', phrase: `Dernière activité connue de la machine de rendu : ${Number.isFinite(activite) ? `il y a ${duree(activite)}` : 'aucune'}. Elle peut être éteinte : le rendu démarre dès qu’elle prend le travail (elle n’envoie aucun signal au repos).` };
}

// ── Jeton de devis (HMAC-SHA256) ───────────────────────────────────────────

export interface ChargeJeton {
  v: 1;
  id: string;
  u: string;
  t: TypeRendu;
  o: Obj;
  s: { genre: 'version'; conception_id: string; n: number; modele_ref: string } | { genre: 'preparation'; preparation_id: string };
  c: string;
  iat: number;
  exp: number;
  rq: string;
}

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function cleHmac(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey('raw', new TextEncoder().encode(`studio-devis-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signerJeton(charge: ChargeJeton, secret: string): Promise<string> {
  const corps = b64u(new TextEncoder().encode(jsonCanonique(charge)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await cleHmac(secret), new TextEncoder().encode(corps)));
  return `${corps}.${b64u(sig)}`;
}

export async function lireJeton(jeton: unknown, secret: string): Promise<ChargeJeton | null> {
  if (typeof jeton !== 'string' || jeton.length > 4000) return null;
  const [corps, sig] = jeton.split('.');
  if (!corps || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await cleHmac(secret), deB64u(sig), new TextEncoder().encode(corps));
    if (!ok) return null;
    const c = JSON.parse(new TextDecoder().decode(deB64u(corps))) as ChargeJeton;
    return c && c.v === 1 && typeof c.id === 'string' && typeof c.u === 'string' ? c : null;
  } catch { return null; }
}

// ── Fiche du travail ───────────────────────────────────────────────────────

export interface PreparationLue {
  id: string;
  conception_id: string | null;
  conversation_id: string | null;
  idu: string;
  empreinte: string;
  entree: unknown;
  volume: unknown;
  resume: unknown;
  cree_le?: string | null;
}

/** Pose du volume unique : même conversion que confirmationRapide.implantationDepuisVolume (rotationContrat). */
export function poseDepuisVolume(v: Pick<VolumePropose, 'emprise'>): { lon: number; lat: number; orientationDeg: number; entryOffsetM: number } | null {
  const e = v.emprise;
  if (!e || !fini(e.centreWgs84.lon) || !fini(e.centreWgs84.lat) || !fini(e.angleDeg)) return null;
  return { lon: e.centreWgs84.lon, lat: e.centreWgs84.lat, orientationDeg: rotationContrat(e.angleDeg), entryOffsetM: 0 };
}

export function titreRendu(draft: JarvisDraft): string {
  const parties = [draft.programme, draft.localisation].map((v) => v?.trim()).filter((v): v is string => Boolean(v));
  const t = (parties.length ? parties.join(' — ') : draft.objectif?.trim() || 'Projet Mimmoza').replace(/\s+/g, ' ');
  return t.length > 120 ? `${t.slice(0, 119)}…` : t;
}

/**
 * Fiche `studio_jobs` d'une 3D préparée : le projet v2 que « Voir en 3D » construirait (même code :
 * ficheStudioDepuisVolume, volumeBatimentsStudio, construireProjetChat), sans relief (le worker le
 * signale : terrain supposé plat) ni pièces jointes.
 */
export function ficheDepuisPreparation(p: PreparationLue, conversationId: string, horodatage: string, sessionId: string, origine: string): Validation<Obj> {
  const entree = (estObj(p.entree) ? p.entree : {}) as Partial<EntreePreparation>;
  const v = p.volume as VolumePropose;
  const parcelle = lireParcelle(entree.parcelle, p.idu);
  if (!parcelle || !estObj(p.volume) || !v.emprise) return { ok: false, erreur: 'La 3D préparée est illisible : relancez la préparation.' };
  const draft = ficheStudioDepuisVolume(v, { adresse: entree.commune ?? null, reference: p.idu, programme: entree.programme_volume, base: null });
  if (!draft) return { ok: false, erreur: 'Aucun volume à transmettre.' };
  try { exigerPreparation3D(draft); } catch (e) { return { ok: false, erreur: e instanceof Error ? e.message : 'Fiche 3D incomplète.' }; }
  let vb: ReturnType<typeof volumeBatimentsStudio> = null;
  try { vb = volumeBatimentsStudio(v, draft); } catch (e) { return { ok: false, erreur: e instanceof Error ? e.message : 'Trop de bâtiments pour le Studio.' }; }
  const insee = /^\d{5}|^2[AB]\d{3}/.test(p.idu) ? p.idu.slice(0, 5) : null;
  const composition = studioComposition(draft);
  const construit = construireProjetChat({
    conversationId, etudeId: null, sessionId, origine, retourUrl: null, revision: 0, horodatage,
    parcelles: [{ id: p.idu, feature: { type: 'Feature', properties: { id: p.idu, ...(insee ? { code_insee: insee } : {}) }, geometry: parcelle.geometrie } }],
    communeInsee: insee, adresse: entree.commune ?? null, pointAdresse: null, relief: null,
    implantation: vb ? null : poseDepuisVolume(v),
    brief: draftBrief(draft), commandeArchitecture: composition ? null : studioCommand(draft),
    compositionArchitecture: composition, volumeAiles: studioSegmentedVolume(draft),
    batiments: vb?.batiments ?? null, programmeVolume: vb,
  });
  if (!construit.ok) return { ok: false, erreur: `Projet Studio refusé par le contrat v2 : ${construit.erreur}` };
  return { ok: true, valeur: { version: 1, charge: construit.projet, draft, titre: titreRendu(draft), conversation_id: conversationId, origine: 'mimmo', preparation_id: p.id } };
}

// =============================================================
// 5. Accès aux données (injecté)
// =============================================================

export interface TravailLu {
  id: string;
  conversation_id: string | null;
  type: string;
  statut: string;
  progression: number;
  etape: string | null;
  resultat: unknown;
  elements_omis: unknown;
  erreur: string | null;
  cree_le: string;
  demarre_le: string | null;
  termine_le: string | null;
}

export interface DepotStudio {
  conception(userId: string, q: { id?: string | null; idu?: string | null }): Promise<ConceptionLue | null>;
  derniereVersion(userId: string, conceptionId: string): Promise<{ n: number; modele_ref: string } | null>;
  /** Upsert idempotent par (user_id, empreinte) ; renvoie l'id. */
  enregistrerPreparation(userId: string, ligne: Omit<PreparationLue, 'id' | 'cree_le'> & { origine: 'chat' | 'mission'; version_calcul: string }): Promise<string>;
  preparation(userId: string, q: { id?: string | null; conceptionId?: string | null; conversationId?: string | null }): Promise<PreparationLue | null>;
  /** _studio_job_options_valides(type, options) : true / false ; null si la base n'a pas pu répondre. */
  typeRenduAutorise(type: TypeRendu, options: Obj): Promise<boolean | null>;
  statsFile(): Promise<StatsFile | null>;
  travauxActifs(userId: string): Promise<number>;
  travailParDevis(userId: string, devisId: string): Promise<TravailLu | null>;
  /** Insertion SOUS L'IDENTITÉ de l'utilisateur (RLS) ; lève une Error portant le message Postgres. */
  insererTravail(userId: string, ligne: { conversation_id: string; type: TypeRendu; fiche: Obj; options: Obj }): Promise<TravailLu>;
  travail(userId: string, q: { id?: string | null; conversationId?: string | null }): Promise<TravailLu | null>;
  /** Nombre de travaux en attente créés avant `creeLe` (toute la file, anonyme). */
  positionFile(creeLe: string): Promise<number | null>;
  urlSigneeRendu(chemin: string, secondes: number): Promise<string | null>;
}

export interface EnvStudio {
  /** Utilisateur du JWT vérifié (chat) ou de la mission ; jamais une valeur du modèle. */
  userId: string | null;
  depot: DepotStudio;
  /** Secret HMAC des devis ; null = rendus indisponibles. */
  secret: string | null;
  /** Identifiant de la requête HTTP en cours (un message utilisateur = une requête). */
  requete: string;
  conversationId: string | null;
  origine: string;
  /** Vrai en mission (aucun rendu possible). */
  mission?: boolean;
  /** Mission : conception déjà en mémoire (évite une relecture). */
  conception?: ConceptionLue | null;
  maintenant?: () => number;
}

/** Identifiant stable de la requête : le même objet de contexte est passé à chaque outil d'une requête. */
const REQUETES = new WeakMap<object, string>();
export function idRequete(ctx: unknown): string {
  if (!ctx || typeof ctx !== 'object') return crypto.randomUUID();
  let id = REQUETES.get(ctx);
  if (!id) { id = crypto.randomUUID(); REQUETES.set(ctx, id); }
  return id;
}

/** Les outils Studio méritent-ils d'être proposés à ce tour ? (dernier message utilisateur, dernière réponse) */
export function studioPertinent(textes: readonly string[]): boolean {
  const RE = /\b(3\s?d|studio|maquette|volume|implantation|rendu|rendus|image|images|film|vid[ée]o|visite|360|perspective|photor[ée]alist)/i;
  return textes.some((t) => RE.test(t ?? ''));
}

// =============================================================
// 6. Exécution des outils
// =============================================================

function erreur(message: string, status: ResultatOutil['status'] = 'error'): ResultatOutil {
  return { status, source: SOURCE_STUDIO, message };
}

export async function executerOutilStudio(nom: string, input: Obj, env: EnvStudio): Promise<ResultatOutil | null> {
  if (!['studio_preparer_3d', 'studio_lancer_rendu', 'studio_etat_rendu'].includes(nom)) return null;
  if (!env.userId) return erreur("Session requise : l'utilisateur n'est pas authentifié. Ne prétends pas que l'action a été faite.");
  try {
    if (nom === 'studio_preparer_3d') return await preparer3D(input, env);
    if (env.mission) return erreur('Les rendus ne se lancent jamais depuis une mission : proposez-les dans le chat (accord explicite requis).');
    if (nom === 'studio_lancer_rendu') return await lancerRendu(input, env);
    return await etatRendu(input, env);
  } catch (e) {
    return erreur(`Service Studio indisponible : ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
  }
}

async function resoudreConception(input: Obj, env: EnvStudio): Promise<ConceptionLue | null> {
  if (env.conception) return env.conception;
  const id = estUuid(input.conception_id) ? input.conception_id : null;
  const idu = typeof input.idu === 'string' ? input.idu.replace(/\s/g, '').toUpperCase() : null;
  return await env.depot.conception(env.userId!, { id, idu: idu && RE_IDU.test(idu) ? idu : null });
}

async function preparer3D(input: Obj, env: EnvStudio): Promise<ResultatOutil> {
  const c = await resoudreConception(input, env);
  if (!c) {
    return erreur('Aucune conception trouvée pour cet utilisateur' + (input.idu ? ` sur ${String(input.idu)}` : '') +
      ". Une conception (parcelle, règles PLU, programme) se prépare par une mission de conception (proposer_mission, type « conception »).", 'not_found');
  }
  const p = await preparerVolume(c);
  if (!p.ok) return erreur(p.raison, 'partial');
  const id = await env.depot.enregistrerPreparation(env.userId!, {
    conception_id: c.id, conversation_id: env.conversationId, idu: c.idu, empreinte: p.empreinte,
    entree: p.entree, volume: p.volume, resume: p.resume, origine: env.mission ? 'mission' : 'chat', version_calcul: VERSION_CALCUL,
  });
  return {
    status: 'ok', source: SOURCE_STUDIO,
    data: {
      preparation_id: id, conception_id: c.id, idu: c.idu, commune: c.commune, empreinte: p.empreinte,
      calcul: 'déterministe — moteur du Dossier 3D (volumeParcelle + implantationProgramme), aucune IA',
      volume: env.mission ? resumeCompact(p.resume) : p.resume,
      ouverture: env.mission
        ? "Enregistrée : l'utilisateur l'ouvre depuis le chat (« ouvre la 3D préparée de ma conception »)."
        : "Bouton « Ouvrir la 3D préparée » dans le Dossier 3D, à droite du chat (un clic).",
    },
    message:
      'Volume d’étude INDICATIF, calculé par le moteur (ne recalcule rien de tête, cite ces chiffres tels quels). ' +
      'Reprends chaque vérification avec son verdict : « dans la limite de la règle citée » seulement si verdict dans_la_limite, sinon « à vérifier » ou « non contrôlé » ; ' +
      'n’écris jamais « conforme ». Rien n’a été envoyé au Studio : l’utilisateur ouvre la 3D d’un clic. ' +
      'Tu peux proposer un rendu (film, visite 360°, image) : studio_lancer_rendu affichera d’abord un devis.',
  };
}

interface SourceRendu { genre: 'version'; conception_id: string; n: number; modele_ref: string }
interface SourcePrep { genre: 'preparation'; preparation: PreparationLue }

async function resoudreSource(input: Obj, env: EnvStudio): Promise<{ ok: true; source: SourceRendu | SourcePrep; conceptionId: string | null } | { ok: false; res: ResultatOutil }> {
  const voulu = input.source === 'version' || input.source === 'preparation' ? input.source : 'auto';
  const uid = env.userId!;
  let prep: PreparationLue | null = null;
  if (estUuid(input.preparation_id)) {
    prep = await env.depot.preparation(uid, { id: input.preparation_id });
    if (!prep) return { ok: false, res: erreur('3D préparée introuvable pour cet utilisateur.', 'not_found') };
  }
  const conceptionId = prep?.conception_id ?? (estUuid(input.conception_id) ? input.conception_id : null);
  const conception = conceptionId ? { id: conceptionId } : (await env.depot.conception(uid, {}));
  if (voulu !== 'preparation' && conception?.id) {
    const v = await env.depot.derniereVersion(uid, conception.id);
    if (v) return { ok: true, source: { genre: 'version', conception_id: conception.id, n: v.n, modele_ref: v.modele_ref }, conceptionId: conception.id };
    if (voulu === 'version') return { ok: false, res: erreur('Aucune version enregistrée dans l’Atelier 3D pour cette conception : enregistrez une version, ou rendez la 3D préparée (source « preparation »).', 'not_found') };
  }
  prep ??= await env.depot.preparation(uid, { conceptionId: conception?.id ?? null, conversationId: conception?.id ? null : env.conversationId });
  if (!prep) return { ok: false, res: erreur('Rien à rendre : préparez d’abord la 3D de la conception (studio_preparer_3d), ou enregistrez une version dans l’Atelier 3D.', 'not_found') };
  return { ok: true, source: { genre: 'preparation', preparation: prep }, conceptionId: prep.conception_id };
}

function libelleSource(s: SourceRendu | SourcePrep): string {
  return s.genre === 'version'
    ? `version ${s.n} enregistrée dans l’Atelier 3D (le modèle exact du Studio est rendu)`
    : `3D préparée par Mimmo (volume d’étude, ${s.preparation.idu})`;
}

function avertissementsSource(s: SourceRendu | SourcePrep): string[] {
  if (s.genre === 'version') return [];
  const n = (s.preparation.volume as VolumePropose)?.batiments?.length ?? 1;
  return [
    'Le relief n’est pas transmis par Mimmo : la machine de rendu calcule sur un terrain supposé plat (elle le signale dans le résultat).',
    ...(n > 1 ? [`La 3D préparée compte ${n} bâtiments : la machine de rendu reconstruit les bâtiments d’après la description, la disposition peut différer du volume préparé. Pour un rendu fidèle, enregistrez une version dans l’Atelier 3D puis relancez.`] : []),
  ];
}

async function lancerRendu(input: Obj, env: EnvStudio): Promise<ResultatOutil> {
  if (!env.secret) return erreur('Rendus indisponibles : secret de devis non configuré côté serveur.', 'not_configured');
  if (!env.conversationId) return erreur('Ouvrez d’abord une conversation : le rendu est rattaché au chat.');
  const maintenant = (env.maintenant ?? Date.now)();
  const uid = env.userId!;

  // ── Temps 2 : confirmation ───────────────────────────────────
  if (input.confirmer === true) {
    const j = await lireJeton(input.jeton_devis, env.secret);
    if (!j || j.u !== uid) return erreur('Confirmation refusée : devis absent ou invalide. RIEN N’A ÉTÉ LANCÉ. Rappelle l’outil SANS confirmer pour établir un devis, présente-le et attends l’accord.');
    if (j.exp < maintenant) return erreur('Devis expiré (30 min). RIEN N’A ÉTÉ LANCÉ. Établis un nouveau devis et redemande l’accord.');
    if (j.rq === env.requete) {
      return erreur("Confirmation refusée : elle doit venir d'un message SUIVANT de l'utilisateur, après lecture du devis. RIEN N'A ÉTÉ LANCÉ. Présente le devis et attends sa réponse.");
    }
    if (input.type !== undefined && input.type !== j.t) return erreur('Le type demandé ne correspond pas au devis : établis un nouveau devis. RIEN N’A ÉTÉ LANCÉ.');
    const deja = await env.depot.travailParDevis(uid, j.id);
    if (deja) return { status: 'ok', source: SOURCE_STUDIO, data: { deja_lance: true, ...vueTravail(deja) }, message: 'Ce devis a déjà été lancé : rien n’a été relancé. Donne le statut ci-dessus.' };
    if (j.t === 'image' && (await env.depot.typeRenduAutorise('image', j.o)) === false) return refusImage();
    let fiche: Obj;
    if (j.s.genre === 'version') {
      fiche = { version: 1, conception: { conception_id: j.s.conception_id, n: j.s.n, modele_ref: j.s.modele_ref }, titre: `Conception — version ${j.s.n}`, conversation_id: j.c, origine: 'mimmo' };
    } else {
      const prep = await env.depot.preparation(uid, { id: j.s.preparation_id });
      if (!prep) return erreur('La 3D préparée du devis n’existe plus. RIEN N’A ÉTÉ LANCÉ.', 'not_found');
      const f = ficheDepuisPreparation(prep, j.c, new Date(maintenant).toISOString(), crypto.randomUUID(), env.origine);
      if (!f.ok) return erreur(`${f.erreur} RIEN N’A ÉTÉ LANCÉ.`);
      fiche = f.valeur;
    }
    fiche.devis_id = j.id;
    let t: TravailLu;
    try {
      t = await env.depot.insererTravail(uid, { conversation_id: j.c, type: j.t, fiche, options: j.o });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/déjà 2 films ou visites|studio_jobs_plafond/.test(m)) return erreur(`Vous avez déjà ${NOMBRE_MAX_TRAVAUX_ACTIFS} rendus en préparation : attendez qu’un se termine. RIEN N’A ÉTÉ LANCÉ.`);
      if (/studio_jobs_type_check/.test(m)) return refusImage();
      if (/Options du travail invalides/.test(m)) return erreur('Options refusées par la base. RIEN N’A ÉTÉ LANCÉ.');
      return erreur(`Le lancement n’a pas abouti (${m.slice(0, 200)}). RIEN N’A ÉTÉ LANCÉ.`);
    }
    const machine = etatMachine(await env.depot.statsFile(), maintenant);
    return {
      status: 'ok', source: SOURCE_STUDIO,
      data: { lance: true, ...vueTravail(t), machine: machine.phrase, suivi: 'studio_etat_rendu (sans argument : le plus récent de la conversation)' },
      message: 'Rendu ENREGISTRÉ dans la file (statut « en attente » tant que la machine de rendu ne l’a pas pris). ' +
        'Dis exactement cela, avec la phrase sur la machine de rendu ; n’annonce aucun démarrage ni délai qui ne soit pas renvoyé. Le suivi s’affiche aussi dans le Dossier 3D.',
    };
  }

  // ── Temps 1 : devis, AUCUNE écriture ─────────────────────────
  const type = input.type as TypeRendu;
  const opts = validerOptionsRendu(type, input.options);
  if (!opts.ok) return erreur(opts.erreur);
  if (type === 'image') {
    const autorise = await env.depot.typeRenduAutorise('image', opts.valeur);
    if (autorise === false) return refusImage();
  }
  const src = await resoudreSource(input, env);
  if (!src.ok) return src.res;
  if (src.source.genre === 'preparation') {
    const f = ficheDepuisPreparation(src.source.preparation, env.conversationId, new Date(maintenant).toISOString(), crypto.randomUUID(), env.origine);
    if (!f.ok) return erreur(f.erreur);
  }
  const actifs = await env.depot.travauxActifs(uid);
  if (actifs >= NOMBRE_MAX_TRAVAUX_ACTIFS) return erreur(`Vous avez déjà ${actifs} rendus en préparation (${NOMBRE_MAX_TRAVAUX_ACTIFS} au plus) : attendez qu’un se termine.`);
  const stats = await env.depot.statsFile();
  const machine = etatMachine(stats, maintenant);
  const charge: ChargeJeton = {
    v: 1, id: crypto.randomUUID(), u: uid, t: type, o: opts.valeur,
    s: src.source.genre === 'version' ? src.source : { genre: 'preparation', preparation_id: src.source.preparation.id },
    c: env.conversationId, iat: maintenant, exp: maintenant + DEVIS_VALIDITE_MS, rq: env.requete,
  };
  const devis = {
    rendu: `${LIBELLE_TYPE[type]} — ${resumeOptions(type, opts.valeur)}`,
    source: libelleSource(src.source),
    jetons: 0,
    cout_jetons: 'Aucun jeton débité pour ce rendu : les rendus ne sont pas facturés aujourd’hui (seul ce message du chat est compté, comme d’habitude).',
    calcul_gpu: 'Calcul sur la machine de rendu Mimmoza (carte graphique, Unreal), un rendu à la fois ; aucun service payant externe.',
    duree: dureeAnnoncee(type, opts.valeur),
    file_attente: stats ? `${stats.attente} rendu(s) en attente, ${stats.enCours} en cours` : 'inconnue',
    machine_de_rendu: machine.phrase,
    avertissements: avertissementsSource(src.source),
    expire_le: new Date(charge.exp).toISOString(),
  };
  return {
    status: 'confirmation_requise', source: SOURCE_STUDIO,
    // jeton_devis EN PREMIER : le rappel des résultats précédents (index.ts) ne garde que les 900 premiers caractères.
    data: { jeton_devis: await signerJeton(charge, env.secret), confirmation_requise: true, type, options: opts.valeur, devis },
    message:
      "RIEN N'A ÉTÉ LANCÉ. Ceci est un DEVIS. Présente-le (rendu, source, jetons, temps de calcul, file, état de la machine de rendu, avertissements) " +
      "et demande l'accord. Seulement si l'utilisateur répond OUI dans son PROCHAIN message, rappelle studio_lancer_rendu avec confirmer: true et ce jeton_devis. " +
      "N'annonce jamais le rendu comme lancé avant un statut ok.",
  };
}

function refusImage(): ResultatOutil {
  return erreur('Le rendu « image » n’est pas encore activé dans la base (migration du lot E0 non appliquée). RIEN N’A ÉTÉ LANCÉ. Film et visite 360° sont disponibles.', 'not_configured');
}

export function vueTravail(t: TravailLu): Obj {
  return {
    job_id: t.id, type: t.type, statut: t.statut, progression: t.progression, etape: t.etape,
    cree_le: t.cree_le, demarre_le: t.demarre_le, termine_le: t.termine_le, erreur: t.erreur,
  };
}

const LIBELLES_STATUT: Record<string, string> = {
  en_attente: 'en attente (pas encore pris par la machine de rendu)', en_cours: 'en cours de calcul', termine: 'terminé', echec: 'en échec', annule: 'annulé',
};

async function etatRendu(input: Obj, env: EnvStudio): Promise<ResultatOutil> {
  const uid = env.userId!;
  const t = await env.depot.travail(uid, estUuid(input.job_id) ? { id: input.job_id } : { conversationId: env.conversationId });
  if (!t) return erreur('Aucun rendu trouvé' + (input.job_id ? ' pour cet identifiant.' : ' dans cette conversation.'), 'not_found');
  const maintenant = (env.maintenant ?? Date.now)();
  const data: Obj = { ...vueTravail(t), statut_libelle: LIBELLES_STATUT[t.statut] ?? t.statut };
  if (t.statut === 'en_attente') {
    const [pos, stats] = await Promise.all([env.depot.positionFile(t.cree_le), env.depot.statsFile()]);
    data.position_file = pos;
    data.attente_depuis_min = Math.max(0, Math.round((maintenant - Date.parse(t.cree_le)) / 60_000));
    data.machine = etatMachine(stats, maintenant).phrase;
  }
  const omis = Array.isArray(t.elements_omis) ? t.elements_omis.filter(estObj).map((e) => txt(e.categorie, 80)).filter(Boolean) : [];
  if (omis.length) data.elements_omis = omis;
  if (t.statut === 'termine' && estObj(t.resultat)) {
    const r = t.resultat;
    const liens: Obj = {};
    if (t.type === 'film' && typeof r.video_path === 'string') {
      liens.video = await env.depot.urlSigneeRendu(r.video_path, 3600);
      if (typeof r.poster_path === 'string') liens.affiche = await env.depot.urlSigneeRendu(r.poster_path, 3600);
    } else if (t.type === 'image') {
      const images = Array.isArray(r.images) ? r.images.filter(estObj) : [];
      const chemins = images.length ? images.map((i) => i.jpeg_path).filter((x): x is string => typeof x === 'string') : typeof r.image_path === 'string' ? [r.image_path] : [];
      liens.images = (await Promise.all(chemins.slice(0, 3).map((c) => env.depot.urlSigneeRendu(c, 3600)))).filter(Boolean);
    } else if (t.type === 'visite360' && typeof r.visite_id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(r.visite_id)) {
      liens.visite = `${env.origine.replace(/\/+$/, '')}/visite/${encodeURIComponent(r.visite_id)}`;
    }
    data.liens = liens;
    data.liens_valables = 'URL signées valables 1 h (rappelle l’outil pour en obtenir de nouvelles) ; la visite 360° a un lien public permanent.';
    if (Array.isArray(r.avertissements)) data.avertissements = r.avertissements.filter((a) => typeof a === 'string').slice(0, 6);
  }
  return {
    status: 'ok', source: SOURCE_STUDIO, data,
    message: 'Statut lu en base (écrit par la machine de rendu). Rapporte-le tel quel ; n’invente ni progression ni délai.',
  };
}

// =============================================================
// 7. Implémentation Supabase
// =============================================================

// deno-lint-ignore no-explicit-any
type ClientSb = any;

const COLONNES_TRAVAIL = 'id,conversation_id,type,statut,progression,etape,resultat,elements_omis,erreur,cree_le,demarre_le,termine_le';
const COLONNES_PREP = 'id,conception_id,conversation_id,idu,empreinte,entree,volume,resume,cree_le';

function lever(e: { message?: string; code?: string; details?: string } | null): void {
  if (e) throw new Error(`${e.message ?? 'erreur'}${e.code ? ` (${e.code})` : ''}${e.details ? ` ${e.details}` : ''}`);
}

/**
 * `utilisateur` : client au JWT de l'utilisateur (RLS) — lectures et écritures de SES données (chat).
 * `admin` : service_role — statistiques anonymes de la file et sonde du type « image » ; en mission
 * (pas de JWT), il sert aussi aux lectures/écritures, toujours filtrées par user_id explicite.
 */
export function depotStudioSupabase(admin: ClientSb, utilisateur: ClientSb | null): DepotStudio {
  const db = utilisateur ?? admin;
  return {
    async conception(userId, q) {
      let r = db.from('agent_conceptions').select('id,idu,commune,parcelle,regles_plu,programme,maj_le').eq('user_id', userId).neq('statut', 'archive');
      if (q.id) r = r.eq('id', q.id);
      else if (q.idu) r = r.eq('idu', q.idu);
      const { data, error } = await r.order('maj_le', { ascending: false }).limit(1);
      lever(error);
      return (data?.[0] ?? null) as ConceptionLue | null;
    },
    async derniereVersion(userId, conceptionId) {
      const { data, error } = await db.from('agent_conception_versions').select('n,modele_ref').eq('user_id', userId).eq('conception_id', conceptionId).order('n', { ascending: false }).limit(1);
      lever(error);
      const v = data?.[0];
      return v && typeof v.modele_ref === 'string' && v.modele_ref ? { n: Number(v.n), modele_ref: v.modele_ref } : null;
    },
    async enregistrerPreparation(userId, l) {
      const { data, error } = await db.from('studio_preparations').upsert({ ...l, user_id: userId }, { onConflict: 'user_id,empreinte', ignoreDuplicates: false }).select('id').single();
      lever(error);
      return String(data.id);
    },
    async preparation(userId, q) {
      let r = db.from('studio_preparations').select(COLONNES_PREP).eq('user_id', userId);
      if (q.id) r = r.eq('id', q.id);
      else if (q.conceptionId) r = r.eq('conception_id', q.conceptionId);
      else if (q.conversationId) r = r.eq('conversation_id', q.conversationId);
      else return null;
      const { data, error } = await r.order('cree_le', { ascending: false }).limit(1);
      lever(error);
      return (data?.[0] ?? null) as PreparationLue | null;
    },
    async typeRenduAutorise(type, options) {
      try {
        const { data, error } = await admin.rpc('_studio_job_options_valides', { p_type: type, p_options: options });
        return error ? null : data === true;
      } catch { return null; }
    },
    async statsFile() {
      try {
        const [att, enc, act] = await Promise.all([
          admin.from('studio_jobs').select('cree_le', { count: 'exact' }).eq('statut', 'en_attente').order('cree_le', { ascending: true }).limit(1),
          admin.from('studio_jobs').select('id', { count: 'exact', head: true }).eq('statut', 'en_cours'),
          admin.from('studio_jobs').select('maj_le').not('worker_id', 'is', null).order('maj_le', { ascending: false }).limit(1),
        ]);
        if (att.error || enc.error || act.error) return null;
        return { attente: att.count ?? 0, plusAncienneAttente: att.data?.[0]?.cree_le ?? null, enCours: enc.count ?? 0, derniereActivite: act.data?.[0]?.maj_le ?? null };
      } catch { return null; }
    },
    async travauxActifs(userId) {
      const { count, error } = await db.from('studio_jobs').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('statut', ['en_attente', 'en_cours']);
      lever(error);
      return count ?? 0;
    },
    async travailParDevis(userId, devisId) {
      const { data, error } = await db.from('studio_jobs').select(COLONNES_TRAVAIL).eq('user_id', userId).eq('fiche->>devis_id', devisId).limit(1);
      lever(error);
      return (data?.[0] ?? null) as TravailLu | null;
    },
    async insererTravail(userId, l) {
      if (!utilisateur) throw new Error('Insertion de travail refusée sans session utilisateur.');
      const { data, error } = await utilisateur.from('studio_jobs').insert({ ...l, user_id: userId }).select(COLONNES_TRAVAIL).single();
      lever(error);
      return data as TravailLu;
    },
    async travail(userId, q) {
      let r = db.from('studio_jobs').select(COLONNES_TRAVAIL).eq('user_id', userId);
      if (q.id) r = r.eq('id', q.id);
      else if (q.conversationId) r = r.eq('conversation_id', q.conversationId);
      else return null;
      const { data, error } = await r.order('cree_le', { ascending: false }).limit(1);
      lever(error);
      return (data?.[0] ?? null) as TravailLu | null;
    },
    async positionFile(creeLe) {
      const { count, error } = await admin.from('studio_jobs').select('id', { count: 'exact', head: true }).eq('statut', 'en_attente').lt('cree_le', creeLe);
      return error ? null : (count ?? 0);
    },
    async urlSigneeRendu(chemin, secondes) {
      const { data, error } = await db.storage.from('studio-rendus').createSignedUrl(chemin, secondes);
      return error ? null : (data?.signedUrl ?? null);
    },
  };
}
