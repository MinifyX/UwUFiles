// Writes UwUFiles' brand SVGs (docs/app-icons.md in @uwusuite/design):
//
//   brand/uwufiles-app-icon.svg            Nyu as a folder on the pastel tile, with props
//   brand/uwufiles-taskbar-icon.svg        Nyu alone, upright, white die-cut edge
//   brand/uwufiles-taskbar-icon-small.svg  the simplified cut for 16/24 px and the tray
//   brand/uwufiles-symbol.svg              Nyu alone, for the About page and the README
//   brand/uwufiles-symbol-mono.svg         outlines only, in currentColor
//
//   node scripts/brand.mjs        (then `pnpm icons` makes the platform files)
//
// The folder cat is drawn on the terminal cat's 256 grid with its line weights and face, as
// docs/nyu.md asks of a new shell: ears behind, the folder's back with its tab, a sheet of paper
// sticking out, and the front panel as the face. It moves into the package's catalogue
// (`SHELLS`) once the suite wants it in more places than this app's icons.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Nyu's palette (NYU in @uwusuite/design/nyu-svg).
const C = {
  ink: '#4B1D3F',
  body: '#FF6FA6',
  flap: '#FFB8D3',
  blush: '#FF4D8D',
  paper: '#FFFFFF',
  star: '#FFD66E',
  sky: '#BDE6FF',
};

/** The folder cat on the 256 grid. `full`: inner ears, blush, paper lines (off for the small cut). */
function folderCat({ full = true, w = 1 } = {}) {
  const sw = (n) => n * w;
  const ears =
    `<path d="M62 88 L80 34 L116 84 Z" fill="${C.body}" stroke="${C.ink}" stroke-width="${sw(9)}"/>` +
    `<path d="M194 88 L176 34 L140 84 Z" fill="${C.body}" stroke="${C.ink}" stroke-width="${sw(9)}"/>` +
    (full
      ? `<g class="no-edge" fill="${C.flap}"><path d="M76 82 L83 52 L100 78 Z"/><path d="M180 82 L173 52 L156 78 Z"/></g>`
      : '');
  // The back of the folder, with its tab top left.
  const back = `<path d="M28 84 a16 16 0 0 1 16 -16 H86 a12 12 0 0 1 9 4 L108 88 H212 a16 16 0 0 1 16 16 V204 a16 16 0 0 1 -16 16 H44 a16 16 0 0 1 -16 -16 Z" fill="${C.body}" stroke="${C.ink}" stroke-width="${sw(9)}"/>`;
  // A sheet of paper, a little crooked, between back and front.
  const paper =
    `<g transform="rotate(-4 128 112)"><rect x="56" y="92" width="144" height="56" rx="6" fill="${C.paper}" stroke="${C.ink}" stroke-width="${sw(7)}"/>` +
    (full
      ? `<g class="no-edge" stroke="${C.flap}" stroke-width="6" stroke-linecap="round"><path d="M74 108 H150"/><path d="M74 120 H122"/></g>`
      : '') +
    `</g>`;
  // The front panel, slightly wider than the back, is the face.
  const front = `<path d="M22 130 a12 12 0 0 1 12 -12 H222 a12 12 0 0 1 12 12 L228 206 a16 16 0 0 1 -16 14 H44 a16 16 0 0 1 -16 -14 Z" fill="${C.flap}" stroke="${C.ink}" stroke-width="${sw(9)}"/>`;
  const line = `fill="none" stroke="${C.ink}" stroke-width="${sw(8)}" stroke-linecap="round" stroke-linejoin="round"`;
  const face =
    (full
      ? `<g class="no-edge" fill="${C.blush}" opacity="0.5"><ellipse cx="74" cy="172" rx="12" ry="7.5"/><ellipse cx="182" cy="172" rx="12" ry="7.5"/></g>`
      : '') +
    `<g ${line}><path d="M88 148 Q102 166 116 148"/><path d="M140 148 Q154 166 168 148"/></g>` +
    (full
      ? `<path d="M112 176 q8 13 16 0 q8 13 16 0" ${line}/>`
      : `<path d="M116 178 q6 9 12 0 q6 9 12 0" ${line}/>`);
  return ears + back + paper + front + face;
}

/** Outlines only, for monochrome places. */
function folderMono() {
  const s = `fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"`;
  return (
    `<g ${s}>` +
    `<path d="M62 88 L80 34 L116 84"/><path d="M194 88 L176 34 L140 84"/>` +
    `<path d="M28 84 a16 16 0 0 1 16 -16 H86 a12 12 0 0 1 9 4 L108 88 H212 a16 16 0 0 1 16 16 V118"/>` +
    `<path d="M22 130 a12 12 0 0 1 12 -12 H222 a12 12 0 0 1 12 12 L228 206 a16 16 0 0 1 -16 14 H44 a16 16 0 0 1 -16 -14 Z"/>` +
    `<path d="M88 148 Q102 166 116 148"/><path d="M140 148 Q154 166 168 148"/>` +
    `<path d="M112 176 q8 13 16 0 q8 13 16 0"/></g>`
  );
}

