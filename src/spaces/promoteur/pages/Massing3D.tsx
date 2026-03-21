import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Massing3DCanvas } from "../terrain3d/components/Massing3DCanvas";
import { usePromoteurProjectStore } from "../store/promoteurProject.store";

import {
  ensureDepartment,
  elevationLambert93,
  type ElevationPoint,
} from "../../../lib/terrainServiceClient";

// ✅ Snapshot store (existe déjà dans ton projet)
import { patchPromoteurSnapshot, patchModule } from "../shared/promoteurSnapshot.store";

// ─── Design tokens ───────────────────────────────────────────────────────────
const GRAD_PRO = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
const ACCENT_PRO = "#5247b8";

type ReliefDiag = {
  deptCode: string;
  epsg: string | number | null | undefined;
  bbox: number[] | null | undefined;
  pointsCount: number;
  nullCount: number;
  minZ: number | null;
  maxZ: number | null;
  deltaZ: number | null;
  sample: Array<number | null>;
  note?: string;
};

function buildSampleGridFromBbox(
  bbox: number[],
  nx = 9,
  ny = 9
): ElevationPoint[] {
  // bbox attendu: [minX, minY, maxX, maxY] en EPSG:2154 (mètres)
  const [minX, minY, maxX, maxY] = bbox;
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);

  const pts: ElevationPoint[] = [];
  for (let j = 0; j < ny; j++) {
    const y = minY + (h * j) / (ny - 1);
    for (let i = 0; i < nx; i++) {
      const x = minX + (w * i) / (nx - 1);
      pts.push({ x, y });
    }
  }
  return pts;
}

