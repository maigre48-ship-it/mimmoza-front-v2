// supabase/functions/gpu-parcelle-v1/logique.ts
// -----------------------------------------------------------------------------
// Lot Q3 — logique PURE de gpu-parcelle-v1 (testable sans réseau).
//
// Constat (05/11/2026, parcelle 92050000AE0414, Nanterre) : get_prescriptions_urbanisme a
// renvoyé « Zone de stationnement n°1 » alors que l'API Carto prescription-surf interrogée avec
// la GÉOMÉTRIE COMPLÈTE de la parcelle ne renvoie que « Zone de stationnement n°3 ». La fonction
// n'interrogeait qu'un POINT (latitude/longitude reçues ; côté copilot-chat, les coordonnées
// fournies par le modèle priment sur le centroïde cadastral de l'idu) : un point approximatif,
// hors de la parcelle, lit la prescription voisine ; un point juste ne voit qu'une des zones
// d'une parcelle à cheval.
// Désormais : les couches de prescriptions et d'informations sont interrogées avec la géométrie
// de la parcelle (reçue, ou récupérée au cadastre à partir de l'idu) ; plusieurs valeurs d'une
// même famille (« Zone de stationnement n°1 » et « n°3 ») sont TOUTES remontées avec une alerte,
// sans en choisir une. Le zonage (zone-urba) reste lu au point (inchangé).
// -----------------------------------------------------------------------------

export type GeometrieParcelle =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

/** Sommets au plus (au-delà, l'URL GET d'API Carto deviendrait trop longue : repli sur le point). */
export const SOMMETS_MAX = 400;

const ptOk = (p: unknown) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
  Math.abs(p[0] as number) <= 180 && Math.abs(p[1] as number) <= 90;
const anneauOk = (a: unknown) => Array.isArray(a) && a.length >= 4 && a.every(ptOk);

/** Géométrie de parcelle valide (Polygon / MultiPolygon WGS84, ≤ SOMMETS_MAX sommets), coordonnées arrondies à 1e-7 ; sinon null. */
export function geometrieValide(g: unknown): GeometrieParcelle | null {
  if (!g || typeof g !== 'object') return null;
  const x = g as { type?: unknown; coordinates?: unknown };
  const arr = (n: number) => Math.round(n * 1e7) / 1e7;
  const anneau = (a: number[][]) => a.map((p) => [arr(p[0]), arr(p[1])]);
  if (x.type === 'Polygon' && Array.isArray(x.coordinates) && x.coordinates.length && x.coordinates.every(anneauOk)) {
    const c = (x.coordinates as number[][][]).map(anneau);
    return c.flat().length <= SOMMETS_MAX ? { type: 'Polygon', coordinates: c } : null;
  }
  if (x.type === 'MultiPolygon' && Array.isArray(x.coordinates) && x.coordinates.length &&
    x.coordinates.every((p) => Array.isArray(p) && p.length && p.every(anneauOk))) {
    const c = (x.coordinates as number[][][][]).map((p) => p.map(anneau));
    return c.flat(2).length <= SOMMETS_MAX ? { type: 'MultiPolygon', coordinates: c } : null;
  }
  return null;
}

/** URL API Carto cadastre d'un idu (14 caractères) — même requête que copilot-chat ; null si idu invalide. */
export function urlsCadastre(iduBrut: string): string[] {
  const idu = String(iduBrut ?? '').replace(/\s/g, '').toUpperCase();
  const m = /^(2[AB]\d{3}|\d{5})(\d{3})([0-9A-Z]{2})(\d{4})$/.exec(idu);
  if (!m) return [];
  const [, insee, prefixe, section, numero] = m;
  return (numero === String(Number(numero)) ? [numero] : [numero, String(Number(numero))]).map((num) => {
    const u = new URL('https://apicarto.ign.fr/api/cadastre/parcelle');
    u.searchParams.set('code_insee', insee);
    u.searchParams.set('section', section);
    u.searchParams.set('numero', num);
    if (prefixe !== '000') u.searchParams.set('com_abs', prefixe);
    return u.toString();
  });
}

/** Contour cadastral d'un idu (API Carto), ou null. `fetchFn` injectable. */
export async function geometrieDepuisIdu(idu: string, fetchFn: typeof fetch, timeoutMs = 7000): Promise<GeometrieParcelle | null> {
  for (const url of urlsCadastre(idu)) {
    try {
      const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) continue;
      const fc = await r.json();
      const g = geometrieValide(Array.isArray(fc?.features) ? fc.features[0]?.geometry : null);
      if (g) return g;
    } catch { /* essai suivant */ }
  }
  return null;
}

/** Famille d'un libellé de prescription : « Zone de stationnement n°3 » → « zone de stationnement ». */
export function familleLibelle(libelle: string | null): string | null {
  if (!libelle) return null;
  const base = libelle.toLowerCase().replace(/\s+/g, ' ').trim();
  const f = base.replace(/\s*(?:n\s*[°o]\s*|num[ée]ro\s*)?[0-9]+[a-z]?\s*$/i, '').replace(/[\s:–—-]+$/, '').trim();
  return f && f !== base ? f : null;
}

/**
 * Prescriptions d'une même famille portant des valeurs différentes (« Zone de stationnement n°1 »
 * ET « n°3 ») : une alerte par famille, toutes les valeurs citées, aucune choisie.
 */
export function alertesValeursMultiples(prescriptions: Array<{ libelle: string | null }>): string[] {
  const parFamille = new Map<string, Set<string>>();
  for (const p of prescriptions) {
    const f = familleLibelle(p.libelle);
    if (!f || !p.libelle) continue;
    if (!parFamille.has(f)) parFamille.set(f, new Set());
    parFamille.get(f)!.add(p.libelle.trim());
  }
  const out: string[] = [];
  for (const [f, libs] of parFamille) {
    if (libs.size < 2) continue;
    out.push(`Plusieurs valeurs de « ${f} » touchent la parcelle : ${[...libs].join(' ; ')}. Elles sont toutes remontées, ` +
      'aucune n’est retenue d’office : la parcelle peut être à cheval (vérifier sur le plan laquelle s’applique au projet).');
  }
  return out;
}

/** Couches lues sur la géométrie de la parcelle quand elle est connue (le zonage reste lu au point). */
export const COUCHES_SUR_PARCELLE: ReadonlySet<string> = new Set(['prescription-surf', 'prescription-lin', 'prescription-pct', 'info-surf']);

/** URL API Carto GPU d'une couche : géométrie de la parcelle pour les prescriptions/informations si connue, sinon le point. */
export function urlCouche(base: string, nom: string, lon: number, lat: number, parcelle: GeometrieParcelle | null): string {
  const geom = parcelle && COUCHES_SUR_PARCELLE.has(nom) ? parcelle : { type: 'Point', coordinates: [lon, lat] };
  return `${base}/${nom}?geom=${encodeURIComponent(JSON.stringify(geom))}`;
}
