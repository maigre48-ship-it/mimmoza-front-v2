// src/spaces/promoteur/shared/hooks/useProjectContext.ts
// ============================================
// Hook centralisé pour le contexte projet
// Source de vérité unique pour toutes les pages
// ============================================

import { useCallback, useEffect, useState, useMemo } from "react";

// ============================================
// TYPES
// ============================================

export interface ProjectInfo {
  address?: string;
  parcelId?: string;
  parcelIds?: string[];
  city?: string;
  postalCode?: string;
  communeInsee?: string;
  communeName?: string;
  lat?: number;
  lon?: number;
  surfaceM2?: number;
  projectType?: string;
  projectName?: string;
}

export interface ModuleData {
  ok: boolean;
  summary?: string;
  updatedAt?: string;
  data?: Record<string, unknown>;
}

export interface PromoteurSnapshot {
  version: string;
  createdAt: string;
  updatedAt: string;
  projectInfo: ProjectInfo;
  modules: {
    foncier?: ModuleData;
    plu?: ModuleData;
    implantation2d?: ModuleData;
    market?: ModuleData;
    risks?: ModuleData;
    bilan?: ModuleData;
  };
}

export type ModuleName = keyof PromoteurSnapshot["modules"];

// ============================================
// CONSTANTS
// ============================================

const SNAPSHOT_KEY = "mimmoza.promoteur.snapshot.v1";
const SNAPSHOT_VERSION = "1.0.0";

// ============================================
// HELPERS
// ============================================

function createEmptySnapshot(): PromoteurSnapshot {
  const now = new Date().toISOString();
  return {
    version: SNAPSHOT_VERSION,
    createdAt: now,
    updatedAt: now,
    projectInfo: {},
    modules: {},
  };
}

function loadSnapshot(): PromoteurSnapshot {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return createEmptySnapshot();
    const parsed = JSON.parse(raw);
    // Migration si nécessaire
    if (!parsed.version) {
      parsed.version = SNAPSHOT_VERSION;
    }
    if (!parsed.modules) {
      parsed.modules = {};
    }
    if (!parsed.projectInfo) {
      parsed.projectInfo = {};
    }
    return parsed as PromoteurSnapshot;
  } catch {
    return createEmptySnapshot();
  }
}

