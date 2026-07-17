// MassingEditor3D.tsx — V2.14
// V2.14 : cache mémoire relief (getReliefCache/setReliefCache) — zéro re-fetch au retour sur l'onglet
// V2.13 : showSlopeColors — state + toggle "📐 Pentes" + propagation à MassingRenderer
//         SlopeLegend conditionnée sur showSlopeColors
// V2.12 : onTerrainLoadingChange — délègue le loader terrain au parent (Massing3D)
// V2.11 : propagation showLabels au MassingRenderer
// V2.10 : suppression toolbar, mode select permanent
// V2.9  : fix alignement repère Impla 2D ↔ Massing 3D
// V2.8  : normalisation MultiPolygon → plus grand Polygon
// V2.7  : fix scoping par studyId
// V2.6  : suppression VegetationPanel → TerrassementPanel

import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { useSearchParams } from "react-router-dom";

import { supabase } from "../../../../lib/supabaseClient";
import { getReliefCache, patchModule, setReliefCache } from "../../shared/promoteurSnapshot.store";
import { usePromoteurProgrammeStore } from "../../store/promoteurProgramme.store";
import type { Implantation2DMeta } from "../../store/promoteurProject.store";
import { writeMassingMetrics } from "../massingBilanBridge";
import { SLOPE_LEGEND } from "../massingConstants";
import type {
  MassingBuildingModel,
  MassingSceneModel,
  PlacedObject,
} from "../massingScene.types";
import { totalHeightM, totalLevelsCount } from "../massingScene.types";
import { deriveMassingMetrics } from "../massingToBilan";
import { makeNewBuilding, useMassingEditor } from "../useMassingEditor";
import { EDITOR2D_EVENT, read2D } from "../../plan2d/editor2dStorage";
import { BuildingPropertiesPanel } from "./BuildingPropertiesPanel";
import { MassingRenderer } from "./MassingRenderer";
import type { ReliefData } from "./SceneSvg3D";
import { TerrassementPanel, type TerrassementExport } from "./TerrassementPanel";

const ACCENT = "#5247b8";

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON_EQUATOR = 111_320;
const mPerDegLon = (lat: number) => M_PER_DEG_LON_EQUATOR * Math.cos(lat * Math.PI / 180);

// ─── Lecture store 2D depuis localStorage (clé factorisée : editor2dStorage) ──

interface OrientedRect {
  center: { x: number; y: number };
  width: number; depth: number; rotationDeg: number;
}
interface Building2DRaw {
  id: string; kind?: string; rect: OrientedRect;
  label?: string; floorsAboveGround?: number;
  groundFloorHeightM?: number; typicalFloorHeightM?: number;
  programmeBatimentId?: string | null;
}
interface Parking2DRaw {
  id: string;
  rect: OrientedRect;
  slotCount?: number;
  kind?: string;
}

interface Plan2DSnapshot {
  buildings: Building2DRaw[];
  parkings:  Parking2DRaw[];
}


