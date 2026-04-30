// src/spaces/promoteur/pages/PromoteurRenduTravauxPage.tsx
// Wrapper Promoteur — injecte le thème violet dans RenduTravauxPage

import React from "react";
import RenduTravauxPage from "../../marchand/pages/RenduTravauxPage";
import type { RenduTheme } from "../../marchand/pages/RenduTravauxPage";

const promoteurTheme: RenduTheme = {
  gradient:    "linear-gradient(90deg, #7c6fcd 0%, #b39ddb 100%)",
  accent:      "#5247b8",
  accentLight: "#ede9fe",
  accentDark:  "#4338ca",
};

export default function PromoteurRenduTravauxPage() {
  return (
    <RenduTravauxPage
      theme={promoteurTheme}
      breadcrumb="Promoteur › Conception"
    />
  );
}