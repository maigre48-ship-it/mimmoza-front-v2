// src/spaces/copilot/agent/conception/reglesAffichage.ts
// =============================================================================
// LOT A — Finition du rapport de conception : AFFICHAGE des règles (carte
// « Règles prêtes »). Logique PURE, testée par reglesAffichage.test.ts (node --test).
//
// Le moteur de mission (supabase/functions/copilot-chat/agent/conception.ts)
// corrige désormais les règles à la source. Ce module applique les MÊMES gardes à
// l'affichage, pour les rapports DÉJÀ stockés (mission du 05/11/2026 sur la
// parcelle 92050000AE0414 notamment) :
//   1. « Règle de recul aux limites (formule) : non réglementée » alors que le même
//      article fixe le recul aux limites (8 m avec baie / 3 m sans baie) → « voir
//      recul aux limites séparatives » ;
//   2. « non réglementée » soutenue par un article d'un AUTRE sujet (part de
//      logements sociaux « non réglementée » citée dans l'article UC 12 du
//      stationnement) → règle inconnue, « non trouvée dans les articles lus » ;
//   4. accord : « 1 place/logement », « 1,1 places/logement ».
// Les mots-clés de sujet sont la COPIE de ceux du serveur (MOTS_SUJET) : le test
// de parité de reglesAffichage.test.ts compare les deux sur les mêmes textes.
// Rien n'est inventé : aucune valeur n'est créée, une règle douteuse devient inconnue.
// =============================================================================
import { LIBELLE_REGLE, type RegleCle, type RegleConception } from '../../../promoteur/shared/echangeStudio/conception.ts';

export type SujetRegle = 'hauteur' | 'emprise' | 'voie' | 'limites' | 'espaces_verts' | 'stationnement' | 'mixite';

/** COPIE de MOTS_SUJET (serveur, conception.ts) — texte sans accents, en minuscules. */
export const MOTS_SUJET: Readonly<Record<SujetRegle, RegExp>> = {
  hauteur: /hauteur|acrotere|egout|faitage|gabarit|\bniveaux?\b|\betages?\b|\br\s*\+\s*\d/,
  emprise: /emprise au sol|emprise des constructions|\bces\b|coefficient d.emprise/,
  voie: /\bvoies?\b|alignement|emprises? publiques?/,
  limites: /limites? separatives?|\blimites?\b|fonds? voisins?|\bretraits?\b|prospect|\bbaies?\b/,
  espaces_verts: /pleine terre|espaces? verts?|espaces? libres?|plantation|plante|vegeta|biotope|permeab|\barbres?\b/,
  stationnement: /stationnement|\bplaces?\b|parking|garages?|\bvelos?\b|vehicules?|deux.roues/,
  mixite: /logements? (?:locatifs? )?sociaux|logement (?:locatif )?social|mixite|\blls\b|servitude de mixite|pourcentage de logements|l\.?\s*151-15\b|\bplai\b|logements? aides?/,
};

export const SUJET_DE_CLE: Readonly<Record<RegleCle, SujetRegle>> = {
  hauteur_max_m: 'hauteur', niveaux_max: 'hauteur', emprise_sol_max_pct: 'emprise', recul_voie_m: 'voie',
  recul_limites_m: 'limites', recul_limites_formule: 'limites', pleine_terre_min_pct: 'espaces_verts',
  stationnement_par_logement: 'stationnement', mixite_sociale_pct: 'mixite',
};
const SUJETS_EXCLUANTS: Partial<Record<RegleCle, SujetRegle[]>> = { mixite_sociale_pct: ['stationnement'] };
const SUJET_EXPLICITE_REQUIS: ReadonlySet<RegleCle> = new Set(['mixite_sociale_pct']);

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** 'traite' : la citation parle du sujet ; 'autre_sujet' : d'autre chose ; 'neutre' : aucun sujet nommé. */
export function sujetCitation(cle: RegleCle, citation: string | null | undefined, titre?: string | null): 'traite' | 'autre_sujet' | 'neutre' {
  const t = sansAccents(`${titre ?? ''} ${citation ?? ''}`);
  const propre = SUJET_DE_CLE[cle];
  const exclu = (SUJETS_EXCLUANTS[cle] ?? []).some((s) => MOTS_SUJET[s].test(t));
  if (MOTS_SUJET[propre].test(t) && !exclu) return 'traite';
  if (exclu || (Object.keys(MOTS_SUJET) as SujetRegle[]).some((s) => s !== propre && MOTS_SUJET[s].test(t))) return 'autre_sujet';
  return 'neutre';
}

export const nonReglementeeAdmise = (cle: RegleCle, citation: string | null | undefined, titre?: string | null): boolean => {
  const v = sujetCitation(cle, citation, titre);
  return v === 'traite' || (v === 'neutre' && !SUJET_EXPLICITE_REQUIS.has(cle));
};

export const TEXTE_NON_TROUVEE = 'non trouvée dans les articles lus';
export const TEXTE_VOIR_RECUL = 'voir recul aux limites séparatives';

