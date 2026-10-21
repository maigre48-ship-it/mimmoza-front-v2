// src/components/ErrorBoundary.tsx
// Filet de sécurité global (audit du 21/10/2026) : une erreur de rendu
// n'affiche plus une page blanche mais un message et un bouton de rechargement.

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { erreur: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { erreur: null };

  static getDerivedStateFromError(erreur: Error): State {
    return { erreur };
  }

  componentDidCatch(erreur: Error, info: ErrorInfo): void {
    console.error("[Mimmoza] erreur d'affichage non rattrapée :", erreur, info.componentStack);
  }

  render() {
    if (!this.state.erreur) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
          padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", background: "#f8fafc",
        }}
      >
        <div style={{ maxWidth: 480, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 24, padding: 32, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "#0f172a", margin: 0 }}>Un problème est survenu</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#475569", marginTop: 12 }}>
            L'affichage de cette page a rencontré une erreur inattendue. Vos données enregistrées ne sont pas
            perdues. Rechargez la page ; si le problème persiste, écrivez-nous à contact@mimmoza.fr.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: 14, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              Recharger la page
            </button>
            <a
              href="/"
              style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: "10px 18px", fontSize: 14, color: "#334155", textDecoration: "none" }}
            >
              Retour à l'accueil
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
