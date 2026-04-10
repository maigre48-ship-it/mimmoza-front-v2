// src/spaces/promoteur/pages/Massing3D.tsx

import React from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { usePromoteurProjectStore } from "../store/promoteurProject.store";
import { patchModule } from "../shared/promoteurSnapshot.store";
import { MassingEditor3D } from "../terrain3d/components/MassingEditor3D";
import type { MassingSceneModel } from "../terrain3d/massingScene.types";

import { buildSceneRenderSpec } from "../terrain3d/blender/buildSceneRenderSpec";
import { exportRenderSpecJson } from "../terrain3d/blender/exportRenderSpecJson";
import { exportSceneToGltf } from "../terrain3d/blender/exportSceneToGltf";
import { exportSceneToGltfBlob } from "../terrain3d/blender/exportSceneToGltfBlob";
import { useLocalBlenderRender } from "../terrain3d/blender/useLocalBlenderRender";

const GRAD_PRO = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
const ACCENT_PRO = "#5247b8";

export default function Massing3D(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");

  const parcel = usePromoteurProjectStore((s) => s.parcel);
  const parkings = usePromoteurProjectStore((s) => s.parkings);
  const buildings = usePromoteurProjectStore((s) => s.buildings);
  const implantation2d = usePromoteurProjectStore((s) => s.implantation2d);
  const lastUpdatedAt = usePromoteurProjectStore((s) => s.lastUpdatedAt);

  const meta = implantation2d?.meta ?? null;
  const buildingHeightM = meta?.floorsSpec
    ? meta.floorsSpec.groundFloorHeightM +
      meta.floorsSpec.aboveGroundFloors * meta.floorsSpec.typicalFloorHeightM
    : null;

  const [scene3D, setScene3D] = React.useState<MassingSceneModel | null>(null);
  const [isExportingGltf, setIsExportingGltf] = React.useState(false);
  const [showLogs, setShowLogs] = React.useState(false);

  const exportBuildings = scene3D?.buildings ?? buildings ?? [];
  const exportProjectName = studyId ? `Mimmoza Study ${studyId}` : "Mimmoza Massing 3D";

  // ── Hook rendu Blender local ─────────────────────────────────────────────
  const { status, result, error, logs, runRender } = useLocalBlenderRender();

  const handleSceneChange = (scene: MassingSceneModel) => {
    setScene3D(scene);
    try {
      patchModule("massing3d" as any, {
        ok: scene.buildings.length > 0,
        summary: `${scene.buildings.length} bâtiment(s) éditables`,
        data: { scene },
      } as any);
    } catch (e) {
      console.warn("[Massing3D] snapshot error:", e);
    }
  };

  const handleExportBlenderJson = () => {
    try {
      const spec = buildSceneRenderSpec({
        buildings: exportBuildings,
        parcel: parcel ?? undefined,
        projectName: exportProjectName,
      });
      exportRenderSpecJson(spec, {
        fileName: "scene.render-spec.json",
        pretty: true,
        space: 2,
        autoDownload: true,
        log: true,
      });
    } catch (err) {
      console.error("[Massing3D] Export JSON failed:", err);
      alert("Échec de l'export JSON Blender.");
    }
  };

  const handleExportBlenderGltf = async () => {
    try {
      setIsExportingGltf(true);
      await exportSceneToGltf(
        { buildings: exportBuildings, parcel: parcel ?? undefined, projectName: exportProjectName },
        { fileName: "scene.gltf", binary: false, autoDownload: true, log: true },
      );
    } catch (err) {
      console.error("[Massing3D] Export GLTF failed:", err);
      alert("Échec de l'export GLTF Blender.");
    } finally {
      setIsExportingGltf(false);
    }
  };

  const handleGenerateBlenderRender = async () => {
    setShowLogs(true);
    try {
      const spec = buildSceneRenderSpec({
        buildings: exportBuildings,
        parcel: parcel ?? undefined,
        projectName: exportProjectName,
      });
      const renderSpecBlob = new Blob([JSON.stringify(spec, null, 2)], {
        type: "application/json",
      });
      const gltfBlob = await exportSceneToGltfBlob(
        { buildings: exportBuildings, parcel: parcel ?? undefined, projectName: exportProjectName },
        { log: true },
      );
      await runRender({ gltfBlob, renderSpecBlob });
    } catch (e) {
      console.error("[MMZ] Blender local render failed", e);
    }
  };

  // ── Bannière ─────────────────────────────────────────────────────────────
  const banner = (
    <div
      style={{
        background: GRAD_PRO,
        borderRadius: 14,
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexShrink: 0,
      }}
    >
      <div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 4 }}>
          Promoteur › Conception
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "white", marginBottom: 2 }}>
          Massing 3D — Éditeur
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
          Dessinez, sélectionnez et éditez vos volumes directement en 3D.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
        <button
          onClick={handleExportBlenderJson}
          style={{
            padding: "8px 16px", borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.35)",
            background: "rgba(255,255,255,0.16)",
            color: "white", fontWeight: 700, fontSize: 13, cursor: "pointer",
          }}
        >
          Export Blender JSON
          <span style={{ marginLeft: 6, opacity: 0.75, fontWeight: 400, fontSize: 11 }}>
            ({exportBuildings.length} bât.)
          </span>
        </button>

        <button
          onClick={handleExportBlenderGltf}
          disabled={isExportingGltf}
          style={{
            padding: "8px 16px", borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.35)",
            background: isExportingGltf ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.16)",
            color: "white", fontWeight: 700, fontSize: 13,
            cursor: isExportingGltf ? "wait" : "pointer",
            opacity: isExportingGltf ? 0.7 : 1,
          }}
        >
          {isExportingGltf ? "Export GLTF..." : "Export Blender GLTF"}
        </button>

        <button
          type="button"
          onClick={handleGenerateBlenderRender}
          disabled={status === "uploading" || status === "rendering"}
          style={{
            padding: "8px 16px", borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.35)",
            background:
              status === "uploading" || status === "rendering"
                ? "rgba(255,255,255,0.08)"
                : "rgba(15,23,42,0.55)",
            color: "white", fontWeight: 700, fontSize: 13,
            cursor: status === "uploading" || status === "rendering" ? "wait" : "pointer",
            opacity: status === "uploading" || status === "rendering" ? 0.7 : 1,
          }}
        >
          {status === "uploading"
            ? "Envoi au renderer..."
            : status === "rendering"
              ? "Rendu en cours..."
              : "🎨 Rendu Blender"}
        </button>

        <button
          onClick={() => navigate(studyId ? `/promoteur/implantation-2d?study=${encodeURIComponent(studyId)}` : "/promoteur/implantation-2d")}
          style={{
            padding: "8px 16px", borderRadius: 10, border: "none",
            background: "white", color: ACCENT_PRO, fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}
        >
          ← Implantation 2D
        </button>

        <button
          onClick={() => navigate(studyId ? `/promoteur/bilan?study=${encodeURIComponent(studyId)}` : "/promoteur/bilan")}
          style={{
            padding: "8px 16px", borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.35)",
            background: "rgba(255,255,255,0.12)",
            color: "white", fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}
        >
          Voir le bilan →
        </button>

        {studyId && (
          <div style={{
            padding: "6px 12px", borderRadius: 8,
            background: "rgba(255,255,255,0.15)", color: "white",
            fontSize: 11, fontWeight: 500,
            border: "1px solid rgba(255,255,255,0.25)", alignSelf: "center",
          }}>
            Étude {studyId.slice(0, 8)}…
          </div>
        )}
      </div>
    </div>
  );

  // ── Meta bar ─────────────────────────────────────────────────────────────
  const metaBar = meta?.floorsSpec ? (
    <div style={{
      display: "flex", gap: 16, padding: "8px 16px",
      background: "white", borderRadius: 10, border: "1px solid #e2e8f0",
      fontSize: 12, color: "#475569", flexShrink: 0, flexWrap: "wrap",
    }}>
      <span><b style={{ color: "#0f172a" }}>R+{meta.floorsSpec.aboveGroundFloors}</b> · {buildingHeightM?.toFixed(1)} m</span>
      <span>RDC <b style={{ color: "#0f172a" }}>{meta.floorsSpec.groundFloorHeightM} m</b> · Étage <b style={{ color: "#0f172a" }}>{meta.floorsSpec.typicalFloorHeightM} m</b></span>
      {meta.nbLogements > 0 && (
        <span><b style={{ color: "#0f172a" }}>{meta.nbLogements}</b> logements · {meta.surfaceMoyLogementM2} m²/lgt</span>
      )}
      <span style={{ color: "#94a3b8", fontStyle: "italic" }}>
        {meta.buildingKind === "COLLECTIF" ? "Collectif" : "Individuel"}
      </span>
      {lastUpdatedAt && (
        <span style={{ color: "#94a3b8", marginLeft: "auto" }}>
          MAJ {new Date(lastUpdatedAt).toLocaleString("fr-FR", { timeStyle: "short", dateStyle: "short" })}
        </span>
      )}
    </div>
  ) : null;

  // ── Panneau résultat + logs ───────────────────────────────────────────────
  const isActive = error || result?.imageUrl || status === "uploading" || status === "rendering";

  const renderPanel = (isActive || showLogs) ? (
    <div style={{
      padding: "12px 16px", background: "white",
      borderRadius: 10, border: "1px solid #e2e8f0", flexShrink: 0,
    }}>
      {/* ── Header statut ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 13, color: "#475569" }}>
          Statut : <strong style={{ color: "#0f172a" }}>{status}</strong>
        </span>
        {/* Bouton toggle logs */}
        {logs && logs.length > 0 && (
          <button
            onClick={() => setShowLogs((v) => !v)}
            style={{
              padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
              border: "1px solid #cbd5e1", background: showLogs ? "#f1f5f9" : "white",
              color: "#475569", cursor: "pointer",
            }}
          >
            {showLogs ? "Masquer logs" : "Voir logs Blender"}
          </button>
        )}
      </div>

      {/* ── Erreur ── */}
      {error && (
        <div style={{ marginTop: 8, color: "#b91c1c", fontSize: 13 }}>
          Erreur : {error}
        </div>
      )}

      {/* ── Logs Blender ── */}
      {showLogs && logs && logs.length > 0 && (
        <div style={{
          marginTop: 10,
          background: "#0f172a",
          borderRadius: 8,
          padding: "10px 14px",
          maxHeight: 220,
          overflowY: "auto",
        }}>
          <pre style={{
            margin: 0, fontSize: 11, lineHeight: 1.6,
            color: "#94a3b8", fontFamily: "monospace", whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}>
            {logs.join("\n")}
          </pre>
        </div>
      )}

      {/* ── Image résultat ── */}
      {result?.imageUrl && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#0f172a" }}>
            Dernier rendu
          </div>
          <img
            src={result.imageUrl}
            alt="Rendu Blender"
            style={{
              maxWidth: "100%", borderRadius: 12,
              border: "1px solid #e2e8f0", display: "block",
            }}
          />
          <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
            Job : {result.jobId} · {result.durationMs ?? 0} ms
          </div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 12,
      padding: 16, height: "calc(100vh - 64px)",
      background: "#f8fafc", boxSizing: "border-box",
    }}>
      {banner}
      {metaBar}
      {renderPanel}
      <div style={{ flex: 1, minHeight: 0 }}>
        <MassingEditor3D
          parcel={parcel ?? undefined}
          buildings={buildings ?? undefined}
          parkings={parkings ?? undefined}
          meta={meta ?? undefined}
          buildingHeightM={buildingHeightM ?? undefined}
          height="100%"
          onSceneChange={handleSceneChange}
        />
      </div>
    </div>
  );
}