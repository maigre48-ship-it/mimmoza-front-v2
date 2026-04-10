// massingConstants.ts
// Constantes partagées entre MassingRenderer et MassingEditor3D.
// Séparé pour respecter la contrainte React Fast Refresh :
// un fichier ne peut pas exporter à la fois des composants React ET des valeurs non-composants.

export const SLOPE_LEGEND = [
  { label: "0–5°",   color: "#47D975", desc: "Plat"      },
  { label: "5–15°",  color: "#F7D12E", desc: "Doux"      },
  { label: "15–25°", color: "#F78C24", desc: "Modéré"    },
  { label: "25–35°", color: "#EB3838", desc: "Fort"      },
  { label: ">35°",   color: "#7B0F0F", desc: "Très fort" },
] as const;