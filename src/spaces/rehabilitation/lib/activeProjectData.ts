// src/spaces/rehabilitation/lib/activeProjectData.ts
// Source de vérité unique pour les données du PROJET RÉHAB ACTIF, lisible par
// tous les onglets (Simulation, Planning, Conformité…).
//
// Ordre de priorité pour chaque champ :
//   1) clé "overview" du projet actif  (mimmoza_rehab_overview_<id>) → valeurs
//      saisies/éditées dans Vue d'ensemble (les plus à jour)
//   2) liste des projets (mimmoza.rehabilitation.projects.v1) → valeurs saisies
//      à la création du projet
//
// Aucune dépendance à rehabScope : on lit les clés directement via userStorage.

import { userStorage } from "@/lib/storage/userScopedStorage";

const ACTIVE_ID_KEY = "mimmoza.rehab.activeProjectId";
const PROJECTS_KEY  = "mimmoza.rehabilitation.projects.v1";
const overviewKey   = (id: string) => `mimmoza_rehab_overview_${id}`;

export interface ActiveRehabProject {
  id: string;
  name: string;
  address: string;
  usageCible: string;
  surfaceM2: number | null;
  anneeConstruction: number | null;
  erp: "oui" | "non" | "a_confirmer" | null;
}

function readJSON<T>(key: string): T | null {
  try {
    const raw = userStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Id du projet réhab actuellement ouvert (ou null). */
export function getActiveRehabProjectId(): string | null {
  try {
    const id = userStorage.getItem(ACTIVE_ID_KEY);
    return id && id.trim() ? id : null;
  } catch {
    return null;
  }
}

type OverviewShape = {
  nomProjet?: string; adresse?: string; usageCible?: string;
  surface?: string | number; anneeConstruction?: string | number;
  erp?: "oui" | "non" | "a_confirmer" | "";
};
type ProjectShape = {
  id: string; name?: string; address?: string; surfaceM2?: number;
};

/** Données fusionnées du projet actif (overview prioritaire, repli sur la liste). */
export function getActiveRehabProject(): ActiveRehabProject | null {
  const id = getActiveRehabProjectId();
  if (!id) return null;

  const overview = readJSON<OverviewShape>(overviewKey(id));
  const list     = readJSON<ProjectShape[]>(PROJECTS_KEY) ?? [];
  const project  = list.find((p) => p.id === id) ?? null;

  const surfaceM2 =
    toNum(overview?.surface) ??
    toNum(project?.surfaceM2) ??
    null;

  return {
    id,
    name:              (overview?.nomProjet ?? project?.name ?? "").trim(),
    address:           (overview?.adresse ?? project?.address ?? "").trim(),
    usageCible:        (overview?.usageCible ?? "").trim(),
    surfaceM2,
    anneeConstruction: toNum(overview?.anneeConstruction),
    erp:               overview?.erp && overview.erp !== "" ? overview.erp : null,
  };
}

/** Raccourci : surface (m²) du projet actif, ou null si indisponible. */
export function getActiveRehabSurface(): number | null {
  return getActiveRehabProject()?.surfaceM2 ?? null;
}