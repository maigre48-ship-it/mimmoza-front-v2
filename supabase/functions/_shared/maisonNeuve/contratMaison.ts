// supabase/functions/_shared/maisonNeuve/contratMaison.ts
// =============================================================================
// LOT G10b (18/11/2026) — CONTRAT « projet de maison neuve » échangé entre le site (parcours du chat) et la machine
// de rendu (Studio). MÊME FICHIER des deux côtés (site : _shared/maisonNeuve/contratMaison.ts ; Studio :
// src/core/maisonNeuve/contratMaison.ts) : aucune dépendance, aucune I/O, aucun LLM.
//
// Le site calcule le gabarit (gabaritMaison.ts : emprise, reculs mesurés, hauteurs, toit) ; ce contrat le transporte
// TEL QUEL dans `fiche.projet_maison` du travail de rendu. La machine de rendu construit LA maison décrite (bâtiment
// du contrat v2, pose exacte contrôlée à 5 cm), refuse toute image de synthèse (photo réelle calée obligatoire) et
// dessine les plans depuis le modèle rendu (même empreinte de scène que l'image).
// Chaque valeur porte son statut (mesurée / estimée / supposée / confirmée) et sa source : rien n'est inventé.
// =============================================================================

export const FORMAT_PROJET_MAISON = 'mimmoza-projet-maison' as const;
export const VERSION_PROJET_MAISON = 1 as const;

export type StatutMaison = 'mesuree' | 'estimee' | 'supposee' | 'confirmee';
export interface DonneeMaison<T> { readonly valeur: T; readonly statut: StatutMaison; readonly source: string }

export type ToitMaison = 'deux-pans' | 'quatre-pans' | 'plat' | 'monopente';
export type CouvertureMaison = 'tuiles' | 'ardoise' | 'zinc';
export type MenuiseriesMaisonContrat = 'anthracite' | 'blanc' | 'bois';
export type CategorieLimiteMaison = 'voie' | 'separative' | 'fond' | null;

export interface ReculMaisonContrat {
  readonly limite: number;
  readonly categorie: CategorieLimiteMaison;
  readonly requisM: number;
  readonly statut: StatutMaison;
  readonly source: string;
  /** Distance mesurée entre la maison et la limite (m, au mm). */
  readonly mesureM: number;
}

export interface ProjetMaison {
  readonly format: typeof FORMAT_PROJET_MAISON;
  readonly version: typeof VERSION_PROJET_MAISON;
  readonly idu: string;
  readonly commune: string | null;
  /** Date du calcul (AAAA-MM-JJ). */
  readonly date: string;
  readonly parcelle: {
    /** Contour cadastral (WGS 84, [lon, lat], anneau ouvert). */
    readonly contourWgs84: readonly (readonly [number, number])[];
    readonly surfaceM2: number | null;
    /** Origine du repère de calcul (Lambert-93) et contour dans ce repère (x = est, z = sud, m). */
    readonly origineL93: readonly [number, number];
    readonly contourScene: readonly { readonly x: number; readonly z: number }[];
    readonly categories: readonly CategorieLimiteMaison[];
  };
  /** Limites sur rue (WGS 84) utilisées pour classer les limites ; [] si aucune. */
  readonly facadesVoie: readonly { readonly debut: readonly [number, number]; readonly fin: readonly [number, number] }[];
  readonly maison: {
    /** Rectangle au sol dans le repère de calcul (4 coins, sens du gabarit). */
    readonly coinsScene: readonly { readonly x: number; readonly z: number }[];
    readonly centreWgs84: { readonly lon: number; readonly lat: number };
    /** Rotation au sens du contrat v2 (x = est, y = sud, 0° = longueur à l'est), en degrés. */
    readonly rotationDeg: number;
    /** Grand côté (m) et petit côté (m). */
    readonly longueurM: number;
    readonly largeurM: number;
    readonly empriseM2: number;
    readonly niveaux: DonneeMaison<1 | 2>;
    readonly egoutM: DonneeMaison<number>;
    readonly faitageM: DonneeMaison<number>;
    readonly toit: DonneeMaison<ToitMaison>;
    readonly penteDeg: DonneeMaison<number>;
    readonly surfaceHabitableM2: DonneeMaison<number>;
    readonly surfacePlancherM2: DonneeMaison<number>;
    readonly surfacePlancherFourchette: readonly [number, number];
    readonly facadeSurRue: boolean;
    readonly reculs: readonly ReculMaisonContrat[];
  };
  readonly habillage: {
    readonly couverture: DonneeMaison<CouvertureMaison> | null;
    readonly menuiseries: DonneeMaison<MenuiseriesMaisonContrat>;
    /** Façades : enduit clair (convention Mimmoza, dite) — le parcours ne propose pas encore d'autre matière. */
    readonly facade: DonneeMaison<'enduit_clair'>;
    readonly style: DonneeMaison<'traditionnel' | 'contemporain'> | null;
  };
  readonly autorisation: { readonly regime: 'PC'; readonly architecte: 'obligatoire' | 'non-obligatoire' | 'a-confirmer'; readonly delaiMois: number };
  readonly hypotheses: readonly string[];
}