function computeRectCorners(rect: OrientedRect): { x: number; y: number }[] {
  const rad = (rect.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const hw = rect.width / 2, hd = rect.depth / 2;
  const { x: cx, y: cy } = rect.center;
  return [
    { x: cx + (-hw) * cos - (-hd) * sin, y: cy + (-hw) * sin + (-hd) * cos },
    { x: cx + ( hw) * cos - (-hd) * sin, y: cy + ( hw) * sin + (-hd) * cos },
    { x: cx + ( hw) * cos - ( hd) * sin, y: cy + ( hw) * sin + ( hd) * cos },
    { x: cx + (-hw) * cos - ( hd) * sin, y: cy + (-hw) * sin + ( hd) * cos },
  ];
}

function isValidRect(r: OrientedRect): boolean {
  return Number.isFinite(r.center.x) && Number.isFinite(r.center.y)
    && Number.isFinite(r.width)  && r.width  > 0
    && Number.isFinite(r.depth)  && r.depth  > 0;
}

function isWgs84Ring(ring: [number, number][]): boolean {
  return ring.every(([x, y]) =>
    Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90,
  );
}

function rectToRing(rect: OrientedRect): [number, number][] | null {
  try {
    if (!isValidRect(rect)) return null;
    const corners = computeRectCorners(rect);
    const ring = corners.map(c => [c.x, c.y] as [number, number]);
    if (ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return null;
    ring.push(ring[0]);
    return ring;
  } catch { return null; }
}

function approxRingArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}
// Surface d'un ring footprint en m² (WGS84 → m via 111 000 m/deg + cos(lat)).
function ringAreaM2(ring: [number, number][]): number {
  if (!ring || ring.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
  }
  const area = Math.abs(a / 2);
  const geo = Math.abs(ring[0][0]) <= 180 && Math.abs(ring[0][1]) <= 90;
  if (geo) {
    const lat = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * Math.PI / 180;
    return area * 111000 * 111000 * Math.cos(lat);
  }
  return area;
}

function pickLargestPolygonFeature(
  parcel: Feature<Polygon | MultiPolygon>,
): Feature<Polygon> {
  if (parcel.geometry.type === "Polygon") {
    return parcel as Feature<Polygon>;
  }
  const polys = parcel.geometry.coordinates;
  let bestIdx = 0;
  let bestArea = -Infinity;
  polys.forEach((poly, i) => {
    if (!poly?.[0]?.length) return;
    const area = approxRingArea(poly[0] as number[][]);
    if (area > bestArea) { bestArea = area; bestIdx = i; }
  });
  console.log(
    `[Massing3D] MultiPolygon (${polys.length} polygones) — plus grand index ${bestIdx}`,
  );
  return {
    type: "Feature",
    properties: parcel.properties,
    geometry: { type: "Polygon", coordinates: polys[bestIdx] },
  };
}

function getImpla2DOrigin(
  parcel: Feature<Polygon | MultiPolygon> | undefined,
): { lon: number; lat: number } | null {
  if (!parcel) return null;
  try {
    const allRings: number[][][] =
      parcel.geometry.type === "Polygon"
        ? (parcel.geometry.coordinates as number[][][])
        : ((parcel.geometry.coordinates as number[][][][]).flat(1) as number[][][]);
    const exteriorRing = allRings[0] ?? [];
    if (!exteriorRing.length) return null;
    const lon = exteriorRing.reduce((s, c) => s + c[0], 0) / exteriorRing.length;
    const lat = exteriorRing.reduce((s, c) => s + c[1], 0) / exteriorRing.length;
    return { lon, lat };
  } catch { return null; }
}

function convertBuildings2D(
  buildings2D: Building2DRaw[],
  implaOrigin?: { lon: number; lat: number } | null,
): MassingBuildingModel[] {
  const result: MassingBuildingModel[] = [];
  buildings2D.forEach((b, idx) => {
    if (b.kind && b.kind !== "building") return;
    const raw: any = b.rect ?? b;
    const cx   = raw.center?.x ?? raw.cx ?? 0;
    const cy   = raw.center?.y ?? raw.cy ?? 0;
    const w    = raw.width  ?? raw.w  ?? 0;
    const d    = raw.depth  ?? raw.d  ?? raw.height ?? w;
    const rotDeg = raw.rotationDeg ?? raw.rotation ?? 0;
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || w <= 0 || d <= 0) return;
    let ring: [number, number][] | null = null;
    if (implaOrigin) {
      const mPerLon = mPerDegLon(implaOrigin.lat);
      const bldLon  = implaOrigin.lon + cx / mPerLon;
      const bldLat  = implaOrigin.lat - cy / M_PER_DEG_LAT;
      const wDeg    = w / mPerLon;
      const dDeg    = d / M_PER_DEG_LAT;
      if (idx === 0) console.log(`[Massing3D] Bât 0 → lon=${bldLon.toFixed(5)} lat=${bldLat.toFixed(5)}`);
      ring = rectToRing({ center: { x: bldLon, y: bldLat }, width: wDeg, depth: dDeg, rotationDeg: rotDeg });
    } else {
      const dimMeters = w >= 0.5 && w <= 2000;
      const ctrWgs84  = Math.abs(cx) <= 180 && Math.abs(cy) <= 90;
      if (dimMeters && ctrWgs84) {
        const mPerLon = mPerDegLon(cy);
        ring = rectToRing({ center: { x: cx, y: cy }, width: w / mPerLon, depth: d / M_PER_DEG_LAT, rotationDeg: rotDeg });
      } else {
        ring = rectToRing(b.rect);
      }
    }
    if (!ring) return;
    const isGeo = isWgs84Ring(ring);
    const bld = makeNewBuilding({
      name:      b.label ?? `Bâtiment ${idx + 1}`,
      programmeBatimentId: b.programmeBatimentId ?? null,
      footprint: { points: ring, epsg: isGeo ? "4326" : "2154" },
      levels: {
        aboveGroundFloors:   b.floorsAboveGround   ?? 0,
        groundFloorHeightM:  b.groundFloorHeightM  ?? 3.0,
        typicalFloorHeightM: b.typicalFloorHeightM ?? 2.8,
      },
      visible: true,
    });
    result.push(bld);
  });
  return result;
}

