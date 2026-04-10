// src/spaces/promoteur/terrain3d/blender/blenderNaming.ts

// ─────────────────────────────────────────────────────────────
// PUBLIC API
// Convention de nommage contractuelle pour le pipeline Blender V1
// ─────────────────────────────────────────────────────────────

export function makeBuildingRootName(buildingId: string): string {
  return `MMZ_BUILDING_${sanitizeBlenderName(buildingId)}_ROOT`;
}

export function makeStructureName(buildingId: string): string {
  return `MMZ_BUILDING_${sanitizeBlenderName(buildingId)}_STRUCTURE`;
}

export function makeFacadeName(buildingId: string, facadeIndex: number): string {
  return `MMZ_BUILDING_${sanitizeBlenderName(buildingId)}_FACADE_${pad2(facadeIndex)}`;
}

export function makeGlazingName(buildingId: string, glazingIndex: number): string {
  return `MMZ_BUILDING_${sanitizeBlenderName(buildingId)}_GLAZING_${pad2(glazingIndex)}`;
}

export function makeRoofName(buildingId: string): string {
  return `MMZ_BUILDING_${sanitizeBlenderName(buildingId)}_ROOF`;
}

export function makeBalconyRailingName(
  buildingId: string,
  facadeIndex: number,
  balconyIndex: number,
): string {
  return `MMZ_BUILDING_${sanitizeBlenderName(buildingId)}_RAILING_${pad2(facadeIndex)}_${pad2(balconyIndex)}`;
}

export function makeBalconySlabName(
  buildingId: string,
  facadeIndex: number,
  balconyIndex: number,
): string {
  return `MMZ_BUILDING_${sanitizeBlenderName(buildingId)}_BALCONY_${pad2(facadeIndex)}_${pad2(balconyIndex)}`;
}

export function makeTerrainRootName(id: string = "main"): string {
  return `MMZ_TERRAIN_${sanitizeBlenderName(id)}_ROOT`;
}

export function makeTerrainName(id: string = "main"): string {
  return `MMZ_TERRAIN_${sanitizeBlenderName(id)}_TERRAIN`;
}

export function makeParkingRootName(parkingId: string): string {
  return `MMZ_PARKING_${sanitizeBlenderName(parkingId)}_ROOT`;
}

export function makeParkingSurfaceName(parkingId: string): string {
  return `MMZ_PARKING_${sanitizeBlenderName(parkingId)}_SURFACE`;
}

export function makeVegetationRootName(kind: "hedge" | "tree" | "bush", id: string): string {
  return `MMZ_${kind.toUpperCase()}_${sanitizeBlenderName(id)}_ROOT`;
}

export function makeTreeTrunkName(id: string): string {
  return `MMZ_TREE_${sanitizeBlenderName(id)}_TRUNK`;
}

export function makeTreeCanopyName(id: string): string {
  return `MMZ_TREE_${sanitizeBlenderName(id)}_CANOPY`;
}

export function makeHedgeName(id: string): string {
  return `MMZ_HEDGE_${sanitizeBlenderName(id)}_SEGMENT`;
}

export function makeBushName(id: string): string {
  return `MMZ_BUSH_${sanitizeBlenderName(id)}_CANOPY`;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

export function sanitizeBlenderName(input: string): string {
  const value = String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_\-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  return value || "Object";
}

function pad2(index: number): string {
  const safeIndex = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  return String(safeIndex).padStart(2, "0");
}