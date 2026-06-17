// ─────────────────────────────────────────────────────────────────────────────
// PlanVectorCanvas.tsx
// Canvas SVG vectoriel superposé au plan source
// Rendu pur des éléments architecturaux par calque
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react';
import {
  getLayersStoreState,
  isElementHovered,
  isElementSelected,
  selectElement,
  setHoveredElement,
  subscribeToLayersStore,
} from '../plan-reader/planLayers.store';
import type { PlanOverlayState, SelectedElementDetail } from '../plan-reader/planOverlay.types';
import { SVG_VIEWBOX_SIZE } from '../plan-reader/planOverlay.types';
import type { CalibrationStatus } from '../plan-reader/planScaleCalibrator';
import type {
  DetectedAnnotation,
  DetectedOpening,
  DetectedRoom,
  DetectedWall,
  NormalizedPoint,
  PlanTranscriptionResult,
} from '../plan-reader/planTranscription.types';
import {
  annotationToSVGProps,
  buildAnnotationDetail,
  buildOpeningDetail,
  buildRoomDetail,
  buildWallDetail,
  confidenceToColor,
  getRoomColorSpec,
  isWetZone,
  normalizedToSVG,
  openingToSVGSymbol,
  openingTypeToStrokeColor,
  roomLabelFontSize,
  roomToSVGRect,
  wallMaterialToStrokeColor,
  wallThicknessToStrokeWidth,
} from '../plan-reader/planVectorGeometry';

// ── Props ─────────────────────────────────────────────────────────────────────

interface PlanVectorCanvasProps {
  readonly transcription: PlanTranscriptionResult;
  readonly onElementSelected?: (detail: SelectedElementDetail) => void;
  readonly onSelectionCleared?: () => void;
  readonly className?: string;
  // ── Calibration ──────────────────────────────────────────────────────────
  readonly calibrationMode?: boolean;
  readonly calibrationStatus?: CalibrationStatus;
  readonly calibrationPoint1?: NormalizedPoint | null;
  readonly calibrationPoint2?: NormalizedPoint | null;
  readonly onCalibrationClick?: (point: NormalizedPoint) => void;
  // ── Contour bâtiment ─────────────────────────────────────────────────────
  /** Mode tracé de polygone pour mesure de surface */
  readonly buildingOutlineMode?: boolean;
  /** Sommets déjà posés */
  readonly buildingOutlineVertices?: ReadonlyArray<NormalizedPoint>;
  /** Surface calculée (affichée dans le polygone quand fermé) */
  readonly buildingOutlineArea_m2?: number | null;
  /** Appelé à chaque clic en mode contour */
  readonly onBuildingOutlineClick?: (point: NormalizedPoint) => void;
}

// ── Couleurs de sélection / survol ────────────────────────────────────────────

const SELECTION_STROKE    = '#F97316';
const SELECTION_STROKE_W  = 3;
const HOVER_STROKE        = '#FB923C';
const SELECTION_FILL      = 'rgba(249, 115, 22, 0.18)';

// ── Sous-composants internes ──────────────────────────────────────────────────

interface RoomLayerProps {
  readonly rooms: ReadonlyArray<DetectedRoom>;
  readonly opacity: number;
  readonly showLabels: boolean;
  readonly showSurfaces: boolean;
  readonly showWetZone: boolean;
  readonly showConfidence: boolean;
  readonly onSelect: (room: DetectedRoom) => void;
  readonly onHover: (id: string | null) => void;
  readonly overlayState: PlanOverlayState;
}

