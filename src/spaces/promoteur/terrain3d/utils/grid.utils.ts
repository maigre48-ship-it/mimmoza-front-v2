// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/utils/grid.utils.ts
// ============================================================================

import type { Position } from 'geojson';
import type { BBox2D, Point3D, TerrainGrid } from '../types/terrain.types';
import { clamp, lerp } from './math3d.utils';

/**
 * Calcule le pas de grille optimal en fonction de la taille du terrain
 */
export function computeOptimalGridStep(bbox: BBox2D, maxCells: number = 10000): number {
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;
  const area = width * height;
  
  // Vise environ maxCells cellules
  const cellSize = Math.sqrt(area / maxCells);
  
  // Arrondi à une valeur "propre" (1, 2, 5, 10, 20, 50, etc.)
  const magnitude = Math.pow(10, Math.floor(Math.log10(cellSize)));
  const normalized = cellSize / magnitude;
  
  let step: number;
  if (normalized < 1.5) step = magnitude;
  else if (normalized < 3.5) step = 2 * magnitude;
  else if (normalized < 7.5) step = 5 * magnitude;
  else step = 10 * magnitude;
  
  return Math.max(step, 1); // Minimum 1m
}

/**
 * Calcule les dimensions de grille pour une bbox donnée
 */
export function computeGridDimensions(
  bbox: BBox2D,
  step: number
): { cols: number; rows: number } {
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;
  
  return {
    cols: Math.ceil(width / step) + 1,
    rows: Math.ceil(height / step) + 1,
  };
}

/**
 * Génère les positions de la grille
 */
export function generateGridPositions(
  bbox: BBox2D,
  step: number
): Position[][] {
  const { cols, rows } = computeGridDimensions(bbox, step);
  const positions: Position[][] = [];
  
  for (let row = 0; row < rows; row++) {
    const rowPositions: Position[] = [];
    for (let col = 0; col < cols; col++) {
      rowPositions.push([
        bbox.minX + col * step,
        bbox.minY + row * step,
      ]);
    }
    positions.push(rowPositions);
  }
  
  return positions;
}

/**
 * Crée une grille de terrain vide (placeholder)
 */
export function createEmptyTerrainGrid(
  bbox: BBox2D,
  step: number,
  defaultElevation: number = 0
): TerrainGrid {
  const { cols, rows } = computeGridDimensions(bbox, step);
  
  const elevations: number[][] = [];
  for (let row = 0; row < rows; row++) {
    elevations.push(new Array(cols).fill(defaultElevation));
  }
  
  return {
    origin: { x: bbox.minX, y: bbox.minY, z: defaultElevation },
    cols,
    rows,
    step,
    elevations,
  };
}

/**
 * Interpole l'élévation à une position donnée dans la grille
 */
export function interpolateElevation(
  grid: TerrainGrid,
  x: number,
  y: number
): number {
  // Convertir en coordonnées de grille
  const gx = (x - grid.origin.x) / grid.step;
  const gy = (y - grid.origin.y) / grid.step;
  
  // Indices des cellules voisines
  const col0 = Math.floor(gx);
  const row0 = Math.floor(gy);
  const col1 = col0 + 1;
  const row1 = row0 + 1;
  
  // Facteurs d'interpolation
  const tx = gx - col0;
  const ty = gy - row0;
  
  // Clamp aux limites de la grille
  const c0 = clamp(col0, 0, grid.cols - 1);
  const c1 = clamp(col1, 0, grid.cols - 1);
  const r0 = clamp(row0, 0, grid.rows - 1);
  const r1 = clamp(row1, 0, grid.rows - 1);
  
  // Interpolation bilinéaire
  const z00 = grid.elevations[r0][c0];
  const z10 = grid.elevations[r0][c1];
  const z01 = grid.elevations[r1][c0];
  const z11 = grid.elevations[r1][c1];
  
  const z0 = lerp(z00, z10, tx);
  const z1 = lerp(z01, z11, tx);
  
  return lerp(z0, z1, ty);
}

/**
 * Convertit un index de grille en position 3D
 */
export function gridIndexToPoint3D(
  grid: TerrainGrid,
  col: number,
  row: number
): Point3D {
  return {
    x: grid.origin.x + col * grid.step,
    y: grid.origin.y + row * grid.step,
    z: grid.elevations[row]?.[col] ?? grid.origin.z,
  };
}

/**
 * Vérifie si une position est dans les limites de la grille
 */
export function isInGridBounds(
  grid: TerrainGrid,
  x: number,
  y: number
): boolean {
  const gx = (x - grid.origin.x) / grid.step;
  const gy = (y - grid.origin.y) / grid.step;
  
  return gx >= 0 && gx < grid.cols && gy >= 0 && gy < grid.rows;
}

/**
 * Calcule la bbox d'une grille
 */
export function getGridBBox(grid: TerrainGrid): BBox2D {
  return {
    minX: grid.origin.x,
    minY: grid.origin.y,
    maxX: grid.origin.x + (grid.cols - 1) * grid.step,
    maxY: grid.origin.y + (grid.rows - 1) * grid.step,
  };
}