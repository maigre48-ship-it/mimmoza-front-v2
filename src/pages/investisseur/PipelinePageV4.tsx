// ============================================================================
// PipelinePage.tsx — Intégration SmartScore V4
// ============================================================================
// Ce fichier montre comment câbler tous les composants dans la page Pipeline
// existante de l'espace Investisseur/Marchand.
//
// À adapter selon ta structure de routes et tes composants existants.
// ============================================================================

import { useState } from "react";
import { useNavigate } from "react-router-dom";

// ─── Composants SmartScore V4 ───────────────────────────────────────────────
import SmartScoreExplainer from "@/components/smartscore/SmartScoreExplainer";
import SmartScoreGauge from "@/components/smartscore/SmartScoreGauge";
import SmartScoreSliders from "@/components/smartscore/SmartScoreSliders";
import SmartScoreComparison from "@/components/smartscore/SmartScoreComparison";
import PipelineAlerts from "@/components/smartscore/PipelineAlerts";

// ─── Hooks ──────────────────────────────────────────────────────────────────
import { useSmartScore } from "@/hooks/useSmartScore";
import {
  useSmartScoreAlerts,
  useUserWeights,
  useSmartScoreComparison,
} from "@/hooks/useSmartScoreHooks";

// ─── Ton store/context existant ─────────────────────────────────────────────
// import { useMarchandSnapshot } from "@/stores/marchandSnapshot.store";
// import { useAuth } from "@/hooks/useAuth";

// ============================================================================
// EXEMPLE : Page Pipeline avec SmartScore V4
// ============================================================================

