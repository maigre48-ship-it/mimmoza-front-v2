// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/three/createTerrainGeometry.ts
// ============================================================================

import type { TerrainGrid, Point3D } from '../types/terrain.types';

/**
 * Représentation stub d'une géométrie Three.js
 * 
 * TODO: Remplacer par THREE.BufferGeometry quand three.js sera disponible
 */
export interface StubGeometry {
  /** Type de géométrie */
  type: 'terrain' | 'volume' | 'custom';
  /** Vertices (positions x,y,z aplaties) */
  vertices: Float32Array;
  /** Normales (nx,ny,nz aplaties) */
  normals: Float32Array;
  /** UVs (u,v aplatis) */
  uvs: Float32Array;
  /** Indices des triangles */
  indices: Uint32Array;
  /** Nombre de vertices */
  vertexCount: number;
  /** Nombre de triangles */
  triangleCount: number;
}

/**
 * Crée une géométrie vide stub
 */
function createEmptyGeometry(type: StubGeometry['type']): StubGeometry {
  return {
    type,
    vertices: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    indices: new Uint32Array(0),
    vertexCount: 0,
    triangleCount: 0,
  };
}

/**
 * Options de création de géométrie terrain
 */
export interface TerrainGeometryOptions {
  /** Exagération verticale */
  verticalExaggeration?: number;
  /** Générer les normales */
  computeNormals?: boolean;
  /** Générer les UVs */
  computeUVs?: boolean;
}

/**
 * Crée une géométrie de terrain à partir d'une grille d'élévation
 * 
 * TODO: Implémenter la création réelle de BufferGeometry avec three.js
 * Pour l'instant, retourne une structure stub avec les métadonnées
 */
export function createTerrainGeometry(
  grid: TerrainGrid,
  options: TerrainGeometryOptions = {}
): StubGeometry {
  const {
    verticalExaggeration = 1,
    computeNormals = true,
    computeUVs = true,
  } = options;
  
  const { rows, cols } = grid;
  
  if (rows < 2 || cols < 2) {
    console.warn('[createTerrainGeometry] Grid too small, returning empty geometry');
    return createEmptyGeometry('terrain');
  }
  
  // Calcul des tailles
  const vertexCount = rows * cols;
  const triangleCount = (rows - 1) * (cols - 1) * 2;
  
  // TODO: Remplir les arrays avec les vraies données
  // Pour l'instant, on crée juste les structures vides de la bonne taille
  const vertices = new Float32Array(vertexCount * 3);
  const normals = computeNormals ? new Float32Array(vertexCount * 3) : new Float32Array(0);
  const uvs = computeUVs ? new Float32Array(vertexCount * 2) : new Float32Array(0);
  const indices = new Uint32Array(triangleCount * 3);
  
  // TODO: Implémenter le remplissage des vertices
  // Pseudo-code de ce qui sera fait:
  // for (let row = 0; row < rows; row++) {
  //   for (let col = 0; col < cols; col++) {
  //     const idx = row * cols + col;
  //     vertices[idx * 3 + 0] = grid.origin.x + col * grid.step;
  //     vertices[idx * 3 + 1] = grid.origin.y + row * grid.step;
  //     vertices[idx * 3 + 2] = grid.elevations[row][col] * verticalExaggeration;
  //   }
  // }
  
  console.info(
    `[createTerrainGeometry] Stub geometry created: ${vertexCount} vertices, ${triangleCount} triangles`
  );
  
  return {
    type: 'terrain',
    vertices,
    normals,
    uvs,
    indices,
    vertexCount,
    triangleCount,
  };
}

/**
 * Libère les ressources d'une géométrie stub
 * 
 * TODO: Appeler geometry.dispose() sur la vraie géométrie Three.js
 */
export function disposeTerrainGeometry(geometry: StubGeometry): void {
  // TODO: geometry.dispose() quand three.js sera disponible
  console.info('[disposeTerrainGeometry] Geometry disposed (stub)');
}