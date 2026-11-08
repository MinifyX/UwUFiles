/**
 * The window's questions: replace or keep both, are you sure, which app. Each one is shown by
 * App and answered through a promise, so the code that asks reads top to bottom.
 */

import { Button, Dialog, Field, Icon, ICONS, Nyu, TextInput } from '@uwusuite/design';
import { useEffect, useState } from 'react';
import { api, fileUrl, type App, type Conflict, type TransferMode } from '../lib/api';
import { baseName } from '../lib/format';

export interface ConflictQuestion {
  names: string[];
  mode: TransferMode;
  answer: (c: Conflict | null) => void;
}

export function ConflictDialog({ q }: { q: ConflictQuestion | null }) {
  const close = (c: Conflict | null) => q?.answer(c);
  const shown = q?.names.slice(0, 5) ?? [];
  const more = (q?.names.length ?? 0) - shown.length;
  const one = q?.names.length === 1;
  return (
    <Dialog
      open={q != null}
      onClose={() => close(null)}
      width="md"
      tone="warning"
      title={
        one ? `„${q?.names[0]}“ gibt es dort schon` : `${q?.names.length} Namen gibt es dort schon`
      }
      footer={
        <>
          <Button onClick={() => close(null)}>Abbrechen</Button>
          <Button onClick={() => close('skip')}>Überspringen</Button>
          <Button onClick={() => close('keepBoth')}>Beide behalten</Button>
          <Button variant="primary" onClick={() => close('replace')}>
            Ersetzen
          </Button>
        </>
      }
    >
      <div className="flex gap-4">
        <Nyu shell="box" mood="puzzled" size={64} />
        <div className="flex min-w-0 flex-col gap-2 text-meta">
          {!one && (
            <ul className="flex flex-col gap-1">
              {shown.map((n) => (
                <li key={n} className="flex items-center gap-2 truncate">
                  <Icon icon={ICONS.file} size="xs" className="text-muted" />
                  <span className="truncate font-semibold">{n}</span>
                </li>
              ))}
              {more > 0 && <li className="text-muted">und {more} weitere</li>}
            </ul>
          )}
          <p className="text-muted">
            <b className="text-ink">Ersetzen</b> legt die vorhandenen in den Papierkorb, du kannst
            sie von dort zurückholen. <b className="text-ink">Beide behalten</b> hängt „(Kopie)“ an
            den neuen Namen.
          </p>
        </div>
      </div>
    </Dialog>
  );
}

export interface ConfirmQuestion {
  title: string;
  body: string;
  action: string;
  answer: (yes: boolean) => void;
}

export function ConfirmDialog({ q }: { q: ConfirmQuestion | null }) {
  return (
    <Dialog
      open={q != null}
      onClose={() => q?.answer(false)}
      width="sm"
      tone="warning"
      title={q?.title}
      footer={
        <>
          <Button onClick={() => q?.answer(false)}>Abbrechen</Button>
          <Button variant="danger" autoFocus onClick={() => q?.answer(true)}>
            {q?.action}
          </Button>
        </>
      }
    >
      <p className="text-meta text-muted">{q?.body}</p>
    </Dialog>
  );
}

/** "Öffnen mit …": every app that says it can open the file, the default first. */
export function OpenWithDialog({
  paths,
  onClose,
  onError,
}: {
  paths: string[] | null;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [apps, setApps] = useState<App[] | null>(null);
  useEffect(() => {
    setApps(null);
    if (paths?.[0]) api.appsFor(paths[0]).then(setApps, (e) => (onError(e), setApps([])));
  }, [paths, onError]);

  const launch = (app: App) => {
    if (!paths) return;
    api.launchApp(app.id, paths).catch(onError);
    onClose();
  };

  return (
    <Dialog
      open={paths != null}
      onClose={onClose}
      width="sm"
      title={
        paths && paths.length === 1
          ? `„${baseName(paths[0]!)}“ öffnen mit …`
          : `${paths?.length} Dateien öffnen mit …`
      }
    >
      {apps == null ? (
        <p className="py-6 text-center text-meta text-muted">Suche Anwendungen …</p>
      ) : apps.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center text-meta text-muted">
          <Nyu shell="box" mood="puzzled" size={64} />
          Keine passende Anwendung gefunden.
        </div>
      ) : (
        <ul className="-mx-2 flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto">
          {apps.map((app) => (
            <li key={app.id}>
              <button
                type="button"
                onClick={() => launch(app)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-pink-tint/60 focus:bg-pink-tint/60 focus:outline-none"
              >
                {app.icon ? (
                  <img
                    src={fileUrl(app.icon)}
                    alt=""
                    className="size-8 shrink-0 object-contain"
                    draggable={false}
                  />
                ) : (
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-elevated text-muted">
                    <Icon icon={ICONS.openExternal} size="sm" />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-body">{app.name}</span>
                {app.default && (
                  <span className="rounded-full bg-pink-tint px-2 py-0.5 text-caption font-semibold text-pink-ink">
                    Standard
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export type NameQuestion = { kind: 'folder' | 'file' } | null;

export function NameDialog({
  dialog,
  onClose,
  onCreate,
}: {
  dialog: NameQuestion;
  onClose: () => void;
  onCreate: (kind: 'folder' | 'file', name: string) => void;
}) {
  const [name, setName] = useState('');
  const fallback = dialog?.kind === 'file' ? 'Neue Datei.txt' : 'Neuer Ordner';
  useEffect(() => {
    if (dialog) setName(fallback);
  }, [dialog, fallback]);
  const submit = () => dialog && name.trim() && onCreate(dialog.kind, name.trim());
  return (
    <Dialog
      open={dialog != null}
      onClose={onClose}
      width="sm"
      title={dialog?.kind === 'file' ? 'Neue Datei' : 'Neuer Ordner'}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>
            Anlegen
          </Button>
        </>
      }
    >
      <Field label="Name">
        {(id, describedBy) => (
          <TextInput
            id={id}
            aria-describedby={describedBy}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => {
              const dot = dialog?.kind === 'file' ? e.target.value.lastIndexOf('.') : -1;
              e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
            }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        )}
      </Field>
    </Dialog>
  );
}
