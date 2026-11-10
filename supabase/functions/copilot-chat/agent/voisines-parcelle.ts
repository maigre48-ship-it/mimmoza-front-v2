// supabase/functions/copilot-chat/agent/voisines-parcelle.ts
// =============================================================
// LOT C7b — parcelles VOISINES d'une parcelle, côté voie et bandes de constructibilité (côté serveur).
//
// Pourquoi (mission du 10/11/2026, Montreuil, PLUi Est Ensemble) : l'emprise est réglementée « par bande »
// (80 % dans les 18 premiers mètres depuis la voie, 20 % au-delà). Le lot C7a sait trouver le côté voie
// (limite sans parcelle mitoyenne) et mesurer les bandes, mais il lui faut les contours des parcelles
// voisines : aucun appelant ne les fournissait. Ce module :
//   1. les récupère à la MÊME source officielle que le contour (API Carto IGN, module cadastre), avec une
//      seule requête par emprise (rectangle englobant la parcelle, élargi de 2 m) ; `fetchFn` injectable ;
//   2. les relit dans une conception enregistrée (absentes d'une conception ancienne : null, sans erreur) ;
//   3. calcule identifierCoteVoie puis mesurerBandes (code PUR du front, coteVoie.ts) à la profondeur de
//      bande LUE dans la règle (profondeurBandePrincipaleM), pour reglesVolume.
//
// Règle : on ne devine jamais. Voisines indisponibles, liste possiblement incomplète, côté voie non
// identifié, profondeur non lue → aucune mesure (comportement prudent du lot C6) et la raison est dite.
// Une liste de voisines INCOMPLÈTE ferait passer une limite mitoyenne pour une façade sur voie : tout
// doute sur la complétude rend les voisines « indisponibles ».
// =============================================================

import { empriseMaxParBande, identifierCoteVoie, mesurerBandes, type CoteVoie, type MesureBandes } from '../../../../src/spaces/copilot/studio3d/coteVoie.ts';
import type { BandeVoie } from '../../../../src/spaces/copilot/studio3d/bandePrincipale.ts';
import { estConditionBande, optionBandePrincipale, profondeurBandePrincipaleM, type OptionBande } from '../../../../src/spaces/copilot/studio3d/reglesParBande.ts';

export type GeometrieCadastre =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export interface ParcelleVoisine { idu: string | null; geometrie: GeometrieCadastre }

/** Voisines conservées avec la conception (dans `parcelle.voisines`). */
export interface VoisinesParcelle {
  statut: 'disponibles' | 'indisponibles';
  parcelles: ParcelleVoisine[];
  source: string;
  /** Pourquoi les voisines sont indisponibles (phrase lisible). Absent si disponibles. */
  raison?: string;
}

export const URL_CADASTRE_PARCELLE = 'https://apicarto.ign.fr/api/cadastre/parcelle';
export const SOURCE_VOISINES = 'API Carto IGN — cadastre (parcelles de l’emprise de la parcelle élargie de 2 m)';
/** Marge autour du rectangle englobant : toute parcelle mitoyenne le coupe, même si elle ne fait que toucher. */
export const MARGE_EMPRISE_M = 2;
/** Nombre de parcelles demandé ; autant ou plus de réponses = liste possiblement tronquée. */
export const LIMITE_VOISINES = 100;
/** Au-delà, les voisines ne sont pas conservées (taille de la conception). */
export const SOMMETS_VOISINES_MAX = 6000;
const DELAI_MS = 8000;
const M_PAR_DEGRE = 111_320;

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fr = (n: number) => String(n).replace('.', ',');

const estPosition = (c: unknown): c is number[] =>
  Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number' && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
const estAnneau = (a: unknown): boolean => Array.isArray(a) && a.length >= 4 && a.every(estPosition);
const estPolygone = (p: unknown): boolean => Array.isArray(p) && p.length >= 1 && p.every(estAnneau);

/** Géométrie cadastrale lisible (Polygon ou MultiPolygon, anneaux fermés d'au moins 4 positions), sinon null. */
export function lireGeometrieCadastre(g: unknown): GeometrieCadastre | null {
  if (!estObj(g)) return null;
  if (g.type === 'Polygon' && estPolygone(g.coordinates)) return { type: 'Polygon', coordinates: g.coordinates as number[][][] };
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.length >= 1 && g.coordinates.every(estPolygone)) {
    return { type: 'MultiPolygon', coordinates: g.coordinates as number[][][][] };
  }
  return null;
}

