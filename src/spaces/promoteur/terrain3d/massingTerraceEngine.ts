// massingTerraceEngine.ts — Terrace & railing engine
// Detects real setback terraces, builds slab geometry,
// places guard rails ONLY on exposed edges (not covered by upper volume)

import * as THREE from "three";
import type { Pt2D, Edge2D } from "./massingGeometry3d";
import { extractEdges, isEdgeCoveredByPolygon, centroid2D } from "./massingGeometry3d";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TerraceConfig {
  lowerPts: Pt2D[];
  upperPts: Pt2D[];
  terraceY: number;
  /** Floor height in scene units — used to scale slab/rail proportionally */
  floorHeight: number;
  slabThickness?: number;
  railHeight?: number;
  railDiameter?: number;
}

export interface TerraceResult {
  slab: THREE.BufferGeometry[];
  rails: THREE.BufferGeometry[];
  posts: THREE.BufferGeometry[];
}

// ─── Proportional defaults ────────────────────────────────────────────────────

const SLAB_THICK_RATIO = 0.035;   // slab = 3.5% of floorHeight
const RAIL_HEIGHT_RATIO = 0.30;   // rail = 30% of floorHeight (~1m for 3.2m floors)
const RAIL_DIAM_RATIO = 0.008;
const POST_SPACING_RATIO = 0.28;
const HANDRAIL_DIAM_RATIO = 0.011;
const RAIL_INSET_RATIO = 0.015;

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build terrace geometry between a lower (wider) slice and the upper (narrower) slice.
 * Guard rails are placed only on edges of the lower polygon that are NOT covered
 * by the upper polygon (i.e., truly exposed to open air).
 */
export function buildTerraceGeometry(config: TerraceConfig): TerraceResult {
  const result: TerraceResult = { slab: [], rails: [], posts: [] };
  const {
    lowerPts, upperPts, terraceY, floorHeight,
  } = config;

  const slabThickness = config.slabThickness ?? Math.max(0.02, floorHeight * SLAB_THICK_RATIO);
  const railHeight    = config.railHeight    ?? Math.max(0.1, floorHeight * RAIL_HEIGHT_RATIO);
  const railDiameter  = config.railDiameter  ?? Math.max(0.005, floorHeight * RAIL_DIAM_RATIO);
  const postSpacing   = Math.max(0.2, floorHeight * POST_SPACING_RATIO);
  const handrailDiam  = Math.max(0.008, floorHeight * HANDRAIL_DIAM_RATIO);
  const railInset     = Math.max(0.01, floorHeight * RAIL_INSET_RATIO);

  // ── Terrace slab (the exposed area between lower and upper) ──
  const slabGeo = buildTerraceSlab(lowerPts, terraceY, slabThickness);
  result.slab.push(slabGeo);

  // ── Find exposed edges ──
  const lowerEdges = extractEdges(lowerPts);
  const exposedEdges = lowerEdges.filter(edge => !isEdgeCoveredByPolygon(edge, upperPts, 0.2));

  // ── Build rails on exposed edges only ──
  for (const edge of exposedEdges) {
    if (edge.length < 0.3) continue; // skip very short edges

    const railGeos = buildGuardRail(edge, terraceY + slabThickness, railHeight, railDiameter, handrailDiam, postSpacing, railInset);
    result.rails.push(...railGeos.rails);
    result.posts.push(...railGeos.posts);
  }

  return result;
}

/**
 * Check if there's a meaningful terrace (i.e., the upper polygon is significantly
 * smaller than the lower polygon, creating a real setback).
 */
export function hasRealTerrace(lowerPts: Pt2D[], upperPts: Pt2D[]): boolean {
  const lowerArea = Math.abs(polygonArea(lowerPts));
  const upperArea = Math.abs(polygonArea(upperPts));
  // Must have at least 5% area difference
  return (lowerArea - upperArea) / lowerArea > 0.04;
}

// ─── Terrace slab ─────────────────────────────────────────────────────────────

function buildTerraceSlab(pts: Pt2D[], y: number, thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, -pts[0].y);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, -pts[i].y);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  });
  // ExtrudeGeometry extrudes along Z, we need horizontal slab → rotate
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

// ─── Guard rail ───────────────────────────────────────────────────────────────

interface RailGeos {
  rails: THREE.BufferGeometry[];
  posts: THREE.BufferGeometry[];
}

function buildGuardRail(
  edge: Edge2D,
  baseY: number,
  height: number,
  diameter: number,
  handrailDiam: number,
  postSpacing: number,
  railInset: number,
): RailGeos {
  const result: RailGeos = { rails: [], posts: [] };

  const ax = edge.a.x - edge.nx * railInset;
  const ay = edge.a.y - edge.ny * railInset;
  const bx = edge.b.x - edge.nx * railInset;
  const by = edge.b.y - edge.ny * railInset;
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 0.1) return result;

  const midX = (ax + bx) / 2;
  const midZ = (ay + by) / 2;
  const dir = new THREE.Vector3(bx - ax, 0, by - ay).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(up, dir).normalize();

  // Handrail (top horizontal bar)
  const hrGeo = new THREE.CylinderGeometry(handrailDiam / 2, handrailDiam / 2, len, 6);
  hrGeo.rotateZ(Math.PI / 2);
  const hrM = new THREE.Matrix4().makeBasis(dir, up, side);
  hrM.setPosition(midX, baseY + height, midZ);
  hrGeo.applyMatrix4(hrM);
  result.rails.push(hrGeo);

  // Mid rail (50% height)
  const mrGeo = new THREE.CylinderGeometry(diameter / 2, diameter / 2, len, 6);
  mrGeo.rotateZ(Math.PI / 2);
  const mrM = new THREE.Matrix4().makeBasis(dir, up, side);
  mrM.setPosition(midX, baseY + height * 0.5, midZ);
  mrGeo.applyMatrix4(mrM);
  result.rails.push(mrGeo);

  // Vertical posts
  const numPosts = Math.max(2, Math.ceil(len / postSpacing) + 1);
  for (let i = 0; i < numPosts; i++) {
    const t = numPosts <= 1 ? 0 : i / (numPosts - 1);
    const px = ax + (bx - ax) * t;
    const pz = ay + (by - ay) * t;
    const postGeo = new THREE.CylinderGeometry(diameter / 2, diameter / 2, height, 6);
    postGeo.translate(px, baseY + height / 2, pz);
    result.posts.push(postGeo);
  }

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function polygonArea(pts: Pt2D[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}