// src/spaces/rehabilitation/components/PlanOverlayViewer.tsx
// ---------------------------------------------------------------------------
// Viewer de calques superposés.
//
// Affiche le plan uploadé en fond + des calques SVG vectoriels par-dessus
// (murs détectés, porteurs, ouvertures, zones humides, pièces, cotations,
//  plan généré). Chaque calque est activable/désactivable en un clic.
//
// Style Mimmoza Réhabilitation : orange #f97316.
// ---------------------------------------------------------------------------

import React, { useMemo, useRef } from 'react';
import { polygonCentroid } from '../plan-reader/planGeometryNormalizer';
import type { LayerVisibility, Opening, PlanGeometry, PlanOverlaySnapshot, Point2D, Room, Wall } from '../plan-reader/types';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const COLORS = {
  primary: '#f97316',          // orange Mimmoza réhab
  primarySoft: '#fed7aa',
  porteur: '#1f2937',          // gris-noir : mur porteur verrouillé
  cloisonExistante: '#475569',
  cloisonNouvelle: '#f97316',  // pointillés orange
  porte: '#0ea5e9',
  fenetre: '#0284c7',
  baie: '#0369a1',
  zoneHumide: '#22d3ee',
  piece: '#94a3b8',
  cotation: '#dc2626',
  generePlan: '#fb923c',
  enveloppe: '#0f172a',
  warning: '#f59e0b',
  error: '#ef4444',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PlanOverlayViewerProps {
  snapshot: PlanOverlaySnapshot;
  onToggleLayer: (layer: keyof LayerVisibility) => void;
  /** Hauteur max du viewer en px (largeur = 100 %) */
  maxHeight?: number;
  /** Affiche le panneau de contrôle des calques (sinon : viewer seul) */
  showControls?: boolean;
  /** Callback optionnel quand l'utilisateur clique sur une pièce */
  onRoomClick?: (room: Room) => void;
}

// ---------------------------------------------------------------------------
// Helpers SVG
// ---------------------------------------------------------------------------

const pointsToPath = (points: Point2D[], w: number, h: number, close = true): string => {
  if (points.length === 0) return '';
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * w} ${p.y * h}`)
    .join(' ');
  return close ? `${d} Z` : d;
};

const wallStyle = (wall: Wall): { stroke: string; strokeWidth: number; dash: string | undefined } => {
  switch (wall.type) {
    case 'porteur':
      return { stroke: COLORS.porteur, strokeWidth: 5, dash: undefined };
    case 'cloison-existante':
      return { stroke: COLORS.cloisonExistante, strokeWidth: 3, dash: undefined };
    case 'cloison-nouvelle':
      return { stroke: COLORS.cloisonNouvelle, strokeWidth: 3, dash: '6 4' };
  }
};

const openingStyle = (opening: Opening): string => {
  switch (opening.type) {
    case 'porte': return COLORS.porte;
    case 'porte-fenetre': return COLORS.porte;
    case 'fenetre': return COLORS.fenetre;
    case 'baie': return COLORS.baie;
  }
};

// ---------------------------------------------------------------------------
// Sous-composants de calques
// ---------------------------------------------------------------------------

const EnvelopeLayer: React.FC<{ geometry: PlanGeometry; w: number; h: number }> = ({ geometry, w, h }) => (
  geometry.envelopePolygon.length >= 3 ? (
    <path
      d={pointsToPath(geometry.envelopePolygon, w, h, true)}
      fill="none"
      stroke={COLORS.enveloppe}
      strokeWidth={2}
      strokeOpacity={0.6}
    />
  ) : null
);

const WallsLayer: React.FC<{
  walls: Wall[];
  w: number;
  h: number;
  filter: 'porteurs' | 'non-porteurs' | 'all';
}> = ({ walls, w, h, filter }) => (
  <g>
    {walls
      .filter(wall => {
        if (filter === 'porteurs') return wall.type === 'porteur';
        if (filter === 'non-porteurs') return wall.type !== 'porteur';
        return true;
      })
      .map(wall => {
        const s = wallStyle(wall);
        return (
          <line
            key={wall.id}
            x1={wall.start.x * w}
            y1={wall.start.y * h}
            x2={wall.end.x * w}
            y2={wall.end.y * h}
            stroke={s.stroke}
            strokeWidth={s.strokeWidth}
            strokeDasharray={s.dash}
            strokeLinecap="round"
            opacity={wall.confidence === 'rejete' ? 0.3 : 0.9}
          />
        );
      })}
  </g>
);

const OpeningsLayer: React.FC<{
  walls: Wall[];
  openings: Opening[];
  w: number;
  h: number;
}> = ({ walls, openings, w, h }) => (
  <g>
    {openings.map(o => {
      const wall = walls.find(wl => wl.id === o.wallId);
      if (!wall) return null;
      const cx = (wall.start.x + (wall.end.x - wall.start.x) * o.positionAlongWall) * w;
      const cy = (wall.start.y + (wall.end.y - wall.start.y) * o.positionAlongWall) * h;
      const color = openingStyle(o);
      return (
        <g key={o.id}>
          <circle cx={cx} cy={cy} r={6} fill="white" stroke={color} strokeWidth={2} />
          <circle cx={cx} cy={cy} r={2.5} fill={color} />
        </g>
      );
    })}
  </g>
);

const RoomsLayer: React.FC<{
  rooms: Room[];
  w: number;
  h: number;
  wetOnly?: boolean;
  onClick?: (r: Room) => void;
}> = ({ rooms, w, h, wetOnly = false, onClick }) => (
  <g>
    {rooms
      .filter(r => (wetOnly ? r.isWet : true))
      .map(room => {
        const fill = wetOnly ? COLORS.zoneHumide : COLORS.piece;
        const centroid = polygonCentroid(room.polygon);
        return (
          <g
            key={room.id}
            style={{ cursor: onClick ? 'pointer' : 'default' }}
            onClick={() => onClick?.(room)}
          >
            <path
              d={pointsToPath(room.polygon, w, h, true)}
              fill={fill}
              fillOpacity={0.18}
              stroke={fill}
              strokeWidth={1}
              strokeOpacity={0.6}
            />
            {!wetOnly && (
              <text
                x={centroid.x * w}
                y={centroid.y * h}
                textAnchor="middle"
                fontSize={11}
                fontFamily="system-ui, -apple-system, sans-serif"
                fill="#0f172a"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                <tspan x={centroid.x * w} dy={0} fontWeight={600}>{room.label}</tspan>
                {room.surfaceM2 !== null && (
                  <tspan x={centroid.x * w} dy={14} fontSize={9} opacity={0.7}>
                    {room.surfaceM2.toFixed(1)} m²
                  </tspan>
                )}
                {room.confidence !== 'certain' && (
                  <tspan x={centroid.x * w} dy={12} fontSize={9} fill={COLORS.warning}>
                    à confirmer
                  </tspan>
                )}
              </text>
            )}
          </g>
        );
      })}
  </g>
);

const CotationsLayer: React.FC<{
  cotations: PlanOverlaySnapshot['metadata']['cotationsDetectees'];
  w: number;
  h: number;
}> = ({ cotations, w, h }) => (
  <g>
    {cotations
      .filter(c => c.fromNormalized.x !== c.toNormalized.x || c.fromNormalized.y !== c.toNormalized.y)
      .map((c, i) => {
        const x1 = c.fromNormalized.x * w;
        const y1 = c.fromNormalized.y * h;
        const x2 = c.toNormalized.x * w;
        const y2 = c.toNormalized.y * h;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        return (
          <g key={`cot-${i}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={COLORS.cotation} strokeWidth={1} />
            <text
              x={mx}
              y={my - 4}
              fill={COLORS.cotation}
              fontSize={10}
              fontFamily="system-ui, sans-serif"
              textAnchor="middle"
            >
              {(c.valeurMm / 1000).toFixed(2)} m
            </text>
          </g>
        );
      })}
  </g>
);

