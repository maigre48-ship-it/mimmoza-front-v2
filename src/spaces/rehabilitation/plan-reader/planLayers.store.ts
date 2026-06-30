// ─────────────────────────────────────────────────────────────────────────────
// planLayers.store.ts
// Store de gestion des calques, de la sélection et des options d'affichage
// Pattern Mimmoza : event bus + localStorage (sans Zustand)
// ─────────────────────────────────────────────────────────────────────────────

import type {
  LayerId,
  LayerState,
  LayerUpdate,
  PlanDisplayOptions,
  PlanOverlayState,
  SelectableElementType,
  SelectedElement,
  ViewportState,
} from './planOverlay.types';
import { userStorage } from "@/lib/storage/userScopedStorage";

// ── Clé de stockage ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'mimmoza_rehab_layers_v1' as const;

// ── Valeurs par défaut des calques ────────────────────────────────────────────

const DEFAULT_LAYERS: Record<LayerId, LayerState> = {
  rooms: {
    id: 'rooms',
    label: 'Pièces',
    visible: true,
    opacity: 0.55,
    colorOverride: null,
    locked: false,
  },
  walls: {
    id: 'walls',
    label: 'Murs',
    visible: true,
    opacity: 1.0,
    colorOverride: null,
    locked: false,
  },
  openings: {
    id: 'openings',
    label: 'Ouvertures',
    visible: true,
    opacity: 0.9,
    colorOverride: null,
    locked: false,
  },
  annotations: {
    id: 'annotations',
    label: 'Annotations',
    visible: true,
    opacity: 0.85,
    colorOverride: null,
    locked: false,
  },
  dimensions: {
    id: 'dimensions',
    label: 'Cotations',
    visible: false,
    opacity: 0.8,
    colorOverride: null,
    locked: false,
  },
} as const;

// ── Options d'affichage par défaut ────────────────────────────────────────────

const DEFAULT_DISPLAY_OPTIONS: PlanDisplayOptions = {
  showGrid: false,
  showNorthIndicator: true,
  showScaleBar: true,
  showConfidenceBadges: false,
  showRoomLabels: true,
  showSurfaceLabels: true,
  showDimensionLines: false,
  showWetZoneHighlight: true,
} as const;

// ── Viewport par défaut ───────────────────────────────────────────────────────

const DEFAULT_VIEWPORT: ViewportState = {
  scale: 1.0,
  offsetX: 0,
  offsetY: 0,
} as const;

// ── État initial ──────────────────────────────────────────────────────────────

function createInitialState(): PlanOverlayState {
  return {
    layers: { ...DEFAULT_LAYERS },
    selectedElement: null,
    hoveredElementId: null,
    viewport: DEFAULT_VIEWPORT,
    displayOptions: DEFAULT_DISPLAY_OPTIONS,
  };
}

// ── Persistance (uniquement calques + options, pas la sélection) ──────────────

interface PersistedSlice {
  layers: Record<LayerId, LayerState>;
  displayOptions: PlanDisplayOptions;
}

function loadPersistedState(): Partial<PersistedSlice> {
  try {
    const raw = userStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedSlice>;
  } catch {
    return {};
  }
}

function savePersistedState(state: PlanOverlayState): void {
  try {
    const slice: PersistedSlice = {
      layers: state.layers,
      displayOptions: state.displayOptions,
    };
    userStorage.setItem(STORAGE_KEY, JSON.stringify(slice));
  } catch {
    console.warn('[planLayers.store] Impossible de persister les calques.');
  }
}

// ── Hydratation de l'état initial depuis localStorage ────────────────────────

function hydrateState(): PlanOverlayState {
  const initial = createInitialState();
  const persisted = loadPersistedState();

  return {
    ...initial,
    layers: persisted.layers
      ? mergeLayersWithDefaults(persisted.layers)
      : initial.layers,
    displayOptions: persisted.displayOptions
      ? { ...DEFAULT_DISPLAY_OPTIONS, ...persisted.displayOptions }
      : initial.displayOptions,
  };
}

/**
 * Garantit que tous les calques existent même si le schéma a évolué.
 */
function mergeLayersWithDefaults(
  stored: Partial<Record<LayerId, LayerState>>
): Record<LayerId, LayerState> {
  const allLayerIds: ReadonlyArray<LayerId> = [
    'rooms', 'walls', 'openings', 'annotations', 'dimensions',
  ];

  const merged = {} as Record<LayerId, LayerState>;
  for (const id of allLayerIds) {
    merged[id] = stored[id]
      ? { ...DEFAULT_LAYERS[id], ...stored[id] }
      : DEFAULT_LAYERS[id];
  }
  return merged;
}

