// SelectionOverlay.tsx
// Overlay SVG de sélection pour l'éditeur 2D Mimmoza.
// Affiche : contour en pointillés violet + 8 poignées interactives.
// Rendu dans l'espace SVG parcelleLocal (Y-down, mètres).
//
// Design :
//   - Coins (nw/ne/se/sw) → carrés blancs à coins arrondis
//   - Côtés (n/s/e/w)     → cercles blancs
//   - Hitbox > visuel pour faciliter la sélection au doigt / trackpad
//   - Taille fixe en pixels grâce à pixelScale (indépendant du zoom)
//   - vectorEffect="non-scaling-stroke" pour les traits
//
// V2.0 — 8 poignées, pixelScale, feedback hover, ancre fixe.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import {
  ALL_HANDLE_IDS,
  HANDLE_CURSORS,
  getAllHandlePositions,
  getRectCornersWorld,
  type HandleId,
  type BuildingRect,
  type TPoint2D,
}                                   from './editor2d.transform';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes visuelles (toutes en pixels écran)
// ─────────────────────────────────────────────────────────────────────────────

/** Demi-côté des poignées carrées (coins) en pixels écran. */
const CORNER_HALF_PX  = 5;
/** Rayon des poignées rondes (côtés) en pixels écran. */
const SIDE_RADIUS_PX  = 4;
/** Rayon de la hitbox invisible (plus grande que le visuel → facilite le clic). */
const HIT_RADIUS_PX   = 12;
/** Épaisseur du trait de contour en pixels écran. */
const OUTLINE_PX      = 1.5;
/** Épaisseur du trait des poignées en pixels écran. */
const HANDLE_STROKE_PX = 1.5;
/** Longueur du tiret du contour pointillé en pixels écran. */
const DASH_ON_PX      = 6;
/** Longueur de l'espace entre tirets en pixels écran. */
const DASH_OFF_PX     = 4;

/** Scale par défaut si pixelScale n'est pas fourni (zoom "neutre" ≈ 10 px/m). */
const DEFAULT_SCALE_PX_PER_M = 10;

const CORNER_HANDLES = new Set<HandleId>(['nw', 'ne', 'se', 'sw']);