export type LectureProjetMaison = { readonly ok: true; readonly projet: ProjetMaison } | { readonly ok: false; readonly erreurs: readonly string[] };

type Brut = Record<string, unknown>;
const estObj = (v: unknown): v is Brut => typeof v === 'object' && v !== null && !Array.isArray(v);
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const STATUTS: readonly StatutMaison[] = ['mesuree', 'estimee', 'supposee', 'confirmee'];
const RE_IDU = /^(2[AB]\d{3}|\d{5})\d{3}[0-9A-Z]{2}\d{4}$/;

function donnee<T>(v: unknown, ok: (x: unknown) => x is T, chemin: string, err: string[]): DonneeMaison<T> | null {
  if (!estObj(v) || !ok(v.valeur) || !STATUTS.includes(v.statut as StatutMaison) || typeof v.source !== 'string' || !v.source.trim()) {
    err.push(`${chemin} : valeur, statut ou source manquant`);
    return null;
  }
  return { valeur: v.valeur, statut: v.statut as StatutMaison, source: v.source.slice(0, 300) };
}

const entre = (a: number, b: number) => (x: unknown): x is number => fini(x) && x >= a && x <= b;
const parmi = <T extends string>(l: readonly T[]) => (x: unknown): x is T => typeof x === 'string' && (l as readonly string[]).includes(x);
const pt = (p: unknown): p is { x: number; z: number } => estObj(p) && fini(p.x) && fini(p.z) && Math.abs(p.x) < 5000 && Math.abs(p.z) < 5000;
const lonlat = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && fini(p[0]) && fini(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/**
 * Validation stricte (même code au site et au Studio). Tout champ manquant ou hors bornes refuse le projet ENTIER :
 * jamais une maison rendue à partir d'un contrat partiel. Pur.
 */
export function lireProjetMaison(v: unknown): LectureProjetMaison {
  const err: string[] = [];
  if (!estObj(v) || v.format !== FORMAT_PROJET_MAISON || v.version !== VERSION_PROJET_MAISON) return { ok: false, erreurs: ['format ou version du projet de maison inconnu'] };
  if (typeof v.idu !== 'string' || !RE_IDU.test(v.idu)) err.push('idu invalide');
  if (typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) err.push('date invalide');
  const p = v.parcelle;
  if (!estObj(p) || !Array.isArray(p.contourWgs84) || p.contourWgs84.length < 3 || p.contourWgs84.length > 200 || !p.contourWgs84.every(lonlat)) err.push('contour de parcelle invalide');
  if (!estObj(p) || !Array.isArray(p.origineL93) || p.origineL93.length !== 2 || !p.origineL93.every(fini)) err.push('origine Lambert-93 invalide');
  if (!estObj(p) || !Array.isArray(p.contourScene) || !p.contourScene.every(pt) || p.contourScene.length !== (Array.isArray(p.contourWgs84) ? p.contourWgs84.length : -1)) err.push('contour de calcul invalide');
  if (!estObj(p) || !Array.isArray(p.categories) || p.categories.length !== (Array.isArray(p.contourScene) ? p.contourScene.length : -1)
    || !p.categories.every((c) => c === null || c === 'voie' || c === 'separative' || c === 'fond')) err.push('catégories des limites invalides');
  if (!Array.isArray(v.facadesVoie) || v.facadesVoie.length > 50 || !v.facadesVoie.every((f) => estObj(f) && lonlat(f.debut) && lonlat(f.fin))) err.push('limites sur rue invalides');
  const m = v.maison;
  if (!estObj(m)) err.push('maison absente');
  else {
    if (!Array.isArray(m.coinsScene) || m.coinsScene.length !== 4 || !m.coinsScene.every(pt)) err.push('coins de la maison invalides');
    if (!estObj(m.centreWgs84) || !lonlat([m.centreWgs84.lon, m.centreWgs84.lat])) err.push('centre de la maison invalide');
    if (!entre(-360, 360)(m.rotationDeg)) err.push('rotation invalide');
    if (!entre(3, 40)(m.longueurM) || !entre(3, 40)(m.largeurM) || (fini(m.longueurM) && fini(m.largeurM) && m.largeurM > m.longueurM + 1e-6)) err.push('dimensions de la maison invalides');
    if (!entre(9, 1600)(m.empriseM2)) err.push('emprise invalide');
    donnee(m.niveaux, (x): x is 1 | 2 => x === 1 || x === 2, 'niveaux', err);
    donnee(m.egoutM, entre(2, 12), 'egoutM', err);
    donnee(m.faitageM, entre(2, 18), 'faitageM', err);
    donnee(m.toit, parmi(['deux-pans', 'quatre-pans', 'plat', 'monopente'] as const), 'toit', err);
    donnee(m.penteDeg, entre(0, 60), 'penteDeg', err);
    donnee(m.surfaceHabitableM2, entre(20, 600), 'surfaceHabitableM2', err);
    donnee(m.surfacePlancherM2, entre(20, 800), 'surfacePlancherM2', err);
    if (!Array.isArray(m.surfacePlancherFourchette) || m.surfacePlancherFourchette.length !== 2 || !m.surfacePlancherFourchette.every(fini)) err.push('fourchette de surface de plancher invalide');
    if (typeof m.facadeSurRue !== 'boolean') err.push('façade sur rue invalide');
    if (!Array.isArray(m.reculs) || m.reculs.length > 200 || !m.reculs.every((r) => estObj(r) && Number.isInteger(r.limite) && fini(r.requisM) && fini(r.mesureM)
      && STATUTS.includes(r.statut as StatutMaison) && typeof r.source === 'string' && (r.categorie === null || r.categorie === 'voie' || r.categorie === 'separative' || r.categorie === 'fond'))) err.push('reculs invalides');
    else if (m.reculs.some((r) => Number((r as Brut).mesureM) + 0.005 < Number((r as Brut).requisM))) err.push('un recul mesuré est inférieur au recul requis : maison non placée');
  }
  const h = v.habillage;
  if (!estObj(h)) err.push('habillage absent');
  else {
    if (h.couverture !== null) donnee(h.couverture, parmi(['tuiles', 'ardoise', 'zinc'] as const), 'couverture', err);
    donnee(h.menuiseries, parmi(['anthracite', 'blanc', 'bois'] as const), 'menuiseries', err);
    donnee(h.facade, parmi(['enduit_clair'] as const), 'facade', err);
    if (h.style !== null) donnee(h.style, parmi(['traditionnel', 'contemporain'] as const), 'style', err);
  }
  const a = v.autorisation;
  if (!estObj(a) || a.regime !== 'PC' || !['obligatoire', 'non-obligatoire', 'a-confirmer'].includes(a.architecte as string) || !entre(1, 6)(a.delaiMois)) err.push('autorisation invalide');
  if (!Array.isArray(v.hypotheses) || v.hypotheses.length > 30 || !v.hypotheses.every((x) => typeof x === 'string')) err.push('hypothèses invalides');
  if (estObj(m) && estObj(m.toit) && m.toit.valeur !== 'plat' && estObj(h) && h.couverture === null) err.push('couverture absente pour un toit en pente');
  return err.length ? { ok: false, erreurs: err } : { ok: true, projet: v as unknown as ProjetMaison };
}

/** Bâtiment du contrat v2 (`batiments`) décrivant CETTE maison : la machine de rendu la pose et contrôle la pose (5 cm). Pur. */
export function batimentV2Maison(p: ProjetMaison): {
  id: string; nom: string; nature: 'estime'; centre: { lon: number; lat: number }; rotationDeg: number; largeurM: number; profondeurM: number;
  niveaux: number; hauteurM: number; niveauEntree: { relatifTerrainM: number; coteM: null }; ailes: never[]; emprise: number[][][];
  refs: { front: string; studio: null };
} {
  const m = p.maison;
  const r9 = (x: number): number => Math.round(x * 1e9) / 1e9;
  return {
    id: 'mz-maison-1',
    nom: 'Maison',
    nature: 'estime',
    centre: { lon: r9(m.centreWgs84.lon), lat: r9(m.centreWgs84.lat) },
    rotationDeg: Math.round(m.rotationDeg * 10) / 10,
    largeurM: Math.round(m.longueurM * 100) / 100,
    profondeurM: Math.round(m.largeurM * 100) / 100,
    niveaux: m.niveaux.valeur,
    hauteurM: Math.round(m.faitageM.valeur * 100) / 100,
    niveauEntree: { relatifTerrainM: 0, coteM: null },
    ailes: [],
    emprise: [],
    refs: { front: 'mz-maison-1', studio: null },
  };
}

/**
 * Clauses de création lues par le Studio (nl.ts : roofOf, matières de création) — courtes, sans chiffre ni virgule
 * (même liste fermée que `habillage_batiments.clauses`, worker/src/fiche.ts::lireHabillage). Pur.
 */
export function clausesMaison(p: ProjetMaison): string[] {
  const t = p.maison.toit.valeur;
  const c = p.habillage.couverture?.valeur ?? null;
  const en = c === 'tuiles' ? 'en tuiles' : c === 'ardoise' ? 'en ardoise' : c === 'zinc' ? 'en zinc' : '';
  const toit = t === 'plat' ? 'toit plat'
    : t === 'deux-pans' ? `toiture à deux pans ${en}`.trim()
      : t === 'quatre-pans' ? `toiture à quatre pans ${en}`.trim()
        : `toiture monopente ${en}`.trim();
  return ['façade en enduit clair', toit];
}

/** Menuiseries posées après la création (matériau ArchViz du Studio) ; null : couleur non disponible (dite). Pur. */
export function menuiseriesStudio(p: ProjetMaison): 'av-aluminium-noir' | 'av-aluminium-blanc' | null {
  const v = p.habillage.menuiseries.valeur;
  return v === 'anthracite' ? 'av-aluminium-noir' : v === 'blanc' ? 'av-aluminium-blanc' : null;
}

/** Tolérances du contrôle « maison rendue = maison du parcours » (en plus du contrôle de pose à 5 cm du worker). */
export const TOLERANCE_MAISON = { hauteurM: 0.1 } as const;
