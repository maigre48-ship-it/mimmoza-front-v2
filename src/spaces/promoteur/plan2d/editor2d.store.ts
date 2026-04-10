// src/spaces/promoteur/plan2d/editor2d.store.ts — V4 multi-étages

import { create } from 'zustand';
import type { Editor2DState, Editor2DActions, Building2D, Parking2D, OrientedRect, CotesVisibility, Tool } from './editor2d.types';
import type { BuildingVolume2D, FloorPlan2D } from './buildingProgram.types';
import { genId, rectCorners, computeParkingSlots } from './editor2d.geometry';

// ─── HELPERS EXPORTÉS ─────────────────────────────────────────────────

const levelLabel = (n: number): string => n === 0 ? 'RDC' : `R+${n}`;

/**
 * Retourne les volumes d'un bâtiment à un étage donné.
 * Gère la migration des anciens bâtiments sans floorPlans.
 */
export function getFloorVolumes(b: Building2D, levelIndex: number): BuildingVolume2D[] {
  if (b.floorPlans && b.floorPlans.length > 0) {
    const fp = b.floorPlans.find(p => p.levelIndex === levelIndex);
    return fp?.volumes ?? [];
  }
  if (levelIndex === 0) {
    if (b.volumes && b.volumes.length > 0) return b.volumes;
    return [{ id: `${b.id}-main`, rect: b.rect, role: 'main' as const }];
  }
  return [];
}

export function getBuildingVolumes(b: Building2D): BuildingVolume2D[] {
  return getFloorVolumes(b, 0);
}

// ─── GÉOMÉTRIE INTERNE ────────────────────────────────────────────────

function edgeMidpoints(rect: OrientedRect): { x:number; y:number }[] {
  const c = rectCorners(rect);
  return [
    { x:(c[0].x+c[1].x)/2, y:(c[0].y+c[1].y)/2 },
    { x:(c[1].x+c[2].x)/2, y:(c[1].y+c[2].y)/2 },
    { x:(c[2].x+c[3].x)/2, y:(c[2].y+c[3].y)/2 },
    { x:(c[3].x+c[0].x)/2, y:(c[3].y+c[0].y)/2 },
  ];
}

function computeConnector(
  setA: BuildingVolume2D[],
  setB: BuildingVolume2D[],
  widthM = 4,
): BuildingVolume2D | null {
  let minDist = Infinity;
  let ptA: { x:number;y:number } | null = null;
  let ptB: { x:number;y:number } | null = null;

  for (const va of setA) {
    const ma = edgeMidpoints(va.rect);
    for (const vb of setB) {
      const mb = edgeMidpoints(vb.rect);
      for (const a of ma) {
        for (const b of mb) {
          const d = Math.hypot(a.x-b.x, a.y-b.y);
          if (d < minDist) { minDist=d; ptA=a; ptB=b; }
        }
      }
    }
  }

  if (!ptA || !ptB || minDist < 0.2) return null;
  const dx=ptB.x-ptA.x, dy=ptB.y-ptA.y, len=Math.hypot(dx,dy);
  if (len < 0.2) return null;

  return {
    id: genId(),
    rect: {
      center: { x:(ptA.x+ptB.x)/2, y:(ptA.y+ptB.y)/2 },
      width: len, depth: widthM,
      rotationDeg: Math.atan2(dy, dx) * 180 / Math.PI,
    },
    role: 'connector' as const,
  };
}

function computeBoundingRect(volumes: BuildingVolume2D[]): OrientedRect {
  if (!volumes.length) return { center:{x:0,y:0}, width:1, depth:1, rotationDeg:0 };
  const corners = volumes.flatMap(v => rectCorners(v.rect));
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
  return { center:{x:(minX+maxX)/2,y:(minY+maxY)/2}, width:Math.max(0.1,maxX-minX), depth:Math.max(0.1,maxY-minY), rotationDeg:0 };
}

