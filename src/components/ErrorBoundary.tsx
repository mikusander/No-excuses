import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught unexpected React error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-brand-dark flex flex-col items-center justify-center p-6 text-center select-none">
          <div className="w-16 h-16 rounded-3xl bg-brand-orange/15 border border-brand-orange/30 flex items-center justify-center text-brand-orange mb-4 shadow-xl">
            <AlertTriangle size={32} />
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white mb-2">
            {this.props.fallbackTitle || 'Si è verificato un errore imprevisto'}
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-sm mb-6 leading-relaxed">
            {this.state.error?.message || "L'applicazione ha riscontrato un problema durante il caricamento della schermata."}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand-orange hover:bg-brand-lightOrange text-black font-bold text-sm transition-all active:scale-95 shadow-lg shadow-brand-orange/20 cursor-pointer"
            >
              <RotateCcw size={16} />
              <span>Riprova</span>
            </button>
            <button
              onClick={this.handleGoHome}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/15 text-white font-bold text-sm transition-all active:scale-95 border border-white/15 cursor-pointer"
            >
              <Home size={16} />
              <span>Home</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
