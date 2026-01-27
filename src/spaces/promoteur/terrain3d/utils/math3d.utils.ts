// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/utils/math3d.utils.ts
// ============================================================================

import type { Point3D } from '../types/terrain.types';

/**
 * Clamp une valeur entre min et max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Interpolation linéaire entre deux valeurs
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Interpolation linéaire entre deux points 3D
 */
export function lerpPoint3D(a: Point3D, b: Point3D, t: number): Point3D {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

/**
 * Distance entre deux points 3D
 */
export function distance3D(a: Point3D, b: Point3D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Distance 2D (ignore Z)
 */
export function distance2D(a: Point3D, b: Point3D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Normalise un vecteur 3D
 */
export function normalize(v: Point3D): Point3D {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return {
    x: v.x / len,
    y: v.y / len,
    z: v.z / len,
  };
}

/**
 * Produit vectoriel de deux vecteurs 3D
 */
export function cross(a: Point3D, b: Point3D): Point3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Produit scalaire de deux vecteurs 3D
 */
export function dot(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Calcule la normale d'un triangle défini par 3 points
 */
export function triangleNormal(p1: Point3D, p2: Point3D, p3: Point3D): Point3D {
  const v1: Point3D = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
  const v2: Point3D = { x: p3.x - p1.x, y: p3.y - p1.y, z: p3.z - p1.z };
  return normalize(cross(v1, v2));
}

/**
 * Convertit degrés en radians
 */
export function degToRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Convertit radians en degrés
 */
export function radToDeg(radians: number): number {
  return radians * (180 / Math.PI);
}

/**
 * Calcule la pente en pourcentage à partir de dz et distance horizontale
 */
export function slopePercent(dz: number, horizontalDistance: number): number {
  if (horizontalDistance === 0) return 0;
  return (dz / horizontalDistance) * 100;
}

/**
 * Calcule la pente en degrés
 */
export function slopeDegrees(dz: number, horizontalDistance: number): number {
  if (horizontalDistance === 0) return 0;
  return radToDeg(Math.atan(dz / horizontalDistance));
}

/**
 * Remapping d'une valeur d'un range à un autre
 */
export function remap(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  const t = (value - inMin) / (inMax - inMin);
  return lerp(outMin, outMax, t);
}

/**
 * Arrondi à n décimales
 */
export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}