const RoomsLayer: React.FC<RoomLayerProps> = ({
  rooms, opacity, showLabels, showSurfaces, showWetZone,
  showConfidence, onSelect, onHover, overlayState,
}) => (
  <g id="layer-rooms" opacity={opacity}>
    {rooms.map((room) => {
      const rect       = roomToSVGRect(room);
      const colorSpec  = getRoomColorSpec(room.usage);
      const wet        = isWetZone(room.usage);
      const selected   = isElementSelected(room.id);
      const hovered    = isElementHovered(room.id);
      const fontSize   = roomLabelFontSize(rect);
      const confColor  = confidenceToColor(room.confidence);

      const fillColor  = selected
        ? SELECTION_FILL
        : wet && showWetZone
          ? 'rgba(6, 182, 212, 0.22)'
          : colorSpec.fill;

      const strokeColor = selected
        ? SELECTION_STROKE
        : hovered
          ? HOVER_STROKE
          : wet && showWetZone
            ? '#0891B2'
            : colorSpec.stroke;

      const strokeW = selected
        ? SELECTION_STROKE_W
        : hovered ? 2 : 1.5;

      return (
        <g
          key={room.id}
          style={{ cursor: 'pointer' }}
          onClick={() => onSelect(room)}
          onMouseEnter={() => onHover(room.id)}
          onMouseLeave={() => onHover(null)}
        >
          <rect
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeW}
            strokeDasharray={wet && showWetZone ? '4 2' : undefined}
            rx={2}
          />

          {/* Label de la pièce */}
          {showLabels && rect.width > 30 && rect.height > 16 && (
            <text
              x={rect.cx}
              y={showSurfaces ? rect.cy - fontSize * 0.6 : rect.cy + fontSize * 0.4}
              textAnchor="middle"
              fontSize={fontSize}
              fontWeight="600"
              fill={selected ? SELECTION_STROKE : colorSpec.stroke}
              fontFamily="'DM Sans', 'Segoe UI', sans-serif"
              pointerEvents="none"
            >
              {room.nom.length > 14 ? room.nom.slice(0, 13) + '…' : room.nom}
            </text>
          )}

          {/* Surface */}
          {showSurfaces && room.surface_m2 !== null && rect.width > 30 && rect.height > 24 && (
            <text
              x={rect.cx}
              y={showLabels ? rect.cy + fontSize * 1.2 : rect.cy + fontSize * 0.4}
              textAnchor="middle"
              fontSize={Math.max(6, fontSize * 0.78)}
              fill={selected ? SELECTION_STROKE : '#6B7280'}
              fontFamily="'DM Sans', 'Segoe UI', sans-serif"
              pointerEvents="none"
            >
              {room.surface_m2.toFixed(1)} m²
            </text>
          )}

          {/* Badge de confiance */}
          {showConfidence && (
            <circle
              cx={rect.x + rect.width - 5}
              cy={rect.y + 5}
              r={4}
              fill={confColor}
              opacity={0.9}
              pointerEvents="none"
            />
          )}
        </g>
      );
    })}
  </g>
);

// ─────────────────────────────────────────────────────────────────────────────

interface WallLayerProps {
  readonly walls: ReadonlyArray<DetectedWall>;
  readonly opacity: number;
  readonly onSelect: (wall: DetectedWall) => void;
  readonly onHover: (id: string | null) => void;
}

const WallsLayer: React.FC<WallLayerProps> = ({ walls, opacity, onSelect, onHover }) => (
  <g id="layer-walls" opacity={opacity}>
    {walls.map((wall) => {
      const start       = normalizedToSVG(wall.start);
      const end         = normalizedToSVG(wall.end);
      const strokeColor = wallMaterialToStrokeColor(wall.materiau, wall.porteur);
      const strokeWidth = wallThicknessToStrokeWidth(wall.epaisseur_cm);
      const selected    = isElementSelected(wall.id);
      const hovered     = isElementHovered(wall.id);

      return (
        <line
          key={wall.id}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={selected ? SELECTION_STROKE : hovered ? HOVER_STROKE : strokeColor}
          strokeWidth={selected ? strokeWidth + 2 : hovered ? strokeWidth + 1 : strokeWidth}
          strokeLinecap="round"
          style={{ cursor: 'pointer' }}
          onClick={() => onSelect(wall)}
          onMouseEnter={() => onHover(wall.id)}
          onMouseLeave={() => onHover(null)}
        >
          <title>
            {wall.porteur ? 'Mur porteur' : 'Mur'} — {wall.materiau}
            {wall.epaisseur_cm !== null ? ` (${wall.epaisseur_cm} cm)` : ''}
          </title>
        </line>
      );
    })}
  </g>
);

