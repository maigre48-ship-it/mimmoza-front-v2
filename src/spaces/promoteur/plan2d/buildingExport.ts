// src/spaces/promoteur/plan2d/buildingExport.ts — V2
// Export avec volumes composés

import jsPDF from 'jspdf';
import type { Building2D, Parking2D } from './editor2d.types';
import type { ExportedBuilding, ExportedParking, ExportedScene } from './buildingProgram.types';
import { rectCorners } from './editor2d.geometry';
import { getBuildingVolumes } from './editor2d.store';

// ─── HELPERS ──────────────────────────────────────────────────────────

function totalHeightM(b: Building2D): number {
  return b.groundFloorHeightM + b.floorsAboveGround * b.typicalFloorHeightM;
}

function exportBuilding(b: Building2D): ExportedBuilding {
  const corners = rectCorners(b.rect);
  const vols    = getBuildingVolumes(b);
  return {
    id: b.id, label: b.label, buildingType: b.buildingType,
    footprint: {
      center: { x:b.rect.center.x, y:b.rect.center.y },
      width: b.rect.width, depth: b.rect.depth, rotationDeg: b.rect.rotationDeg,
      polygonLocal: corners.map(p=>({x:p.x,y:p.y})),
    },
    volumes: vols.map(v => {
      const vc = rectCorners(v.rect);
      return {
        id: v.id, role: v.role,
        footprint: {
          center: {x:v.rect.center.x,y:v.rect.center.y},
          width: v.rect.width, depth: v.rect.depth, rotationDeg: v.rect.rotationDeg,
          polygonLocal: vc.map(p=>({x:p.x,y:p.y})),
        },
      };
    }),
    program: {
      floorsAboveGround:   b.floorsAboveGround,
      groundFloorHeightM:  b.groundFloorHeightM,
      typicalFloorHeightM: b.typicalFloorHeightM,
      totalHeightM:        totalHeightM(b),
      roofType:            b.roofType ?? 'flat',
      facadeMainEdge:      b.facadeMainEdge,
    },
    levels:    b.levelProfiles?.length ? b.levelProfiles : undefined,
    balconies: b.balconies?.length     ? b.balconies     : undefined,
    loggias:   b.loggias?.length       ? b.loggias       : undefined,
    terraces:  b.terraces?.length      ? b.terraces      : undefined,
  };
}

function exportParking(p: Parking2D): ExportedParking {
  return { id:p.id, footprint:{center:p.rect.center,width:p.rect.width,depth:p.rect.depth,rotationDeg:p.rect.rotationDeg}, slotCount:p.slotCount, slotWidth:p.slotWidth, slotDepth:p.slotDepth };
}

// ─── MAIN ─────────────────────────────────────────────────────────────

export interface BuildingExportParams {
  parcelPolygon: { x:number; y:number }[];
  buildings:     Building2D[];
  parkings:      Parking2D[];
}

export function exportScene(params: BuildingExportParams): ExportedScene {
  return {
    version: "1.0", exportedAt: new Date().toISOString(),
    site:      { parcelPolygon: params.parcelPolygon },
    buildings: params.buildings.map(exportBuilding),
    parkings:  params.parkings.map(exportParking),
  };
}

export function exportSceneAsJson(params: BuildingExportParams): string {
  return JSON.stringify(exportScene(params), null, 2);
}

export function downloadSceneJson(params: BuildingExportParams, filename = 'mimmoza-scene.json'): void {
  const blob = new Blob([exportSceneAsJson(params)], { type:'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

export async function copySceneJsonToClipboard(params: BuildingExportParams): Promise<void> {
  await navigator.clipboard.writeText(exportSceneAsJson(params));
}