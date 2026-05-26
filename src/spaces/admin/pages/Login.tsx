// src/spaces/admin/pages/Login.tsx
// Redirige vers /connexion (ConnexionPage) — plus vers /login qui n'existe pas.
import { Navigate } from "react-router-dom";

export default function AdminLoginPage() {
  return <Navigate to="/connexion" replace />;
}