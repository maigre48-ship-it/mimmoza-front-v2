import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Isolate a failed visual without interrupting the stream or clearing the store. */
export class CopilotRenderBoundary extends Component<{
  children: ReactNode;
  fallback?: ReactNode;
  label: string;
}, { failed: boolean; moduleFailed: boolean }> {
  state = { failed: false, moduleFailed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ moduleFailed: /dynamically imported module|module script|loading chunk|failed to fetch|MIME/i.test(error.message) });
    // Keep diagnostic information local; never log API outputs or conversation text.
    console.error(`[Mimmoza] Affichage indisponible : ${this.props.label}`, error.name, error.message, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const fallback = this.props.fallback ?? <div role="status" style={{ padding: 12, margin: '8px 0', borderRadius: 8, background: '#fff7ed', color: '#9a3412' }}>
      <p>{this.props.label} : affichage temporairement indisponible. La réponse continue ci-dessous.</p>
      <button type="button" onClick={() => this.setState({ failed: false })}>Réessayer l’affichage</button>
    </div>;
    return <>{fallback}{this.state.moduleFailed && <p role="status">Un fichier d’affichage n’a pas pu être chargé. Une version précédente du site ou une coupure réseau peut en être la cause. Après la fin de la réponse, actualisez la page pour charger la version publiée.</p>}</>;
  }
}
