// supabase/functions/_shared/extension/bdtopoParcelle.ts
// =============================================================================
// LOT X3 (14/11/2026) — Bâtiments BD TOPO de la parcelle, côté site. Module PUR (le `fetch` est injecté).
//
// Service : WFS 2.0.0 de la Géoplateforme (https://data.geopf.fr/wfs/ows), couche `BDTOPO_V3:batiment`, déjà
// interrogée par le site (rechercher-parcelles-v1, « bâti détecté ») et par le Studio (src/core/voisinage/bdtopo.ts,
// mêmes champs : cleabs, hauteur, nombre_d_etages, altitude_minimale_sol, altitude_minimale_toit,
// altitude_maximale_toit, usage_1, nature, construction_legere, etat_de_l_objet). Licence Ouverte Etalab 2.0,
// mention « © IGN – BD TOPO® ».
// Requête en Lambert-93 (SRSNAME=EPSG:2154), comme le Studio : aucune inversion d'axes à deviner.
//
// Règle « sur la parcelle » (écrite) : la MOITIÉ au moins de l'emprise du bâtiment est dans le contour cadastral
// (même règle et même échantillonnage que le Studio, volumes.ts `recouvrement` / `seuilSurParcelle` 0,5). Le bâtiment
// PRINCIPAL est la plus grande emprise non légère (maisonPrincipale, X1).
// Repère de calcul : origine à la moyenne des sommets du contour de la parcelle, x = est, z = sud (repère du Studio).
// Rien n'est inventé : un champ absent reste `null` et l'estimation (maisonExistante.ts, X1) le dit.
// =============================================================================

import { lambert93VersWgs84, wgs84VersLambert93 } from './lambert93.ts';
import { aire, type Pt } from './geometrie.ts';
import type { DonneesBdnb } from './contrat.ts';
import type { EntreeExistant } from './maisonExistante.ts';

export const WFS_GEOPLATEFORME = 'https://data.geopf.fr/wfs/ows';
export const COUCHE_BATIMENTS = 'BDTOPO_V3:batiment';
export const MENTION_BDTOPO = '© IGN – BD TOPO® (Licence Ouverte Etalab 2.0)';
/** Marge autour du rectangle de la parcelle (m) : un bâtiment à cheval sur la limite reste lu. */
export const MARGE_BBOX_M = 5;
export const BATIMENTS_MAX = 200;
export const DELAI_WFS_MS = 12_000;

export type SommetL93 = readonly [number, number];

/** Bâtiment BD TOPO tel que reçu (Lambert-93) — même forme que `BatimentIGN` du Studio (fixture partagée). */
export interface BatimentBdTopo {
  readonly id: string;
  readonly anneaux: readonly (readonly SommetL93[])[];
  readonly hauteurM: number | null;
  readonly etages: number | null;
  readonly altitudeSolM: number | null;
  readonly altitudeToitMinM: number | null;
  readonly altitudeToitMaxM: number | null;
  readonly usage: string | null;
  readonly nature: string | null;
  readonly legere: boolean;
  readonly dateModification?: string | null;
}

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Contour WGS 84 [lon, lat][] → Lambert-93, sans point de fermeture. */
export function contourEnLambert93(contour: readonly (readonly [number, number])[]): SommetL93[] {
  const pts = contour.map(([lon, lat]) => wgs84VersLambert93(lon, lat));
  const f = pts.length > 1 ? pts[pts.length - 1]! : null;
  if (f && Math.abs(f[0] - pts[0]![0]) < 1e-6 && Math.abs(f[1] - pts[0]![1]) < 1e-6) pts.pop();
  return pts;
}

/** Anneau extérieur WGS 84 d'une géométrie GeoJSON de parcelle (Polygon ou MultiPolygon : le plus grand). */
export function anneauParcelle(geometrie: unknown): [number, number][] | null {
  if (!estObj(geometrie)) return null;
  const polys: unknown[] = geometrie.type === 'Polygon' ? [geometrie.coordinates] : geometrie.type === 'MultiPolygon' && Array.isArray(geometrie.coordinates) ? geometrie.coordinates : [];
  let meilleur: [number, number][] | null = null;
  let meilleureAire = -1;
  for (const p of polys) {
    const r = Array.isArray(p) ? p[0] : null;
    if (!Array.isArray(r) || r.length < 4) continue;
    const pts = r.filter((c): c is [number, number] => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])).map((c) => [c[0], c[1]] as [number, number]);
    const a = Math.abs(aire(pts.map(([x, z]) => ({ x, z }))));
    if (a > meilleureAire) { meilleur = pts; meilleureAire = a; }
  }
  return meilleur;
}

