import React, { useMemo } from "react";
import type { Feature, Polygon, MultiPolygon, Position } from "geojson";

type Props = {
  parcel?: Feature<Polygon | MultiPolygon>;
  height?: number; // hauteur d'extrusion en "unités visuelles"
};

function getOuterRingCoords(parcel?: Feature<Polygon | MultiPolygon>): Position[] | null {
  if (!parcel?.geometry) return null;
  const g = parcel.geometry;
  if (g.type === "Polygon") return g.coordinates?.[0] ?? null;
  if (g.type === "MultiPolygon") return g.coordinates?.[0]?.[0] ?? null;
  return null;
}

export const TerrainMesh: React.FC<Props> = ({ parcel, height = 25 }) => {
  const ring = useMemo(() => getOuterRingCoords(parcel), [parcel]);

  const view = useMemo(() => {
    if (!ring || ring.length < 4) return null;

    // Normalize coordinates to local space (x,y)
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // Centered coordinates
    const pts = ring.map((p) => ({
      x: (p[0] - (minX + maxX) / 2),
      y: (p[1] - (minY + maxY) / 2),
    }));

    // Scale to fit
    const spanX = Math.max(1e-9, maxX - minX);
    const spanY = Math.max(1e-9, maxY - minY);
    const scale = 260 / Math.max(spanX, spanY);

    // Isometric projection
    // sx = (x - y) * a
    // sy = (x + y) * b - z
    const a = 0.9;
    const b = 0.45;

    const top = pts.map((p) => {
      const x = p.x * scale;
      const y = p.y * scale;
      return {
        sx: (x - y) * a,
        sy: (x + y) * b,
      };
    });

    const bottom = top.map((p) => ({ sx: p.sx, sy: p.sy + height }));

    // Build SVG paths
    const toPath = (arr: { sx: number; sy: number }[]) =>
      "M " + arr.map((p) => `${p.sx.toFixed(2)} ${p.sy.toFixed(2)}`).join(" L ") + " Z";

    return {
      topPath: toPath(top),
      bottomPath: toPath(bottom),
      // side faces between top[i] and bottom[i]
      sides: top.map((t, i) => {
        const j = (i + 1) % top.length;
        const b1 = bottom[i];
        const b2 = bottom[j];
        const t2 = top[j];
        const d = `M ${t.sx} ${t.sy} L ${t2.sx} ${t2.sy} L ${b2.sx} ${b2.sy} L ${b1.sx} ${b1.sy} Z`;
        return d;
      }),
    };
  }, [ring, height]);

  if (!parcel) {
    return (
      <div style={{ padding: 12, opacity: 0.7 }}>
        Aucune parcelle (store vide).
      </div>
    );
  }

  if (!view) {
    return (
      <div style={{ padding: 12, opacity: 0.7 }}>
        Parcelle chargée, mais géométrie non exploitable.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
      <svg width="100%" height="320" viewBox="-220 -220 440 520">
        {/* bottom face */}
        <path d={view.bottomPath} fill="rgba(59,130,246,0.10)" stroke="rgba(59,130,246,0.35)" strokeWidth="2" />

        {/* sides */}
        {view.sides.map((d, idx) => (
          <path key={idx} d={d} fill="rgba(15,23,42,0.18)" stroke="rgba(148,163,184,0.25)" strokeWidth="1" />
        ))}

        {/* top face */}
        <path d={view.topPath} fill="rgba(34,197,94,0.18)" stroke="rgba(34,197,94,0.7)" strokeWidth="3" />

        {/* label */}
        <text x="-210" y="240" fontSize="12" fill="rgba(148,163,184,0.9)">
          Parcelle (extrusion simple)
        </text>
      </svg>
    </div>
  );
};
