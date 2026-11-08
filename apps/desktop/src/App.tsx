/**
 * The window: title bar, sidebar, toolbar, the folder, the details panel, the status line.
 *
 * All state that more than one part needs lives here — the folder in view and its history, what
 * is selected, the clipboard, the copy in progress. The parts get it as props and report back.
 */

import {
  Button,
  createToasts,
  detectPlatform,
  Dialog,
  EmptyState,
  Field,
  Icon,
  IconButton,
  ICONS,
  Nyu,
  TextInput,
  TitleBar,
  TitleBarAction,
  Toaster,
  useAppearance,
  Wordmark,
} from '@uwusuite/design';
import { useTauriWindow } from '@uwusuite/design/tauri';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { ContextMenu, type ContextItem } from './components/ContextMenu';
import { Details } from './components/Details';
import { FileView, type Modifiers } from './components/FileView';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import {
  api,
  errorText,
  onDirChanged,
  onOpenFolder,
  onTransferProgress,
  type Entry,
  type Sidebar as SidebarData,
  type TransferMode,
  type TransferProgress,
} from './lib/api';
import { baseName, formatBytes, formatCount, parentOf } from './lib/format';
import { setSettings, useSettings, type Settings } from './lib/settings';

const toasts = createToasts();
const platform = detectPlatform();
const DRAG_TYPE = 'application/x-uwufiles-paths';

interface Clipboard {
  mode: TransferMode;
  paths: string[];
}

type NameDialog = { kind: 'folder' | 'file' } | null;

