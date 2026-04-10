// src/spaces/promoteur/plan2d/components/PlanToolbar.tsx
//
// V1.1 — Toolbar fonctionnelle
//
// AVANT : composant purement décoratif, boutons sans onClick.
// APRÈS :
//   • Reçoit `editor` en prop → lit et change `activeTool`
//   • Bouton actif mis en évidence (fond violet, texte blanc)
//   • Raccourci clavier Suppr/Backspace → supprime l'élément sélectionné
//   • Prop `onGenerate3D` optionnelle pour le bouton "Générer 3D"
//   • Tooltip sous chaque bouton (title HTML)

import React, { useEffect } from "react";
import type { usePlanEditor } from "../store/usePlanEditor";
import type { ActiveTool } from "../store/usePlanEditor";

// ── Types ──────────────────────────────────────────────────────────────────────

type PlanEditorHook = ReturnType<typeof usePlanEditor>;

interface PlanToolbarProps {
  editor: PlanEditorHook;
  onGenerate3D?: () => void;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const baseBtn: React.CSSProperties = {
  padding:      "7px 14px",
  borderRadius: 10,
  border:       "1px solid #cbd5e1",
  background:   "white",
  color:        "#0f172a",
  fontSize:     13,
  fontWeight:   500,
  cursor:       "pointer",
  transition:   "background 0.12s, color 0.12s, border-color 0.12s",
  userSelect:   "none",
};

const activeBtn: React.CSSProperties = {
  ...baseBtn,
  background:  "#7c6fcd",
  color:       "white",
  borderColor: "#5b4fa8",
  fontWeight:  700,
};

const actionBtn: React.CSSProperties = {
  ...baseBtn,
  background:  "#f1f5f9",
  color:       "#475569",
  borderColor: "#e2e8f0",
};

// ── Config des outils ─────────────────────────────────────────────────────────

const TOOLS: { tool: ActiveTool; label: string; title: string }[] = [
  { tool: "select",   label: "Sélection", title: "Sélectionner / déplacer un élément" },
  { tool: "building", label: "Bâtiment",  title: "Dessiner un bâtiment (clic-glisser)" },
  { tool: "parking",  label: "Parking",   title: "Dessiner une zone de parking (clic-glisser)" },
  { tool: "cotes",    label: "Cotes",     title: "Afficher les cotes (bientôt disponible)" },
];

// ── Composant ─────────────────────────────────────────────────────────────────

const PlanToolbar: React.FC<PlanToolbarProps> = ({ editor, onGenerate3D }) => {

  // Raccourcis clavier globaux
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Suppr / Backspace → supprime la sélection (sauf si focus sur un input)
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        editor.deleteSelected();
      }
      // Raccourcis outils
      if (e.key === "v" || e.key === "Escape") editor.setActiveTool("select");
      if (e.key === "b") editor.setActiveTool("building");
      if (e.key === "p") editor.setActiveTool("parking");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  return (
    <div
      style={{
        height:       64,
        background:   "white",
        borderBottom: "1px solid #e2e8f0",
        display:      "flex",
        alignItems:   "center",
        padding:      "0 16px",
        gap:          8,
        flexShrink:   0,
      }}
    >
      <strong style={{ marginRight: 8, fontSize: 14, color: "#0f172a" }}>Plan 2D</strong>

      {/* Boutons d'outils */}
      {TOOLS.map(({ tool, label, title }) => (
        <button
          key={tool}
          title={title}
          style={editor.activeTool === tool ? activeBtn : baseBtn}
          onClick={() => {
            editor.setActiveTool(tool);
            console.debug(`[PlanToolbar] outil → ${tool}`);
          }}
        >
          {label}
        </button>
      ))}

      {/* Indicateur de l'élément sélectionné */}
      {editor.selected && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4, padding: "4px 10px", borderRadius: 8, background: "#f1f5f9", border: "1px solid #e2e8f0" }}>
          <span style={{ fontSize: 12, color: "#64748b" }}>
            {editor.selected.kind === "building" ? "🏗" : "🅿"}&nbsp;
            {editor.selected.kind === "building" ? "Bâtiment" : "Parking"} sélectionné
          </span>
          <button
            onClick={() => editor.deleteSelected()}
            title="Supprimer (Suppr)"
            style={{ padding: "2px 7px", borderRadius: 6, border: "1px solid #fecaca", background: "#fef2f2", color: "#dc2626", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Aide contextuelle selon l'outil */}
      {editor.activeTool !== "select" && !editor.selected && (
        <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic", marginLeft: 4 }}>
          {editor.activeTool === "building" && "Cliquez-glissez sur la parcelle pour dessiner un bâtiment"}
          {editor.activeTool === "parking"  && "Cliquez-glissez sur la parcelle pour dessiner un parking"}
          {editor.activeTool === "cotes"    && "Cotes — bientôt disponible"}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Générer 3D */}
      <button
        style={actionBtn}
        onClick={() => {
          console.debug("[PlanToolbar] Générer 3D");
          onGenerate3D?.();
        }}
        title="Générer le massing 3D depuis ce plan"
      >
        Générer 3D
      </button>
    </div>
  );
};

export default PlanToolbar;