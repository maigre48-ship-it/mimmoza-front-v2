// ─── SelectionOverlay.tsx ─────────────────────────────────────────────────────
// Bounding box sélection + handles resize
// Rendu en espace monde (enfant du <g transform> du canvas)

import React from 'react';
import { useEditor2DStore } from './editor2d.store';
import { rectCorners, dist } from './editor2d.geometry';
import type { Point2D, OrientedRect, HandleId } from './editor2d.types';

// ── Handle ────────────────────────────────────────────────────────────────────

const HANDLE_PX = 7;   // taille handle en pixels écran
const CURSOR_MAP: Record<string, string> = {
  'resize-nw': 'nwse-resize', 'resize-se': 'nwse-resize',
  'resize-ne': 'nesw-resize', 'resize-sw': 'nesw-resize',
  'resize-n':  'ns-resize',   'resize-s':  'ns-resize',
  'resize-e':  'ew-resize',   'resize-w':  'ew-resize',
};

interface HandleProps {
  pos:    Point2D;
  id:     HandleId;
  zoom:   number;
  color:  string;
}

function Handle({ pos, id, zoom, color }: HandleProps) {
  const r = HANDLE_PX / zoom;
  return (
    <rect
      x={pos.x - r}
      y={pos.y - r}
      width={r * 2}
      height={r * 2}
      rx={r * 0.3}
      fill="white"
      stroke={color}
      strokeWidth={1.5 / zoom}
      style={{ cursor: CURSOR_MAP[id] ?? 'default' }}
      // pointerEvents gérés au niveau SVG global
    />
  );
}

// ── Overlay ───────────────────────────────────────────────────────────────────

interface SelectionOverlayProps {
  zoom: number;
}

export function SelectionOverlay({ zoom }: SelectionOverlayProps) {
  const { buildings, parkings, selectedIds } = useEditor2DStore();

  return (
    <>
      {selectedIds.map(id => {
        const entity =
          buildings.find(b => b.id === id) ??
          parkings.find(p => p.id === id);
        if (!entity) return null;

        const rect   = entity.rect;
        const [nw, ne, se, sw] = rectCorners(rect);
        const isParking = entity.kind === 'parking';
        const color     = isParking ? '#2563eb' : '#4f46e5';

        const mid = (a: Point2D, b: Point2D): Point2D =>
          ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

        const handles: { id: HandleId; pos: Point2D }[] = [
          { id: 'resize-nw', pos: nw },
          { id: 'resize-n',  pos: mid(nw, ne) },
          { id: 'resize-ne', pos: ne },
          { id: 'resize-e',  pos: mid(ne, se) },
          { id: 'resize-se', pos: se },
          { id: 'resize-s',  pos: mid(se, sw) },
          { id: 'resize-sw', pos: sw },
          { id: 'resize-w',  pos: mid(sw, nw) },
        ];

        const pts = [nw, ne, se, sw].map(p => `${p.x},${p.y}`).join(' ');

        return (
          <g key={id} pointerEvents="none">
            {/* Contour sélection */}
            <polygon
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth={1.5 / zoom}
              strokeDasharray={`${4 / zoom},${2 / zoom}`}
              opacity={0.9}
            />
            {/* Handles (pointer events laissés au SVG global) */}
            {handles.map(h => (
              <Handle
                key={h.id}
                pos={h.pos}
                id={h.id}
                zoom={zoom}
                color={color}
              />
            ))}
          </g>
        );
      })}
    </>
  );
}