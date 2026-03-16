// src/spaces/promoteur/pages/Dashboard.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

// ── Gradient tokens Promoteur ──────────────────────────────────────
const GRAD_PRO = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
const ACCENT_PRO = "#5247b8";

// ======================================================
// Dashboard Promoteur — V1.1
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

function statusDot(status: StepStatus) {
  return status === "done" ? "done" : status === "in_progress" ? "progress" : "empty";
}

function routeForStep(step: StudyStep) {
  switch (step) {
    case "foncier": return "/promoteur/foncier";
    case "plu": return "/promoteur/plu-faisabilite";
    case "marche": return "/promoteur/marche";
    case "risques": return "/promoteur/risques";
    case "bilan": return "/promoteur/bilan";
    case "synthese": return "/promoteur/synthese";
    default: return "/promoteur";
  }
}

function loadStudiesFromStorage(): StudyListItem[] {
  try {
    const raw = localStorage.getItem(LS_STUDIES);
    const parsed = safeParse<StudyListItem[]>(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveStudiesToStorage(studies: StudyListItem[]): boolean {
  try {
    localStorage.setItem(LS_STUDIES, JSON.stringify(studies));
    return true;
  } catch (e) {
    console.error("[Dashboard] saveStudiesToStorage failed:", e);
    return false;
  }
}

// ── Step progress bar helper ───────────────────────────────────────

const STEP_LABELS: { key: keyof StepsStatus; label: string }[] = [
  { key: "foncier", label: "Foncier" },
  { key: "plu", label: "PLU & Faisabilité" },
  { key: "marche", label: "Marché" },
  { key: "risques", label: "Risques" },
  { key: "bilan", label: "Bilan" },
];

function StepRow({ status, label }: { status: StepStatus; label: string }) {
  const dot = statusDot(status);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
      <div
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          flexShrink: 0,
          background:
            dot === "done"
              ? ACCENT_PRO
              : dot === "progress"
              ? "#b39ddb"
              : "#e0dcf8",
        }}
      />
      <span
        style={{
          color: dot === "done" ? ACCENT_PRO : dot === "progress" ? "#8a7ec8" : "#aaa0d8",
          fontWeight: dot === "done" ? 600 : 400,
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────

export default function Dashboard(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [studies, setStudies] = useState<StudyListItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const loaded = loadStudiesFromStorage();
    setStudies(loaded);
    setIsLoaded(true);
    console.log("[Dashboard] Loaded studies:", loaded.length);
  }, []);

  useEffect(() => {
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

    const currentStudies = loadStudiesFromStorage();
    const updatedStudies = [study, ...currentStudies];
    const saveSuccess = saveStudiesToStorage(updatedStudies);

    if (!saveSuccess) {
      console.error("[Dashboard] Failed to save new study to localStorage");
    } else {
      console.log("[Dashboard] Created study:", id);
    }

    setStudies(updatedStudies);
    navigate(`/promoteur/foncier?study=${encodeURIComponent(id)}`);
  }, [navigate]);

  const openStudy = useCallback(
    (study: StudyListItem) => {
      const step = study.last_opened_step || "foncier";
      const base = routeForStep(step);

      const currentStudies = loadStudiesFromStorage();
      const idx = currentStudies.findIndex((s) => s.id === study.id);
      if (idx >= 0) {
        currentStudies[idx] = { ...currentStudies[idx], updated_at: nowIso() };
        saveStudiesToStorage(currentStudies);
        setStudies(currentStudies);
      }

      navigate(`${base}?study=${encodeURIComponent(study.id)}`);
    },
    [navigate]
  );

  const deleteStudy = useCallback((studyId: string) => {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer cette étude ?")) return;

    const currentStudies = loadStudiesFromStorage();
    const updatedStudies = currentStudies.filter((s) => s.id !== studyId);
    saveStudiesToStorage(updatedStudies);
    setStudies(updatedStudies);

    try {
      localStorage.removeItem(`mimmoza.promoteur.terrain_selection.v1.${studyId}`);
      localStorage.removeItem(`mimmoza.promoteur.selected_parcels_v1.${studyId}`);
    } catch {
      // ignore
    }

    console.log("[Dashboard] Deleted study:", studyId);
  }, []);

  const shareStudy = useCallback((study: StudyListItem) => {
    window.alert("Partage bientôt disponible (V1 placeholder).");
    console.log("[dashboard] share study", study.id);
  }, []);

  const exportStudy = useCallback((study: StudyListItem) => {
    window.alert("Export bientôt disponible (V1 placeholder).");
    console.log("[dashboard] export study", study.id);
  }, []);

  return (
    <div>
      {/* ── Bannière header dégradé ── */}
      <div
        style={{
          background: GRAD_PRO,
          borderRadius: 14,
          padding: "20px 24px",
          marginBottom: 20,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.65)",
              marginBottom: 6,
            }}
          >
            Promoteur › Démarrer
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "white",
              marginBottom: 4,
              lineHeight: 1.2,
            }}
          >
            Tableau de bord
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
            Centralisez, analysez et partagez vos études immobilières.
          </div>
        </div>

        <button
          onClick={createStudy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 18px",
            borderRadius: 10,
            border: "none",
            background: "white",
            color: ACCENT_PRO,
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
            flexShrink: 0,
            marginTop: 4,
          }}
        >
          + Nouvelle étude
        </button>
      </div>

      {/* ── Compteur études ── */}
      {isLoaded && sortedStudies.length > 0 && (
        <div
          style={{
            fontSize: 13,
            color: "#8a7ec8",
            marginBottom: 14,
          }}
        >
          Mes études{" "}
          <strong style={{ color: "#2a1f6e" }}>{sortedStudies.length}</strong>
        </div>
      )}

      {/* ── Loading ── */}
      {!isLoaded && (
        <div
          style={{
            border: "1px solid #ddd8f8",
            borderRadius: 14,
            padding: 18,
            background: "white",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 14, color: "#8a7ec8" }}>Chargement des études...</div>
        </div>
      )}

      {/* ── Empty state ── */}
      {isLoaded && sortedStudies.length === 0 && (
        <div
          style={{
            border: "1px solid #ddd8f8",
            borderRadius: 14,
            padding: 24,
            background: "white",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: "#2a1f6e", marginBottom: 6 }}>
            Aucune étude pour le moment
          </div>
          <div style={{ color: "#8a7ec8", fontSize: 13, marginBottom: 16 }}>
            Lancez votre première analyse foncière et suivez l'étude de bout en bout.
          </div>
          <button
            onClick={createStudy}
            style={{
              padding: "9px 18px",
              borderRadius: 10,
              border: "none",
              background: GRAD_PRO,
              color: "white",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            + Nouvelle étude
          </button>
        </div>
      )}

      {/* ── Grid études ── */}
      {isLoaded && sortedStudies.length > 0 && (
        <div
          style={{
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
                  border: "1px solid #ddd8f8",
                  borderRadius: 14,
                  background: "white",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* Barre dégradée en haut */}
                <div
                  style={{
                    height: 4,
                    background: GRAD_PRO,
                  }}
                />

                {/* En-tête carte */}
                <div
                  style={{
                    padding: "14px 16px 12px",
                    borderBottom: "1px solid #eee8fc",
                    background: "linear-gradient(135deg, #f4f2fe 0%, #faf8ff 100%)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#2a1f6e",
                      marginBottom: 4,
                    }}
                  >
                    {s.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#8a7ec8" }}>
                    {s.commune_name
                      ? `${s.commune_name}${s.department_code ? ` (${s.department_code})` : ""}`
                      : "Localisation —"}
                    {" · "}
                    Créée {formatDateFR(s.created_at)}
                    {" · "}
                    Maj {formatDateFR(s.updated_at)}
                  </div>
                </div>

                {/* Corps */}
                <div
                  style={{
                    padding: "14px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                    flex: 1,
                  }}
                >
                  {/* Foncier */}
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        color: ACCENT_PRO,
                        marginBottom: 8,
                      }}
                    >
                      Foncier
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 20,
                      }}
                    >
                      <div>
                        <div
                          style={{ fontSize: 20, fontWeight: 500, color: "#2a1f6e", lineHeight: 1 }}
                        >
                          {s.parcel_count || 0}
                        </div>
                        <div style={{ fontSize: 11, color: "#8a7ec8", marginTop: 2 }}>
                          Parcelles
                        </div>
                      </div>
                      <div>
                        <div
                          style={{ fontSize: 20, fontWeight: 500, color: "#2a1f6e", lineHeight: 1 }}
                        >
                          {Math.round(s.total_surface_m2 || 0).toLocaleString("fr-FR")} m²
                        </div>
                        <div style={{ fontSize: 11, color: "#8a7ec8", marginTop: 2 }}>
                          Surface
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* État de l'étude */}
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        color: ACCENT_PRO,
                        marginBottom: 8,
                      }}
                    >
                      État de l'étude
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {STEP_LABELS.map(({ key, label }) => (
                        <StepRow
                          key={key}
                          status={s.steps_status[key]}
                          label={label}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Décision */}
                  <div>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        color: ACCENT_PRO,
                        marginBottom: 8,
                      }}
                    >
                      Décision
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#2a1f6e" }}>
                      {showDecision ? decisionLabel(s.global_decision ?? null) : "—"}
                    </div>
                    <div style={{ fontSize: 12, color: "#8a7ec8", marginTop: 3 }}>
                      Score global :{" "}
                      {showDecision && typeof s.global_score === "number"
                        ? `${Math.round(s.global_score)} / 100`
                        : "—"}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div
                  style={{
                    padding: "12px 16px",
                    borderTop: "1px solid #eee8fc",
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    onClick={() => openStudy(s)}
                    style={{
                      flex: "1 1 auto",
                      padding: "8px 12px",
                      borderRadius: 9,
                      border: "none",
                      background: GRAD_PRO,
                      color: "white",
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Ouvrir
                  </button>

                  <button
                    onClick={() => shareStudy(s)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 9,
                      border: "1px solid #ddd8f8",
                      background: "white",
                      color: ACCENT_PRO,
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Partager
                  </button>

                  <button
                    onClick={() => exportStudy(s)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 9,
                      border: "1px solid #ddd8f8",
                      background: "white",
                      color: ACCENT_PRO,
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Exporter
                  </button>

                  <button
                    onClick={() => deleteStudy(s.id)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 9,
                      border: "1px solid #fecaca",
                      background: "#fef2f2",
                      color: "#dc2626",
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                    title="Supprimer cette étude"
                  >
                    🗑️
                  </button>
                </div>

                {/* ID footer */}
                <div
                  style={{
                    padding: "4px 16px 10px",
                    fontSize: 10,
                    color: "#c4baf0",
                  }}
                >
                  ID: {s.id}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}