// ─────────────────────────────────────────────────────────────────────────────

interface OpeningLayerProps {
  readonly openings: ReadonlyArray<DetectedOpening>;
  readonly opacity: number;
  readonly onSelect: (opening: DetectedOpening) => void;
  readonly onHover: (id: string | null) => void;
}

const OpeningsLayer: React.FC<OpeningLayerProps> = ({ openings, opacity, onSelect, onHover }) => (
  <g id="layer-openings" opacity={opacity}>
    {openings.map((opening) => {
      const symbol      = openingToSVGSymbol(opening);
      const strokeColor = openingTypeToStrokeColor(opening.type);
      const selected    = isElementSelected(opening.id);
      const hovered     = isElementHovered(opening.id);
      const stroke      = selected ? SELECTION_STROKE : hovered ? HOVER_STROKE : strokeColor;

      return (
        <g
          key={opening.id}
          style={{ cursor: 'pointer' }}
          onClick={() => onSelect(opening)}
          onMouseEnter={() => onHover(opening.id)}
          onMouseLeave={() => onHover(null)}
        >
          {/* Symbole principal */}
          <path
            d={symbol.pathD}
            stroke={stroke}
            strokeWidth={selected ? 2.5 : 1.5}
            fill="none"
            strokeLinecap="round"
          />

          {/* Arc de porte si présent */}
          {symbol.arcD !== null && (
            <path
              d={symbol.arcD}
              stroke={stroke}
              strokeWidth={1}
              fill="rgba(29,78,216,0.06)"
              strokeDasharray="3 2"
            />
          )}

          {/* Zone cliquable invisible (plus large) */}
          <circle
            cx={symbol.cx}
            cy={symbol.cy}
            r={symbol.size * 0.6}
            fill="transparent"
            stroke="none"
          />
        </g>
      );
    })}
  </g>
);

// ─────────────────────────────────────────────────────────────────────────────

interface AnnotationLayerProps {
  readonly annotations: ReadonlyArray<DetectedAnnotation>;
  readonly opacity: number;
  readonly onSelect: (annotation: DetectedAnnotation) => void;
  readonly onHover: (id: string | null) => void;
}

const AnnotationsLayer: React.FC<AnnotationLayerProps> = ({
  annotations, opacity, onSelect, onHover,
}) => (
  <g id="layer-annotations" opacity={opacity}>
    {annotations.map((annotation) => {
      const props    = annotationToSVGProps(annotation);
      const selected = isElementSelected(annotation.id);
      const hovered  = isElementHovered(annotation.id);
      const stroke   = selected ? SELECTION_STROKE : hovered ? HOVER_STROKE : props.color;

      return (
        <g
          key={annotation.id}
          style={{ cursor: 'pointer' }}
          onClick={() => onSelect(annotation)}
          onMouseEnter={() => onHover(annotation.id)}
          onMouseLeave={() => onHover(null)}
        >
          <circle
            cx={props.cx}
            cy={props.cy}
            r={props.radius}
            fill={props.color}
            opacity={selected ? 1 : 0.85}
            stroke={stroke}
            strokeWidth={selected ? 2 : 0.5}
          />
          <text
            x={props.cx}
            y={props.cy - props.radius - 3}
            textAnchor="middle"
            fontSize={7}
            fill={stroke}
            fontFamily="'DM Sans', 'Segoe UI', sans-serif"
            fontWeight="500"
            pointerEvents="none"
          >
            {props.label}
          </text>
        </g>
      );
    })}
  </g>
);

// ─────────────────────────────────────────────────────────────────────────────

