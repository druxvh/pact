import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

type Props = {
  children: ReactNode;
  /** When this changes (e.g. the route), a previous error is cleared automatically. */
  resetKey?: string;
  /** Shown in the heading, e.g. "Notes". */
  label?: string;
};
type State = { error: Error | null };

/** A lazy chunk that can't be fetched (typically: the extension updated while this tab was open). */
const isChunkError = (e: Error) => /dynamically imported module|importing a module script failed|loading chunk|chunkloaderror|failed to fetch/i.test(e.message);

/**
 * Without this, a single render error (or a failed lazy import) unmounts the whole React tree and
 * leaves a blank page. This keeps the shell alive and offers a way out.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[pact] render error', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkError(error);
    return (
      <div role="alert" className="grid min-h-[50vh] place-items-center p-6">
        <div className="max-w-sm text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-destructive-soft text-destructive-text">
            <AlertTriangle className="size-6" />
          </span>
          <h2 className="text-base font-semibold tracking-tight">
            {stale ? 'pact was updated' : `Something went wrong${this.props.label ? ` in ${this.props.label}` : ''}`}
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            {stale
              ? 'A newer version is available. Reload this tab to pick it up — your data is safe.'
              : 'Your data is safe. You can try again, or reload the tab.'}
          </p>
          {!stale && (
            <pre className="mt-3 max-h-24 overflow-auto rounded-lg border bg-muted/40 p-2 text-left font-mono text-[11px] text-muted-foreground">
              {error.message}
            </pre>
          )}
          <div className="mt-5 flex justify-center gap-2">
            {!stale && (
              <Button variant="outline" onClick={() => this.setState({ error: null })}>
                <RotateCcw /> Try again
              </Button>
            )}
            <Button variant="primary" onClick={() => window.location.reload()}>
              <RefreshCw /> Reload pact
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
