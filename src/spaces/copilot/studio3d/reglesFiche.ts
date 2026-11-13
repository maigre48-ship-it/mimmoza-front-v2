// src/spaces/copilot/studio3d/reglesFiche.ts
//
// LOT P9 (13/11/2026) — RÈGLES PLU DE LA CONCEPTION → `charge.regles` de la fiche du travail (contrat
// mimmoza-projet-v2, RegleV2). Logique PURE. Avant ce lot, `charge.regles` était toujours VIDE alors que le volume
// d'étude disait « Règles PLU appliquées ».
//
// Clés lues côté Studio (mimmozia-studio, lu le 13/11, non modifié) :
//   · echangeMimmoza.ts : catégories `voirie` → setback-road, `separative` → setback-separating, `fond` → setback-rear
//     (TYPE_RETRAIT) ; provenance `document` → contrainte « interpreted », sinon « assumed » ;
//   · contrat v2 : provenance parmi document | saisie | ia | defaut | inconnue. Règle ESTIMÉE (ex. prescription GPU lue
//     automatiquement par le copilote, non lue dans le règlement) → « ia » : le Studio l'affiche « lecture automatique,
//     à vérifier » et pose une contrainte « assumed » (décision d'Albé, 13/11/2026) ;
//   · worker implantationVoie.reculVoieDesRegles : champ /recul.*(voi|rue|alignement)/ ou catégorie setback-road ;
//   · les autres catégories (hauteur, emprise, pleine-terre, niveaux) sont TRANSPORTÉES et conservées par le Studio
//     (projetDepuisStudio garde les règles qu'il ne représente pas) mais pas encore converties en contraintes.
// Chaque règle garde sa source et son statut : « lue dans le règlement » (confirme) ou « estimée, non lue dans le
// règlement » (estime, ex. prescriptions GPU). Les règles « manquant », non chiffrées ou hors bornes ne sont PAS
// transmises (jamais une valeur inventée ; une valeur SUPPOSÉE par le volume d'étude n'est pas une règle).

import type { RegleV2 } from '../../promoteur/shared/echangeStudio/mimmozaProjetV2.ts';
import type { RegleLue } from './controlesVolume.ts';

interface Correspondance { id: string; champ: string; categorie: string; unite: string; min: number; max: number }

export const CORRESPONDANCE_REGLES_FICHE: Readonly<Record<string, Correspondance>> = {
  recul_voie_m: { id: 'recul-voirie', champ: 'reculs.voirie.min_m', categorie: 'voirie', unite: 'm', min: 0, max: 50 },
  recul_limites_m: { id: 'recul-separative', champ: 'reculs.separatives.min_m', categorie: 'separative', unite: 'm', min: 0, max: 50 },
  hauteur_max_m: { id: 'hauteur-max', champ: 'hauteur.max_m', categorie: 'hauteur', unite: 'm', min: 0.01, max: 200 },
  niveaux_max: { id: 'niveaux-max', champ: 'hauteur.niveaux_max', categorie: 'niveaux', unite: 'niveaux', min: 1, max: 80 },
  emprise_sol_max_pct: { id: 'emprise-sol-max', champ: 'emprise_sol.max_pct', categorie: 'emprise', unite: '%', min: 0.01, max: 100 },
  pleine_terre_min_pct: { id: 'pleine-terre-min', champ: 'pleine_terre.min_pct', categorie: 'pleine-terre', unite: '%', min: 0.01, max: 99.99 },
};

/** Décision d'Albé (13/11/2026, prudence) : la hauteur maximale transmise se compte ACROTÈRE COMPRIS. */
export const PRECISION_HAUTEUR_FICHE = 'hauteur comptée acrotère compris (prudence ; mode de calcul du règlement non lu)';

export const STATUT_REGLE_FICHE = { confirme: 'lue dans le règlement', estime: 'estimée, non lue dans le règlement' } as const;

const coupe = (t: string | null | undefined, n: number): string | null => (typeof t === 'string' && t.trim() ? t.trim().slice(0, n) : null);

/** RegleLue[] (conception) → RegleV2[] (fiche). Une règle par clé : la plus contraignante (recul : la plus forte ; plafonds : la plus basse ; pleine terre : la plus forte). */
export function reglesFicheDepuisReglesLues(regles: readonly RegleLue[] | null | undefined): RegleV2[] {
  const parId = new Map<string, { r: RegleLue; v: number; c: Correspondance }>();
  for (const r of regles ?? []) {
    const c = r ? CORRESPONDANCE_REGLES_FICHE[r.cle] : undefined;
    if (!c || (r.statut !== 'confirme' && r.statut !== 'estime')) continue;
    const v = r.valeur;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < c.min || v > c.max) continue;
    if (r.nature === 'non_reglementee') continue;
    const avant = parId.get(c.id);
    const plusForte = r.cle.startsWith('recul') || r.cle === 'pleine_terre_min_pct';
    if (!avant || (plusForte ? v > avant.v : v < avant.v)) parId.set(c.id, { r, v, c });
  }
  return [...parId.values()].map(({ r, v, c }): RegleV2 => ({
    id: c.id,
    champ: c.champ,
    categorie: c.categorie,
    valeur: v,
    unite: c.unite,
    zone: null,
    source: {
      documentId: null,
      intitule: `${(r.source || 'source inconnue').trim()} — ${STATUT_REGLE_FICHE[r.statut as 'confirme' | 'estime']}${c.id === 'hauteur-max' ? ` — ${PRECISION_HAUTEUR_FICHE}` : ''}`.slice(0, 300),
      article: coupe(r.article, 120),
      extrait: coupe(r.texte, 600),
      page: null,
      date: null,
    },
    provenance: r.statut === 'confirme' ? 'document' : 'ia',
    validation: { statut: 'non-validee', par: null, le: null },
    etat: 'ordinaire',
  })).sort((a, b) => a.id.localeCompare(b.id));
}
