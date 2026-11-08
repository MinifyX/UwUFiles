/**
 * One tab: a folder with its history, what is selected in it, the search, the right-click menu
 * and the keyboard. Every tab stays mounted while it is in the background, so switching back
 * keeps the scroll position and the selection; only the active one listens to keys and watches
 * its folder.
 */

import { Button, EmptyState, Icon, IconButton, ICONS, Nyu } from '@uwusuite/design';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from 'react';
import { api, errorText, onDirChanged, TRASH, type Entry, type TransferMode } from '../lib/api';
import { formatBytes, formatCount, parentOf, rootFor } from '../lib/format';
import { setSettings, type Settings } from '../lib/settings';
import type { Shell } from '../lib/shell';
import { ContextMenu, type ContextItem } from './ContextMenu';
import { Details } from './Details';
import { NameDialog, type NameQuestion } from './Dialogs';
import { ErrorBoundary } from './ErrorBoundary';
import { FileView, type Modifiers } from './FileView';
import { Toolbar } from './Toolbar';
import { TrashView } from './TrashView';

export const DRAG_TYPE = 'application/x-uwufiles-paths';

export interface NavRequest {
  path: string;
  /** Changes with every request, so asking for the same folder twice still goes there. */
  n: number;
}

interface Props {
  active: boolean;
  initialPath: string;
  nav: NavRequest | null;
  onPath: (path: string) => void;
  shell: Shell;
}

