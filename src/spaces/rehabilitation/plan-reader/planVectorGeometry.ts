// ─────────────────────────────────────────────────────────────────────────────
// planVectorGeometry.ts
// Fonctions pures de géométrie SVG — aucun effet de bord, aucun composant
// Transforme les données de transcription en primitives SVG
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ElementDetailField,
  OpeningSymbol,
  RoomColorSpec,
  SelectedElementDetail,
} from './planOverlay.types';
import { SVG_VIEWBOX_SIZE } from './planOverlay.types';
import type {
  AnnotationCategory,
  DetectedAnnotation,
  DetectedOpening,
  DetectedRoom,
  DetectedWall,
  NormalizedPoint,
  OpeningType,
  RoomUsage,
  WallMaterial,
} from './planTranscription.types';

// ── Transformation de coordonnées ─────────────────────────────────────────────

export interface SVGPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Convertit un point normalisé (0–1) en coordonnée SVG dans le viewBox.
 */
export function normalizedToSVG(point: NormalizedPoint): SVGPoint {
  return {
    x: Math.round(point.x * SVG_VIEWBOX_SIZE * 100) / 100,
    y: Math.round(point.y * SVG_VIEWBOX_SIZE * 100) / 100,
  };
}

/**
 * Convertit une longueur normalisée (0–1) en unité SVG.
 */
export function normalizedLengthToSVG(length: number): number {
  return Math.round(length * SVG_VIEWBOX_SIZE * 100) / 100;
}

// ── Couleurs sémantiques des pièces ──────────────────────────────────────────

const ROOM_COLOR_MAP: Record<RoomUsage, RoomColorSpec> = {
  chambre:       { fill: 'rgba(147, 197, 253, 0.45)', stroke: '#3B82F6', isWetZone: false },
  salon:         { fill: 'rgba(252, 211, 77, 0.40)',  stroke: '#F59E0B', isWetZone: false },
  séjour:        { fill: 'rgba(252, 211, 77, 0.40)',  stroke: '#F59E0B', isWetZone: false },
  cuisine:       { fill: 'rgba(110, 231, 183, 0.45)', stroke: '#10B981', isWetZone: true  },
  salle_de_bain: { fill: 'rgba(103, 232, 249, 0.45)', stroke: '#06B6D4', isWetZone: true  },
  wc:            { fill: 'rgba(103, 232, 249, 0.40)', stroke: '#0891B2', isWetZone: true  },
  couloir:       { fill: 'rgba(229, 231, 235, 0.40)', stroke: '#9CA3AF', isWetZone: false },
  entrée:        { fill: 'rgba(229, 231, 235, 0.40)', stroke: '#6B7280', isWetZone: false },
  dégagement:    { fill: 'rgba(229, 231, 235, 0.35)', stroke: '#9CA3AF', isWetZone: false },
  rangement:     { fill: 'rgba(253, 230, 138, 0.40)', stroke: '#D97706', isWetZone: false },
  bureau:        { fill: 'rgba(196, 181, 253, 0.42)', stroke: '#7C3AED', isWetZone: false },
  cave:          { fill: 'rgba(156, 163, 175, 0.40)', stroke: '#6B7280', isWetZone: false },
  garage:        { fill: 'rgba(156, 163, 175, 0.38)', stroke: '#4B5563', isWetZone: false },
  terrasse:      { fill: 'rgba(167, 243, 208, 0.38)', stroke: '#059669', isWetZone: false },
  balcon:        { fill: 'rgba(167, 243, 208, 0.35)', stroke: '#10B981', isWetZone: false },
  loggia:        { fill: 'rgba(167, 243, 208, 0.35)', stroke: '#10B981', isWetZone: false },
  combles:       { fill: 'rgba(212, 184, 150, 0.40)', stroke: '#92400E', isWetZone: false },
  inconnu:       { fill: 'rgba(243, 244, 246, 0.30)', stroke: '#D1D5DB', isWetZone: false },
};

export function getRoomColorSpec(usage: RoomUsage): RoomColorSpec {
  return ROOM_COLOR_MAP[usage] ?? ROOM_COLOR_MAP.inconnu;
}

export function isWetZone(usage: RoomUsage): boolean {
  return ROOM_COLOR_MAP[usage]?.isWetZone ?? false;
}

// ── Couleurs des annotations ──────────────────────────────────────────────────

