// src/spaces/promoteur/shared/StudyError.tsx

import React from "react";
import { AlertTriangle } from "lucide-react";

const ACCENT_PRO = "#5247b8";

interface StudyErrorProps {
  studyId?: string | null;
}

export function StudyError({ studyId }: StudyErrorProps) {
  return (
    <div
      style={{
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        minHeight:      300,
        fontFamily:     "'Inter', -apple-system, sans-serif",
        padding:        40,
        textAlign:      "center",
      }}
    >
      <AlertTriangle size={40} color="#f59e0b" />
      <p style={{ color: "#64748b", marginTop: 16, fontSize: 14, margin: "16px 0 0" }}>
        Impossible de charger l'étude{studyId ? ` (${studyId.slice(0, 8)}…)` : ""}.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          gap:            8,
          marginTop:      20,
          padding:        "10px 20px",
          borderRadius:   10,
          border:         "none",
          fontSize:       13,
          fontWeight:     600,
          cursor:         "pointer",
          background:     ACCENT_PRO,
          color:          "white",
        }}
      >
        Réessayer
      </button>
    </div>
  );
}

export default StudyError;