export default function PipelinePageV4() {
  const navigate = useNavigate();

  // ── Contexte utilisateur (adapter à ton auth) ──
  const userId = "user-uuid"; // useAuth().user?.id
  const space = "investisseur" as const;

  // ── Deal sélectionné dans le pipeline ──
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<{
    id: string;
    label: string;
    parcelId?: string;
    communeInsee?: string;
    lat?: number;
    lon?: number;
    projectNature?: string;
  } | null>(null);

  // ── Sous-onglet actif ──
  const [activeSubTab, setActiveSubTab] = useState<
    "pipeline" | "smartscore" | "compare"
  >("pipeline");

  // ── SmartScore du deal sélectionné ──
  const {
    data: smartScoreData,
    loading: scoreLoading,
    error: scoreError,
    pillarEntries,
    recalculateWithWeights,
  } = useSmartScore({
    mode: "market_study",
    parcelId: selectedDeal?.parcelId,
    communeInsee: selectedDeal?.communeInsee,
    lat: selectedDeal?.lat,
    lon: selectedDeal?.lon,
    projectNature: selectedDeal?.projectNature ?? "logement",
    enabled: !!selectedDeal && activeSubTab === "smartscore",
  });

  // ── Poids custom utilisateur ──
  const {
    userWeights,
    save: saveWeights,
  } = useUserWeights(userId, space, selectedDeal?.projectNature ?? "logement");

  // ── Alertes ──
  const {
    alerts,
    counts: alertCounts,
    markRead,
    dismiss,
  } = useSmartScoreAlerts(userId);

  // ── Comparaison multi-sites ──
  const {
    sites: comparisonSites,
    allLoaded: comparisonLoaded,
    addSite,
    removeSite,
    clearAll: clearComparison,
  } = useSmartScoreComparison(selectedDeal?.projectNature ?? "logement");

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px" }}>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* HEADER avec alertes                                              */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0f172a" }}>
            Pipeline
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "#64748b", marginTop: 4 }}>
            Deal flow et statuts — snapshot actif partagé entre toutes les pages Marchand.
          </p>
        </div>

        {/* Badge alertes */}
        <PipelineAlerts
          alerts={alerts}
          onMarkRead={markRead}
          onDismiss={dismiss}
          onNavigate={(route) => navigate(route)}
        />
      </div>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* CARTE EXPLAINER (dépliable)                                       */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <SmartScoreExplainer />

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* SOUS-ONGLETS : Pipeline | SmartScore | Comparer                   */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 20,
          borderBottom: "1px solid #e2e8f0",
          paddingBottom: 0,
        }}
      >
        {(
          [
            { key: "pipeline", label: "🎯 Pipeline", badge: null },
            { key: "smartscore", label: "📊 SmartScore", badge: null },
            {
              key: "compare",
              label: "⚖️ Comparer",
              badge: comparisonSites.length > 0 ? comparisonSites.length : null,
            },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSubTab(tab.key)}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: activeSubTab === tab.key ? 700 : 500,
              color: activeSubTab === tab.key ? "#0ea5e9" : "#64748b",
              background: "none",
              border: "none",
              borderBottom: `2px solid ${
                activeSubTab === tab.key ? "#0ea5e9" : "transparent"
              }`,
              cursor: "pointer",
              position: "relative",
            }}
          >
            {tab.label}
            {tab.badge && (
              <span
                style={{
                  marginLeft: 6,
                  background: "#0ea5e9",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: 8,
                }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* CONTENU DES ONGLETS                                               */}
      {/* ────────────────────────────────────────────────────────────────── */}

      {activeSubTab === "pipeline" && (
        <div>
          {/* ← ICI : ton composant Pipeline/Kanban existant */}
          {/* Les deals du kanban appellent setSelectedDeal() au clic */}
          <p style={{ color: "#94a3b8", fontSize: 13 }}>
            (Ton composant Kanban existant ici — au clic sur un deal,
            basculer vers l'onglet SmartScore)
          </p>
        </div>
      )}

      {activeSubTab === "smartscore" && (
        <div>
          {!selectedDeal ? (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "#94a3b8",
                fontSize: 14,
                background: "#fafbfc",
                borderRadius: 12,
                border: "1px dashed #e2e8f0",
              }}
            >
              Sélectionne un deal dans le Pipeline pour voir son SmartScore.
            </div>
          ) : scoreLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
              Analyse en cours…
            </div>
          ) : scoreError ? (
            <div style={{ padding: 20, color: "#ef4444", fontSize: 13 }}>
              Erreur : {scoreError}
            </div>
          ) : smartScoreData ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "300px 1fr",
                gap: 20,
                alignItems: "start",
              }}
            >
              {/* Colonne gauche : Jauge + Benchmark */}
              <div
                style={{
                  background: "#fff",
                  borderRadius: 14,
                  border: "1px solid #e2e8f0",
                  padding: 24,
                }}
              >
                <SmartScoreGauge
                  score={smartScoreData.score}
                  verdict={smartScoreData.verdict}
                  pillars={pillarEntries}
                  benchmark={smartScoreData.benchmark}
                  size="lg"
                />

                {/* Bouton ajouter à la comparaison */}
                <button
                  onClick={() =>
                    addSite({
                      id: selectedDeal.id,
                      label: selectedDeal.label,
                      parcelId: selectedDeal.parcelId,
                      communeInsee: selectedDeal.communeInsee,
                      lat: selectedDeal.lat,
                      lon: selectedDeal.lon,
                    })
                  }
                  disabled={comparisonSites.some((s) => s.id === selectedDeal.id)}
                  style={{
                    width: "100%",
                    marginTop: 16,
                    padding: "8px 0",
                    fontSize: 12,
                    fontWeight: 600,
                    color: comparisonSites.some((s) => s.id === selectedDeal.id)
                      ? "#94a3b8"
                      : "#0ea5e9",
                    background: comparisonSites.some((s) => s.id === selectedDeal.id)
                      ? "#f1f5f9"
                      : "#f0f9ff",
                    border: "1px solid #bae6fd",
                    borderRadius: 8,
                    cursor: comparisonSites.some((s) => s.id === selectedDeal.id)
                      ? "default"
                      : "pointer",
                  }}
                >
                  {comparisonSites.some((s) => s.id === selectedDeal.id)
                    ? "✓ Ajouté à la comparaison"
                    : "⚖️ Ajouter à la comparaison"}
                </button>
              </div>

              {/* Colonne droite : Sliders */}
              <SmartScoreSliders
                pillarScores={smartScoreData.pillarScores}
                defaultWeights={smartScoreData.activeWeights}
                initialUserWeights={userWeights}
                onWeightsChange={(_weights, _newScore) => {
                  // Le composant recalcule en interne, rien à faire ici
                }}
                onSave={(weights, label) => saveWeights(weights, label)}
              />
            </div>
          ) : null}
        </div>
      )}

      {activeSubTab === "compare" && (
        <div>
          {comparisonSites.length < 2 ? (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "#94a3b8",
                fontSize: 14,
                background: "#fafbfc",
                borderRadius: 12,
                border: "1px dashed #e2e8f0",
              }}
            >
              <p>Ajoute au moins 2 deals depuis l'onglet SmartScore pour comparer.</p>
              <p style={{ fontSize: 12, marginTop: 8 }}>
                {comparisonSites.length}/5 sites ajoutés
              </p>
            </div>
          ) : !comparisonLoaded ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
              Chargement des analyses…
            </div>
          ) : (
            <>
              <SmartScoreComparison
                sites={comparisonSites.map((s) => ({
                  id: s.id,
                  label: s.label,
                  score: s.score,
                  pillarScores: s.pillarScores,
                  metrics: s.metrics,
                }))}
              />
              <div style={{ marginTop: 12, textAlign: "right" }}>
                <button
                  onClick={clearComparison}
                  style={{
                    fontSize: 12,
                    color: "#94a3b8",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Vider la comparaison
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}