const ANNOTATION_COLOR_MAP: Record<AnnotationCategory, string> = {
  cote:       '#F97316', // orange Mimmoza
  surface:    '#3B82F6',
  matériau:   '#8B5CF6',
  équipement: '#10B981',
  réseaux:    '#EF4444',
  désordre:   '#DC2626',
  remarque:   '#6B7280',
  inconnu:    '#9CA3AF',
};

export function getAnnotationColor(category: AnnotationCategory): string {
  return ANNOTATION_COLOR_MAP[category] ?? '#9CA3AF';
}

// ── Murs ─────────────────────────────────────────────────────────────────────

/**
 * Retourne le strokeWidth SVG en fonction de l'épaisseur réelle du mur.
 * L'épaisseur en cm est convertie proportionnellement au viewBox 1000px.
 * Un mur de 20 cm dans un appartement de ~10m de large → ~2% de la largeur.
 */
export function wallThicknessToStrokeWidth(epaisseur_cm: number | null): number {
  if (epaisseur_cm === null) return 4;
  // Hypothèse : 100cm ≈ 10% de la largeur du plan → 100 unités SVG
  // 1 cm ≈ 1 unité SVG
  const raw = epaisseur_cm * 1.0;
  return Math.min(20, Math.max(2, raw));
}

export function wallMaterialToStrokeColor(material: WallMaterial, porteur: boolean | null): string {
  if (porteur === true) return '#1F2937'; // porteur : presque noir
  switch (material) {
    case 'béton':      return '#374151';
    case 'maçonnerie': return '#4B5563';
    case 'pierre':     return '#6B7280';
    case 'brique':     return '#92400E';
    case 'bois':       return '#78350F';
    case 'métal':      return '#1E40AF';
    case 'plâtre':     return '#9CA3AF';
    case 'inconnu':    return '#6B7280';
    default:           return '#6B7280';
  }
}

// ── Pièces : coordonnées du rectangle ────────────────────────────────────────

export interface SVGRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly cx: number; // centre x
  readonly cy: number; // centre y
}

export function roomToSVGRect(room: DetectedRoom): SVGRect {
  const tl = normalizedToSVG(room.bounding_box.topLeft);
  const br = normalizedToSVG(room.bounding_box.bottomRight);
  const width  = br.x - tl.x;
  const height = br.y - tl.y;
  return {
    x: tl.x,
    y: tl.y,
    width:  Math.max(1, width),
    height: Math.max(1, height),
    cx: tl.x + width / 2,
    cy: tl.y + height / 2,
  };
}

/**
 * Taille de police adaptée à la surface de la bounding box.
 */
export function roomLabelFontSize(rect: SVGRect): number {
  const minDim = Math.min(rect.width, rect.height);
  return Math.min(18, Math.max(7, minDim * 0.12));
}

// ── Ouvertures : génération du symbole SVG ────────────────────────────────────

const OPENING_DEFAULT_SIZE_SVG = 24; // unités SVG pour une ouverture sans largeur connue

/**
 * Calcule la taille SVG d'une ouverture depuis sa largeur physique en mètres.
 * Hypothèse : plan de ~10m de large → 1m ≈ 100 unités SVG.
 */
function openingWidthToSVGSize(largeur_m: number | null): number {
  if (largeur_m === null) return OPENING_DEFAULT_SIZE_SVG;
  return Math.min(80, Math.max(12, largeur_m * 100));
}

/**
 * Génère les données SVG du symbole d'une ouverture.
 * La position est le centre de l'ouverture.
 */
