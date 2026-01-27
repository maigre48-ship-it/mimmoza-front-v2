import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Massing3DCanvas } from "../terrain3d/components/Massing3DCanvas";
import { usePromoteurProjectStore } from "../store/promoteurProject.store";

import {
  ensureDepartment,
  elevationLambert93,
  type ElevationPoint,
} from "../../../lib/terrainServiceClient";

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
  ny = 9,
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
    // Best effort: si tu as une propriété dans la parcelle (ex: deptCode, code_dept, departement, etc.)
    // sinon fallback "75" (Paris) pour ne pas bloquer.
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

  async function handleLoadReliefTest() {
    setReliefError(null);
    setReliefDiag(null);

    if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
      setReliefError("BBOX absente ou invalide dans le store.");
      return;
    }

    // On s'attend à du Lambert-93 si tu veux appeler /elevation (EPSG:2154 mètres)
    // Si epsg n'est pas 2154, la requête retournera probablement des null.
    const epsgStr = String(epsg ?? "");
    const note =
      epsgStr && epsgStr !== "2154"
        ? `Attention: epsg=${epsgStr}. /elevation attend EPSG:2154 (mètres).`
        : undefined;

    const deptCode = inferredDeptCode;

    try {
      setReliefLoading(true);

      // 1) Ensure département (cache backend)
      await ensureDepartment(deptCode);

      // 2) Sample grid sur bbox (petit: 9x9 = 81 points)
      const points = buildSampleGridFromBbox(bbox, 9, 9);

      // 3) Elevation
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

  return (
    <div style={{ padding: 16, display: "grid", gap: 12 }}>
      {/* Header */}
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Massing 3D</div>
          <div style={{ opacity: 0.75, fontSize: 13 }}>
            Source de données : store Promoteur (Zustand). EPSG : {epsg} · BBOX :{" "}
            {stats.bboxLabel} · Dernière MAJ : {stats.lastUpdatedLabel}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => navigate("/promoteur/implantation-2d")}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "white",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Revenir à Implantation 2D
          </button>

          <button
            type="button"
            onClick={() => clearImplantation()}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #fecaca",
              background: "#fff1f2",
              cursor: "pointer",
              fontWeight: 700,
              color: "#991b1b",
            }}
            title="Supprime parcel/bâtiments/parkings du store (persist)"
          >
            Vider données projet
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
            Aucune donnée n’a été trouvée dans le store. Va dans Implantation 2D,
            dessine puis “valide/sauvegarde”.
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
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: reliefLoading ? "#f3f4f6" : "white",
              cursor: reliefLoading ? "not-allowed" : "pointer",
              fontWeight: 700,
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
