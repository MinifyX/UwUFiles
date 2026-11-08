import {
  cx,
  Dialog,
  Icon,
  ICONS,
  Nyu,
  Segmented,
  SettingRow,
  Toggle,
  Wordmark,
} from '@uwusuite/design';
import { getVersion } from '@tauri-apps/api/app';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { setSettings, useSettings } from '../lib/settings';

type Page = 'general' | 'appearance' | 'files' | 'about';

const PAGES: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'Allgemein', icon: ICONS.settings },
  { id: 'appearance', label: 'Darstellung', icon: ICONS.appearance },
  { id: 'files', label: 'Dateien', icon: ICONS.files },
  { id: 'about', label: 'Über UwUFiles', icon: ICONS.info },
];

/** Settings, as the suite lays them out: an `lg` dialog, a 170 px nav, setting rows, About last. */
export function SettingsDialog({
  open,
  onClose,
  onCheckUpdates,
}: {
  open: boolean;
  onClose: () => void;
  onCheckUpdates: () => void;
}) {
  const s = useSettings();
  const [page, setPage] = useState<Page>('general');
  const [version, setVersion] = useState('');
  useEffect(() => {
    getVersion().then(setVersion, () => setVersion('dev'));
  }, []);

  return (
    <Dialog open={open} onClose={onClose} width="lg" title="Einstellungen">
      <div className="flex min-h-[380px] gap-6 phone:flex-col">
        <nav
          aria-label="Bereiche"
          className="flex w-[170px] shrink-0 flex-col gap-0.5 phone:w-full phone:flex-row phone:overflow-x-auto"
        >
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-current={page === p.id ? 'page' : undefined}
              onClick={() => setPage(p.id)}
              className={cx(
                'flex h-9 shrink-0 items-center gap-2.5 rounded-xl px-3 text-left text-[13.5px]',
                page === p.id
                  ? 'bg-pink-tint font-semibold text-pink-ink'
                  : 'hover:bg-pink-tint/45',
              )}
            >
              <Icon icon={p.icon} className={page === p.id ? '' : 'text-muted'} />
              {p.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {page === 'general' && (
            <>
              <SettingRow label="Beim Start" description="Was ein neues Fenster zeigt.">
                <Segmented
                  label="Beim Start"
                  value={s.startup}
                  onChange={(startup) => setSettings({ startup })}
                  options={[
                    { value: 'home', label: 'Persönlicher Ordner' },
                    { value: 'restore', label: 'Letzte Tabs' },
                  ]}
                />
              </SettingRow>
              <Toggle
                label="Nach Updates suchen"
                description="Beim Start einmal auf GitHub nachsehen, ob es eine neue Version gibt."
                checked={s.checkUpdates}
                onChange={(checkUpdates) => setSettings({ checkUpdates })}
              />
              <SettingRow label="Jetzt nachsehen">
                <button
                  type="button"
                  onClick={onCheckUpdates}
                  className="text-meta font-semibold text-pink-ink hover:underline"
                >
                  Nach Updates suchen
                </button>
              </SettingRow>
            </>
          )}

          {page === 'appearance' && (
            <>
              <SettingRow label="Design">
                <Segmented
                  label="Design"
                  value={s.theme}
                  onChange={(theme) => setSettings({ theme })}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'light', label: 'Hell' },
                    { value: 'dark', label: 'Dunkel' },
                  ]}
                />
              </SettingRow>
              <SettingRow
                label="Kontrast"
                description="Hoher Kontrast: kräftige Linien, reines Schwarz und Weiß."
              >
                <Segmented
                  label="Kontrast"
                  value={s.contrast}
                  onChange={(contrast) => setSettings({ contrast })}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'high', label: 'Hoch' },
                  ]}
                />
              </SettingRow>
              <SettingRow label="Animationen">
                <Segmented
                  label="Animationen"
                  value={s.motion}
                  onChange={(motion) => setSettings({ motion })}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'on', label: 'An' },
                    { value: 'off', label: 'Aus' },
                  ]}
                />
              </SettingRow>
              <Toggle
                label="Detailbereich"
                description="Vorschau und Infos rechts neben dem Ordner (F11)."
                checked={s.details}
                onChange={(details) => setSettings({ details })}
              />
            </>
          )}

          {page === 'files' && (
            <>
              <Toggle
                label="Versteckte Dateien anzeigen"
                description="Namen, die mit einem Punkt beginnen (Strg+H)."
                checked={s.showHidden}
                onChange={(showHidden) => setSettings({ showHidden })}
              />
              <Toggle
                label="Ordner zuerst"
                checked={s.foldersFirst}
                onChange={(foldersFirst) => setSettings({ foldersFirst })}
              />
              <Toggle
                label="Vor dem Papierkorb nachfragen"
                description="Aus dem Papierkorb lässt sich alles zurückholen, deshalb ist das aus."
                checked={s.confirmTrash}
                onChange={(confirmTrash) => setSettings({ confirmTrash })}
              />
            </>
          )}

          {page === 'about' && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <Nyu shell="box" mood="happy" size={110} />
              <Wordmark product="Files" className="text-title" />
              <p className="text-meta text-muted">Version {version}</p>
              <p className="max-w-[340px] text-meta text-muted">
                Der Dateimanager der UwUSuite. Ordner, Laufwerke, Vorschauen, Kopieren und
                Verschieben – in Pink.
              </p>
              <p className="text-caption text-faint">
                © 2026 MinifyX · GPL-3.0 · UwU Sans unter SIL OFL 1.1
              </p>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
