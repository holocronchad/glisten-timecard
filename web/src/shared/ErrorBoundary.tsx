import { Component, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw } from 'lucide-react';

type Props = { children: ReactNode };

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Render crash:', error, info.componentStack);
  }

  reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="bg-noise min-h-[100dvh] flex items-center justify-center px-6">
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.7 }}
          className="text-center max-w-[480px]"
        >
          <p className="text-creamSoft/40 text-xs tracking-[0.25em] uppercase">
            Something went wrong
          </p>
          <h1 className="mt-3 text-[44px] sm:text-[56px] leading-[1.05] tracking-tight font-light text-creamSoft">
            Sorry, that's <span className="font-serif italic text-cream">on us</span>.
          </h1>
          <p className="mt-3 text-creamSoft/50 text-sm">
            The screen crashed. Reloading usually fixes it; if it keeps
            happening, please tell a manager.
          </p>
          <pre className="mt-4 text-creamSoft/40 text-xs text-left bg-graphite/40 border border-creamSoft/10 rounded-2xl px-4 py-3 overflow-x-auto">
            {String(this.state.error.message ?? this.state.error)}
          </pre>
          <button
            onClick={this.reload}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-cream text-ink px-5 py-2.5 text-sm tracking-tight"
          >
            <RefreshCw size={14} /> Reload
          </button>
        </motion.div>
      </div>
    );
  }
}