export function Pane({ active, initialPath, nav, onPath, shell }: Props) {
  const { settings, toasts } = shell;
  const [path, setPath] = useState(initialPath);
  const [back, setBack] = useState<string[]>([]);
  const [forward, setForward] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [folder, setFolder] = useState<Entry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<NameQuestion>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry | null } | null>(null);
  const [focusPath, setFocusPath] = useState(0);
  const [focusSearch, setFocusSearch] = useState(0);
  /** After a rename, paste or "new folder", the path to select once the folder has reloaded. */
  const selectAfterLoad = useRef<string | null>(null);
  const inTrash = path === TRASH;

  const fail = useCallback((e: unknown) => toasts.show(errorText(e), { tone: 'error' }), [toasts]);

  // ---- loading ---------------------------------------------------------------------------

  const load = useCallback(
    async (dir: string, keepSelection = false) => {
      if (dir === TRASH) return;
      setLoading(true);
      try {
        const [list, info] = await Promise.all([
          api.listDir(dir, settings.showHidden),
          api.entryInfo(dir).catch(() => null),
        ]);
        setEntries(list);
        setFolder(info);
        setLoadError(null);
        const wanted = selectAfterLoad.current;
        selectAfterLoad.current = null;
        if (wanted && list.some((e) => e.path === wanted)) {
          setSelection(new Set([wanted]));
          anchor.current = wanted;
          scrollTo(wanted);
        } else if (keepSelection) {
          const present = new Set(list.map((e) => e.path));
          setSelection((s) => new Set([...s].filter((p) => present.has(p))));
        }
      } catch (e) {
        setEntries([]);
        setLoadError(errorText(e));
      } finally {
        setLoading(false);
      }
    },
    [settings.showHidden],
  );

  const navigate = useCallback((to: string, how: 'push' | 'back' | 'forward' = 'push') => {
    setPath((from) => {
      if (from !== to) {
        if (how === 'push') {
          setBack((b) => [...b, from]);
          setForward([]);
        } else if (how === 'back') {
          setForward((f) => [from, ...f]);
        } else {
          setBack((b) => [...b, from]);
        }
      }
      return to;
    });
    setQuery('');
    setRenaming(null);
    setMenu(null);
    if (!selectAfterLoad.current) setSelection(new Set());
  }, []);

  // The sidebar, the path bar of another app, "open in this tab": App asks, the tab goes.
  useEffect(() => {
    if (nav) navigate(nav.path);
  }, [nav, navigate]);

  useEffect(() => {
    onPath(path);
    load(path);
  }, [path, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only the tab in front watches its folder; coming to the front looks again.
  useEffect(() => {
    if (!active || inTrash) return;
    api.watchDir(path).catch(() => {});
    load(path, true);
    let timer: number | undefined;
    const unlisten = onDirChanged((changed) => {
      if (changed !== path) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => load(changed, true), 150);
    });
    return () => {
      window.clearTimeout(timer);
      unlisten.then((u) => u());
    };
  }, [active, path, inTrash, load]);

  // A copy, move or trash in another tab may have changed this folder too.
  useEffect(() => {
    if (shell.changed) load(path, true);
  }, [shell.changed]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- what is shown ---------------------------------------------------------------------

  const shown = useMemo(() => sortAndFilter(entries, settings, query), [entries, settings, query]);
  const selected = useMemo(() => shown.filter((e) => selection.has(e.path)), [shown, selection]);
  const cut = useMemo(
    () => new Set(shell.clipboard?.mode === 'move' ? shell.clipboard.paths : []),
    [shell.clipboard],
  );
  const drive = useMemo(
    () =>
      shell.sidebar
        ? [...shell.sidebar.drives]
            .sort((a, b) => b.path.length - a.path.length)
            .find((d) => path.startsWith(d.path))
        : undefined,
    [path, shell.sidebar],
  );

  // ---- actions ---------------------------------------------------------------------------

  const open = useCallback(
    (entry: Entry) => {
      if (entry.isDir) navigate(entry.path);
      else api.openPath(entry.path).catch(fail);
    },
    [navigate, fail],
  );

  const select = (p: string, mods: Modifiers) => {
    if (mods.shift && anchor.current) {
      const from = shown.findIndex((e) => e.path === anchor.current);
      const to = shown.findIndex((e) => e.path === p);
      if (from >= 0 && to >= 0) {
        const range = shown.slice(Math.min(from, to), Math.max(from, to) + 1).map((e) => e.path);
        setSelection((s) => new Set(mods.ctrl ? [...s, ...range] : range));
        return;
      }
    }
    anchor.current = p;
    if (mods.ctrl) {
      setSelection((s) => {
        const next = new Set(s);
        if (next.has(p)) next.delete(p);
        else next.add(p);
        return next;
      });
    } else {
      setSelection(new Set([p]));
    }
  };

  const transfer = async (sources: string[], dest: string, mode: TransferMode) => {
    const made = await shell.transfer(sources, dest, mode);
    if (made?.[0] && dest === path) {
      selectAfterLoad.current = made[0];
      load(path);
    }
  };

  const copy = (mode: TransferMode, paths = [...selection]) => {
    if (paths.length === 0) return;
    shell.setClipboard({ mode, paths });
    toasts.show(
      `${formatCount(paths.length, 'Element', 'Elemente')} ${mode === 'copy' ? 'kopiert' : 'ausgeschnitten'} – mit Strg+V einfügen`,
    );
  };

  const paste = (dest = path) => {
    const clip = shell.clipboard;
    if (!clip || dest === TRASH) return;
    if (clip.mode === 'move') shell.setClipboard(null);
    transfer(clip.paths, dest, clip.mode);
  };

  const trash = async (paths = [...selection]) => {
    if (paths.length === 0) return;
    if (await shell.trash(paths)) setSelection(new Set());
  };

  const rename = async (entry: Entry, name: string) => {
    setRenaming(null);
    try {
      selectAfterLoad.current = await api.rename(entry.path, name);
      load(path);
    } catch (e) {
      fail(e);
    }
  };

  const createNamed = async (kind: 'folder' | 'file', name: string) => {
    try {
      const made = await (kind === 'folder'
        ? api.createDir(path, name)
        : api.createFile(path, name));
      setNameDialog(null);
      selectAfterLoad.current = made;
      load(path);
    } catch (e) {
      fail(e);
    }
  };

  const toggleFavorite = (p: string) =>
    setSettings((s) => ({
      favorites: s.favorites.includes(p) ? s.favorites.filter((f) => f !== p) : [...s.favorites, p],
    }));

  const dropPaths = (dest: string, e: DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw || dest === TRASH) return;
    const sources = (JSON.parse(raw) as string[]).filter((s) => s !== dest && parentOf(s) !== dest);
    transfer(sources, dest, e.ctrlKey ? 'copy' : 'move');
  };

  const dragStart = (entry: Entry, e: DragEvent) => {
    const paths = selection.has(entry.path) ? [...selection] : [entry.path];
    if (!selection.has(entry.path)) setSelection(new Set([entry.path]));
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
    e.dataTransfer.setData('text/plain', paths.join('\n'));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  // A network share's folder is as high as it goes: above it is kio-fuse's or gvfs' plumbing.
  const upOf = (p: string) => (rootFor(p)?.path === p ? null : parentOf(p));
  const goUp = () => {
    const up = upOf(path);
    if (up && !inTrash) {
      selectAfterLoad.current = path;
      navigate(up);
    }
  };
  const goBack = () => {
    const to = back[back.length - 1];
    if (!to) return;
    setBack((b) => b.slice(0, -1));
    navigate(to, 'back');
  };
  const goForward = () => {
    const to = forward[0];
    if (!to) return;
    setForward((f) => f.slice(1));
    navigate(to, 'forward');
  };

  // ---- keyboard and mouse buttons --------------------------------------------------------

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (!active || document.querySelector('dialog[open]')) return;
    const typing = (e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]');
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (ctrl && k === 'l') return stop(e, () => setFocusPath((n) => n + 1));
    if (ctrl && k === 'f') return stop(e, () => setFocusSearch((n) => n + 1));
    if (e.key === 'F5') return stop(e, () => load(path, true));
    if (e.altKey && e.key === 'ArrowLeft') return stop(e, goBack);
    if (e.altKey && e.key === 'ArrowRight') return stop(e, goForward);
    if (e.altKey && e.key === 'ArrowUp') return stop(e, goUp);
    if (typing || nameDialog || menu || inTrash) return;

    if (ctrl && k === 'h')
      return stop(e, () => setSettings((s) => ({ showHidden: !s.showHidden })));
    if (ctrl && k === 'a') return stop(e, () => setSelection(new Set(shown.map((x) => x.path))));
    if (ctrl && k === 'c') return stop(e, () => copy('copy'));
    if (ctrl && k === 'x') return stop(e, () => copy('move'));
    if (ctrl && k === 'v') return stop(e, () => paste());
    if (ctrl && e.shiftKey && k === 'n') return stop(e, () => setNameDialog({ kind: 'folder' }));
    if (ctrl && (k === '+' || k === '='))
      return stop(e, () =>
        setSettings((s) => ({ zoom: Math.min(2, s.zoom + 1) as Settings['zoom'] })),
      );
    if (ctrl && k === '-')
      return stop(e, () =>
        setSettings((s) => ({ zoom: Math.max(0, s.zoom - 1) as Settings['zoom'] })),
      );
    if (e.key === 'F11') return stop(e, () => setSettings((s) => ({ details: !s.details })));
    if (e.key === 'Delete') return stop(e, () => trash());
    if (e.key === 'F2' && selected.length === 1)
      return stop(e, () => setRenaming(selected[0]!.path));
    if (e.key === 'Backspace') return stop(e, goBack);
    if (e.key === 'Enter' && selected.length === 1) {
      const entry = selected[0]!;
      return stop(e, () => (ctrl && entry.isDir ? shell.newTab(entry.path) : open(entry)));
    }
    if (e.key === 'Escape') return stop(e, () => setSelection(new Set()));

    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      return stop(e, () => moveCursor(e.key, e.shiftKey));
    }
    // Typing a letter jumps to the first name that starts with it.
    if (e.key.length === 1 && !ctrl && !e.altKey) {
      const hit = shown.find((x) => x.name.toLowerCase().startsWith(k));
      if (hit) select(hit.path, { ctrl: false, shift: false });
      scrollTo(hit?.path);
    }
  };

  const moveCursor = (key: string, extend: boolean) => {
    if (shown.length === 0) return;
    const current = shown.findIndex((x) => x.path === (anchor.current ?? ''));
    let columns = 1;
    if (settings.view === 'grid') {
      const tiles = [
        ...document.querySelectorAll<HTMLElement>('[data-pane-active="true"] .file-tile'),
      ];
      const top = tiles[0]?.offsetTop;
      const firstNextRow = tiles.findIndex((t) => t.offsetTop !== top);
      columns = firstNextRow > 0 ? firstNextRow : tiles.length;
    }
    const sideways = key === 'ArrowLeft' || key === 'ArrowRight';
    const step = { ArrowDown: columns, ArrowUp: -columns, ArrowRight: 1, ArrowLeft: -1 }[key] ?? 0;
    const next =
      key === 'Home'
        ? 0
        : key === 'End'
          ? shown.length - 1
          : current < 0
            ? 0
            : Math.min(
                shown.length - 1,
                Math.max(0, current + (settings.view === 'list' && sideways ? 0 : step)),
              );
    const target = shown[next]!.path;
    const keep = anchor.current;
    select(target, { ctrl: false, shift: extend });
    anchor.current = extend ? keep : target;
    scrollTo(target);
  };

  const goBackRef = useRef(goBack);
  const goForwardRef = useRef(goForward);
  goBackRef.current = goBack;
  goForwardRef.current = goForward;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current(e);
    const mouse = (e: globalThis.MouseEvent) => {
      if (!activeRef.current) return;
      // The mouse's back and forward buttons.
      if (e.button === 3) goBackRef.current();
      if (e.button === 4) goForwardRef.current();
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('mouseup', mouse);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('mouseup', mouse);
    };
  }, []);

  // ---- the right-click menu --------------------------------------------------------------

  const openMenu = (e: MouseEvent, entry: Entry | null) => {
    if (entry && !selection.has(entry.path)) {
      setSelection(new Set([entry.path]));
      anchor.current = entry.path;
    }
    if (!entry) setSelection(new Set());
    setMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const favorite = (p: string): ContextItem => ({
    label: settings.favorites.includes(p) ? 'Aus den Favoriten entfernen' : 'Zu den Favoriten',
    icon: ICONS.favorite,
    onSelect: () => toggleFavorite(p),
  });

  const menuItems = (entry: Entry | null): (ContextItem | 'separator')[] => {
    if (!entry) {
      return [
        {
          label: 'Neuer Ordner',
          icon: ICONS.newFolder,
          shortcut: 'Strg+Umschalt+N',
          onSelect: () => setNameDialog({ kind: 'folder' }),
        },
        {
          label: 'Neue Datei',
          icon: ICONS.newFile,
          onSelect: () => setNameDialog({ kind: 'file' }),
        },
        'separator',
        {
          label: 'Einfügen',
          icon: ICONS.copy,
          shortcut: 'Strg+V',
          disabled: !shell.clipboard,
          onSelect: () => paste(),
        },
        'separator',
        {
          label: 'Im Terminal öffnen',
          icon: ICONS.start,
          onSelect: () => api.openTerminal(path).catch(fail),
        },
        favorite(path),
        {
          label: settings.showHidden ? 'Versteckte ausblenden' : 'Versteckte anzeigen',
          icon: settings.showHidden ? ICONS.hide : ICONS.show,
          shortcut: 'Strg+H',
          onSelect: () => setSettings({ showHidden: !settings.showHidden }),
        },
      ];
    }
    const many = selection.size > 1;
    const files = selected.filter((s) => !s.isDir);
    return [
      {
        label: 'Öffnen',
        icon: entry.isDir ? ICONS.folderOpen : ICONS.openExternal,
        shortcut: 'Enter',
        disabled: many,
        onSelect: () => open(entry),
      },
      ...(entry.isDir
        ? [
            {
              label: 'In neuem Tab öffnen',
              icon: ICONS.add,
              shortcut: 'Strg+Enter',
              onSelect: () => selected.filter((s) => s.isDir).forEach((s) => shell.newTab(s.path)),
            },
            {
              label: 'Im Terminal öffnen',
              icon: ICONS.start,
              disabled: many,
              onSelect: () => api.openTerminal(entry.path).catch(fail),
            },
            { ...favorite(entry.path), disabled: many },
          ]
        : [
            {
              label: 'Öffnen mit …',
              icon: ICONS.more,
              disabled: files.length !== selected.length,
              onSelect: () => shell.openWith(selected),
            },
          ]),
      'separator',
      {
        label: 'Ausschneiden',
        icon: ICONS.export,
        shortcut: 'Strg+X',
        onSelect: () => copy('move'),
      },
      { label: 'Kopieren', icon: ICONS.copy, shortcut: 'Strg+C', onSelect: () => copy('copy') },
      ...(entry.isDir && shell.clipboard && !many
        ? [{ label: 'Hinein einfügen', icon: ICONS.download, onSelect: () => paste(entry.path) }]
        : []),
      {
        label: 'Duplizieren',
        icon: ICONS.files,
        onSelect: () => transfer([...selection], path, 'copy'),
      },
      {
        label: 'Umbenennen',
        icon: ICONS.edit,
        shortcut: 'F2',
        disabled: many,
        onSelect: () => setRenaming(entry.path),
      },
      {
        label: 'Pfad kopieren',
        icon: ICONS.link,
        onSelect: () => navigator.clipboard.writeText([...selection].join('\n')),
      },
      'separator',
      {
        label: 'In den Papierkorb',
        icon: ICONS.delete,
        shortcut: 'Entf',
        danger: true,
        onSelect: () => trash(),
      },
    ];
  };

  // ---- drawing ---------------------------------------------------------------------------

  return (
    <div
      data-pane-active={active}
      className={active ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}
    >
      {!inTrash && (
        <Toolbar
          path={path}
          home={shell.home}
          canBack={back.length > 0}
          canForward={forward.length > 0}
          canUp={upOf(path) != null}
          onBack={goBack}
          onForward={goForward}
          onUp={goUp}
          onRefresh={() => load(path, true)}
          onOpen={(p) => navigate(p)}
          onNewFolder={() => setNameDialog({ kind: 'folder' })}
          query={query}
          onQuery={setQuery}
          settings={settings}
          focusPath={focusPath}
          focusSearch={focusSearch}
        />
      )}
      <div className="flex min-h-0 flex-1 border-t border-hairline">
        <ErrorBoundary reset={path}>
          {inTrash ? (
            <TrashView
              active={active}
              confirm={shell.confirm}
              onError={fail}
              onDone={(m) => toasts.show(m, { tone: 'success' })}
              onOpenFolder={(p) => navigate(p)}
            />
          ) : (
            <>
              <div className="flex min-w-0 flex-1 flex-col">
                {loadError ? (
                  <EmptyState
                    className="flex-1"
                    art={<Nyu shell="box" mood="sad" size={150} />}
                    title="Dieser Ordner lässt sich nicht öffnen"
                    body={loadError}
                    action={
                      <Button icon={ICONS.parentFolder} onClick={goUp}>
                        Eine Ebene höher
                      </Button>
                    }
                  />
                ) : shown.length === 0 && !loading ? (
                  <div
                    className="flex flex-1"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openMenu(e, null);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => dropPaths(path, e)}
                  >
                    <EmptyState
                      className="flex-1"
                      art={<Nyu shell="box" mood={query ? 'puzzled' : 'sleepy'} size={150} />}
                      title={query ? `Nichts gefunden für „${query}“` : 'Dieser Ordner ist leer'}
                      body={
                        query
                          ? 'Gesucht wird nur in diesem Ordner.'
                          : 'Zieh Dateien hierher oder leg einen neuen Ordner an.'
                      }
                      action={
                        query ? (
                          <Button onClick={() => setQuery('')}>Suche löschen</Button>
                        ) : (
                          <Button
                            icon={ICONS.newFolder}
                            onClick={() => setNameDialog({ kind: 'folder' })}
                          >
                            Neuer Ordner
                          </Button>
                        )
                      }
                    />
                  </div>
                ) : (
                  <div
                    className="flex min-h-0 flex-1"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => dropPaths(path, e)}
                  >
                    <FileView
                      entries={shown}
                      settings={settings}
                      selection={selection}
                      cut={cut}
                      renaming={renaming}
                      onSelect={select}
                      onSelectMany={(paths) => setSelection(new Set(paths))}
                      onClear={() => setSelection(new Set())}
                      onOpen={open}
                      onOpenInTab={(entry) => shell.newTab(entry.path)}
                      onContext={openMenu}
                      onRename={rename}
                      onRenameCancel={() => setRenaming(null)}
                      onDropOnFolder={dropPaths}
                      onDragStart={dragStart}
                    />
                  </div>
                )}
                <StatusLine
                  count={shown.length}
                  selected={selected}
                  free={drive ? `${formatBytes(drive.freeBytes)} frei` : null}
                  zoom={settings.view === 'grid' ? settings.zoom : null}
                />
              </div>
              {settings.details && (
                <ErrorBoundary reset={selection} compact>
                  <Details
                    selected={selected}
                    folder={folder}
                    count={entries.length}
                    onOpen={open}
                  />
                </ErrorBoundary>
              )}
            </>
          )}
        </ErrorBoundary>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}
      <NameDialog dialog={nameDialog} onClose={() => setNameDialog(null)} onCreate={createNamed} />
    </div>
  );
}