/** URL WFS GetFeature des bâtiments dans le rectangle de la parcelle (+ marge), Lambert-93. */
export function urlBatimentsParcelle(contourL93: readonly SommetL93[]): string {
  const es = contourL93.map((p) => p[0]);
  const ns = contourL93.map((p) => p[1]);
  const bbox = [Math.min(...es) - MARGE_BBOX_M, Math.min(...ns) - MARGE_BBOX_M, Math.max(...es) + MARGE_BBOX_M, Math.max(...ns) + MARGE_BBOX_M]
    .map((v) => v.toFixed(2)).join(',');
  const p = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: COUCHE_BATIMENTS, OUTPUTFORMAT: 'application/json',
    SRSNAME: 'EPSG:2154', BBOX: `${bbox},urn:ogc:def:crs:EPSG::2154`, COUNT: String(BATIMENTS_MAX),
  });
  return `${WFS_GEOPLATEFORME}?${p.toString()}`;
}

function sansFermeture(a: SommetL93[]): SommetL93[] {
  if (a.length > 1) {
    const p = a[0]!, q = a[a.length - 1]!;
    if (Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6) return a.slice(0, -1);
  }
  return a;
}

/**
 * Réponse WFS (GeoJSON, Lambert-93) → bâtiments. Objets non « En service » écartés (dit), géométries illisibles
 * écartées (dit). Un MultiPolygon donne un bâtiment par partie (`<cleabs>:<n>`, identifiant admis par le contrat X0).
 */
export function lireBatimentsWfs(fc: unknown): { batiments: BatimentBdTopo[]; avertissements: string[] } {
  const avert: string[] = [];
  const batiments: BatimentBdTopo[] = [];
  const feats = estObj(fc) && Array.isArray(fc.features) ? fc.features : null;
  if (!feats) return { batiments, avertissements: ['Réponse BD TOPO illisible (pas de liste « features »).'] };
  let horsService = 0;
  let illisibles = 0;
  for (const f of feats) {
    if (!estObj(f) || !estObj(f.geometry)) { illisibles += 1; continue; }
    const pr = estObj(f.properties) ? f.properties : {};
    const etat = texte(pr['etat_de_l_objet']);
    if (etat && etat !== 'En service') { horsService += 1; continue; }
    const g = f.geometry;
    const polys: unknown[] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' && Array.isArray(g.coordinates) ? g.coordinates : [];
    const base = (texte(pr['cleabs']) ?? texte(f.id) ?? '').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 60);
    if (!base || !polys.length) { illisibles += 1; continue; }
    polys.forEach((poly, j) => {
      if (!Array.isArray(poly)) { illisibles += 1; return; }
      const anneaux = poly.map((r) => sansFermeture((Array.isArray(r) ? r : [])
        .filter((c): c is number[] => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map((c) => [c[0]!, c[1]!] as SommetL93)));
      if (!anneaux[0] || anneaux[0].length < 3) { illisibles += 1; return; }
      const etages = nombre(pr['nombre_d_etages']);
      batiments.push({
        id: polys.length > 1 ? `${base}:${j + 1}` : base,
        anneaux,
        hauteurM: nombre(pr['hauteur']),
        etages: etages !== null && etages >= 1 ? Math.round(etages) : null,
        altitudeSolM: nombre(pr['altitude_minimale_sol']),
        altitudeToitMinM: nombre(pr['altitude_minimale_toit']),
        altitudeToitMaxM: nombre(pr['altitude_maximale_toit']),
        usage: texte(pr['usage_1']),
        nature: texte(pr['nature']),
        legere: pr['construction_legere'] === true,
        dateModification: texte(pr['date_modification']),
      });
    });
  }
  if (horsService) avert.push(`${horsService} bâtiment(s) BD TOPO non « En service » (en projet, en construction, en ruine) écarté(s).`);
  if (illisibles) avert.push(`${illisibles} objet(s) BD TOPO illisible(s) écarté(s).`);
  return { batiments, avertissements: avert };
}

