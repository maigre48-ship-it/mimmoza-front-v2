// src/spaces/promoteur/components/PromoteurStudyRequired.tsx
//
// Guard React Router layout : rendu <Outlet /> si une étude est active,
// sinon écran "Aucune étude active" avec CTA vers le Dashboard.
//
// Usage dans App.tsx :
//   <Route element={<PromoteurStudyRequired />}>
//     <Route path="implantation-2d" element={<Implantation2DPage />} />
//     <Route path="massing-3d"      element={<PromoteurMassing3D />} />
//     ...
//   </Route>

import React from "react";
import { Outlet, useNavigate, useSearchParams } from "react-router-dom";
import { getActiveStudyId } from "../shared/promoteurSnapshot.store";

const GRAD_PRO = "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)";
const ACCENT_PRO = "#5247b8";

export default function PromoteurStudyRequired(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // On accepte aussi un ?study= passé directement dans l'URL
  // (ex: lien partagé ou navigation depuis AppShell avec query string conservé)
  const studyParam = searchParams.get("study");
  const activeStudyId = getActiveStudyId() ?? studyParam;

  if (!activeStudyId) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "60vh",
          gap: 28,
          padding: "40px 24px",
        }}
      >
        {/* Icône */}
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 22,
            background: GRAD_PRO,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
            boxShadow: "0 8px 24px rgba(124,111,205,0.25)",
          }}
        >
          📋
        </div>

        {/* Texte */}
        <div style={{ textAlign: "center", maxWidth: 380 }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "#2a1f6e",
              marginBottom: 10,
            }}
          >
            Aucune étude active
          </div>
          <div style={{ fontSize: 14, color: "#8a7ec8", lineHeight: 1.6 }}>
            Créez ou ouvrez une étude depuis le tableau de bord pour accéder à
            cette section.
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={() => navigate("/promoteur")}
          style={{
            padding: "11px 24px",
            borderRadius: 11,
            border: "none",
            background: GRAD_PRO,
            color: "white",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(124,111,205,0.3)",
          }}
        >
          ← Retour au tableau de bord
        </button>
      </div>
    );
  }

  return <Outlet />;
}