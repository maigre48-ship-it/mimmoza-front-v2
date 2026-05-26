// src/spaces/rehabilitation/pages/RenduTravauxPage.tsx
// Wrapper Réhabilitation du rendu travaux IA.
// Le composant source accepte theme + breadcrumb en props → zéro duplication de logique.

import React from "react";
import RenduTravauxSource, {
  type RenduTheme,
} from "../../marchand/pages/RenduTravauxPage";

/* ------------------------------------------------------------------ */
/*  Thème Réhabilitation                                               */
/* ------------------------------------------------------------------ */

const REHAB_THEME: RenduTheme = {
  gradient:    "linear-gradient(90deg, #f97316 0%, #ef4444 100%)",
  accent:      "#f97316",
  accentLight: "#fff7ed",
  accentDark:  "#c2410c",
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

const RenduTravauxPage: React.FC = () => (
  <RenduTravauxSource
    theme={REHAB_THEME}
    breadcrumb="Réhabilitation › Rendu travaux"
  />
);

export default RenduTravauxPage;