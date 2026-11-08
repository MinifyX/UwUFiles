// Renders packaging/aur/uwufiles-bin/PKGBUILD.in for a published release, with the checksums
// from its SHA256SUMS.txt.
//
//   node scripts/pkgbuild.mjs 0.1.0 [out-dir]     (default out-dir: packaging/aur/uwufiles-bin)
//
// Then `cd <out-dir> && makepkg -si` builds and installs the pacman package.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [version, out = join(root, 'packaging/aur/uwufiles-bin')] = process.argv.slice(2);
if (!version) {
  console.error('usage: pkgbuild.mjs <version> [out-dir]');
  process.exit(1);
}

const url = `https://github.com/MinifyX/UwUFiles/releases/download/v${version}/SHA256SUMS.txt`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`${url}: ${res.status}. Is v${version} published?`);
  process.exit(1);
}
const sums = Object.fromEntries(
  (await res.text())
    .trim()
    .split('\n')
    .map((line) => line.split(/\s+/).reverse()),
);
const sum = (file) => {
  if (!sums[file]) throw new Error(`${file} is not in SHA256SUMS.txt`);
  return sums[file];
};

const pkgbuild = readFileSync(join(root, 'packaging/aur/uwufiles-bin/PKGBUILD.in'), 'utf8')
  .replaceAll('@VERSION@', version)
  .replaceAll('@PKGVER@', version.replaceAll('-', '_'))
  .replaceAll('@SHA256_X86_64@', sum('UwUFiles-linux-x64.deb'))
  .replaceAll('@SHA256_AARCH64@', sum('UwUFiles-linux-arm64.deb'));
writeFileSync(join(out, 'PKGBUILD'), pkgbuild);
console.log(`${join(out, 'PKGBUILD')} for ${version}`);
