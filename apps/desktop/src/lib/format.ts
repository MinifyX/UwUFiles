/** Numbers and paths as the window writes them, in German. */

const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'Byte' : 'Bytes'}`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

export function formatCount(n: number, one: string, many: string): string {
  return `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const timeFormat = new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' });

/** "Heute, 14:02", "Gestern, 09:15", otherwise date and time. */
export function formatDate(ms: number | null): string {
  if (ms == null) return '–';
  const date = new Date(ms);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ms >= startOfToday) return `Heute, ${timeFormat.format(date)}`;
  if (ms >= startOfToday - 86_400_000) return `Gestern, ${timeFormat.format(date)}`;
  return dateFormat.format(date);
}

export const SEP = navigator.userAgent.includes('Windows') ? '\\' : '/';

export function parentOf(path: string): string | null {
  const trimmed = path.length > 1 ? path.replace(/[\\/]+$/, '') : path;
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (i < 0 || trimmed === '/') return null;
  return i === 0 ? '/' : trimmed.slice(0, i);
}

export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || path;
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') || dir.endsWith('\\') ? dir + name : dir + SEP + name;
}

/** The breadcrumb: every folder from the root down to `path`, with the home folder as "~". */
/**
 * Folders that stand for something else: a connected network share lives under a path like
 * `/run/user/1000/kio-fuse-AbC/smb/mini@nas/daten`, but the path bar and tab say "daten".
 */
let roots: { path: string; name: string }[] = [];
export function setRoots(next: { path: string; name: string }[]) {
  roots = [...next].sort((a, b) => b.path.length - a.path.length);
}
export function rootFor(path: string) {
  return roots.find((r) => path === r.path || path.startsWith(r.path + SEP));
}

export type CrumbIcon = 'home' | 'drive' | 'network';

export function crumbs(
  path: string,
  home: string | null,
): { name: string; path: string; icon?: CrumbIcon }[] {
  const out: { name: string; path: string; icon?: CrumbIcon }[] = [];
  let rest = path;
  let base = '/';
  const root = rootFor(path);
  if (root) {
    out.push({ name: root.name, path: root.path, icon: 'network' });
    rest = path.slice(root.path.length);
    base = root.path;
  } else if (home && (path === home || path.startsWith(home + SEP))) {
    out.push({ name: 'Persönlicher Ordner', path: home, icon: 'home' });
    rest = path.slice(home.length);
    base = home;
  } else {
    out.push({ name: 'System', path: '/', icon: 'drive' });
  }
  for (const part of rest.split(/[\\/]/).filter(Boolean)) {
    base = joinPath(base, part);
    out.push({ name: part, path: base });
  }
  return out;
}
