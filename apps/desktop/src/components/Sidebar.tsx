import { cx, Icon, ICONS } from '@uwusuite/design';
import type { LucideIcon } from 'lucide-react';
import type { DragEvent, ReactNode } from 'react';
import { TRASH, type Mounted, type Sidebar as SidebarData } from '../lib/api';
import type { SavedShare } from '../lib/settings';
import { baseName, formatBytes } from '../lib/format';
import { PLACE_ICON, REMOVABLE_ICON } from '../lib/icons';

/** A saved share and how it stands. */
export interface ShareRow {
  share: SavedShare;
  /** Where it is while connected. */
  path: string | null;
  /** "NFS 4.2", "SMB über KDE". */
  how?: string;
  connecting: boolean;
}

export interface NetworkProps {
  shares: ShareRow[];
  /** Kernel mounts that are not one of the saved shares (from the fstab, mounted by hand). */
  others: Mounted[];
  onOpen: (row: ShareRow, inTab: boolean) => void;
  onDisconnect: (row: ShareRow) => void;
  onForget: (row: ShareRow) => void;
  onUnmount: (m: Mounted) => void;
  onAdd: () => void;
}

interface Props {
  data: SidebarData | null;
  network: NetworkProps;
  favorites: string[];
  current: string;
  onOpen: (path: string) => void;
  /** Middle click: in a new tab. */
  onOpenInTab: (path: string) => void;
  onUnpin: (path: string) => void;
  /** Something dragged from the file view was dropped on a place. */
  onDropPaths: (dest: string, e: DragEvent) => void;
}

