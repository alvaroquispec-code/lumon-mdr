import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; resetKey?: string }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error(error, info.componentStack); }
  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <section role="alert" className="mx-auto max-w-lg p-8 text-center">
          <h1 className="text-2xl font-semibold">Algo salió mal en esta vista</h1>
          <p className="mt-2 text-slate-300">{this.state.error.message}</p>
          <div className="mt-4 flex justify-center gap-3">
            <button className="rounded bg-teal-700 px-4 py-2" onClick={() => this.setState({ error: null })}>Reintentar</button>
            <a className="rounded border border-slate-500 px-4 py-2" href="/files">Volver al inicio</a>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
