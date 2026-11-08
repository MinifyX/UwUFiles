/**
 * Browser preview: `pnpm --filter @uwufiles/desktop dev` and open http://localhost:1424 in a
 * normal browser. Without Tauri there is no Rust side, so this answers the commands with a
 * small made-up home folder. Only loaded in dev builds outside the app (main.tsx).
 */

import { mockConvertFileSrc, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import type { Entry, Kind } from './api';

const HOME = '/home/nyu';
const now = Date.now();
const day = 86_400_000;

const tree: Record<string, [string, Kind, number][]> = {
  [HOME]: [
    ['Bilder', 'folder', 3],
    ['Desktop', 'folder', 0],
    ['Dokumente', 'folder', 4],
    ['Downloads', 'folder', 6],
    ['Musik', 'folder', 0],
    ['Projekte', 'folder', 12],
    ['Videos', 'folder', 2],
    ['Bewerbung 2026.pdf', 'document', 482_113],
    ['Einkaufsliste.md', 'text', 1_204],
    ['Haushalt.ods', 'spreadsheet', 28_771],
    ['main.rs', 'code', 3_412],
    ['nyu-hintergrund.svg', 'image', 9_840],
    ['Podcast Folge 7.mp3', 'audio', 41_220_118],
    ['Urlaub Lissabon.mp4', 'video', 812_334_002],
    ['backup-2026-10.tar.zst', 'archive', 2_140_998_400],
    ['notizen.txt', 'text', 312],
  ],
};

let n = 0;
function entries(dir: string, showHidden: boolean): Entry[] {
  const list = tree[dir] ?? [];
  const out: Entry[] = list.map(([name, kind, size]) => ({
    name,
    path: `${dir}/${name}`,
    isDir: kind === 'folder',
    isSymlink: false,
    hidden: false,
    size,
    modified: now - (n++ % 9) * day * 0.7,
    kind,
  }));
  if (showHidden) {
    out.push({
      name: '.config',
      path: `${dir}/.config`,
      isDir: true,
      isSymlink: false,
      hidden: true,
      size: 40,
      modified: now,
      kind: 'folder',
    });
  }
  return out;
}

export function installMock() {
  mockWindows('main');
  mockConvertFileSrc('linux');
  mockIPC((cmd, args) => {
    const a = args as Record<string, unknown>;
    switch (cmd) {
      case 'initial_path':
        return { path: HOME, explicit: false };
      case 'trash_list':
        return [
          {
            id: '1',
            name: 'alte Notizen.txt',
            originalPath: `${HOME}/Dokumente/alte Notizen.txt`,
            deleted: now - 3_600_000,
            kind: 'text',
          },
          {
            id: '2',
            name: 'Screenshot 2026-11-01.png',
            originalPath: `${HOME}/Bilder/Screenshot 2026-11-01.png`,
            deleted: now - 2 * day,
            kind: 'image',
          },
        ];
      case 'conflicts':
        return [];
      case 'apps_for':
        return [
          { id: 'org.kde.kate.desktop', name: 'Kate', icon: null, default: true },
          { id: 'uwunotes.desktop', name: 'UwUNotes', icon: null, default: false },
        ];
      case 'check_update':
        return null;
      case 'sidebar':
        return {
          places: [
            { name: 'Persönlicher Ordner', path: HOME, icon: 'home' },
            { name: 'Desktop', path: `${HOME}/Desktop`, icon: 'desktop' },
            { name: 'Dokumente', path: `${HOME}/Dokumente`, icon: 'documents' },
            { name: 'Downloads', path: `${HOME}/Downloads`, icon: 'downloads' },
            { name: 'Bilder', path: `${HOME}/Bilder`, icon: 'pictures' },
            { name: 'Musik', path: `${HOME}/Musik`, icon: 'music' },
            { name: 'Videos', path: `${HOME}/Videos`, icon: 'videos' },
          ],
          drives: [
            { name: 'System', path: '/', totalBytes: 1e12, freeBytes: 4.2e11, removable: false },
            {
              name: 'Extern2TB',
              path: '/run/media/nyu/Extern2TB',
              totalBytes: 2e12,
              freeBytes: 1.5e11,
              removable: true,
            },
          ],
          trash: true,
        };
      case 'list_dir':
        return entries(a.path as string, a.showHidden as boolean);
      case 'entry_info':
        return {
          name: (a.path as string).split('/').pop() || '/',
          path: a.path,
          isDir: true,
          isSymlink: false,
          hidden: false,
          size: 16,
          modified: now,
          kind: 'folder',
        };
      case 'tree_size':
        return 3_456_789_012;
      case 'plugin:window|is_maximized':
        return false;
      default:
        return null;
    }
  });
}
