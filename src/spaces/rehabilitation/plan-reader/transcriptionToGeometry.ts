// src/spaces/rehabilitation/plan-reader/transcriptionToGeometry.ts
// ---------------------------------------------------------------------------
// Adaptateur : sortie de la Edge Function `transcribe-rehab-plan`
// (repère image normalisé 0..1000, origine haut-gauche) → PlanGeometry
// (repère 0..1 attendu par PlanOverlayViewer et le pipeline plan-reader).
//
// Aucune invention : tout champ absent/illisible reste null + confidence
// "a-confirmer". Les murs candidats porteurs sont marqués `locked:false`
// (à confirmer par l'utilisateur), conformément à la doctrine de prudence.
// ---------------------------------------------------------------------------

import type {
  ConfidenceLevel,
  Opening,
  OpeningType,
  PlanGeometry,
  Point2D,
  Room,
  RoomType,
  Wall,
  WallType,
} from "./types";

// ─── Schéma d'entrée (miroir de transcribe-rehab-plan) ─────────────────────

interface TPoint { x: number; y: number }

interface TWall {
  id: string;
  status?: "detected" | "to_confirm";
  kind?: "unknown" | "partition" | "candidate_load_bearing";
  thickness?: "thin" | "medium" | "thick" | "unknown";
  start?: TPoint;
  end?: TPoint;
  polyline?: TPoint[];
}

interface TRoom {
  id: string;
  status?: "detected" | "to_confirm";
  label?: string | null;
  type?: string;
  surfaceLabel?: string | null;
  surfaceM2?: number | null;
  polygon?: TPoint[];
}

interface TOpening {
  id: string;
  status?: "detected" | "to_confirm";
  type?: "door" | "window" | "unknown";
  wallId?: string | null;
  position?: TPoint;
  widthLabel?: string | null;
}

interface TWetZone {
  id: string;
  roomId?: string | null;
  type?: "bathroom" | "wc" | "kitchen" | "technical" | "unknown";
  polygon?: TPoint[];
}

