// src/components/PrivateRoute.tsx
// Guard de route — redirige vers "/" si l'utilisateur n'est pas connecté.
// Compatible avec le mock auth localStorage existant (mimmoza.user.logged).
// À remplacer par un vrai check Supabase session quand l'auth sera branchée.

import { Navigate, Outlet, useLocation } from "react-router-dom";

function isLoggedIn(): boolean {
  try {
    const raw = localStorage.getItem("mimmoza.user");
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { logged?: boolean };
    return parsed.logged === true;
  } catch {
    return false;
  }
}

/**
 * Utilisez en enveloppant une route dans App.tsx :
 *
 *   <Route element={<PrivateRoute />}>
 *     <Route path="/dashboard" element={<DashboardHomePage />} />
 *   </Route>
 */
export function PrivateRoute() {
  const location = useLocation();

  if (!isLoggedIn()) {
    // Conserve la destination dans le state pour rediriger après connexion
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  return <Outlet />;
}