// src/spaces/promoteur/pages/Massing3D.tsx
// v2.3 — Loader terrain centré (spinner + barre indéterminée) remplace le badge haut-écran
// v2.2 — Bouton Synthèse déplacé en overlay haut-gauche du canvas 3D
// v2.1 — Capture scopée par studyId
// v2.0 — Capture synthèse

import React from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { usePromoteurProjectStore } from "../store/promoteurProject.store";
import { patchModule } from "../shared/promoteurSnapshot.store";
import { writeCapture } from "../shared/captures.store";
import { MassingEditor3D } from "../terrain3d/components/MassingEditor3D";
import type { MassingSceneModel } from "../terrain3d/massingScene.types";
import type { Feature, Polygon, MultiPolygon } from "geojson";

const GRAD_PRO   = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
const ACCENT_PRO = "#5247b8";

function parcelFeatureKey(studyId: string): string {
  return `mimmoza.parcelFeature.${studyId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE MASSING 3D — scopée par studyId
// ─────────────────────────────────────────────────────────────────────────────

async function captureMassing3D(studyId: string | null): Promise<boolean> {
  try {
    const container = document.getElementById("massing3d-capture-target");
    const threeCanvas = (container?.querySelector("canvas")
      ?? document.querySelector("canvas")) as HTMLCanvasElement | null;

    if (!threeCanvas) {
      console.warn("[Massing3D] aucun canvas Three.js trouvé");
      return false;
    }

    window.dispatchEvent(new Event("resize"));
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));

    let dataUrl = "";
    try {
      dataUrl = threeCanvas.toDataURL("image/jpeg", 0.85);
    } catch {
      // CORS ou SecurityError
    }

    const isBlankOrEmpty = !dataUrl || dataUrl.length < 1000;

    if (!isBlankOrEmpty) {
      const tmp = document.createElement("canvas");
      tmp.width  = threeCanvas.width  || 800;
      tmp.height = threeCanvas.height || 600;
      const ctx = tmp.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(0, 0, tmp.width, tmp.height);
        ctx.drawImage(threeCanvas, 0, 0);
        dataUrl = tmp.toDataURL("image/jpeg", 0.85);
      }

      const ok = writeCapture(studyId, "massing3d", dataUrl);
      if (ok) {
        console.debug("[Massing3D] capture OK, taille:",
          Math.round(dataUrl.length / 1024), "Ko", "studyId:", studyId);
        return true;
      }
      return false;
    }

    console.warn("[Massing3D] canvas vide — preserveDrawingBuffer probablement false.");
    return false;
  } catch (e) {
    console.warn("[Massing3D] capture error:", e);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADER TERRAIN — overlay centré
// ─────────────────────────────────────────────────────────────────────────────

const TerrainLoader: React.FC = () => (
  <div style={{
    position:       "absolute",
    inset:          0,
    zIndex:         40,
    display:        "flex",
    flexDirection:  "column",
    alignItems:     "center",
    justifyContent: "center",
    gap:            16,
    background:     "rgba(248,250,252,0.72)",
    backdropFilter: "blur(6px)",
    borderRadius:   "inherit",
    pointerEvents:  "none",
  }}>
    {/* Cercle tournant */}
    <div style={{
      width:        52,
      height:       52,
      border:       "5px solid #e2e8f0",
      borderTopColor: ACCENT_PRO,
      borderRadius: "50%",
      animation:    "mmz-spin 0.85s linear infinite",
    }} />

    {/* Barre de progression indéterminée */}
    <div style={{
      width:        220,
      height:       6,
      background:   "#e2e8f0",
      borderRadius: 99,
      overflow:     "hidden",
    }}>
      <div style={{
        height:       "100%",
        width:        "38%",
        background:   `linear-gradient(90deg, ${ACCENT_PRO}, #b39ddb)`,
        borderRadius: 99,
        animation:    "mmz-slide 1.35s ease-in-out infinite",
      }} />
    </div>

    <span style={{
      fontSize:   13,
      color:      ACCENT_PRO,
      fontWeight: 600,
      letterSpacing: "0.01em",
    }}>
      Chargement du terrain…
    </span>

    <style>{`
      @keyframes mmz-spin  { to { transform: rotate(360deg); } }
      @keyframes mmz-slide {
        0%   { transform: translateX(-160%); }
        100% { transform: translateX(620%);  }
      }
    `}</style>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// BOUTON CAPTURE
