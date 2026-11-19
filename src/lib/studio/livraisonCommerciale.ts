// src/lib/studio/livraisonCommerciale.ts
// =============================================================================
// VIS-10 (19/11/2026) — LIVRAISON COMMERCIALE ET RÉSULTATS ENRICHIS DE L'IMAGE (code PUR, front + Edge).
//
// Miroir, côté Mimmoza, de ce que la machine de rendu (mimmozia-studio, lots VIS-07 / VIS-INT-2) écrit et lit :
//   · option `livraison` d'un travail image (worker/src/options.ts `lireOptionsLivraison`) :
//       { active?: bool (défaut vrai), formats?: [id…] (au moins un, sans doublon), sans_mention?: bool,
//         mention?: texte non vide ≤ 120 car., credit?: texte ≤ 60 car. | null, position?: 'bas_gauche' | 'bas_droite' }
//     Absente : le worker livre par défaut un PACK en qualité finale (`livraisonDemandee`), sinon rien.
//   · `resultat.livraison_commerciale` (version 1, worker/src/livraison/index.ts) : mention, crédit, ZIP, vues ×
//     formats (chemins du seau privé `studio-rendus`), plan de vente (PDF/PNG) ou sa raison d'absence ;
//   · `resultat.rendu_mimmoza` (brief du projet : appliqué / non appliqué) ;
//   · `resultat.niveau_realisme` (« photorealiste » | « etude » | null) et `manques_realisme`.
// Rien n'est inventé : un bloc illisible est ignoré (null), jamais complété.
// Les URL signées expirent après 1 h : on ne stocke que des CHEMINS ; la signature se fait au clic (travaux.ts).
// =============================================================================

import { VUES_VIS_INT2_ACTIVES } from './catalogueVues.ts';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const textes = (v: unknown, max = 30): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string' && t.trim() !== '').slice(0, max) : []);

/** Formats de la livraison (src/core/delivery/commercial/formats.ts du Studio : NE PAS RENOMMER). */
export const FORMATS_LIVRAISON = ['original', 'web_bandeau', 'web_16_9', 'mobile_portrait', 'vignette', 'impression_a4'] as const;
export type FormatLivraison = (typeof FORMATS_LIVRAISON)[number];
export const LIBELLES_FORMAT: Readonly<Record<FormatLivraison, string>> = {
  original: 'Original',
  web_bandeau: 'Bandeau web',
  web_16_9: '16:9',
  mobile_portrait: 'Portrait mobile',
  vignette: 'Vignette',
  impression_a4: 'A4 impression',
};
const estFormat = (v: unknown): v is FormatLivraison => typeof v === 'string' && (FORMATS_LIVRAISON as readonly string[]).includes(v);

/** Option `livraison` telle qu'envoyée au worker (clés du worker, snake_case). */
export interface OptionLivraison {
  active?: boolean;
  formats?: FormatLivraison[];
  sans_mention?: boolean;
  mention?: string | null;
  credit?: string | null;
  position?: 'bas_gauche' | 'bas_droite' | null;
}

const CLES_LIVRAISON = ['active', 'formats', 'sans_mention', 'mention', 'credit', 'position'];

/** Même règle que le worker (`lireOptionsLivraison`) et que la base (`_studio_livraison_valide`). Pur. */
export function validerOptionLivraison(x: unknown): { ok: true; valeur: OptionLivraison } | { ok: false; erreur: string } {
  if (!estObj(x)) return { ok: false, erreur: 'Livraison illisible : objet attendu.' };
  const trop = Object.keys(x).find((k) => !CLES_LIVRAISON.includes(k));
  if (trop) return { ok: false, erreur: `Livraison : champ « ${trop} » inconnu.` };
  // null = absent (worker : `x['active'] ?? true`, `x['sans_mention'] ?? false`).
  if (x.active !== undefined && x.active !== null && typeof x.active !== 'boolean') return { ok: false, erreur: 'Livraison : « active » doit valoir vrai ou faux.' };
  const f = x.formats;
  if (f !== undefined && f !== null && (!Array.isArray(f) || !f.length || f.some((id) => !estFormat(id)) || new Set(f).size !== f.length)) {
    return { ok: false, erreur: `Livraison : formats connus seulement (${FORMATS_LIVRAISON.join(', ')}), au moins un, sans doublon.` };
  }
  if (x.sans_mention !== undefined && x.sans_mention !== null && typeof x.sans_mention !== 'boolean') return { ok: false, erreur: 'Livraison : « sans_mention » doit valoir vrai ou faux.' };
  const m = x.mention;
  if (m !== undefined && m !== null && (typeof m !== 'string' || !m.trim() || m.length > 120)) return { ok: false, erreur: 'Livraison : mention non vide de 120 caractères au plus (une image commerciale sort toujours avec sa mention).' };
  const c = x.credit;
  if (c !== undefined && c !== null && (typeof c !== 'string' || c.length > 60)) return { ok: false, erreur: 'Livraison : crédit de 60 caractères au plus, ou aucun.' };
  const p = x.position;
  if (p !== undefined && p !== null && p !== 'bas_gauche' && p !== 'bas_droite') return { ok: false, erreur: 'Livraison : position « bas_gauche » ou « bas_droite ».' };
  const valeur: OptionLivraison = {};
  for (const k of CLES_LIVRAISON) if (x[k] !== undefined) (valeur as Obj)[k] = k === 'formats' && Array.isArray(x[k]) ? [...(x[k] as unknown[])] : x[k];
  return { ok: true, valeur };
}

