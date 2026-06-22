// buildArchitecturalMeshGroups.ts
// STUB — enrichissement mesh architectural V3 non encore implémenté.
// Retourne une liste vide : le rendu fonctionne sans enrichissement.
// À remplacer par la vraie génération de meshes architecturaux (chantier 3D).

import type * as THREE from 'three';

export interface ArchitecturalStyle {
  renderIntent?: string;
  glazingOpacity?: number;
  balconyRailingType?: string;
  socleFinish?: string;
  [key: string]: unknown;
}

export interface BuildingEnvelope {
  footprint: Array<[number, number]> | unknown;
  totalHeightM: number;
  [key: string]: unknown;
}

export interface ArchMeshGroupResult {
  name: string;
  category: string;
  mesh: THREE.Mesh;
}

export const DEFAULT_STYLE: ArchitecturalStyle = {
  renderIntent: 'default',
  glazingOpacity: 1,
};

export function buildArchitecturalMeshGroups(
  _buildingName: string,
  _envelope: BuildingEnvelope,
  _style: ArchitecturalStyle,
): ArchMeshGroupResult[] {
  // STUB : pas d'enrichissement pour l'instant.
  return [];
}