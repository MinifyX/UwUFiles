/**
 * "Netzlaufwerk verbinden": a server (found in the network or typed), one of its shares, and for
 * SMB a user and password. NFS needs no password, but the system asks for the admin password once,
 * to put the share in /etc/fstab.
 */

import {
  Button,
  cx,
  Dialog,
  Field,
  Icon,
  ICONS,
  Nyu,
  Segmented,
  TextInput,
  Toggle,
} from '@uwusuite/design';
import { useEffect, useState } from 'react';
import {
  api,
  errorText,
  type Connected,
  type Export,
  type Protocol,
  type Server,
  type Share,
} from '../lib/api';
import type { SavedShare } from '../lib/settings';

export const shareId = (s: Share) =>
  `${s.protocol}:${s.user ? `${s.user}@` : ''}${s.host}:${s.share}`;

export const shareLabel = (s: Share) => s.share.split('/').filter(Boolean).pop() ?? s.host;

/** What the user pasted into the server field: `smb://nas/daten`, `\\nas\daten`, `nas:/volume1/x`. */
export function parseAddress(text: string): Partial<Share> | null {
  const s = text.trim();
  const smb = s.match(/^(?:smb:\/\/|\\\\)(?:([^@/\\]+)@)?([^/\\]+)[/\\]?([^/\\]*)/i);
  if (smb) {
    const auth = smb[1]?.split(':')[0];
    const [domain, user] = auth?.includes(';') ? auth.split(';') : [null, auth ?? null];
    return { protocol: 'smb', host: smb[2]!, share: smb[3] ?? '', user, domain };
  }
  const nfs = s.match(/^nfs:\/\/([^/]+)(\/.*)$/i) ?? s.match(/^([^/:\s]+):(\/.*)$/);
  if (nfs) return { protocol: 'nfs', host: nfs[1]!, share: nfs[2]!.replace(/\/+$/, '') };
  return null;
}

export interface ConnectRequest {
  /** A saved share whose password was wrong or missing: the form starts filled in. */
  share?: SavedShare;
  error?: string;
}