export function openingToSVGSymbol(opening: DetectedOpening): OpeningSymbol {
  const pos  = normalizedToSVG(opening.position);
  const size = openingWidthToSVGSize(opening.largeur_m);
  const half = size / 2;

  switch (opening.type) {
    case 'porte': {
      // Ligne + arc quart de cercle (sens antihoraire classique)
      const pathD = `M ${pos.x - half} ${pos.y} L ${pos.x + half} ${pos.y}`;
      const arcD  = `M ${pos.x - half} ${pos.y}
                     L ${pos.x - half} ${pos.y - size}
                     A ${size} ${size} 0 0 1 ${pos.x + half} ${pos.y}`;
      return { cx: pos.x, cy: pos.y, size, pathD, arcD };
    }

    case 'fenêtre': {
      // Trois barres parallèles (lecture de fenêtre standard)
      const pathD = [
        `M ${pos.x - half} ${pos.y - 3} L ${pos.x + half} ${pos.y - 3}`,
        `M ${pos.x - half} ${pos.y}     L ${pos.x + half} ${pos.y}`,
        `M ${pos.x - half} ${pos.y + 3} L ${pos.x + half} ${pos.y + 3}`,
      ].join(' ');
      return { cx: pos.x, cy: pos.y, size, pathD, arcD: null };
    }

    case 'baie_vitrée': {
      // Rectangle plein large — baie vitrée full width
      const pathD = `M ${pos.x - half} ${pos.y - 4}
                     L ${pos.x + half} ${pos.y - 4}
                     L ${pos.x + half} ${pos.y + 4}
                     L ${pos.x - half} ${pos.y + 4} Z`;
      return { cx: pos.x, cy: pos.y, size, pathD, arcD: null };
    }

    case 'velux': {
      // Petit losange centré (velux = ouverture en toiture)
      const r = size * 0.4;
      const pathD = `M ${pos.x} ${pos.y - r}
                     L ${pos.x + r} ${pos.y}
                     L ${pos.x} ${pos.y + r}
                     L ${pos.x - r} ${pos.y} Z`;
      return { cx: pos.x, cy: pos.y, size, pathD, arcD: null };
    }

    case 'portail': {
      // Double battant
      const pathD = [
        `M ${pos.x - half} ${pos.y - 8} L ${pos.x - half} ${pos.y + 8}`,
        `M ${pos.x + half} ${pos.y - 8} L ${pos.x + half} ${pos.y + 8}`,
        `M ${pos.x - half} ${pos.y} L ${pos.x} ${pos.y}`,
        `M ${pos.x} ${pos.y} L ${pos.x + half} ${pos.y}`,
      ].join(' ');
      return { cx: pos.x, cy: pos.y, size, pathD, arcD: null };
    }

    case 'inconnu':
    default: {
      // Croix simple
      const pathD = [
        `M ${pos.x - half * 0.6} ${pos.y} L ${pos.x + half * 0.6} ${pos.y}`,
        `M ${pos.x} ${pos.y - half * 0.6} L ${pos.x} ${pos.y + half * 0.6}`,
      ].join(' ');
      return { cx: pos.x, cy: pos.y, size, pathD, arcD: null };
    }
  }
}

export function openingTypeToStrokeColor(type: OpeningType): string {
  switch (type) {
    case 'porte':       return '#1D4ED8';
    case 'fenêtre':     return '#0369A1';
    case 'baie_vitrée': return '#0284C7';
    case 'velux':       return '#7C3AED';
    case 'portail':     return '#065F46';
    case 'inconnu':     return '#6B7280';
    default:            return '#6B7280';
  }
}

// ── Annotations ───────────────────────────────────────────────────────────────

export interface AnnotationSVGProps {
  readonly cx: number;
  readonly cy: number;
  readonly color: string;
  readonly radius: number;
  readonly label: string;
}

export function annotationToSVGProps(annotation: DetectedAnnotation): AnnotationSVGProps {
  const pos = normalizedToSVG(annotation.position);
  const color = getAnnotationColor(annotation.categorie);

  const label = annotation.valeur_numerique !== null && annotation.unite
    ? `${annotation.valeur_numerique}${annotation.unite}`
    : annotation.texte.slice(0, 12);

  return { cx: pos.x, cy: pos.y, color, radius: 8, label };
}

// ── Données de détail pour le panel de sélection ─────────────────────────────

export function buildRoomDetail(room: DetectedRoom): SelectedElementDetail {
  const fields: ElementDetailField[] = [
    {
      label: 'Usage',
      value: room.usage.replace(/_/g, ' '),
      unit: null,
      highlight: false,
    },
    {
      label: 'Surface',
      value: room.surface_m2 !== null ? room.surface_m2.toFixed(1) : '—',
      unit: 'm²',
      highlight: true,
    },
    {
      label: 'Étage',
      value: room.etage !== null
        ? room.etage === 0 ? 'RDC' : room.etage < 0 ? `Sous-sol ${Math.abs(room.etage)}` : `${room.etage}er`
        : '—',
      unit: null,
      highlight: false,
    },
    {
      label: 'Habitable',
      value: room.surface_habitable ? 'Oui' : 'Non',
      unit: null,
      highlight: false,
    },
    {
      label: 'Fiabilité',
      value: `${Math.round(room.confidence * 100)}%`,
      unit: null,
      highlight: false,
    },
  ];

  return {
    elementId: room.id,
    elementType: 'room',
    title: room.nom,
    subtitle: room.surface_m2 !== null ? `${room.surface_m2.toFixed(1)} m²` : null,
    fields,
    confidence: room.confidence,
  };
}

