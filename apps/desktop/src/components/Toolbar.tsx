import { cx, Icon, IconButton, ICONS, Menu, Segmented } from '@uwusuite/design';
import { Check, LayoutGrid, List } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { crumbs } from '../lib/format';
import { setSettings, type Settings, type SortBy } from '../lib/settings';

interface Props {
  path: string;
  home: string | null;
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onRefresh: () => void;
  onOpen: (path: string) => void;
  onNewFolder: () => void;
  query: string;
  onQuery: (q: string) => void;
  settings: Settings;
  /** Bumped by Strg+L / Strg+F, to focus the path field or the search. */
  focusPath: number;
  focusSearch: number;
}

const SORTS: { by: SortBy; label: string }[] = [
  { by: 'name', label: 'Name' },
  { by: 'modified', label: 'Geändert' },
  { by: 'size', label: 'Größe' },
  { by: 'kind', label: 'Art' },
];

export function Toolbar(props: Props) {
  const { settings: s } = props;
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (props.focusSearch) searchRef.current?.focus();
  }, [props.focusSearch]);

  const check = (on: boolean) => (on ? Check : undefined);

  return (
    <div className="flex items-center gap-2 px-4 py-2.5">
      <div className="flex items-center gap-0.5">
        <IconButton icon={ICONS.previous} label="Zurück (Alt+←)" disabled={!props.canBack} onClick={props.onBack} />
        <IconButton icon={ICONS.next} label="Vor (Alt+→)" disabled={!props.canForward} onClick={props.onForward} />
        <IconButton icon={ICONS.parentFolder} label="Übergeordneter Ordner (Alt+↑)" disabled={!props.canUp} onClick={props.onUp} />
      </div>

      <PathBar path={props.path} home={props.home} onOpen={props.onOpen} focus={props.focusPath} />

      <label className="relative flex h-10 w-[220px] shrink items-center">
        <Icon icon={ICONS.search} className="pointer-events-none absolute left-3 text-muted" />
        <input
          ref={searchRef}
          type="search"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              props.onQuery('');
              e.currentTarget.blur();
            }
          }}
          placeholder="In diesem Ordner suchen"
          aria-label="In diesem Ordner suchen"
          className="h-full w-full rounded-full border border-line bg-surface pr-3 pl-9 text-meta text-ink placeholder:text-faint focus:border-pink focus:outline-none"
        />
      </label>

      <Segmented
        label="Ansicht"
        value={s.view}
        onChange={(view) => setSettings({ view })}
        options={[
          { value: 'grid', label: <Icon icon={LayoutGrid} label="Kacheln" /> },
          { value: 'list', label: <Icon icon={List} label="Liste" /> },
        ]}
      />

      <Menu
        align="end"
        trigger={({ toggle, open, ...aria }) => (
          <IconButton {...aria} active={open} onClick={toggle} icon={ICONS.sort} label="Sortieren und Ansicht" />
        )}
        items={[
          ...SORTS.map((o) => ({
            label: o.label,
            icon: check(s.sortBy === o.by),
            onSelect: () => setSettings({ sortBy: o.by }),
          })),
          'separator' as const,
          { label: 'Aufsteigend', icon: check(s.sortAsc), onSelect: () => setSettings({ sortAsc: true }) },
          { label: 'Absteigend', icon: check(!s.sortAsc), onSelect: () => setSettings({ sortAsc: false }) },
          'separator' as const,
          {
            label: 'Ordner zuerst',
            icon: check(s.foldersFirst),
            onSelect: () => setSettings({ foldersFirst: !s.foldersFirst }),
          },
          {
            label: 'Versteckte Dateien (Strg+H)',
            icon: check(s.showHidden),
            onSelect: () => setSettings({ showHidden: !s.showHidden }),
          },
          {
            label: 'Detailbereich (F11)',
            icon: check(s.details),
            onSelect: () => setSettings({ details: !s.details }),
          },
        ]}
      />
      <IconButton icon={ICONS.newFolder} label="Neuer Ordner (Strg+Umschalt+N)" onClick={props.onNewFolder} />
      <IconButton icon={ICONS.refresh} label="Neu laden (F5)" onClick={props.onRefresh} />
    </div>
  );
}

/**
 * The breadcrumb. A click on a crumb opens that folder; a click on the empty part (or Strg+L)
 * turns it into a text field for typing a path.
 */
function PathBar({
  path,
  home,
  onOpen,
  focus,
}: {
  path: string;
  home: string | null;
  onOpen: (p: string) => void;
  focus: number;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(path);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus) setEditing(true);
  }, [focus]);
  useEffect(() => {
    if (editing) {
      setText(path);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, path]);
  // The deepest folder stays in view when the path is longer than the bar.
  useEffect(() => {
    scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth });
  }, [path]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={text}
        aria-label="Pfad"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const target = text.trim().replace(/^~(?=$|\/)/, home ?? '~');
            if (target) onOpen(target);
            setEditing(false);
          } else if (e.key === 'Escape') {
            setEditing(false);
          }
        }}
        className="h-10 min-w-0 flex-1 rounded-control border border-pink bg-surface px-3 font-mono text-meta text-ink shadow-focus focus:outline-none"
      />
    );
  }

  const parts = crumbs(path, home);
  return (
    <div
      ref={scrollRef}
      onClick={(e) => e.target === e.currentTarget && setEditing(true)}
      title="Klicken, um einen Pfad einzugeben (Strg+L)"
      className="flex h-10 min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-full border border-line bg-surface px-1.5 [scrollbar-width:none]"
    >
      {parts.map((c, i) => {
        const last = i === parts.length - 1;
        return (
          <span key={c.path} className="flex shrink-0 items-center gap-0.5">
            {i > 0 && <Icon icon={ICONS.next} size="xs" className="text-faint" />}
            <button
              type="button"
              onClick={() => onOpen(c.path)}
              className={cx(
                'flex h-7 items-center gap-1.5 rounded-full px-2.5 text-meta transition-colors',
                last ? 'bg-pink-tint font-semibold text-pink-ink' : 'text-muted hover:bg-pink-tint/50 hover:text-ink',
              )}
            >
              {i === 0 && <Icon icon={c.name === 'System' ? ICONS.drive : ICONS.home} size="xs" />}
              {c.name}
            </button>
          </span>
        );
      })}
    </div>
  );
}