// ── Singleton + event bus ─────────────────────────────────────────────────────

type LayersStoreListener = (state: PlanOverlayState) => void;

const layersListeners = new Set<LayersStoreListener>();
let layersState: PlanOverlayState = hydrateState();

function notifyLayers(state: PlanOverlayState): void {
  layersListeners.forEach((fn) => fn(state));
}

function mutateLayers(
  updater: (current: PlanOverlayState) => PlanOverlayState
): void {
  layersState = updater(layersState);
  savePersistedState(layersState);
  notifyLayers(layersState);
}

// ── API publique ──────────────────────────────────────────────────────────────

export function subscribeToLayersStore(listener: LayersStoreListener): () => void {
  layersListeners.add(listener);
  return () => layersListeners.delete(listener);
}

export function getLayersStoreState(): Readonly<PlanOverlayState> {
  return layersState;
}

// ── Mutations calques ─────────────────────────────────────────────────────────

export function updateLayer(layerId: LayerId, update: LayerUpdate): void {
  mutateLayers((state) => ({
    ...state,
    layers: {
      ...state.layers,
      [layerId]: { ...state.layers[layerId], ...update },
    },
  }));
}

export function toggleLayerVisibility(layerId: LayerId): void {
  const current = layersState.layers[layerId];
  updateLayer(layerId, { visible: !current.visible });
}

export function setLayerOpacity(layerId: LayerId, opacity: number): void {
  const clamped = Math.min(1, Math.max(0, opacity));
  updateLayer(layerId, { opacity: clamped });
}

export function showAllLayers(): void {
  mutateLayers((state) => {
    const updated = { ...state.layers };
    (Object.keys(updated) as LayerId[]).forEach((id) => {
      updated[id] = { ...updated[id], visible: true };
    });
    return { ...state, layers: updated };
  });
}

export function hideAllLayers(): void {
  mutateLayers((state) => {
    const updated = { ...state.layers };
    (Object.keys(updated) as LayerId[]).forEach((id) => {
      updated[id] = { ...updated[id], visible: false };
    });
    return { ...state, layers: updated };
  });
}

export function resetLayersToDefaults(): void {
  mutateLayers((state) => ({
    ...state,
    layers: { ...DEFAULT_LAYERS },
  }));
}

// ── Mutations sélection ───────────────────────────────────────────────────────

export function selectElement(
  id: string,
  type: SelectableElementType,
  layerId: LayerId
): void {
  const layer = layersState.layers[layerId];
  if (layer.locked) return;

  mutateLayers((state) => ({
    ...state,
    selectedElement: { id, type, layerId },
  }));
}

export function clearSelection(): void {
  mutateLayers((state) => ({ ...state, selectedElement: null }));
}

export function setHoveredElement(elementId: string | null): void {
  // Pas de persist — état éphémère
  layersState = { ...layersState, hoveredElementId: elementId };
  notifyLayers(layersState);
}

// ── Mutations options d'affichage ─────────────────────────────────────────────

export function updateDisplayOption<K extends keyof PlanDisplayOptions>(
  key: K,
  value: PlanDisplayOptions[K]
): void {
  mutateLayers((state) => ({
    ...state,
    displayOptions: { ...state.displayOptions, [key]: value },
  }));
}

export function toggleDisplayOption(key: keyof PlanDisplayOptions): void {
  const current = layersState.displayOptions[key];
  updateDisplayOption(key, !current as PlanDisplayOptions[typeof key]);
}

// ── Mutations viewport ────────────────────────────────────────────────────────

export function setViewportScale(scale: number): void {
  const clamped = Math.min(5, Math.max(0.25, scale));
  mutateLayers((state) => ({
    ...state,
    viewport: { ...state.viewport, scale: clamped },
  }));
}

export function setViewportOffset(offsetX: number, offsetY: number): void {
  mutateLayers((state) => ({
    ...state,
    viewport: { ...state.viewport, offsetX, offsetY },
  }));
}

export function resetViewport(): void {
  mutateLayers((state) => ({
    ...state,
    viewport: DEFAULT_VIEWPORT,
  }));
}

// ── Sélecteurs ────────────────────────────────────────────────────────────────

export function getLayerState(layerId: LayerId): LayerState {
  return layersState.layers[layerId];
}

export function isLayerVisible(layerId: LayerId): boolean {
  return layersState.layers[layerId].visible;
}

export function getSelectedElement(): SelectedElement | null {
  return layersState.selectedElement;
}

export function isElementSelected(elementId: string): boolean {
  return layersState.selectedElement?.id === elementId;
}

export function isElementHovered(elementId: string): boolean {
  return layersState.hoveredElementId === elementId;
}