function StatusLine({
  count,
  selected,
  free,
  zoom,
}: {
  count: number;
  selected: Entry[];
  free: string | null;
  zoom: Settings['zoom'] | null;
}) {
  const bytes = selected.filter((e) => !e.isDir).reduce((s, e) => s + (e.size ?? 0), 0);
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-t border-hairline px-4 text-caption text-muted">
      <span>{formatCount(count, 'Element', 'Elemente')}</span>
      {selected.length > 0 && (
        <span className="font-semibold text-pink-ink">
          {formatCount(selected.length, 'ausgewählt', 'ausgewählt')}
          {bytes > 0 && ` · ${formatBytes(bytes)}`}
        </span>
      )}
      <span className="flex-1" />
      {free && (
        <span className="flex items-center gap-1.5">
          <Icon icon={ICONS.drive} size="xs" />
          {free}
        </span>
      )}
      {zoom != null && (
        <span className="flex items-center gap-0.5">
          <IconButton
            size="sm"
            icon={ICONS.zoomOut}
            label="Kleiner (Strg+−)"
            disabled={zoom === 0}
            onClick={() => setSettings({ zoom: (zoom - 1) as Settings['zoom'] })}
          />
          <IconButton
            size="sm"
            icon={ICONS.zoomIn}
            label="Größer (Strg++)"
            disabled={zoom === 2}
            onClick={() => setSettings({ zoom: (zoom + 1) as Settings['zoom'] })}
          />
        </span>
      )}
    </div>
  );
}

function stop(e: KeyboardEvent, run: () => void) {
  e.preventDefault();
  run();
}

function scrollTo(path: string | undefined) {
  if (!path) return;
  requestAnimationFrame(() =>
    document
      .querySelector(`[data-pane-active="true"] [data-path="${CSS.escape(path)}"]`)
      ?.scrollIntoView({ block: 'nearest' }),
  );
}

const KIND_ORDER = [
  'folder',
  'image',
  'video',
  'audio',
  'document',
  'spreadsheet',
  'text',
  'code',
  'archive',
  'other',
];

export function sortAndFilter(entries: Entry[], s: Settings, query: string): Entry[] {
  const q = query.trim().toLowerCase();
  const list = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : [...entries];
  const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  const dir = s.sortAsc ? 1 : -1;
  list.sort((a, b) => {
    if (s.foldersFirst && a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    let c = 0;
    if (s.sortBy === 'size') c = (a.size ?? 0) - (b.size ?? 0);
    else if (s.sortBy === 'modified') c = (a.modified ?? 0) - (b.modified ?? 0);
    else if (s.sortBy === 'kind') c = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    return c * dir || collator.compare(a.name, b.name) * (s.sortBy === 'name' ? dir : 1);
  });
  return list;
}
