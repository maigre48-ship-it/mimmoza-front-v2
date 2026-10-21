import type { JarvisSegment } from './jarvisDraft';

export interface StudioVolumeMessage {
  type: 'mzia-studio-volume-v1';
  bridgeSessionId: string;
  conversationId: string;
  segments: JarvisSegment[];
  buildings?: { name: string; largeurM: number; profondeurM: number; niveaux: number; segments: JarvisSegment[] }[];
  updatedAt: string;
}

export const STUDIO_BRIDGE_CHANNEL = 'mzia-studio-bridge-v1';
const bridgeKey = (conversationId: string) => `mzia.studio.bridge.${conversationId}`;
const volumeKey = (conversationId: string) => `mzia.studio.volume.${conversationId}`;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function rememberStudioSession(conversationId: string, bridgeSessionId: string): void {
  try { localStorage.setItem(bridgeKey(conversationId), JSON.stringify({ bridgeSessionId, updatedAt: Date.now() })); }
  catch { /* L'échange en direct reste possible si le stockage local est plein. */ }
}

export function activeStudioSession(conversationId: string): string | null {
  try {
    const row = JSON.parse(localStorage.getItem(bridgeKey(conversationId)) ?? 'null');
    return row && typeof row.bridgeSessionId === 'string' && typeof row.updatedAt === 'number'
      && Date.now() - row.updatedAt < MAX_AGE_MS ? row.bridgeSessionId : null;
  } catch { return null; }
}

export function saveStudioVolume(message: StudioVolumeMessage): void {
  try { localStorage.setItem(volumeKey(message.conversationId), JSON.stringify(message)); }
  catch { /* La notification en direct reste disponible. */ }
}

export function latestStudioVolume(conversationId: string): StudioVolumeMessage | null {
  try {
    const message = readStudioVolumeMessage(JSON.parse(localStorage.getItem(volumeKey(conversationId)) ?? 'null'));
    return message && message.bridgeSessionId === activeStudioSession(conversationId)
      && Date.now() - Date.parse(message.updatedAt) < MAX_AGE_MS ? message : null;
  } catch { return null; }
}

/** Les données de l'autre onglet restent non fiables même si l'origine est vérifiée. */
export function readStudioVolumeMessage(value: unknown): StudioVolumeMessage | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.type !== 'mzia-studio-volume-v1' || typeof row.bridgeSessionId !== 'string'
    || typeof row.conversationId !== 'string' || typeof row.updatedAt !== 'string'
    || !Array.isArray(row.segments) || row.segments.length < 1 || row.segments.length > 12) return null;
  const readSegments = (candidates: unknown[]): JarvisSegment[] | null => {
    if (candidates.length < 1 || candidates.length > 12) return null;
    const segments: JarvisSegment[] = [];
    for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') return null;
    const part = candidate as Record<string, unknown>;
    if (typeof part.name !== 'string' || part.name.length > 60) return null;
    for (const key of ['largeurM', 'profondeurM', 'niveaux', 'fromLevelIndex', 'retraitM', 'x', 'z'])
      if (typeof part[key] !== 'number' || !Number.isFinite(part[key])) return null;
    if ((part.largeurM as number) < 1 || (part.largeurM as number) > 100
      || (part.profondeurM as number) < 1 || (part.profondeurM as number) > 100
      || !Number.isInteger(part.niveaux) || (part.niveaux as number) > 30
      || !Number.isInteger(part.fromLevelIndex) || (part.fromLevelIndex as number) < 0
      || (part.fromLevelIndex as number) >= (part.niveaux as number)
      || Math.abs(part.x as number) > 150 || Math.abs(part.z as number) > 150) return null;
    segments.push(part as unknown as JarvisSegment);
    }
    return segments;
  };
  const segments = readSegments(row.segments);
  if (!segments) return null;
  let buildings: StudioVolumeMessage['buildings'];
  if (row.buildings !== undefined) {
    if (!Array.isArray(row.buildings) || row.buildings.length < 1 || row.buildings.length > 8) return null;
    buildings = [];
    for (const item of row.buildings) {
      if (!item || typeof item !== 'object') return null;
      const value = item as Record<string, unknown>;
      if (typeof value.name !== 'string' || value.name.length > 80
        || typeof value.largeurM !== 'number' || value.largeurM < 1 || value.largeurM > 100
        || typeof value.profondeurM !== 'number' || value.profondeurM < 1 || value.profondeurM > 100
        || !Number.isInteger(value.niveaux) || (value.niveaux as number) < 1 || (value.niveaux as number) > 30
        || !Array.isArray(value.segments)) return null;
      const parts = readSegments(value.segments);
      if (!parts) return null;
      buildings.push({ name: value.name, largeurM: value.largeurM, profondeurM: value.profondeurM,
        niveaux: value.niveaux as number, segments: parts });
    }
  }
  return { type: 'mzia-studio-volume-v1', bridgeSessionId: row.bridgeSessionId,
    conversationId: row.conversationId, updatedAt: row.updatedAt, segments, ...(buildings ? { buildings } : {}) };
}
