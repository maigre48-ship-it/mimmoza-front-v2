import React from 'react';
import { useEditor2DStore } from './editor2d.store';
import {
  rectCorners,
  midpoint,
  angleDeg,
  pointToSegmentDist,
  closestPointOnSegment,
} from './editor2d.geometry';
import type { Point2D, Building2D, Parking2D } from './editor2d.types';

interface DimensionOverlayProps {
  parcellePolygon: Point2D[];
  buildings: Building2D[];
  parkings: Parking2D[];
  selectedIds: string[];
  zoom: number;
}

type DimFamily = 'building' | 'parking' | 'setback' | 'interBuilding';

interface DimensionLine {
  id: string;
  from: Point2D;
  to: Point2D;
  label: string;
  family: DimFamily;
  perpOffsetPx?: number;
}

const COLORS: Record<DimFamily, string> = {
  building: '#4f46e5',
  parking: '#2563eb',
  setback: '#d97706',
  interBuilding: '#059669',
};

function formatMeters(v: number) {
  return `${v.toFixed(1)} m`;
}

function edgeLinesForRect(
  id: string,
  rect: Building2D['rect'] | Parking2D['rect'],
  family: DimFamily,
): DimensionLine[] {
  const [nw, ne, se, sw] = rectCorners(rect);

  return [
    {
      id: `${id}-width`,
      from: nw,
      to: ne,
      label: formatMeters(rect.width),
      family,
      perpOffsetPx: 18,
    },
    {
      id: `${id}-depth`,
      from: ne,
      to: se,
      label: formatMeters(rect.depth),
      family,
      perpOffsetPx: 18,
    },
  ];
}

function nearestSetbackLines(
  id: string,
  rect: Building2D['rect'] | Parking2D['rect'],
  poly: Point2D[],
): DimensionLine[] {
  if (poly.length < 2) return [];

  const corners = rectCorners(rect);
  const mids = [
    midpoint(corners[0], corners[1]),
    midpoint(corners[1], corners[2]),
    midpoint(corners[2], corners[3]),
    midpoint(corners[3], corners[0]),
  ];

  const lines: DimensionLine[] = [];

  mids.forEach((m, idx) => {
    let bestDist = Infinity;
    let bestPoint: Point2D | null = null;

    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const d = pointToSegmentDist(m, a, b);
      if (d < bestDist) {
        bestDist = d;
        bestPoint = closestPointOnSegment(m, a, b);
      }
    }

    if (bestPoint && Number.isFinite(bestDist)) {
      lines.push({
        id: `${id}-setback-${idx}`,
        from: m,
        to: bestPoint,
        label: formatMeters(bestDist),
        family: 'setback',
        perpOffsetPx: 14,
      });
    }
  });

  return lines;
}

function interBuildingLine(a: Building2D, b: Building2D): DimensionLine | null {
  const ca = a.rect.center;
  const cb = b.rect.center;
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const d = Math.hypot(dx, dy);
  if (!Number.isFinite(d) || d <= 0.01) return null;

  return {
    id: `inter-${a.id}-${b.id}`,
    from: ca,
    to: cb,
    label: formatMeters(d),
    family: 'interBuilding',
    perpOffsetPx: 16,
  };
}

function DimLine({ line, zoom }: { line: DimensionLine; zoom: number }) {
  const { from, to, label, family, perpOffsetPx = 16 } = line;

  const color = COLORS[family];
  const angle = angleDeg(from, to);
  const mid = midpoint(from, to);

  const sw = (px: number) => px / zoom;

  const strokeW = sw(1.6);
  const tickLen = sw(7);
  const fontSize = sw(12);
  const halo = sw(3.2);
  const dash =
    family === 'setback' || family === 'interBuilding'
      ? `${sw(5)},${sw(3)}`
      : undefined;

  const perpRad = (angle + 90) * (Math.PI / 180);
  const off = sw(perpOffsetPx);

  const labelPos: Point2D = {
    x: mid.x + Math.cos(perpRad) * off,
    y: mid.y + Math.sin(perpRad) * off,
  };

  const readableAngle = angle > 90 || angle < -90 ? angle + 180 : angle;

  return (
    <g opacity={0.98} pointerEvents="none">
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={color}
        strokeWidth={strokeW}
        strokeDasharray={dash}
      />

      {[from, to].map((pt, i) => (
        <line
          key={i}
          x1={pt.x - Math.cos(perpRad) * tickLen}
          y1={pt.y - Math.sin(perpRad) * tickLen}
          x2={pt.x + Math.cos(perpRad) * tickLen}
          y2={pt.y + Math.sin(perpRad) * tickLen}
          stroke={color}
          strokeWidth={strokeW}
        />
      ))}

      <text
        x={labelPos.x}
        y={labelPos.y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={fontSize}
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="700"
        fill={color}
        transform={`rotate(${readableAngle},${labelPos.x},${labelPos.y})`}
        paintOrder="stroke"
        stroke="white"
        strokeWidth={halo}
        strokeLinejoin="round"
      >
        {label}
      </text>
    </g>
  );
}

export function DimensionOverlay({
  parcellePolygon,
  buildings,
  parkings,
  selectedIds,
  zoom,
}: DimensionOverlayProps) {
  const { cotesVisibility } = useEditor2DStore();

  const selectedBuildings = buildings.filter((b) => selectedIds.includes(b.id));
  const selectedParkings = parkings.filter((p) => selectedIds.includes(p.id));

  const lines: DimensionLine[] = [];

  for (const b of selectedBuildings) {
    if (cotesVisibility.buildingDims) {
      lines.push(...edgeLinesForRect(b.id, b.rect, 'building'));
    }
    if (cotesVisibility.parcelleSetbacks) {
      lines.push(...nearestSetbackLines(b.id, b.rect, parcellePolygon));
    }
  }

  for (const p of selectedParkings) {
    if (cotesVisibility.parkingDims) {
      lines.push(...edgeLinesForRect(p.id, p.rect, 'parking'));
    }
    if (cotesVisibility.parcelleSetbacks) {
      lines.push(...nearestSetbackLines(p.id, p.rect, parcellePolygon));
    }
  }

  if (cotesVisibility.interBuilding && buildings.length > 1) {
    for (let i = 0; i < buildings.length - 1; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        const line = interBuildingLine(buildings[i], buildings[j]);
        if (line) lines.push(line);
      }
    }
  }

  if (lines.length === 0) return null;

  return (
    <>
      {lines.map((line) => (
        <DimLine key={line.id} line={line} zoom={zoom} />
      ))}
    </>
  );
}