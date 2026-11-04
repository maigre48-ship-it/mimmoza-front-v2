// src/lib/cartes/empriseParcelle.ts
//
// Emprise (bounding box) des parcelles à surligner et règle de recadrage
// automatique. Logique pure, sans Leaflet (testée par node --test).
//
// Coordonnées GeoJSON attendues en WGS84 [lon, lat]. Une géométrie encore en
// Lambert 93 (valeurs en mètres) est rejetée : on ne la surligne pas et on ne
// recadre pas dessus, plutôt que d'envoyer la carte au milieu de nulle part.

export type Emprise = { sud: number; ouest: number; nord: number; est: number };

type GeometrieLache = { type?: unknown; coordinates?: unknown; geometries?: unknown };
/** Feature GeoJSON « lâche » : seule `geometry` est lue (type inconnu accepté). */
export type FeatureLache = { geometry?: unknown };

function etendre(e: Emprise | null, lon: number, lat: number): Emprise {
  if (!e) return { sud: lat, ouest: lon, nord: lat, est: lon };
  return {
    sud: Math.min(e.sud, lat),
    ouest: Math.min(e.ouest, lon),
    nord: Math.max(e.nord, lat),
    est: Math.max(e.est, lon),
  };
}

/** Parcourt récursivement un tableau de coordonnées GeoJSON. Retourne false si une position est invalide. */
function parcourir(coords: unknown, acc: { e: Emprise | null }): boolean {
  if (!Array.isArray(coords)) return false;
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
    const [lon, lat] = coords as number[];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return false;
    acc.e = etendre(acc.e, lon, lat);
    return true;
  }
  for (const c of coords) if (!parcourir(c, acc)) return false;
  return true;
}

/** Emprise d'une géométrie GeoJSON WGS84, ou null si vide / invalide / hors WGS84. */
export function empriseGeometrie(valeur: unknown): Emprise | null {
  if (!valeur || typeof valeur !== "object") return null;
  const geom = valeur as GeometrieLache;
  if (geom.type === "GeometryCollection") {
    const enfants: unknown[] = Array.isArray(geom.geometries) ? geom.geometries : [];
    return unionEmprises(enfants.map(empriseGeometrie));
  }
  const acc: { e: Emprise | null } = { e: null };
  return parcourir(geom.coordinates, acc) ? acc.e : null;
}

/** Union d'emprises (les null sont ignorées). */
export function unionEmprises(liste: Array<Emprise | null>): Emprise | null {
  let e: Emprise | null = null;
  for (const x of liste) {
    if (!x) continue;
    e = e ? etendre(etendre(e, x.ouest, x.sud), x.est, x.nord) : { ...x };
  }
  return e;
}

/** Emprise d'un ensemble de features (les géométries invalides sont ignorées). */
export function empriseFeatures(features: ReadonlyArray<FeatureLache | null | undefined>): Emprise | null {
  return unionEmprises(features.map((f) => (f ? empriseGeometrie(f.geometry) : null)));
}

/** Format attendu par L.latLngBounds / map.fitBounds : [[sud, ouest], [nord, est]]. */
export function versBoundsLeaflet(e: Emprise): [[number, number], [number, number]] {
  return [[e.sud, e.ouest], [e.nord, e.est]];
}

/**
 * Recadrer seulement quand la parcelle cible CHANGE (nouvelle clé non vide).
 * Ainsi un clic de sélection multiple, un survol ou un rechargement des
 * parcelles voisines ne font jamais sauter la carte.
 */
export function doitRecadrer(cle: string | null | undefined, derniereCle: string | null | undefined): boolean {
  return typeof cle === "string" && cle.length > 0 && cle !== derniereCle;
}

/** Clé stable d'un ensemble d'identifiants (ordre et doublons indifférents). */
export function cleSelection(ids: ReadonlyArray<string | null | undefined>): string {
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))].sort().join(",");
}

/**
 * Features à surligner : celles de `features` dont l'identifiant est dans
 * `ids`, complétées par `extras` (parcelles sélectionnées hors de la zone
 * chargée). Dédoublonnées par identifiant ; géométries non WGS84 écartées.
 */
export function featuresASurligner<F extends FeatureLache>(
  features: ReadonlyArray<F>,
  ids: ReadonlyArray<string | null | undefined>,
  extras: ReadonlyArray<F | null | undefined>,
  idDe: (f: F) => string | null | undefined,
): F[] {
  const voulus = new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0));
  if (voulus.size === 0) return [];
  const vus = new Set<string>();
  const resultat: F[] = [];
  const prendre = (f: F | null | undefined) => {
    if (!f) return;
    const id = idDe(f);
    if (!id || !voulus.has(id) || vus.has(id)) return;
    if (!empriseGeometrie(f.geometry)) return;
    vus.add(id);
    resultat.push(f);
  };
  features.forEach(prendre);
  extras.forEach(prendre);
  return resultat;
}