export function buildWallDetail(wall: DetectedWall): SelectedElementDetail {
  const fields: ElementDetailField[] = [
    {
      label: 'Matériau',
      value: wall.materiau,
      unit: null,
      highlight: false,
    },
    {
      label: 'Épaisseur',
      value: wall.epaisseur_cm !== null ? wall.epaisseur_cm.toString() : '—',
      unit: 'cm',
      highlight: false,
    },
    {
      label: 'Longueur',
      value: wall.longueur_m !== null ? wall.longueur_m.toFixed(2) : '—',
      unit: 'm',
      highlight: true,
    },
    {
      label: 'Porteur',
      value: wall.porteur === null ? '—' : wall.porteur ? 'Oui' : 'Non',
      unit: null,
      highlight: wall.porteur === true,
    },
    {
      label: 'Fiabilité',
      value: `${Math.round(wall.confidence * 100)}%`,
      unit: null,
      highlight: false,
    },
  ];

  return {
    elementId: wall.id,
    elementType: 'wall',
    title: wall.porteur ? 'Mur porteur' : 'Mur',
    subtitle: wall.materiau,
    fields,
    confidence: wall.confidence,
  };
}

export function buildOpeningDetail(opening: DetectedOpening): SelectedElementDetail {
  const typeLabels: Record<OpeningType, string> = {
    porte: 'Porte',
    fenêtre: 'Fenêtre',
    baie_vitrée: 'Baie vitrée',
    velux: 'Velux',
    portail: 'Portail',
    inconnu: 'Ouverture',
  };

  const fields: ElementDetailField[] = [
    {
      label: 'Type',
      value: typeLabels[opening.type],
      unit: null,
      highlight: false,
    },
    {
      label: 'Largeur',
      value: opening.largeur_m !== null ? opening.largeur_m.toFixed(2) : '—',
      unit: 'm',
      highlight: true,
    },
    {
      label: 'Hauteur',
      value: opening.hauteur_m !== null ? opening.hauteur_m.toFixed(2) : '—',
      unit: 'm',
      highlight: false,
    },
    {
      label: 'Fiabilité',
      value: `${Math.round(opening.confidence * 100)}%`,
      unit: null,
      highlight: false,
    },
  ];

  return {
    elementId: opening.id,
    elementType: 'opening',
    title: typeLabels[opening.type],
    subtitle: opening.largeur_m !== null ? `L ${opening.largeur_m.toFixed(2)} m` : null,
    fields,
    confidence: opening.confidence,
  };
}

export function buildAnnotationDetail(annotation: DetectedAnnotation): SelectedElementDetail {
  const fields: ElementDetailField[] = [
    {
      label: 'Catégorie',
      value: annotation.categorie,
      unit: null,
      highlight: false,
    },
    {
      label: 'Valeur',
      value: annotation.valeur_numerique !== null
        ? annotation.valeur_numerique.toString()
        : annotation.texte,
      unit: annotation.unite,
      highlight: annotation.valeur_numerique !== null,
    },
    {
      label: 'Fiabilité',
      value: `${Math.round(annotation.confidence * 100)}%`,
      unit: null,
      highlight: false,
    },
  ];

  return {
    elementId: annotation.id,
    elementType: 'annotation',
    title: annotation.texte.slice(0, 40),
    subtitle: annotation.categorie,
    fields,
    confidence: annotation.confidence,
  };
}

// ── Utilitaire : score de confiance → couleur ─────────────────────────────────

export function confidenceToColor(confidence: number): string {
  if (confidence >= 0.8) return '#10B981'; // vert
  if (confidence >= 0.5) return '#F59E0B'; // ambre
  return '#EF4444';                         // rouge
}

// ── Utilitaire : étage → label ────────────────────────────────────────────────

export function etageToLabel(etage: number | null): string {
  if (etage === null) return '—';
  if (etage === 0) return 'RDC';
  if (etage === -1) return 'Sous-sol';
  if (etage < -1) return `Sous-sol ${Math.abs(etage)}`;
  if (etage === 1) return '1er étage';
  return `${etage}e étage`;
}