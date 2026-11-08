/**
 * The window: title bar with the tabs, sidebar, the tabs themselves (`Pane`), and everything
 * they share — the clipboard, copies and moves with their progress, the questions, the toasts,
 * settings and updates.
 */

import {
  createToasts,
  detectPlatform,
  Icon,
  ICONS,
  Nyu,
  TitleBar,
  TitleBarAction,
  Toaster,
  useAppearance,
  Wordmark,
} from '@uwusuite/design';
import { useTauriWindow } from '@uwusuite/design/tauri';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  ConfirmDialog,
  ConflictDialog,
  OpenWithDialog,
  type ConfirmQuestion,
  type ConflictQuestion,
} from './components/Dialogs';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConnectDialog, type ConnectRequest } from './components/Network';
import { DRAG_TYPE, Pane, type NavRequest } from './components/Pane';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar, type ShareRow } from './components/Sidebar';
import { Tabs, tabTitle, type Tab } from './components/Tabs';
import {
  api,
  errorText,
  mountSource,
  onOpenFolder,
  onTransferProgress,
  TRASH,
  type Conflict,
  type Connected,
  type Entry,
  type Mounted,
  type Sidebar as SidebarData,
  type TransferMode,
  type TransferProgress,
} from './lib/api';
import { baseName, formatBytes, formatCount, parentOf, SEP, setRoots } from './lib/format';
import { setSettings, useSettings, type SavedShare } from './lib/settings';
import type { Clipboard, Shell } from './lib/shell';
import { checkForUpdate } from './lib/updates';

const toasts = createToasts();
const platform = detectPlatform();
let tabCounter = 0;
const newTabId = () => `tab-${++tabCounter}`;

type Job = TransferProgress & { mode: TransferMode; cancelling?: boolean };

