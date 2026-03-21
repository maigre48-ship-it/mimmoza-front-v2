// src/spaces/promoteur/pages/Dashboard.tsx
// VERSION 2.1.0 — aligné sur PromoteurStudyService v2.0.1

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  clearAllPromoteurSessionKeys,
  clearActiveStudyId,
  setActiveStudyId,
} from "../shared/promoteurSnapshot.store";
import { PromoteurStudyService } from "../shared/promoteurStudyService";
import type { PromoteurStudySummary } from "../shared/promoteurStudy.types";

const GRAD_PRO   = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
const ACCENT_PRO = "#5247b8";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateFR(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}

function formatDateTimeFR(iso: string) {
  try {
    return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function routeForStep(step?: string | null) {
  switch (step) {
    case "foncier":  return "/promoteur/foncier";
    case "plu":      return "/promoteur/plu-faisabilite";
    case "marche":   return "/promoteur/marche";
    case "risques":  return "/promoteur/risques";
    case "bilan":    return "/promoteur/bilan";
    case "synthese": return "/promoteur/synthese";
    default:         return "/promoteur/foncier";
  }
}

// ─── StudyCard ────────────────────────────────────────────────────────────────

function StudyCard({ study, onOpen, onDelete, onShare, onExport }: {
  study: PromoteurStudySummary;
  onOpen:   () => void;
  onDelete: () => void;
  onShare:  () => void;
  onExport: () => void;
}) {
  const communeInsee = study.foncier?.commune_insee ?? null;
  const surfaceM2    = study.foncier?.surface_m2    ?? 0;

  return (
    <div style={{ border: "1px solid #ddd8f8", borderRadius: 14, background: "white", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 4, background: GRAD_PRO }} />

      {/* Header */}
      <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid #eee8fc", background: "linear-gradient(135deg, #f4f2fe 0%, #faf8ff 100%)" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#2a1f6e", marginBottom: 4 }}>{study.title}</div>
        <div style={{ fontSize: 11, color: "#8a7ec8" }}>
          {communeInsee ? `INSEE ${communeInsee}` : "Localisation —"}
          {" · "}Créée {formatDateFR(study.created_at)}
          {" · "}Maj {formatDateFR(study.updated_at)}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
        {/* Foncier stats */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: ACCENT_PRO, marginBottom: 8 }}>Foncier</div>
          <div style={{ display: "flex", gap: 20 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 500, color: "#2a1f6e", lineHeight: 1 }}>
                {surfaceM2 > 0 ? `${Math.round(surfaceM2).toLocaleString("fr-FR")} m²` : "—"}
              </div>
              <div style={{ fontSize: 11, color: "#8a7ec8", marginTop: 2 }}>Surface</div>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "#2a1f6e", lineHeight: 1.4 }}>
                {communeInsee ?? "—"}
              </div>
              <div style={{ fontSize: 11, color: "#8a7ec8", marginTop: 2 }}>Commune INSEE</div>
            </div>
          </div>
        </div>

        {/* Statut */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: ACCENT_PRO, marginBottom: 8 }}>Statut</div>
          <span style={{
            display: "inline-block",
            padding: "3px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            background: study.status === "active" ? "#ede9fe" : study.status === "archived" ? "#f1f5f9" : "#fef3c7",
            color:      study.status === "active" ? ACCENT_PRO  : study.status === "archived" ? "#64748b"  : "#92400e",
          }}>
            {study.status === "active" ? "Active" : study.status === "archived" ? "Archivée" : "Brouillon"}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid #eee8fc", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={onOpen} style={{ flex: "1 1 auto", padding: "8px 12px", borderRadius: 9, border: "none", background: GRAD_PRO, color: "white", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
          Ouvrir
        </button>
        <button onClick={onShare} style={{ padding: "8px 12px", borderRadius: 9, border: "1px solid #ddd8f8", background: "white", color: ACCENT_PRO, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
          Partager
        </button>
        <button onClick={onExport} style={{ padding: "8px 12px", borderRadius: 9, border: "1px solid #ddd8f8", background: "white", color: ACCENT_PRO, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
          Exporter
        </button>
        <button onClick={onDelete} style={{ padding: "8px 10px", borderRadius: 9, border: "1px solid #fecaca", background: "#fef2f2", color: "#dc2626", fontWeight: 600, fontSize: 12, cursor: "pointer" }} title="Supprimer">
          🗑️
        </button>
      </div>

      <div style={{ padding: "4px 16px 10px", fontSize: 10, color: "#c4baf0" }}>ID: {study.id}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function Dashboard(): React.ReactElement {
  const navigate = useNavigate();

  const [studies,   setStudies]   = useState<PromoteurStudySummary[]>([]);
  const [isLoaded,  setIsLoaded]  = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Chargement depuis Supabase ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await PromoteurStudyService.listStudies();
      if (cancelled) return;

      if (result.ok) {
        setStudies(result.data);
        if (result.data.length === 0) {
          clearActiveStudyId();
          clearAllPromoteurSessionKeys();
        }
      } else {
        console.error("[Dashboard] listStudies failed:", result.error);
        setLoadError(result.error);
      }

      setIsLoaded(true);
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const sortedStudies = useMemo(() =>
    [...studies].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [studies]
  );

  // ── Créer une nouvelle étude ────────────────────────────────────
  const createStudy = useCallback(async () => {
    const created = new Date().toISOString();
    const title   = `Nouvelle étude — ${formatDateTimeFR(created)}`;

    const result = await PromoteurStudyService.createStudy(title);

    if (result.ok) {
      const newStudy = result.data;
      // Convertir PromoteurStudy → PromoteurStudySummary pour l'affichage
      const summary: PromoteurStudySummary = {
        id:         newStudy.id,
        user_id:    newStudy.user_id,
        title:      newStudy.title,
        status:     newStudy.status,
        created_at: newStudy.created_at,
        updated_at: newStudy.updated_at,
        foncier:    null,
      };
      setStudies(prev => [summary, ...prev]);
      clearAllPromoteurSessionKeys();
      setActiveStudyId(newStudy.id);
      navigate(`/promoteur/foncier?study=${encodeURIComponent(newStudy.id)}`);
    } else {
      console.error("[Dashboard] createStudy failed:", result.error);
      alert(`Impossible de créer l'étude : ${result.error}`);
    }
  }, [navigate]);

  // ── Ouvrir une étude ────────────────────────────────────────────
  const openStudy = useCallback((study: PromoteurStudySummary) => {
    setActiveStudyId(study.id);
    navigate(`/promoteur/foncier?study=${encodeURIComponent(study.id)}`);
  }, [navigate]);

  // ── Supprimer une étude ─────────────────────────────────────────
  const deleteStudy = useCallback(async (studyId: string) => {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer cette étude ?")) return;

    const result = await PromoteurStudyService.deleteStudy(studyId);
    if (!result.ok) {
      console.error("[Dashboard] deleteStudy failed:", result.error);
    }

    setStudies(prev => prev.filter(s => s.id !== studyId));

    const activeId = localStorage.getItem("mimmoza.promoteur.active_study_id");
    if (activeId === studyId) {
      clearActiveStudyId();
      clearAllPromoteurSessionKeys();
    }
  }, []);

  const shareStudy  = useCallback(() => window.alert("Partage bientôt disponible."),  []);
  const exportStudy = useCallback(() => window.alert("Export bientôt disponible."),   []);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div>
      {/* Banner */}
      <div style={{ background: GRAD_PRO, borderRadius: 14, padding: "20px 24px", marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>Promoteur › Démarrer</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>Tableau de bord</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>Centralisez, analysez et partagez vos études immobilières.</div>
        </div>
        <button
          onClick={createStudy}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 18px", borderRadius: 10, border: "none", background: "white", color: ACCENT_PRO, fontWeight: 600, fontSize: 13, cursor: "pointer", flexShrink: 0, marginTop: 4 }}
        >
          + Nouvelle étude
        </button>
      </div>

      {/* Compteur */}
      {isLoaded && sortedStudies.length > 0 && (
        <div style={{ fontSize: 13, color: "#8a7ec8", marginBottom: 14 }}>
          Mes études <strong style={{ color: "#2a1f6e" }}>{sortedStudies.length}</strong>
        </div>
      )}

      {/* Loading */}
      {!isLoaded && (
        <div style={{ border: "1px solid #ddd8f8", borderRadius: 14, padding: 18, background: "white", textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "#8a7ec8" }}>Chargement des études…</div>
        </div>
      )}

      {/* Erreur non bloquante */}
      {isLoaded && loadError && (
        <div style={{ marginBottom: 14, padding: "10px 14px", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 10, fontSize: 12, color: "#92400e" }}>
          ⚠️ Connexion Supabase limitée ({loadError})
        </div>
      )}

      {/* Empty state */}
      {isLoaded && sortedStudies.length === 0 && (
        <div style={{ border: "1px solid #ddd8f8", borderRadius: 14, padding: 24, background: "white" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#2a1f6e", marginBottom: 6 }}>Aucune étude pour le moment</div>
          <div style={{ color: "#8a7ec8", fontSize: 13, marginBottom: 16 }}>Lancez votre première analyse foncière et suivez l'étude de bout en bout.</div>
          <button onClick={createStudy} style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: GRAD_PRO, color: "white", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
            + Nouvelle étude
          </button>
        </div>
      )}

      {/* Grid */}
      {isLoaded && sortedStudies.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
          {sortedStudies.map(s => (
            <StudyCard
              key={s.id}
              study={s}
              onOpen={()   => openStudy(s)}
              onDelete={()  => deleteStudy(s.id)}
              onShare={shareStudy}
              onExport={exportStudy}
            />
          ))}
        </div>
      )}
    </div>
  );
}