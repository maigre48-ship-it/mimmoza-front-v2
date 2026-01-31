// src/spaces/promoteur/pages/Dashboard.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

// ======================================================
// Dashboard Promoteur — V1.1
// - Pilotage d'études (Study)
// - Stockage local (localStorage) - persistance synchrone
// - Fil rouge : Nouvelle étude -> Foncier avec ?study=<id>
// ======================================================

type StepStatus = "empty" | "in_progress" | "done";
type StudyStep = "foncier" | "plu" | "marche" | "risques" | "bilan" | "synthese" | "dashboard";
type GlobalDecision = "GO" | "ARBITRAGE" | "NO_GO";

type StepsStatus = {
  foncier: StepStatus;
  plu: StepStatus;
  marche: StepStatus;
  risques: StepStatus;
  bilan: StepStatus;
};

type StudyListItem = {
  id: string;
  name: string;

  created_at: string;
  updated_at: string;

  commune_name?: string;
  department_code?: string;
  commune_insee?: string;

  parcel_count: number;
  total_surface_m2: number;

  steps_status: StepsStatus;

  global_decision?: GlobalDecision | null;
  global_score?: number | null;

  last_opened_step: StudyStep;
};

const LS_STUDIES = "mimmoza.promoteur.studies.v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function formatDateFR(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function formatDateTimeFR(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * ✅ Génère un ID d'étude unique et stable
 * Format: study_<timestamp>_<random>
 */
function generateStudyId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `study_${timestamp}_${random}`;
}

function defaultSteps(): StepsStatus {
  return { foncier: "empty", plu: "empty", marche: "empty", risques: "empty", bilan: "empty" };
}

function countDoneSteps(s: StepsStatus) {
  return Object.values(s).filter((v) => v === "done").length;
}

function decisionLabel(decision?: GlobalDecision | null) {
  if (!decision) return "—";
  if (decision === "GO") return "🟢 GO";
  if (decision === "ARBITRAGE") return "🟠 À arbitrer";
  return "🔴 NO GO";
}

function statusGlyph(status: StepStatus) {
  if (status === "done") return "✓";
  if (status === "in_progress") return "⏳";
  return "—";
}

function routeForStep(step: StudyStep) {
  switch (step) {
    case "foncier":
      return "/promoteur/foncier";
    case "plu":
      return "/promoteur/plu-faisabilite";
    case "marche":
      return "/promoteur/marche";
    case "risques":
      return "/promoteur/risques";
    case "bilan":
      return "/promoteur/bilan";
    case "synthese":
      return "/promoteur/synthese";
    case "dashboard":
    default:
      return "/promoteur";
  }
}

/**
 * ✅ Lit les études depuis localStorage (synchrone)
 */