function convertParkings2D(
  parkings2D: Parking2DRaw[],
  implaOrigin?: { lon: number; lat: number } | null,
): FeatureCollection<Polygon> | undefined {
  const features: Feature<Polygon>[] = [];
  parkings2D.forEach(p => {
    const raw: any = p.rect ?? p;
    const cx   = raw.center?.x ?? 0;
    const cy   = raw.center?.y ?? 0;
    const w    = raw.width  ?? raw.w  ?? 0;
    const d    = raw.depth  ?? raw.d  ?? w;
    const rotDeg = raw.rotationDeg ?? 0;
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || w <= 0 || d <= 0) return;
    let ring: [number, number][] | null = null;
    if (implaOrigin && w <= 2000) {
      const mPerLon = mPerDegLon(implaOrigin.lat);
      ring = rectToRing({
        center: { x: implaOrigin.lon + cx / mPerLon, y: implaOrigin.lat - cy / M_PER_DEG_LAT },
        width: w / mPerLon, depth: d / M_PER_DEG_LAT, rotationDeg: rotDeg,
      });
    } else {
      ring = rectToRing({ center: { x: cx, y: cy }, width: w, depth: d, rotationDeg: rotDeg });
    }
    if (!ring) return;
    features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: { id: p.id, slotCount: p.slotCount ?? 0 },
    });
  });
  return features.length ? { type: "FeatureCollection", features } : undefined;
}

// ─── Props ────────────────────────────────────────────────────────────────────

// ─── DIFF SCÈNE (Modèle : le 3D illustre, ne positionne pas) ────────────────
// Apparie par programmeBatimentId : met à jour géométrie (footprint) + niveaux
// depuis le 2D, PRÉSERVE l'habillage 3D posé par l'utilisateur (style,
// architecture, renderSpec, id). Position = 2D uniquement (footprint + transform).
function mergeMassingScene(
  current: MassingBuildingModel[],
  incoming: MassingBuildingModel[],
): MassingBuildingModel[] {
  const byKey = new Map<string, MassingBuildingModel>();
  for (const b of current) if (b.programmeBatimentId) byKey.set(b.programmeBatimentId, b);
  return incoming.map((inc) => {
    const ex = inc.programmeBatimentId ? byKey.get(inc.programmeBatimentId) : undefined;
    if (!ex) return inc; // nouveau bâtiment → style par défaut
    return { ...ex, name: inc.name, footprint: inc.footprint, transform: inc.transform, levels: inc.levels };
  });
}

// Signature GÉOMÉTRIE + NIVEAUX (jamais le style) → idempotence : l'habillage
// seul ne relance pas de replaceScene.
function sceneSig(buildings: MassingBuildingModel[]): string {
  return buildings
    .map((b) =>
      [
        b.programmeBatimentId ?? b.id,
        JSON.stringify(b.footprint.points),
        b.levels.aboveGroundFloors,
        b.levels.groundFloorHeightM,
        b.levels.typicalFloorHeightM,
        b.name,
      ].join("|"),
    )
    .join(";");
}

export interface MassingEditor3DProps {
  parcel?:                  Feature<Polygon | MultiPolygon>;
  parkings?:                FeatureCollection<Polygon>;
  reliefData?:              ReliefData | null;
  meta?:                    Implantation2DMeta;
  showLabels?:              boolean;
  height?:                  string | number;
  className?:               string;
  onSceneChange?:           (scene: MassingSceneModel) => void;
  /** Appelé avec true au début du fetch terrain, false à la fin (succès ou erreur). */
  onTerrainLoadingChange?:  (loading: boolean) => void;
}

