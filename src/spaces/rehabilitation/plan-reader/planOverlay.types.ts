// ─────────────────────────────────────────────────────────────────────────────
// planOverlay.types.ts
// Types pour la gestion des calques, de la sélection et du viewport
// ─────────────────────────────────────────────────────────────────────────────

// ── Identifiants de calques ───────────────────────────────────────────────────

export type LayerId =
  | 'rooms'
  | 'walls'
  | 'openings'
  | 'annotations'
  | 'dimensions';

// ── État d'un calque individuel ───────────────────────────────────────────────

export interface LayerState {
  readonly id: LayerId;
  readonly label: string;
  readonly visible: boolean;
  readonly opacity: number;        // 0.0 → 1.0
  readonly colorOverride: string | null;  // null = couleur sémantique par défaut
  readonly locked: boolean;        // si vrai : pas de clic sur les éléments du calque
}

// ── Type d'élément sélectionnable ────────────────────────────────────────────

export type SelectableElementType = 'room' | 'wall' | 'opening' | 'annotation';

// ── Élément sélectionné ───────────────────────────────────────────────────────

export interface SelectedElement {
  readonly id: string;
  readonly type: SelectableElementType;
  readonly layerId: LayerId;
}

// ── Viewport (zoom / pan) ─────────────────────────────────────────────────────
// Préparé pour future interaction — affiché en état pour l'instant

export interface ViewportState {
  readonly scale: number;     // 1.0 = 100%
  readonly offsetX: number;   // px
  readonly offsetY: number;   // px
}

// ── Options d'affichage du plan ───────────────────────────────────────────────

export interface PlanDisplayOptions {
  readonly showGrid: boolean;
  readonly showNorthIndicator: boolean;
  readonly showScaleBar: boolean;
  readonly showConfidenceBadges: boolean;
  readonly showRoomLabels: boolean;
  readonly showSurfaceLabels: boolean;
  readonly showDimensionLines: boolean;
  readonly showWetZoneHighlight: boolean;  // cuisine / SDB / WC en bleu
}

// ── État global de l'overlay ──────────────────────────────────────────────────

export interface PlanOverlayState {
  readonly layers: Record<LayerId, LayerState>;
  readonly selectedElement: SelectedElement | null;
  readonly hoveredElementId: string | null;
  readonly viewport: ViewportState;
  readonly displayOptions: PlanDisplayOptions;
}

// ── Payload de mutation de calque ─────────────────────────────────────────────

export type LayerUpdate = Partial<
  Pick<LayerState, 'visible' | 'opacity' | 'colorOverride' | 'locked'>
>;

// ── Couleurs sémantiques SVG ──────────────────────────────────────────────────

export interface RoomColorSpec {
  readonly fill: string;    // rgba
  readonly stroke: string;  // hex
  readonly isWetZone: boolean;
}

// ── Dimensions du viewBox SVG ─────────────────────────────────────────────────

export const SVG_VIEWBOX_SIZE = 1000 as const;

// ── Props partagées entre composants visuels ──────────────────────────────────

export interface OverlayElementProps {
  readonly isSelected: boolean;
  readonly isHovered: boolean;
  readonly isLocked: boolean;
  readonly layerOpacity: number;
}

// ── Symbole SVG d'ouverture ───────────────────────────────────────────────────

export interface OpeningSymbol {
  readonly cx: number;
  readonly cy: number;
  readonly size: number;
  readonly pathD: string;       // SVG path data pour le symbole principal
  readonly arcD: string | null; // SVG arc pour les portes
}

// ── Metadata affichées dans le panel de sélection ────────────────────────────

export interface ElementDetailField {
  readonly label: string;
  readonly value: string;
  readonly unit: string | null;
  readonly highlight: boolean;
}

export interface SelectedElementDetail {
  readonly elementId: string;
  readonly elementType: SelectableElementType;
  readonly title: string;
  readonly subtitle: string | null;
  readonly fields: ReadonlyArray<ElementDetailField>;
  readonly confidence: number;
}