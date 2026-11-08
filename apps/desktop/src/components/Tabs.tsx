import { cx, Icon, ICONS } from '@uwusuite/design';
import { TRASH } from '../lib/api';
import { baseName } from '../lib/format';

export interface Tab {
  id: string;
  path: string;
}

/** What a tab says: "Persönlicher Ordner" for home, "Papierkorb", otherwise the folder's name. */
export function tabTitle(path: string, home: string | null) {
  if (path === TRASH) return 'Papierkorb';
  if (path === home) return 'Persönlicher Ordner';
  return baseName(path) || '/';
}

/**
 * The tabs in the title bar. Active tabs carry the suite's pink top inset (docs/components.md);
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
    <div role="tablist" aria-label="Tabs" className="flex h-full min-w-0 items-end gap-1 pl-4">
      {tabs.map((tab) => {
        const on = tab.id === active;
        const title = tabTitle(tab.path, home);
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
              'group flex h-[30px] max-w-[200px] min-w-[96px] shrink cursor-default items-center gap-2 rounded-t-xl pr-1.5 pl-3 text-meta transition-colors',
              on
                ? 'bg-canvas font-semibold text-ink shadow-[inset_0_2px_0_var(--uwu-pink)]'
                : 'text-muted hover:bg-pink-tint/45 hover:text-ink',
            )}
          >
            <Icon
              icon={tab.path === TRASH ? ICONS.delete : ICONS.folder}
              size="xs"
              className={on ? 'text-pink-ink' : ''}
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
                  'grid size-5 shrink-0 place-items-center rounded-full hover:bg-pink-tint hover:text-ink',
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
        className="mb-[3px] grid size-6 shrink-0 place-items-center self-end rounded-full text-muted hover:bg-pink-tint/60 hover:text-ink"
      >
        <Icon icon={ICONS.add} size="xs" />
      </button>
    </div>
  );
}
