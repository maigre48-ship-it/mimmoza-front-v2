import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Isolate a failed visual without interrupting the stream or clearing the store. */
export class CopilotRenderBoundary extends Component<{
  children: ReactNode;
  fallback?: ReactNode;
  label: string;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep diagnostic information local; never log API outputs or conversation text.
    console.error(`[Mimmoza] Affichage indisponible : ${this.props.label}`, error.name, error.message, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback ?? <div role="status" style={{ padding: 12, margin: '8px 0', borderRadius: 8, background: '#fff7ed', color: '#9a3412' }}>
      <p>{this.props.label} : affichage temporairement indisponible. La réponse continue ci-dessous.</p>
      <button type="button" onClick={() => this.setState({ failed: false })}>Réessayer l’affichage</button>
    </div>;
  }
}
