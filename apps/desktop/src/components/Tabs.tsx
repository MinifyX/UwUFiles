import { cx, Icon, ICONS } from '@uwusuite/design';
import { TRASH } from '../lib/api';
import { baseName, rootFor } from '../lib/format';

export interface Tab {
  id: string;
  path: string;
}

/** What a tab says: "Persönlicher Ordner" for home, "Papierkorb", otherwise the folder's name. */
export function tabTitle(path: string, home: string | null) {
  if (path === TRASH) return 'Papierkorb';
  if (path === home) return 'Persönlicher Ordner';
  const root = rootFor(path);
  if (root && root.path === path) return root.name;
  return baseName(path) || '/';
}

/**
 * The tabs in the title bar. The active tab sits light on the bar with a pink folder;
 * the close button shows on hover, a middle click closes too. None of this is a drag region.
 */
export function Tabs({
  tabs,
  home,
  active,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: Tab[];
  home: string | null;
  active: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div role="tablist" aria-label="Tabs" className="flex h-full min-w-0 items-center gap-1 pl-5">
      {tabs.map((tab, i) => {
        const on = tab.id === active;
        const title = tabTitle(tab.path, home);
        // A thin line between two quiet tabs, gone next to the active one (as in a browser).
        const divider = i > 0 && !on && tabs[i - 1]!.id !== active;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={on}
            title={tab.path === TRASH ? 'Papierkorb' : tab.path}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(tab.id);
              } else if (e.button === 0) {
                onSelect(tab.id);
              }
            }}
            className={cx(
              'group relative flex h-[30px] w-[190px] min-w-[72px] shrink cursor-default items-center gap-2 rounded-[10px] pr-1 pl-2.5 text-[12.5px] transition-[background-color,color,box-shadow] duration-150',
              on
                ? 'bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--uwu-hairline),0_1px_3px_rgb(0_0_0/0.06)]'
                : 'text-muted hover:bg-surface/55 hover:text-ink',
              divider &&
                'before:absolute before:top-2 before:bottom-2 before:-left-[3px] before:w-px before:bg-hairline group-hover:before:opacity-0',
            )}
          >
            <Icon
              icon={
                tab.path === TRASH ? ICONS.delete : rootFor(tab.path) ? ICONS.server : ICONS.folder
              }
              size="xs"
              className={cx('shrink-0', on ? 'text-pink-ink' : 'text-faint group-hover:text-muted')}
            />
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {tabs.length > 1 && (
              <button
                type="button"
                aria-label={`${title} schließen`}
                title="Tab schließen (Strg+W)"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onClose(tab.id)}
                className={cx(
                  'grid size-[22px] shrink-0 place-items-center rounded-md text-muted hover:bg-pink-tint hover:text-pink-ink',
                  on
                    ? 'opacity-100'
                    : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                )}
              >
                <Icon icon={ICONS.close} size="xs" />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNew}
        aria-label="Neuer Tab"
        title="Neuer Tab (Strg+T)"
        className="ml-0.5 grid size-[30px] shrink-0 place-items-center rounded-[10px] text-muted transition-colors hover:bg-surface/55 hover:text-ink"
      >
        <Icon icon={ICONS.add} size="sm" />
      </button>
    </div>
  );
}