const NorthIndicator: React.FC<{ orientationDeg: number | null }> = ({ orientationDeg }) => {
  const angle = orientationDeg ?? 0;
  const cx = SVG_VIEWBOX_SIZE - 30;
  const cy = 30;
  const r  = 18;

  return (
    <g transform={`rotate(${angle}, ${cx}, ${cy})`}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(0,0,0,0.55)" />
      {/* Flèche Nord */}
      <polygon
        points={`${cx},${cy - r + 4} ${cx - 5},${cy + 2} ${cx},${cy - 2} ${cx + 5},${cy + 2}`}
        fill="#F97316"
      />
      {/* Flèche Sud */}
      <polygon
        points={`${cx},${cy + r - 4} ${cx - 5},${cy - 2} ${cx},${cy + 2} ${cx + 5},${cy - 2}`}
        fill="white"
        opacity={0.6}
      />
      <text
        x={cx}
        y={cy - r + 2}
        textAnchor="middle"
        fontSize={7}
        fill="white"
        fontWeight="700"
        fontFamily="sans-serif"
        pointerEvents="none"
      >
        N
      </text>
    </g>
  );
};

// ── Couche de calibration SVG ─────────────────────────────────────────────────

const CALIB_COLOR  = '#F97316';
const CALIB_PULSE  = 'rgba(249,115,22,0.25)';
const CALIB_STROKE = 2;

interface CalibrationLayerProps {
  readonly status: CalibrationStatus;
  readonly point1: NormalizedPoint | null;
  readonly point2: NormalizedPoint | null;
  readonly mousePos: NormalizedPoint | null;
}

