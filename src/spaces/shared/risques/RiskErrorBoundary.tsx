// src/spaces/shared/risques/RiskErrorBoundary.tsx
// ============================================================================
// SOCLE PARTAGÉ — GARDE-FOU DE RENDU                        VERSION 1.0.0
// ============================================================================
// Exemplaire unique de l'ErrorBoundary qui était recopié verbatim dans
// RisquesPage et InvestisseurRisquesPanel. Rien ne le distinguait d'un fichier
// à l'autre : c'était de la duplication pure, et deux endroits où corriger un
// jour la même chose.
// ============================================================================

import { AlertTriangle } from "lucide-react";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface RiskErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface RiskErrorBoundaryProps {
  children: ReactNode;
  componentName?: string;
}

export class RiskErrorBoundary extends Component<RiskErrorBoundaryProps, RiskErrorBoundaryState> {
  constructor(props: RiskErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): Partial<RiskErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`RiskErrorBoundary caught error in ${this.props.componentName}:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "40px", textAlign: "center", background: "#fef2f2",
          borderRadius: "12px", border: "1px solid #fecaca", margin: "20px",
        }}>
          <AlertTriangle size={48} color="#dc2626" style={{ marginBottom: "16px" }} />
          <h3 style={{ color: "#991b1b", marginBottom: "8px" }}>
            Erreur dans {this.props.componentName || "un composant"}
          </h3>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: "10px 20px", background: "#dc2626", color: "white",
              border: "none", borderRadius: "8px", cursor: "pointer",
            }}
          >
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
