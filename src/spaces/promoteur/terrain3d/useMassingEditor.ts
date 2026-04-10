// =============================================================================
// useMassingEditor.ts
// Central state for the Massing 3D editor.
// Uses useReducer — pure, predictable, testable.
// No Three.js, no rendering logic.
// =============================================================================

import { useReducer, useCallback, useMemo } from "react";
import type {
  EditorState,
  EditorAction,
  EditorTool,
  MassingBuildingModel,
  MassingSceneModel,
  BuildingTransform,
  BuildingLevels,
  BuildingStyleOptions,
  BuildingFootprint,
  LevelSetback,
  PlacedObject,
} from "./massingScene.types";
import {
  DEFAULT_LEVELS,
  DEFAULT_STYLE,
  DEFAULT_TRANSFORM,
} from "./massingScene.types";

// ─── ID generator ─────────────────────────────────────────────────────────────

let _idCtr = 0;
function genId(): string {
  return `b_${Date.now()}_${++_idCtr}`;
}

// ─── Scene helpers ────────────────────────────────────────────────────────────

function now(): number { return Date.now(); }

function touchScene(scene: MassingSceneModel): MassingSceneModel {
  return { ...scene, meta: { ...(scene as any).meta, updatedAt: now() } };
}

function emptyScene(): MassingSceneModel {
  return {
    version: 1,
    buildings: [],
    placedObjects: [],
    meta: { parcelAreaM2: null, communeInsee: null, createdAt: now(), updatedAt: now() },
  } as any;
}

// ─── Default footprint (rectangle centré sur l'origine, en unités scène) ──────

export function makeRectFootprint(halfW: number, halfD: number): BuildingFootprint {
  return {
    points: [
      [-halfW, -halfD],
      [ halfW, -halfD],
      [ halfW,  halfD],
      [-halfW,  halfD],
    ] as [number, number][],
    epsg: "SCENE",
  };
}

/** Crée un nouveau bâtiment avec les valeurs par défaut. */
export function makeNewBuilding(overrides?: Partial<MassingBuildingModel>): MassingBuildingModel {
  const id = genId();
  return {
    id,
    name: `Bâtiment ${id.slice(-4)}`,
    footprint: makeRectFootprint(30, 20),
    transform: { ...DEFAULT_TRANSFORM },
    levels: { ...DEFAULT_LEVELS },
    setbacks: [],
    style: { ...DEFAULT_STYLE },
    locked: false,
    visible: true,
    ...overrides,
  } as MassingBuildingModel;
}

// ─── History ──────────────────────────────────────────────────────────────────

const MAX_HISTORY = 24;