function dansPolygone(e: number, n: number, c: readonly SommetL93[]): boolean {
  let dedans = false;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const [xi, yi] = c[i]!, [xj, yj] = c[j]!;
    if ((yi > n) !== (yj > n) && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

/** Centre de surface d'un anneau (Lambert-93). */
export function centreAnneau(a: readonly SommetL93[]): SommetL93 {
  let s = 0, cx = 0, cy = 0;
  for (let i = 0; i < a.length; i += 1) {
    const [x0, y0] = a[i]!, [x1, y1] = a[(i + 1) % a.length]!;
    const k = x0 * y1 - x1 * y0;
    s += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
  }
  if (Math.abs(s) < 1e-9) {
    return [a.reduce((t, p) => t + p[0], 0) / a.length, a.reduce((t, p) => t + p[1], 0) / a.length];
  }
  return [cx / (3 * s), cy / (3 * s)];
}

/** Part de l'emprise d'un bâtiment (trous déduits) située dans la parcelle, par échantillonnage sur une grille
 * (≈ 400 points) — même calcul que le Studio (`recouvrement`, src/core/voisinage/volumes.ts). */
export function partSurParcelle(b: BatimentBdTopo, contourL93: readonly SommetL93[]): number {
  const ext = b.anneaux[0]!;
  const trous = b.anneaux.slice(1);
  const es = ext.map((p) => p[0]), ns = ext.map((p) => p[1]);
  const e0 = Math.min(...es), e1 = Math.max(...es), n0 = Math.min(...ns), n1 = Math.max(...ns);
  const pas = Math.max(0.25, Math.sqrt(((e1 - e0) * (n1 - n0)) / 400));
  let dedans = 0, commun = 0;
  for (let e = e0 + pas / 2; e < e1; e += pas) {
    for (let n = n0 + pas / 2; n < n1; n += pas) {
      if (!dansPolygone(e, n, ext) || trous.some((t) => dansPolygone(e, n, t))) continue;
      dedans += 1;
      if (dansPolygone(e, n, contourL93)) commun += 1;
    }
  }
  return dedans > 0 ? commun / dedans : 0;
}

/** Seuil « sur la parcelle » : la moitié de l'emprise au moins (même seuil que le Studio, `seuilSurParcelle`). */
export const SEUIL_SUR_PARCELLE = 0.5;

/** Bâtiments dont la moitié de l'emprise au moins est dans la parcelle (règle écrite en tête). */
export function batimentsSurParcelle(bats: readonly BatimentBdTopo[], contourL93: readonly SommetL93[]): BatimentBdTopo[] {
  return bats.filter((b) => partSurParcelle(b, contourL93) >= SEUIL_SUR_PARCELLE);
}

/** Origine du repère de calcul : moyenne des sommets du contour (Lambert-93) — même origine que le Studio (lot X2). */
export function origineParcelle(contourL93: readonly SommetL93[]): SommetL93 {
  return [contourL93.reduce((a, p) => a + p[0], 0) / contourL93.length, contourL93.reduce((a, p) => a + p[1], 0) / contourL93.length];
}

/** Lambert-93 → repère de calcul (x = est, z = sud), en mètres. */
export function versRepere(p: SommetL93, origine: SommetL93): Pt {
  return { x: Math.round((p[0] - origine[0]) * 1000) / 1000, z: Math.round(-(p[1] - origine[1]) * 1000) / 1000 };
}

/** Bâtiment BD TOPO → entrée de l'estimation X1 (estimerMaisonExistante). */
export function entreeExistant(b: BatimentBdTopo, origine: SommetL93, bdnb?: DonneesBdnb): EntreeExistant {
  return {
    id: b.id,
    anneau: b.anneaux[0]!.map((p) => versRepere(p, origine)),
    baseM: 0,
    hauteurM: b.hauteurM,
    etages: b.etages,
    altitudeSolM: b.altitudeSolM,
    altitudeToitMinM: b.altitudeToitMinM,
    altitudeToitMaxM: b.altitudeToitMaxM,
    legere: b.legere,
    usage: b.usage,
    ...(bdnb && Object.keys(bdnb).length ? { bdnb } : {}),
  };
}

/** Centre WGS 84 d'un bâtiment (pour la BDNB ou l'affichage). */
export function centreWgs84(b: BatimentBdTopo): [number, number] {
  const [e, n] = centreAnneau(b.anneaux[0]!);
  return lambert93VersWgs84(e, n);
}

export type ResultatBdTopo =
  | { readonly ok: true; readonly batiments: BatimentBdTopo[]; readonly avertissements: string[]; readonly url: string }
  | { readonly ok: false; readonly raison: string; readonly url: string };

/** Lecture réseau (fetch injecté, délai borné). Ne lève jamais. */
export async function telechargerBatimentsParcelle(contourL93: readonly SommetL93[], f: typeof fetch, delaiMs = DELAI_WFS_MS): Promise<ResultatBdTopo> {
  const url = urlBatimentsParcelle(contourL93);
  const ac = new AbortController();
  const minuteur = setTimeout(() => ac.abort(), delaiMs);
  try {
    const r = await f(url, { headers: { Accept: 'application/json' }, signal: ac.signal });
    if (!r.ok) return { ok: false, raison: `BD TOPO (WFS Géoplateforme) : HTTP ${r.status}`, url };
    const lu = lireBatimentsWfs(await r.json());
    return { ok: true, batiments: lu.batiments, avertissements: lu.avertissements, url };
  } catch (e) {
    return { ok: false, raison: `BD TOPO (WFS Géoplateforme) injoignable : ${e instanceof Error ? e.message : String(e)}`.slice(0, 300), url };
  } finally {
    clearTimeout(minuteur);
  }
}
