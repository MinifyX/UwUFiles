/**
 * The Rust side, typed. One function per `#[tauri::command]` in `src-tauri/src/lib.rs`; every
 * error arrives as a German sentence (`uwufiles-core`'s `Error`), ready for a toast.
 */

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type Kind =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'document'
  | 'spreadsheet'
  | 'text'
  | 'other';

export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  hidden: boolean;
  /** Bytes for a file, number of items for a folder. */
  size: number | null;
  modified: number | null;
  kind: Kind;
}

export interface Place {
  name: string;
  path: string;
  icon: 'home' | 'desktop' | 'documents' | 'downloads' | 'pictures' | 'music' | 'videos';
}

export interface Drive {
  name: string;
  path: string;
  totalBytes: number;
  freeBytes: number;
  removable: boolean;
}

export type Protocol = 'smb' | 'nfs';

/** One network share. SMB: `share` is its name; NFS: the exported path. */
export interface Share {
  protocol: Protocol;
  host: string;
  share: string;
  user?: string | null;
  domain?: string | null;
}

/** A computer in the network that offers SMB or NFS (found over mDNS). */
export interface Server {
  name: string;
  host: string;
  protocols: Protocol[];
}

export interface Export {
  path: string;
  clients: string[];
}

export interface Connected {
  path: string;
  /** "NFS 4.2", "SMB über KDE", … */
  how: string;
}

/** A share the kernel has mounted. */
export interface Mounted {
  path: string;
  protocol: Protocol;
  source: string;
  version: string | null;
}

export interface Sidebar {
  places: Place[];
  drives: Drive[];
  network: Mounted[];
  trash: boolean;
}

export interface TrashEntry {
  id: string;
  name: string;
  originalPath: string;
  deleted: number;
  kind: Kind;
}

export interface App {
  id: string;
  name: string;
  icon: string | null;
  default: boolean;
}

export type Conflict = 'keepBoth' | 'replace' | 'skip';

export interface TransferProgress {
  job: string;
  doneBytes: number;
  totalBytes: number;
  current: string;
}

export type TransferMode = 'copy' | 'move';

export const api = {
  listDir: (path: string, showHidden: boolean) => invoke<Entry[]>('list_dir', { path, showHidden }),
  entryInfo: (path: string) => invoke<Entry>('entry_info', { path }),
  treeSize: (path: string) => invoke<number>('tree_size', { path }),
  sidebar: () => invoke<Sidebar>('sidebar'),
  initialPath: () => invoke<{ path: string; explicit: boolean }>('initial_path'),
  openPath: (path: string) => invoke<void>('open_path', { path }),
  openTerminal: (path: string) => invoke<void>('open_terminal', { path }),
  createDir: (parent: string, name: string) => invoke<string>('create_dir', { parent, name }),
  createFile: (parent: string, name: string) => invoke<string>('create_file', { parent, name }),
  rename: (path: string, newName: string) => invoke<string>('rename', { path, newName }),
  trash: (paths: string[]) => invoke<void>('trash', { paths }),
  conflicts: (sources: string[], dest: string) => invoke<string[]>('conflicts', { sources, dest }),
  transfer: (
    job: string,
    sources: string[],
    dest: string,
    mode: TransferMode,
    onConflict: Conflict,
  ) => invoke<string[]>('transfer', { job, sources, dest, mode, onConflict }),
  cancelTransfer: (job: string) => invoke<void>('cancel_transfer', { job }),
  trashList: () => invoke<TrashEntry[]>('trash_list'),
  trashRestore: (ids: string[]) => invoke<void>('trash_restore', { ids }),
  trashPurge: (ids: string[]) => invoke<void>('trash_purge', { ids }),
  trashEmpty: () => invoke<void>('trash_empty'),
  appsFor: (path: string) => invoke<App[]>('apps_for', { path }),
  launchApp: (id: string, paths: string[]) => invoke<void>('launch_app', { id, paths }),
  watchDir: (path: string) => invoke<void>('watch_dir', { path }),
  networkDiscover: () => invoke<Server[]>('network_discover'),
  networkExports: (host: string) => invoke<Export[]>('network_exports', { host }),
  networkShares: (
    host: string,
    user: string | null,
    password: string | null,
    domain: string | null,
  ) => invoke<string[]>('network_shares', { host, user, password, domain }),
  networkConnect: (share: Share, password: string | null, remember: boolean) =>
    invoke<Connected>('network_connect', { share, password, remember }),
  networkDisconnect: (path: string) => invoke<void>('network_disconnect', { path }),
  networkForget: (share: Share) => invoke<void>('network_forget', { share }),
};

/** How a mount names its source, to tell whether a saved share is the one mounted there. */
export function mountSource(s: Share) {
  return s.protocol === 'nfs' ? `${s.host}:${s.share}` : `//${s.host}/${s.share}`;
}

export const onDirChanged = (cb: (path: string) => void): Promise<UnlistenFn> =>
  listen<string>('dir:changed', (e) => cb(e.payload));

export const onTransferProgress = (cb: (p: TransferProgress) => void): Promise<UnlistenFn> =>
  listen<TransferProgress>('transfer:progress', (e) => cb(e.payload));

export const onOpenFolder = (cb: (path: string) => void): Promise<UnlistenFn> =>
  listen<string>('open-folder', (e) => cb(e.payload));

/** A picture straight from disk, for previews. */
export const fileUrl = (path: string) => convertFileSrc(path);

/** The trash is not a folder the window lists but a view of its own, under this path. */
export const TRASH = 'trash:///';

/** Whatever came back from `invoke` as a sentence. */
export function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
