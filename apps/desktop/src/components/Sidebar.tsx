import { cx, Icon, ICONS } from '@uwusuite/design';
import type { LucideIcon } from 'lucide-react';
import type { DragEvent, ReactNode } from 'react';
import type { Sidebar as SidebarData } from '../lib/api';
import { baseName, formatBytes } from '../lib/format';
import { PLACE_ICON, REMOVABLE_ICON } from '../lib/icons';

interface Props {
  data: SidebarData | null;
  favorites: string[];
  current: string;
  onOpen: (path: string) => void;
  onUnpin: (path: string) => void;
  /** Something dragged from the file view was dropped on a place. */
  onDropPaths: (dest: string, e: DragEvent) => void;
}

/** Orte, Favoriten, Laufwerke. Rows are 36 px, the active one pink (docs/components.md). */
export function Sidebar({ data, favorites, current, onOpen, onUnpin, onDropPaths }: Props) {
  return (
    <nav
      aria-label="Orte"
      className="uwu-scroll flex w-[248px] shrink-0 flex-col gap-5 overflow-y-auto px-3 pt-2 pb-4"
    >
      <Group title="Orte">
        {data?.places.map((p) => (
          <Row
            key={p.path}
            icon={PLACE_ICON[p.icon]}
            label={p.name}
            active={current === p.path}
            onClick={() => onOpen(p.path)}
            onDrop={(e) => onDropPaths(p.path, e)}
          />
        ))}
        {data?.trash && (
          <Row
            icon={ICONS.delete}
            label="Papierkorb"
            active={current === data.trash}
            onClick={() => onOpen(data.trash!)}
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
              onDrop={(e) => onDropPaths(path, e)}
              aside={
                <button
                  type="button"
                  aria-label={`${baseName(path)} aus den Favoriten entfernen`}
                  title="Aus den Favoriten entfernen"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnpin(path);
                  }}
                  className="grid size-6 place-items-center rounded-full text-muted opacity-0 group-hover:opacity-100 hover:bg-surface hover:text-ink focus-visible:opacity-100"
                >
                  <Icon icon={ICONS.close} size="xs" />
                </button>
              }
            />
          ))}
        </Group>
      )}

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
      <h2 className="px-3 pb-1 text-[12px] font-semibold tracking-wide text-muted uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

interface RowProps {
  icon: LucideIcon;
  label: string;
  title?: string;
  active: boolean;
  onClick: () => void;
  onDrop?: (e: DragEvent) => void;
  aside?: ReactNode;
  below?: ReactNode;
}

function Row({ icon, label, title, active, onClick, onDrop, aside, below }: RowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      title={title ?? label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
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
        active ? 'bg-pink-tint font-semibold text-pink-ink' : 'text-ink hover:bg-pink-tint/45',
      )}
    >
      <Icon icon={icon} size="md" className={active ? 'text-pink-ink' : 'text-muted'} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {below}
      </span>
      {aside}
    </div>
  );
}