/** Orte, Favoriten, Netzwerk, Laufwerke. Rows are 36 px, the active one pink (docs/components.md). */
export function Sidebar({
  data,
  network,
  favorites,
  current,
  onOpen,
  onOpenInTab,
  onUnpin,
  onDropPaths,
}: Props) {
  return (
    <nav
      aria-label="Orte"
      className="uwu-scroll flex w-[248px] shrink-0 flex-col gap-6 overflow-y-auto px-3 pt-3 pb-4"
    >
      <Group title="Orte">
        {data?.places.map((p) => (
          <Row
            key={p.path}
            icon={PLACE_ICON[p.icon]}
            label={p.name}
            active={current === p.path}
            onClick={() => onOpen(p.path)}
            onMiddle={() => onOpenInTab(p.path)}
            onDrop={(e) => onDropPaths(p.path, e)}
          />
        ))}
        {data?.trash && (
          <Row
            icon={ICONS.delete}
            label="Papierkorb"
            active={current === TRASH}
            onClick={() => onOpen(TRASH)}
          />
        )}
      </Group>

      {favorites.length > 0 && (
        <Group title="Favoriten">
          {favorites.map((path) => (
            <Row
              key={path}
              icon={ICONS.favorite}
              label={baseName(path)}
              title={path}
              active={current === path}
              onClick={() => onOpen(path)}
              onMiddle={() => onOpenInTab(path)}
              onDrop={(e) => onDropPaths(path, e)}
              aside={
                <RowButton
                  icon={ICONS.close}
                  label={`${baseName(path)} aus den Favoriten entfernen`}
                  onClick={() => onUnpin(path)}
                />
              }
            />
          ))}
        </Group>
      )}

      <Group title="Netzwerk">
        {network.shares.map((row) => {
          const { share, path } = row;
          const where = `${share.protocol.toUpperCase()} · ${share.host}:${share.protocol === 'smb' ? '/' : ''}${share.share}`;
          return (
            <Row
              key={share.id}
              icon={ICONS.server}
              label={share.label}
              title={
                row.how ? `${where} · verbunden über ${row.how}` : `${where} · nicht verbunden`
              }
              active={path != null && current.startsWith(path)}
              dim={path == null && !row.connecting}
              onClick={() => network.onOpen(row, false)}
              onMiddle={() => network.onOpen(row, true)}
              onDrop={path ? (e) => onDropPaths(path, e) : undefined}
              below={
                <span className="block truncate text-caption font-normal text-muted">
                  {row.connecting ? 'Wird verbunden …' : (row.how ?? share.host)}
                </span>
              }
              aside={
                row.connecting ? (
                  <Icon icon={ICONS.loading} size="sm" className="animate-spin text-muted" />
                ) : (
                  <RowButton
                    icon={path ? ICONS.disconnect : ICONS.close}
                    label={path ? `${share.label} trennen` : `${share.label} entfernen`}
                    onClick={() => (path ? network.onDisconnect(row) : network.onForget(row))}
                  />
                )
              }
            />
          );
        })}
        {network.others.map((m) => (
          <Row
            key={m.path}
            icon={ICONS.server}
            label={baseName(m.path) || m.path}
            title={`${m.source} · ${m.path}`}
            active={current.startsWith(m.path)}
            onClick={() => onOpen(m.path)}
            onMiddle={() => onOpenInTab(m.path)}
            onDrop={(e) => onDropPaths(m.path, e)}
            below={
              <span className="block truncate text-caption font-normal text-muted">
                {m.protocol.toUpperCase()}
                {m.version ? ` ${m.version}` : ''} · {m.source.replace(/^\/\//, '')}
              </span>
            }
            aside={
              <RowButton
                icon={ICONS.disconnect}
                label={`${baseName(m.path)} aushängen`}
                onClick={() => network.onUnmount(m)}
              />
            }
          />
        ))}
        <Row
          icon={ICONS.add}
          label="Netzlaufwerk verbinden …"
          active={false}
          dim
          onClick={network.onAdd}
        />
      </Group>

      {data && data.drives.length > 0 && (
        <Group title="Laufwerke">
          {data.drives.map((d) => {
            const used = d.totalBytes > 0 ? 1 - d.freeBytes / d.totalBytes : 0;
            return (
              <Row
                key={d.path}
                icon={d.removable ? REMOVABLE_ICON : ICONS.drive}
                label={d.name}
                title={`${d.path} · ${formatBytes(d.freeBytes)} frei von ${formatBytes(d.totalBytes)}`}
                active={current === d.path}
                onClick={() => onOpen(d.path)}
                onMiddle={() => onOpenInTab(d.path)}
                onDrop={(e) => onDropPaths(d.path, e)}
                below={
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-hairline">
                    <span
                      className={cx(
                        'block h-full rounded-full',
                        used > 0.9 ? 'bg-warning' : 'bg-pink',
                      )}
                      style={{ width: `${Math.round(used * 100)}%` }}
                    />
                  </span>
                }
              />
            );
          })}
        </Group>
      )}
    </nav>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <h2 className="px-3 pb-1.5 text-[11px] font-bold tracking-[0.08em] text-faint uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The small button at a row's end that shows on hover: unpin, disconnect, remove. */
function RowButton({
  icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="grid size-6 place-items-center rounded-full text-muted opacity-0 group-hover:opacity-100 hover:bg-surface hover:text-ink focus-visible:opacity-100"
    >
      <Icon icon={icon} size="xs" />
    </button>
  );
}

interface RowProps {
  icon: LucideIcon;
  label: string;
  title?: string;
  active: boolean;
  /** Not there right now (a share that is not connected, the "add" row). */
  dim?: boolean;
  onClick: () => void;
  onMiddle?: () => void;
  onDrop?: (e: DragEvent) => void;
  aside?: ReactNode;
  below?: ReactNode;
}

function Row({
  icon,
  label,
  title,
  active,
  dim,
  onClick,
  onMiddle,
  onDrop,
  aside,
  below,
}: RowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      title={title ?? label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onAuxClick={(e) => {
        if (e.button === 1 && onMiddle) {
          e.preventDefault();
          onMiddle();
        }
      }}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
      onDragOver={onDrop ? (e) => e.preventDefault() : undefined}
      onDrop={
        onDrop
          ? (e) => {
              e.preventDefault();
              onDrop(e);
            }
          : undefined
      }
      className={cx(
        'group flex min-h-9 cursor-default items-center gap-2.5 rounded-xl px-3 py-1.5 text-[13.5px] transition-colors',
        active
          ? 'bg-pink-tint font-semibold text-pink-ink'
          : cx(dim ? 'text-muted' : 'text-ink', 'hover:bg-pink-tint/45'),
      )}
    >
      <Icon
        icon={icon}
        size="md"
        className={active ? 'text-pink-ink' : dim ? 'text-faint' : 'text-muted'}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {below}
      </span>
      {aside}
    </div>
  );
}
