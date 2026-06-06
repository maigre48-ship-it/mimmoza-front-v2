// src/spaces/rehabilitation/RehabilitationLayout.tsx

import { Outlet, useLocation } from "react-router-dom";
import { useCopilotPageSync } from "../copilot/hooks/useCopilotPageSync";

export default function RehabilitationLayout() {
  const { pathname } = useLocation();

  // Sync vertical 'promoteur' + pageContext → active copilot context
  // Efface automatiquement le contexte listing/investisseur stale si on vient
  // d'un autre espace (évite SmartScore "Indisponible" sur les pages rehab)
  useCopilotPageSync(pathname, "promoteur");

  return <Outlet />;
}