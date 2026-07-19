// src/components/billing/RequirePlan.tsx
//
// Garde de route : si le plan courant n'inclut pas le module visé, redirige
// vers l'upsell Pro+ (/abonnement?plan=proplus). Sinon, laisse passer.
// Usage : <Route element={<RequirePlan><Outlet /></RequirePlan>}> …
// ou     <Route element={<RequirePlan />}> … (rend un <Outlet /> par défaut)

import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { usePlanAccess } from "@/lib/billing/usePlanAccess";

export function RequirePlan({ children }: { children?: ReactNode }) {
  const location = useLocation();
  const { canAccessPath } = usePlanAccess();

  if (canAccessPath(location.pathname)) {
    return children ? <>{children}</> : <Outlet />;
  }

  const from = encodeURIComponent(location.pathname + location.search);
  return <Navigate to={`/abonnement?plan=proplus&from=${from}`} replace />;
}

export default RequirePlan;