export function ConnectDialog({
  request,
  onClose,
  onConnected,
}: {
  request: ConnectRequest | null;
  onClose: () => void;
  onConnected: (share: SavedShare, where: Connected) => void;
}) {
  const open = request != null;
  const [protocol, setProtocol] = useState<Protocol>('smb');
  const [host, setHost] = useState('');
  const [share, setShare] = useState('');
  const [user, setUser] = useState('');
  const [domain, setDomain] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [servers, setServers] = useState<Server[] | null>(null);
  const [listed, setListed] = useState<{ host: string; items: (Export | string)[] } | null>(null);
  const [listing, setListing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    const s = request.share;
    setProtocol(s?.protocol ?? 'smb');
    setHost(s?.host ?? '');
    setShare(s?.share ?? '');
    setUser(s?.user ?? '');
    setDomain(s?.domain ?? '');
    setPassword('');
    setRemember(true);
    setListed(null);
    setError(request.error ?? null);
    setServers(null);
    api.networkDiscover().then(setServers, () => setServers([]));
  }, [request]);

  const takeAddress = (text: string) => {
    const parsed = parseAddress(text);
    if (!parsed) return false;
    if (parsed.protocol) setProtocol(parsed.protocol);
    if (parsed.host) setHost(parsed.host);
    if (parsed.share) setShare(parsed.share);
    if (parsed.user) setUser(parsed.user);
    if (parsed.domain) setDomain(parsed.domain);
    return true;
  };

  const list = async () => {
    if (!host.trim()) return;
    setListing(true);
    setError(null);
    try {
      const items =
        protocol === 'nfs'
          ? await api.networkExports(host.trim())
          : await api.networkShares(host.trim(), user || null, password || null, domain || null);
      setListed({ host: host.trim(), items });
      if (items.length === 0)
        setError('Der Server nennt keine Freigaben. Du kannst den Namen auch eintippen.');
    } catch (e) {
      setError(errorText(e));
      setListed(null);
    } finally {
      setListing(false);
    }
  };

  const connect = async () => {
    const target: Share = {
      protocol,
      host: host.trim(),
      share: protocol === 'nfs' && !share.startsWith('/') ? `/${share.trim()}` : share.trim(),
      user: protocol === 'smb' && user.trim() ? user.trim() : null,
      domain: protocol === 'smb' && domain.trim() ? domain.trim() : null,
    };
    setBusy(true);
    setError(null);
    try {
      const where = await api.networkConnect(target, password || null, remember);
      const saved: SavedShare = {
        ...target,
        id: shareId(target),
        label: request?.share?.label ?? shareLabel(target),
      };
      onConnected(saved, where);
    } catch (e) {
      const text = errorText(e);
      // Closing the admin password dialog is not an error worth a red line.
      setError(text === 'Abgebrochen.' ? null : text);
    } finally {
      setBusy(false);
    }
  };

  const shown = servers?.filter((s) => s.protocols.includes(protocol)) ?? [];
  const items = listed && listed.host === host.trim() ? listed.items : null;
  const ready = host.trim() !== '' && share.trim() !== '' && !busy;

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      width="md"
      title={request?.share ? `Mit „${request.share.label}“ verbinden` : 'Netzlaufwerk verbinden'}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            icon={ICONS.connect}
            busy={busy}
            disabled={!ready}
            onClick={connect}
          >
            Verbinden
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) connect();
        }}
      >
        <Segmented
          label="Protokoll"
          value={protocol}
          onChange={(p) => {
            setProtocol(p);
            setListed(null);
            setError(null);
          }}
          options={[
            { value: 'smb', label: 'SMB (Windows, Synology, Samba)' },
            { value: 'nfs', label: 'NFS (Linux, Unix)' },
          ]}
        />

        <div className="flex flex-col gap-2">
          <Field
            label="Server"
            hint="Name oder Adresse. Du kannst auch smb://… oder nas:/pfad einfügen."
          >
            {(id, describedBy) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                value={host}
                autoFocus={!request?.share}
                placeholder="nas.local oder 192.168.1.20"
                spellCheck={false}
                onChange={(e) => {
                  if (!takeAddress(e.target.value)) setHost(e.target.value);
                }}
              />
            )}
          </Field>
          {servers == null ? (
            <p className="flex items-center gap-2 text-caption text-muted">
              <Icon icon={ICONS.loading} size="xs" className="animate-spin" />
              Suche im Netzwerk …
            </p>
          ) : (
            shown.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="Im Netzwerk gefunden">
                {shown.map((s) => (
                  <button
                    key={s.host}
                    type="button"
                    onClick={() => {
                      setHost(s.host);
                      setListed(null);
                    }}
                    title={s.host}
                    className={cx(
                      'flex h-8 items-center gap-1.5 rounded-full border px-3 text-meta transition-colors',
                      host === s.host
                        ? 'border-pink bg-pink-tint font-semibold text-pink-ink'
                        : 'border-line hover:bg-pink-tint/45',
                    )}
                  >
                    <Icon icon={ICONS.server} size="xs" />
                    {s.name}
                  </button>
                ))}
              </div>
            )
          )}
        </div>

        {protocol === 'smb' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Benutzer">
              {(id) => (
                <TextInput
                  id={id}
                  value={user}
                  autoComplete="username"
                  spellCheck={false}
                  placeholder="leer: als Gast"
                  onChange={(e) => setUser(e.target.value)}
                />
              )}
            </Field>
            <Field label="Passwort">
              {(id) => (
                <TextInput
                  id={id}
                  type="password"
                  value={password}
                  autoFocus={!!request?.share}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <Field
              label="Freigabe"
              className="flex-1"
              hint={
                protocol === 'nfs' ? 'Der Pfad auf dem Server, z. B. /volume1/Backups' : undefined
              }
            >
              {(id, describedBy) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  value={share}
                  spellCheck={false}
                  placeholder={protocol === 'nfs' ? '/volume1/daten' : 'daten'}
                  onChange={(e) => setShare(e.target.value)}
                />
              )}
            </Field>
            <Button
              type="button"
              icon={ICONS.search}
              busy={listing}
              disabled={!host.trim() || listing}
              onClick={list}
              className={protocol === 'nfs' ? 'mb-[26px]' : undefined}
            >
              Freigaben zeigen
            </Button>
          </div>
          {items && items.length > 0 && (
            <ul className="uwu-scroll flex max-h-44 flex-col gap-0.5 overflow-y-auto rounded-xl border border-hairline p-1">
              {items.map((item) => {
                const name = typeof item === 'string' ? item : item.path;
                const clients = typeof item === 'string' ? null : item.clients;
                const on = share === name;
                return (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => setShare(name)}
                      className={cx(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-meta',
                        on ? 'bg-pink-tint font-semibold text-pink-ink' : 'hover:bg-pink-tint/45',
                      )}
                    >
                      <Icon
                        icon={ICONS.folder}
                        size="sm"
                        className={on ? 'text-pink-ink' : 'text-muted'}
                      />
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      {clients && (
                        <span
                          className="max-w-[45%] truncate text-caption font-normal text-muted"
                          title={clients.join(', ')}
                        >
                          {clients.includes('*') ? 'für alle' : clients.join(', ')}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {protocol === 'smb' ? (
          <Toggle
            checked={remember}
            onChange={setRemember}
            label="Passwort im Schlüsselbund merken"
            description="Dann verbindet ein Klick in der Seitenleiste ohne Nachfrage."
          />
        ) : (
          <p className="flex gap-2.5 rounded-xl bg-pink-tint/50 p-3 text-caption text-muted">
            <Icon icon={ICONS.info} size="sm" className="mt-px shrink-0 text-pink-ink" />
            <span>
              Beim ersten Verbinden fragt das System einmal nach dem Admin-Passwort: UwUFiles trägt
              die Freigabe in <code>/etc/fstab</code> ein, danach geht es ohne. Die Version handeln
              Rechner und NAS selbst aus, die neueste zuerst (NFS 4.2, dann 4.1 …). Der NAS muss
              diesem Rechner den Zugriff erlauben.
            </span>
          </p>
        )}

        {error && (
          <div role="alert" className="flex items-center gap-3 rounded-xl bg-danger-tint p-3">
            <Nyu shell="box" mood="puzzled" size={44} />
            <p className="text-meta text-danger-ink">{error}</p>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