export interface TranscriptionResult {
  envelope?: { polygon?: TPoint[] };
  walls?: TWall[];
  rooms?: TRoom[];
  openings?: TOpening[];
  wetZones?: TWetZone[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const NORM = 1000; // repère source 0..1000

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Convertit un point 0..1000 → 0..1 (borné). */
function toUnit(p: TPoint | undefined): Point2D | null {
  if (!p || typeof p.x !== "number" || typeof p.y !== "number") return null;
  return { x: clamp01(p.x / NORM), y: clamp01(p.y / NORM) };
}

function toUnitPolygon(poly: TPoint[] | undefined): Point2D[] {
  if (!Array.isArray(poly)) return [];
  return poly.map(toUnit).filter((p): p is Point2D => p !== null);
}

function statusToConfidence(status?: string): ConfidenceLevel {
  return status === "detected" ? "certain" : "a-confirmer";
}

function wallTypeFromKind(kind?: string): WallType {
  // candidate_load_bearing → porteur (affichage), mais NON verrouillé et
  // confidence "a-confirmer" : l'utilisateur doit valider.
  if (kind === "candidate_load_bearing") return "porteur";
  return "cloison-existante"; // "partition" | "unknown" | absent
}

function thicknessToMeters(t?: string): number {
  switch (t) {
    case "thin":  return 0.07;
    case "medium": return 0.15;
    case "thick": return 0.25;
    default:      return 0.10; // "unknown" ou absent
  }
}

function openingTypeFromT(t?: string): OpeningType {
  if (t === "window") return "fenetre";
  return "porte"; // "door" | "unknown" | absent
}

const ROOM_TYPE_MAP: Record<string, RoomType> = {
  bedroom:  "chambre",
  living:   "sejour",
  kitchen:  "cuisine",
  bathroom: "salle-de-bain",
  wc:       "wc",
  corridor: "circulation",
  storage:  "rangement",
  technical: "inconnue",
  unknown:  "inconnue",
};

function roomTypeFromT(t?: string): RoomType {
  return (t && ROOM_TYPE_MAP[t]) || "inconnue";
}

/** Parse "0,90 m" / "90 cm" / "900 mm" → mètres. Fallback 0.9 m (porte std). */
function parseWidthMeters(label?: string | null): number {
  if (!label) return 0.9;
  const m = label.match(/(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/i);
  if (!m) return 0.9;
  const val = parseFloat(m[1].replace(",", "."));
  if (!Number.isFinite(val)) return 0.9;
  switch (m[2].toLowerCase()) {
    case "mm": return val / 1000;
    case "cm": return val / 100;
    default:   return val;
  }
}

/** Surface : priorité au nombre, sinon parse du label ("24,0 m²"). */
function parseSurface(surfaceM2?: number | null, label?: string | null): number | null {
  if (typeof surfaceM2 === "number" && surfaceM2 > 0) return surfaceM2;
  if (label) {
    const m = label.match(/(\d+(?:[.,]\d+)?)\s*m\s*[²2]/i);
    if (m) {
      const v = parseFloat(m[1].replace(",", "."));
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}

/**
 * Projette un point sur le segment [A,B] et renvoie l'abscisse curviligne
 * normalisée (0..1). Sert à placer une ouverture le long de son mur.
 */
function projectOnSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return 0;
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  return clamp01(t);
}

// ─── Adaptateur principal ──────────────────────────────────────────────────

export function transcriptionToGeometry(t: TranscriptionResult | null | undefined): PlanGeometry {
  if (!t) {
    return { envelopePolygon: [], walls: [], openings: [], rooms: [], normalizedBounds: { width: 1, height: 1 } };
  }

  // Enveloppe
  const envelopePolygon = toUnitPolygon(t.envelope?.polygon);

  // Murs
  const walls: Wall[] = (t.walls ?? [])
    .map((w): Wall | null => {
      const start = toUnit(w.start) ?? (w.polyline ? toUnit(w.polyline[0]) : null);
      const end   = toUnit(w.end)   ?? (w.polyline ? toUnit(w.polyline[w.polyline.length - 1]) : null);
      if (!start || !end) return null;
      return {
        id: w.id,
        type: wallTypeFromKind(w.kind),
        start,
        end,
        thicknessMeters: thicknessToMeters(w.thickness),
        locked: false, // candidat porteur → à confirmer, jamais verrouillé d'office
        source: "ai",
        confidence: statusToConfidence(w.status),
      };
    })
    .filter((w): w is Wall => w !== null);

  const wallById = new Map(walls.map((w) => [w.id, w]));

  // Zones humides : index roomId → type, pour marquer isWet sur les pièces
  const wetRoomIds = new Set<string>();
  for (const wz of t.wetZones ?? []) {
    if (wz.roomId) wetRoomIds.add(wz.roomId);
  }

  // Pièces
  const rooms: Room[] = (t.rooms ?? [])
    .map((r): Room | null => {
      const polygon = toUnitPolygon(r.polygon);
      if (polygon.length < 3) return null;
      const rtype = roomTypeFromT(r.type);
      const isWet =
        wetRoomIds.has(r.id) ||
        rtype === "salle-de-bain" || rtype === "wc" || rtype === "cuisine" || rtype === "buanderie";
      return {
        id: r.id,
        type: rtype,
        label: r.label ?? "Pièce",
        polygon,
        surfaceM2: parseSurface(r.surfaceM2, r.surfaceLabel),
        isWet,
        confidence: statusToConfidence(r.status),
        source: "ai",
      };
    })
    .filter((r): r is Room => r !== null);

  // Ouvertures : nécessitent un mur parent pour être positionnées.
  const openings: Opening[] = (t.openings ?? [])
    .map((o): Opening | null => {
      if (!o.wallId) return null;
      const wall = wallById.get(o.wallId);
      const pos  = toUnit(o.position);
      if (!wall || !pos) return null;
      return {
        id: o.id,
        type: openingTypeFromT(o.type),
        wallId: o.wallId,
        positionAlongWall: projectOnSegment(pos, wall.start, wall.end),
        widthMeters: parseWidthMeters(o.widthLabel),
        confidence: statusToConfidence(o.status),
        source: "ai",
      };
    })
    .filter((o): o is Opening => o !== null);

  return {
    envelopePolygon,
    walls,
    openings,
    rooms,
    normalizedBounds: { width: 1, height: 1 },
  };
}