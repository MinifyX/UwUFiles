import { Button, cx, Icon, ICONS, Nyu } from '@uwusuite/design';
import { useEffect, useState } from 'react';
import { api, fileUrl, type Entry } from '../lib/api';
import { formatBytes, formatCount, formatDate } from '../lib/format';
import { KIND_ICON, KIND_LABEL, KIND_TINT } from '../lib/icons';
import { sizeText } from './FileView';

/**
 * The panel on the right: a big preview of what is selected and what there is to know about it.
 * With nothing selected it describes the folder itself.
 */
export function Details({
  selected,
  folder,
  count,
  onOpen,
}: {
  selected: Entry[];
  folder: Entry | null;
  count: number;
  onOpen: (e: Entry) => void;
}) {
  const one = selected.length === 1 ? selected[0]! : null;
  const subject = one ?? (selected.length === 0 ? folder : null);

  return (
    <aside
      aria-label="Details"
      className="uwu-scroll flex w-[272px] shrink-0 max-[960px]:hidden flex-col gap-4 overflow-y-auto border-l border-hairline p-5"
    >
      {selected.length > 1 ? (
        <Many entries={selected} />
      ) : subject ? (
        <One
          entry={subject}
          itemsInFolder={one ? null : count}
          onOpen={one ? () => onOpen(one) : undefined}
        />
      ) : (
        <div className="grid flex-1 place-items-center text-center text-meta text-muted">
          <div className="flex flex-col items-center gap-3">
            <Nyu shell="box" mood="sleepy" size={72} />
            Nichts ausgewählt
          </div>
        </div>
      )}
    </aside>
  );
}

function One({
  entry,
  itemsInFolder,
  onOpen,
}: {
  entry: Entry;
  itemsInFolder: number | null;
  onOpen?: () => void;
}) {
  const [bytes, setBytes] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  useEffect(() => {
    setBytes(null);
    setCounting(false);
  }, [entry.path]);

  const preview =
    entry.kind === 'image' ? (
      <img
        src={fileUrl(entry.path)}
        alt=""
        draggable={false}
        className="max-h-[220px] w-full rounded-card bg-elevated object-contain"
      />
    ) : entry.kind === 'video' ? (
      <video src={fileUrl(entry.path)} controls muted className="w-full rounded-card bg-stage" />
    ) : entry.kind === 'audio' ? (
      <audio src={fileUrl(entry.path)} controls className="w-full" />
    ) : (
      <span
        className={cx(
          'mx-auto grid size-32 place-items-center rounded-[28%]',
          KIND_TINT[entry.kind],
        )}
      >
        <Icon icon={KIND_ICON[entry.kind]} size="xl" style={{ width: 56, height: 56 }} />
      </span>
    );

  return (
    <>
      <div className="flex justify-center pt-2">{preview}</div>
      <div className="selectable text-center">
        <h2 className="text-section font-bold break-words">{entry.name}</h2>
        <p className="mt-0.5 text-meta text-muted">{KIND_LABEL[entry.kind]}</p>
      </div>
      <dl className="flex flex-col gap-2.5 rounded-card border border-hairline bg-surface p-4 text-meta">
        {entry.isDir ? (
          <Fact
            label="Inhalt"
            value={
              itemsInFolder != null
                ? formatCount(itemsInFolder, 'Element', 'Elemente')
                : sizeText(entry)
            }
          />
        ) : (
          <Fact label="Größe" value={entry.size != null ? formatBytes(entry.size) : '–'} />
        )}
        {entry.isDir && (
          <Fact
            label="Größe"
            value={
              bytes != null ? (
                formatBytes(bytes)
              ) : (
                <button
                  type="button"
                  disabled={counting}
                  onClick={() => {
                    setCounting(true);
                    api.treeSize(entry.path).then(setBytes, () => setCounting(false));
                  }}
                  className="font-semibold text-pink-ink hover:underline disabled:opacity-60"
                >
                  {counting ? 'Wird berechnet …' : 'Berechnen'}
                </button>
              )
            }
          />
        )}
        <Fact label="Geändert" value={formatDate(entry.modified)} />
        <Fact
          label="Ort"
          value={<span className="selectable font-mono text-caption break-all">{entry.path}</span>}
        />
        {entry.isSymlink && <Fact label="Verknüpfung" value="Ja" />}
      </dl>
      {onOpen && (
        <Button
          variant="primary"
          icon={entry.isDir ? ICONS.folderOpen : ICONS.openExternal}
          onClick={onOpen}
        >
          Öffnen
        </Button>
      )}
    </>
  );
}

function Many({ entries }: { entries: Entry[] }) {
  const files = entries.filter((e) => !e.isDir);
  const folders = entries.length - files.length;
  const bytes = files.reduce((sum, e) => sum + (e.size ?? 0), 0);
  return (
    <>
      <div className="relative mx-auto mt-4 h-32 w-32">
        {entries.slice(0, 3).map((e, i) => (
          <span
            key={e.path}
            className={cx(
              'absolute grid size-24 place-items-center rounded-[28%] border-2 border-surface shadow-sm',
              KIND_TINT[e.kind],
            )}
            style={{ left: i * 12, top: i * 8, transform: `rotate(${(i - 1) * 6}deg)` }}
          >
            <Icon icon={KIND_ICON[e.kind]} size="xl" style={{ width: 40, height: 40 }} />
          </span>
        ))}
      </div>
      <div className="text-center">
        <h2 className="text-section font-bold">
          {formatCount(entries.length, 'Element', 'Elemente')}
        </h2>
        <p className="mt-0.5 text-meta text-muted">
          {[
            folders && formatCount(folders, 'Ordner', 'Ordner'),
            files.length && formatCount(files.length, 'Datei', 'Dateien'),
          ]
            .filter(Boolean)
            .join(', ')}
        </p>
      </div>
      {files.length > 0 && (
        <dl className="flex flex-col gap-2.5 rounded-card border border-hairline bg-surface p-4 text-meta">
          <Fact label="Dateien zusammen" value={formatBytes(bytes)} />
        </dl>
      )}
    </>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