// ─────────────────────────────────────────────────────────────────────────────

interface CaptureButtonProps {
  studyId: string | null;
}

const CaptureButton: React.FC<CaptureButtonProps> = ({ studyId }) => {
  const [status, setStatus] = React.useState<"idle" | "capturing" | "ok" | "fail">("idle");

  const handleCapture = React.useCallback(async () => {
    setStatus("capturing");
    const ok = await captureMassing3D(studyId);
    setStatus(ok ? "ok" : "fail");
    setTimeout(() => setStatus("idle"), 2500);
  }, [studyId]);

  const label =
    status === "capturing" ? "Capture…"
    : status === "ok"      ? "✓ Capturé !"
    : status === "fail"    ? "⚠ Échec"
    : "📸 Synthèse";

  return (
    <button
      onClick={handleCapture}
      disabled={status === "capturing"}
      style={{
        padding:        "8px 14px",
        borderRadius:   10,
        border:         "1px solid #e2e8f0",
        background:     status === "ok"   ? "rgba(16,185,129,0.15)"
                      : status === "fail" ? "rgba(239,68,68,0.15)"
                      : "rgba(255,255,255,0.92)",
        color:          status === "ok"   ? "#15803d"
                      : status === "fail" ? "#dc2626"
                      : ACCENT_PRO,
        fontWeight:     600,
        fontSize:       12,
        cursor:         status === "capturing" ? "wait" : "pointer",
        transition:     "background 0.2s",
        backdropFilter: "blur(8px)",
        boxShadow:      "0 1px 4px rgba(0,0,0,0.08)",
      }}
      title="Capturer cette vue 3D pour la Synthèse Promoteur"
    >
      {label}
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGE PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────

export default function Massing3D(): React.ReactElement {
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const studyId        = searchParams.get("study");

  const parcelRaw      = usePromoteurProjectStore((s) => s.parcel);
  const parkings       = usePromoteurProjectStore((s) => s.parkings);
  const buildings      = usePromoteurProjectStore((s) => s.buildings);
  const implantation2d = usePromoteurProjectStore((s) => s.implantation2d);
  const lastUpdatedAt  = usePromoteurProjectStore((s) => s.lastUpdatedAt);

  const parcel = React.useMemo<Feature<Polygon | MultiPolygon> | undefined>(() => {
    if (studyId) {
      try {
        const raw = localStorage.getItem(parcelFeatureKey(studyId));
        if (raw) {
          const feat = JSON.parse(raw) as Feature<Polygon | MultiPolygon>;
          if (feat?.type === "Feature" && feat?.geometry?.type) {
            console.debug("[Massing3D] parcel depuis localStorage (WGS84 Feature)");
            return feat;
          }
        }
      } catch (e) {
        console.warn("[Massing3D] lecture parcelFeature échouée:", e);
      }
    }
    console.debug("[Massing3D] parcel depuis store (fallback)");
    return parcelRaw ?? undefined;
  }, [studyId, parcelRaw]);

  const meta = implantation2d?.meta ?? null;
  const buildingHeightM = meta?.floorsSpec
    ? meta.floorsSpec.groundFloorHeightM +
      meta.floorsSpec.aboveGroundFloors * meta.floorsSpec.typicalFloorHeightM
    : null;

  const [scene3D,          setScene3D]          = React.useState<MassingSceneModel | null>(null);
  const [showLabels,       setShowLabels]        = React.useState(false);
  const [isLoadingTerrain, setIsLoadingTerrain]  = React.useState(false);

  const handleSceneChange = (scene: MassingSceneModel) => {
    setScene3D(scene);
    try {
      patchModule("massing3d" as any, {
        ok:      scene.buildings.length > 0,
        summary: `${scene.buildings.length} bâtiment(s) éditables`,
        data:    { scene },
      } as any);
    } catch (e) {
      console.warn("[Massing3D] snapshot error:", e);
    }
  };

  const banner = (
    <div style={{
      background:     GRAD_PRO,
      borderRadius:   14,
      padding:        "16px 24px",
      display:        "flex",
      alignItems:     "center",
      justifyContent: "space-between",
      gap:            16,
      flexShrink:     0,
    }}>
      <div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 4 }}>Promoteur › Conception</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "white", marginBottom: 2 }}>Massing 3D — Éditeur</div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>Dessinez, sélectionnez et éditez vos volumes directement en 3D.</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={() => navigate(studyId ? `/promoteur/implantation-2d?study=${encodeURIComponent(studyId)}` : "/promoteur/implantation-2d")}
          style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: "white", color: ACCENT_PRO, fontWeight: 600, fontSize: 13, cursor: "pointer" }}
        >
          ← Implantation 2D
        </button>

        <button
          onClick={() => navigate(studyId ? `/promoteur/bilan?study=${encodeURIComponent(studyId)}` : "/promoteur/bilan")}
          style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.12)", color: "white", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
        >
          Voir le bilan →
        </button>

        {studyId && (
          <div style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(255,255,255,0.15)", color: "white", fontSize: 11, fontWeight: 500, border: "1px solid rgba(255,255,255,0.25)", alignSelf: "center" }}>
            Étude {studyId.slice(0, 8)}…
          </div>
        )}
      </div>
    </div>
  );

  const metaBar = meta?.floorsSpec ? (
    <div style={{ display: "flex", gap: 16, padding: "8px 16px", background: "white", borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12, color: "#475569", flexShrink: 0, flexWrap: "wrap", alignItems: "center" }}>
      <span><b style={{ color: "#0f172a" }}>R+{meta.floorsSpec.aboveGroundFloors}</b> · {buildingHeightM?.toFixed(1)} m</span>
      <span>RDC <b style={{ color: "#0f172a" }}>{meta.floorsSpec.groundFloorHeightM} m</b> · Étage <b style={{ color: "#0f172a" }}>{meta.floorsSpec.typicalFloorHeightM} m</b></span>
      {meta.nbLogements > 0 && (
        <span><b style={{ color: "#0f172a" }}>{meta.nbLogements}</b> logements · {meta.surfaceMoyLogementM2} m²/lgt</span>
      )}
      <span style={{ color: "#94a3b8", fontStyle: "italic" }}>
        {meta.buildingKind === "COLLECTIF" ? "Collectif" : "Individuel"}
      </span>

      <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", cursor: "pointer", padding: "4px 10px", borderRadius: 6, background: showLabels ? "rgba(82,71,184,0.08)" : "#f1f5f9", border: showLabels ? "1px solid rgba(82,71,184,0.25)" : "1px solid #e2e8f0", color: showLabels ? ACCENT_PRO : "#64748b", fontSize: 11, fontWeight: 600 }}>
        <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} style={{ accentColor: ACCENT_PRO }} />
        🏷 Étiquettes
      </label>

      {lastUpdatedAt && (
        <span style={{ color: "#94a3b8" }}>
          MAJ {new Date(lastUpdatedAt).toLocaleString("fr-FR", { timeStyle: "short", dateStyle: "short" })}
        </span>
      )}
    </div>
  ) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, height: "calc(100vh - 64px)", background: "#f8fafc", boxSizing: "border-box" }}>
      {banner}
      {metaBar}
      <div
        id="massing3d-capture-target"
        style={{ flex: 1, minHeight: 0, position: "relative" }}
      >
        {/* Overlay loader terrain — centré, remplace le badge haut-écran */}
        {isLoadingTerrain && <TerrainLoader />}

        {/* Bouton Synthèse en overlay haut-gauche du canvas 3D */}
        <div style={{ position: "absolute", top: 12, left: 12, zIndex: 20 }}>
          <CaptureButton studyId={studyId} />
        </div>

        <MassingEditor3D
          parcel={parcel}
          buildings={buildings ?? undefined}
          parkings={parkings ?? undefined}
          meta={meta ?? undefined}
          buildingHeightM={buildingHeightM ?? undefined}
          showLabels={showLabels}
          height="100%"
          onSceneChange={handleSceneChange}
          onTerrainLoadingChange={setIsLoadingTerrain}
        />
      </div>
    </div>
  );
}