/* ───────────────────────── Résultat : livraison commerciale ───────────────────────── */

export interface FormatLivre {
  format: FormatLivraison;
  libelle: string;
  chemin: string;
  largeur: number | null;
  hauteur: number | null;
  agrandi: boolean;
  avertissements: string[];
}
export interface VueLivreeCommerciale {
  vue: string;
  libelle: string;
  centrage: 'batiment' | 'image' | null;
  formats: FormatLivre[];
}
export interface ZipLivre { chemin: string; tailleMo: number | null; vues: string[] }
export type PlanVente =
  | { present: true; lot: string; typologie: string | null; echelle: string | null; surfaceM2: number | null; surfaceIndicative: boolean; pdf: string; png: string | null; avertissements: string[] }
  | { present: false; raison: string };
export interface LivraisonCommerciale {
  mention: string | null;
  credit: string | null;
  sansMentionDansZip: boolean;
  zips: ZipLivre[];
  vues: VueLivreeCommerciale[];
  planVente: PlanVente | null;
  avertissements: string[];
}

/** Rappel affiché quand la version sans mention est dans le ZIP (texte du worker : AVERTISSEMENT_SANS_MENTION). */
export const RAPPEL_SANS_MENTION = 'Les versions sans mention ne sont que dans le ZIP : la mention « Illustration non contractuelle » doit figurer à proximité de l’image dans tout support diffusé.';

const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `resultat.livraison_commerciale` (version 1) → bloc lisible ; null si absent ou illisible. Pur. */
export function lireLivraisonCommerciale(brut: unknown): LivraisonCommerciale | null {
  if (!estObj(brut) || brut.version !== 1) return null;
  const zips: ZipLivre[] = (Array.isArray(brut.zips) ? brut.zips : []).filter(estObj).flatMap((z): ZipLivre[] => {
    const chemin = texte(z.chemin);
    return chemin ? [{ chemin, tailleMo: nombre(z.taille_mo), vues: textes(z.vues, 15) }] : [];
  }).slice(0, 16);
  const vues: VueLivreeCommerciale[] = (Array.isArray(brut.vues) ? brut.vues : []).filter(estObj).flatMap((v): VueLivreeCommerciale[] => {
    const id = texte(v.vue);
    if (!id) return [];
    const formats: FormatLivre[] = (Array.isArray(v.formats) ? v.formats : []).filter(estObj).flatMap((f): FormatLivre[] => {
      const chemin = texte(f.chemin);
      if (!chemin || !estFormat(f.format)) return [];
      return [{ format: f.format, libelle: LIBELLES_FORMAT[f.format], chemin, largeur: nombre(f.largeur), hauteur: nombre(f.hauteur), agrandi: f.agrandi === true, avertissements: textes(f.avertissements, 6) }];
    });
    return [{ vue: id, libelle: texte(v.libelle) ?? id, centrage: v.centrage === 'batiment' || v.centrage === 'image' ? v.centrage : null, formats }];
  }).slice(0, 15);
  let planVente: PlanVente | null = null;
  const p = brut.plan_vente;
  if (estObj(p)) {
    const absent = texte(p.absent);
    const pdf = texte(p.pdf_path);
    if (absent) planVente = { present: false, raison: absent };
    else if (pdf) {
      planVente = {
        present: true, lot: texte(p.lot) ?? '—', typologie: texte(p.typologie), echelle: texte(p.echelle), surfaceM2: nombre(p.surface_m2),
        surfaceIndicative: p.surface_indicative === true, pdf, png: texte(p.png_path), avertissements: textes(p.avertissements, 10),
      };
    }
  }
  return {
    mention: texte(brut.mention),
    credit: brut.credit === null ? null : texte(brut.credit),
    sansMentionDansZip: brut.sans_mention_dans_zip === true,
    zips, vues, planVente,
    avertissements: textes(brut.avertissements, 30),
  };
}

/** Nom de fichier proposé au téléchargement (dernier segment du chemin du seau, préfixé « mimmoza- »). Pur. */
export function nomTelechargement(chemin: string): string {
  const dernier = chemin.split('/').filter(Boolean).pop() ?? 'fichier';
  return dernier.startsWith('mimmoza-') ? dernier : `mimmoza-${dernier}`;
}

