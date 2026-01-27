// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/three/createVolumeGeometry.ts
// ============================================================================

import type { Feature, Polygon, Position } from 'geojson';
import type { StubGeometry } from './createTerrainGeometry';
import type { VolumeExtrusionConfig } from '../types/volume.types';

/**
 * Options de création de géométrie de volume
 */
export interface VolumeGeometryOptions extends Partial<VolumeExtrusionConfig> {
  /** Fermer le dessus du volume */
  closedTop?: boolean;
  /** Fermer le dessous du volume */
  closedBottom?: boolean;
}

/**
 * Valeurs par défaut pour l'extrusion
 */
const DEFAULT_VOLUME_OPTIONS: Required<VolumeGeometryOptions> = {
  height: 9,
  baseOffset: 0,
  bevelEnabled: false,
  bevelSize: 0,
  closedTop: true,
  closedBottom: true,
};

/**
 * Crée une géométrie vide stub pour volume
 */
function createEmptyVolumeGeometry(): StubGeometry {
  return {
    type: 'volume',
    vertices: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    indices: new Uint32Array(0),
    vertexCount: 0,
    triangleCount: 0,
  };
}

/**
 * Extrait les coordonnées d'un polygon GeoJSON
 */
function extractPolygonCoords(polygon: Feature<Polygon>): Position[] {
  const coords = polygon.geometry.coordinates;
  if (!coords || coords.length === 0) return [];
  
  // Prend l'anneau extérieur (premier anneau)
  const ring = coords[0];
  if (!ring || ring.length < 3) return [];
  
  // Enlève le dernier point s'il est identique au premier (fermé)
  const positions = [...ring];
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    positions.pop();
  }
  
  return positions;
}

/**
 * Crée une géométrie de volume extrudé à partir d'un polygon GeoJSON
 * 
 * TODO: Implémenter avec THREE.ExtrudeGeometry ou construction manuelle
 * Pour l'instant, retourne une structure stub
 */
export function createVolumeGeometry(
  footprint: Feature<Polygon>,
  options: VolumeGeometryOptions = {}
): StubGeometry {
  const opts = { ...DEFAULT_VOLUME_OPTIONS, ...options };
  
  const positions = extractPolygonCoords(footprint);
  if (positions.length < 3) {
    console.warn('[createVolumeGeometry] Invalid polygon, returning empty geometry');
    return createEmptyVolumeGeometry();
  }
  
  const numPoints = positions.length;
  
  // Estimation du nombre de vertices et triangles pour un volume extrudé
  // Murs: numPoints * 2 vertices, numPoints * 2 triangles
  // Dessus/dessous: numPoints vertices chacun, (numPoints - 2) triangles chacun
  const wallVertices = numPoints * 4; // 2 vertices par arête × 2 (haut/bas)
  const capVertices = opts.closedTop ? numPoints : 0;
  const bottomVertices = opts.closedBottom ? numPoints : 0;
  const vertexCount = wallVertices + capVertices + bottomVertices;
  
  const wallTriangles = numPoints * 2;
  const capTriangles = opts.closedTop ? numPoints - 2 : 0;
  const bottomTriangles = opts.closedBottom ? numPoints - 2 : 0;
  const triangleCount = wallTriangles + capTriangles + bottomTriangles;
  
  // TODO: Remplir les arrays
  const vertices = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(triangleCount * 3);
  
  console.info(
    `[createVolumeGeometry] Stub geometry created: ${numPoints} points, height=${opts.height}m`
  );
  
  return {
    type: 'volume',
    vertices,
    normals,
    uvs,
    indices,
    vertexCount,
    triangleCount,
  };
}

/**
 * Crée plusieurs géométries de volumes et les merge (stub)
 * 
 * TODO: Implémenter le merge avec THREE.BufferGeometryUtils
 */
export function createMergedVolumesGeometry(
  footprints: Feature<Polygon>[],
  options: VolumeGeometryOptions = {}
): StubGeometry {
  if (footprints.length === 0) {
    return createEmptyVolumeGeometry();
  }
  
  // TODO: Merger les géométries
  // Pour l'instant, retourne juste la première
  console.info(
    `[createMergedVolumesGeometry] Would merge ${footprints.length} volumes (stub)`
  );
  
  return createVolumeGeometry(footprints[0], options);
}

/**
 * Libère les ressources d'une géométrie de volume
 */
export function disposeVolumeGeometry(geometry: StubGeometry): void {
  console.info('[disposeVolumeGeometry] Geometry disposed (stub)');
}