function pushHistory(state: EditorState, newScene: MassingSceneModel): EditorState {
  const trimmed = (state as any).history.slice(0, (state as any).historyIndex + 1).slice(-MAX_HISTORY);
  return {
    ...state,
    scene: newScene,
    history: [...trimmed, state.scene],
    historyIndex: trimmed.length,
  } as any;
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

function editorReducer(state: any, action: EditorAction): any {
  switch (action.type) {

    case "SELECT":
      return { ...state, selection: { ...state.selection, selectedId: action.id } };

    case "HOVER":
      return { ...state, selection: { ...state.selection, hoveredId: action.id } };

    case "SET_TOOL":
      return { ...state, activeTool: action.tool };

    case "ADD_BUILDING": {
      const newScene = touchScene({
        ...state.scene,
        buildings: [...state.scene.buildings, action.building],
      });
      return {
        ...pushHistory(state, newScene),
        selection: { selectedId: action.building.id, hoveredId: null },
      };
    }

    case "UPDATE_BUILDING": {
      const newScene = touchScene({
        ...state.scene,
        buildings: state.scene.buildings.map((b: MassingBuildingModel) =>
          b.id === action.id ? { ...b, ...action.patch } : b
        ),
      });
      return pushHistory(state, newScene);
    }

    case "DELETE_BUILDING": {
      const newScene = touchScene({
        ...state.scene,
        buildings: state.scene.buildings.filter((b: MassingBuildingModel) => b.id !== action.id),
      });
      return {
        ...pushHistory(state, newScene),
        selection: {
          selectedId: state.selection.selectedId === action.id ? null : state.selection.selectedId,
          hoveredId:  state.selection.hoveredId  === action.id ? null : state.selection.hoveredId,
        },
      };
    }

    case "DUPLICATE_BUILDING": {
      const src = state.scene.buildings.find((b: MassingBuildingModel) => b.id === action.id);
      if (!src) return state;
      const copy: MassingBuildingModel = {
        ...src,
        id: genId(),
        name: `${src.name} (copie)`,
        transform: {
          ...src.transform,
          translateX: (src.transform.translateX ?? 0) + 15,
          translateZ: (src.transform.translateZ ?? 0) + 15,
        },
      };
      const newScene = touchScene({
        ...state.scene,
        buildings: [...state.scene.buildings, copy],
      });
      return {
        ...pushHistory(state, newScene),
        selection: { selectedId: copy.id, hoveredId: null },
      };
    }

    case "MOVE_BUILDING": {
      const newScene = touchScene({
        ...state.scene,
        buildings: state.scene.buildings.map((b: MassingBuildingModel) => {
          if (b.id !== action.id) return b;
          return {
            ...b,
            transform: {
              ...b.transform,
              translateX: ((b.transform as any).translateX ?? 0) + (action as any).dx,
              translateZ: ((b.transform as any).translateZ ?? 0) + (action as any).dz,
            },
          };
        }),
      });
      return { ...state, scene: newScene };
    }

    case "ROTATE_BUILDING": {
      const newScene = touchScene({
        ...state.scene,
        buildings: state.scene.buildings.map((b: MassingBuildingModel) => {
          if (b.id !== action.id) return b;
          return {
            ...b,
            transform: {
              ...b.transform,
              rotationY: ((b.transform as any).rotationY ?? 0) + (action as any).dRad,
            },
          };
        }),
      });
      return { ...state, scene: newScene };
    }

    // ── Objets placés librement ─────────────────────────────────────────────

    case "ADD_OBJECT": {
      const newScene = touchScene({
        ...state.scene,
        placedObjects: [...(state.scene.placedObjects ?? []), action.obj],
      });
      return pushHistory(state, newScene);
    }

    case "DELETE_OBJECT": {
      const newScene = touchScene({
        ...state.scene,
        placedObjects: (state.scene.placedObjects ?? []).filter(
          (o: PlacedObject) => o.id !== action.id
        ),
      });
      return pushHistory(state, newScene);
    }

    // ── Historique ──────────────────────────────────────────────────────────

    case "UNDO": {
      if (state.historyIndex < 0) return state;
      const prev = state.history[state.historyIndex];
      if (!prev) return state;
      return { ...state, scene: prev, historyIndex: state.historyIndex - 1 };
    }

    case "REDO": {
      const next = state.history[state.historyIndex + 1];
      if (!next) return state;
      return { ...state, scene: next, historyIndex: state.historyIndex + 1 };
    }

    case "REPLACE_SCENE":
      return {
        ...state,
        scene: action.scene,
        history: [],
        historyIndex: -1,
        selection: { selectedId: null, hoveredId: null },
      };

    default:
      return state;
  }
}

// ─── Initial state factory ────────────────────────────────────────────────────

function makeInitialState(initialBuildings?: MassingBuildingModel[]): any {
  const scene = emptyScene();
  if (initialBuildings?.length) (scene as any).buildings = initialBuildings;
  return {
    scene,
    selection: { selectedId: null, hoveredId: null },
    activeTool: "select",
    drag: { active: false, tool: null, startX: 0, startZ: 0, startTransform: null },
    history: [],
    historyIndex: -1,
  };
}

// ─── Public hook ──────────────────────────────────────────────────────────────

export interface MassingEditorAPI {
  scene:             MassingSceneModel;
  buildings:         MassingBuildingModel[];
  placedObjects:     PlacedObject[];
  selectedBuilding:  MassingBuildingModel | null;
  hoveredId:         string | null;
  selectedId:        string | null;
  activeTool:        EditorTool;
  canUndo:           boolean;
  canRedo:           boolean;
  dispatch:          React.Dispatch<EditorAction>;

  selectBuilding:    (id: string | null) => void;
  hoverBuilding:     (id: string | null) => void;
  setTool:           (tool: EditorTool) => void;
  addBuilding:       (overrides?: Partial<MassingBuildingModel>) => string;
  deleteBuilding:    (id: string) => void;
  duplicateBuilding: (id: string) => void;
  moveBuilding:      (id: string, dx: number, dz: number) => void;
  rotateBuilding:    (id: string, dRad: number) => void;
  updateBuilding:    (id: string, patch: Partial<MassingBuildingModel>) => void;
  updateLevels:      (id: string, levels: Partial<BuildingLevels>) => void;
  updateStyle:       (id: string, style: Partial<BuildingStyleOptions>) => void;
  updateTransform:   (id: string, transform: Partial<BuildingTransform>) => void;
  updateSetbacks:    (id: string, setbacks: LevelSetback[]) => void;
  commitMove:        (id: string) => void;
  addPlacedObject:   (obj: Omit<PlacedObject, "id">) => string;
  deleteObject:      (id: string) => void;
  undo:              () => void;
  redo:              () => void;
  replaceScene:      (scene: MassingSceneModel) => void;
}

export function useMassingEditor(initialBuildings?: MassingBuildingModel[]): MassingEditorAPI {
  const [state, dispatch] = useReducer(
    editorReducer,
    undefined,
    () => makeInitialState(initialBuildings),
  );

  const { scene, selection, activeTool, history, historyIndex } = state;

  const selectedBuilding = useMemo(
    () => scene.buildings.find((b: MassingBuildingModel) => b.id === selection.selectedId) ?? null,
    [scene.buildings, selection.selectedId],
  );

  const selectBuilding    = useCallback((id: string | null) => dispatch({ type: "SELECT", id }), []);
  const hoverBuilding     = useCallback((id: string | null) => dispatch({ type: "HOVER",  id }), []);
  const setTool           = useCallback((tool: EditorTool)  => dispatch({ type: "SET_TOOL", tool }), []);

  const addBuilding = useCallback((overrides?: Partial<MassingBuildingModel>): string => {
    const b = makeNewBuilding(overrides);
    dispatch({ type: "ADD_BUILDING", building: b });
    return b.id;
  }, []);

  const deleteBuilding    = useCallback((id: string) => dispatch({ type: "DELETE_BUILDING", id }), []);
  const duplicateBuilding = useCallback((id: string) => dispatch({ type: "DUPLICATE_BUILDING", id }), []);
  const moveBuilding      = useCallback((id: string, dx: number, dz: number) => dispatch({ type: "MOVE_BUILDING", id, dx, dz } as any), []);
  const rotateBuilding    = useCallback((id: string, dRad: number) => dispatch({ type: "ROTATE_BUILDING", id, dRad } as any), []);
  const updateBuilding    = useCallback((id: string, patch: Partial<MassingBuildingModel>) => dispatch({ type: "UPDATE_BUILDING", id, patch }), []);

  const updateLevels = useCallback((id: string, levels: Partial<BuildingLevels>) => {
    const b = state.scene.buildings.find((x: MassingBuildingModel) => x.id === id);
    if (!b) return;
    dispatch({ type: "UPDATE_BUILDING", id, patch: { levels: { ...b.levels, ...levels } } });
  }, [state.scene.buildings]);

  const updateStyle = useCallback((id: string, style: Partial<BuildingStyleOptions>) => {
    const b = state.scene.buildings.find((x: MassingBuildingModel) => x.id === id);
    if (!b) return;
    dispatch({ type: "UPDATE_BUILDING", id, patch: { style: { ...b.style, ...style } } });
  }, [state.scene.buildings]);

  const updateTransform = useCallback((id: string, transform: Partial<BuildingTransform>) => {
    const b = state.scene.buildings.find((x: MassingBuildingModel) => x.id === id);
    if (!b) return;
    dispatch({ type: "UPDATE_BUILDING", id, patch: { transform: { ...b.transform, ...transform } } });
  }, [state.scene.buildings]);

  const updateSetbacks = useCallback((id: string, setbacks: LevelSetback[]) => {
    dispatch({ type: "UPDATE_BUILDING", id, patch: { setbacks } });
  }, []);

  const commitMove = useCallback((id: string) => {
    const b = state.scene.buildings.find((x: MassingBuildingModel) => x.id === id);
    if (!b) return;
    dispatch({ type: "UPDATE_BUILDING", id, patch: { transform: b.transform } });
  }, [state.scene.buildings]);

  const addPlacedObject = useCallback((obj: Omit<PlacedObject, "id">): string => {
    const id = `obj_${Date.now()}_${++_idCtr}`;
    dispatch({ type: "ADD_OBJECT", obj: { id, ...obj } });
    return id;
  }, []);

  const deleteObject = useCallback((id: string) => {
    dispatch({ type: "DELETE_OBJECT", id });
  }, []);

  const undo         = useCallback(() => dispatch({ type: "UNDO" } as any), []);
  const redo         = useCallback(() => dispatch({ type: "REDO" } as any), []);
  const replaceScene = useCallback((s: MassingSceneModel) => dispatch({ type: "REPLACE_SCENE", scene: s } as any), []);

  return {
    scene,
    buildings: scene.buildings,
    placedObjects: scene.placedObjects ?? [],
    selectedBuilding,
    hoveredId: selection.hoveredId,
    selectedId: selection.selectedId,
    activeTool,
    canUndo: historyIndex >= 0,
    canRedo: historyIndex < history.length - 1,
    dispatch,
    selectBuilding, hoverBuilding, setTool,
    addBuilding, deleteBuilding, duplicateBuilding,
    moveBuilding, rotateBuilding, updateBuilding,
    updateLevels, updateStyle, updateTransform, updateSetbacks,
    commitMove,
    addPlacedObject, deleteObject,
    undo, redo, replaceScene,
  };
}