/* ───────────────────────── Résultat : brief du projet appliqué ───────────────────────── */

export interface RenduMimmoza {
  demande: { vues: string[]; ambiance: string | null; saison: string | null; heure: string | null };
  appliques: string[];
  nonAppliques: string[];
}

/** `resultat.rendu_mimmoza` → ce qui a été appliqué / non appliqué du brief (saison, heure…) ; null si absent. Pur. */
export function lireRenduMimmoza(brut: unknown): RenduMimmoza | null {
  if (!estObj(brut)) return null;
  const d = estObj(brut.demande) ? brut.demande : {};
  const r: RenduMimmoza = {
    demande: { vues: textes(d.vues, 15), ambiance: texte(d.ambiance), saison: texte(d.saison), heure: texte(d.heure) },
    appliques: textes(brut.appliques, 20),
    nonAppliques: textes(brut.non_appliques, 20),
  };
  return r.appliques.length || r.nonAppliques.length || r.demande.saison || r.demande.heure || r.demande.ambiance || r.demande.vues.length ? r : null;
}

/* ───────────────────────── Résultat : niveau de réalisme ───────────────────────── */

/** VIS-14 (I5) : + « non_verifie » (garde photoréalisme non relue pour ce rendu : jamais compté comme « aucun bloquant »). */
export type NiveauRealisme = 'photorealiste' | 'etude' | 'non_verifie';
export const lireNiveauRealisme = (v: unknown): NiveauRealisme | null => (v === 'photorealiste' || v === 'etude' || v === 'non_verifie' ? v : null);

/**
 * Badge de l'image : « Photoréaliste » SEULEMENT si la machine l'a établi (Lot R2) ; « Étude » sinon (avec les manques) ;
 * niveau inconnu (résultat ancien) : « Réalisme non vérifié » — jamais « photoréaliste » par défaut. Pur.
 */
export function badgeRealisme(niveau: NiveauRealisme | null, manques: readonly string[] = []): { libelle: string; ton: 'photo' | 'etude' | 'inconnu'; detail: string | null } {
  if (niveau === 'photorealiste') return { libelle: 'Photoréaliste', ton: 'photo', detail: null };
  if (niveau === 'etude') return { libelle: 'Étude', ton: 'etude', detail: manques.length ? `Image d’étude : ${manques.slice(0, 4).join(' ; ').replace(/\.$/, '')}.` : 'Image d’étude : tous les éléments ne disposent pas d’un modèle photoréaliste certifié.' };
  // VIS-14 (I5) : « non_verifie » (établi par la machine) ou niveau inconnu (résultat ancien) : même badge.
  return { libelle: 'Réalisme non vérifié', ton: 'inconnu', detail: niveau === 'non_verifie' ? 'Le contrôle photoréaliste des matières n’a pas pu être relu pour ce rendu.' : null };
}

/* ───────────── VIS-10 — livraison par défaut des images en qualité finale (décision produit du 19/11) ───────────── */

/** Option envoyée d'office : forme exacte de `lireOptionsLivraison` (worker) — `active` seul, le reste par défaut du worker. */
export const LIVRAISON_PAR_DEFAUT: Readonly<OptionLivraison> = Object.freeze({ active: true });

/**
 * Options d'un travail AU MOMENT DE L'INSERTION (chat, FilmVisitePanel, Voir en 3D, atelier) :
 *   · image en qualité finale (`qualite` absente = finale, défaut du worker) ⇒ `livraison: { active: true }` ajoutée
 *     si l'appelant n'en a pas donné (une option explicite valide est gardée telle quelle) ;
 *   · image en aperçu, film, visite, plans seuls ⇒ options rendues telles quelles (aucune clé ajoutée) ;
 *   · drapeau de repli `VUES_VIS_INT2_ACTIVES` à false ⇒ AUCUNE clé `livraison` envoyée (retirée si présente) :
 *     comportement d'avant VIS-10.
 * Ne modifie jamais l'objet reçu. Pur.
 */
export function avecLivraisonParDefaut<T extends Obj>(type: unknown, options: T, opts: { actif?: boolean; plansSeuls?: boolean } = {}): T {
  const actif = opts.actif ?? VUES_VIS_INT2_ACTIVES;
  if (type !== 'image' || !estObj(options)) return options;
  if (!actif) {
    if (!('livraison' in options)) return options;
    const { livraison: _retiree, ...sans } = options;
    return sans as T;
  }
  if (opts.plansSeuls || options.livraison !== undefined) return options;
  const qualite = options.qualite ?? 'finale';
  if (qualite !== 'finale') return options;
  return { ...options, livraison: { ...LIVRAISON_PAR_DEFAUT } };
}
