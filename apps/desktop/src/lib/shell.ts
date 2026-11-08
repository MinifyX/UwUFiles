/**
 * What every tab shares with the window: the clipboard, copying and moving (with its questions
 * and progress), the dialogs, the toasts. App makes one and hands it to each Pane.
 */

import type { ToastStore } from '@uwusuite/design';
import type { Entry, Sidebar, TransferMode } from './api';
import type { Settings } from './settings';

export interface Clipboard {
  mode: TransferMode;
  paths: string[];
}

export interface Shell {
  settings: Settings;
  sidebar: Sidebar | null;
  home: string | null;
  clipboard: Clipboard | null;
  setClipboard: (c: Clipboard | null) => void;
  toasts: ToastStore;
  /** Copies or moves, asking about names that are taken. Resolves to the new paths, or null. */
  transfer: (sources: string[], dest: string, mode: TransferMode) => Promise<string[] | null>;
  /** Moves to the trash, asking first if the settings say so. */
  trash: (paths: string[]) => Promise<boolean>;
  confirm: (title: string, body: string, action: string) => Promise<boolean>;
  openWith: (entries: Entry[]) => void;
  newTab: (path: string) => void;
  /** Bumped whenever a copy, move or trash finished, so every tab can look again. */
  changed: number;
}
