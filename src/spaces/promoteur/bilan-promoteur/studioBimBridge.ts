import type { MassingMetrics } from '../terrain3d/massingToBilan';

const KEY = 'mimmoza.studio.bim-bilan.v1';
const LINK_KEY = 'mimmoza.studio.bim-link.v1';
const PRICES_KEY = 'mimmoza.studio.bim-prices.v1';

export interface PendingStudioBim {
  projectId: string;
  projectName: string;
  updatedAt: string;
  referenceEurM2Sdp: number;
  metrics: MassingMetrics;
}

type Row = MassingMetrics['parBatiment'][number];

const validNumber = (value: unknown, max = 1_000_000): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;

/** Lit le métré envoyé par Studio. L'étude destinataire sera choisie dans le Bilan. */
export function readPendingStudioBim(): PendingStudioBim | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > 100_000) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.format !== 'mimmozia.studio-bim-bilan' || data.version !== 1
      || typeof data.projectId !== 'string' || typeof data.projectName !== 'string'
      || typeof data.updatedAt !== 'string' || !Array.isArray(data.parBatiment)
      || data.parBatiment.length < 1 || data.parBatiment.length > 8
      || !validNumber(data.referenceEurM2Sdp, 100_000)) return null;
    // R5 : plus d'expiration silencieuse à 24 h — le Bilan affiche la date du métré reçu.
    const age = Date.now() - Date.parse(data.updatedAt);
    if (!Number.isFinite(age) || age < -60_000) return null;
    const rows: Row[] = [];
    for (const item of data.parBatiment) {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      if (typeof row.id !== 'string' || typeof row.name !== 'string'
        || row.id.length > 200 || row.name.length > 200
        || !Number.isInteger(row.niveaux) || !validNumber(row.niveaux, 200)
        || (row.roofType !== 'terrasse' && row.roofType !== 'pente')) return null;
      for (const field of ['empriseSolM2', 'sdpM2', 'shabM2', 'surfaceFacadeM2', 'surfaceFacadeNetteM2', 'surfaceToitureM2', 'surfaceBalconsM2', 'nbMenuiseries', 'nbLogements'])
        if (!validNumber(row[field])) return null;
      rows.push(row as unknown as Row);
    }
    const sum = (field: keyof Row) => rows.reduce((total, row) => total + Number(row[field]), 0);
    return {
      projectId: data.projectId, projectName: data.projectName, updatedAt: data.updatedAt,
      referenceEurM2Sdp: data.referenceEurM2Sdp,
      metrics: {
        parBatiment: rows,
        totaux: {
          nbBatiments: rows.length, empriseSolM2: sum('empriseSolM2'), sdpM2: sum('sdpM2'), shabM2: sum('shabM2'),
          surfaceFacadeM2: sum('surfaceFacadeM2'), surfaceFacadeNetteM2: sum('surfaceFacadeNetteM2'),
          surfaceToitureTerrasseM2: rows.filter(row => row.roofType === 'terrasse').reduce((n, row) => n + row.surfaceToitureM2, 0),
          surfaceToiturePenteM2: rows.filter(row => row.roofType === 'pente').reduce((n, row) => n + row.surfaceToitureM2, 0),
          surfaceBalconsM2: sum('surfaceBalconsM2'), nbMenuiseries: sum('nbMenuiseries'), nbLogements: sum('nbLogements'),
        },
        typologie: { T1: 0, T2: 0, T3: 0, T4: 0 }, ratios: {},
      },
    };
  } catch { return null; }
}

export function clearPendingStudioBim(): void {
  try { localStorage.removeItem(KEY); } catch { /* Le Bilan reste utilisable. */ }
}

export interface StudioBimLink { projectId: string; studyId: string; }

export function readStudioBimLink(): StudioBimLink | null {
  try {
    const data = JSON.parse(localStorage.getItem(LINK_KEY) ?? 'null') as StudioBimLink | null;
    return data && typeof data.projectId === 'string' && typeof data.studyId === 'string'
      && data.projectId.length < 200 && data.studyId.length < 200 ? data : null;
  } catch { return null; }
}

export function linkStudioBim(projectId: string, studyId: string): void {
  localStorage.setItem(LINK_KEY, JSON.stringify({ projectId, studyId } satisfies StudioBimLink));
}

export interface StudioBimPriceLine { label: string; valueEur: number; hint: string; }

export function publishStudioBimPrices(link: StudioBimLink, totalTravaux: number, lines: readonly StudioBimPriceLine[]): void {
  if (!Number.isFinite(totalTravaux) || totalTravaux < 0) return;
  localStorage.setItem(PRICES_KEY, JSON.stringify({
    format: 'mimmoza.studio-bim-prices', version: 1, ...link,
    updatedAt: new Date().toISOString(), totalTravaux,
    lines: lines.filter(line => Number.isFinite(line.valueEur) && line.valueEur >= 0).slice(0, 30),
  }));
}