// ─── Edge Function terrain ────────────────────────────────────────────────────

async function fetchReliefFromEdgeFunction(
  parcel: Feature<Polygon>,
): Promise<{ elevations: number[]; nx: number; ny: number; minZ: number; maxZ: number; bbox: [number, number, number, number] }> {
  const props: any = (parcel as any)?.properties ?? {};
  const body: any = {
    grid_size: 50, padding_meters: 30, parcel_geojson: parcel,
    parcel_id:     props.parcel_id     ?? props.id    ?? props.idu   ?? props.IDU ?? null,
    commune_insee: props.commune_insee ?? props.insee ?? props.code_insee ?? null,
  };
  const { data, error } = await supabase.functions.invoke("terrain-analysis-v1", { body });
  if (error) throw new Error(`Edge Function error: ${error.message}`);
  if (!data?.success) throw new Error(data?.error ?? "réponse invalide");
  const td = data.terrainData;
  const gridZ = td.grid?.z as number[][];
  const n  = td.grid?.n as number ?? 17;
  const rb = td.renderBounds as [number, number, number, number];
  if (!Array.isArray(gridZ) || !gridZ.length) throw new Error("grid.z invalide");
  const elevations: number[] = [];
  for (const row of gridZ) for (const v of row) elevations.push(v);
  return { elevations, nx: n, ny: n, minZ: td.altitudeMin, maxZ: td.altitudeMax, bbox: rb };
}

// ─── Sous-composants UI ──────────────────────────────────────────────────────

const BldListItem: FC<{
  bld: MassingBuildingModel; active: boolean;
  onSelect: () => void; onToggleVisible: (v: boolean) => void;
}> = ({ bld, active, onSelect, onToggleVisible }) => (
  <button onClick={onSelect} style={{
    display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
    borderRadius: 8, cursor: "pointer", width: "100%", textAlign: "left",
    border:     active ? `1.5px solid ${ACCENT}` : "1.5px solid #e2e8f0",
    background: active ? "rgba(82,71,184,0.07)"  : "#f8fafc",
  }}>
    <span style={{ fontSize: 13, opacity: bld.visible !== false ? 1 : 0.35, cursor: "pointer" }}
      onClick={e => { e.stopPropagation(); onToggleVisible(!(bld.visible !== false)); }}>👁</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: active ? ACCENT : "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bld.name}</div>
      <div style={{ fontSize: 10, color: "#94a3b8" }}>{totalHeightM(bld.levels).toFixed(1)} m · R+{bld.levels.aboveGroundFloors}</div>
    </div>
  </button>
);

const SceneStats: FC<{ buildings: MassingBuildingModel[] }> = ({ buildings }) => {
  const sdp = useMemo(() => buildings.reduce((acc, b) => {
    const floors = totalLevelsCount(b.levels);
    const pts = b.footprint.points as [number, number][];
    if (pts.length < 3) return acc;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    }
    area = Math.abs(area / 2);
    if (Math.abs(pts[0][0]) < 180) area *= 111000 * 111000 * Math.cos(pts[0][1] * Math.PI / 180);
    return acc + area * floors;
  }, 0), [buildings]);
  return (
    <div style={{ display: "flex", gap: 12, padding: "8px 12px", borderRadius: 8, background: "rgba(82,71,184,0.04)", fontSize: 10, color: "#64748b" }}>
      <span><strong style={{ color: "#0f172a" }}>{buildings.length}</strong> bât.</span>
      <span><strong style={{ color: "#0f172a" }}>{Math.round(sdp).toLocaleString("fr-FR")}</strong> m² SDP est.</span>
    </div>
  );
};

