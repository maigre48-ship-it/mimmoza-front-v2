// ─────────────────────────────────────────────────────────────────────────────
// PlanLayerViewer.tsx
// Viewer plan réhabilitation : image + vectoriel + zoom/pan + calibration + contour
// FIX : interaction SVG pleine surface au-dessus du canvas vectoriel.
// FIX2 : handleCancelOutline ne se re-déclenche plus via triggerOutline.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearSelection,
  getLayersStoreState,
  resetLayersToDefaults,
  setLayerOpacity,
  subscribeToLayersStore,
  toggleDisplayOption,
  toggleLayerVisibility,
} from '../plan-reader/planLayers.store';
import type {
  LayerId,
  PlanDisplayOptions,
  PlanOverlayState,
  SelectedElementDetail,
} from '../plan-reader/planOverlay.types';
import {
  computePolygonArea_m2,
  formatCalibrationLabel,
  useScaleCalibrator,
} from '../plan-reader/planScaleCalibrator';
import type { NormalizedPoint, PlanTranscriptionResult } from '../plan-reader/planTranscription.types';
import { confidenceToColor } from '../plan-reader/planVectorGeometry';
import PlanVectorCanvas from './PlanVectorCanvas';

interface PlanLayerViewerProps {
  readonly transcription?: PlanTranscriptionResult;
  readonly imageUrl?: string;
  readonly planId?: string;
  readonly className?: string;
  readonly onBuildingAreaMeasured?: (areaM2: number) => void;
  readonly triggerOutline?: number;
}

const ORANGE = '#F97316';
const PANEL_BG = 'rgba(15, 15, 20, 0.92)';
const PANEL_TEXT = '#F1F5F9';
const BORDER = 'rgba(255,255,255,0.08)';

const EyeIcon = ({ open }: { open: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    {open ? (
      <>
        <path
          d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"
          stroke="#94A3B8"
          strokeWidth="1.2"
          fill="none"
        />
        <circle cx="8" cy="8" r="2" fill="#94A3B8" />
      </>
    ) : (
      <>
        <path
          d="M2 2l12 12M6.5 6.6A3 3 0 0 0 8 11a3 3 0 0 0 3-3m-1.5-1.4A3 3 0 0 0 8 5 3 3 0 0 0 5 8"
          stroke="#4B5563"
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M3 4.5C2 5.6 1.3 6.8 1 8c1 3.5 4 5 7 5 1.5 0 2.9-.4 4-1.2"
          stroke="#4B5563"
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M14 11.5c.7-1 1.2-2.2 1-3.5-1-3.5-4-5-7-5-.8 0-1.6.1-2.3.3"
          stroke="#4B5563"
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
        />
      </>
    )}
  </svg>
);

const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M2 2l8 8M10 2l-8 8" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const LayersIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M8 1L1 5l7 4 7-4-7-4z" fill={ORANGE} opacity={0.8} />
    <path d="M1 8l7 4 7-4" stroke="#94A3B8" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    <path d="M1 11l7 4 7-4" stroke="#94A3B8" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity={0.5} />
  </svg>
);

const InfoIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <circle cx="6" cy="6" r="5" stroke={ORANGE} strokeWidth="1" />
    <path d="M6 5.5v3M6 4h.01" stroke={ORANGE} strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const OpacitySlider: React.FC<{
  value: number;
  onChange: (v: number) => void;
}> = ({ value, onChange }) => (
  <input
    type="range"
    min={0}
    max={100}
    step={5}
    value={Math.round(value * 100)}
    onChange={(e) => onChange(Number(e.target.value) / 100)}
    style={{
      width: '100%',
      height: 3,
      accentColor: ORANGE,
      cursor: 'pointer',
      background: `linear-gradient(to right, ${ORANGE} ${value * 100}%, #374151 ${value * 100}%)`,
    }}
  />
);

const LAYER_ORDER: ReadonlyArray<{ id: LayerId; emoji: string }> = [
  { id: 'rooms', emoji: '▪' },
  { id: 'walls', emoji: '━' },
  { id: 'openings', emoji: '⌐' },
  { id: 'annotations', emoji: '◎' },
  { id: 'dimensions', emoji: '↔' },
];

interface LayerPanelProps {
  readonly overlayState: PlanOverlayState;
  readonly isOpen: boolean;
}

