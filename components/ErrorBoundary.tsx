import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { GlowingEffect } from './ui/glowing-effect';


// Define the interface for props to include children
interface Props {
  children?: ReactNode;
}

// Define the interface for state
interface State {
  hasError: boolean;
  error: Error | null;
}

// ErrorBoundary class to catch and handle frontend errors gracefully.
class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log the error to an error reporting service
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
      this.setState({ hasError: false, error: null });
      window.location.href = '/'; // Hard reload to clear state
  }

  public render() {
    if (this.state.hasError) {
      // Render a custom fallback UI when an error occurs
      return (
        <div className="min-h-screen w-full bg-zinc-950 flex flex-col items-center justify-center p-4 text-center">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-md w-full shadow-2xl flex flex-col items-center">
                <div className="w-16 h-16 bg-red-900/20 text-red-500 rounded-full flex items-center justify-center mb-4 border border-red-500/20">
                    <AlertTriangle size={32} />
                </div>
                <h1 className="text-xl font-bold text-white mb-2">Bir Sorun Oluştu</h1>
                <p className="text-zinc-400 text-sm mb-6">
                    Sistem beklenmeyen bir veri durumuyla karşılaştı. Bu genellikle veritabanı bağlantısı veya eksik veriden kaynaklanır.
                </p>
                
                <div className="bg-black/30 p-3 rounded-lg border border-zinc-800 w-full mb-6 text-left overflow-hidden">
                    <p className="text-[10px] text-red-400 font-mono break-all">
                        {this.state.error?.message || 'Unknown Error'}
                    </p>
                </div>

                <button 
                    onClick={this.handleReset}
                    className="flex items-center gap-2 px-6 py-3 bg-white text-black hover:bg-zinc-200 font-bold rounded-xl transition-colors w-full justify-center"
                >
                    <RefreshCw size={18} /> Sistemi Yenile
                </button>
            </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;