export function App() {
  const settings = useSettings();
  const appearance = useAppearance({ theme: settings.theme });
  const controls = useTauriWindow();

  const [path, setPath] = useState<string | null>(null);
  const [back, setBack] = useState<string[]>([]);
  const [forward, setForward] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [folder, setFolder] = useState<Entry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sidebar, setSidebar] = useState<SidebarData | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [query, setQuery] = useState('');
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialog>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry | null } | null>(null);
  const [job, setJob] = useState<TransferProgress & { mode: TransferMode } | null>(null);
  const [focusPath, setFocusPath] = useState(0);
  const [focusSearch, setFocusSearch] = useState(0);
  /** After a rename or "new folder", the path to select once the folder has reloaded. */
  const selectAfterLoad = useRef<string | null>(null);

  const home = sidebar?.places[0]?.path ?? null;

  // ---- loading ---------------------------------------------------------------------------

  const load = useCallback(
    async (dir: string, keepSelection = false) => {
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
        if (wanted) {
          setSelection(new Set([wanted]));
          anchor.current = wanted;
          requestAnimationFrame(() =>
            document.querySelector(`[data-path="${CSS.escape(wanted)}"]`)?.scrollIntoView({ block: 'nearest' }),
          );
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

  const navigate = useCallback(
    (to: string, how: 'push' | 'back' | 'forward' | 'replace' = 'push') => {
      setPath((from) => {
        if (from && from !== to) {
          if (how === 'push') {
            setBack((b) => [...b, from]);
            setForward([]);
          } else if (how === 'back') {
            setForward((f) => [from, ...f]);
          } else if (how === 'forward') {
            setBack((b) => [...b, from]);
          }
        }
        return to;
      });
      setQuery('');
      setRenaming(null);
      setMenu(null);
      if (!selectAfterLoad.current) setSelection(new Set());
    },
    [],
  );

  useEffect(() => {
    api.initialPath().then((p) => navigate(p, 'replace'));
    const refreshSidebar = () => api.sidebar().then(setSidebar).catch(() => {});
    refreshSidebar();
    // A USB stick appears or goes away without the window being told: look again every few seconds.
    const timer = window.setInterval(refreshSidebar, 4000);
    const unlisten = onOpenFolder((p) => navigate(p));
    return () => {
      window.clearInterval(timer);
      unlisten.then((u) => u());
    };
  }, [navigate]);

  useEffect(() => {
    if (!path) return;
    load(path);
    api.watchDir(path).catch(() => {});
    getCurrentWindow()
      .setTitle(`${baseName(path)} – UwUFiles`)
      .catch(() => {});
  }, [path, load]);

  // Changes made elsewhere: reload, a little later, once a burst of events has settled.
  useEffect(() => {
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
  }, [path, load]);

  useEffect(() => {
    const unlisten = onTransferProgress((p) => setJob((j) => (j && j.job === p.job ? { ...j, ...p } : j)));
    return () => {
      unlisten.then((u) => u());
    };
  }, []);

  // ---- what is shown ---------------------------------------------------------------------

  const shown = useMemo(() => sortAndFilter(entries, settings, query), [entries, settings, query]);
  const selected = useMemo(() => shown.filter((e) => selection.has(e.path)), [shown, selection]);
  const cut = useMemo(() => new Set(clipboard?.mode === 'move' ? clipboard.paths : []), [clipboard]);
  const drive = useMemo(
    () =>
      path && sidebar
        ? [...sidebar.drives].sort((a, b) => b.path.length - a.path.length).find((d) => path.startsWith(d.path))
        : undefined,
    [path, sidebar],
  );

  // ---- actions ---------------------------------------------------------------------------

  const fail = (e: unknown) => toasts.show(errorText(e), { tone: 'error' });

  const open = useCallback(
    (entry: Entry) => {
      if (entry.isDir) navigate(entry.path);
      else api.openPath(entry.path).catch(fail);
    },
    [navigate],
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

  const runTransfer = async (sources: string[], dest: string, mode: TransferMode) => {
    if (sources.length === 0) return;
    const id = crypto.randomUUID();
    setJob({ job: id, mode, doneBytes: 0, totalBytes: 0, current: baseName(sources[0]!) });
    try {
      const made = await api.transfer(id, sources, dest, mode);
      if (dest === path && made[0]) selectAfterLoad.current = made[0];
      const what = formatCount(sources.length, 'Element', 'Elemente');
      toasts.show(`${what} ${mode === 'copy' ? 'kopiert' : 'verschoben'} nach „${baseName(dest)}“`, {
        tone: 'success',
      });
      if (path) load(path, true);
    } catch (e) {
      fail(e);
    } finally {
      setJob(null);
    }
  };

  const copy = (mode: TransferMode, paths = [...selection]) => {
    if (paths.length === 0) return;
    setClipboard({ mode, paths });
    toasts.show(
      `${formatCount(paths.length, 'Element', 'Elemente')} ${mode === 'copy' ? 'kopiert' : 'ausgeschnitten'} – mit Strg+V einfügen`,
    );
  };

  const paste = (dest = path) => {
    if (!clipboard || !dest) return;
    runTransfer(clipboard.paths, dest, clipboard.mode);
    if (clipboard.mode === 'move') setClipboard(null);
  };

  const trash = async (paths = [...selection]) => {
    if (paths.length === 0) return;
    try {
      await api.trash(paths);
      toasts.show(
        paths.length === 1
          ? `„${baseName(paths[0]!)}“ liegt jetzt im Papierkorb`
          : `${formatCount(paths.length, 'Element', 'Elemente')} liegen jetzt im Papierkorb`,
      );
      setSelection(new Set());
      if (path) load(path, true);
    } catch (e) {
      fail(e);
    }
  };

  const rename = async (entry: Entry, name: string) => {
    setRenaming(null);
    try {
      selectAfterLoad.current = await api.rename(entry.path, name);
      if (path) load(path);
    } catch (e) {
      fail(e);
    }
  };

  const createNamed = async (kind: 'folder' | 'file', name: string) => {
    if (!path) return;
    try {
      const made = await (kind === 'folder' ? api.createDir(path, name) : api.createFile(path, name));
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
    if (!raw) return;
    const sources = (JSON.parse(raw) as string[]).filter((s) => s !== dest && parentOf(s) !== dest);
    runTransfer(sources, dest, e.ctrlKey ? 'copy' : 'move');
  };

  const dragStart = (entry: Entry, e: DragEvent) => {
    const paths = selection.has(entry.path) ? [...selection] : [entry.path];
    if (!selection.has(entry.path)) setSelection(new Set([entry.path]));
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
    e.dataTransfer.setData('text/plain', paths.join('\n'));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const goUp = () => {
    const up = path && parentOf(path);
    if (up) {
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

  // ---- keyboard --------------------------------------------------------------------------

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const typing = (e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]');
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (ctrl && k === 'l') return stop(e, () => setFocusPath((n) => n + 1));
    if (ctrl && k === 'f') return stop(e, () => setFocusSearch((n) => n + 1));
    if (e.key === 'F5') return stop(e, () => path && load(path, true));
    if (e.altKey && e.key === 'ArrowLeft') return stop(e, goBack);
    if (e.altKey && e.key === 'ArrowRight') return stop(e, goForward);
    if (e.altKey && e.key === 'ArrowUp') return stop(e, goUp);
    if (typing || nameDialog || menu) return;

    if (ctrl && k === 'h') return stop(e, () => setSettings((s) => ({ showHidden: !s.showHidden })));
    if (ctrl && k === 'a') return stop(e, () => setSelection(new Set(shown.map((x) => x.path))));
    if (ctrl && k === 'c') return stop(e, () => copy('copy'));
    if (ctrl && k === 'x') return stop(e, () => copy('move'));
    if (ctrl && k === 'v') return stop(e, () => paste());
    if (ctrl && e.shiftKey && k === 'n') return stop(e, () => setNameDialog({ kind: 'folder' }));
    if (ctrl && (k === '+' || k === '=')) return stop(e, () => setSettings((s) => ({ zoom: Math.min(2, s.zoom + 1) as Settings['zoom'] })));
    if (ctrl && k === '-') return stop(e, () => setSettings((s) => ({ zoom: Math.max(0, s.zoom - 1) as Settings['zoom'] })));
    if (e.key === 'F11') return stop(e, () => setSettings((s) => ({ details: !s.details })));
    if (e.key === 'Delete') return stop(e, () => trash());
    if (e.key === 'F2' && selected.length === 1) return stop(e, () => setRenaming(selected[0]!.path));
    if (e.key === 'Backspace') return stop(e, goBack);
    if (e.key === 'Enter' && selected.length === 1) return stop(e, () => open(selected[0]!));
    if (e.key === 'Escape') return stop(e, () => setSelection(new Set()));

    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      stop(e, () => moveCursor(e.key, e.shiftKey));
      return;
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
      const tiles = [...document.querySelectorAll<HTMLElement>('.file-tile')];
      const top = tiles[0]?.offsetTop;
      columns = Math.max(1, tiles.findIndex((t) => t.offsetTop !== top));
      if (columns <= 0 || tiles.every((t) => t.offsetTop === top)) columns = tiles.length;
    }
    const step = { ArrowDown: columns, ArrowUp: -columns, ArrowRight: 1, ArrowLeft: -1 }[key];
    const next =
      key === 'Home'
        ? 0
        : key === 'End'
          ? shown.length - 1
          : current < 0
            ? 0
            : Math.min(shown.length - 1, Math.max(0, current + (settings.view === 'list' && (key === 'ArrowLeft' || key === 'ArrowRight') ? 0 : step ?? 0)));
    const target = shown[next]!.path;
    if (extend) select(target, { ctrl: false, shift: true });
    else select(target, { ctrl: false, shift: false });
    anchor.current = extend ? anchor.current : target;
    scrollTo(target);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current(e);
    const mouse = (e: globalThis.MouseEvent) => {
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
  const goBackRef = useRef(goBack);
  const goForwardRef = useRef(goForward);
  goBackRef.current = goBack;
  goForwardRef.current = goForward;

  // ---- the right-click menu --------------------------------------------------------------

  const openMenu = (e: MouseEvent, entry: Entry | null) => {
    if (entry && !selection.has(entry.path)) {
      setSelection(new Set([entry.path]));
      anchor.current = entry.path;
    }
    if (!entry) setSelection(new Set());
    setMenu({ x: e.clientX, y: e.clientY, entry });
  };

  const menuItems = (entry: Entry | null): (ContextItem | 'separator')[] => {
    if (!entry) {
      return [
        { label: 'Neuer Ordner', icon: ICONS.newFolder, shortcut: 'Strg+Umschalt+N', onSelect: () => setNameDialog({ kind: 'folder' }) },
        { label: 'Neue Datei', icon: ICONS.newFile, onSelect: () => setNameDialog({ kind: 'file' }) },
        'separator',
        { label: 'Einfügen', icon: ICONS.copy, shortcut: 'Strg+V', disabled: !clipboard, onSelect: () => paste() },
        'separator',
        { label: 'Im Terminal öffnen', icon: ICONS.start, onSelect: () => path && api.openTerminal(path).catch(fail) },
        {
          label: path && settings.favorites.includes(path) ? 'Aus den Favoriten entfernen' : 'Zu den Favoriten',
          icon: ICONS.favorite,
          onSelect: () => path && toggleFavorite(path),
        },
        { label: settings.showHidden ? 'Versteckte ausblenden' : 'Versteckte anzeigen', icon: settings.showHidden ? ICONS.hide : ICONS.show, shortcut: 'Strg+H', onSelect: () => setSettings({ showHidden: !settings.showHidden }) },
      ];
    }
    const many = selection.size > 1;
    return [
      { label: 'Öffnen', icon: entry.isDir ? ICONS.folderOpen : ICONS.openExternal, shortcut: 'Enter', disabled: many, onSelect: () => open(entry) },
      ...(entry.isDir
        ? [
            { label: 'Im Terminal öffnen', icon: ICONS.start, disabled: many, onSelect: () => api.openTerminal(entry.path).catch(fail) },
            {
              label: settings.favorites.includes(entry.path) ? 'Aus den Favoriten entfernen' : 'Zu den Favoriten',
              icon: ICONS.favorite,
              disabled: many,
              onSelect: () => toggleFavorite(entry.path),
            },
          ]
        : []),
      'separator',
      { label: 'Ausschneiden', icon: ICONS.export, shortcut: 'Strg+X', onSelect: () => copy('move') },
      { label: 'Kopieren', icon: ICONS.copy, shortcut: 'Strg+C', onSelect: () => copy('copy') },
      ...(entry.isDir && clipboard
        ? [{ label: 'Hinein einfügen', icon: ICONS.download, onSelect: () => paste(entry.path) }]
        : []),
      { label: 'Duplizieren', icon: ICONS.files, onSelect: () => path && runTransfer([...selection], path, 'copy') },
      { label: 'Umbenennen', icon: ICONS.edit, shortcut: 'F2', disabled: many, onSelect: () => setRenaming(entry.path) },
      { label: 'Pfad kopieren', icon: ICONS.link, onSelect: () => navigator.clipboard.writeText([...selection].join('\n')) },
      'separator',
      { label: 'In den Papierkorb', icon: ICONS.delete, shortcut: 'Entf', danger: true, onSelect: () => trash() },
    ];
  };

  // ---- drawing ---------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col bg-canvas">
      <TitleBar
        platform={platform}
        controls={controls}
        brand={<Wordmark product="Files" shell="box" />}
        actions={
          <TitleBarAction
            label={appearance.theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
            onClick={() => setSettings({ theme: appearance.theme === 'dark' ? 'light' : 'dark' })}
          >
            <Icon icon={appearance.theme === 'dark' ? ICONS.lightTheme : ICONS.darkTheme} size="md" />
          </TitleBarAction>
        }
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          data={sidebar}
          favorites={settings.favorites}
          current={path ?? ''}
          onOpen={(p) => navigate(p)}
          onUnpin={toggleFavorite}
          onDropPaths={dropPaths}
        />

        <main className="mr-2 mb-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-hairline bg-surface">
          {path && (
            <Toolbar
              path={path}
              home={home}
              canBack={back.length > 0}
              canForward={forward.length > 0}
              canUp={parentOf(path) != null}
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
                >
                  <EmptyState
                    className="flex-1"
                    art={<Nyu shell="box" mood={query ? 'puzzled' : 'sleepy'} size={150} />}
                    title={query ? `Nichts gefunden für „${query}“` : 'Dieser Ordner ist leer'}
                    body={query ? 'Gesucht wird nur in diesem Ordner.' : 'Zieh Dateien hierher oder leg einen neuen Ordner an.'}
                    action={
                      query ? (
                        <Button onClick={() => setQuery('')}>Suche löschen</Button>
                      ) : (
                        <Button icon={ICONS.newFolder} onClick={() => setNameDialog({ kind: 'folder' })}>
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
                  onDrop={(e) => path && dropPaths(path, e)}
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
            {settings.details && <Details selected={selected} folder={folder} count={entries.length} onOpen={open} />}
          </div>
        </main>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.entry)} onClose={() => setMenu(null)} />}

      <NameDialogView dialog={nameDialog} onClose={() => setNameDialog(null)} onCreate={createNamed} />
      {job && <TransferBar job={job} />}
      <Toaster store={toasts} />
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
      {free && <span>{free}</span>}
      {zoom != null && (
        <span className="flex items-center gap-0.5">
          <IconButton size="sm" icon={ICONS.zoomOut} label="Kleiner (Strg+−)" disabled={zoom === 0} onClick={() => setSettings({ zoom: (zoom - 1) as Settings['zoom'] })} />
          <IconButton size="sm" icon={ICONS.zoomIn} label="Größer (Strg++)" disabled={zoom === 2} onClick={() => setSettings({ zoom: (zoom + 1) as Settings['zoom'] })} />
        </span>
      )}
    </div>
  );
}

function NameDialogView({
  dialog,
  onClose,
  onCreate,
}: {
  dialog: NameDialog;
  onClose: () => void;
  onCreate: (kind: 'folder' | 'file', name: string) => void;
}) {
  const [name, setName] = useState('');
  const fallback = dialog?.kind === 'file' ? 'Neue Datei.txt' : 'Neuer Ordner';
  useEffect(() => {
    if (dialog) setName(fallback);
  }, [dialog, fallback]);
  const submit = () => dialog && name.trim() && onCreate(dialog.kind, name.trim());
  return (
    <Dialog
      open={dialog != null}
      onClose={onClose}
      width="sm"
      title={dialog?.kind === 'file' ? 'Neue Datei' : 'Neuer Ordner'}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>
            Anlegen
          </Button>
        </>
      }
    >
      <Field label="Name">
        {(id, describedBy) => (
          <TextInput
            id={id}
            aria-describedby={describedBy}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => {
              const dot = dialog?.kind === 'file' ? e.target.value.lastIndexOf('.') : -1;
              e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
            }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        )}
      </Field>
    </Dialog>
  );
}

function TransferBar({ job }: { job: TransferProgress & { mode: TransferMode } }) {
  const share = job.totalBytes > 0 ? job.doneBytes / job.totalBytes : 0;
  return (
    <div
      role="status"
      className="fixed right-5 bottom-5 z-[var(--uwu-z-toast)] flex w-[340px] animate-pop flex-col gap-2 rounded-2xl border border-line bg-surface p-4 shadow-float"
    >
      <div className="flex items-center gap-3">
        <Nyu shell="box" mood="cheer" size={36} />
        <div className="min-w-0 flex-1">
          <p className="text-meta font-semibold">{job.mode === 'copy' ? 'Wird kopiert …' : 'Wird verschoben …'}</p>
          <p className="truncate text-caption text-muted">{job.current}</p>
        </div>
        <span className="text-caption text-muted tabular-nums">{Math.round(share * 100)} %</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-pink-tint">
        <div className="progress-stripes h-full rounded-full transition-[width]" style={{ width: `${Math.max(4, share * 100)}%` }} />
      </div>
      {job.totalBytes > 0 && (
        <p className="text-caption text-faint tabular-nums">
          {formatBytes(job.doneBytes)} von {formatBytes(job.totalBytes)}
        </p>
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
    document.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' }),
  );
}

const KIND_ORDER = ['folder', 'image', 'video', 'audio', 'document', 'spreadsheet', 'text', 'code', 'archive', 'other'];

function sortAndFilter(entries: Entry[], s: Settings, query: string): Entry[] {
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
