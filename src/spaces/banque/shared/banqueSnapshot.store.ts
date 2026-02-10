import type {
  BanqueProject,
  BanqueStoreState,
  BanqueAlert,
  BanqueStatut,
  BanqueHistoryEntry,
} from "./types/banque.types";

const STORE_KEY = "mimmoza.banque.snapshot.v1";

function generateId(): string {
  return `bq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

function readStore(): BanqueStoreState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { projects: [], alerts: [], lastUpdated: now() };
    return JSON.parse(raw) as BanqueStoreState;
  } catch {
    return { projects: [], alerts: [], lastUpdated: now() };
  }
}

function writeStore(state: BanqueStoreState): void {
  state.lastUpdated = now();
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("banque-store-update"));
}

export function getAllProjects(): BanqueProject[] {
  return readStore().projects;
}

export function getProjectById(id: string): BanqueProject | undefined {
  return readStore().projects.find((p) => p.id === id);
}

export function addProject(
  partial: Pick<BanqueProject, "title" | "address" | "sponsor" | "montant">
): BanqueProject {
  const state = readStore();
  const project: BanqueProject = {
    id: generateId(),
    title: partial.title,
    address: partial.address,
    sponsor: partial.sponsor,
    statut: "reception",
    montant: partial.montant,
    createdAt: now(),
    updatedAt: now(),
    snapshot: {
      projectName: partial.title,
      address: partial.address,
      sponsor: partial.sponsor,
      montant: partial.montant,
      sections: [],
    },
    smartscore: null,
    pieces: [],
    history: [
      { id: generateId(), date: now(), action: "Création du dossier" },
    ],
    dossierGenerated: null,
    decision: null,
  };
  state.projects.unshift(project);
  writeStore(state);
  return project;
}

export function updateProject(
  id: string,
  patch: Partial<BanqueProject>
): BanqueProject | undefined {
  const state = readStore();
  const idx = state.projects.findIndex((p) => p.id === id);
  if (idx === -1) return undefined;
  state.projects[idx] = { ...state.projects[idx], ...patch, updatedAt: now() };
  writeStore(state);
  return state.projects[idx];
}

export function deleteProject(id: string): boolean {
  const state = readStore();
  const before = state.projects.length;
  state.projects = state.projects.filter((p) => p.id !== id);
  if (state.projects.length < before) {
    writeStore(state);
    return true;
  }
  return false;
}

export function duplicateProject(id: string): BanqueProject | undefined {
  const source = getProjectById(id);
  if (!source) return undefined;
  const state = readStore();
  const dup: BanqueProject = {
    ...structuredClone(source),
    id: generateId(),
    title: `${source.title} (copie)`,
    createdAt: now(),
    updatedAt: now(),
    statut: "reception",
    decision: null,
    dossierGenerated: null,
    history: [
      { id: generateId(), date: now(), action: "Dossier dupliqué", detail: `Copie de ${source.title}` },
    ],
  };
  state.projects.unshift(dup);
  writeStore(state);
  return dup;
}

export function updateStatut(id: string, statut: BanqueStatut): BanqueProject | undefined {
  const project = getProjectById(id);
  if (!project) return undefined;
  const entry: BanqueHistoryEntry = {
    id: generateId(),
    date: now(),
    action: "Changement de statut",
    detail: `${project.statut} → ${statut}`,
  };
  return updateProject(id, { statut, history: [...project.history, entry] });
}

export function addHistoryEntry(id: string, action: string, detail?: string): void {
  const project = getProjectById(id);
  if (!project) return;
  const entry: BanqueHistoryEntry = { id: generateId(), date: now(), action, detail };
  updateProject(id, { history: [...project.history, entry] });
}

export function getAlerts(): BanqueAlert[] {
  return readStore().alerts;
}

export function setAlerts(alerts: BanqueAlert[]): void {
  const state = readStore();
  state.alerts = alerts;
  writeStore(state);
}

export function dismissAlert(alertId: string): void {
  const state = readStore();
  const alert = state.alerts.find((a) => a.id === alertId);
  if (alert) {
    alert.dismissed = true;
    writeStore(state);
  }
}

export function seedDemoData(): void {
  const state = readStore();
  if (state.projects.length > 0) return;
  const demos = [
    { title: "Résidence Les Oliviers", address: "12 rue des Oliviers, 34000 Montpellier", sponsor: "Nexity", montant: 8500000 },
    { title: "Campus Green Tech", address: "ZAC de la Gare, 69003 Lyon", sponsor: "Bouygues Immobilier", montant: 22000000 },
    { title: "EHPAD Bel Automne", address: "45 avenue Pasteur, 13008 Marseille", sponsor: "Domitys", montant: 12000000 },
  ];
  for (const d of demos) { addProject(d); }
}