const EDGE_STYLE =
  '<style>.nyu-edge,.nyu-edge *{fill:#fff;stroke:#fff}.nyu-edge *{stroke-width:inherit}.nyu-edge .no-edge{display:none}</style>';

/** Drawn twice: a white die-cut edge, then the figure. */
const sticker = (edge, inner) => `<g class="nyu-edge" stroke-width="${edge}">${inner}</g>${inner}`;

// The figure's box on the 256 grid, with room for the edge.
const VB = { x: 6, y: 18, w: 244, h: 216 };

/** The cat `width` px wide, centred on (cx, cy), tilted by `tilt` degrees. */
const placed = (body, cx, cy, width, tilt = 0) => {
  const s = width / VB.w;
  return `<g transform="translate(${cx} ${cy}) rotate(${tilt}) scale(${s}) translate(${-(VB.x + VB.w / 2)} ${-(VB.y + VB.h / 2)})" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
};

const sparkle = (x, y, s) => `
  <g transform="translate(${x} ${y}) scale(${s})" stroke-linejoin="round">
    <path d="M0 -26 Q4 -4 26 0 Q4 4 0 26 Q-4 4 -26 0 Q-4 -4 0 -26 Z" fill="#fff" stroke="#fff" stroke-width="14"/>
    <path d="M0 -26 Q4 -4 26 0 Q4 4 0 26 Q-4 4 -26 0 Q-4 -4 0 -26 Z" fill="${C.star}" stroke="${C.ink}" stroke-width="6"/>
  </g>`;
const heart = (x, y, s) => `
  <g transform="translate(${x} ${y}) scale(${s})" stroke-linejoin="round">
    <path d="M0 18 C-30 -2 -24 -26 -8 -24 C-3 -23 0 -19 0 -15 C0 -19 3 -23 8 -24 C24 -26 30 -2 0 18 Z" fill="#fff" stroke="#fff" stroke-width="16"/>
    <path d="M0 18 C-30 -2 -24 -26 -8 -24 C-3 -23 0 -19 0 -15 C0 -19 3 -23 8 -24 C24 -26 30 -2 0 18 Z" fill="${C.body}" stroke="${C.ink}" stroke-width="6"/>
  </g>`;
// The app's thing: a little photo, the kind of file a file manager shows most.
const photo = (x, y, s, r) => `
  <g transform="translate(${x} ${y}) rotate(${r}) scale(${s})" stroke-linejoin="round" stroke-linecap="round">
    <rect x="-34" y="-28" width="68" height="56" rx="8" fill="#fff" stroke="#fff" stroke-width="20"/>
    <rect x="-34" y="-28" width="68" height="56" rx="8" fill="${C.sky}" stroke="${C.ink}" stroke-width="6"/>
    <path d="M-34 18 L-10 -4 L6 10 L16 2 L34 18 V20 a8 8 0 0 1 -8 8 H-26 a8 8 0 0 1 -8 -8 Z" fill="${C.body}" stroke="${C.ink}" stroke-width="5"/>
    <circle cx="16" cy="-12" r="6" fill="${C.star}" stroke="${C.ink}" stroke-width="4"/>
  </g>`;

const svg = (label, body, viewBox = '0 0 512 512') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="512" height="512" role="img" aria-label="${label}">
  <title>UwUFiles</title>
  <!-- Generated by scripts/brand.mjs. Edit the script, not this file. -->
  ${EDGE_STYLE}
  <defs>
    <linearGradient id="uwu-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF3F8"/><stop offset="1" stop-color="#FFD3E5"/></linearGradient>
    <filter id="uwu-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#C2306F" flood-opacity="0.25"/></filter>
  </defs>
  ${body}
</svg>
`;

const full = sticker(20, folderCat());

const files = {
  'uwufiles-app-icon.svg': svg(
    'UwUFiles app icon: Nyu as a folder with cat ears, a photo, a heart and a sparkle',
    `<rect width="512" height="512" rx="116" fill="url(#uwu-bg)"/>
  <g filter="url(#uwu-shadow)">${placed(full, 252, 286, 330, -7)}</g>
  ${photo(388, 382, 1.3, 10)}
  ${heart(112, 132, 1.45)}
  ${sparkle(396, 118, 1.45)}`,
  ),
  'uwufiles-taskbar-icon.svg': svg(
    'UwUFiles: a folder with cat ears',
    placed(sticker(28, folderCat({ w: 1.15 })), 256, 260, 460),
  ),
  'uwufiles-taskbar-icon-small.svg': svg(
    'UwUFiles: a folder with cat ears',
    placed(sticker(36, folderCat({ full: false, w: 1.6 })), 256, 260, 460),
  ),
  'uwufiles-symbol.svg': svg('UwUFiles: a folder with cat ears', placed(full, 256, 260, 440)),
  'uwufiles-symbol-mono.svg': svg(
    'UwUFiles',
    `<g color="#4B1D3F">${placed(folderMono(), 256, 260, 440)}</g>`,
  ),
};

for (const [name, content] of Object.entries(files))
  writeFileSync(join(root, 'brand', name), content);
console.log(`brand/: ${Object.keys(files).join(', ')}`);
