// ============================================================================
// FILE: src/spaces/promoteur/terrain3d/index.ts
// ============================================================================

// === Types ===
export * from './types/earthworks.types';
export * from './types/terrain.types';
export * from './types/volume.types';

// === Utils ===
export * from './utils/grid.utils';
export * from './utils/math3d.utils';

// === Services ===
export * from './services/earthworks.service';
export * from './services/slope.service';
export * from './services/terrainSampling.service';

// === Three.js stubs ===
export * from './three/createTerrainGeometry';
export * from './three/createVolumeGeometry';
export * from './three/materials';

// === Hooks ===
export { useMassingScene } from './hooks/useMassingScene';
export { useProjectVolumes } from './hooks/useProjectVolumes';
export { useTerrainMesh } from './hooks/useTerrainMesh';

// === Components ===
export { Controls3D } from './components/Controls3D';
export { Massing3DCanvas } from './components/Massing3DCanvas';
export { ProjectVolumes } from './components/ProjectVolumes';
export { TerrainMesh } from './components/TerrainMesh';

// === Default export: Main component ===
export { Massing3DCanvas as default } from './components/Massing3DCanvas';