const positions = (g: GeometrieCadastre): number[][] =>
  g.type === 'Polygon' ? g.coordinates.flat() : g.coordinates.flat(2);

/** Rectangle englobant la parcelle, élargi de `margeM` mètres (GeoJSON WGS84) ; null si contour illisible. */
export function empriseElargie(g: unknown, margeM = MARGE_EMPRISE_M): { type: 'Polygon'; coordinates: number[][][] } | null {
  const geo = lireGeometrieCadastre(g);
  if (!geo) return null;
  const pts = positions(geo);
  let o = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const c of pts) { o = Math.min(o, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); }
  const dLat = margeM / M_PAR_DEGRE;
  const dLon = margeM / (M_PAR_DEGRE * Math.max(0.01, Math.cos(((s + n) / 2) * Math.PI / 180)));
  const a = (v: number) => Math.round(v * 1e8) / 1e8;
  const [O, E, S, N] = [a(o - dLon), a(e + dLon), a(s - dLat), a(n + dLat)];
  return { type: 'Polygon', coordinates: [[[O, S], [E, S], [E, N], [O, N], [O, S]]] };
}

/** Identifiant cadastral d'une feature API Carto (propriété `idu`, sinon recomposé), en majuscules ; null si absent. */
function iduDeFeature(props: unknown): string | null {
  if (!estObj(props)) return null;
  const brut = typeof props.idu === 'string' ? props.idu.replace(/\s/g, '').toUpperCase() : '';
  if (/^(2[AB]\d{3}|\d{5})\d{3}[0-9A-Z]{2}\d{4}$/.test(brut)) return brut;
  const s = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().toUpperCase() : '');
  const insee = s(props.code_insee) || `${s(props.code_dep)}${s(props.code_com)}`;
  const section = s(props.section), numero = s(props.numero), prefixe = s(props.com_abs) || '000';
  const idu = `${insee}${prefixe.padStart(3, '0')}${section.padStart(2, '0')}${numero.padStart(4, '0')}`;
  return /^(2[AB]\d{3}|\d{5})\d{3}[0-9A-Z]{2}\d{4}$/.test(idu) && section && numero ? idu : null;
}

const indisponibles = (raison: string): VoisinesParcelle => ({ statut: 'indisponibles', parcelles: [], source: SOURCE_VOISINES, raison });

/**
 * Parcelles cadastrales qui touchent ou bordent la parcelle (API Carto IGN, une requête par emprise).
 * Ne lève jamais : tout échec, toute réponse douteuse ou possiblement tronquée → « indisponibles » avec la raison.
 * `fetchFn` injectable (tests hors ligne).
 */
export async function chercherVoisinesParcelle(idu: string, geometrie: unknown, fetchFn: typeof fetch): Promise<VoisinesParcelle> {
  const geo = lireGeometrieCadastre(geometrie);
  const emprise = empriseElargie(geometrie);
  if (!geo || !emprise) return indisponibles('Contour de la parcelle illisible : parcelles voisines non demandées au cadastre.');
  const url = new URL(URL_CADASTRE_PARCELLE);
  url.searchParams.set('geom', JSON.stringify(emprise));
  url.searchParams.set('_limit', String(LIMITE_VOISINES));
  let fc: unknown;
  try {
    const r = await fetchFn(url.toString(), { signal: AbortSignal.timeout(DELAI_MS) });
    if (!r.ok) return indisponibles(`Le cadastre (API Carto IGN) a refusé la demande des parcelles voisines (réponse ${r.status}).`);
    fc = await r.json();
  } catch {
    return indisponibles('Le cadastre (API Carto IGN) n’a pas répondu à la demande des parcelles voisines.');
  }
  const features = estObj(fc) && Array.isArray(fc.features) ? fc.features as unknown[] : null;
  if (!features) return indisponibles('Réponse du cadastre illisible pour les parcelles voisines.');
  if (features.length >= LIMITE_VOISINES) {
    return indisponibles(`Le cadastre renvoie ${features.length} parcelles ou plus autour de la parcelle : liste possiblement incomplète, non utilisée.`);
  }
  const propre = JSON.stringify(geo.coordinates);
  const parcelles: ParcelleVoisine[] = [];
  let sommets = 0;
  for (const f of features) {
    const g = lireGeometrieCadastre(estObj(f) ? f.geometry : null);
    // Une voisine au contour illisible manquerait à l'appel : sa limite passerait pour une façade sur voie.
    if (!g) return indisponibles('Une parcelle voisine a un contour illisible dans la réponse du cadastre : liste non utilisée.');
    const id = iduDeFeature(estObj(f) ? f.properties : null);
    if ((id && id === idu) || JSON.stringify(g.coordinates) === propre) continue;   // la parcelle elle-même
    sommets += positions(g).length;
    parcelles.push({ idu: id, geometrie: g });
  }
  if (sommets > SOMMETS_VOISINES_MAX) return indisponibles(`Contours des parcelles voisines trop volumineux (${sommets} sommets) : non conservés.`);
  if (!parcelles.length) return indisponibles('Le cadastre ne renvoie aucune parcelle voisine autour de la parcelle : le côté voie ne peut pas en être déduit.');
  return { statut: 'disponibles', parcelles, source: SOURCE_VOISINES };
}

