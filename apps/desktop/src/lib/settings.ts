/**
 * What UwUFiles remembers between starts, in localStorage under one key. The key is also what
 * `bootScript()` reads in main.tsx, so the first paint is already in the right theme.
 */

import type { Share } from './api';
import type { ContrastSetting, MotionSetting, ThemeSetting } from '@uwusuite/design';
import { useSyncExternalStore } from 'react';

export const SETTINGS_KEY = 'uwufiles-settings';

export type ViewMode = 'grid' | 'list';
export type SortBy = 'name' | 'size' | 'modified' | 'kind';

export interface Settings {
  theme: ThemeSetting;
  contrast: ContrastSetting;
  motion: MotionSetting;
  /** Where a new window starts: the home folder, or the folders open when it was closed. */
  startup: 'home' | 'restore';
  /** The tabs of the last session, for `startup: 'restore'`. */
  lastTabs: string[];
  /** Ask before moving to the trash. */
  confirmTrash: boolean;
  /** Look for a new version on start. */
  checkUpdates: boolean;
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
  /** Network shares in the sidebar under "Netzwerk". Passwords are in the keyring, not here. */
  shares: SavedShare[];
}

export interface SavedShare extends Share {
  id: string;
  /** What the sidebar says: the share's name unless the user named it. */
  label: string;
}

const DEFAULTS: Settings = {
  theme: 'system',
  contrast: 'system',
  motion: 'system',
  startup: 'home',
  lastTabs: [],
  confirmTrash: false,
  checkUpdates: true,
  view: 'grid',
  zoom: 1,
  showHidden: false,
  sortBy: 'name',
  sortAsc: true,
  foldersFirst: true,
  details: true,
  favorites: [],
  shares: [],
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