const CalibrationLayer: React.FC<CalibrationLayerProps> = ({
  status, point1, point2, mousePos,
}) => {
  const toSVG = (p: NormalizedPoint) => ({
    x: p.x * SVG_VIEWBOX_SIZE,
    y: p.y * SVG_VIEWBOX_SIZE,
  });

  const p1svg = point1 ? toSVG(point1) : null;
  // Le 2e point effectif : point2 confirmé ou position de la souris (aperçu)
  const p2svg = point2
    ? toSVG(point2)
    : (status === 'picking_point2' && mousePos)
      ? toSVG(mousePos)
      : null;

  return (
    <g id="calibration-layer" pointerEvents="none">
      {/* Ligne de calibration */}
      {p1svg && p2svg && (
        <>
          {/* Ligne principale */}
          <line
            x1={p1svg.x} y1={p1svg.y} x2={p2svg.x} y2={p2svg.y}
            stroke={CALIB_COLOR}
            strokeWidth={CALIB_STROKE}
            strokeDasharray={point2 ? 'none' : '8 4'}
          />
          {/* Barres d'extrémité */}
          {[p1svg, p2svg].map((p, i) => {
            const angle = Math.atan2(p2svg.y - p1svg.y, p2svg.x - p1svg.x);
            const perp  = angle + Math.PI / 2;
            const len   = 10;
            return (
              <line
                key={i}
                x1={p.x + Math.cos(perp) * len}
                y1={p.y + Math.sin(perp) * len}
                x2={p.x - Math.cos(perp) * len}
                y2={p.y - Math.sin(perp) * len}
                stroke={CALIB_COLOR}
                strokeWidth={CALIB_STROKE}
              />
            );
          })}
          {/* Étiquette distance au milieu de la ligne */}
          {point2 && (
            <>
              <rect
                x={(p1svg.x + p2svg.x) / 2 - 40}
                y={(p1svg.y + p2svg.y) / 2 - 12}
                width={80} height={18}
                fill="rgba(0,0,0,0.7)" rx={4}
              />
              <text
                x={(p1svg.x + p2svg.x) / 2}
                y={(p1svg.y + p2svg.y) / 2 + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={9}
                fill="white"
                fontFamily="system-ui, sans-serif"
                fontWeight="600"
              >
                saisissez la distance ↓
              </text>
            </>
          )}
        </>
      )}

      {/* Point 1 */}
      {p1svg && (
        <>
          <circle cx={p1svg.x} cy={p1svg.y} r={14} fill={CALIB_PULSE} />
          <circle cx={p1svg.x} cy={p1svg.y} r={6}  fill={CALIB_COLOR} />
          <text
            x={p1svg.x} y={p1svg.y - 18}
            textAnchor="middle" fontSize={8}
            fill={CALIB_COLOR} fontFamily="system-ui" fontWeight="700"
          >
            P1
          </text>
        </>
      )}

      {/* Point 2 */}
      {p2svg && point2 && (
        <>
          <circle cx={p2svg.x} cy={p2svg.y} r={14} fill={CALIB_PULSE} />
          <circle cx={p2svg.x} cy={p2svg.y} r={6}  fill={CALIB_COLOR} />
          <text
            x={p2svg.x} y={p2svg.y - 18}
            textAnchor="middle" fontSize={8}
            fill={CALIB_COLOR} fontFamily="system-ui" fontWeight="700"
          >
            P2
          </text>
        </>
      )}

      {/* Curseur cible quand on attend le 1er point */}
      {status === 'picking_point1' && mousePos && !point1 && (
        <g transform={`translate(${mousePos.x * SVG_VIEWBOX_SIZE},${mousePos.y * SVG_VIEWBOX_SIZE})`}>
          <line x1={-12} y1={0} x2={12} y2={0} stroke={CALIB_COLOR} strokeWidth={1.5} />
          <line x1={0} y1={-12} x2={0} y2={12} stroke={CALIB_COLOR} strokeWidth={1.5} />
          <circle r={4} fill="none" stroke={CALIB_COLOR} strokeWidth={1.5} />
        </g>
      )}
    </g>
  );
};

// ── Couche de polygone "contour bâtiment" ─────────────────────────────────────

const OUTLINE_COLOR  = '#F97316';
const OUTLINE_FILL   = 'rgba(249,115,22,0.13)';
const OUTLINE_FILL_DONE = 'rgba(249,115,22,0.22)';

interface BuildingOutlineLayerProps {
  readonly vertices: ReadonlyArray<NormalizedPoint>;
  readonly mousePos: NormalizedPoint | null;
  readonly area_m2: number | null | undefined;
  readonly closed: boolean; // polygone fermé (après "Terminer")
}

const BuildingOutlineLayer: React.FC<BuildingOutlineLayerProps> = ({
  vertices, mousePos, area_m2, closed,
}) => {
  const toSVG = (p: NormalizedPoint) => ({
    x: p.x * SVG_VIEWBOX_SIZE,
    y: p.y * SVG_VIEWBOX_SIZE,
  });

  // Points à tracer : sommets + prévisualisation souris (si pas encore fermé)
  const drawPts = closed || !mousePos
    ? vertices.map(toSVG)
    : [...vertices, mousePos].map(toSVG);

  if (drawPts.length < 1) return null;

  const pathD = drawPts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  const centroidX = drawPts.reduce((s, p) => s + p.x, 0) / drawPts.length;
  const centroidY = drawPts.reduce((s, p) => s + p.y, 0) / drawPts.length;

  return (
    <g id="building-outline-layer" pointerEvents="none">
      {/* Remplissage du polygone (≥3 pts) */}
      {drawPts.length >= 3 && (
        <path
          d={pathD + ' Z'}
          fill={closed ? OUTLINE_FILL_DONE : OUTLINE_FILL}
          stroke={OUTLINE_COLOR}
          strokeWidth={2}
          strokeDasharray={closed ? 'none' : '7 3'}
          strokeLinejoin="round"
        />
      )}

      {/* Trait en cours si < 3 pts */}
      {drawPts.length >= 2 && drawPts.length < 3 && (
        <path d={pathD} fill="none" stroke={OUTLINE_COLOR} strokeWidth={2} strokeDasharray="7 3" />
      )}

      {/* Ligne de retour vers le 1er sommet (fermeture visuelle) */}
      {!closed && vertices.length >= 3 && drawPts.length > 0 && (
        <line
          x1={drawPts[drawPts.length - 1].x} y1={drawPts[drawPts.length - 1].y}
          x2={drawPts[0].x} y2={drawPts[0].y}
          stroke={OUTLINE_COLOR} strokeWidth={1} strokeDasharray="4 4" opacity={0.5}
        />
      )}

      {/* Sommets */}
      {vertices.map((v, i) => {
        const p = toSVG(v);
        const isFirst = i === 0;
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={isFirst ? 14 : 10} fill={`${OUTLINE_COLOR}28`} />
            <circle cx={p.x} cy={p.y} r={5} fill={isFirst ? '#EF4444' : OUTLINE_COLOR} />
            <text
              x={p.x + 9} y={p.y - 9}
              fontSize={9} fontWeight="700" fill={OUTLINE_COLOR}
              fontFamily="system-ui, sans-serif"
            >
              {i + 1}
            </text>
          </g>
        );
      })}

      {/* Étiquette de surface au centroïde */}
      {area_m2 !== null && area_m2 !== undefined && (
        <>
          <rect x={centroidX - 52} y={centroidY - 14} width={104} height={22} fill="rgba(0,0,0,0.72)" rx={5} />
          <text
            x={centroidX} y={centroidY + 1}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={11} fontWeight="800" fill="white"
            fontFamily="system-ui, sans-serif"
          >
            {area_m2} m²
          </text>
        </>
      )}

      {/* Instruction si premiers pas */}
      {vertices.length === 0 && (
        <>
          <rect x={200} y={14} width={600} height={24} fill="rgba(0,0,0,0.65)" rx={5} />
          <text x={500} y={28} textAnchor="middle" dominantBaseline="middle" fontSize={11}
            fill="white" fontFamily="system-ui" fontWeight="600">
            Cliquez sur chaque sommet du bâtiment dans l'ordre
          </text>
        </>
      )}
    </g>
  );
};

