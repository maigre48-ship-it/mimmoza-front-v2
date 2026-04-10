// src/spaces/promoteur/plan2d/planUnion.ts
// Calcul du contour extérieur (union polygonale) de N polygones convexes.
// Utilisé pour le rendu "fusion" des bâtiments composites.
//
// Algorithme :
//   Pour chaque arête de chaque polygone :
//     1. Découper l'arête aux points d'intersection avec les autres polygones.
//     2. Conserver les sous-segments dont le milieu est HORS de tout autre polygone.
//   Résultat = les sous-segments extérieurs → relier en polygone fermé.
//
// Fonctionne pour : L, T, U, barre+socle, superposition partielle.

export type P2 = { x: number; y: number };

const EPS = 1e-8;

// ── Géométrie de base ─────────────────────────────────────────────────

const lerp = (a: P2, b: P2, t: number): P2 =>
  ({ x: a.x + t*(b.x-a.x), y: a.y + t*(b.y-a.y) });

const cross2 = (a: P2, b: P2): number => a.x*b.y - a.y*b.x;
const sub    = (a: P2, b: P2): P2     => ({ x: a.x-b.x, y: a.y-b.y });
const dist2  = (a: P2, b: P2): number => { const d=sub(a,b); return d.x*d.x+d.y*d.y; };

// Paramètre t ∈ [0,1] d'intersection du segment AB avec le segment CD.
function segT(a: P2, b: P2, c: P2, d: P2): number | null {
  const r = sub(b,a), s = sub(d,c);
  const rxs = cross2(r, s);
  if (Math.abs(rxs) < EPS) return null;
  const qp = sub(c, a);
  const t  = cross2(qp, s) / rxs;
  const u  = cross2(qp, r) / rxs;
  if (t > -EPS && t < 1+EPS && u > -EPS && u < 1+EPS)
    return Math.max(0, Math.min(1, t));
  return null;
}

// Appartenance à un segment (tolérance géométrique).
function onSeg(p: P2, a: P2, b: P2): boolean {
  if (Math.abs(cross2(sub(p,a), sub(b,a))) > 1e-4) return false;
  return Math.min(a.x,b.x)-1e-4 <= p.x && p.x <= Math.max(a.x,b.x)+1e-4 &&
         Math.min(a.y,b.y)-1e-4 <= p.y && p.y <= Math.max(a.y,b.y)+1e-4;
}

// Point dans polygone (ray-casting). Traite "sur la bordure" comme intérieur.
function pip(p: P2, poly: P2[]): boolean {
  const n = poly.length;
  for (let i=0; i<n; i++) {
    if (onSeg(p, poly[i], poly[(i+1)%n])) return true;
  }
  let inside = false;
  for (let i=0, j=n-1; i<n; j=i++) {
    const pi=poly[i], pj=poly[j];
    if ((pi.y > p.y) !== (pj.y > p.y) &&
        p.x < (pj.x-pi.x)*(p.y-pi.y)/(pj.y-pi.y)+pi.x)
      inside = !inside;
  }
  return inside;
}

// ── Snap (arrondi à 0.1 mm pour robustesse) ───────────────────────────

const SNAP = 1e-4;
const snap = (x: number): number => Math.round(x / SNAP) * SNAP;
const snapP = (p: P2): P2 => ({ x: snap(p.x), y: snap(p.y) });
const key   = (p: P2): string => `${snap(p.x)},${snap(p.y)}`;

// ── Dédoublonnage ─────────────────────────────────────────────────────

function dedup(pts: P2[]): P2[] {
  if (pts.length < 3) return pts;
  const out: P2[] = [pts[0]];
  for (let i=1; i<pts.length; i++)
    if (dist2(pts[i], out[out.length-1]) > 1e-6) out.push(pts[i]);
  if (dist2(out[0], out[out.length-1]) < 1e-6) out.pop();
  return out;
}

// ── Traçage du polygone depuis les sous-segments ──────────────────────

function traceSegs(segs: [P2, P2][]): P2[] {
  if (segs.length === 0) return [];

  // Table d'adjacence : clé de point → voisins
  type Neighbor = { segIdx: number; other: P2 };
  const adj = new Map<string, Neighbor[]>();

  segs.forEach(([a, b], i) => {
    const ka=key(a), kb=key(b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push({ segIdx: i, other: b });
    adj.get(kb)!.push({ segIdx: i, other: a });
  });

  const visited = new Set<number>();
  const result: P2[] = [];

  // Partir du premier segment
  visited.add(0);
  result.push(segs[0][0]);
  let current: P2 = segs[0][1];
  const startKey = key(segs[0][0]);

  for (let iter=0; iter < segs.length + 4; iter++) {
    // Si on est revenu au départ → polygone fermé
    if (result.length > 2 && key(current) === startKey) break;

    if (dist2(current, result[result.length-1]) > 1e-6)
      result.push(current);

    const neighbors = adj.get(key(current)) ?? [];
    const next = neighbors.find(n => !visited.has(n.segIdx));
    if (!next) break;

    visited.add(next.segIdx);
    current = next.other;
  }

  return dedup(result);
}

// ── API publique ──────────────────────────────────────────────────────

/**
 * Calcule le contour extérieur (union) d'un ensemble de polygones convexes.
 *
 * @param polys  Tableau de polygones, chacun en Point2D[].
 * @returns      Polygone union (Point2D[]), ou [] si calcul impossible.
 *
 * Renvoie le premier polygone si polys.length === 1.
 * Renvoie [] en cas d'échec → le canvas doit alors afficher chaque volume séparément.
 */
export function computeUnion(polys: P2[][]): P2[] {
  if (polys.length === 0) return [];
  if (polys.length === 1) return polys[0];

  const outerSegs: [P2, P2][] = [];

  for (let pi=0; pi<polys.length; pi++) {
    const poly   = polys[pi];
    const n      = poly.length;
    const others = polys.filter((_, i) => i !== pi);

    for (let ei=0; ei<n; ei++) {
      const a = poly[ei], b = poly[(ei+1)%n];

      // Paramètres de découpe : intersections avec les autres polygones
      const params: number[] = [0, 1];
      for (const other of others) {
        const m = other.length;
        for (let ej=0; ej<m; ej++) {
          const t = segT(a, b, other[ej], other[(ej+1)%m]);
          if (t !== null && t > EPS && t < 1-EPS) params.push(t);
        }
      }
      params.sort((x, y) => x-y);

      // Garder les sous-segments dont le milieu est hors de tous les autres polygones
      for (let k=0; k<params.length-1; k++) {
        const t0=params[k], t1=params[k+1];
        if (t1-t0 < EPS) continue;
        const p0 = snapP(lerp(a, b, t0));
        const p1 = snapP(lerp(a, b, t1));
        const mid = lerp(p0, p1, 0.5);
        if (!others.some(o => pip(mid, o))) {
          outerSegs.push([p0, p1]);
        }
      }
    }
  }

  if (outerSegs.length < 3) return polys[0]; // fallback

  const result = traceSegs(outerSegs);
  return result.length >= 3 ? result : polys[0];
}