// Couleurs (palette Promoteur violet)
const COLOR_INDIGO  = '#4f46e5';
const COLOR_WHITE   = '#ffffff';
const COLOR_HOVER   = '#818cf8'; // indigo-400

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectionOverlayProps {
  /** Rect courant du bâtiment sélectionné. */
  rect:                BuildingRect;
  /**
   * Facteur de zoom courant en pixels par mètre.
   * Permet aux poignées d'avoir une taille fixe en pixels quel que soit le zoom.
   * Calcul côté canvas : pixelScale = svgDomWidth / viewBoxWidthMeters
   */
  pixelScale?:         number;
  /** Rappelé au pointerdown d'une poignée → déclenche resize dans usePlan2DEditor. */
  onHandlePointerDown: (e: React.PointerEvent<SVGGElement>, handle: HandleId) => void;
  /** Rappelé au pointerdown du corps de l'overlay → déclenche move. */
  onBodyPointerDown?:  (e: React.PointerEvent<SVGGElement>) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Composant Handle individuel
// ─────────────────────────────────────────────────────────────────────────────

interface HandleProps {
  handle:         HandleId;
  pos:            TPoint2D;
  scale:          number;           // px/m
  onPointerDown:  (e: React.PointerEvent<SVGGElement>, h: HandleId) => void;
}

const Handle: React.FC<HandleProps> = ({ handle, pos, scale, onPointerDown }) => {
  const [hovered, setHovered] = useState(false);
  const isCorner              = CORNER_HANDLES.has(handle);
  const cursor                = HANDLE_CURSORS[handle];

  // Tailles en mètres (converties depuis px via le scale courant)
  const hitR   = HIT_RADIUS_PX   / scale;
  const vizH   = isCorner ? CORNER_HALF_PX  / scale : SIDE_RADIUS_PX / scale;
  const sw     = HANDLE_STROKE_PX / scale;

  const fill   = hovered ? COLOR_HOVER : COLOR_WHITE;
  const stroke = hovered ? COLOR_HOVER : COLOR_INDIGO;

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      style={{ cursor }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={e => {
        e.stopPropagation();
        onPointerDown(e, handle);
      }}
    >
      {/* Hitbox invisible — ne jamais réduire en dessous de HIT_RADIUS_PX */}
      <circle
        r={hitR}
        fill="transparent"
        vectorEffect="non-scaling-stroke"
      />

      {/* Visuel de la poignée */}
      {isCorner ? (
        // Coin → carré légèrement arrondi
        <rect
          x={-vizH}
          y={-vizH}
          width={vizH * 2}
          height={vizH * 2}
          rx={vizH * 0.3}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: 'none' }}
        />
      ) : (
        // Côté → cercle
        <circle
          r={vizH}
          fill={fill}
          stroke={stroke}
          strokeWidth={sw}
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Composant principal SelectionOverlay
// ─────────────────────────────────────────────────────────────────────────────

export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({
  rect,
  pixelScale,
  onHandlePointerDown,
  onBodyPointerDown,
}) => {
  const scale = pixelScale ?? DEFAULT_SCALE_PX_PER_M;

  // ── Géométrie ──────────────────────────────────────────────────────────────

  // Les 4 coins du rect en espace monde (nw → ne → se → sw)
  const corners         = useMemo(() => getRectCornersWorld(rect), [rect]);
  // Les 8 positions de poignées en espace monde
  const handlePositions = useMemo(() => getAllHandlePositions(rect), [rect]);

  // ── Chemin SVG du contour ──────────────────────────────────────────────────

  const pathD = useMemo(() => {
    const [nw, ne, se, sw] = corners;
    return [
      `M ${nw.x} ${nw.y}`,
      `L ${ne.x} ${ne.y}`,
      `L ${se.x} ${se.y}`,
      `L ${sw.x} ${sw.y}`,
      'Z',
    ].join(' ');
  }, [corners]);

  // ── Épaisseurs converties en mètres SVG via pixelScale ────────────────────
  const outlineSW  = OUTLINE_PX     / scale;
  const dashOn     = DASH_ON_PX     / scale;
  const dashOff    = DASH_OFF_PX    / scale;

  return (
    <g data-selection-overlay>

      {/* ── Corps de l'overlay (zone de move) ──────────────────────────────── */}
      {/* Le path de remplissage transparent capture les clicks sur le corps */}
      <path
        d={pathD}
        fill="rgba(79, 70, 229, 0.04)"
        stroke="none"
        style={{
          cursor:        onBodyPointerDown ? 'move' : 'default',
          pointerEvents: onBodyPointerDown ? 'all'  : 'none',
        }}
        onPointerDown={onBodyPointerDown as React.PointerEventHandler<SVGPathElement> | undefined}
      />

      {/* ── Contour pointillé indigo ────────────────────────────────────────── */}
      <path
        d={pathD}
        fill="none"
        stroke={COLOR_INDIGO}
        strokeWidth={outlineSW}
        strokeDasharray={`${dashOn} ${dashOff}`}
        vectorEffect="non-scaling-stroke"
        style={{ pointerEvents: 'none' }}
      />

      {/* ── Coins des pointillés (points pleins aux angles pour la lisibilité) */}
      {corners.map((c, i) => (
        <circle
          key={i}
          cx={c.x}
          cy={c.y}
          r={outlineSW * 1.5}
          fill={COLOR_INDIGO}
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: 'none' }}
        />
      ))}

      {/* ── 8 Poignées de resize ─────────────────────────────────────────────── */}
      {ALL_HANDLE_IDS.map(handle => (
        <Handle
          key={handle}
          handle={handle}
          pos={handlePositions[handle]}
          scale={scale}
          onPointerDown={onHandlePointerDown}
        />
      ))}
    </g>
  );
};

export default SelectionOverlay;

// ─────────────────────────────────────────────────────────────────────────────
// Guide d'intégration dans Plan2DCanvas.tsx
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. Ajouter usePlan2DEditor dans Plan2DCanvas :
//
//   const svgRef = useRef<SVGSVGElement>(null);
//   const editorHandlers = usePlan2DEditor({ svgRef, tool, gridSnapM: 0.5 });
//
// 2. Calculer pixelScale depuis le viewBox courant :
//
//   const [pixelScale, setPixelScale] = useState(10);
//   useEffect(() => {
//     if (!svgRef.current) return;
//     const update = () => {
//       const svgEl  = svgRef.current!;
//       const domW   = svgEl.clientWidth;
//       const vb     = svgEl.viewBox.baseVal;
//       if (vb.width > 0) setPixelScale(domW / vb.width);
//     };
//     update();
//     const ro = new ResizeObserver(update);
//     ro.observe(svgRef.current);
//     return () => ro.disconnect();
//   }, [/* zoom dépendances si viewBox change au zoom */]);
//
// 3. Attacher les handlers sur le SVG racine :
//
//   <svg ref={svgRef} onPointerDown={editorHandlers.onCanvasPointerDown}>
//     {/* bâtiments */}
//     {buildings.map(b => (
//       <g key={b.id}>
//         <rect
//           ...
//           onPointerDown={e => editorHandlers.onBuildingPointerDown(e, b.id)}
//         />
//         {selectedIds.includes(b.id) && (
//           <SelectionOverlay
//             rect={b.rect}
//             pixelScale={pixelScale}
//             onBodyPointerDown={e => editorHandlers.onBuildingPointerDown(e, b.id)}
//             onHandlePointerDown={(e, handle) =>
//               editorHandlers.onHandlePointerDown(e, b.id, handle)
//             }
//           />
//         )}
//       </g>
//     ))}
//   </svg>
//
// ─────────────────────────────────────────────────────────────────────────────