function saveSnapshot(snapshot: PromoteurSnapshot): boolean {
  try {
    snapshot.updatedAt = new Date().toISOString();
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

/**
 * Extrait le code INSEE (5 chiffres) depuis un ID parcelle
 */
export function extractCommuneInsee(parcelId: string | null | undefined): string | null {
  if (!parcelId) return null;
  const match = String(parcelId).match(/^(\d{5})/);
  return match?.[1] ?? null;
}

// ============================================
// HOOK PRINCIPAL
// ============================================

export function useProjectContext() {
  const [snapshot, setSnapshot] = useState<PromoteurSnapshot>(createEmptySnapshot);
  const [isHydrated, setIsHydrated] = useState(false);

  // -----------------------------
  // Hydratation initiale
  // -----------------------------
  useEffect(() => {
    const loaded = loadSnapshot();
    setSnapshot(loaded);
    setIsHydrated(true);
  }, []);

  // -----------------------------
  // Computed values
  // -----------------------------
  const projectInfo = snapshot.projectInfo;
  const modules = snapshot.modules;

  const hasProject = useMemo(() => {
    return !!(projectInfo.parcelId || projectInfo.address || projectInfo.communeInsee);
  }, [projectInfo]);

  const completedModules = useMemo(() => {
    return Object.entries(modules)
      .filter(([_, m]) => m?.ok)
      .map(([name]) => name as ModuleName);
  }, [modules]);

  const completionPercent = useMemo(() => {
    const total = 6; // foncier, plu, implantation2d, market, risks, bilan
    return Math.round((completedModules.length / total) * 100);
  }, [completedModules]);

  // -----------------------------
  // Actions: Project Info
  // -----------------------------
  const updateProjectInfo = useCallback((updates: Partial<ProjectInfo>) => {
    setSnapshot((prev) => {
      const newSnapshot: PromoteurSnapshot = {
        ...prev,
        projectInfo: {
          ...prev.projectInfo,
          ...updates,
        },
        updatedAt: new Date().toISOString(),
      };
      saveSnapshot(newSnapshot);
      return newSnapshot;
    });
  }, []);

  const setProject = useCallback((info: ProjectInfo) => {
    setSnapshot((prev) => {
      const newSnapshot: PromoteurSnapshot = {
        ...prev,
        projectInfo: info,
        updatedAt: new Date().toISOString(),
      };
      saveSnapshot(newSnapshot);
      return newSnapshot;
    });
  }, []);

  const clearProject = useCallback(() => {
    const newSnapshot = createEmptySnapshot();
    saveSnapshot(newSnapshot);
    setSnapshot(newSnapshot);
  }, []);

  // -----------------------------
  // Actions: Modules
  // -----------------------------
  const updateModule = useCallback((moduleName: ModuleName, data: Partial<ModuleData>) => {
    setSnapshot((prev) => {
      const existingModule = prev.modules[moduleName] || { ok: false };
      const newSnapshot: PromoteurSnapshot = {
        ...prev,
        modules: {
          ...prev.modules,
          [moduleName]: {
            ...existingModule,
            ...data,
            updatedAt: new Date().toISOString(),
          },
        },
        updatedAt: new Date().toISOString(),
      };
      saveSnapshot(newSnapshot);
      return newSnapshot;
    });
  }, []);

  const setModuleOk = useCallback((moduleName: ModuleName, summary: string, data?: Record<string, unknown>) => {
    updateModule(moduleName, {
      ok: true,
      summary,
      data,
    });
  }, [updateModule]);

  const setModuleFailed = useCallback((moduleName: ModuleName, summary: string) => {
    updateModule(moduleName, {
      ok: false,
      summary,
      data: undefined,
    });
  }, [updateModule]);

  const getModule = useCallback((moduleName: ModuleName): ModuleData | undefined => {
    return snapshot.modules[moduleName];
  }, [snapshot.modules]);

  // -----------------------------
  // Persistence
  // -----------------------------
  const persistNow = useCallback(() => {
    return saveSnapshot(snapshot);
  }, [snapshot]);

  const reloadFromStorage = useCallback(() => {
    const loaded = loadSnapshot();
    setSnapshot(loaded);
  }, []);

  // -----------------------------
  // Export JSON
  // -----------------------------
  const exportJson = useCallback(() => {
    return JSON.stringify(snapshot, null, 2);
  }, [snapshot]);

  // -----------------------------
  // API exposée
  // -----------------------------
  return {
    // State
    snapshot,
    projectInfo,
    modules,
    isHydrated,

    // Computed
    hasProject,
    completedModules,
    completionPercent,

    // Project actions
    updateProjectInfo,
    setProject,
    clearProject,

    // Module actions
    updateModule,
    setModuleOk,
    setModuleFailed,
    getModule,

    // Persistence
    persistNow,
    reloadFromStorage,
    exportJson,
  };
}

// ============================================
// STANDALONE FUNCTIONS (pour usage hors React)
// ============================================

export function getSnapshotSync(): PromoteurSnapshot {
  return loadSnapshot();
}

export function updateProjectInfoSync(updates: Partial<ProjectInfo>): boolean {
  const snapshot = loadSnapshot();
  snapshot.projectInfo = { ...snapshot.projectInfo, ...updates };
  return saveSnapshot(snapshot);
}

export function updateModuleSync(moduleName: ModuleName, data: Partial<ModuleData>): boolean {
  const snapshot = loadSnapshot();
  const existingModule = snapshot.modules[moduleName] || { ok: false };
  snapshot.modules[moduleName] = {
    ...existingModule,
    ...data,
    updatedAt: new Date().toISOString(),
  };
  return saveSnapshot(snapshot);
}