export function App() {
  const settings = useSettings();
  const appearance = useAppearance({
    theme: settings.theme,
    contrast: settings.contrast,
    motion: settings.motion,
  });
  const controls = useTauriWindow();

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState('');
  const [nav, setNav] = useState<Record<string, NavRequest>>({});
  const [sidebar, setSidebar] = useState<SidebarData | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [changed, setChanged] = useState(0);
  const [conflictQ, setConflictQ] = useState<ConflictQuestion | null>(null);
  const [confirmQ, setConfirmQ] = useState<ConfirmQuestion | null>(null);
  const [openWith, setOpenWith] = useState<string[] | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectQ, setConnectQ] = useState<ConnectRequest | null>(null);
  /** Shares connected in this session, by id (kernel mounts are also found in `sidebar.network`). */
  const [connected, setConnected] = useState<Record<string, Connected>>({});
  const [connecting, setConnecting] = useState<Set<string>>(new Set());

  const home = sidebar?.places[0]?.path ?? null;
  const activeTab = tabs.find((t) => t.id === active);

  // ---- start -----------------------------------------------------------------------------

  const addTab = useCallback((path: string, focus = true) => {
    const id = newTabId();
    setTabs((t) => [...t, { id, path }]);
    if (focus) setActive(id);
  }, []);

  const started = useRef(false);
  useEffect(() => {
    // Once per window, also under StrictMode's double effects in development.
    if (!started.current) {
      started.current = true;
      api.initialPath().then((start) => {
        const restore = settings.startup === 'restore' ? settings.lastTabs.filter(Boolean) : [];
        // A folder from the command line ("Ordner öffnen" in another app) always wins.
        const first = restore.length > 0 && !start.explicit ? restore : [start.path];
        first.forEach((p, i) => addTab(p, i === 0));
      });
    }
    const refreshSidebar = () =>
      api
        .sidebar()
        .then(setSidebar)
        .catch(() => {});
    refreshSidebar();
    // A USB stick appears or goes away without the window being told: look again now and then.
    const timer = window.setInterval(refreshSidebar, 4000);
    const unlisten = onOpenFolder((p) => addTab(p));
    return () => {
      window.clearInterval(timer);
      unlisten.then((u) => u());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tabs.length) setSettings({ lastTabs: tabs.map((t) => t.path).filter((p) => p !== TRASH) });
  }, [tabs]);

  useEffect(() => {
    if (!activeTab) return;
    const title = tabTitle(activeTab.path, home);
    getCurrentWindow()
      .setTitle(`${title} – UwUFiles`)
      .catch(() => {});
  }, [activeTab, home]);

  useEffect(() => {
    if (settings.checkUpdates) checkForUpdate(toasts, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unlisten = onTransferProgress((p) =>
      setJobs((all) => all.map((j) => (j.job === p.job ? { ...j, ...p } : j))),
    );
    return () => {
      unlisten.then((u) => u());
    };
  }, []);

  // ---- tabs ------------------------------------------------------------------------------

  const closeTab = useCallback(
    (id: string) => {
      setTabs((all) => {
        if (all.length <= 1) return all;
        const i = all.findIndex((t) => t.id === id);
        const rest = all.filter((t) => t.id !== id);
        if (id === active) setActive(rest[Math.max(0, i - 1)]!.id);
        return rest;
      });
    },
    [active],
  );

  const goTo = (path: string) => {
    if (!active) return;
    setNav((n) => ({ ...n, [active]: { path, n: (n[active]?.n ?? 0) + 1 } }));
  };

  // ---- shared actions --------------------------------------------------------------------

  const fail = useCallback((e: unknown) => toasts.show(errorText(e), { tone: 'error' }), []);

  const ask = <T,>(make: (answer: (v: T) => void) => void) =>
    new Promise<T>((resolve) => make(resolve));

  const confirm = useCallback(
    (title: string, body: string, action: string) =>
      ask<boolean>((answer) =>
        setConfirmQ({
          title,
          body,
          action,
          answer: (yes) => {
            setConfirmQ(null);
            answer(yes);
          },
        }),
      ),
    [],
  );

  const transfer = useCallback(
    async (sources: string[], dest: string, mode: TransferMode): Promise<string[] | null> => {
      if (sources.length === 0) return null;
      let onConflict: Conflict = 'keepBoth';
      try {
        const taken = await api.conflicts(sources, dest);
        if (taken.length > 0) {
          const choice = await ask<Conflict | null>((answer) =>
            setConflictQ({
              names: taken,
              mode,
              answer: (c) => {
                setConflictQ(null);
                answer(c);
              },
            }),
          );
          if (!choice) return null;
          onConflict = choice;
        }
      } catch (e) {
        fail(e);
        return null;
      }

      const job = crypto.randomUUID();
      setJobs((j) => [
        ...j,
        { job, mode, doneBytes: 0, totalBytes: 0, current: baseName(sources[0]!) },
      ]);
      try {
        const made = await api.transfer(job, sources, dest, mode, onConflict);
        const what = formatCount(made.length, 'Element', 'Elemente');
        toasts.show(
          `${what} ${mode === 'copy' ? 'kopiert' : 'verschoben'} nach „${baseName(dest) || '/'}“`,
          {
            tone: 'success',
            action: { label: 'Zeigen', run: () => goToRef.current(dest) },
          },
        );
        return made;
      } catch (e) {
        if (errorText(e) === 'Abgebrochen.')
          toasts.show(mode === 'copy' ? 'Kopieren abgebrochen' : 'Verschieben abgebrochen');
        else fail(e);
        return null;
      } finally {
        setJobs((j) => j.filter((x) => x.job !== job));
        setChanged((n) => n + 1);
      }
    },
    [fail],
  );
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  const trash = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return false;
      const what =
        paths.length === 1
          ? `„${baseName(paths[0]!)}“`
          : formatCount(paths.length, 'Element', 'Elemente');
      if (
        settings.confirmTrash &&
        !(await confirm(
          `${what} in den Papierkorb legen?`,
          'Von dort lässt es sich wiederherstellen.',
          'In den Papierkorb',
        ))
      ) {
        return false;
      }
      try {
        await api.trash(paths);
        toasts.show(
          paths.length === 1
            ? `${what} liegt jetzt im Papierkorb`
            : `${what} liegen jetzt im Papierkorb`,
          sidebar?.trash
            ? { action: { label: 'Papierkorb', run: () => goToRef.current(TRASH) } }
            : {},
        );
        setChanged((n) => n + 1);
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    },
    [settings.confirmTrash, confirm, fail, sidebar?.trash],
  );

  const shell: Shell = useMemo(
    () => ({
      settings,
      sidebar,
      home,
      clipboard,
      setClipboard,
      toasts,
      transfer,
      trash,
      confirm,
      openWith: (entries: Entry[]) => setOpenWith(entries.map((e) => e.path)),
      newTab: (path: string) => addTab(path),
      changed,
    }),
    [settings, sidebar, home, clipboard, transfer, trash, confirm, addTab, changed],
  );

  // ---- network shares --------------------------------------------------------------------

  const mountOf = useCallback(
    (s: SavedShare): Mounted | undefined =>
      sidebar?.network.find((m) => m.source.replace(/\/+$/, '') === mountSource(s)),
    [sidebar],
  );

  const shareRows: ShareRow[] = settings.shares.map((share) => {
    const mine = connected[share.id];
    const mount = mountOf(share);
    return {
      share,
      path: mine?.path ?? mount?.path ?? null,
      how:
        mine?.how ??
        (mount ? `${share.protocol.toUpperCase()} ${mount.version ?? ''}`.trim() : undefined),
      connecting: connecting.has(share.id),
    };
  });
  const otherMounts =
    sidebar?.network.filter(
      (m) =>
        !shareRows.some((r) => r.path === m.path) && !settings.shares.some((s) => mountOf(s) === m),
    ) ?? [];

  // The path bar and tabs call a share's folder by the share's name.
  setRoots(
    shareRows
      .flatMap((r) => (r.path ? [{ path: r.path, name: r.share.label }] : []))
      .concat(otherMounts.map((m) => ({ path: m.path, name: baseName(m.path) || m.path }))),
  );

  const saveShare = (share: SavedShare, where: Connected) => {
    setConnected((c) => ({ ...c, [share.id]: where }));
    setSettings((s) => ({
      shares: s.shares.some((x) => x.id === share.id)
        ? s.shares.map((x) => (x.id === share.id ? share : x))
        : [...s.shares, share],
    }));
  };

  const openShare = async (row: ShareRow, inTab: boolean) => {
    const show = (path: string) => (inTab ? addTab(path) : goTo(path));
    if (row.path) return show(row.path);
    const { share } = row;
    setConnecting((c) => new Set(c).add(share.id));
    try {
      const where = await api.networkConnect(share, null, false);
      saveShare(share, where);
      setRoots([{ path: where.path, name: share.label }]);
      show(where.path);
      toasts.show(`„${share.label}“ ist verbunden (${where.how})`, { tone: 'success' });
    } catch (e) {
      const text = errorText(e);
      if (text === 'Abgebrochen.') return;
      // No password in the keyring, or a wrong one: ask, with the form filled in.
      if (share.protocol === 'smb' && /Passwort|Benutzer/.test(text))
        setConnectQ({ share, error: text });
      else fail(e);
    } finally {
      setConnecting((c) => {
        const next = new Set(c);
        next.delete(share.id);
        return next;
      });
    }
  };

  /** Tabs inside `path` go home, so none is left showing a folder that is gone. */
  const leave = (path: string) => {
    const inside = (p: string) => p === path || p.startsWith(path + SEP);
    setNav((n) => {
      const next = { ...n };
      for (const t of tabs)
        if (inside(t.path)) next[t.id] = { path: home ?? '/', n: (n[t.id]?.n ?? 0) + 1 };
      return next;
    });
  };

  const unmount = async (path: string, label: string) => {
    leave(path);
    try {
      await api.networkDisconnect(path);
      toasts.show(`„${label}“ ist getrennt`);
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      api.sidebar().then(setSidebar, () => {});
    }
  };

  const disconnectShare = async (row: ShareRow) => {
    if (!row.path) return;
    if (await unmount(row.path, row.share.label))
      setConnected(({ [row.share.id]: _, ...rest }) => rest);
  };

  const forgetShare = async (row: ShareRow) => {
    const { share } = row;
    const nfs = share.protocol === 'nfs';
    const ok = await confirm(
      `„${share.label}“ entfernen?`,
      nfs
        ? 'Die Freigabe verschwindet aus der Seitenleiste und aus /etc/fstab, dafür fragt das System nach dem Admin-Passwort. Auf dem NAS bleibt alles, wie es ist.'
        : 'Die Freigabe verschwindet aus der Seitenleiste, ihr Passwort aus dem Schlüsselbund. Auf dem Server bleibt alles, wie es ist.',
      'Entfernen',
    );
    if (!ok) return;
    try {
      if (row.path) leave(row.path);
      await api.networkForget(share);
      setConnected(({ [share.id]: _, ...rest }) => rest);
      setSettings((s) => ({ shares: s.shares.filter((x) => x.id !== share.id) }));
    } catch (e) {
      if (errorText(e) !== 'Abgebrochen.') fail(e);
    }
  };

  const dropOnPlace = (dest: string, e: DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    if (dest === TRASH) {
      trash(JSON.parse(raw) as string[]);
      return;
    }
    const sources = (JSON.parse(raw) as string[]).filter((s) => s !== dest && parentOf(s) !== dest);
    transfer(sources, dest, e.ctrlKey ? 'copy' : 'move');
  };

  // ---- window keys: tabs and settings ----------------------------------------------------

  const windowKeys = useRef<(e: KeyboardEvent) => void>(() => {});
  windowKeys.current = (e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    const i = tabs.findIndex((t) => t.id === active);
    if (k === 't') {
      e.preventDefault();
      addTab(activeTab?.path && activeTab.path !== TRASH ? activeTab.path : (home ?? '/'));
    } else if (k === 'w') {
      e.preventDefault();
      if (tabs.length > 1) closeTab(active);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const next = tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
      if (next) setActive(next.id);
    } else if (/^[1-9]$/.test(e.key) && e.altKey === false) {
      const next = e.key === '9' ? tabs[tabs.length - 1] : tabs[Number(e.key) - 1];
      if (next) {
        e.preventDefault();
        setActive(next.id);
      }
    } else if (e.key === ',') {
      e.preventDefault();
      setSettingsOpen(true);
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => windowKeys.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ---- drawing ---------------------------------------------------------------------------

  return (
    <div className="flex h-full flex-col bg-canvas">
      <TitleBar
        platform={platform}
        controls={controls}
        brand={<Wordmark product="Files" shell="box" />}
        actions={
          <>
            <TitleBarAction
              label={appearance.theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
              onClick={() => setSettings({ theme: appearance.theme === 'dark' ? 'light' : 'dark' })}
            >
              <Icon
                icon={appearance.theme === 'dark' ? ICONS.lightTheme : ICONS.darkTheme}
                size="md"
              />
            </TitleBarAction>
            <TitleBarAction label="Einstellungen (Strg+,)" onClick={() => setSettingsOpen(true)}>
              <Icon icon={ICONS.settings} size="md" />
            </TitleBarAction>
          </>
        }
      >
        <Tabs
          tabs={tabs}
          home={home}
          active={active}
          onSelect={setActive}
          onClose={closeTab}
          onNew={() =>
            addTab(activeTab?.path && activeTab.path !== TRASH ? activeTab.path : (home ?? '/'))
          }
        />
      </TitleBar>

      <div className="flex min-h-0 flex-1">
        <Sidebar
          data={sidebar}
          network={{
            shares: shareRows,
            others: otherMounts,
            onOpen: openShare,
            onDisconnect: disconnectShare,
            onForget: forgetShare,
            onUnmount: (m) => unmount(m.path, baseName(m.path)),
            onAdd: () => setConnectQ({}),
          }}
          favorites={settings.favorites}
          current={activeTab?.path ?? ''}
          onOpen={goTo}
          onOpenInTab={(p) => addTab(p)}
          onUnpin={(p) => setSettings((s) => ({ favorites: s.favorites.filter((f) => f !== p) }))}
          onDropPaths={dropOnPlace}
        />

        <main className="mr-2 mb-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-hairline bg-surface">
          <ErrorBoundary reset={active}>
            {tabs.map((tab) => (
              <Pane
                key={tab.id}
                active={tab.id === active}
                initialPath={tab.path}
                nav={nav[tab.id] ?? null}
                onPath={(path) =>
                  setTabs((all) =>
                    all.map((t) => (t.id === tab.id && t.path !== path ? { ...t, path } : t)),
                  )
                }
                shell={shell}
              />
            ))}
          </ErrorBoundary>
        </main>
      </div>

      <ConflictDialog q={conflictQ} />
      <ConfirmDialog q={confirmQ} />
      <ConnectDialog
        request={connectQ}
        onClose={() => setConnectQ(null)}
        onConnected={(share, where) => {
          setConnectQ(null);
          saveShare(share, where);
          setRoots([{ path: where.path, name: share.label }]);
          goTo(where.path);
          api.sidebar().then(setSidebar, () => {});
          toasts.show(`„${share.label}“ ist verbunden (${where.how})`, { tone: 'success' });
        }}
      />
      <OpenWithDialog paths={openWith} onClose={() => setOpenWith(null)} onError={fail} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onCheckUpdates={() => checkForUpdate(toasts, true)}
      />
      <TransferBars
        jobs={jobs}
        onCancel={(job) => {
          setJobs((all) => all.map((j) => (j.job === job ? { ...j, cancelling: true } : j)));
          api.cancelTransfer(job);
        }}
      />
      <Toaster store={toasts} />
    </div>
  );
}

function TransferBars({ jobs, onCancel }: { jobs: Job[]; onCancel: (job: string) => void }) {
  if (jobs.length === 0) return null;
  return (
    <div className="fixed right-5 bottom-5 z-[var(--uwu-z-toast)] flex w-[340px] flex-col gap-2">
      {jobs.map((job) => {
        const share = job.totalBytes > 0 ? job.doneBytes / job.totalBytes : 0;
        return (
          <div
            key={job.job}
            role="status"
            className="flex animate-pop flex-col gap-2 rounded-2xl border border-line bg-surface p-4 shadow-float"
          >
            <div className="flex items-center gap-3">
              <Nyu shell="box" mood="cheer" size={36} />
              <div className="min-w-0 flex-1">
                <p className="text-meta font-semibold">
                  {job.cancelling
                    ? 'Wird abgebrochen …'
                    : job.mode === 'copy'
                      ? 'Wird kopiert …'
                      : 'Wird verschoben …'}
                </p>
                <p className="truncate text-caption text-muted">{job.current}</p>
              </div>
              <span className="text-caption text-muted tabular-nums">
                {Math.round(share * 100)} %
              </span>
              <button
                type="button"
                disabled={job.cancelling}
                onClick={() => onCancel(job.job)}
                aria-label="Abbrechen"
                title="Abbrechen"
                className="grid size-7 place-items-center rounded-full text-muted hover:bg-danger-tint hover:text-danger-ink disabled:opacity-40"
              >
                <Icon icon={ICONS.close} size="sm" />
              </button>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-pink-tint">
              <div
                className="progress-stripes h-full rounded-full transition-[width]"
                style={{ width: `${Math.max(4, share * 100)}%` }}
              />
            </div>
            {job.totalBytes > 0 && (
              <p className="text-caption text-faint tabular-nums">
                {formatBytes(job.doneBytes)} von {formatBytes(job.totalBytes)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
