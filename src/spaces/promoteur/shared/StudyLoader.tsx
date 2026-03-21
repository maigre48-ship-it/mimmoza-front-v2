// src/spaces/promoteur/shared/StudyLoader.tsx

import React from "react";
import { Loader2 } from "lucide-react";

const ACCENT_PRO = "#5247b8";

export function StudyLoader() {
  return (
    <div
      style={{
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        minHeight:      300,
        fontFamily:     "'Inter', -apple-system, sans-serif",
      }}
    >
      <Loader2
        size={32}
        color={ACCENT_PRO}
        style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}
      />
      <span style={{ marginLeft: 16, fontSize: 15, color: "#64748b" }}>
        Chargement de l'étude…
      </span>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default StudyLoader;