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