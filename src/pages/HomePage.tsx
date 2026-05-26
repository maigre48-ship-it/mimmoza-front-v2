// src/pages/HomePage.tsx
// ── Ce fichier est conservé intentionnellement ──
// L'ancienne page d'accueil a été déplacée dans DashboardHomePage.tsx
// et est désormais servie sur /dashboard (utilisateurs connectés).
// La route "/" affiche ConnexionPage (espace compte public).
//
// Ce composant n'est plus utilisé dans App.tsx mais reste ici pour :
//   - éviter de casser d'éventuelles références dynamiques
//   - servir de repère historique dans le dépôt
//
// Si vous en avez besoin quelque part, importez DashboardHomePage à la place.

import { Navigate } from "react-router-dom";

/**
 * @deprecated — Utilisez DashboardHomePage à la place.
 * Redirige vers "/" par sécurité si jamais le composant est monté.
 */
export default function HomePage() {
  return <Navigate to="/" replace />;
}