/** Article principal : « UC 7-3, p. 107 » → « UC 7 ». */
function articlePrincipal(a: string | undefined): string | null {
  const m = /^\s*(?:art(?:icle)?\.?\s*)?([a-z]{1,4})\s*(\d{1,2})(?!\d)/i.exec(a ?? '');
  return m ? `${m[1].toUpperCase()} ${m[2]}` : null;
}

/**
 * Règles telles qu'affichées : « non réglementée » d'un autre sujet → inconnue ;
 * formule « non réglementée » alors que le même article chiffre le recul → « voir recul ».
 * Les autres règles sont renvoyées telles quelles (même objet).
 */
export function harmoniserReglesAffichees(regles: readonly RegleConception[]): RegleConception[] {
  const out = regles.map((r): RegleConception => {
    if (r.nature !== 'non_reglementee' || nonReglementeeAdmise(r.cle, r.texte)) return r;
    return {
      cle: r.cle, valeur: null, unite: r.unite, statut: 'manquant', source: r.source,
      texte: `${TEXTE_NON_TROUVEE} (« non réglementée » écartée : l'article ${r.article ?? ''} cité ne porte pas sur ce sujet)`,
    };
  });
  const iF = out.findIndex((r) => r.cle === 'recul_limites_formule');
  const l = out.find((r) => r.cle === 'recul_limites_m');
  if (iF < 0 || !l) return out;
  const f = out[iF];
  if (f.nature !== 'non_reglementee' || !l.article || l.nature === 'non_reglementee') return out;
  const art = articlePrincipal(l.article);
  if (!art || art !== articlePrincipal(f.article)) return out;
  const connu = l.valeur != null && l.statut !== 'manquant';
  if (!connu && !(l.nature === 'par_secteur' && l.valeur == null)) return out;
  out[iF] = connu
    ? { cle: f.cle, valeur: TEXTE_VOIR_RECUL, unite: '', statut: l.statut, source: l.source, article: l.article }
    : { cle: f.cle, valeur: null, unite: '', statut: 'manquant', source: l.source, texte: `${TEXTE_VOIR_RECUL} (${l.article}) : selon le secteur, à préciser` };
  return out;
}

/** Libellés des règles devenues inconnues à l'affichage (à ajouter à « Encore inconnues »). */
export function nouvellesInconnues(avant: readonly RegleConception[], apres: readonly RegleConception[]): string[] {
  return apres.filter((r, i) => r.statut === 'manquant' && avant[i]?.statut !== 'manquant').map((r) => LIBELLE_REGLE[r.cle].libelle);
}

const fr = (v: number | string) => String(v).replace('.', ',');

/** Accord de l'unité : « 1 place/logement », « 1,1 places/logement », « 1 niveau » (pluriel au-delà de 1). */
export function accorderUnite(v: number | string, unite: string): string {
  if (typeof v !== 'number' || Math.abs(v) > 1) return unite;
  return unite.replace(/^places\b/, 'place').replace(/^niveaux\b/, 'niveau').replace(/^logements\b/, 'logement');
}

/** « 1 place/logement » ; formule (texte) : sans unité (jamais « H/2 min 3 m formule »). */
export function valeurAvecUnite(v: number | string, unite: string, cle?: RegleCle): string {
  if (cle === 'recul_limites_formule' || typeof v === 'string' || !unite) return fr(v);
  return `${fr(v)} ${accorderUnite(v, unite)}`;
}

/** Valeur affichée d'une règle connue : « non réglementée » (lot Q1) ou valeur et unité accordée. */
export function valeurAffichee(r: RegleConception): string {
  if (r.nature === 'non_reglementee') return 'non réglementée';
  const base = valeurAvecUnite(r.valeur ?? '', r.unite, r.cle);
  if (r.nature !== 'par_secteur' || !r.secteur) return base;
  // Lot Q1 : mesure retenue (acrotère / égout / la plus restrictive) et réserve de la règle relative.
  return `${base} (secteur ${r.secteur}${r.mesure_retenue ? ` — ${r.mesure_retenue}` : ''})${r.regle_relative ? `, sous réserve de « ${r.regle_relative} »` : ''}`;
}

/** Détail cité d'un secteur : « acrotère 21 m, égout 21 m, faîtage 24 m » ; « 1 place/logement ». */
export function detailSecteurAffiche(e: NonNullable<RegleConception['valeurs_par_secteur']>[number], unite: string): string {
  const m = ([['acrotère', e.acrotere_terrasse], ['égout', e.egout], ['faîtage', e.faitage]] as const).filter(([, v]) => typeof v === 'number');
  const f = (v: number | string) => (unite ? `${fr(v)} ${accorderUnite(v, unite)}` : fr(v));
  return (m.length ? m.map(([n, v]) => `${n} ${f(v as number)}`).join(', ') : f(e.valeur)) + (e.exceptions ? ` ; exception non retenue : ${e.exceptions}` : '');
}
