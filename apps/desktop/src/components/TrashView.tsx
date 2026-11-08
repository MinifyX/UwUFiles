import { Button, cx, EmptyState, Icon, ICONS, Nyu } from '@uwusuite/design';
import { useCallback, useEffect, useState } from 'react';
import { api, type TrashEntry } from '../lib/api';
import { formatCount, formatDate, parentOf } from '../lib/format';
import { KIND_ICON, KIND_TINT } from '../lib/icons';

/**
 * The trash as a list: what was deleted, from where, when. Things go back where they came from;
 * deleting for good always asks first.
 */
export function TrashView({
  active,
  confirm,
  onError,
  onDone,
  onOpenFolder,
}: {
  active: boolean;
  confirm: (title: string, body: string, action: string) => Promise<boolean>;
  onError: (e: unknown) => void;
  onDone: (message: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  const [items, setItems] = useState<TrashEntry[] | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.trashList().then(
      (list) => {
        setItems(list);
        setSelection((s) => new Set([...s].filter((id) => list.some((i) => i.id === id))));
      },
      (e) => {
        onError(e);
        setItems([]);
      },
    );
  }, [onError]);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const chosen = items?.filter((i) => selection.has(i.id)) ?? [];
  const what = (n: number) => formatCount(n, 'Element', 'Elemente');

  const run = async (job: () => Promise<void>, message: string) => {
    setBusy(true);
    try {
      await job();
      onDone(message);
      setSelection(new Set());
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
      load();
    }
  };

  const restore = (list: TrashEntry[]) =>
    run(() => api.trashRestore(list.map((i) => i.id)), `${what(list.length)} wiederhergestellt`);

  const purge = async (list: TrashEntry[]) => {
    const ok = await confirm(
      list.length === 1
        ? `„${list[0]!.name}“ endgültig löschen?`
        : `${what(list.length)} endgültig löschen?`,
      'Das lässt sich nicht rückgängig machen.',
      'Endgültig löschen',
    );
    if (ok)
      run(() => api.trashPurge(list.map((i) => i.id)), `${what(list.length)} endgültig gelöscht`);
  };

  const empty = async () => {
    const ok = await confirm(
      'Papierkorb leeren?',
      `${what(items?.length ?? 0)} werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.`,
      'Papierkorb leeren',
    );
    if (ok) run(api.trashEmpty, 'Der Papierkorb ist leer');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
        <h2 className="flex flex-1 items-center gap-2 text-section font-bold">
          <Icon icon={ICONS.delete} size="md" className="text-pink-ink" />
          Papierkorb
          {items && items.length > 0 && (
            <span className="text-meta font-normal text-muted">· {what(items.length)}</span>
          )}
        </h2>
        {chosen.length > 0 ? (
          <>
            <Button size="sm" icon={ICONS.restore} disabled={busy} onClick={() => restore(chosen)}>
              Wiederherstellen
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={ICONS.delete}
              disabled={busy}
              onClick={() => purge(chosen)}
            >
              Endgültig löschen
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="danger"
            icon={ICONS.delete}
            disabled={busy || !items?.length}
            onClick={empty}
          >
            Papierkorb leeren
          </Button>
        )}
      </div>

      {items == null ? null : items.length === 0 ? (
        <EmptyState
          className="flex-1"
          art={<Nyu shell="box" mood="sparkle" size={150} />}
          title="Der Papierkorb ist leer"
          body="Was du hier löschst, landet erst einmal hier und lässt sich zurückholen."
        />
      ) : (
        <div
          className="uwu-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-3"
          onMouseDown={(e) => e.target === e.currentTarget && setSelection(new Set())}
        >
          {items.map((item) => {
            const on = selection.has(item.id);
            const from = parentOf(item.originalPath) ?? '/';
            return (
              <div
                key={item.id}
                onMouseDown={(e) =>
                  setSelection((s) => {
                    if (!(e.ctrlKey || e.metaKey)) return new Set([item.id]);
                    const next = new Set(s);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    return next;
                  })
                }
                onDoubleClick={() => restore([item])}
                className={cx(
                  'group flex min-h-12 cursor-default items-center gap-3 rounded-xl px-3 py-1.5 text-[13.5px]',
                  on ? 'bg-pink-tint ring-1 ring-pink/45 ring-inset' : 'hover:bg-pink-tint/45',
                )}
              >
                <span
                  className={cx(
                    'grid size-8 shrink-0 place-items-center rounded-lg',
                    KIND_TINT[item.kind],
                  )}
                >
                  <Icon icon={KIND_ICON[item.kind]} size="sm" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate', on && 'font-semibold text-pink-ink')}>
                    {item.name}
                  </span>
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => onOpenFolder(from)}
                    className="block max-w-full truncate text-caption text-muted hover:text-pink-ink hover:underline"
                    title="Diesen Ordner öffnen"
                  >
                    aus {from}
                  </button>
                </span>
                <span className="shrink-0 text-meta text-muted">{formatDate(item.deleted)}</span>
                <button
                  type="button"
                  title="Wiederherstellen"
                  aria-label={`${item.name} wiederherstellen`}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => restore([item])}
                  className="grid size-8 shrink-0 place-items-center rounded-full text-muted opacity-0 group-hover:opacity-100 hover:bg-surface hover:text-ink focus-visible:opacity-100"
                >
                  <Icon icon={ICONS.restore} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