/**
 * Voisines conservées dans la parcelle d'une conception (`parcelle.voisines`).
 * null : la conception n'en a pas (enregistrée avant le lot C7b). Contenu illisible : « indisponibles ».
 */
export function lireVoisines(parcelle: unknown): VoisinesParcelle | null {
  if (!estObj(parcelle) || parcelle.voisines === undefined || parcelle.voisines === null) return null;
  const v = parcelle.voisines;
  const source = estObj(v) && typeof v.source === 'string' && v.source.trim() ? v.source.trim().slice(0, 200) : SOURCE_VOISINES;
  if (!estObj(v) || (v.statut !== 'disponibles' && v.statut !== 'indisponibles')) return { ...indisponibles('Parcelles voisines enregistrées sous une forme illisible.'), source };
  if (v.statut === 'indisponibles') {
    return { statut: 'indisponibles', parcelles: [], source, raison: typeof v.raison === 'string' && v.raison.trim() ? v.raison.trim().slice(0, 300) : 'Parcelles voisines indisponibles (raison non enregistrée).' };
  }
  const parcelles: ParcelleVoisine[] = [];
  for (const e of Array.isArray(v.parcelles) ? v.parcelles : []) {
    const g = lireGeometrieCadastre(estObj(e) ? e.geometrie : null);
    if (!g) return { ...indisponibles('Une parcelle voisine enregistrée a un contour illisible : liste non utilisée.'), source };
    parcelles.push({ idu: estObj(e) && typeof e.idu === 'string' ? e.idu.slice(0, 40) : null, geometrie: g });
  }
  if (!parcelles.length) return { ...indisponibles('Aucune parcelle voisine enregistrée.'), source };
  return { statut: 'disponibles', parcelles, source };
}

/** Sous-ensemble d'une règle de conception lu ici (compatible RegleLue de controlesVolume.ts). */
export interface RegleBande { cle: string; statut: string; texte: string | null; alternatives?: OptionBande[] }

export interface BandesConception {
  /** Vrai si la conception porte une règle d'emprise PAR BANDE (sinon rien à mesurer, rien à dire). */
  applicable: boolean;
  /** Bandes mesurées, à passer à reglesVolume ; null si non mesurables (voir `raison`). */
  mesure: MesureBandes | null;
  /** Profondeur de la bande principale lue dans la règle, en mètres ; null si non lue. */
  profondeurM: number | null;
  /** Côté voie présumé, quand il a été cherché. */
  coteVoie: { statut: string; longueurFacadeM: number; nbVoisines: number } | null;
  /** Pourquoi les bandes ne sont pas mesurées (phrase lisible) ; null si mesurées ou sans objet. */
  raison: string | null;
  /** Source des parcelles voisines utilisées ; null si aucune. */
  source: string | null;
  /** Lot C7c : côté voie complet (façades), pour placer le volume dans la bande ; null tant que les bandes ne sont pas mesurées. */
  cote: CoteVoie | null;
  /** Lot C7c : taux d'emprise de la bande principale lu dans la règle (%) ; null s'il n'est pas lu. */
  tauxPrincipalPct: number | null;
}

