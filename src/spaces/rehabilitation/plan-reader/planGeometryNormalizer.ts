// src/spaces/rehabilitation/plan-reader/planGeometryNormalizer.ts
// ---------------------------------------------------------------------------
// Étape 3 du pipeline : normalisation des sorties IA brutes en coordonnées
// relatives à l'image source (0..1).
//
// La sortie IA peut arriver :
//   - en pixels absolus      → on divise par width/height
//   - déjà normalisée 0..1   → on conserve
//   - en mètres + origine    → on convertit via pixelsPerMeter
//
// Les murs sont classés (porteur / cloison existante / cloison nouvelle).
// Les pièces humides sont marquées (cuisine, salle de bain, WC, buanderie).
// ---------------------------------------------------------------------------

import type { PlanGeometry, Wall, Opening, Room, Point2D, WallType, OpeningType, RoomType, DataSource, ConfidenceLevel } from './types';
import { EMPTY_GEOMETRY } from './types';

// ---------------------------------------------------------------------------
// Entrée brute (volontairement permissive : on tolère plusieurs formats IA)
// ---------------------------------------------------------------------------

export interface RawPoint {
  x: number;
  y: number;
}

export interface RawWall {
  id?: string;
  type?: string;
  start: RawPoint;
  end: RawPoint;
  thickness?: number;     // m ou cm — heuristique
  isLoadBearing?: boolean;
  isNew?: boolean;
  confidence?: number;    // 0..1
  source?: DataSource;
}

export interface RawOpening {
  id?: string;
  type?: string;
  wallId?: string;
  positionAlongWall?: number;
  width?: number;
  confidence?: number;
  source?: DataSource;
}

export interface RawRoom {
  id?: string;
  type?: string;
  label?: string;
  polygon: RawPoint[];
  surface?: number;
  confidence?: number;
  source?: DataSource;
}

export interface RawGeometry {
  envelope?: RawPoint[];
  walls?: RawWall[];
  openings?: RawOpening[];
  rooms?: RawRoom[];
}

