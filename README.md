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

- Sidebar with your folders, favourites, the trash and mounted drives (with a fill bar)
- Tiles (three sizes, picture previews) or a list with sortable columns
- Breadcrumb path bar; click the empty part or press Strg+L to type a path
- Select with click, Strg, Umschalt, a rubber band, or the arrow keys
- Copy, cut, paste, duplicate, rename in place, new folder or file, trash — never a hard delete
- Drag and drop onto folders and sidebar places (Strg while dropping copies)
- Details panel: big preview, video and audio playback, folder size on request
- The window follows the folder: changes made elsewhere show up on their own
- Light and dark, from `@uwusuite/design`

## Keys

| Key | |
| --- | --- |
| Enter / double-click | Open |
| Backspace, Alt+← / Alt+→ | Back / forward |
| Alt+↑ | Parent folder |
| F2 | Rename |
| Entf | To the trash |
| Strg+C / X / V | Copy / cut / paste |
| Strg+A | Select all |
| Strg+H | Hidden files |
| Strg+L / Strg+F | Path / search |
| Strg+Umschalt+N | New folder |
| Strg++ / Strg+− | Bigger / smaller tiles |
| F5 / F11 | Reload / details panel |

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

## Licence

GPL-3.0-only, like UwUNotes.
