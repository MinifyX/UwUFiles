// The version lives in four files. This keeps them together.
//
//   node scripts/version.mjs 0.2.0    writes it into all four
//   node scripts/version.mjs --check  prints it, or fails if the four disagree

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = {
  'package.json': /("version":\s*")([^"]+)(")/,
  'apps/desktop/package.json': /("version":\s*")([^"]+)(")/,
  'apps/desktop/src-tauri/tauri.conf.json': /("version":\s*")([^"]+)(")/,
  'Cargo.toml': /(\[workspace\.package\][^[]*?version\s*=\s*")([^"]+)(")/,
};

const read = (file) => readFileSync(join(root, file), 'utf8');
const versions = Object.fromEntries(
  Object.entries(FILES).map(([file, re]) => [file, read(file).match(re)?.[2]]),
);

const arg = process.argv[2];
if (!arg || arg === '--check') {
  const all = new Set(Object.values(versions));
  if (all.size !== 1 || all.has(undefined)) {
    console.error('The versions disagree:', versions);
    process.exit(1);
  }
  console.log([...all][0]);
} else {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(arg)) {
    console.error(`"${arg}" is not a version like 0.2.0`);
    process.exit(1);
  }
  for (const [file, re] of Object.entries(FILES))
    writeFileSync(join(root, file), read(file).replace(re, `$1${arg}$3`));
  console.log(
    `${arg} in ${Object.keys(FILES).join(', ')}. Cargo.lock follows on the next cargo build.`,
  );
}
