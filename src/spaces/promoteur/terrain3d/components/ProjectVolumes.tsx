import React, { useMemo } from "react";
import type { FeatureCollection, Feature, Polygon, Position } from "geojson";

type Props = {
  buildings?: FeatureCollection<Polygon>;
  parkings?: FeatureCollection<Polygon>;
  yawDeg?: number; // rotation interactive (°)
};

type IsoPoint = { sx: number; sy: number };

function ringFromFeature(f: Feature<Polygon>): Position[] | null {
  return f.geometry?.coordinates?.[0] ?? null;
}

function rotate2D(x: number, y: number, yawRad: number) {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  return { x: x * c - y * s, y: x * s + y * c };
}

function projectIso(x: number, y: number, z: number) {
  // mêmes coefficients que TerrainMesh (à garder cohérents)
  const a = 0.9;
  const b = 0.45;
  return { sx: (x - y) * a, sy: (x + y) * b - z };
}

function toPath(arr: IsoPoint[]) {
  return "M " + arr.map((p) => `${p.sx.toFixed(2)} ${p.sy.toFixed(2)}`).join(" L ") + " Z";
}

export const ProjectVolumes: React.FC<Props> = ({ buildings, parkings, yawDeg = 0 }) => {
  const view = useMemo(() => {
    const yaw = (yawDeg * Math.PI) / 180;

    const allFeatures: Array<{ kind: "building" | "parking"; f: Feature<Polygon> }> = [];
    for (const f of buildings?.features ?? []) allFeatures.push({ kind: "building", f });
    for (const f of parkings?.features ?? []) allFeatures.push({ kind: "parking", f });

    if (allFeatures.length === 0) return { items: [] as any[] };

    // bbox global des volumes pour normaliser et scaler
    const xs: number[] = [];
    const ys: number[] = [];

    for (const it of allFeatures) {
      const ring = ringFromFeature(it.f);
      if (!ring) continue;
      for (const p of ring) {
        xs.push(p[0]);
        ys.push(p[1]);
      }
    }

    if (xs.length === 0 || ys.length === 0) return { items: [] as any[] };

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const spanX = Math.max(1e-9, maxX - minX);
    const spanY = Math.max(1e-9, maxY - minY);
    const scale = 260 / Math.max(spanX, spanY);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const items = allFeatures
      .map((it) => {
        const ring = ringFromFeature(it.f);
        if (!ring || ring.length < 4) return null;

        // base points rotated + scaled
        const base = ring.map((p) => {
          const x = (p[0] - cx) * scale;
          const y = (p[1] - cy) * scale;
          const r = rotate2D(x, y, yaw);
          return { x: r.x, y: r.y };
        });

        // heights (visuel)
        const h = it.kind === "building" ? 38 : 8;

        const top = base.map((p) => projectIso(p.x, p.y, h));
        const bottom = base.map((p) => projectIso(p.x, p.y, 0));

        const sides = top.map((t, i) => {
          const j = (i + 1) % top.length;
          const t2 = top[j];
          const b1 = bottom[i];
          const b2 = bottom[j];
          return `M ${t.sx} ${t.sy} L ${t2.sx} ${t2.sy} L ${b2.sx} ${b2.sy} L ${b1.sx} ${b1.sy} Z`;
        });

        return {
          kind: it.kind,
          topPath: toPath(top),
          bottomPath: toPath(bottom),
          sides,
        };
      })
      .filter(Boolean) as Array<{
      kind: "building" | "parking";
      topPath: string;
      bottomPath: string;
      sides: string[];
    }>;

    return { items };
  }, [buildings, parkings, yawDeg]);

  if (view.items.length === 0) {
    return <div style={{ padding: 12, opacity: 0.7 }}>Aucun volume défini</div>;
  }

  return (
    <svg width="100%" height="320" viewBox="-220 -220 440 520">
      {view.items.map((it, idx) => (
        <g key={idx}>
          {/* bottom */}
          <path
            d={it.bottomPath}
            fill={it.kind === "building" ? "rgba(59,130,246,0.10)" : "rgba(168,85,247,0.10)"}
            stroke={it.kind === "building" ? "rgba(59,130,246,0.25)" : "rgba(168,85,247,0.25)"}
            strokeWidth="1.5"
          />
          {/* sides */}
          {it.sides.map((d, j) => (
            <path
              key={j}
              d={d}
              fill={it.kind === "building" ? "rgba(59,130,246,0.16)" : "rgba(168,85,247,0.14)"}
              stroke="rgba(148,163,184,0.20)"
              strokeWidth="1"
            />
          ))}
          {/* top */}
          <path
            d={it.topPath}
            fill={it.kind === "building" ? "rgba(59,130,246,0.22)" : "rgba(168,85,247,0.20)"}
            stroke={it.kind === "building" ? "rgba(59,130,246,0.80)" : "rgba(168,85,247,0.75)"}
            strokeWidth="2.5"
          />
        </g>
      ))}
    </svg>
  );
};