const LayerPanel: React.FC<LayerPanelProps> = ({ overlayState, isOpen }) => {
  const [expandedLayer, setExpandedLayer] = useState<LayerId | null>(null);

  if (!isOpen) return null;

  const { layers, displayOptions } = overlayState;

  const displayToggles: ReadonlyArray<{ key: keyof PlanDisplayOptions; label: string }> = [
    { key: 'showRoomLabels', label: 'Labels pièces' },
    { key: 'showSurfaceLabels', label: 'Surfaces' },
    { key: 'showWetZoneHighlight', label: 'Zones humides' },
    { key: 'showNorthIndicator', label: 'Nord' },
    { key: 'showScaleBar', label: 'Échelle' },
    { key: 'showGrid', label: 'Grille' },
    { key: 'showConfidenceBadges', label: 'Fiabilité' },
  ];

  return (
    <div
      style={{
        background: PANEL_BG,
        backdropFilter: 'blur(12px)',
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        width: 210,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px',
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <LayersIcon />
        <span style={{ color: PANEL_TEXT, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em' }}>
          CALQUES
        </span>
        <button
          onClick={resetLayersToDefaults}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: `1px solid ${BORDER}`,
            borderRadius: 4,
            padding: '1px 6px',
            fontSize: 9,
            color: '#64748B',
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
      </div>

      <div style={{ padding: '6px 0' }}>
        {LAYER_ORDER.map(({ id, emoji }) => {
          const layer = layers[id];
          const expanded = expandedLayer === id;

          return (
            <div key={id}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 12px',
                  transition: 'background 0.15s',
                  cursor: 'default',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <button
                  onClick={() => toggleLayerVisibility(id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    display: 'flex',
                  }}
                  title={layer.visible ? 'Masquer' : 'Afficher'}
                >
                  <EyeIcon open={layer.visible} />
                </button>

                <span style={{ fontSize: 11, color: '#64748B', width: 14, textAlign: 'center' }}>
                  {emoji}
                </span>

                <span
                  style={{
                    fontSize: 11,
                    color: layer.visible ? PANEL_TEXT : '#4B5563',
                    flex: 1,
                    fontWeight: 500,
                  }}
                >
                  {layer.label}
                </span>

                <button
                  onClick={() => setExpandedLayer(expanded ? null : id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '2px 4px',
                    fontSize: 9,
                    color: '#4B5563',
                    cursor: 'pointer',
                  }}
                  title="Opacité"
                >
                  {Math.round(layer.opacity * 100)}%
                </button>
              </div>

              {expanded && (
                <div style={{ padding: '4px 12px 8px', borderBottom: `1px solid ${BORDER}` }}>
                  <OpacitySlider value={layer.opacity} onChange={(v) => setLayerOpacity(id, v)} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: `1px solid ${BORDER}`, padding: '6px 12px 8px' }}>
        <p
          style={{
            fontSize: 9,
            color: '#4B5563',
            letterSpacing: '0.06em',
            marginBottom: 6,
            fontWeight: 600,
          }}
        >
          OPTIONS
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {displayToggles.map(({ key, label }) => {
            const active = displayOptions[key];

            return (
              <button
                key={key}
                onClick={() => toggleDisplayOption(key)}
                style={{
                  fontSize: 9,
                  padding: '2px 7px',
                  borderRadius: 10,
                  border: `1px solid ${active ? ORANGE : BORDER}`,
                  background: active ? 'rgba(249,115,22,0.15)' : 'transparent',
                  color: active ? ORANGE : '#64748B',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface SelectionDetailPanelProps {
  readonly detail: SelectedElementDetail;
  readonly onClose: () => void;
}

const SelectionDetailPanel: React.FC<SelectionDetailPanelProps> = ({ detail, onClose }) => {
  const confColor = confidenceToColor(detail.confidence);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        background: PANEL_BG,
        backdropFilter: 'blur(12px)',
        border: `1px solid ${BORDER}`,
        borderTop: `2px solid ${ORANGE}`,
        borderRadius: 10,
        padding: '12px 16px',
        minWidth: 280,
        maxWidth: 400,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <InfoIcon />

        <div style={{ flex: 1 }}>
          <p style={{ color: PANEL_TEXT, fontSize: 13, fontWeight: 700, margin: 0 }}>
            {detail.title}
          </p>
          {detail.subtitle && (
            <p style={{ color: '#64748B', fontSize: 10, margin: '2px 0 0' }}>
              {detail.subtitle}
            </p>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 7px',
            borderRadius: 8,
            background: `${confColor}22`,
            border: `1px solid ${confColor}55`,
          }}
        >
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: confColor }} />
          <span style={{ fontSize: 9, color: confColor, fontWeight: 600 }}>
            {Math.round(detail.confidence * 100)}%
          </span>
        </div>

        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
        >
          <XIcon />
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '6px 12px',
        }}
      >
        {detail.fields.map((field) => (
          <div key={field.label}>
            <p
              style={{
                color: '#4B5563',
                fontSize: 9,
                margin: '0 0 2px',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {field.label}
            </p>
            <p
              style={{
                color: field.highlight ? ORANGE : PANEL_TEXT,
                fontSize: 12,
                fontWeight: field.highlight ? 700 : 500,
                margin: 0,
              }}
            >
              {field.value}
              {field.unit && (
                <span style={{ color: '#64748B', fontSize: 10, marginLeft: 2 }}>
                  {field.unit}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

const PlanInfoChip: React.FC<{ transcription: PlanTranscriptionResult }> = ({ transcription }) => {
  const confColor = confidenceToColor(transcription.score_confiance_global);
  const pct = Math.round(transcription.score_confiance_global * 100);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: PANEL_BG,
        backdropFilter: 'blur(12px)',
        border: `1px solid ${BORDER}`,
        borderRadius: 20,
        padding: '5px 12px',
        fontSize: 10,
        color: '#94A3B8',
      }}
    >
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: confColor }} />
      <span style={{ color: confColor, fontWeight: 700 }}>{pct}%</span>
      <span>fiabilité</span>

      {transcription.echelle_detectee && (
        <>
          <span style={{ color: BORDER }}>·</span>
          <span style={{ color: PANEL_TEXT, fontWeight: 500 }}>{transcription.echelle_detectee}</span>
        </>
      )}

      <span style={{ color: BORDER }}>·</span>
      <span>{transcription.surfaces.nb_pieces_total} pièces</span>

      {transcription.surfaces.surface_totale_m2 !== null && (
        <>
          <span style={{ color: BORDER }}>·</span>
          <span style={{ color: ORANGE, fontWeight: 600 }}>
            {transcription.surfaces.surface_totale_m2.toFixed(0)} m²
          </span>
        </>
      )}
    </div>
  );
};

export const PlanLayerViewer: React.FC<PlanLayerViewerProps> = ({
  transcription,
  imageUrl,
  planId,
  className,
  onBuildingAreaMeasured,
  triggerOutline = 0,
}) => {
  const [overlayState, setOverlayState] = useState<PlanOverlayState>(() => getLayersStoreState());
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [selectedDetail, setSelectedDetail] = useState<SelectedElementDetail | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const interactionSvgRef = useRef<SVGSVGElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // FIX 1 : ref pour ne déclencher triggerOutline qu'une fois par valeur unique
  const lastTriggerOutlineRef = useRef<number>(0);

  const pointerRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  } | null>(null);

  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 12;
  const DRAG_THRESHOLD = 5;

  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const [isDrawingOutline, setIsDrawingOutline] = useState(false);
  const [outlineVertices, setOutlineVertices] = useState<NormalizedPoint[]>([]);
  const [outlineArea_m2, setOutlineArea_m2] = useState<number | null>(null);
  const [plainSvgMouse, setPlainSvgMouse] = useState<NormalizedPoint | null>(null);

  const calib = useScaleCalibrator(planId);
  const { calibratorState } = calib;

  const isCalibrating =
    calibratorState.status === 'picking_point1' ||
    calibratorState.status === 'picking_point2' ||
    calibratorState.status === 'awaiting_distance';

  const hasImage = !!imageUrl && !imageError;
  const interactionEnabled = isCalibrating || isDrawingOutline;

  useEffect(() => {
    setOverlayState(getLayersStoreState());
    const unsub = subscribeToLayersStore((s) => setOverlayState(s));
    return unsub;
  }, []);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    setNaturalSize(null);
  }, [imageUrl]);

  const handleElementSelected = useCallback(
    (detail: SelectedElementDetail) => {
      if (isCalibrating || isDrawingOutline) return;
      setSelectedDetail(detail);
    },
    [isCalibrating, isDrawingOutline],
  );

  const handleSelectionCleared = useCallback(() => {
    if (isCalibrating || isDrawingOutline) return;
    clearSelection();
    setSelectedDetail(null);
  }, [isCalibrating, isDrawingOutline]);

  const handleCloseDetail = useCallback(() => {
    clearSelection();
    setSelectedDetail(null);
  }, []);

  const handleCalibrationClick = useCallback(
    (point: NormalizedPoint) => {
      if (calibratorState.status === 'picking_point1') {
        calib.pick1(point);
      } else if (calibratorState.status === 'picking_point2') {
        calib.pick2(point);
      }
    },
    [calibratorState.status, calib],
  );

  const handleConfirmCalibration = useCallback(() => {
    const nat = naturalSize ?? {
      w: imgRef.current?.naturalWidth ?? 1000,
      h: imgRef.current?.naturalHeight ?? 1000,
    };

    calib.confirm(nat.w, nat.h);
  }, [naturalSize, calib]);

  // FIX 3 : ne relance pas si déjà en cours de tracé
  const handleStartOutline = useCallback(() => {
    if (isDrawingOutline) return;
    calib.cancel();
    clearSelection();
    setSelectedDetail(null);
    setIsDrawingOutline(true);
    setOutlineVertices([]);
    setOutlineArea_m2(null);
    setPlainSvgMouse(null);
  }, [calib, isDrawingOutline]);

  const handleOutlineClick = useCallback((point: NormalizedPoint) => {
    setOutlineVertices((prev) => [...prev, point]);
  }, []);

  const handleCloseOutline = useCallback(() => {
    if (outlineVertices.length < 3 || !calibratorState.calibration) return;

    const area = computePolygonArea_m2(outlineVertices, calibratorState.calibration);

    setOutlineArea_m2(area);
    setIsDrawingOutline(false);
    setPlainSvgMouse(null);

    if (area !== null) {
      onBuildingAreaMeasured?.(area);
    }
  }, [outlineVertices, calibratorState.calibration, onBuildingAreaMeasured]);

  const handleUndoVertex = useCallback(() => {
    setOutlineVertices((prev) => prev.slice(0, -1));
  }, []);

  // FIX 4 : remet aussi à zéro le pointer et isDragging pour ne pas bloquer les interactions
  const handleCancelOutline = useCallback(() => {
    pointerRef.current = null;
    setIsDragging(false);
    setIsDrawingOutline(false);
    setOutlineVertices([]);
    setOutlineArea_m2(null);
    setPlainSvgMouse(null);
  }, []);

  // FIX 2 : comparaison avec lastTriggerOutlineRef pour n'agir qu'une fois par valeur
  useEffect(() => {
    if (triggerOutline <= 0) return;
    if (triggerOutline === lastTriggerOutlineRef.current) return;
    if (calibratorState.status !== 'calibrated') return;
    lastTriggerOutlineRef.current = triggerOutline;
    handleStartOutline();
  }, [triggerOutline, calibratorState.status, handleStartOutline]);

  const clientToNormalizedPoint = useCallback((clientX: number, clientY: number): NormalizedPoint | null => {
    const svg = interactionSvgRef.current;
    if (!svg) return null;

    const ctm = svg.getScreenCTM();

    if (ctm) {
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;

      const sp = pt.matrixTransform(ctm.inverse());

      return {
        x: Math.max(0, Math.min(1, sp.x / 1000)),
        y: Math.max(0, Math.min(1, sp.y / 1000)),
      };
    }

    const rect = svg.getBoundingClientRect();

    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.13 : 1 / 1.13;

      setZoom((prev) => {
        const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * factor));
        const ratio = next / prev;

        setPanOffset((po) => ({
          x: mx * (1 - ratio) + po.x * ratio,
          y: my * (1 - ratio) + po.y * ratio,
        }));

        return next;
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  const stepZoom = useCallback((factor: number) => {
    const el = containerRef.current;
    if (!el) return;

    const { width, height } = el.getBoundingClientRect();
    const cx = width / 2;
    const cy = height / 2;

    setZoom((prev) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * factor));
      const ratio = next / prev;

      setPanOffset((po) => ({
        x: cx * (1 - ratio) + po.x * ratio,
        y: cy * (1 - ratio) + po.y * ratio,
      }));

      return next;
    });
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      if (isCalibrating && calibratorState.status === 'awaiting_distance') return;

      pointerRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startPanX: panOffset.x,
        startPanY: panOffset.y,
        moved: false,
      };

      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [panOffset, isCalibrating, calibratorState.status],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const point = clientToNormalizedPoint(e.clientX, e.clientY);

      if (interactionEnabled && point) {
        setPlainSvgMouse(point);
      }

      const state = pointerRef.current;
      if (!state || state.pointerId !== e.pointerId) return;

      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      const distance = Math.hypot(dx, dy);

      if (!state.moved && distance < DRAG_THRESHOLD) {
        return;
      }

      state.moved = true;
      setIsDragging(true);

      setPanOffset({
        x: state.startPanX + dx,
        y: state.startPanY + dy,
      });
    },
    [clientToNormalizedPoint, interactionEnabled],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const state = pointerRef.current;
      if (!state || state.pointerId !== e.pointerId) return;

      const wasDrag = state.moved;

      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // noop
      }

      pointerRef.current = null;
      setIsDragging(false);

      if (wasDrag) return;
      if (!interactionEnabled) return;

      const point = clientToNormalizedPoint(e.clientX, e.clientY);
      if (!point) return;

      if (isCalibrating) {
        handleCalibrationClick(point);
        return;
      }

      if (isDrawingOutline) {
        handleOutlineClick(point);
      }
    },
    [
      interactionEnabled,
      clientToNormalizedPoint,
      isCalibrating,
      isDrawingOutline,
      handleCalibrationClick,
      handleOutlineClick,
    ],
  );

  const handlePointerCancel = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // noop
    }

    pointerRef.current = null;
    setIsDragging(false);
  }, []);

  // FIX 5 & 6 : l'overlay SVG (zIndex 999 / pointerEvents auto) n'est rendu
  // que si interactionEnabled est true — donc plus d'overlay fantôme après Annuler.
  const renderInteractionOverlay = () => {
    if (!interactionEnabled) return null;
    if (!hasImage && !transcription) return null;

    const previewPts = isDrawingOutline && plainSvgMouse ? [...outlineVertices, plainSvgMouse] : outlineVertices;

    const toSVG = (p: NormalizedPoint) => ({
      x: p.x * 1000,
      y: p.y * 1000,
    });

    const drawPts = previewPts.map(toSVG);
    const pathD = drawPts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');

    return (
      <svg
        ref={interactionSvgRef}
        data-plan-interaction-svg="true"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 999,
          pointerEvents: 'auto',
          cursor: isDrawingOutline || isCalibrating ? 'crosshair' : 'default',
          overflow: 'visible',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={() => {
          if (!pointerRef.current) {
            setPlainSvgMouse(null);
          }
        }}
      >
        <rect x={0} y={0} width={1000} height={1000} fill="transparent" />

        {isCalibrating && (
          <>
            <rect x={190} y={12} width={620} height={26} fill="rgba(0,0,0,0.68)" rx={6} />
            <text
              x={500}
              y={28}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fill="white"
              fontFamily="system-ui"
              fontWeight="700"
            >
              {calibratorState.status === 'picking_point1'
                ? 'Cliquez le 1er point de référence'
                : calibratorState.status === 'picking_point2'
                  ? 'Cliquez le 2e point de référence'
                  : 'Saisissez la distance réelle'}
            </text>

            {calibratorState.pendingPoint1 && (
              <>
                <circle
                  cx={calibratorState.pendingPoint1.x * 1000}
                  cy={calibratorState.pendingPoint1.y * 1000}
                  r={14}
                  fill="rgba(249,115,22,0.25)"
                />
                <circle
                  cx={calibratorState.pendingPoint1.x * 1000}
                  cy={calibratorState.pendingPoint1.y * 1000}
                  r={6}
                  fill={ORANGE}
                />
              </>
            )}

            {calibratorState.pendingPoint2 && (
              <>
                <circle
                  cx={calibratorState.pendingPoint2.x * 1000}
                  cy={calibratorState.pendingPoint2.y * 1000}
                  r={14}
                  fill="rgba(249,115,22,0.25)"
                />
                <circle
                  cx={calibratorState.pendingPoint2.x * 1000}
                  cy={calibratorState.pendingPoint2.y * 1000}
                  r={6}
                  fill={ORANGE}
                />
              </>
            )}

            {calibratorState.pendingPoint1 && calibratorState.pendingPoint2 && (
              <line
                x1={calibratorState.pendingPoint1.x * 1000}
                y1={calibratorState.pendingPoint1.y * 1000}
                x2={calibratorState.pendingPoint2.x * 1000}
                y2={calibratorState.pendingPoint2.y * 1000}
                stroke={ORANGE}
                strokeWidth={2}
              />
            )}
          </>
        )}

        {isDrawingOutline && (
          <>
            {drawPts.length >= 3 && (
              <path
                d={`${pathD} Z`}
                fill="rgba(249,115,22,0.15)"
                stroke={ORANGE}
                strokeWidth={2}
                strokeDasharray="7 3"
                strokeLinejoin="round"
              />
            )}

            {drawPts.length === 2 && (
              <path
                d={pathD}
                fill="none"
                stroke={ORANGE}
                strokeWidth={2}
                strokeDasharray="7 3"
              />
            )}

            {outlineVertices.length >= 3 && drawPts.length > 0 && (
              <line
                x1={drawPts[drawPts.length - 1].x}
                y1={drawPts[drawPts.length - 1].y}
                x2={drawPts[0].x}
                y2={drawPts[0].y}
                stroke={ORANGE}
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.5}
              />
            )}

            {outlineVertices.map((v, i) => {
              const p = toSVG(v);

              return (
                <g key={`${p.x}-${p.y}-${i}`}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={i === 0 ? 14 : 10}
                    fill="rgba(249,115,22,0.16)"
                  />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={5}
                    fill={i === 0 ? '#EF4444' : ORANGE}
                  />
                  <text
                    x={p.x + 9}
                    y={p.y - 9}
                    fontSize={9}
                    fontWeight="700"
                    fill={ORANGE}
                    fontFamily="system-ui"
                  >
                    {i + 1}
                  </text>
                </g>
              );
            })}

            {outlineVertices.length === 0 && (
              <>
                <rect x={180} y={14} width={640} height={26} fill="rgba(0,0,0,0.68)" rx={6} />
                <text
                  x={500}
                  y={30}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={11}
                  fill="white"
                  fontFamily="system-ui"
                  fontWeight="700"
                >
                  Cliquez sur chaque sommet du bâtiment dans l'ordre
                </text>
              </>
            )}
          </>
        )}
      </svg>
    );
  };

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        backgroundColor: '#0A0A0F',
        borderRadius: 12,
        overflow: 'hidden',
        border: `1px solid ${BORDER}`,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          background: isCalibrating ? 'rgba(249,115,22,0.18)' : 'rgba(0,0,0,0.6)',
          borderBottom: `1px solid ${isCalibrating ? 'rgba(249,115,22,0.4)' : BORDER}`,
          zIndex: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: ORANGE, flexShrink: 0 }} />
          <span
            style={{
              color: PANEL_TEXT,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {isCalibrating
              ? calibratorState.status === 'picking_point1'
                ? '① Cliquez le premier point sur le plan'
                : calibratorState.status === 'picking_point2'
                  ? '② Cliquez le deuxième point'
                  : '③ Saisissez la distance réelle'
              : transcription?.source_file_name ?? 'Vue vectorielle'}
          </span>
        </div>

        {calibratorState.status === 'calibrated' && calibratorState.calibration && !isCalibrating && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '3px 9px',
              borderRadius: 8,
              background: 'rgba(16,185,129,0.15)',
              border: '1px solid rgba(16,185,129,0.4)',
              fontSize: 9,
              color: '#10B981',
              fontWeight: 700,
            }}
          >
            ✓ {formatCalibrationLabel(calibratorState.calibration)}
            <button
              onClick={calib.clear}
              title="Supprimer la calibration"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#6B7280',
                padding: '0 0 0 4px',
                fontSize: 10,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {transcription && !isCalibrating && <PlanInfoChip transcription={transcription} />}

        {!isCalibrating ? (
          <button
            onClick={() => {
              calib.start();
              setSelectedDetail(null);
              setIsDrawingOutline(false);
            }}
            title="Calibrer l'échelle manuellement"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              borderRadius: 6,
              border: `1px solid ${calibratorState.status === 'calibrated' ? 'rgba(16,185,129,0.4)' : BORDER}`,
              background: calibratorState.status === 'calibrated' ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)',
              color: calibratorState.status === 'calibrated' ? '#10B981' : '#64748B',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            📐 {calibratorState.status === 'calibrated' ? 'Recalibrer' : "Calibrer l'échelle"}
          </button>
        ) : (
          <button
            onClick={calib.cancel}
            style={{
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid rgba(239,68,68,0.4)',
              background: 'rgba(239,68,68,0.1)',
              color: '#FCA5A5',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Annuler
          </button>
        )}

        {calibratorState.status === 'calibrated' && !isCalibrating && !isDrawingOutline && (
          <button
            onClick={handleStartOutline}
            title="Tracer le contour du bâtiment pour mesurer sa surface"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              borderRadius: 6,
              border: `1px solid ${outlineArea_m2 !== null ? 'rgba(16,185,129,0.5)' : BORDER}`,
              background: outlineArea_m2 !== null ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.04)',
              color: outlineArea_m2 !== null ? '#10B981' : '#64748B',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            ⬡ {outlineArea_m2 !== null ? `${outlineArea_m2.toFixed(1)} m²` : 'Mesurer la surface'}
          </button>
        )}

        {isDrawingOutline && (
          <>
            <button
              onClick={resetZoom}
              title="Revenir à la vue globale"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid rgba(99,102,241,0.5)',
                background: 'rgba(99,102,241,0.15)',
                color: '#A5B4FC',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              ⊡ Vue globale
            </button>

            <div
              style={{
                padding: '4px 8px',
                borderRadius: 5,
                background: 'rgba(0,0,0,0.3)',
                color: '#64748B',
                fontSize: 10,
                flexShrink: 0,
              }}
            >
              Clic = sommet · glisser = déplacer
            </div>

            <div
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                background: 'rgba(249,115,22,0.2)',
                border: '1px solid rgba(249,115,22,0.5)',
                color: ORANGE,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {outlineVertices.length === 0
                ? '① Cliquez le 1er sommet'
                : outlineVertices.length === 1
                  ? '② Cliquez le sommet suivant'
                  : `${outlineVertices.length} sommets — continuez ou terminez`}
            </div>

            {outlineVertices.length > 0 && (
              <button
                onClick={handleUndoVertex}
                title="Annuler le dernier sommet"
                style={{
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: `1px solid ${BORDER}`,
                  background: 'rgba(255,255,255,0.05)',
                  color: '#94A3B8',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                ↺ Défaire
              </button>
            )}

            {outlineVertices.length >= 3 && (
              <button
                onClick={handleCloseOutline}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'linear-gradient(90deg,#f97316,#ef4444)',
                  color: 'white',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ✓ Terminer ({outlineVertices.length} pts)
              </button>
            )}

            <button
              onClick={handleCancelOutline}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid rgba(239,68,68,0.4)',
                background: 'rgba(239,68,68,0.1)',
                color: '#FCA5A5',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Annuler
            </button>
          </>
        )}

        {!isCalibrating && !isDrawingOutline && transcription && (
          <button
            onClick={() => setIsPanelOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              borderRadius: 6,
              border: `1px solid ${isPanelOpen ? ORANGE : BORDER}`,
              background: isPanelOpen ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.04)',
              color: isPanelOpen ? ORANGE : '#64748B',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <LayersIcon />
            Calques
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 480,
          overflow: 'hidden',
          background: hasImage
            ? '#111118'
            : 'repeating-linear-gradient(45deg, #0D0D14 0px, #0D0D14 10px, #0A0A10 10px, #0A0A10 20px)',
          cursor: isDragging ? 'grabbing' : interactionEnabled ? 'crosshair' : zoom > 1.05 ? 'grab' : 'default',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transformOrigin: '0 0',
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
            willChange: 'transform',
          }}
        >
          {imageUrl && !imageError && (
            <img
              ref={imgRef}
              src={imageUrl}
              alt={transcription ? `Plan source : ${transcription.source_file_name}` : 'Plan source'}
              onLoad={(e) => {
                setImageLoaded(true);
                const img = e.currentTarget;
                setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              onError={() => setImageError(true)}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                opacity: imageLoaded ? 1 : 0,
                transition: 'opacity 0.4s ease',
                pointerEvents: 'none',
              }}
            />
          )}

          {transcription && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 5,
                pointerEvents: interactionEnabled ? 'none' : 'auto',
              }}
            >
              <PlanVectorCanvas
                transcription={transcription}
                onElementSelected={handleElementSelected}
                onSelectionCleared={handleSelectionCleared}
                calibrationMode={false}
                calibrationStatus={calibratorState.status}
                calibrationPoint1={calibratorState.pendingPoint1}
                calibrationPoint2={calibratorState.pendingPoint2}
                onCalibrationClick={handleCalibrationClick}
                buildingOutlineMode={false}
                buildingOutlineVertices={[]}
                buildingOutlineArea_m2={outlineArea_m2}
                onBuildingOutlineClick={handleOutlineClick}
              />
            </div>
          )}

          {/* FIX 5 & 6 : rendu conditionnel — null si !interactionEnabled */}
          {renderInteractionOverlay()}
        </div>

        {imageUrl && !imageError && !imageLoaded && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                border: `2px solid ${BORDER}`,
                borderTopColor: ORANGE,
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          </div>
        )}

        {imageError && (
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(239,68,68,0.15)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 6,
              padding: '4px 12px',
              fontSize: 10,
              color: '#FCA5A5',
              pointerEvents: 'none',
            }}
          >
            Image source non disponible — affichage vectoriel seul
          </div>
        )}

        {calibratorState.status === 'awaiting_distance' && (
          <div
            style={{
              position: 'absolute',
              bottom: 56,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(10,10,18,0.97)',
              backdropFilter: 'blur(12px)',
              border: `1.5px solid ${ORANGE}`,
              borderRadius: 12,
              padding: '16px 20px',
              minWidth: 320,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              zIndex: 50,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
            }}
          >
            <p style={{ margin: 0, fontSize: 12, color: PANEL_TEXT, fontWeight: 700 }}>
              📐 Distance réelle entre les deux points
            </p>

            <p style={{ margin: 0, fontSize: 10, color: '#64748B', lineHeight: 1.5 }}>
              Indiquez la longueur connue correspondant à la ligne tracée.
            </p>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                min={0.01}
                step={0.01}
                autoFocus
                value={calibratorState.distanceInput}
                onChange={(e) => calib.setDistance(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmCalibration();
                }}
                placeholder="ex. 3.00"
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: `1.5px solid ${calibratorState.error ? '#EF4444' : ORANGE}`,
                  background: 'rgba(255,255,255,0.06)',
                  color: PANEL_TEXT,
                  fontSize: 16,
                  fontWeight: 700,
                  outline: 'none',
                  textAlign: 'right',
                  fontFamily: 'inherit',
                }}
              />
              <span style={{ color: '#64748B', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                m
              </span>
            </div>

            {calibratorState.error && (
              <p style={{ margin: 0, fontSize: 10, color: '#FCA5A5' }}>
                {calibratorState.error}
              </p>
            )}

            <button
              onClick={handleConfirmCalibration}
              disabled={!calibratorState.distanceInput}
              style={{
                padding: '10px',
                borderRadius: 8,
                border: 'none',
                background: calibratorState.distanceInput
                  ? 'linear-gradient(90deg,#f97316,#ef4444)'
                  : 'rgba(255,255,255,0.08)',
                color: calibratorState.distanceInput ? 'white' : '#64748B',
                fontSize: 12,
                fontWeight: 700,
                cursor: calibratorState.distanceInput ? 'pointer' : 'not-allowed',
              }}
            >
              ✓ Valider l'échelle
            </button>
          </div>
        )}

        {!isCalibrating && !isDrawingOutline && transcription && (
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 30 }}>
            <LayerPanel overlayState={overlayState} isOpen={isPanelOpen} />
          </div>
        )}

        {!isCalibrating && !isDrawingOutline && selectedDetail !== null && (
          <SelectionDetailPanel detail={selectedDetail} onClose={handleCloseDetail} />
        )}

        {transcription &&
          transcription.rooms.length === 0 &&
          transcription.walls.length === 0 &&
          transcription.openings.length === 0 && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                pointerEvents: 'none',
              }}
            >
              <div style={{ color: '#374151', fontSize: 36, lineHeight: 1 }}>⬡</div>
              <p style={{ color: '#4B5563', fontSize: 12, margin: 0 }}>
                Aucun élément vectoriel détecté
              </p>
            </div>
          )}

        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 40,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            background: 'rgba(10,10,18,0.88)',
            backdropFilter: 'blur(8px)',
            border: `1px solid ${BORDER}`,
            borderRadius: 20,
            padding: '3px 4px',
            fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
            userSelect: 'none',
          }}
        >
          <button
            onClick={() => stepZoom(1 / 1.5)}
            title="Dézoomer"
            disabled={zoom <= MIN_ZOOM + 0.01}
            style={{
              background: 'none',
              border: 'none',
              color: zoom <= MIN_ZOOM + 0.01 ? '#374151' : PANEL_TEXT,
              fontSize: 16,
              fontWeight: 700,
              lineHeight: 1,
              cursor: zoom <= MIN_ZOOM + 0.01 ? 'not-allowed' : 'pointer',
              padding: '4px 10px',
              borderRadius: 14,
              minWidth: 30,
              textAlign: 'center',
            }}
          >
            −
          </button>

          <button
            onClick={resetZoom}
            title="Vue d'ensemble"
            style={{
              background: zoom !== 1 ? 'rgba(249,115,22,0.15)' : 'none',
              border: 'none',
              color: zoom !== 1 ? ORANGE : '#64748B',
              fontSize: 10,
              fontWeight: 700,
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: 10,
              minWidth: 46,
              textAlign: 'center',
              fontVariantNumeric: 'tabular-nums',
              transition: 'all 0.15s',
            }}
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            onClick={() => stepZoom(1.5)}
            title="Zoomer"
            disabled={zoom >= MAX_ZOOM - 0.01}
            style={{
              background: 'none',
              border: 'none',
              color: zoom >= MAX_ZOOM - 0.01 ? '#374151' : PANEL_TEXT,
              fontSize: 16,
              fontWeight: 700,
              lineHeight: 1,
              cursor: zoom >= MAX_ZOOM - 0.01 ? 'not-allowed' : 'pointer',
              padding: '4px 10px',
              borderRadius: 14,
              minWidth: 30,
              textAlign: 'center',
            }}
          >
            +
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '6px 14px',
          background: 'rgba(0,0,0,0.5)',
          borderTop: `1px solid ${BORDER}`,
          fontSize: 10,
          color: '#374151',
        }}
      >
        {transcription ? (
          <>
            <span>{transcription.rooms.length} pièces</span>
            <span>·</span>
            <span>{transcription.walls.length} murs</span>
            <span>·</span>
            <span>{transcription.openings.length} ouvertures</span>
            <span>·</span>
            <span>{transcription.annotations.length} annotations</span>
            <span style={{ marginLeft: 'auto', color: '#1F2937' }}>
              {transcription.modele_utilise}
            </span>
            <span>·</span>
            <span style={{ color: '#1F2937' }}>
              {(transcription.duree_traitement_ms / 1000).toFixed(1)}s
            </span>
          </>
        ) : (
          <span style={{ color: '#6B7280' }}>
            {isCalibrating
              ? 'Mode calibration actif — pas de transcription vectorielle'
              : 'Aucune transcription disponible'}
          </span>
        )}

        {calibratorState.status === 'calibrated' && calibratorState.calibration && (
          <>
            <span style={{ marginLeft: 'auto' }} />
            <span style={{ color: '#10B981', fontWeight: 600 }}>
              📐 {Math.round(calibratorState.calibration.pixelsPerMeter)} px/m
            </span>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default PlanLayerViewer;