import { cx, Icon, ICONS } from '@uwusuite/design';
import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { fileUrl, type Entry } from '../lib/api';
import { formatBytes, formatCount, formatDate } from '../lib/format';
import { KIND_ICON, KIND_LABEL, KIND_TINT } from '../lib/icons';
import { setSettings, type Settings, type SortBy } from '../lib/settings';

export interface Modifiers {
  ctrl: boolean;
  shift: boolean;
}

interface Props {
  entries: Entry[];
  settings: Settings;
  selection: Set<string>;
  cut: Set<string>;
  renaming: string | null;
  onSelect: (path: string, mods: Modifiers) => void;
  onSelectMany: (paths: string[]) => void;
  onClear: () => void;
  onOpen: (entry: Entry) => void;
  onContext: (e: MouseEvent, entry: Entry | null) => void;
  onRename: (entry: Entry, name: string) => void;
  onRenameCancel: () => void;
  onDropOnFolder: (dest: string, e: DragEvent) => void;
  onDragStart: (entry: Entry, e: DragEvent) => void;
}

const TILE = [96, 124, 168] as const;

export function FileView(props: Props) {
  const { entries, settings } = props;
  const box = useRef<HTMLDivElement>(null);
  const band = useRubberBand(box, props.selection, props.onSelectMany, props.onClear);

  return (
    <div
      ref={box}
      tabIndex={-1}
      onMouseDown={band.start}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.background) {
          e.preventDefault();
          props.onContext(e, null);
        }
      }}
      className="uwu-scroll relative min-h-0 flex-1 overflow-y-auto focus:outline-none"
    >
      {settings.view === 'grid' ? (
        <div
          data-background="1"
          className="grid content-start gap-1.5 p-4"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TILE[settings.zoom]}px, 1fr))` }}
        >
          {entries.map((entry) => (
            <Tile key={entry.path} entry={entry} size={TILE[settings.zoom]} {...itemProps(props, entry)} />
          ))}
        </div>
      ) : (
        <ListView {...props} />
      )}
      {band.rect && (
        <div
          className="rubber-band"
          style={{ left: band.rect.x, top: band.rect.y, width: band.rect.w, height: band.rect.h }}
        />
      )}
    </div>
  );
}

function itemProps(props: Props, entry: Entry) {
  return {
    selected: props.selection.has(entry.path),
    cut: props.cut.has(entry.path),
    renaming: props.renaming === entry.path,
    onMouseDown: (e: MouseEvent) => {
      e.stopPropagation();
      if (e.button === 2 && props.selection.has(entry.path)) return;
      if (e.button === 0 && props.selection.has(entry.path) && !e.ctrlKey && !e.shiftKey) return;
      props.onSelect(entry.path, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    },
    onClick: (e: MouseEvent) => {
      // A plain click on an item that was already part of a bigger selection narrows it to this one
      // — on mouse up, so dragging the whole selection still works.
      if (!e.ctrlKey && !e.shiftKey && !e.metaKey && props.selection.size > 1) {
        props.onSelect(entry.path, { ctrl: false, shift: false });
      }
    },
    onDoubleClick: () => props.onOpen(entry),
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      props.onContext(e, entry);
    },
    onRename: (name: string) => props.onRename(entry, name),
    onRenameCancel: props.onRenameCancel,
    dropTarget: entry.isDir,
    onDrop: (e: DragEvent) => props.onDropOnFolder(entry.path, e),
    onDragStart: (e: DragEvent) => props.onDragStart(entry, e),
  };
}

type ItemProps = ReturnType<typeof itemProps> & { entry: Entry };

/** The drag and drop part every item shares: a folder lights up while something hovers over it. */
function useDropTarget(p: ItemProps) {
  const [over, setOver] = useState(false);
  if (!p.dropTarget) return { over: false, handlers: {} };
  return {
    over,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (p.selected) return; // not onto itself
        e.preventDefault();
        e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        p.onDrop(e);
      },
    },
  };
}

function Tile(p: ItemProps & { size: number }) {
  const { entry } = p;
  const drop = useDropTarget(p);
  const iconBox = Math.round(p.size * 0.6);
  return (
    <div
      data-path={entry.path}
      data-selected={p.selected}
      draggable={!p.renaming}
      onMouseDown={p.onMouseDown}
      onClick={p.onClick}
      onDoubleClick={p.onDoubleClick}
      onContextMenu={p.onContextMenu}
      onDragStart={p.onDragStart}
      {...drop.handlers}
      className={cx(
        'file-tile flex cursor-default flex-col items-center gap-1.5 rounded-2xl p-2 pt-2.5 text-center transition-colors',
        p.selected ? 'bg-pink-tint ring-1 ring-inset ring-pink/45' : 'hover:bg-pink-tint/45',
        drop.over && 'bg-pink-tint ring-2 ring-pink',
        p.cut && 'opacity-50',
        entry.hidden && !p.selected && 'opacity-70',
      )}
    >
      <Visual entry={entry} size={iconBox} />
      {p.renaming ? (
        <RenameField entry={entry} onDone={p.onRename} onCancel={p.onRenameCancel} multiline />
      ) : (
        <span
          title={entry.name}
          className={cx('file-name w-full text-[13px] leading-snug', p.selected ? 'font-semibold text-pink-ink' : 'text-ink')}
        >
          {entry.name}
        </span>
      )}
    </div>
  );
}

/** A picture for pictures, a tinted icon tile for everything else. */
function Visual({ entry, size }: { entry: Entry; size: number }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const glyph = size >= 56 ? 'xl' : 'lg';

  if (entry.kind === 'image' && !failed) {
    return (
      <span
        className="grid shrink-0 place-items-center overflow-hidden rounded-xl bg-elevated"
        style={{ width: size, height: size }}
      >
        <img
          src={fileUrl(entry.path)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          data-loaded={loaded}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="thumb size-full object-cover"
        />
      </span>
    );
  }
  return (
    <span
      className={cx('relative grid shrink-0 place-items-center rounded-[28%]', KIND_TINT[entry.kind])}
      style={{ width: size, height: size }}
    >
      <Icon icon={KIND_ICON[entry.kind]} size={glyph} style={{ width: size * 0.42, height: size * 0.42 }} />
      {entry.isSymlink && (
        <span className="absolute right-1 bottom-1 grid size-5 place-items-center rounded-full bg-surface text-muted shadow-sm">
          <Icon icon={ICONS.link} size="xs" />
        </span>
      )}
    </span>
  );
}

function RenameField({
  entry,
  onDone,
  onCancel,
  multiline,
}: {
  entry: Entry;
  onDone: (name: string) => void;
  onCancel: () => void;
  multiline?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // The name without its extension is selected, like everywhere else.
    const dot = entry.isDir ? -1 : entry.name.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  }, [entry]);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const value = ref.current?.value.trim() ?? '';
    if (commit && value && value !== entry.name) onDone(value);
    else onCancel();
  };
  const shared = {
    ref,
    defaultValue: entry.name,
    'aria-label': 'Neuer Name',
    spellCheck: false,
    onMouseDown: (e: MouseEvent) => e.stopPropagation(),
    onDoubleClick: (e: MouseEvent) => e.stopPropagation(),
    onBlur: () => finish(true),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        finish(false);
      }
    },
    className:
      'w-full rounded-small border border-pink bg-surface px-1.5 py-0.5 text-[13px] text-ink shadow-focus focus:outline-none',
  };
  return multiline ? (
    <textarea {...shared} rows={2} className={cx(shared.className, 'resize-none text-center')} />
  ) : (
    <input {...shared} />
  );
}

// Narrow windows drop the kind first, then the date; the name always keeps its room.
const DATE_COL = 'hidden @[520px]:flex';
const KIND_COL = 'hidden @[680px]:flex';

const COLUMNS: { by: SortBy; label: string; className: string }[] = [
  { by: 'name', label: 'Name', className: 'flex-1 min-w-[140px]' },
  { by: 'modified', label: 'Geändert', className: `w-[150px] ${DATE_COL}` },
  { by: 'size', label: 'Größe', className: 'w-[100px] text-right' },
  { by: 'kind', label: 'Art', className: `w-[110px] ${KIND_COL}` },
];

function ListView(props: Props) {
  const { settings: s } = props;
  return (
    <div data-background="1" className="@container flex min-h-full flex-col px-3 pb-4">
      <div className="sticky top-0 z-[2] flex items-center gap-3 border-b border-hairline bg-surface px-3 py-2 text-caption font-semibold text-muted">
        <span className="w-6" />
        {COLUMNS.map((c) => (
          <button
            key={c.by}
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() =>
              setSettings(s.sortBy === c.by ? { sortAsc: !s.sortAsc } : { sortBy: c.by, sortAsc: true })
            }
            className={cx(
              'flex items-center gap-1 hover:text-ink',
              c.className,
              c.by === 'size' && 'justify-end',
              s.sortBy === c.by && 'text-pink-ink',
            )}
          >
            {c.label}
            {s.sortBy === c.by && <Icon icon={ICONS.expand} size="xs" className={s.sortAsc ? '' : 'rotate-180'} />}
          </button>
        ))}
      </div>
      <div data-background="1" className="flex flex-1 flex-col gap-0.5 pt-1">
        {props.entries.map((entry) => (
          <Row key={entry.path} entry={entry} {...itemProps(props, entry)} />
        ))}
      </div>
    </div>
  );
}

function Row(p: ItemProps) {
  const { entry } = p;
  const drop = useDropTarget(p);
  return (
    <div
      data-path={entry.path}
      data-selected={p.selected}
      draggable={!p.renaming}
      onMouseDown={p.onMouseDown}
      onClick={p.onClick}
      onDoubleClick={p.onDoubleClick}
      onContextMenu={p.onContextMenu}
      onDragStart={p.onDragStart}
      {...drop.handlers}
      className={cx(
        'flex h-9 cursor-default items-center gap-3 rounded-xl px-3 text-[13.5px] transition-colors',
        p.selected ? 'bg-pink-tint text-pink-ink ring-1 ring-inset ring-pink/45' : 'hover:bg-pink-tint/45',
        drop.over && 'ring-2 ring-pink',
        p.cut && 'opacity-50',
        entry.hidden && !p.selected && 'opacity-70',
      )}
    >
      <span className={cx('grid size-6 shrink-0 place-items-center rounded-lg', KIND_TINT[entry.kind])}>
        <Icon icon={KIND_ICON[entry.kind]} size="xs" />
      </span>
      <span className="min-w-[140px] flex-1">
        {p.renaming ? (
          <RenameField entry={entry} onDone={p.onRename} onCancel={p.onRenameCancel} />
        ) : (
          <span className={cx('block truncate', p.selected && 'font-semibold')} title={entry.name}>
            {entry.name}
          </span>
        )}
      </span>
      <span className={cx('w-[150px] truncate text-meta text-muted', DATE_COL)}>{formatDate(entry.modified)}</span>
      <span className="w-[100px] text-right text-meta text-muted tabular-nums">{sizeText(entry)}</span>
      <span className={cx('w-[110px] truncate text-meta text-muted', KIND_COL)}>{KIND_LABEL[entry.kind]}</span>
    </div>
  );
}

export function sizeText(entry: Entry): string {
  if (entry.size == null) return '–';
  return entry.isDir ? formatCount(entry.size, 'Element', 'Elemente') : formatBytes(entry.size);
}

/**
 * Drag on the empty background to select everything the rectangle touches. Strg keeps what was
 * selected before; a plain click on the background clears the selection.
 */
function useRubberBand(
  box: React.RefObject<HTMLDivElement>,
  selection: Set<string>,
  onSelectMany: (paths: string[]) => void,
  onClear: () => void,
) {
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const start = (e: MouseEvent) => {
    const el = box.current;
    if (!el || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target !== el && !target.dataset.background) return;
    // The scroll bar is part of the box; grabbing it is not a selection.
    if (e.clientX - el.getBoundingClientRect().left > el.clientWidth) return;
    e.preventDefault();
    el.focus();
    const additive = e.ctrlKey || e.metaKey;
    const before = additive ? [...selection] : [];
    if (!additive) onClear();

    const origin = el.getBoundingClientRect();
    const sx = e.clientX - origin.left;
    const sy = e.clientY - origin.top + el.scrollTop;
    let moved = false;

    const move = (ev: globalThis.MouseEvent) => {
      const x = ev.clientX - origin.left;
      const y = ev.clientY - origin.top + el.scrollTop;
      if (!moved && Math.hypot(x - sx, y - sy) < 4) return;
      moved = true;
      const r = { x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) };
      setRect(r);
      const hits: string[] = [];
      el.querySelectorAll<HTMLElement>('[data-path]').forEach((item) => {
        const b = item.getBoundingClientRect();
        const ix = b.left - origin.left;
        const iy = b.top - origin.top + el.scrollTop;
        if (ix < r.x + r.w && ix + b.width > r.x && iy < r.y + r.h && iy + b.height > r.y) {
          hits.push(item.dataset.path!);
        }
      });
      onSelectMany([...new Set([...before, ...hits])]);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setRect(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return { rect, start };
}
