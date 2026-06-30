// src/spaces/rehabilitation/shared/rehabilitationProject.store.ts
//
// ─── Stratégie de stockage ────────────────────────────────────────────────────
//
//  sessionStorage  → imageDataUrl (data URL base64 du plan)
//    • Pas de limite de taille pratique pour une image (vs 5-10 Mo total localStorage)
//    • Survit aux navigations React Router (même onglet = même session)
//    • Effacé à la fermeture de l'onglet — acceptable pour un workflow de session
//
//  localStorage    → tout le reste (métadonnées, résultats IA, flags détectés)
//    • Persiste entre les sessions
//    • Clé : "mimmoza.rehabilitation.activeProject.v1"
//
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { userStorage } from "@/lib/storage/userScopedStorage";

// ─── Types exportés ───────────────────────────────────────────────────────────

export interface RehabilitationDetectedWall {
  id: string;
  type: "structural" | "envelope" | "partition" | "unknown";
  label?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  confidence?: number;
}

export interface RehabilitationAnalysisResult {
  analyzedAt?: string;
  riskLevel?: string;
  pmrLevel?: string;
  fireSafetyLevel?: string;
  summary?: string;
  detectedSpatialElements?: Record<string, string[]>;
  functionalObservations?: string[];
  spatialIntelligence?: {
    constraints?: string[];
    opportunities?: string[];
    flowQuality?: string;
    zoningQuality?: string;
    summary?: string;
  };
  architecturalReading?: {
    geometry?: string;
    functional?: string;
    regulatory?: string;
    summary?: string;
  };
}

export interface RehabilitationCreationPlanResult {
  zoning: string;
  commentary: string;
  budgetMin: number;
  budgetMax: number;
  constraintsRespected: string[];
  pointsToCheck: string[];
  generatedAt: string;
  lockedWalls: string[];
  source: "analysis" | "manual";
}

export type RehabilitationPlanSource = {
  /**
   * Data URL (base64) de l'image.
   * Stocké en sessionStorage (pas en localStorage) pour contourner la limite de taille.
   * Rehydraté automatiquement par readRehabilitationProject().
   */
  imageDataUrl?: string | null;
  fileName?: string | null;
  uploadedAt?: string | null;

  detectedWalls?: RehabilitationDetectedWall[];
  detectedWetAreas?: unknown[];
  detectedOpenings?: unknown[];
  notes?: string[];

  hasStructuralWalls?: boolean;
  hasWetZones?: boolean;
  hasOpenings?: boolean;

  detectedSurface?: number;
  detectedOpeningsCount?: number;
  detectedWetZonesCount?: number;
  structuralWallsCount?: number;

  analysisResult?: RehabilitationAnalysisResult;
  creationPlanResult?: RehabilitationCreationPlanResult;
};

export type RehabilitationProject = {
  id: string;
  name: string;
  address?: string;
  destination?: string;
  plan?: RehabilitationPlanSource | null;
  createdAt: string;
  updatedAt: string;
};

// ─── Clés de stockage ─────────────────────────────────────────────────────────

const LS_KEY      = "mimmoza.rehabilitation.activeProject.v1";
const SESSION_KEY = "mimmoza.rehabilitation.planImage.v1";

// ─── sessionStorage helpers (image) ──────────────────────────────────────────

function saveImageToSession(imageDataUrl: string | null | undefined): void {
  try {
    if (imageDataUrl) {
      sessionStorage.setItem(SESSION_KEY, imageDataUrl);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch (e) {
    // sessionStorage plein (très rare pour une image unique) — on ignore
    console.warn("[rehab store] sessionStorage quota:", e);
  }
}

function readImageFromSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function clearImageFromSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch { /* silencieux */ }
}

// ─── localStorage helpers (projet sans image) ─────────────────────────────────

function createDefaultProject(): RehabilitationProject {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: "Projet réhabilitation",
    createdAt: now,
    updatedAt: now,
    plan: null,
  };
}

/** Sérialise le projet SANS imageDataUrl (stockée séparément en sessionStorage). */
function serializeProject(project: RehabilitationProject): RehabilitationProject {
  if (!project.plan) return project;
   
  const { imageDataUrl: _img, ...planWithoutImage } = project.plan;
  return { ...project, plan: planWithoutImage };
}

export function readRehabilitationProject(): RehabilitationProject {
  try {
    const raw = userStorage.getItem(LS_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as RehabilitationProject)
      : createDefaultProject();

    const project = parsed?.id ? parsed : createDefaultProject();

    // Rehydrater l'image depuis sessionStorage
    if (project.plan) {
      const sessionImage = readImageFromSession();
      if (sessionImage) {
        project.plan = { ...project.plan, imageDataUrl: sessionImage };
      }
    }

    return project;
  } catch {
    return createDefaultProject();
  }
}

export function saveRehabilitationProject(
  patch: Partial<RehabilitationProject>
): RehabilitationProject {
  const current = readRehabilitationProject();

  // Extraire l'image du patch si présente — elle sera stockée séparément
  let newImageDataUrl: string | null | undefined = undefined;
  if (patch.plan && "imageDataUrl" in patch.plan) {
    newImageDataUrl = patch.plan.imageDataUrl;
  }

  const next: RehabilitationProject = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    // Fusionner le plan sans l'image
    plan: patch.plan
      ? {
          ...current.plan,
          ...patch.plan,
          imageDataUrl: undefined, // ne jamais stocker en localStorage
        }
      : (patch.plan === null ? null : current.plan),
  };

  // Sauvegarder en localStorage sans l'image
  try {
    userStorage.setItem(LS_KEY, JSON.stringify(serializeProject(next)));
  } catch (e) {
    console.warn("[rehab store] localStorage quota:", e);
  }

  // Sauvegarder l'image en sessionStorage si elle a changé
  if (newImageDataUrl !== undefined) {
    saveImageToSession(newImageDataUrl);
  }

  // Rehydrater l'image dans l'objet retourné (pour les composants React)
  const sessionImage = readImageFromSession();
  if (next.plan && sessionImage) {
    next.plan = { ...next.plan, imageDataUrl: sessionImage };
  }

  window.dispatchEvent(new Event("mimmoza:rehabilitation-project-updated"));
  return next;
}

export function saveRehabilitationPlan(
  plan: RehabilitationPlanSource
): RehabilitationProject {
  return saveRehabilitationProject({ plan });
}

export function clearRehabilitationProject(): RehabilitationProject {
  clearImageFromSession();
  const next = createDefaultProject();
  try {
    userStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch { /* silencieux */ }
  window.dispatchEvent(new Event("mimmoza:rehabilitation-project-updated"));
  return next;
}

// ─── Hook React ───────────────────────────────────────────────────────────────

export function useRehabilitationProject() {
  const [project, setProject] = useState<RehabilitationProject>(() =>
    readRehabilitationProject()
  );

  useEffect(() => {
    const refresh = () => setProject(readRehabilitationProject());
    window.addEventListener("storage", refresh);
    window.addEventListener("mimmoza:rehabilitation-project-updated", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("mimmoza:rehabilitation-project-updated", refresh);
    };
  }, []);

  const updateProject = (patch: Partial<RehabilitationProject>) => {
    const next = saveRehabilitationProject(patch);
    setProject(next);
    return next;
  };

  const updatePlan = (plan: RehabilitationPlanSource) => {
    const next = saveRehabilitationPlan(plan);
    setProject(next);
    return next;
  };

  return {
    project,
    plan: project.plan ?? null,
    updateProject,
    updatePlan,
    clearProject: clearRehabilitationProject,
  };
}