export default function Massing3D(): React.ReactElement {
  const navigate = useNavigate();

  const parcel = usePromoteurProjectStore((s) => s.parcel);
  const buildings = usePromoteurProjectStore((s) => s.buildings);
  const parkings = usePromoteurProjectStore((s) => s.parkings);
  const epsg = usePromoteurProjectStore((s) => s.epsg);
  const bbox = usePromoteurProjectStore((s) => s.bbox);
  const lastUpdatedAt = usePromoteurProjectStore((s) => s.lastUpdatedAt);

  const clearImplantation = usePromoteurProjectStore((s) => s.clearImplantation);

  const [reliefLoading, setReliefLoading] = useState(false);
  const [reliefError, setReliefError] = useState<string | null>(null);
  const [reliefDiag, setReliefDiag] = useState<ReliefDiag | null>(null);

  const stats = useMemo(() => {
    const hasParcel = Boolean(parcel);
    const buildingsCount = buildings?.features?.length ?? 0;
    const parkingsCount = parkings?.features?.length ?? 0;

    return {
      hasParcel,
      buildingsCount,
      parkingsCount,
      hasAny: hasParcel || buildingsCount > 0 || parkingsCount > 0,
      lastUpdatedLabel: lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString() : "—",
      bboxLabel: bbox ? bbox.map((n) => Number(n).toFixed(2)).join(", ") : "—",
    };
  }, [parcel, buildings, parkings, bbox, lastUpdatedAt]);

  const inferredDeptCode = useMemo(() => {
    const props: any = (parcel as any)?.properties ?? {};
    const cand =
      props.deptCode ??
      props.code_dept ??
      props.departement ??
      props.dept ??
      props.department ??
      null;

    const s = cand ? String(cand).trim() : "";
    if (/^\d{2,3}$/.test(s)) return s;
    return "75";
  }, [parcel]);

  // ✅ Persist snapshot (project + massing3d) — non bloquant
  useEffect(() => {
    try {
      const props: any = (parcel as any)?.properties ?? {};
      const latCand =
        props.lat ??
        props.latitude ??
        props.y ??
        props.centroid_lat ??
        props.center_lat ??
        null;
      const lonCand =
        props.lon ??
        props.lng ??
        props.longitude ??
        props.x ??
        props.centroid_lon ??
        props.center_lon ??
        null;

      const lat = Number.isFinite(Number(latCand)) ? Number(latCand) : undefined;
      const lon = Number.isFinite(Number(lonCand)) ? Number(lonCand) : undefined;

      patchPromoteurSnapshot({
        project: {
          parcelId:
            (props.parcel_id ?? props.parcelId ?? props.idu ?? props.IDU ?? props.id) != null
              ? String(props.parcel_id ?? props.parcelId ?? props.idu ?? props.IDU ?? props.id)
              : undefined,
          departement: inferredDeptCode as any,
          lat,
          lon,
        } as any,
      });

      const ok = stats.hasAny;

      const summary = ok
        ? `Parcelle ${stats.hasParcel ? "OK" : "absente"} · Bâtiments ${stats.buildingsCount} · Parkings ${stats.parkingsCount} · EPSG ${String(
            epsg ?? "—"
          )}`
        : "Aucune donnée 3D disponible (dessine dans Implantation 2D).";

      patchModule("massing3d" as any, {
        ok,
        summary,
        data: {
          epsg,
          bbox,
          lastUpdatedAt,
          deptCode: inferredDeptCode,
          counts: {
            hasParcel: stats.hasParcel,
            buildings: stats.buildingsCount,
            parkings: stats.parkingsCount,
          },
          parcel: parcel ?? null,
          buildings: buildings ?? null,
          parkings: parkings ?? null,
          reliefDiag: reliefDiag ?? null,
        },
      } as any);
    } catch (e) {
      console.warn("[snapshot] failed to persist massing3d:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    parcel,
    buildings,
    parkings,
    epsg,
    bbox,
    lastUpdatedAt,
    inferredDeptCode,
    stats.hasAny,
    stats.hasParcel,
    stats.buildingsCount,
    stats.parkingsCount,
    reliefDiag,
  ]);

  async function handleLoadReliefTest() {
    setReliefError(null);
    setReliefDiag(null);

    if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
      setReliefError("BBOX absente ou invalide dans le store.");
      return;
    }

    const epsgStr = String(epsg ?? "");
    const note =
      epsgStr && epsgStr !== "2154"
        ? `Attention: epsg=${epsgStr}. /elevation attend EPSG:2154 (mètres).`
        : undefined;

    const deptCode = inferredDeptCode;

    try {
      setReliefLoading(true);

      await ensureDepartment(deptCode);

      const points = buildSampleGridFromBbox(bbox, 9, 9);

      const r = await elevationLambert93(deptCode, points);

      const elevations = r.elevations ?? [];
      const nullCount = elevations.filter((z) => z === null || !Number.isFinite(z as any)).length;

      const valid = elevations.filter((z) => typeof z === "number" && Number.isFinite(z)) as number[];
      const minZ = valid.length ? Math.min(...valid) : null;
      const maxZ = valid.length ? Math.max(...valid) : null;
      const deltaZ = minZ !== null && maxZ !== null ? maxZ - minZ : null;

      setReliefDiag({
        deptCode,
        epsg,
        bbox,
        pointsCount: elevations.length,
        nullCount,
        minZ,
        maxZ,
        deltaZ,
        sample: elevations.slice(0, 12),
        note,
      });
    } catch (e: any) {
      setReliefError(e?.message ?? String(e));
    } finally {
      setReliefLoading(false);
    }
  }

  // ✅ Wrap clear to also update snapshot
  const handleClearProjectData = () => {
    clearImplantation();
    try {
      patchModule("massing3d" as any, {
        ok: false,
        summary: "Données projet vidées (store promoteur).",
        data: null,
      } as any);
    } catch (e) {
      console.warn("[snapshot] failed to mark massing3d cleared:", e);
    }
  };

  return (
    <div style={{ padding: 16, display: "grid", gap: 12 }}>

      {/* ── Bannière dégradé Promoteur › Conception ── */}
      <div style={{
        background: GRAD_PRO,
        borderRadius: 14,
        padding: "20px 24px",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>
            Promoteur › Conception
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>
            Massing 3D
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
            EPSG : {epsg ?? "—"} · BBOX : {stats.bboxLabel} · MAJ : {stats.lastUpdatedLabel}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => navigate("/promoteur/implantation-2d")}
            style={{
              padding: "9px 18px",
              borderRadius: 10,
              border: "none",
              background: "white",
              color: ACCENT_PRO,
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            ← Implantation 2D
          </button>
          <button
            type="button"
            onClick={handleClearProjectData}
            style={{
              padding: "9px 18px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.35)",
              background: "rgba(255,255,255,0.12)",
              color: "white",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
            title="Supprime parcel/bâtiments/parkings du store (persist)"
          >
            Vider données
          </button>
        </div>
      </div>

      {/* Data status */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          display: "grid",
          gap: 6,
        }}
      >
        <div style={{ fontWeight: 700 }}>État des données</div>
        <div style={{ fontSize: 14, opacity: 0.9 }}>
          Parcelle :{" "}
          <span style={{ fontWeight: 700 }}>{stats.hasParcel ? "OK" : "ABSENTE"}</span>
          {" · "}
          Bâtiments : <span style={{ fontWeight: 700 }}>{stats.buildingsCount}</span>
          {" · "}
          Parkings : <span style={{ fontWeight: 700 }}>{stats.parkingsCount}</span>
        </div>

        {!stats.hasAny && (
          <div style={{ fontSize: 13, color: "#b45309" }}>
            Aucune donnée n'a été trouvée dans le store. Va dans Implantation 2D,
            dessine puis "valide/sauvegarde".
          </div>
        )}
      </div>

      {/* Relief diagnostics (RGE ALTI) */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          display: "grid",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800 }}>Relief (RGE ALTI via terrain-service)</div>
            <div style={{ fontSize: 13, opacity: 0.75 }}>
              Dept utilisé : <b>{inferredDeptCode}</b> · Endpoint: <code>POST /elevation</code> (EPSG:2154)
            </div>
          </div>

          <button
            type="button"
            onClick={handleLoadReliefTest}
            disabled={reliefLoading}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: `1px solid ${ACCENT_PRO}`,
              background: reliefLoading ? "#f3f4f6" : "#ede9fe",
              color: reliefLoading ? "#94a3b8" : ACCENT_PRO,
              cursor: reliefLoading ? "not-allowed" : "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {reliefLoading ? "Chargement..." : "Charger relief (test)"}
          </button>
        </div>

        {reliefError && (
          <div style={{ color: "#b91c1c", fontSize: 13 }}>
            Erreur relief : <b>{reliefError}</b>
          </div>
        )}

        {reliefDiag && (
          <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
            {reliefDiag.note && (
              <div style={{ color: "#b45309" }}>
                {reliefDiag.note}
              </div>
            )}
            <div>
              Points: <b>{reliefDiag.pointsCount}</b> · Nulls: <b>{reliefDiag.nullCount}</b> · MinZ:{" "}
              <b>{reliefDiag.minZ !== null ? reliefDiag.minZ.toFixed(2) : "—"}</b> · MaxZ:{" "}
              <b>{reliefDiag.maxZ !== null ? reliefDiag.maxZ.toFixed(2) : "—"}</b> · ΔZ:{" "}
              <b>{reliefDiag.deltaZ !== null ? reliefDiag.deltaZ.toFixed(2) : "—"}</b>
            </div>
            <div style={{ opacity: 0.8 }}>
              Sample elevations: <code>{JSON.stringify(reliefDiag.sample)}</code>
            </div>
          </div>
        )}
      </div>

      {/* Main canvas */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <Massing3DCanvas
          parcel={parcel ?? undefined}
          buildings={buildings ?? undefined}
          parkings={parkings ?? undefined}
        />
      </div>
    </div>
  );
}