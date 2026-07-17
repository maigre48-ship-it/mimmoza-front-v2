// src/spaces/promoteur/pages/Massing3D.tsx
// v2.4 — Hero v2 : design identique à VeilleMarchePage
// v2.3 — Loader terrain centré
// v2.2 — Bouton Synthèse en overlay haut-gauche du canvas 3D
// v2.1 — Capture scopée par studyId
// v2.0 — Capture synthèse

import type { Feature, MultiPolygon, Polygon } from "geojson";
import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { writeCapture } from "../shared/captures.store";
import {
  HeroGhostButton,
  HeroPrimaryButton,
  PromoteurPageHero,
} from "../shared/components/PromoteurPageHero";
import { ACCENT_PRO } from "../shared/promoteurDesign.tokens";
import { patchModule } from "../shared/promoteurSnapshot.store";
import { usePromoteurStudy } from "../shared/usePromoteurStudy";
import { usePromoteurProjectStore } from "../store/promoteurProject.store";
import { MassingEditor3D } from "../terrain3d/components/MassingEditor3D";
import type { MassingSceneModel } from "../terrain3d/massingScene.types";
import {
  eaveHeightM,
  ridgeHeightM,
  roofRiseM,
  totalLevelsCount,
} from "../terrain3d/massingScene.types";
import { userStorage } from "@/lib/storage/userScopedStorage";

