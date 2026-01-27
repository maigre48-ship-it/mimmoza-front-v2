// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/three/materials.ts
// ============================================================================

/**
 * Représentation stub d'un matériau Three.js
 * 
 * TODO: Remplacer par THREE.Material quand three.js sera disponible
 */
export interface StubMaterial {
  /** Type de matériau */
  type: 'basic' | 'standard' | 'phong' | 'lambert' | 'shader';
  /** Nom du matériau */
  name: string;
  /** Couleur (hex) */
  color: number;
  /** Opacité */
  opacity: number;
  /** Transparent */
  transparent: boolean;
  /** Wireframe */
  wireframe: boolean;
  /** Double face */
  side: 'front' | 'back' | 'double';
  /** Propriétés additionnelles */
  properties: Record<string, unknown>;
}

/**
 * Palette de couleurs pour le projet
 */
export const MASSING_COLORS = {
  // Terrain
  terrain: {
    natural: 0x8b9556, // Vert terrain naturel
    project: 0xc4a35a, // Beige terrain projet
    wireframe: 0x333333,
  },
  // Volumes
  building: {
    default: 0xe8e8e8, // Gris clair
    selected: 0x4a90d9, // Bleu sélection
    hover: 0xf5f5f5,
  },
  parking: {
    default: 0x707070, // Gris moyen
    selected: 0x4a90d9,
    hover: 0x909090,
  },
  // Terrassement
  earthworks: {
    cut: 0xd9534f, // Rouge déblai
    fill: 0x5cb85c, // Vert remblai
    neutral: 0xf0ad4e, // Orange neutre
  },
  // UI
  ui: {
    grid: 0xcccccc,
    axis: 0x666666,
    highlight: 0xffff00,
  },
} as const;

/**
 * Crée un matériau stub de base
 */
function createBaseMaterial(
  name: string,
  color: number,
  options: Partial<StubMaterial> = {}
): StubMaterial {
  return {
    type: 'standard',
    name,
    color,
    opacity: 1,
    transparent: false,
    wireframe: false,
    side: 'front',
    properties: {},
    ...options,
  };
}

/**
 * Crée le matériau pour le terrain naturel
 * 
 * TODO: Implémenter avec THREE.MeshStandardMaterial
 */
export function createTerrainNaturalMaterial(): StubMaterial {
  return createBaseMaterial('terrain-natural', MASSING_COLORS.terrain.natural, {
    properties: {
      roughness: 0.9,
      metalness: 0,
    },
  });
}

/**
 * Crée le matériau pour le terrain projet
 */
export function createTerrainProjectMaterial(): StubMaterial {
  return createBaseMaterial('terrain-project', MASSING_COLORS.terrain.project, {
    properties: {
      roughness: 0.8,
      metalness: 0,
    },
  });
}

/**
 * Crée le matériau wireframe
 */
export function createWireframeMaterial(): StubMaterial {
  return createBaseMaterial('wireframe', MASSING_COLORS.terrain.wireframe, {
    wireframe: true,
    transparent: true,
    opacity: 0.3,
  });
}

/**
 * Crée le matériau pour les bâtiments
 */
export function createBuildingMaterial(selected: boolean = false): StubMaterial {
  const color = selected
    ? MASSING_COLORS.building.selected
    : MASSING_COLORS.building.default;
  
  return createBaseMaterial('building', color, {
    properties: {
      roughness: 0.5,
      metalness: 0.1,
    },
  });
}

/**
 * Crée le matériau pour les parkings
 */
export function createParkingMaterial(selected: boolean = false): StubMaterial {
  const color = selected
    ? MASSING_COLORS.parking.selected
    : MASSING_COLORS.parking.default;
  
  return createBaseMaterial('parking', color, {
    properties: {
      roughness: 0.7,
      metalness: 0,
    },
  });
}

/**
 * Crée le matériau pour les zones de déblai
 */
export function createCutMaterial(): StubMaterial {
  return createBaseMaterial('cut', MASSING_COLORS.earthworks.cut, {
    transparent: true,
    opacity: 0.6,
  });
}

/**
 * Crée le matériau pour les zones de remblai
 */
export function createFillMaterial(): StubMaterial {
  return createBaseMaterial('fill', MASSING_COLORS.earthworks.fill, {
    transparent: true,
    opacity: 0.6,
  });
}

/**
 * Libère les ressources d'un matériau
 * 
 * TODO: Appeler material.dispose() sur le vrai matériau Three.js
 */
export function disposeMaterial(material: StubMaterial): void {
  console.info(`[disposeMaterial] Material '${material.name}' disposed (stub)`);
}

/**
 * Crée tous les matériaux nécessaires pour la scène
 */
export function createSceneMaterials(): Record<string, StubMaterial> {
  return {
    terrainNatural: createTerrainNaturalMaterial(),
    terrainProject: createTerrainProjectMaterial(),
    wireframe: createWireframeMaterial(),
    building: createBuildingMaterial(),
    buildingSelected: createBuildingMaterial(true),
    parking: createParkingMaterial(),
    parkingSelected: createParkingMaterial(true),
    cut: createCutMaterial(),
    fill: createFillMaterial(),
  };
}

/**
 * Libère tous les matériaux de la scène
 */
export function disposeSceneMaterials(
  materials: Record<string, StubMaterial>
): void {
  Object.values(materials).forEach(disposeMaterial);
}