// ── Composant principal ───────────────────────────────────────────────────────

export const PlanVectorCanvas: React.FC<PlanVectorCanvasProps> = ({
  transcription,
  onElementSelected,
  onSelectionCleared,
  className,
  calibrationMode = false,
  calibrationStatus = 'idle',
  calibrationPoint1 = null,
  calibrationPoint2 = null,
  onCalibrationClick,
  buildingOutlineMode = false,
  buildingOutlineVertices = [],
  buildingOutlineArea_m2 = null,
  onBuildingOutlineClick,
}) => {
  const [overlayState, setOverlayState] = useState<PlanOverlayState>(
    () => getLayersStoreState()
  );
  // Position souris en coordonnées normalisées [0,1] pour la prévisualisation
  const [mouseNorm, setMouseNorm] = useState<NormalizedPoint | null>(null);

  useEffect(() => {
    setOverlayState(getLayersStoreState());
    const unsub = subscribeToLayersStore((s) => setOverlayState(s));
    return unsub;
  }, []);

  const { layers, displayOptions } = overlayState;

  // ── Conversion coordonnées écran → normalisées SVG ───────────────────────
  // IMPORTANT : ne pas diviser par rect.width/height.
  // Le viewBox (0 0 1000 1000) est carré mais le conteneur peut être paysage →
  // letterboxing. getScreenCTM().inverse() gère le viewBox, preserveAspectRatio
  // et tout transform CSS. C'est la seule façon correcte de mapper clic → SVG.

  const svgToNorm = useCallback((e: React.MouseEvent<SVGSVGElement>): NormalizedPoint => {
    const svg = e.currentTarget;
    const ctm = svg.getScreenCTM();

    if (ctm) {
      const pt  = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const sp = pt.matrixTransform(ctm.inverse());
      return {
        x: Math.max(0, Math.min(1, sp.x / SVG_VIEWBOX_SIZE)),
        y: Math.max(0, Math.min(1, sp.y / SVG_VIEWBOX_SIZE)),
      };
    }

    // Fallback si getScreenCTM indisponible (SSR, test)
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / SVG_VIEWBOX_SIZE, rect.height / SVG_VIEWBOX_SIZE);
    const ox = (rect.width  - SVG_VIEWBOX_SIZE * scale) / 2;
    const oy = (rect.height - SVG_VIEWBOX_SIZE * scale) / 2;
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left - ox) / (SVG_VIEWBOX_SIZE * scale))),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top  - oy) / (SVG_VIEWBOX_SIZE * scale))),
    };
  }, []);

  // ── Handlers de sélection ─────────────────────────────────────────────────

  const isAnyOverlay = calibrationMode || buildingOutlineMode;

  const handleRoomSelect = useCallback((room: DetectedRoom) => {
    if (isAnyOverlay) return;
    selectElement(room.id, 'room', 'rooms');
    onElementSelected?.(buildRoomDetail(room));
  }, [onElementSelected, isAnyOverlay]);

  const handleWallSelect = useCallback((wall: DetectedWall) => {
    if (isAnyOverlay) return;
    selectElement(wall.id, 'wall', 'walls');
    onElementSelected?.(buildWallDetail(wall));
  }, [onElementSelected, isAnyOverlay]);

  const handleOpeningSelect = useCallback((opening: DetectedOpening) => {
    if (isAnyOverlay) return;
    selectElement(opening.id, 'opening', 'openings');
    onElementSelected?.(buildOpeningDetail(opening));
  }, [onElementSelected, isAnyOverlay]);

  const handleAnnotationSelect = useCallback((annotation: DetectedAnnotation) => {
    if (isAnyOverlay) return;
    selectElement(annotation.id, 'annotation', 'annotations');
    onElementSelected?.(buildAnnotationDetail(annotation));
  }, [onElementSelected, isAnyOverlay]);

  const handleHover = useCallback((id: string | null) => {
    if (isAnyOverlay) return;
    setHoveredElement(id);
  }, [isAnyOverlay]);

  // ── Click principal (fond SVG) ────────────────────────────────────────────

  const handleSVGClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!calibrationMode && !buildingOutlineMode) return;

    if (calibrationMode) {
      // Mode calibration : uniquement les clics sur le fond (pas sur les éléments)
      if (e.target !== e.currentTarget && !(e.target as SVGElement).id?.startsWith('bg-')) return;
    }
    // Mode contour : on capture les clics PARTOUT (y compris sur pièces / murs)
    // Les handlers d'éléments retournent déjà tôt via isAnyOverlay, donc pas de conflit.

    const norm = svgToNorm(e);
    if (calibrationMode) onCalibrationClick?.(norm);
    else if (buildingOutlineMode) onBuildingOutlineClick?.(norm);
  }, [calibrationMode, buildingOutlineMode, onCalibrationClick, onBuildingOutlineClick, svgToNorm]);

  const handleBackgroundClick = useCallback(() => {
    if (calibrationMode) return;
    onSelectionCleared?.();
  }, [onSelectionCleared, calibrationMode]);

  const handleSVGMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!calibrationMode) return;
    setMouseNorm(svgToNorm(e));
  }, [calibrationMode, svgToNorm]);

  const handleSVGMouseLeave = useCallback(() => {
    setMouseNorm(null);
  }, []);

  const vb = SVG_VIEWBOX_SIZE;

  return (
    <svg
      viewBox={`0 0 ${vb} ${vb}`}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{
        width: '100%', height: '100%', overflow: 'visible',
        cursor: (calibrationMode || buildingOutlineMode) ? 'crosshair' : 'default',
      }}
      aria-label={`Plan vectoriel : ${transcription.source_file_name}`}
      onClick={(calibrationMode || buildingOutlineMode) ? handleSVGClick : undefined}
      onMouseMove={handleSVGMouseMove}
      onMouseLeave={handleSVGMouseLeave}
    >
      {/* Zone cliquable de désélection (non-calibration) */}
      <rect
        id="bg-rect"
        x={0} y={0} width={vb} height={vb}
        fill="transparent"
        onClick={calibrationMode ? undefined : handleBackgroundClick}
        style={{ pointerEvents: calibrationMode ? 'none' : 'auto' }}
      />

      {/* Grille optionnelle */}
      {displayOptions.showGrid && (
        <g id="layer-grid" opacity={0.15} pointerEvents="none">
          <defs>
            <pattern id="grid-pattern" width={50} height={50} patternUnits="userSpaceOnUse">
              <path d={`M 50 0 L 0 0 0 50`} fill="none" stroke="#6B7280" strokeWidth={0.5} />
            </pattern>
          </defs>
          <rect width={vb} height={vb} fill="url(#grid-pattern)" />
        </g>
      )}

      {/* Calque Pièces */}
      {layers.rooms.visible && (
        <RoomsLayer
          rooms={transcription.rooms}
          opacity={calibrationMode ? 0.3 : layers.rooms.opacity}
          showLabels={displayOptions.showRoomLabels && !calibrationMode}
          showSurfaces={displayOptions.showSurfaceLabels && !calibrationMode}
          showWetZone={displayOptions.showWetZoneHighlight}
          showConfidence={displayOptions.showConfidenceBadges && !calibrationMode}
          onSelect={handleRoomSelect}
          onHover={handleHover}
          overlayState={overlayState}
        />
      )}

      {/* Calque Murs */}
      {layers.walls.visible && (
        <WallsLayer
          walls={transcription.walls}
          opacity={calibrationMode ? 0.4 : layers.walls.opacity}
          onSelect={handleWallSelect}
          onHover={handleHover}
        />
      )}

      {/* Calque Ouvertures */}
      {layers.openings.visible && !calibrationMode && (
        <OpeningsLayer
          openings={transcription.openings}
          opacity={layers.openings.opacity}
          onSelect={handleOpeningSelect}
          onHover={handleHover}
        />
      )}

      {/* Calque Annotations */}
      {layers.annotations.visible && !calibrationMode && (
        <AnnotationsLayer
          annotations={transcription.annotations}
          opacity={layers.annotations.opacity}
          onSelect={handleAnnotationSelect}
          onHover={handleHover}
        />
      )}

      {/* Indicateur Nord */}
      {displayOptions.showNorthIndicator && !calibrationMode && (
        <NorthIndicator orientationDeg={transcription.orientation_nord} />
      )}

      {/* Barre d'échelle IA (masquée si calibration en cours) */}
      {displayOptions.showScaleBar && transcription.echelle_detectee !== null && !calibrationMode && (
        <g id="scale-bar" pointerEvents="none">
          <rect x={16} y={vb - 22} width={80} height={12} fill="rgba(0,0,0,0.55)" rx={3} />
          <text x={56} y={vb - 13} textAnchor="middle" fontSize={7} fill="white" fontFamily="sans-serif">
            Échelle {transcription.echelle_detectee}
          </text>
        </g>
      )}

      {/* ── Couche de calibration (toujours au-dessus) ─────────────────── */}
      {calibrationMode && (
        <CalibrationLayer
          status={calibrationStatus}
          point1={calibrationPoint1}
          point2={calibrationPoint2}
          mousePos={mouseNorm}
        />
      )}

      {/* ── Couche de contour bâtiment ───────────────────────────────────── */}
      {(buildingOutlineMode || buildingOutlineVertices.length > 0) && (
        <BuildingOutlineLayer
          vertices={buildingOutlineVertices}
          mousePos={buildingOutlineMode ? mouseNorm : null}
          area_m2={buildingOutlineArea_m2}
          closed={!buildingOutlineMode && buildingOutlineVertices.length >= 3}
        />
      )}
    </svg>
  );
};

export default PlanVectorCanvas;