const GeneratedPlanLayer: React.FC<{ geometry: PlanGeometry | null; w: number; h: number }> = ({
  geometry, w, h,
}) => {
  if (!geometry) return null;
  return (
    <g opacity={0.85}>
      {geometry.walls.map(wall => (
        <line
          key={`gen-${wall.id}`}
          x1={wall.start.x * w}
          y1={wall.start.y * h}
          x2={wall.end.x * w}
          y2={wall.end.y * h}
          stroke={COLORS.generePlan}
          strokeWidth={2}
          strokeDasharray="4 4"
          strokeLinecap="round"
        />
      ))}
      {geometry.rooms.map(room => {
        const centroid = polygonCentroid(room.polygon);
        return (
          <g key={`gen-room-${room.id}`}>
            <path
              d={pointsToPath(room.polygon, w, h, true)}
              fill={COLORS.generePlan}
              fillOpacity={0.08}
              stroke={COLORS.generePlan}
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <text
              x={centroid.x * w}
              y={centroid.y * h}
              textAnchor="middle"
              fontSize={10}
              fill={COLORS.generePlan}
              fontWeight={600}
            >
              {room.label}
            </text>
          </g>
        );
      })}
    </g>
  );
};

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

const LAYER_DEFS: Array<{
  key: keyof LayerVisibility;
  label: string;
  swatch: string;
  dashed?: boolean;
}> = [
  { key: 'imageSource', label: 'Image source', swatch: '#e2e8f0' },
  { key: 'mursDetectes', label: 'Murs détectés', swatch: COLORS.cloisonExistante },
  { key: 'mursPorteurs', label: 'Murs porteurs', swatch: COLORS.porteur },
  { key: 'ouvertures', label: 'Ouvertures', swatch: COLORS.porte },
  { key: 'zonesHumides', label: 'Zones humides', swatch: COLORS.zoneHumide },
  { key: 'pieces', label: 'Pièces', swatch: COLORS.piece },
  { key: 'cotations', label: 'Cotations', swatch: COLORS.cotation },
  { key: 'planGenere', label: 'Plan généré', swatch: COLORS.generePlan, dashed: true },
];

