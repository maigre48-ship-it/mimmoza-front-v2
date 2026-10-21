// src/components/PrivateRoute.tsx
// Garde de route — exige une session Supabase valide (audit du 21/10/2026).
//
// Avant : lecture de localStorage["mimmoza.user"].logged, qu'il suffisait de
// mettre à true depuis la console pour ouvrir tous les espaces.
// Maintenant : getSession() + onAuthStateChange (useSessionSupabase). Pendant
// la vérification, un écran neutre est affiché (pas de flash).
// Sans session : redirection vers /connexion?suite=<page demandée>, la page de
// connexion y ramène après authentification.

import { Navigate, Outlet, useLocation } from "react-router-dom";

import { ChargementGarde } from "@/components/ChargementGarde";
import { useSessionSupabase } from "@/lib/auth/useSessionSupabase";

/**
 * Utilisez en enveloppant des routes dans App.tsx :
 *
 *   <Route element={<PrivateRoute />}>
 *     <Route path="/dashboard" element={<DashboardHomePage />} />
 *   </Route>
 */
export function PrivateRoute() {
  const location = useLocation();
  const { chargement, session } = useSessionSupabase();

  if (chargement) return <ChargementGarde />;

  if (!session) {
    const suite = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/connexion?suite=${suite}`} replace state={{ from: location }} />;
  }

  return <Outlet />;
}
