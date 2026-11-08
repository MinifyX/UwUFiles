import { cx, Icon } from '@uwusuite/design';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ContextItem {
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * The right-click menu. It looks like the suite's `<Menu>` (same surface, radius and rows) but
 * opens at the pointer instead of under a button, and moves back inside the window near an edge.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: (ContextItem | 'separator')[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - width - 8),
      y: Math.min(y, window.innerHeight - height - 8),
    });
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const buttons = [
          ...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
        ];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
        next?.focus();
      }
    };
    window.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[var(--uwu-z-menu)] flex min-w-[220px] animate-pop flex-col rounded-2xl border border-line bg-surface p-1.5 text-ink shadow-float"
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <hr key={i} role="separator" className="mx-2 my-1 border-hairline" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cx(
              'flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-meta font-medium hover:bg-pink-tint/60 focus:bg-pink-tint/60 focus:outline-none disabled:opacity-50',
              item.danger && 'text-danger-ink',
            )}
          >
            {item.icon ? (
              <Icon icon={item.icon} className={item.danger ? undefined : 'text-muted'} />
            ) : (
              <span className="w-4" />
            )}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <span className="pl-4 text-caption text-faint">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
