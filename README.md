<p align="center">
  <img src="brand/uwufiles-app-icon.svg" width="112" alt="UwUFiles logo" />
</p>

<h1 align="center">UwUFiles</h1>

<p align="center">
  The file manager of the UwUSuite. (◕‿◕✿)<br/>
  Folders · drives · previews · copy and move — in pink
</p>

---

## What it does (0.1)

- Tabs, like a browser: Strg+T, Strg+W, Strg+Tab, middle-click a folder
- Sidebar with your folders, favourites, the trash and mounted drives (with a fill bar)
- Tiles (three sizes, picture previews) or a list with sortable columns
- Breadcrumb path bar; click the empty part or press Strg+L to type a path
- Select with click, Strg, Umschalt, a rubber band, or the arrow keys
- Copy, cut, paste, duplicate, rename in place, new folder or file, drag and drop
- Progress with a cancel button; a taken name asks: replace (the old one goes to the trash), keep both, or skip
- Trash: everything deleted goes there and comes back with "Wiederherstellen"
- "Öffnen mit …" with every installed app that opens the file
- Details panel: big preview, video and audio playback, folder size on request
- Settings (Strg+,): theme, contrast, motion, start with the last tabs, updates
- Updates: the AppImage updates itself; pacman and apt copies are left to the package manager

## Keys

| Key                      |                        |
| ------------------------ | ---------------------- |
| Enter / double-click     | Open                   |
| Backspace, Alt+← / Alt+→ | Back / forward         |
| Alt+↑                    | Parent folder          |
| F2                       | Rename                 |
| Entf                     | To the trash           |
| Strg+C / X / V           | Copy / cut / paste     |
| Strg+A                   | Select all             |
| Strg+H                   | Hidden files           |
| Strg+L / Strg+F          | Path / search          |
| Strg+Umschalt+N          | New folder             |
| Strg++ / Strg+−          | Bigger / smaller tiles |
| F5 / F11                 | Reload / details panel |

## Develop

```sh
pnpm install
pnpm dev                 # the app
cargo test --workspace   # uwufiles-core against temporary folders
pnpm icons               # brand SVGs from the Nyu catalogue, then the platform icons
```

Opening http://localhost:1424 in a plain browser while `pnpm dev` runs shows the
window with sample data (`apps/desktop/src/lib/mock.ts`), handy for design work.

## Layout

- `crates/uwufiles-core` — listing, copy/move/rename/trash, places and drives. Tested.
- `apps/desktop/src-tauri` — thin Tauri commands over the crate, plus the folder watcher.
- `apps/desktop/src` — React + `@uwusuite/design`.

## Release

1. `node scripts/version.mjs 0.2.0` — the version in all four places
2. Write `release-notes/0.2.0.md`
3. Commit, `git tag v0.2.0 && git push --tags`

`.github/workflows/release.yml` builds the .deb, .rpm and AppImage for x64 and arm64, signs the
AppImage with the updater key (secrets `TAURI_SIGNING_PRIVATE_KEY` and `…_PASSWORD`; the key and
its password are in `~/Dokumente/UwUFiles-Update-Schluessel`), and publishes the release with
`SHA256SUMS.txt` and `latest.json`, the feed every installed copy reads.

For CachyOS: `node scripts/pkgbuild.mjs 0.2.0` renders the PKGBUILD with the release's checksums,
then `makepkg -si` in `packaging/aur/uwufiles-bin`.

## Brand

`node scripts/brand.mjs` draws Nyu as a folder (on the terminal cat's 256 grid, with its face)
into `brand/`; `pnpm icons` makes every platform icon from it.

## Licence

GPL-3.0-only, like UwUNotes.
