// src/spaces/promoteur/implantation/limitesClassement.ts
//
// LOT L1b — CLASSEMENT DES LIMITES (voirie / séparative / fond).
//
// Décision : le moteur mort `implantation2d/reculEngine.ts` (turf, WGS84,
// un seul segment de fond, jamais importé) n'est PAS ressuscité. On reprend la
// convention déjà visible dans l'éditeur : l'utilisateur désigne la « Façade
// terrain » (`parcelFrontEdgeIndex` du store), les arêtes colinéaires sont
// regroupées en faces (même tolérance de 12° que `pluEnvelope.geometry.ts`),
// la face la plus éloignée dans l'axe façade → centroïde est le fond, les
// autres sont séparatives.
//
// Seule l'arête cliquée par l'utilisateur est « utilisateur » ; tout le reste
// est « déduit » et doit être confirmé (bouton de confirmation ou choix limite
// par limite). Une limite déduite ou non classée ne produit jamais de verdict.
//
// Les choix de l'utilisateur sont liés à une SIGNATURE de la géométrie : si la
// parcelle change, ils sont ignorés.

import type { CategorieLimite, ClassementArete, Pt } from "./boundaryDistances.ts";
import { anneauOuvert } from "./boundaryDistances.ts";

export const FACE_ANGLE_TOL_DEG = 12;

interface Face {
  readonly edges: number[];
  readonly milieu: Pt;
}

function norm(x: number, y: number): Pt {
  const l = Math.hypot(x, y);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: x / l, y: y / l };
}

function centroideSurface(ring: readonly Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-12) {
    const n = ring.length || 1;
    return { x: ring.reduce((s, p) => s + p.x, 0) / n, y: ring.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function regrouperFaces(ring: readonly Pt[], tolDeg = FACE_ANGLE_TOL_DEG): Face[] {
  const n = ring.length;
  if (n < 3) return [{ edges: Array.from({ length: n }, (_, i) => i), milieu: centroideSurface(ring) }];
  const dirs: Pt[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    dirs.push(norm(b.x - a.x, b.y - a.y));
  }
  const cosTol = Math.cos((tolDeg * Math.PI) / 180);
  const dot = (p: Pt, q: Pt): number => p.x * q.x + p.y * q.y;
  const groups: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const last = groups[groups.length - 1];
    const nul = dirs[i]!.x === 0 && dirs[i]!.y === 0;
    if (last && nul) last.push(i);
    else if (last && dot(dirs[i]!, dirs[last.filter((k) => dirs[k]!.x !== 0 || dirs[k]!.y !== 0).pop() ?? last[last.length - 1]!]!) >= cosTol) last.push(i);
    else groups.push([i]);
  }
  if (groups.length > 1) {
    const first = groups[0]!;
    const last = groups[groups.length - 1]!;
    if (dot(dirs[first[0]!]!, dirs[last[last.length - 1]!]!) >= cosTol) {
      groups[0] = last.concat(first);
      groups.pop();
    }
  }
  return groups.map((g) => {
    const s = ring[g[0]!]!;
    const e = ring[(g[g.length - 1]! + 1) % n]!;
    return { edges: g, milieu: { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 } };
  });
}

/**
 * Classement proposé pour l'anneau principal à partir de l'arête « façade
 * terrain ». Sans façade désignée : tout est « non classée ».
 */
export function proposerClassement(ring: readonly Pt[], frontEdgeIndex: number | null): ClassementArete[] {
  const r = anneauOuvert(ring);
  const n = r.length;
  if (n < 3 || frontEdgeIndex === null || !Number.isFinite(frontEdgeIndex)) {
    return Array.from({ length: n }, () => ({ categorie: "non-classee" as const, origine: "aucune" as const }));
  }
  const front = ((Math.trunc(frontEdgeIndex) % n) + n) % n;
  const faces = regrouperFaces(r);
  const faceFront = faces.findIndex((f) => f.edges.includes(front));
  const mid = faces[faceFront]!.milieu;
  const c = centroideSurface(r);
  const axe = norm(c.x - mid.x, c.y - mid.y);
  let faceFond = -1;
  let best = -Infinity;
  faces.forEach((f, i) => {
    if (i === faceFront) return;
    const proj = (f.milieu.x - mid.x) * axe.x + (f.milieu.y - mid.y) * axe.y;
    if (proj > best) {
      best = proj;
      faceFond = i;
    }
  });
  const out: ClassementArete[] = Array.from({ length: n }, () => ({ categorie: "separative" as const, origine: "deduite" as const }));
  for (const e of faces[faceFront]!.edges) out[e] = { categorie: "voirie", origine: e === front ? "utilisateur" : "deduite" };
  if (faceFond >= 0) for (const e of faces[faceFond]!.edges) out[e] = { categorie: "fond", origine: "deduite" };
  return out;
}

/** Signature géométrique d'une parcelle (anneaux arrondis au cm). */
export function signatureParcelle(anneaux: readonly (readonly Pt[])[]): string {
  const s = anneaux
    .map((r) => anneauOuvert(r).map((p) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`).join(";"))
    .join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `v1:${(h >>> 0).toString(16)}:${s.length}`;
}

export interface ChoixClassement {
  readonly signature: string;
  /**
   * R2 — indice de l'arête « Façade terrain » cliquée POUR CETTE PARCELLE
   * (même signature). `parcelFrontEdgeIndex` vit dans un store global : seul
   * un clic enregistré ici vaut choix de l'utilisateur.
   */
  readonly facade?: number | null;
  /** Catégorie choisie par l'utilisateur, par identifiant de segment (`p{k}-e{i}`). */
  readonly choix: Readonly<Record<string, CategorieLimite>>;
}

/**
 * Classement final : choix explicite de l'utilisateur (si la signature
 * correspond), sinon proposition (anneau principal 0), sinon non classée.
 */
export function classementFinal(
  anneaux: readonly (readonly Pt[])[],
  frontEdgeIndex: number | null,
  choix: ChoixClassement | null,
): (polygonIndex: number, edgeIndex: number, id: string) => ClassementArete {
  const memeParcelle = choix !== null && choix.signature === signatureParcelle(anneaux);
  const brut = anneaux.length > 0 ? proposerClassement(anneaux[0]!, frontEdgeIndex) : [];
  // R2 : la façade du store global n'est un choix que si elle a été cliquée sur CETTE parcelle.
  const facadeConfirmee = memeParcelle && frontEdgeIndex !== null && choix!.facade === frontEdgeIndex;
  const propose = brut.map((c) => (c.origine === "utilisateur" && !facadeConfirmee ? { ...c, origine: "deduite" as const } : c));
  const valides = memeParcelle ? choix!.choix : {};
  return (polygonIndex, edgeIndex, id) => {
    const c = valides[id];
    if (c) return { categorie: c, origine: c === "non-classee" ? "aucune" : "utilisateur" };
    if (polygonIndex === 0 && propose[edgeIndex]) return propose[edgeIndex]!;
    return { categorie: "non-classee", origine: "aucune" };
  };
}
