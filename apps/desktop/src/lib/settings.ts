/**
 * What UwUFiles remembers between starts, in localStorage under one key. The key is also what
 * `bootScript()` reads in main.tsx, so the first paint is already in the right theme.
 */

import type { ThemeSetting } from '@uwusuite/design';
import { useSyncExternalStore } from 'react';

export const SETTINGS_KEY = 'uwufiles-settings';

export type ViewMode = 'grid' | 'list';
export type SortBy = 'name' | 'size' | 'modified' | 'kind';

export interface Settings {
  theme: ThemeSetting;
  view: ViewMode;
  /** Tile size in the grid view: 0 small, 1 medium, 2 big. */
  zoom: 0 | 1 | 2;
  showHidden: boolean;
  sortBy: SortBy;
  sortAsc: boolean;
  foldersFirst: boolean;
  details: boolean;
  /** Folders pinned to the sidebar under "Favoriten". */
  favorites: string[];
}

const DEFAULTS: Settings = {
  theme: 'system',
  view: 'grid',
  zoom: 1,
  showHidden: false,
  sortBy: 'name',
  sortAsc: true,
  foldersFirst: true,
  details: true,
  favorites: [],
};

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function getSettings() {
  return current;
}

export function setSettings(patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) {
  const next = typeof patch === 'function' ? patch(current) : patch;
  current = { ...current, ...next };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // Private mode or a full disk: the setting still holds for this session.
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSettings,
    getSettings,
  );
}