const SlopeLegend: FC = () => (
  <div style={{
    position: "absolute", bottom: 42, left: 10, zIndex: 10,
    background: "rgba(255,255,255,0.92)", backdropFilter: "blur(8px)",
    borderRadius: 8, padding: "8px 10px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.10)", border: "1px solid #e2e8f0",
  }}>
    <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>Inclinaison du terrain</div>
    {SLOPE_LEGEND.map(({ label, color, desc }) => (
      <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
        <div style={{ width: 16, height: 10, borderRadius: 3, background: color, flexShrink: 0, border: "1px solid rgba(0,0,0,0.10)" }} />
        <span style={{ fontSize: 10, color: "#0f172a", fontWeight: 600, minWidth: 34 }}>{label}</span>
        <span style={{ fontSize: 9, color: "#94a3b8" }}>{desc}</span>
      </div>
    ))}
    <div style={{ fontSize: 9, color: "#b0bac4", marginTop: 4, borderTop: "1px solid #f1f5f9", paddingTop: 4 }}>Pente réelle · échelle 1:1</div>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

export const MassingEditor3D: FC<MassingEditor3DProps> = ({
  parcel,
  parkings:  parkingsProp,
  reliefData: reliefDataProp,
  meta,
  showLabels = false,
  height = "640px", className,
  onSceneChange,
  onTerrainLoadingChange,
}) => {
  const editor = useMassingEditor();
  const {
    scene, selectedBuilding, selectedId, hoveredId, activeTool,
    selectBuilding, hoverBuilding, setTool,
    deleteBuilding, duplicateBuilding,
    updateLevels, updateStyle, updateTransform, updateBuilding,
    replaceScene, addPlacedObject,
  } = editor;

  useEffect(() => { setTool("select"); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const normalizedParcel = useMemo<Feature<Polygon> | undefined>(
    () => (parcel ? pickLargestPolygonFeature(parcel) : undefined),
    [parcel],
  );
  const implaOrigin = useMemo(() => getImpla2DOrigin(parcel), [parcel]);

  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");

  // PATCH — Plan masse 2D lu depuis la clé factorisée PAR ÉTUDE. Re-lu au
  // changement d'étude ET sur EDITOR2D_EVENT (émis APRÈS écriture de la clé 2D
  // par la synchro Programmation→2D) → jamais de lecture avant écriture.
  const [plan2D, setPlan2D] = useState<Plan2DSnapshot>(
    () => (studyId ? read2D(studyId) : { buildings: [], parkings: [] }),
  );

  useEffect(() => {
    if (!studyId) { setPlan2D({ buildings: [], parkings: [] }); return; }
    const reload = () => setPlan2D(read2D(studyId));
    reload();
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { studyId?: string } | undefined;
      if (detail?.studyId && detail.studyId !== studyId) return;
      reload();
    };
    window.addEventListener(EDITOR2D_EVENT, onEvent);
    return () => window.removeEventListener(EDITOR2D_EVENT, onEvent);
  }, [studyId]);

  const massingBldFrom2D = useMemo(
    () => convertBuildings2D(plan2D.buildings, implaOrigin),
    [plan2D.buildings, implaOrigin],
  );
  const parkingsFrom2D = useMemo(
    () => convertParkings2D(plan2D.parkings, implaOrigin),
    [plan2D.parkings, implaOrigin],
  );
  const effectiveParkings: FeatureCollection<Polygon> | undefined =
    (parkingsProp?.features?.length ? parkingsProp : undefined) ??
    (parkingsFrom2D?.features?.length ? parkingsFrom2D : undefined);

  const visibleBuildings = useMemo(
    () => scene.buildings.filter(b => b.visible !== false),
    [scene.buildings],
  );

  // PATCH — DIFF par programmeBatimentId (remplace l'ancien replaceScene(tout)).
  // MAJ géométrie (footprint) + niveaux depuis le 2D ; PRÉSERVE l'habillage 3D
  // (style, architecture, renderSpec, id). Position = 2D uniquement. Idempotent :
  // ne remplace que si la géométrie/les niveaux changent (l'habillage seul ne
  // relance rien — deps = [massingBldFrom2D], qui ne dépend que du plan 2D).
  useEffect(() => {
    const current = scene.buildings;
    const merged = mergeMassingScene(current, massingBldFrom2D);
    if (sceneSig(current) !== sceneSig(merged)) {
      replaceScene({ version: 1, buildings: merged, placedObjects: scene.placedObjects ?? [] });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [massingBldFrom2D]);

  useEffect(() => { onSceneChange?.(scene); }, [scene, onSceneChange]);
  // ── Bridge Massing → métré : enveloppe du store programme + bridge bilan legacy ──
  useEffect(() => {
    if (!studyId) return;
    let parcelAreaM2: number | undefined;
    const ring = normalizedParcel?.geometry.coordinates?.[0] as [number, number][] | undefined;
    if (ring) parcelAreaM2 = ringAreaM2(ring);
    const metrics = deriveMassingMetrics(scene.buildings, { parcelAreaM2 });

    // 1) SOURCE DE VÉRITÉ : enveloppe du store programme.
    const niveaux = scene.buildings.reduce(
      (max, b) => Math.max(max, totalLevelsCount(b.levels)), 0,
    );
    const t = metrics.totaux;
    const store = usePromoteurProgrammeStore.getState();
    store.loadStudy(studyId); // idempotent : hydrate si l'étude change, conserve la mémoire sinon
    store.setEnvelope({
      empriseSolM2:      t.empriseSolM2,
      niveaux,
      sdpGeoM2:          t.sdpM2,
      facadeM2:          t.surfaceFacadeM2,
      facadeNetteM2:     t.surfaceFacadeNetteM2,
      toitureTerrasseM2: t.surfaceToitureTerrasseM2,
      toiturePenteM2:    t.surfaceToiturePenteM2,
      balconsM2:         t.surfaceBalconsM2,
      nbMenuiseries:     t.nbMenuiseries,
      nbBatiments:       t.nbBatiments,
      source:            "massing",
      updatedAt:         new Date().toISOString(),
    });

    // 2) Bridge legacy → Bilan (conservé tant que le Bilan lit encore le bridge).
    writeMassingMetrics(studyId, metrics);
  }, [scene.buildings, normalizedParcel, studyId]);

  // ── Relief ────────────────────────────────────────────────────────────────

  const [fetchedRelief, setFetchedRelief] = useState<ReliefData | null>(null);
  const [reliefStatus,  setReliefStatus]  = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [reliefError,   setReliefError]   = useState<string | null>(null);
  const [reliefMeta,    setReliefMeta]    = useState<{ deltaZ?: number } | null>(null);
  const reliefData: ReliefData | null = reliefDataProp ?? fetchedRelief;

  // Propagation du statut loading vers le parent (overlay centré dans Massing3D)
  useEffect(() => {
    onTerrainLoadingChange?.(reliefStatus === "loading");
  }, [reliefStatus, onTerrainLoadingChange]);

  useEffect(() => {
    if (reliefDataProp) { setReliefStatus("idle"); return; }
    if (!normalizedParcel) return;

    // ── Hit cache — terrain déjà chargé dans cette session SPA ──────────────
    const cached = getReliefCache(studyId);
    if (cached) {
      console.debug("[MassingEditor3D] Relief depuis cache mémoire — studyId:", studyId);
      setFetchedRelief(cached);
      setReliefStatus("ready");
      setReliefMeta({ deltaZ: cached.maxZ - cached.minZ });
      return;
    }

    // ── Miss cache — fetch Edge Function ─────────────────────────────────────
    let cancel = false;
    setReliefStatus("loading");
    setReliefError(null);
    setFetchedRelief(null);

    (async () => {
      try {
        const result = await fetchReliefFromEdgeFunction(normalizedParcel);
        if (cancel) return;
        const dz = result.maxZ - result.minZ;
        const dx = (result.bbox[2] - result.bbox[0]) / Math.max(result.nx - 1, 1);
        const dy = (result.bbox[3] - result.bbox[1]) / Math.max(result.ny - 1, 1);
        const relief: ReliefData = {
          elevations: result.elevations,
          nx: result.nx, ny: result.ny,
          dx, dy,
          minZ: result.minZ, maxZ: result.maxZ,
          bbox: result.bbox,
        };
        setReliefCache(studyId, relief); // persiste pour les prochains montages
        setFetchedRelief(relief);
        setReliefStatus("ready");
        setReliefMeta({ deltaZ: dz });
      } catch (e: any) {
        if (!cancel) {
          setReliefStatus("error");
          setReliefError(e?.message ?? String(e));
        }
      }
    })();

    return () => { cancel = true; };
  // studyId ajouté aux deps : si l'étude change, le cache est re-vérifié
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedParcel, reliefDataProp, studyId]);

  const handleTerrassementMetrics = useCallback((data: TerrassementExport) => {
    try {
      patchModule("terrassement" as any, {
        ok: true,
        summary: `Terrassement estimé : ${data.totalCout.toLocaleString("fr-FR")} € HT`,
        data,
      } as any);
    } catch (e) { console.warn("[MassingEditor3D] terrassement patchModule:", e); }
  }, []);

  // ── States affichage ──────────────────────────────────────────────────────

  const [showWireframe,   setShowWireframe]   = useState(false);
  const [showTerrain,     setShowTerrain]     = useState(true);
  const [showSlopeColors, setShowSlopeColors] = useState(true);

  const hasTerrain = !!(reliefData?.elevations?.length);

  const showReliefBadge = reliefStatus === "ready" || reliefStatus === "error";
  const bc = reliefStatus === "ready"
    ? { bg: "rgba(22,163,74,0.12)",  border: "rgba(22,163,74,0.4)", text: "#15803d" }
    : { bg: "rgba(239,68,68,0.10)",  border: "rgba(239,68,68,0.3)", text: "#dc2626" };

  return (
    <div className={className} style={{
      display: "flex", gap: 0,
      height: typeof height === "number" ? `${height}px` : height,
      background: "#f8fafc", borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0",
    }}>
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>

        {/* Badge relief — ready / error uniquement */}
        {showReliefBadge && (
          <div style={{
            position: "absolute", top: 10, right: 10, zIndex: 10,
            padding: "4px 10px", borderRadius: 20, fontSize: 10, fontWeight: 600,
            background: bc.bg, border: `1px solid ${bc.border}`, color: bc.text,
            backdropFilter: "blur(8px)", boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }} title={reliefError ?? undefined}>
            {reliefStatus === "ready" && `🏔 Relief OK · ΔZ ${reliefMeta?.deltaZ?.toFixed(1)}m`}
            {reliefStatus === "error" && `⚠️ ${reliefError?.slice(0, 70)}`}
          </div>
        )}

        {/* Toggles bas-gauche */}
        <div style={{ position: "absolute", bottom: 10, left: 10, zIndex: 10, display: "flex", gap: 6, fontSize: 10 }}>

          <label style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, background: "rgba(255,255,255,0.88)", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
            <input type="checkbox" checked={showWireframe} onChange={e => setShowWireframe(e.target.checked)} style={{ accentColor: ACCENT }} />
            Fil de fer
          </label>

          {hasTerrain && (
            <label style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6,
              background: showTerrain ? "rgba(82,71,184,0.10)" : "rgba(255,255,255,0.88)",
              border: showTerrain ? `1px solid rgba(82,71,184,0.3)` : "1px solid transparent",
              cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              color: showTerrain ? ACCENT : "#475569", fontWeight: showTerrain ? 600 : 400,
            }}>
              <input type="checkbox" checked={showTerrain} onChange={e => setShowTerrain(e.target.checked)} style={{ accentColor: ACCENT }} />
              🏔 Terrain
            </label>
          )}

          {hasTerrain && showTerrain && (
            <label style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6,
              background: showSlopeColors ? "rgba(234,88,12,0.10)" : "rgba(255,255,255,0.88)",
              border: showSlopeColors ? "1px solid rgba(234,88,12,0.3)" : "1px solid transparent",
              cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              color: showSlopeColors ? "#c2410c" : "#475569", fontWeight: showSlopeColors ? 600 : 400,
            }}>
              <input type="checkbox" checked={showSlopeColors} onChange={e => setShowSlopeColors(e.target.checked)} style={{ accentColor: "#ea580c" }} />
              📐 Pentes
            </label>
          )}
        </div>

        {/* Légende pentes — visible seulement si les deux toggles sont actifs */}
        {hasTerrain && showTerrain && showSlopeColors && <SlopeLegend />}

        <MassingRenderer
          buildings={visibleBuildings}
          parcel={normalizedParcel}
          parkings={effectiveParkings}
          placedObjects={scene.placedObjects}
          reliefData={reliefData}
          selectedId={selectedId}
          hoverId={hoveredId}
          activeTool={activeTool}
          showTerrain={showTerrain}
          showSlopeColors={showSlopeColors}
          showWireframe={showWireframe}
          showLabels={showLabels}
          callbacks={{
            onSelectBuilding:    id  => selectBuilding(id),
            onHoverBuilding:     id  => hoverBuilding(id),
            onTranslateBuilding: ()  => {},
            onPlaceObject: (obj: Omit<PlacedObject, "id">) => { addPlacedObject(obj); setTool("select"); },
          }}
        />
      </div>

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <div style={{ width: 290, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, padding: 10, overflowY: "auto", background: "#f8fafc", borderLeft: "1px solid #e2e8f0" }}>
        <SceneStats buildings={scene.buildings} />

        {scene.buildings.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, background: "rgba(82,71,184,0.06)", border: "1px solid rgba(82,71,184,0.2)", fontSize: 10, color: ACCENT }}>
            {/* PATCH — synchro auto (plus de bouton « re-sync » : la scène suit le programme). */}
            <span style={{ flex: 1 }}><strong>{scene.buildings.length}</strong> bâtiment{scene.buildings.length > 1 ? "s" : ""} — géométrie et niveaux synchronisés depuis la Programmation.</span>
          </div>
        )}

        {scene.buildings.length === 0 && (
          <div style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.3)", borderRadius: 8, padding: "10px 12px", fontSize: 11, color: "#a16207" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Aucun bâtiment</div>
            <div style={{ fontSize: 10, opacity: 0.85, marginBottom: 6 }}>Définissez le programme (nom, niveaux, emprise) dans la Programmation : les bâtiments apparaîtront ici automatiquement.</div>
            <a href={studyId ? `/promoteur/programmation?study=${encodeURIComponent(studyId)}` : "/promoteur/programmation"} style={{ fontSize: 10, fontWeight: 700, color: ACCENT, textDecoration: "underline" }}>
              → Ouvrir la Programmation
            </a>
          </div>
        )}

        {scene.buildings.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#0f172a", padding: "2px 0" }}>Bâtiments ({scene.buildings.length})</div>
            {scene.buildings.map(b => (
              <BldListItem key={b.id} bld={b} active={b.id === selectedId}
                onSelect={() => selectBuilding(b.id)}
                onToggleVisible={v => updateBuilding(b.id, { visible: !v })} />
            ))}
          </div>
        )}

        <div style={{ borderTop: "1px solid #e2e8f0", margin: "2px 0" }} />

        {selectedBuilding ? (
          <BuildingPropertiesPanel
            building={selectedBuilding}
            onUpdateLevels={patch    => updateLevels(selectedId!, patch)}
            onUpdateTransform={patch => updateTransform(selectedId!, patch)}
            onUpdateStyle={patch     => updateStyle(selectedId!, patch)}
            onUpdateName={name       => updateBuilding(selectedId!, { name })}
            onDelete={() => deleteBuilding(selectedId!)}
            onDuplicate={() => duplicateBuilding(selectedId!)}
          />
        ) : (
          <div style={{ background: "white", borderRadius: 12, padding: 20, border: "1px solid #e2e8f0", textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🖱</div>
            <div>Cliquez sur un bâtiment</div>
          </div>
        )}

        <div style={{ borderTop: "1px solid #e2e8f0", margin: "2px 0" }} />

        <TerrassementPanel
          buildings={scene.buildings}
          parcel={normalizedParcel}
          reliefData={reliefData}
          selectedId={selectedId}
          onMetricsChange={handleTerrassementMetrics}
        />

        {hasTerrain && reliefData && (
          <>
            <div style={{ borderTop: "1px solid #e2e8f0", margin: "2px 0" }} />
            <div style={{ background: "white", borderRadius: 10, padding: 12, border: "1px solid #e2e8f0", fontSize: 11 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", marginBottom: 8 }}>🏔 Données terrain</div>
              {([
                ["Altitude min", `${reliefData.minZ.toFixed(1)} m`],
                ["Altitude max", `${reliefData.maxZ.toFixed(1)} m`],
                ["Dénivelé",     `${(reliefData.maxZ - reliefData.minZ).toFixed(1)} m`],
                ["Résolution",   `${reliefData.nx}×${reliefData.ny}`],
              ] as [string, string][]).map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ color: "#64748b" }}>{l}</span>
                  <span style={{ fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div style={{ height: 8, flexShrink: 0 }} />
      </div>
    </div>
  );
};

export default MassingEditor3D;