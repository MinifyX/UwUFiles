import './styles.css';

import { applyAppearance, QUERIES, resolveAppearance } from '@uwusuite/design';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getSettings } from './lib/settings';

// Theme, contrast and motion onto <html> before React draws anything, so a dark
// window never flashes white. `useAppearance()` in App keeps it in sync after.
const matches = (q: string) => window.matchMedia(q).matches;
applyAppearance(
  resolveAppearance(getSettings(), {
    dark: matches(QUERIES.dark),
    contrast: matches(QUERIES.contrast),
    reducedMotion: matches(QUERIES.reducedMotion),
  }),
);

// The webview's own menu (Reload, Inspect) is no use in a file manager; ours replaces it.
if (!import.meta.env.DEV) {
  window.addEventListener('contextmenu', (e) => e.preventDefault());
}

// Opened in a plain browser during development: answer the Rust commands with sample data.
if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window && (window as any).__TAURI_INTERNALS__.metadata)) {
  (await import('./lib/mock')).installMock();
}

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
