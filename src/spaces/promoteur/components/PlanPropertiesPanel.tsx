// src/spaces/promoteur/components/PlanPropertiesPanel.tsx

import React from "react";
import { getPolygonBounds } from "../plan2d/plan.geometry";
import type { usePlanEditor } from "../plan2d/store/usePlanEditor";

type PlanEditorHook = ReturnType<typeof usePlanEditor>;

const cardStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  padding: 16,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)",
};

const PlanPropertiesPanel: React.FC<{ editor: PlanEditorHook }> = ({ editor }) => {
  const selectedBuilding = editor.selectedBuilding;
  const selectedParking = editor.selectedParking;

  return (
    <div
      style={{
        height: "100%",
        padding: 16,
        boxSizing: "border-box",
        background: "#f8fafc",
        overflowY: "auto",
      }}
    >
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Projet</h3>

        <div style={{ fontSize: 13, display: "grid", gap: 8 }}>
          <div>
            <strong>Type :</strong> {editor.project.program.buildingKind}
          </div>
          <div>
            <strong>Logements :</strong> {editor.project.program.nbLogements}
          </div>
          <div>
            <strong>Surface moyenne :</strong> {editor.project.program.surfaceMoyLogementM2} m²
          </div>
          <div>
            <strong>Niveaux :</strong> R+{editor.project.floorsSpec.aboveGroundFloors}
          </div>
          <div>
            <strong>Bâtiments :</strong> {editor.project.buildings.length}
          </div>
          <div>
            <strong>Parkings :</strong> {editor.project.parkings.length}
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>Sélection</h3>

        {!editor.selected && (
          <div style={{ fontSize: 13, color: "#64748b" }}>
            Aucun objet sélectionné.
          </div>
        )}

        {selectedBuilding && (() => {
          const b = getPolygonBounds(selectedBuilding.polygon);
          return (
            <div style={{ fontSize: 13, display: "grid", gap: 8 }}>
              <div><strong>Type :</strong> Bâtiment</div>
              <div><strong>ID :</strong> {selectedBuilding.id}</div>
              <div><strong>Usage :</strong> {selectedBuilding.usage}</div>
              <div><strong>Largeur approx. :</strong> {b.width.toFixed(2)}</div>
              <div><strong>Profondeur approx. :</strong> {b.height.toFixed(2)}</div>
              <div><strong>Niveaux :</strong> {selectedBuilding.levels}</div>
              <div><strong>Hauteur RDC :</strong> {selectedBuilding.groundFloorHeightM} m</div>
              <div><strong>Hauteur étage :</strong> {selectedBuilding.typicalFloorHeightM} m</div>
            </div>
          );
        })()}

        {selectedParking && (() => {
          const p = getPolygonBounds(selectedParking.polygon);
          return (
            <div style={{ fontSize: 13, display: "grid", gap: 8 }}>
              <div><strong>Type :</strong> Parking</div>
              <div><strong>ID :</strong> {selectedParking.id}</div>
              <div><strong>Catégorie :</strong> {selectedParking.kind}</div>
              <div><strong>Largeur approx. :</strong> {p.width.toFixed(2)}</div>
              <div><strong>Profondeur approx. :</strong> {p.height.toFixed(2)}</div>
              <div><strong>Places estimées :</strong> {selectedParking.spacesEstimate ?? "—"}</div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default PlanPropertiesPanel;