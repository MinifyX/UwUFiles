import { invoke } from '@tauri-apps/api/core';

/** Opens a web page in the default browser (Rust side, so the page needs no opener permission). */
export function openUrl(url: string) {
  return invoke('open_url', { url }).catch(() => {});
}
