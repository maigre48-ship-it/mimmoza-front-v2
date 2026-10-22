import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { bootCurrentUserIdSync } from "./lib/auth/currentUser";
import { installerSuiviErreurs, signalerErreurReact } from "./lib/monitoring";
import "./index.css";

// Pose le user_id de facon synchrone des le boot (lecture du token Supabase
// deja present dans localStorage), avant le premier rendu. Le listener
// onAuthStateChange dans AppShell prendra ensuite le relais.
bootCurrentUserIdSync();

// Suivi des erreurs (exceptions, promesses rejetées) : jamais bloquant, inactif
// en développement. Voir src/lib/monitoring.
installerSuiviErreurs();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");
createRoot(rootEl, {
  // Erreurs de rendu rattrapées par un ErrorBoundary (dont le filet global) :
  // l'écran de secours s'affiche, et l'erreur est désormais aussi signalée.
  onCaughtError: (erreur, info) => {
    console.error("[Mimmoza] erreur d'affichage :", erreur);
    signalerErreurReact(erreur, info?.componentStack ?? null, true);
  },
  onUncaughtError: (erreur, info) => {
    console.error("[Mimmoza] erreur d'affichage non rattrapée :", erreur);
    signalerErreurReact(erreur, info?.componentStack ?? null, false);
  },
}).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);

// PWA : service worker en production uniquement (en dev il perturberait le HMR).
// Enregistre apres le chargement et sans jamais propager d'erreur : un echec
// ici ne doit pas empecher l'application de demarrer.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Navigation privee, stockage bloque... : l'app fonctionne sans.
    });
  });
}