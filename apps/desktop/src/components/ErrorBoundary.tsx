import { Button, EmptyState, ICONS, Nyu } from '@uwusuite/design';
import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches a crash in one part of the window and shows Nyu instead of a black window. `reset`
 * changes (for a tab: its folder) clear the error, so moving on is enough to recover.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; reset?: unknown; compact?: boolean },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UwUFiles:', error, info.componentStack);
  }

  componentDidUpdate(prev: { reset?: unknown }) {
    if (this.state.error && prev.reset !== this.props.reset) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <EmptyState
        className="flex-1"
        compact={this.props.compact}
        art={<Nyu shell="box" mood="sad" size={150} />}
        title="Hier ist etwas schiefgegangen"
        body={
          <>
            Das tut Nyu leid. Der Fehler war:
            <span className="selectable mt-2 block font-mono text-caption break-words">
              {this.state.error.message}
            </span>
          </>
        }
        action={
          <Button icon={ICONS.refresh} onClick={() => this.setState({ error: null })}>
            Nochmal versuchen
          </Button>
        }
      />
    );
  }
}
