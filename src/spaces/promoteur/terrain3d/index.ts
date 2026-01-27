// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/index.ts
// ============================================================================

// === Types ===
export * from './types/terrain.types';
export * from './types/volume.types';
export * from './types/earthworks.types';

// === Utils ===
export * from './utils/math3d.utils';
export * from './utils/grid.utils';

// === Services ===
export * from './services/terrainSampling.service';
export * from './services/slope.service';
export * from './services/earthworks.service';

// === Three.js stubs ===
export * from './three/createTerrainGeometry';
export * from './three/createVolumeGeometry';
export * from './three/materials';

// === Hooks ===
export { useMassingScene } from './hooks/useMassingScene';
export { useTerrainMesh } from './hooks/useTerrainMesh';
export { useProjectVolumes } from './hooks/useProjectVolumes';

// === Components ===
export { Massing3DCanvas } from './components/Massing3DCanvas';
export { TerrainMesh } from './components/TerrainMesh';
export { ProjectVolumes } from './components/ProjectVolumes';
export { Controls3D } from './components/Controls3D';

// === Default export: Main component ===
export { Massing3DCanvas as default } from './components/Massing3DCanvas';