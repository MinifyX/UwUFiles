// Writes latest.json, the feed the updater plugin reads, from the release files in a folder:
// every `UwUFiles-linux-<arch>.AppImage` with its `.sig`, and `platform-<arch>.txt` saying
// which Tauri platform it is.
//
//   node scripts/update-feed.mjs <version> <dir> > latest.json

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [version, dir] = process.argv.slice(2);
if (!version || !dir) {
  console.error('usage: update-feed.mjs <version> <dir>');
  process.exit(1);
}

const base = `https://github.com/MinifyX/UwUFiles/releases/download/v${version}`;
const platforms = {};
for (const file of readdirSync(dir)) {
  const m = file.match(/^platform-(\w+)\.txt$/);
  if (!m) continue;
  const arch = m[1];
  const platform = readFileSync(join(dir, file), 'utf8').trim();
  const appimage = `UwUFiles-linux-${arch}.AppImage`;
  const signature = readFileSync(join(dir, `${appimage}.sig`), 'utf8').trim();
  platforms[platform] = { signature, url: `${base}/${appimage}` };
}
if (Object.keys(platforms).length === 0) {
  console.error(`No platform-*.txt in ${dir}`);
  process.exit(1);
}

let notes = '';
try {
  notes = readFileSync(`release-notes/${version}.md`, 'utf8').trim();
} catch {
  // A release without notes still gets a feed.
}

console.log(
  JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2),
);