function applyDeltaToVolumes(
  volumes: BuildingVolume2D[],
  dx: number, dy: number, drot: number,
  rotCenter: {x:number;y:number},
): BuildingVolume2D[] {
  const hasRot = Math.abs(drot) > 0.001;
  return volumes.map(v => {
    let cx = v.rect.center.x + dx;
    let cy = v.rect.center.y + dy;
    if (hasRot) {
      const rad = drot * Math.PI/180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const rx = cx - rotCenter.x, ry = cy - rotCenter.y;
      cx = rotCenter.x + rx*cos - ry*sin;
      cy = rotCenter.y + rx*sin + ry*cos;
    }
    return { ...v, rect: { ...v.rect, center:{x:cx,y:cy}, rotationDeg:((v.rect.rotationDeg+drot)%360+360)%360 }};
  });
}

// ─── MIGRATION ────────────────────────────────────────────────────────

function migrateBuilding(raw: Building2D & { levels?: number }): Building2D {
  const floorsAboveGround = raw.floorsAboveGround ?? Math.max(0, (raw.levels ?? 3) - 1);

  let floorPlans = raw.floorPlans;
  if (!floorPlans || floorPlans.length === 0) {
    const groundVols: BuildingVolume2D[] = raw.volumes && raw.volumes.length > 0
      ? raw.volumes
      : [{ id: genId(), rect: raw.rect, role: 'main' as const }];
    floorPlans = [{
      id: genId(), levelIndex: 0, label: 'RDC', volumes: groundVols,
      balconies: raw.balconies ?? [],
      loggias:   raw.loggias   ?? [],
      terraces:  raw.terraces  ?? [],
    }];
  } else {
    floorPlans = floorPlans.map(fp => {
      if (fp.levelIndex !== 0) return fp;
      return {
        ...fp,
        balconies: fp.balconies ?? raw.balconies ?? [],
        loggias:   fp.loggias   ?? raw.loggias   ?? [],
        terraces:  fp.terraces  ?? raw.terraces  ?? [],
      };
    });
  }

  return {
    ...raw,
    kind: raw.kind ?? 'building',
    floorsAboveGround,
    groundFloorHeightM:  raw.groundFloorHeightM  ?? 3.0,
    typicalFloorHeightM: raw.typicalFloorHeightM ?? 2.8,
    roofType:  raw.roofType  ?? 'flat',
    balconies: raw.balconies ?? [],
    loggias:   raw.loggias   ?? [],
    terraces:  raw.terraces  ?? [],
    volumes:   [],
    floorPlans,
  };
}

// ─── PERSISTENCE ──────────────────────────────────────────────────────

const STORAGE_KEY = 'mimmoza_plan2d_v1';
interface Persisted { buildings:Building2D[]; parkings:Parking2D[] }

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Persisted;
      return {
        buildings: (data.buildings ?? [])
          .map(b => migrateBuilding(b as Building2D & {levels?:number}))
          .filter(b => b.rect.width * b.rect.depth > 0.1),
        parkings: data.parkings ?? [],
      };
    }
  } catch {}
  return { buildings:[], parkings:[] };
}

function save(buildings: Building2D[], parkings: Parking2D[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ buildings, parkings })); }
  catch {}
}

const persisted = load();

// ─── STORE ────────────────────────────────────────────────────────────

