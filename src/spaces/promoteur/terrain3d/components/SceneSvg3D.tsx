import React, { useMemo, useRef, useState } from "react";
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from "geojson";

/**
 * Données de relief pour l'affichage 3D
 */
export interface ReliefData {
  elevations: number[];
  nx: number;
  ny: number;
  dx: number;
  dy: number;
  minZ: number;
  maxZ: number;
  bbox: [number, number, number, number];
  /** Niveau de la plateforme de terrassement (m NGF) */
  platformLevel?: number;
}

type Props = {
  parcel?: Feature<Polygon | MultiPolygon>;
  buildings?: FeatureCollection<Polygon>;
  parkings?: FeatureCollection<Polygon>;
  showTerrain: boolean;
  showBuildings: boolean;
  showParkings: boolean;
  showWireframe?: boolean;
  reliefData?: ReliefData | null;
};

type V3 = { x: number; y: number; z: number };
type V2 = { x: number; y: number };

function ringFromParcel(parcel?: Feature<Polygon | MultiPolygon>): Position[] | null {
  const g = parcel?.geometry;
  if (!g) return null;
  if (g.type === "Polygon") return g.coordinates?.[0] ?? null;
  if (g.type === "MultiPolygon") return g.coordinates?.[0]?.[0] ?? null;
  return null;
}

function ringFromPolyFeature(f: any): Position[] | null {
  const geom = f?.geometry;
  if (!geom || geom.type !== "Polygon") return null;
  return geom.coordinates?.[0] ?? null;
}

