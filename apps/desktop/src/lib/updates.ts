/**
 * Updates. The Rust side asks the feed on GitHub (signed with the key in tauri.conf.json); this
 * says so in a toast. An AppImage installs the update with one click, a copy from pacman or apt
 * only gets the hint, because the package manager owns it.
 */

import type { ToastStore } from '@uwusuite/design';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from './links';

interface UpdateInfo {
  version: string;
  notes: string | null;
  canInstall: boolean;
}

const RELEASES = 'https://github.com/MinifyX/UwUFiles/releases/latest';

/** `asked`: the user pressed the button, so "no update" and errors are worth a word too. */
export async function checkForUpdate(toasts: ToastStore, asked: boolean) {
  let update: UpdateInfo | null;
  try {
    update = await invoke<UpdateInfo | null>('check_update');
  } catch (e) {
    if (asked) toasts.show(`Nach Updates suchen ging nicht: ${String(e)}`, { tone: 'error' });
    return;
  }
  if (!update) {
    if (asked) toasts.show('UwUFiles ist auf dem neuesten Stand (◕‿◕✿)', { tone: 'success' });
    return;
  }
  if (update.canInstall) {
    toasts.show(`UwUFiles ${update.version} ist da`, {
      action: {
        label: 'Jetzt aktualisieren',
        run: () => {
          toasts.show('Update wird geladen …');
          invoke('install_update').catch((e) => toasts.show(String(e), { tone: 'error' }));
        },
      },
    });
  } else {
    toasts.show(
      `UwUFiles ${update.version} ist da – dein Paketmanager holt es mit dem nächsten Update`,
      {
        action: { label: 'Was ist neu?', run: () => openUrl(RELEASES) },
      },
    );
  }
}