export const useEditor2DStore = create<Editor2DState & Editor2DActions>((set, get) => ({
  activeTool:       'selection',
  buildings:        persisted.buildings,
  parkings:         persisted.parkings,
  selectedIds:      [], hoveredId: null,
  snapOptions:      { grid:true, gridSize:1, parcelleVertices:true, parcelleEdges:true, orthogonal:true, thresholdPx:12 },
  cotesVisible:     false,
  cotesVisibility:  { buildingDims:true, parcelleSetbacks:true, interBuilding:true, parkingDims:true },
  activeLevelIndex: 0,
  showGhost:        true,
  parcelFrontEdgeIndex: null,
  setbackRules: { frontM:5, sideM:3, rearM:3 },

  setTool: (tool) => set({ activeTool: tool }),

  addBuilding: (b) => {
    const building: Building2D = {
      floorsAboveGround:0, groundFloorHeightM:3.0, typicalFloorHeightM:2.8,
      roofType:'flat', balconies:[], loggias:[], terraces:[], volumes:[],
      floorPlans: [],
      kind: 'building',
      ...b,
    };
    const next = [...get().buildings, building];
    save(next, get().parkings);
    set({ buildings: next });
  },

  addParking: (p) => {
    const next = [...get().parkings, p];
    save(get().buildings, next);
    set({ parkings: next });
  },

  updateBuildingRect: (id, rect, persist = true) => {
    const old = get().buildings.find(b => b.id === id);
    const next = get().buildings.map(b => {
      if (b.id !== id) return b;
      if (!old) return { ...b, rect };
      const dx   = rect.center.x    - old.rect.center.x;
      const dy   = rect.center.y    - old.rect.center.y;
      const drot = rect.rotationDeg - old.rect.rotationDeg;
      const updatedFloorPlans = (b.floorPlans ?? []).map(fp => ({
        ...fp,
        volumes: applyDeltaToVolumes(fp.volumes, dx, dy, drot, rect.center),
      }));
      return { ...b, rect, volumes:[], floorPlans: updatedFloorPlans };
    });
    if (persist) save(next, get().parkings);
    set({ buildings: next });
  },

  // ── CORRECTION PRINCIPALE ─────────────────────────────────────────
  // slotCount est recalculé à chaque changement de rect.
  // C'est la source de vérité pour providedParkingSpaces dans le panneau.
  // Sans ce recalcul, le panneau affichait la valeur d'initialisation
  // même après redimensionnement du parking.
  updateParkingRect: (id, rect, persist = true) => {
    const next = get().parkings.map(p => {
      if (p.id !== id) return p;
      const newSlotCount = computeParkingSlots(
        rect.width,
        rect.depth,
        p.slotWidth       ?? 2.5,
        p.slotDepth       ?? 5.0,
        p.driveAisleWidth ?? 6.0,
      );
      return { ...p, rect, slotCount: newSlotCount };
    });
    if (persist) save(get().buildings, next);
    set({ parkings: next });
  },

  updateBuildingProgram: (id, patch) => {
    const next = get().buildings.map(b => b.id === id ? { ...b, ...patch } : b);
    save(next, get().parkings);
    set({ buildings: next });
  },

  updateFloorPlan: (buildingId, levelIndex, patch) => {
    const { buildings, parkings } = get();
    const next = buildings.map(b => {
      if (b.id !== buildingId) return b;
      const fps = (b.floorPlans ?? []).map(fp =>
        fp.levelIndex === levelIndex ? { ...fp, ...patch } : fp
      );
      return { ...b, floorPlans: fps };
    });
    save(next, parkings);
    set({ buildings: next });
  },

  mergeBuildings: (ids: string[]) => {
    const { buildings, parkings } = get();
    const toMerge = buildings.filter(b => ids.includes(b.id) && b.kind === 'building');
    if (toMerge.length < 2) return;

    const allLevels = new Set<number>();
    toMerge.forEach(b => (b.floorPlans ?? []).forEach(fp => allLevels.add(fp.levelIndex)));
    if (!allLevels.size) allLevels.add(0);

    const mergedPlans: FloorPlan2D[] = Array.from(allLevels).sort((a,b)=>a-b).map(li => {
      const buildingVols = toMerge.map(b => getFloorVolumes(b, li));
      const vols: BuildingVolume2D[] = [];
      buildingVols.forEach((bvols, bi) => {
        bvols.forEach((v, vi) => vols.push({ ...v, role: bi===0&&vi===0 ? 'main' : 'wing' }));
      });
      for (let i = 0; i < buildingVols.length - 1; i++) {
        const setA = buildingVols[i];
        const setB = buildingVols[i + 1];
        if (!setA.length || !setB.length) continue;
        const connector = computeConnector(setA, setB, 4);
        if (connector) vols.push(connector);
      }
      return { id:genId(), levelIndex:li, label:levelLabel(li), volumes:vols };
    });

    const l0vols = mergedPlans.find(fp => fp.levelIndex === 0)?.volumes
      ?? mergedPlans[0]?.volumes ?? [];
    const nonConnectors = l0vols.filter(v => v.role !== 'connector');
    const boundingRect = nonConnectors.length
      ? computeBoundingRect(nonConnectors)
      : toMerge[0].rect;

    const master = toMerge[0];
    const newId  = genId();

    const merged: Building2D = {
      ...master, id:newId, rect:boundingRect, volumes:[], floorPlans:mergedPlans,
      kind: 'building',
      floorsAboveGround: Math.max(...mergedPlans.map(fp => fp.levelIndex)),
    };

    const nextBuildings = [...buildings.filter(b => !ids.includes(b.id)), merged];
    save(nextBuildings, parkings);
    set({ buildings:nextBuildings, selectedIds:[newId] });
  },

  splitBuilding: (id: string) => {
    const { buildings, parkings, activeLevelIndex } = get();
    const b = buildings.find(x => x.id === id);
    if (!b) return;

    const vols = getFloorVolumes(b, activeLevelIndex).filter(v => v.role !== 'connector');
    if (vols.length < 2) return;

    const label = levelLabel(activeLevelIndex);
    const split: Building2D[] = vols.map((v, i) => ({
      ...b, id:genId(), rect:v.rect, volumes:[],
      kind: 'building' as const,
      floorPlans:[{ id:genId(), levelIndex:activeLevelIndex, label, volumes:[{ ...v, id:genId(), role:'main' as const }] }],
      label: i===0 ? b.label : `${b.label} ${String.fromCharCode(65+i)}`,
    }));

    const nextBuildings = [...buildings.filter(x => x.id !== id), ...split];
    save(nextBuildings, parkings);
    set({ buildings:nextBuildings, selectedIds:[] });
  },

  deleteSelected: () => {
    const { selectedIds, buildings, parkings } = get();
    const nextB = buildings.filter(b => !selectedIds.includes(b.id));
    const nextP = parkings.filter(p => !selectedIds.includes(p.id));
    save(nextB, nextP);
    set({ buildings:nextB, parkings:nextP, selectedIds:[] });
  },

  duplicateSelected: () => {
    const { selectedIds, buildings, parkings } = get();
    const OFFSET = 5;
    const newBuildings: Building2D[] = [];
    const newParkings:  Parking2D[]  = [];
    const newIds: string[] = [];

    for (const id of selectedIds) {
      const b = buildings.find(x => x.id === id);
      if (b) {
        const nid = genId();
        newBuildings.push({
          ...b, id:nid, kind: 'building',
          rect: { ...b.rect, center:{ x:b.rect.center.x+OFFSET, y:b.rect.center.y+OFFSET } },
          volumes: [],
          floorPlans: (b.floorPlans ?? []).map(fp => ({
            ...fp, id:genId(),
            volumes: fp.volumes.map(v => ({
              ...v, id:genId(),
              rect: { ...v.rect, center:{ x:v.rect.center.x+OFFSET, y:v.rect.center.y+OFFSET } },
            })),
          })),
        });
        newIds.push(nid);
      }
      const p = parkings.find(x => x.id === id);
      if (p) {
        const nid = genId();
        // slotCount recalculé pour le doublon au même rect
        const newSlotCount = computeParkingSlots(
          p.rect.width, p.rect.depth,
          p.slotWidth ?? 2.5, p.slotDepth ?? 5.0, p.driveAisleWidth ?? 6.0,
        );
        newParkings.push({
          ...p,
          id: nid,
          rect: { ...p.rect, center:{ x:p.rect.center.x+OFFSET, y:p.rect.center.y+OFFSET } },
          slotCount: newSlotCount,
        });
        newIds.push(nid);
      }
    }

    const nextB = [...buildings, ...newBuildings];
    const nextP = [...parkings,  ...newParkings];
    save(nextB, nextP);
    set({ buildings:nextB, parkings:nextP, selectedIds:newIds });
  },

  selectIds: (ids, add=false) => {
    if (add) set({ selectedIds: Array.from(new Set([...get().selectedIds, ...ids])) });
    else     set({ selectedIds: ids });
  },
  clearSelection:     () => set({ selectedIds:[] }),
  setHovered:         (id) => set({ hoveredId:id }),
  setCotesVisible:    (v)  => set({ cotesVisible:v }),
  setCotesVisibility: (p)  => set(s => ({ cotesVisibility:{ ...s.cotesVisibility, ...p } })),

  setActiveLevelIndex: (idx) => set({ activeLevelIndex:idx, selectedIds:[] }),
  setShowGhost: (v) => set({ showGhost:v }),
  setParcelFrontEdge: (idx) => set({ parcelFrontEdgeIndex:idx }),
  setSetbackRules: (patch) => set(s => ({ setbackRules:{ ...s.setbackRules, ...patch } })),

  addFloorToAll: (levelIndex: number) => {
    const { buildings, parkings } = get();
    const lbl = levelLabel(levelIndex);
    const next = buildings.map(b => {
      const exists = (b.floorPlans ?? []).some(fp => fp.levelIndex === levelIndex);
      if (exists) return b;
      const newFP: FloorPlan2D = { id:genId(), levelIndex, label:lbl, volumes:[] };
      const fps = [...(b.floorPlans ?? []), newFP].sort((a,b)=>a.levelIndex-b.levelIndex);
      return { ...b, floorsAboveGround:Math.max(b.floorsAboveGround, levelIndex), floorPlans:fps };
    });
    save(next, parkings);
    set({ buildings:next, activeLevelIndex:levelIndex, selectedIds:[] });
  },

  duplicateFloorToActive: () => {
    const { buildings, parkings, activeLevelIndex } = get();
    if (activeLevelIndex === 0) return;
    const sourceLevel = activeLevelIndex - 1;
    const targetLbl   = levelLabel(activeLevelIndex);

    const next = buildings.map(b => {
      const sourceVols = getFloorVolumes(b, sourceLevel);
      if (!sourceVols.length) return b;
      const sourceFP = (b.floorPlans ?? []).find(fp => fp.levelIndex === sourceLevel);
      const newFP: FloorPlan2D = {
        id:genId(), levelIndex:activeLevelIndex, label:targetLbl,
        volumes:   sourceVols.map(v => ({ ...v, id:genId() })),
        balconies: (sourceFP?.balconies ?? []).map(x => ({ ...x, id:genId() })),
        loggias:   (sourceFP?.loggias   ?? []).map(x => ({ ...x, id:genId() })),
        terraces:  (sourceFP?.terraces  ?? []).map(x => ({ ...x, id:genId() })),
      };
      const fps = [
        ...(b.floorPlans ?? []).filter(fp => fp.levelIndex !== activeLevelIndex),
        newFP,
      ].sort((a,b) => a.levelIndex - b.levelIndex);
      return { ...b, floorsAboveGround:Math.max(b.floorsAboveGround, activeLevelIndex), floorPlans:fps };
    });
    save(next, parkings);
    set({ buildings:next, selectedIds:[] });
  },

  removeFloor: (levelIndex: number) => {
    if (levelIndex === 0) return;
    const { buildings, parkings, activeLevelIndex } = get();
    const next = buildings.map(b => ({
      ...b,
      floorPlans: (b.floorPlans ?? []).filter(fp => fp.levelIndex !== levelIndex),
    }));
    save(next, parkings);
    const newActive = activeLevelIndex === levelIndex ? Math.max(0, levelIndex - 1) : activeLevelIndex;
    set({ buildings:next, activeLevelIndex:newActive, selectedIds:[] });
  },

  clearAll: () => {
    save([], []);
    set({ buildings:[], parkings:[], selectedIds:[], hoveredId:null });
  },

  loadSnapshot: (buildings, parkings) => {
    const migrated = buildings
      .map(b => migrateBuilding(b as Building2D & {levels?:number}))
      .filter(b => b.rect.width * b.rect.depth > 0.1);
    save(migrated, parkings);
    set({ buildings:migrated, parkings, selectedIds:[] });
  },
}));