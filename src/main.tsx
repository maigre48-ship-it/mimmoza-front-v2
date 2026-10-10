import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { bootCurrentUserIdSync } from "./lib/auth/currentUser";
import "./index.css";

// Pose le user_id de facon synchrone des le boot (lecture du token Supabase
// deja present dans localStorage), avant le premier rendu. Le listener
// onAuthStateChange dans AppShell prendra ensuite le relais.
bootCurrentUserIdSync();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");
createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
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