function loadStudiesFromStorage(): StudyListItem[] {
  try {
    const raw = localStorage.getItem(LS_STUDIES);
    const parsed = safeParse<StudyListItem[]>(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * ✅ Écrit les études dans localStorage (synchrone)
 */
function saveStudiesToStorage(studies: StudyListItem[]): boolean {
  try {
    localStorage.setItem(LS_STUDIES, JSON.stringify(studies));
    return true;
  } catch (e) {
    console.error("[Dashboard] saveStudiesToStorage failed:", e);
    return false;
  }
}

export default function Dashboard(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [studies, setStudies] = useState<StudyListItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // ---- Load on mount
  useEffect(() => {
    const loaded = loadStudiesFromStorage();
    setStudies(loaded);
    setIsLoaded(true);
    console.log("[Dashboard] Loaded studies:", loaded.length);
  }, []);

  // ---- Persist when studies change (backup, mais pas principal)
  useEffect(() => {
    // Ne pas sauvegarder avant le chargement initial
    if (!isLoaded) return;
    
    try {
      localStorage.setItem(LS_STUDIES, JSON.stringify(studies));
    } catch {
      // ignore
    }
  }, [studies, isLoaded]);

  const sortedStudies = useMemo(() => {
    return [...studies].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  }, [studies]);

  /**
   * ✅ Créer une nouvelle étude
   * - Génère un ID unique
   * - Crée l'entrée dans localStorage AVANT navigation
   * - Navigue vers Foncier avec ?study=<id>
   */
  const createStudy = useCallback(() => {
    const id = generateStudyId();
    const created = nowIso();

    const study: StudyListItem = {
      id,
      name: `Nouvelle étude — ${formatDateTimeFR(created)}`,
      created_at: created,
      updated_at: created,

      commune_name: undefined,
      department_code: undefined,
      commune_insee: undefined,

      parcel_count: 0,
      total_surface_m2: 0,

      steps_status: defaultSteps(),

      global_decision: null,
      global_score: null,

      last_opened_step: "foncier",
    };

    // ✅ IMPORTANT: Sauvegarder SYNCHRONEMENT avant navigation
    const currentStudies = loadStudiesFromStorage();
    const updatedStudies = [study, ...currentStudies];
    const saveSuccess = saveStudiesToStorage(updatedStudies);

    if (!saveSuccess) {
      console.error("[Dashboard] Failed to save new study to localStorage");
      // On continue quand même car l'étude sera créée par Foncier si nécessaire
    } else {
      console.log("[Dashboard] Created study:", id);
    }

    // Mettre à jour le state local
    setStudies(updatedStudies);

    // Fil rouge : on démarre sur Foncier avec un studyId
    navigate(`/promoteur/foncier?study=${encodeURIComponent(id)}`);
  }, [navigate]);

  /**
   * ✅ Ouvrir une étude existante
   */
  const openStudy = useCallback(
    (study: StudyListItem) => {
      const step = study.last_opened_step || "foncier";
      const base = routeForStep(step);
      
      // ✅ Mettre à jour updated_at et last_opened_step
      const currentStudies = loadStudiesFromStorage();
      const idx = currentStudies.findIndex((s) => s.id === study.id);
      if (idx >= 0) {
        currentStudies[idx] = {
          ...currentStudies[idx],
          updated_at: nowIso(),
        };
        saveStudiesToStorage(currentStudies);
        setStudies(currentStudies);
      }
      
      navigate(`${base}?study=${encodeURIComponent(study.id)}`);
    },
    [navigate]
  );

  /**
   * ✅ Supprimer une étude
   */
  const deleteStudy = useCallback((studyId: string) => {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer cette étude ?")) {
      return;
    }

    const currentStudies = loadStudiesFromStorage();
    const updatedStudies = currentStudies.filter((s) => s.id !== studyId);
    saveStudiesToStorage(updatedStudies);
    setStudies(updatedStudies);

    // Nettoyer les données de sélection terrain associées
    try {
      localStorage.removeItem(`mimmoza.promoteur.terrain_selection.v1.${studyId}`);
      localStorage.removeItem(`mimmoza.promoteur.selected_parcels_v1.${studyId}`);
    } catch {
      // ignore
    }

    console.log("[Dashboard] Deleted study:", studyId);
  }, []);

  const shareStudy = useCallback((study: StudyListItem) => {
    // placeholder V1
    // plus tard : création lien + gestion d'équipe
    window.alert("Partage bientôt disponible (V1 placeholder).");
    console.log("[dashboard] share study", study.id);
  }, []);

  const exportStudy = useCallback((study: StudyListItem) => {
    // placeholder V1
    // plus tard : dossier banque/IC (PDF / JSON dossier)
    window.alert("Export bientôt disponible (V1 placeholder).");
    console.log("[dashboard] export study", study.id);
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h2 style={{ margin: "0 0 6px", color: "#0f172a" }}>Tableau de bord</h2>
          <p style={{ margin: 0, color: "#475569" }}>
            Centralisez, analysez et partagez vos études immobilières.
          </p>
        </div>

        <button
          onClick={createStudy}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #0f172a",
            background: "#0f172a",
            color: "white",
            fontWeight: 800,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          ➕ Nouvelle étude
        </button>
      </div>

      {/* Section */}
      <div style={{ marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <h3 style={{ margin: 0, color: "#0f172a" }}>
            Mes études {sortedStudies.length > 0 ? `(${sortedStudies.length})` : ""}
          </h3>
        </div>

        {/* Loading state */}
        {!isLoaded && (
          <div
            style={{
              marginTop: 12,
              border: "1px solid #e2e8f0",
              borderRadius: 16,
              padding: 18,
              background: "#ffffff",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 14, color: "#64748b" }}>Chargement des études...</div>
          </div>
        )}

        {/* Empty state */}
        {isLoaded && sortedStudies.length === 0 && (
          <div
            style={{
              marginTop: 12,
              border: "1px solid #e2e8f0",
              borderRadius: 16,
              padding: 18,
              background: "#ffffff",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a" }}>Aucune étude pour le moment</div>
            <div style={{ marginTop: 6, color: "#475569" }}>
              Lancez votre première analyse foncière et suivez l'étude de bout en bout.
            </div>

            <div style={{ marginTop: 14 }}>
              <button
                onClick={createStudy}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid #0f172a",
                  background: "#0f172a",
                  color: "white",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                ➕ Nouvelle étude
              </button>
            </div>
          </div>
        )}

        {/* Grid */}
        {isLoaded && sortedStudies.length > 0 && (
          <div
            style={{
              marginTop: 12,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
              gap: 14,
            }}
          >
            {sortedStudies.map((s) => {
              const doneCount = countDoneSteps(s.steps_status);
              const showDecision = doneCount >= 2;

              return (
                <div
                  key={s.id}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 16,
                    padding: 14,
                    background: "#ffffff",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {/* Identity */}
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a" }}>{s.name}</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>
                      {(s.commune_name ? `${s.commune_name}${s.department_code ? ` (${s.department_code})` : ""}` : "Localisation —")}
                      {" · "}
                      Créée le {formatDateFR(s.created_at)}
                      {" · "}
                      Maj {formatDateFR(s.updated_at)}
                    </div>
                  </div>

                  {/* Foncier */}
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12 }}>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 900, textTransform: "uppercase" }}>
                      📍 Foncier
                    </div>
                    <div style={{ marginTop: 8, color: "#0f172a", fontWeight: 800 }}>
                      Parcelles : {s.parcel_count || 0}
                    </div>
                    <div style={{ marginTop: 4, color: "#0f172a", fontWeight: 800 }}>
                      Surface : {Math.round(s.total_surface_m2 || 0).toLocaleString("fr-FR")} m²
                    </div>
                  </div>

                  {/* Progress */}
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12 }}>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 900, textTransform: "uppercase" }}>
                      État de l'étude
                    </div>
                    <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 13 }}>
                      <div style={{ color: "#0f172a", fontWeight: 700 }}>
                        {statusGlyph(s.steps_status.foncier)} Foncier
                      </div>
                      <div style={{ color: "#0f172a", fontWeight: 700 }}>
                        {statusGlyph(s.steps_status.plu)} PLU & Faisabilité
                      </div>
                      <div style={{ color: "#0f172a", fontWeight: 700 }}>
                        {statusGlyph(s.steps_status.marche)} Marché
                      </div>
                      <div style={{ color: "#0f172a", fontWeight: 700 }}>
                        {statusGlyph(s.steps_status.risques)} Risques
                      </div>
                      <div style={{ color: "#0f172a", fontWeight: 700 }}>
                        {statusGlyph(s.steps_status.bilan)} Bilan
                      </div>
                    </div>
                  </div>

                  {/* Decision */}
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12 }}>
                    <div style={{ fontSize: 11, color: "#64748b", fontWeight: 900, textTransform: "uppercase" }}>
                      Décision
                    </div>
                    <div style={{ marginTop: 8, fontSize: 14, fontWeight: 900, color: "#0f172a" }}>
                      {showDecision ? decisionLabel(s.global_decision ?? null) : "—"}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: "#475569", fontWeight: 700 }}>
                      Score global : {showDecision && typeof s.global_score === "number" ? `${Math.round(s.global_score)} / 100` : "—"}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button
                      onClick={() => openStudy(s)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid #0f172a",
                        background: "#0f172a",
                        color: "white",
                        fontWeight: 900,
                        cursor: "pointer",
                        flex: "1 1 auto",
                      }}
                    >
                      Ouvrir
                    </button>

                    <button
                      onClick={() => shareStudy(s)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid #e2e8f0",
                        background: "white",
                        color: "#0f172a",
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      Partager
                    </button>

                    <button
                      onClick={() => exportStudy(s)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid #e2e8f0",
                        background: "white",
                        color: "#0f172a",
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      Exporter
                    </button>

                    <button
                      onClick={() => deleteStudy(s.id)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid #fecaca",
                        background: "#fef2f2",
                        color: "#dc2626",
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                      title="Supprimer cette étude"
                    >
                      🗑️
                    </button>
                  </div>

                  {/* Debug micro footer (optionnel) */}
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    ID: {s.id}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}