const SANS_OBJET: BandesConception = { applicable: false, mesure: null, profondeurM: null, coteVoie: null, raison: null, source: null, cote: null, tauxPrincipalPct: null };

/**
 * Bandes de constructibilité de la parcelle d'une conception, pour reglesVolume.
 * Pure : lit `parcelle.geometrie` et `parcelle.voisines`, la profondeur de bande dans la règle d'emprise.
 * Ne mesure que si TOUT est établi ; sinon `mesure: null` et `raison` dit ce qui manque.
 */
export function bandesDeLaConception(parcelle: unknown, regles: ReadonlyArray<RegleBande>): BandesConception {
  const regle = regles.find((r) => r.cle === 'emprise_sol_max_pct' && r.statut !== 'manquant' && estConditionBande(r.alternatives ?? []));
  if (!regle) return SANS_OBJET;
  const alts = regle.alternatives ?? [];
  const base: BandesConception = { ...SANS_OBJET, applicable: true };
  if (!optionBandePrincipale(alts)) return { ...base, raison: 'La règle d’emprise par bande ne nomme pas la bande principale : bandes non mesurées.' };
  const profondeurM = profondeurBandePrincipaleM(alts, regle.texte);
  if (profondeurM === null) return { ...base, raison: 'Profondeur de la bande principale non lue dans le règlement : bandes non mesurées.' };
  const voisines = lireVoisines(parcelle);
  if (!voisines) {
    return { ...base, profondeurM, raison: 'Parcelles voisines absentes de cette conception (contour récupéré avant leur prise en charge) : relancer l’étape « parcelle » de la mission de conception pour situer la voie.' };
  }
  if (voisines.statut !== 'disponibles') return { ...base, profondeurM, source: voisines.source, raison: voisines.raison ?? 'Parcelles voisines indisponibles.' };
  const geometrie = lireGeometrieCadastre(estObj(parcelle) ? parcelle.geometrie : null);
  const cote = identifierCoteVoie(geometrie, voisines.parcelles.map((v) => v.geometrie));
  const coteVoie = { statut: cote.statut, longueurFacadeM: cote.longueurFacadeM, nbVoisines: cote.nbVoisines };
  if (cote.statut !== 'identifie') return { ...base, profondeurM, coteVoie, source: voisines.source, raison: cote.note };
  const mesure = mesurerBandes(cote, profondeurM);
  if (!mesure || !(mesure.bandePrincipaleM2 > 0)) {
    return { ...base, profondeurM, coteVoie, source: voisines.source, raison: `Bande principale de ${fr(profondeurM)} m non mesurable sur le contour de la parcelle.` };
  }
  return { applicable: true, mesure, profondeurM, coteVoie, raison: null, source: voisines.source, cote, tauxPrincipalPct: optionBandePrincipale(alts)?.valeur ?? null };
}

/**
 * Lot C7c : bande principale à passer au moteur (calculerVolumeProgramme) — côté voie, profondeur lue, et
 * plafond d'emprise de la bande principale en m² (empriseMaxParBande). null si un seul élément manque : le
 * plafond « bande principale » ne doit alors PAS être utilisé (l'appelant garde le plafond prudent).
 */
export function bandePourMoteur(b: BandesConception): BandeVoie | null {
  if (!b.mesure || !b.cote || b.cote.statut !== 'identifie' || b.profondeurM === null || b.tauxPrincipalPct === null) return null;
  const max = empriseMaxParBande(b.mesure, b.tauxPrincipalPct, null);
  if (!max || !(max.principaleM2 > 0)) return null;
  // Lot C11 : la surface mesurée de la bande principale suit le volume (part non bâtie de la bande dans les contrôles).
  return { cote: b.cote, profondeurM: b.profondeurM, empriseMaxM2: max.principaleM2, surfaceBandeM2: b.mesure.bandePrincipaleM2 };
}

/** Note du volume d'étude quand la règle est par bande mais que les bandes ne sont pas mesurées. null sinon. */
export function noteBandesNonMesurees(b: BandesConception): string | null {
  return b.applicable && !b.mesure && b.raison ? `Côté voie non situé — ${b.raison}` : null;
}