function bboxOfRings(rings: Position[][]): [number, number, number, number] | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of rings) {
    for (const p of r) {
      xs.push(p[0]);
      ys.push(p[1]);
    }
  }
  if (xs.length === 0) return null;
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function add(a: V3, b: V3): V3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function cross(a: V3, b: V3): V3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function len(a: V3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}
function normalize(a: V3): V3 {
  const l = len(a);
  if (l <= 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

function cameraPositionFromSpherical(yaw: number, pitch: number, radius: number): V3 {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return { x: radius * cp * cy, y: radius * cp * sy, z: radius * sp };
}

function pathFromPoints(pts: V2[]) {
  return "M " + pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" L ") + " Z";
}

function elevationToColor(z: number, minZ: number, maxZ: number): string {
  const range = maxZ - minZ;
  if (range < 0.1) return "rgba(34,197,94,0.85)";
  const t = clamp((z - minZ) / range, 0, 1);
  
  if (t < 0.25) {
    const s = t / 0.25;
    return `rgba(${Math.round(34 + s * 30)},${Math.round(120 + s * 77)},${Math.round(60 - s * 20)},0.9)`;
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    return `rgba(${Math.round(64 + s * 100)},${Math.round(197 - s * 20)},${Math.round(40 - s * 20)},0.9)`;
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    return `rgba(${Math.round(164 + s * 60)},${Math.round(177 - s * 80)},${Math.round(20 + s * 20)},0.9)`;
  } else {
    const s = (t - 0.75) / 0.25;
    return `rgba(${Math.round(224 - s * 80)},${Math.round(97 - s * 40)},${Math.round(40 + s * 30)},0.9)`;
  }
}

export const SceneSvg3D: React.FC<Props> = ({
  parcel,
  buildings,
  parkings,
  showTerrain,
  showBuildings,
  showParkings,
  showWireframe,
  reliefData,
}) => {
  const [yaw, setYaw] = useState<number>(0.9);
  const [pitch, setPitch] = useState<number>(0.55);
  const [radius, setRadius] = useState<number>(900);

  const drag = useRef<{ down: boolean; x: number; y: number; yaw: number; pitch: number }>({
    down: false, x: 0, y: 0, yaw: 0, pitch: 0,
  });

  const onMouseDown = (e: React.MouseEvent) => {
    drag.current = { down: true, x: e.clientX, y: e.clientY, yaw, pitch };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current.down) return;
    setYaw(drag.current.yaw + (e.clientX - drag.current.x) * 0.006);
    setPitch(clamp(drag.current.pitch + (e.clientY - drag.current.y) * 0.006, 0.10, 1.35));
  };
  const onMouseUp = () => (drag.current.down = false);
  const onMouseLeave = () => (drag.current.down = false);
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setRadius(clamp(radius + (e.deltaY > 0 ? 70 : -70), 320, 2600));
  };

  const scene = useMemo(() => {
    const parcelRing = ringFromParcel(parcel);
    const buildingRings = (buildings?.features ?? []).map(ringFromPolyFeature).filter(Boolean) as Position[][];
    const parkingRings = (parkings?.features ?? []).map(ringFromPolyFeature).filter(Boolean) as Position[][];

    const allRings: Position[][] = [
      ...(parcelRing ? [parcelRing] : []),
      ...(showBuildings ? buildingRings : []),
      ...(showParkings ? parkingRings : []),
    ];

    const bb = bboxOfRings(allRings.length ? allRings : parcelRing ? [parcelRing] : []);
    if (!bb) return null;

    const [minX, minY, maxX, maxY] = bb;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const spanX = Math.max(1e-9, maxX - minX);
    const spanY = Math.max(1e-9, maxY - minY);
    const scale = 520 / Math.max(spanX, spanY);

    const toSceneXY = (p: Position) => ({
      x: (p[0] - cx) * scale,
      y: (p[1] - cy) * scale,
    });

    const H_BUILDING = 50;
    const H_PARKING = 6;

    let terrainMesh: { triangles: { v0: V3; v1: V3; v2: V3; avgZ: number }[] } | null = null;
    let terrainMinZ = 0;
    let terrainMaxZ = 0;
    let zScale = 1;
    let platformZScene = 0;

    if (reliefData && reliefData.elevations.length > 0) {
      const { elevations, nx, ny, minZ, maxZ, bbox, platformLevel } = reliefData;
      const [bMinX, bMinY, bMaxX, bMaxY] = bbox;
      
      terrainMinZ = minZ;
      terrainMaxZ = maxZ;
      
      const deltaZ = maxZ - minZ;
      zScale = deltaZ > 0 ? (150 / deltaZ) : 1;
      
      // Niveau de plateforme en coordonnées scène
      if (typeof platformLevel === "number") {
        platformZScene = (platformLevel - minZ) * zScale;
      } else {
        platformZScene = 75;
      }
      
      const reliefCx = (bMinX + bMaxX) / 2;
      const reliefCy = (bMinY + bMaxY) / 2;
      const reliefSpanX = bMaxX - bMinX;
      const reliefSpanY = bMaxY - bMinY;
      const reliefScale = 520 / Math.max(reliefSpanX, reliefSpanY);
      
      const gridPoints: V3[][] = [];
      for (let j = 0; j < ny; j++) {
        const row: V3[] = [];
        for (let i = 0; i < nx; i++) {
          const z = elevations[j * nx + i];
          const px = bMinX + (i / (nx - 1)) * reliefSpanX;
          const py = bMinY + (j / (ny - 1)) * reliefSpanY;
          row.push({
            x: (px - reliefCx) * reliefScale,
            y: (py - reliefCy) * reliefScale,
            z: Number.isFinite(z) ? (z - minZ) * zScale : 0,
          });
        }
        gridPoints.push(row);
      }
      
      const triangles: { v0: V3; v1: V3; v2: V3; avgZ: number }[] = [];
      for (let j = 0; j < ny - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const p00 = gridPoints[j][i];
          const p10 = gridPoints[j][i + 1];
          const p01 = gridPoints[j + 1][i];
          const p11 = gridPoints[j + 1][i + 1];
          triangles.push({ v0: p00, v1: p10, v2: p01, avgZ: (p00.z + p10.z + p01.z) / 3 });
          triangles.push({ v0: p10, v1: p11, v2: p01, avgZ: (p10.z + p11.z + p01.z) / 3 });
        }
      }
      terrainMesh = { triangles };
    }

    // Parcelle
    let parcelExtr: { top3: V3[]; bot3: V3[] } | null = null;
    if (parcelRing) {
      const base2 = parcelRing.map(toSceneXY);
      parcelExtr = {
        top3: base2.map((p) => ({ x: p.x, y: p.y, z: terrainMesh ? 3 : 22 })),
        bot3: base2.map((p) => ({ x: p.x, y: p.y, z: 0 })),
      };
    }

    // Bâtiments - BASE AU NIVEAU DE LA PLATEFORME
    const buildingsExtr = buildingRings.map((ring) => {
      const base2 = ring.map(toSceneXY);
      const baseZ = terrainMesh ? platformZScene : 0;
      return {
        top3: base2.map((p) => ({ x: p.x, y: p.y, z: baseZ + H_BUILDING })),
        bot3: base2.map((p) => ({ x: p.x, y: p.y, z: baseZ })),
      };
    });

    // Parkings - BASE AU NIVEAU DE LA PLATEFORME
    const parkingsExtr = parkingRings.map((ring) => {
      const base2 = ring.map(toSceneXY);
      const baseZ = terrainMesh ? platformZScene : 0;
      return {
        top3: base2.map((p) => ({ x: p.x, y: p.y, z: baseZ + H_PARKING })),
        bot3: base2.map((p) => ({ x: p.x, y: p.y, z: baseZ })),
      };
    });

    const target: V3 = { x: 0, y: 0, z: terrainMesh ? platformZScene : 0 };

    return { parcelExtr, buildingsExtr, parkingsExtr, target, terrainMesh, terrainMinZ, terrainMaxZ, zScale, platformZScene };
  }, [parcel, buildings, parkings, showBuildings, showParkings, reliefData]);

  const cam = useMemo(() => {
    const target = scene?.target ?? { x: 0, y: 0, z: 0 };
    const camPos = add(target, cameraPositionFromSpherical(yaw, pitch, radius));
    const forward = normalize(sub(target, camPos));
    const worldUp: V3 = { x: 0, y: 0, z: 1 };
    let right = normalize(cross(worldUp, forward));
    let up = normalize(cross(forward, right));
    const fov = 65 * (Math.PI / 180);
    const focal = 520 / Math.tan(fov / 2);

    const projectPoint = (p: V3): V2 => {
      const rel = sub(p, camPos);
      const z = Math.max(40, dot(rel, forward));
      const s = focal / z;
      return { x: dot(rel, right) * s, y: -dot(rel, up) * s };
    };
    const distToCamera = (p: V3): number => dot(sub(p, camPos), forward);

    return { projectPoint, distToCamera };
  }, [scene, yaw, pitch, radius]);

  const renderExtrusion = (extr: { top3: V3[]; bot3: V3[] }, kind: "parcel" | "building" | "parking") => {
    const top2 = extr.top3.map(cam.projectPoint);
    const bot2 = extr.bot3.map(cam.projectPoint);
    const topPath = pathFromPoints(top2);
    const botPath = pathFromPoints(bot2);
    const sides = top2.map((t, i) => {
      const j = (i + 1) % top2.length;
      return `M ${t.x} ${t.y} L ${top2[j].x} ${top2[j].y} L ${bot2[j].x} ${bot2[j].y} L ${bot2[i].x} ${bot2[i].y} Z`;
    });

    const styles = {
      parcel: { topFill: "rgba(34,197,94,0.30)", topStroke: "rgba(22,163,74,1)", sideFill: "rgba(34,197,94,0.15)", sideStroke: "rgba(22,163,74,0.4)" },
      building: { topFill: "rgba(59,130,246,0.50)", topStroke: "rgba(37,99,235,1)", sideFill: "rgba(59,130,246,0.35)", sideStroke: "rgba(37,99,235,0.7)" },
      parking: { topFill: "rgba(168,85,247,0.45)", topStroke: "rgba(147,51,234,1)", sideFill: "rgba(168,85,247,0.30)", sideStroke: "rgba(147,51,234,0.6)" },
    }[kind];

    return (
      <g>
        <path d={botPath} fill="rgba(100,116,139,0.20)" stroke="rgba(100,116,139,0.50)" strokeWidth={1.5} />
        {sides.map((d, idx) => (
          <path key={idx} d={d} fill={styles.sideFill} stroke={showWireframe ? styles.sideStroke : "rgba(100,116,139,0.30)"} strokeWidth={showWireframe ? 1.2 : 0.8} />
        ))}
        <path d={topPath} fill={styles.topFill} stroke={styles.topStroke} strokeWidth={2.5} />
      </g>
    );
  };

  const renderTerrainMesh = () => {
    if (!scene?.terrainMesh) return null;
    const { triangles } = scene.terrainMesh;
    const { terrainMinZ, terrainMaxZ, zScale } = scene;
    
    const sorted = [...triangles].map((tri) => {
      const center: V3 = { x: (tri.v0.x + tri.v1.x + tri.v2.x) / 3, y: (tri.v0.y + tri.v1.y + tri.v2.y) / 3, z: (tri.v0.z + tri.v1.z + tri.v2.z) / 3 };
      return { ...tri, dist: cam.distToCamera(center) };
    }).sort((a, b) => b.dist - a.dist);
    
    return (
      <g>
        {sorted.map((tri, idx) => {
          const p0 = cam.projectPoint(tri.v0);
          const p1 = cam.projectPoint(tri.v1);
          const p2 = cam.projectPoint(tri.v2);
          const realZ = terrainMinZ + (tri.avgZ / zScale);
          return (
            <path
              key={idx}
              d={`M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} L ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} Z`}
              fill={elevationToColor(realZ, terrainMinZ, terrainMaxZ)}
              stroke={showWireframe ? "rgba(0,0,0,0.20)" : "rgba(0,0,0,0.05)"}
              strokeWidth={showWireframe ? 0.7 : 0.2}
            />
          );
        })}
      </g>
    );
  };

  return (
    <div
      style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", cursor: drag.current.down ? "grabbing" : "grab", backgroundColor: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseLeave} onWheel={onWheel}
      title="Drag : orbit · Wheel : zoom"
    >
      <svg width="100%" height="420" viewBox="-520 -360 1040 760" style={{ backgroundColor: "#ffffff" }}>
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(203,213,225,0.5)" strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect x="-520" y="-360" width="1040" height="760" fill="url(#grid)" />

        {!scene && <text x="-500" y="-300" fontSize="14" fill="rgba(71,85,105,0.9)">Aucune géométrie à afficher.</text>}

        {showTerrain && scene?.terrainMesh && renderTerrainMesh()}
        {scene?.parcelExtr && showTerrain && !scene.terrainMesh && renderExtrusion(scene.parcelExtr, "parcel")}
        {showBuildings && (scene?.buildingsExtr ?? []).map((e, i) => <g key={`b-${i}`}>{renderExtrusion(e, "building")}</g>)}
        {showParkings && (scene?.parkingsExtr ?? []).map((e, i) => <g key={`p-${i}`}>{renderExtrusion(e, "parking")}</g>)}

        <text x="-500" y="330" fontSize="11" fill="rgba(100,116,139,0.9)">
          yaw {Math.round((yaw * 180) / Math.PI)}° · pitch {Math.round((pitch * 180) / Math.PI)}° · zoom {Math.round(radius)}
          {scene?.terrainMesh && ` · ${scene.terrainMesh.triangles.length} tri`}
          {reliefData?.platformLevel && ` · plateforme ${reliefData.platformLevel.toFixed(1)}m`}
        </text>
      </svg>
    </div>
  );
};