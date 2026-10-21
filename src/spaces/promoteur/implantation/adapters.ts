// src/spaces/promoteur/implantation/adapters.ts
//
// LOT L1b — passage des types de l'éditeur 2D (Building2D, feature locale)
// vers les types purs du contrôle d'implantation.
//
// Repère : celui de `parcelleLocal` (mètres, x = est, y = −nord : axe y vers
// le bas comme le SVG de `Plan2DCanvas`). La conversion WGS84 → mètres est
// faite par `Implantation2DPage` (projection équirectangulaire autour du
// centroïde du premier anneau ; écart d'environ 0,5 %, soit environ 10 cm sur
// 20 m — mPerDegLat = 110 574 est la valeur à l'équateur, cf. contrôle L1b G7).

import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { Building2D, OrientedRect } from "../plan2d/editor2d.types.ts";
import type { ContourBatiment, Pt } from "./boundaryDistances.ts";

const DEG = Math.PI / 180;

/** Coins d'un rectangle orienté — même convention que `editor2d.geometry.rectCorners`. */
export function coinsRect(r: OrientedRect): Pt[] {
  const hw = r.width / 2;
  const hd = r.depth / 2;
  const cos = Math.cos(r.rotationDeg * DEG);
  const sin = Math.sin(r.rotationDeg * DEG);
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((p) => ({ x: r.center.x + p.x * cos - p.y * sin, y: r.center.y + p.x * sin + p.y * cos }));
}

/**
 * Emprise au sol d'un bâtiment : volumes du RDC (niveau 0) s'ils existent,
 * sinon volumes historiques, sinon le rectangle englobant `rect`.
 */
export function contourBatiment(b: Building2D): ContourBatiment {
  const valides = (vs: readonly { rect: OrientedRect }[] | undefined): OrientedRect[] =>
    (vs ?? []).map((v) => v.rect).filter((r) => r.width * r.depth > 0.1);
  const rdc = b.floorPlans?.find((fp) => fp.levelIndex === 0);
  let rects = valides(rdc?.volumes);
  if (rects.length === 0) rects = valides(b.volumes);
  if (rects.length === 0) rects = [b.rect];
  return { id: b.id, nom: b.label?.trim() || b.id, polygones: rects.map(coinsRect) };
}

function aireAnneau(ring: readonly number[][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    a += (ring[j]![0]! + ring[i]![0]!) * (ring[j]![1]! - ring[i]![1]!);
  }
  return Math.abs(a / 2);
}

export interface AnneauxParcelle {
  /** Anneaux extérieurs, l'anneau affiché par l'éditeur (le plus grand) en premier. */
  readonly anneaux: Pt[][];
  /** Nombre de polygones dans la géométrie d'origine. */
  readonly nbPolygones: number;
  /** Indice, dans la géométrie d'origine, du polygone affiché par l'éditeur. */
  readonly indexPrincipal: number;
  /** Nombre de trous (enclaves) ignorés. */
  readonly trousIgnores: number;
}

/**
 * Tous les anneaux extérieurs d'une feature DÉJÀ en mètres locaux (sortie de
 * `wgs84FeatureToLocalMeters`), avec la même inversion d'axe y que
 * `featureToPoint2D`. L'éditeur n'affiche que le plus grand polygone ;
 * le contrôle, lui, les mesure tous (les arêtes communes sont internes).
 */
export function anneauxDepuisFeatureLocale(feature: Feature<Polygon | MultiPolygon> | null): AnneauxParcelle {
  if (!feature?.geometry) return { anneaux: [], nbPolygones: 0, indexPrincipal: -1, trousIgnores: 0 };
  const polys: number[][][][] =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates as number[][][]]
      : ((feature.geometry.coordinates as number[][][][]) ?? []);
  let principal = 0;
  let maxA = -Infinity;
  polys.forEach((p, i) => {
    const a = aireAnneau(p?.[0] ?? []);
    if (a > maxA) {
      maxA = a;
      principal = i;
    }
  });
  const conv = (ring: number[][]): Pt[] => ring.map(([x, y]) => ({ x: x!, y: -y! }));
  const ordre = polys.map((_, i) => i).filter((i) => i !== principal);
  if (polys.length > 0) ordre.unshift(principal);
  const anneaux = ordre.map((i) => conv(polys[i]?.[0] ?? [])).filter((r) => r.length >= 3);
  const trousIgnores = polys.reduce((s, p) => s + Math.max(0, (p?.length ?? 0) - 1), 0);
  return { anneaux, nbPolygones: polys.length, indexPrincipal: polys.length > 0 ? principal : -1, trousIgnores };
}