// v2.5 — Publication du contexte vers l'Analyste Mimmoza.
// Le panneau Copilot est monté hors de cette page (layout global) : il ne peut
// rien recevoir par props. Sans publication, l'Analyste répond « aucune parcelle
// n'est ouverte » alors que la scène 3D est à l'écran. Même mécanisme que
// Implantation2DPage / ProgrammationPage.
import {
  setActiveCopilotContext,
  clearActiveCopilotContext,
  normalizeStudyId,
  toActivePluRef,
} from "../../copilot/store/activeCopilotContext.store";

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
    position: "absolute", inset: 0, zIndex: 40,
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 16, background: "rgba(248,250,252,0.72)", backdropFilter: "blur(6px)",
    borderRadius: "inherit", pointerEvents: "none",
  }}>
    <div style={{
      width: 52, height: 52,
      border: "5px solid #e2e8f0", borderTopColor: ACCENT_PRO,
      borderRadius: "50%", animation: "mmz-spin 0.85s linear infinite",
    }} />
    <div style={{ width: 220, height: 6, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
      <div style={{
        height: "100%", width: "38%",
        background: `linear-gradient(90deg, ${ACCENT_PRO}, #b39ddb)`,
        borderRadius: 99, animation: "mmz-slide 1.35s ease-in-out infinite",
      }} />
    </div>
    <span style={{ fontSize: 13, color: ACCENT_PRO, fontWeight: 600, letterSpacing: "0.01em" }}>
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
        padding: "8px 14px", borderRadius: 10, border: "1px solid #e2e8f0",
        background: status === "ok"   ? "rgba(16,185,129,0.15)"
                  : status === "fail" ? "rgba(239,68,68,0.15)"
                  : "rgba(255,255,255,0.92)",
        color: status === "ok"   ? "#15803d"
             : status === "fail" ? "#dc2626"
             : ACCENT_PRO,
        fontWeight: 600, fontSize: 12,
        cursor: status === "capturing" ? "wait" : "pointer",
        transition: "background 0.2s", backdropFilter: "blur(8px)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
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

  // v2.5 — PLU réel de l'étude : alimente le tool get_parcel_plu de l'Analyste.
  const { study } = usePromoteurStudy(studyId);

  const parcelRaw      = usePromoteurProjectStore((s) => s.parcel);
  const parkings       = usePromoteurProjectStore((s) => s.parkings);
  // PATCH — plus de source « buildings » dégradée (polygones nus) : le Massing lit
  // désormais le vrai plan masse 2D par-étude (cf. MassingEditor3D).
  const implantation2d = usePromoteurProjectStore((s) => s.implantation2d);
  const lastUpdatedAt  = usePromoteurProjectStore((s) => s.lastUpdatedAt);

  const parcel = React.useMemo<Feature<Polygon | MultiPolygon> | undefined>(() => {
    if (studyId) {
      try {
        const raw = userStorage.getItem(parcelFeatureKey(studyId));
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

  const [scene3D,          setScene3D]         = React.useState<MassingSceneModel | null>(null);
  const [showLabels,       setShowLabels]       = React.useState(false);
  const [isLoadingTerrain, setIsLoadingTerrain] = React.useState(false);

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

  // ───────────────────────────────────────────────────────────────────────────
  // v2.5 — Contexte Analyste Mimmoza
  //   Ce que le Massing sait SEUL : les hauteurs réelles (égout / faîtage) et la
  //   toiture. L'emprise et les niveaux viennent de la Programmation (source de
  //   vérité) — inutile de les republier ici, ils y sont déjà et une seconde
  //   valeur ouvrirait la porte aux contradictions.
  //
  //   ⚠️ La hauteur au FAÎTAGE est le seul gabarit que cette page modifie : une
  //   toiture à 2 pentes peut ajouter plusieurs mètres au-dessus de l'égout, et
  //   le PLU impose typiquement DEUX limites (Ascain UB : 10 m égout / 13 m
  //   faîtage). C'est cette donnée que l'Analyste doit pouvoir lire.
  // ───────────────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    const bats = scene3D?.buildings ?? [];

    const details = bats.map((b) => {
      const roof   = b.style?.roofConfig;
      const hEave  = eaveHeightM(b.levels);
      const hRidge = ridgeHeightM(b.levels, b.footprint, roof);
      return {
        nom:                b.name,
        niveaux:            totalLevelsCount(b.levels),
        hauteur_egout_m:    Math.round(hEave * 10) / 10,
        hauteur_faitage_m:  Math.round(hRidge * 10) / 10,
        toiture:            roof?.shape ?? "flat",
        toiture_pente_deg:  roof?.shape && roof.shape !== "flat" ? (roof.slopeDeg ?? 30) : null,
        emprise_m2:         b.meta?.footprintM2 ?? null,
      };
    });

    const maxEgout   = details.reduce((m, d) => Math.max(m, d.hauteur_egout_m), 0);
    const maxFaitage = details.reduce((m, d) => Math.max(m, d.hauteur_faitage_m), 0);

    setActiveCopilotContext({
      studyId:  normalizeStudyId(studyId),
      route:    "/promoteur/massing-3d",
      vertical: "promoteur",
      plu:      toActivePluRef((study as { plu?: unknown } | null)?.plu ?? null),
      pageContext: {
        pathname: "/promoteur/massing-3d",
        space:    "promoteur",
        mode:     "conception",
        tab:      "massing",
      },
      pageSnapshot: {
        page:              "Massing 3D — volumes bâtis",
        nb_batiments:      bats.length,
        hauteur_egout_max_m:   maxEgout   > 0 ? maxEgout   : null,
        hauteur_faitage_max_m: maxFaitage > 0 ? maxFaitage : null,
        // Écart égout → faîtage : ce que la toiture ajoute au gabarit.
        toiture_surhauteur_m: maxFaitage > maxEgout
          ? Math.round((maxFaitage - maxEgout) * 10) / 10
          : null,
        batiments: details.length
          ? details.map((d) =>
              `${d.nom} : ${d.niveaux} niv. · égout ${d.hauteur_egout_m} m · faîtage ${d.hauteur_faitage_m} m · toiture ${d.toiture}${d.toiture_pente_deg ? ` ${d.toiture_pente_deg}°` : ""}`,
            ).join(" | ")
          : null,
        source_gabarit: "emprise et niveaux definis dans la Programmation ; hauteurs et toiture editees ici",
      },
    });
  }, [studyId, study, scene3D]);

  // Purge en quittant : sans ça, le volume fuit vers les autres routes et
  // l'Analyste répond sur une scène qui n'est plus à l'écran.
  React.useEffect(() => () => clearActiveCopilotContext(), []);

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
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)", background: "#f8fafc", boxSizing: "border-box" }}>

      {/* ── Hero v2 — pleine largeur ── */}
      <div style={{ flexShrink: 0 }}>
        <PromoteurPageHero
          badge="Promoteur · Conception"
          title="Massing 3D — Éditeur"
          metaLines={[
            { text: "Dessinez, sélectionnez et éditez vos volumes directement en 3D." },
            ...(studyId ? [{ text: `Étude ${studyId.slice(0, 8)}…` }] : []),
          ]}
          actions={
            <>
              <HeroGhostButton onClick={() => navigate(studyId ? `/promoteur/implantation-2d?study=${encodeURIComponent(studyId)}` : "/promoteur/implantation-2d")}>
                ← Implantation 2D
              </HeroGhostButton>
              <HeroPrimaryButton onClick={() => navigate(studyId ? `/promoteur/bilan?study=${encodeURIComponent(studyId)}` : "/promoteur/bilan")}>
                Voir le bilan →
              </HeroPrimaryButton>
            </>
          }
        />
      </div>

      {/* ── MetaBar (optionnelle) ── */}
      {metaBar && (
        <div style={{ padding: "8px 0 0", flexShrink: 0 }}>
          {metaBar}
        </div>
      )}

      {/* ── Canvas 3D ── */}
      <div
        id="massing3d-capture-target"
        style={{ flex: 1, minHeight: 0, position: "relative", margin: "12px 0 16px" }}
      >
        {/* Overlay loader terrain */}
        {isLoadingTerrain && <TerrainLoader />}

        {/* Bouton Synthèse en overlay haut-gauche */}
        <div style={{ position: "absolute", top: 12, left: 12, zIndex: 20 }}>
          <CaptureButton studyId={studyId} />
        </div>

        <MassingEditor3D
          parcel={parcel}
          parkings={parkings ?? undefined}
          meta={meta ?? undefined}
          showLabels={showLabels}
          height="100%"
          onSceneChange={handleSceneChange}
          onTerrainLoadingChange={setIsLoadingTerrain}
        />
      </div>
    </div>
  );
}