export const PlanOverlayViewer: React.FC<PlanOverlayViewerProps> = ({
  snapshot,
  onToggleLayer,
  maxHeight = 600,
  showControls = true,
  onRoomClick,
}) => {
  const { sourceImage, detectedGeometry, generatedPlan, layerVisibility, metadata } = snapshot;
  const containerRef = useRef<HTMLDivElement>(null);

  const { aspectRatio, viewBoxW, viewBoxH } = useMemo(() => {
    const w = sourceImage.widthPx > 0 ? sourceImage.widthPx : 1000;
    const h = sourceImage.heightPx > 0 ? sourceImage.heightPx : 700;
    return { aspectRatio: w / h, viewBoxW: w, viewBoxH: h };
  }, [sourceImage.widthPx, sourceImage.heightPx]);

  const hasImage = !!sourceImage.dataUrl;

  return (
    <div style={styles.root}>
      <div
        ref={containerRef}
        style={{
          ...styles.canvas,
          maxHeight,
          aspectRatio: `${aspectRatio}`,
        }}
      >
        {!hasImage && (
          <div style={styles.placeholder}>
            <div style={{ fontSize: 14, color: '#64748b' }}>
              Aucun plan chargé. Téléversez une image depuis la page Analyse.
            </div>
          </div>
        )}

        {hasImage && layerVisibility.imageSource && (
          <img
            src={sourceImage.dataUrl!}
            alt={sourceImage.filename ?? 'Plan source'}
            style={styles.image}
            draggable={false}
          />
        )}

        {hasImage && (
          <svg
            viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
            preserveAspectRatio="xMidYMid meet"
            style={styles.svgOverlay}
          >
            <EnvelopeLayer geometry={detectedGeometry} w={viewBoxW} h={viewBoxH} />

            {layerVisibility.pieces && (
              <RoomsLayer
                rooms={detectedGeometry.rooms}
                w={viewBoxW}
                h={viewBoxH}
                onClick={onRoomClick}
              />
            )}

            {layerVisibility.zonesHumides && (
              <RoomsLayer rooms={detectedGeometry.rooms} w={viewBoxW} h={viewBoxH} wetOnly />
            )}

            {layerVisibility.mursDetectes && (
              <WallsLayer walls={detectedGeometry.walls} w={viewBoxW} h={viewBoxH} filter="non-porteurs" />
            )}

            {layerVisibility.mursPorteurs && (
              <WallsLayer walls={detectedGeometry.walls} w={viewBoxW} h={viewBoxH} filter="porteurs" />
            )}

            {layerVisibility.ouvertures && (
              <OpeningsLayer
                walls={detectedGeometry.walls}
                openings={detectedGeometry.openings}
                w={viewBoxW}
                h={viewBoxH}
              />
            )}

            {layerVisibility.cotations && (
              <CotationsLayer cotations={metadata.cotationsDetectees} w={viewBoxW} h={viewBoxH} />
            )}

            {layerVisibility.planGenere && (
              <GeneratedPlanLayer geometry={generatedPlan} w={viewBoxW} h={viewBoxH} />
            )}
          </svg>
        )}
      </div>

      {showControls && (
        <div style={styles.controls}>
          <div style={styles.controlsTitle}>Calques affichés</div>
          <div style={styles.layerGrid}>
            {LAYER_DEFS.map(def => {
              const active = layerVisibility[def.key];
              const disabled = def.key === 'planGenere' && !generatedPlan;
              return (
                <button
                  key={def.key}
                  type="button"
                  onClick={() => !disabled && onToggleLayer(def.key)}
                  disabled={disabled}
                  style={{
                    ...styles.layerButton,
                    ...(active ? styles.layerButtonActive : styles.layerButtonInactive),
                    opacity: disabled ? 0.4 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                  title={disabled ? 'Aucun plan généré disponible' : `${active ? 'Masquer' : 'Afficher'} ${def.label.toLowerCase()}`}
                >
                  <span
                    style={{
                      ...styles.swatch,
                      background: def.dashed
                        ? `repeating-linear-gradient(45deg, ${def.swatch}, ${def.swatch} 3px, transparent 3px, transparent 6px)`
                        : def.swatch,
                    }}
                  />
                  <span style={{ flex: 1, textAlign: 'left' }}>{def.label}</span>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>{active ? 'ON' : 'OFF'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Styles inline (palette Mimmoza, sans dépendance externe)
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    width: '100%',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  canvas: {
    position: 'relative',
    width: '100%',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  placeholder: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    textAlign: 'center',
  },
  image: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    userSelect: 'none',
  },
  svgOverlay: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  },
  controls: {
    padding: 12,
    background: 'white',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
  },
  controlsTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 10,
  },
  layerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 8,
  },
  layerButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    fontSize: 13,
    borderRadius: 8,
    border: '1px solid transparent',
    transition: 'all 0.15s ease',
  },
  layerButtonActive: {
    background: COLORS.primarySoft,
    borderColor: COLORS.primary,
    color: '#7c2d12',
    fontWeight: 600,
  },
  layerButtonInactive: {
    background: '#f1f5f9',
    borderColor: '#e2e8f0',
    color: '#475569',
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 3,
    border: '1px solid rgba(0,0,0,0.08)',
    flexShrink: 0,
  },
};

export default PlanOverlayViewer;