export interface NormalizationInput {
  raw: RawGeometry;
  imageWidthPx: number;
  imageHeightPx: number;
  /** Si l'IA fournit du pixel absolu, on connaît la taille → division.
   *  Si l'IA fournit déjà du 0..1, on saute la division. */
  coordSpace: 'pixels' | 'normalized';
  pixelsPerMeter?: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let __uid = 0;
const nextId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${(__uid++).toString(36)}`;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const toNormalizedPoint = (
  p: RawPoint,
  w: number,
  h: number,
  space: 'pixels' | 'normalized',
): Point2D =>
  space === 'pixels'
    ? { x: clamp01(p.x / w), y: clamp01(p.y / h) }
    : { x: clamp01(p.x), y: clamp01(p.y) };

const toConfidence = (raw?: number, fallback: ConfidenceLevel = 'a-confirmer'): ConfidenceLevel => {
  if (raw === undefined || raw === null) return fallback;
  if (raw >= 0.85) return 'certain';
  if (raw >= 0.4) return 'a-confirmer';
  return 'rejete';
};

// ---------------------------------------------------------------------------
// Classification des murs
// ---------------------------------------------------------------------------

const classifyWall = (w: RawWall): WallType => {
  const t = (w.type ?? '').toLowerCase();
  if (w.isLoadBearing || /porteur|structurel|load.?bearing/.test(t)) return 'porteur';
  if (w.isNew || /nouveau|nouvelle|new|projet/.test(t)) return 'cloison-nouvelle';
  return 'cloison-existante';
};

// Épaisseur par défaut selon le type de mur (en mètres)
const defaultThickness = (type: WallType): number => {
  switch (type) {
    case 'porteur': return 0.20;
    case 'cloison-existante': return 0.10;
    case 'cloison-nouvelle': return 0.07;
  }
};

const normalizeThickness = (raw: number | undefined, type: WallType): number => {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return defaultThickness(type);
  // Heuristique : si > 5, l'IA parle probablement en centimètres
  if (raw > 5) return raw / 100;
  return raw;
};

// ---------------------------------------------------------------------------
// Classification des pièces
// ---------------------------------------------------------------------------

const ROOM_TYPE_MAP: Record<string, RoomType> = {
  cuisine: 'cuisine',
  kitchen: 'cuisine',
  'salle de bain': 'salle-de-bain',
  'salle d\'eau': 'salle-de-bain',
  sdb: 'salle-de-bain',
  bathroom: 'salle-de-bain',
  wc: 'wc',
  toilettes: 'wc',
  toilet: 'wc',
  chambre: 'chambre',
  bedroom: 'chambre',
  sejour: 'sejour',
  salon: 'sejour',
  'living room': 'sejour',
  'salle a manger': 'salle-a-manger',
  'salle à manger': 'salle-a-manger',
  bureau: 'bureau',
  office: 'bureau',
  circulation: 'circulation',
  couloir: 'circulation',
  hall: 'entree',
  entree: 'entree',
  entrée: 'entree',
  rangement: 'rangement',
  placard: 'rangement',
  buanderie: 'buanderie',
  laundry: 'buanderie',
};

const classifyRoom = (raw: RawRoom): RoomType => {
  const candidates = [raw.type, raw.label].filter(Boolean) as string[];
  for (const c of candidates) {
    const key = c
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (ROOM_TYPE_MAP[key]) return ROOM_TYPE_MAP[key];
    for (const [k, v] of Object.entries(ROOM_TYPE_MAP)) {
      if (key.includes(k)) return v;
    }
  }
  return 'inconnue';
};

const WET_ROOMS: ReadonlySet<RoomType> = new Set(['cuisine', 'salle-de-bain', 'wc', 'buanderie']);

// ---------------------------------------------------------------------------
// Classification des ouvertures
// ---------------------------------------------------------------------------

const classifyOpening = (raw: RawOpening): OpeningType => {
  const t = (raw.type ?? '').toLowerCase();
  if (/porte.?fenetre|porte-fenêtre|french.?door/.test(t)) return 'porte-fenetre';
  if (/baie|sliding|coulissant/.test(t)) return 'baie';
  if (/fenetre|fenêtre|window/.test(t)) return 'fenetre';
  return 'porte';
};

const defaultOpeningWidth = (type: OpeningType): number => {
  switch (type) {
    case 'porte': return 0.83;
    case 'fenetre': return 1.0;
    case 'baie': return 2.4;
    case 'porte-fenetre': return 1.8;
  }
};

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

export const normalizeGeometry = (input: NormalizationInput): PlanGeometry => {
  const { raw, imageWidthPx, imageHeightPx, coordSpace } = input;
  if (!raw || imageWidthPx <= 0 || imageHeightPx <= 0) return EMPTY_GEOMETRY;

  const w = imageWidthPx;
  const h = imageHeightPx;
  const toP = (p: RawPoint) => toNormalizedPoint(p, w, h, coordSpace);

  const envelopePolygon: Point2D[] = (raw.envelope ?? []).map(toP);

  const walls: Wall[] = (raw.walls ?? []).map((rw): Wall => {
    const type = classifyWall(rw);
    return {
      id: rw.id ?? nextId('wall'),
      type,
      start: toP(rw.start),
      end: toP(rw.end),
      thicknessMeters: normalizeThickness(rw.thickness, type),
      locked: type === 'porteur', // murs porteurs verrouillés par défaut
      source: rw.source ?? 'ai',
      confidence: toConfidence(rw.confidence),
    };
  });

  const wallIds = new Set(walls.map(w => w.id));

  const openings: Opening[] = (raw.openings ?? []).map((ro): Opening => {
    const type = classifyOpening(ro);
    const width = ro.width && ro.width > 0 ? (ro.width > 5 ? ro.width / 100 : ro.width) : defaultOpeningWidth(type);
    return {
      id: ro.id ?? nextId('open'),
      type,
      wallId: ro.wallId && wallIds.has(ro.wallId) ? ro.wallId : walls[0]?.id ?? '',
      positionAlongWall: clamp01(ro.positionAlongWall ?? 0.5),
      widthMeters: width,
      confidence: toConfidence(ro.confidence),
      source: ro.source ?? 'ai',
    };
  });

  const rooms: Room[] = (raw.rooms ?? []).map((rr): Room => {
    const type = classifyRoom(rr);
    return {
      id: rr.id ?? nextId('room'),
      type,
      label: rr.label ?? labelForRoomType(type),
      polygon: rr.polygon.map(toP),
      surfaceM2: rr.surface ?? null,
      isWet: WET_ROOMS.has(type),
      confidence: toConfidence(rr.confidence),
      source: rr.source ?? 'ai',
    };
  });

  return {
    envelopePolygon,
    walls,
    openings,
    rooms,
    normalizedBounds: { width: 1, height: 1 },
  };
};

const labelForRoomType = (t: RoomType): string => {
  const map: Record<RoomType, string> = {
    cuisine: 'Cuisine',
    'salle-de-bain': 'Salle de bain',
    wc: 'WC',
    chambre: 'Chambre',
    sejour: 'Séjour',
    'salle-a-manger': 'Salle à manger',
    bureau: 'Bureau',
    circulation: 'Circulation',
    rangement: 'Rangement',
    entree: 'Entrée',
    buanderie: 'Buanderie',
    inconnue: 'À identifier',
  };
  return map[t];
};

// ---------------------------------------------------------------------------
// Helpers exposés (réutilisés par validation et viewer)
// ---------------------------------------------------------------------------

export const isPointInPolygon = (p: Point2D, polygon: Point2D[]): boolean => {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect =
      ((yi > p.y) !== (yj > p.y)) &&
      (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

export const polygonsOverlap = (a: Point2D[], b: Point2D[]): boolean => {
  if (a.length < 3 || b.length < 3) return false;
  for (const p of a) if (isPointInPolygon(p, b)) return true;
  for (const p of b) if (isPointInPolygon(p, a)) return true;
  return false;
};

export const polygonCentroid = (poly: Point2D[]): Point2D => {
  if (poly.length === 0) return { x: 0.5, y: 0.5 };
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  return { x: cx / poly.length, y: cy / poly.length };
};