//! The Tauri host.
//!
//! Thin on purpose: every command unpacks its arguments, calls one function in `uwufiles-core`
//! and hands the answer back. What is worth a test lives in the crate.
//!
//! The only state here is the folder watcher, so the window follows changes made elsewhere.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::{RecursiveMode, Watcher as _};
use serde::Serialize;
use tauri::{AppHandle, Emitter as _, Manager as _, State};
use uwufiles_core::listing::{self, Entry};
use uwufiles_core::ops::{self, Progress, Transfer};
use uwufiles_core::places::{self, Drive, Place};
use uwufiles_core::{Error, Result};

#[derive(Default)]
struct AppState {
    /// The watcher on the folder in view. Replacing it drops (and stops) the old one.
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Sidebar {
    places: Vec<Place>,
    drives: Vec<Drive>,
    trash: Option<PathBuf>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TransferProgress {
    job: String,
    #[serde(flatten)]
    progress: Progress,
}

/// Blocking work goes to a worker thread, so a big folder never freezes the window.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .unwrap_or_else(|e| Err(Error::Trash(format!("interner Fehler: {e}"))))
}

#[tauri::command]
async fn list_dir(path: PathBuf, show_hidden: bool) -> Result<Vec<Entry>> {
    blocking(move || listing::list(&path, show_hidden)).await
}

#[tauri::command]
fn entry_info(path: PathBuf) -> Result<Entry> {
    listing::entry(&path).ok_or(Error::NotFound(path))
}

/// Bytes under a folder, for the properties panel. Can take a while on a big tree.
#[tauri::command]
async fn tree_size(path: PathBuf) -> Result<u64> {
    blocking(move || Ok(ops::tree_size(&path))).await
}

#[tauri::command]
fn sidebar() -> Sidebar {
    let trash = dirs_trash().filter(|p| p.is_dir());
    Sidebar { places: places::places(), drives: places::drives(), trash }
}

/// The folder to show first: the one the app was started with (`uwufiles ~/Bilder`, or a
/// `file://` URI from "Ordner öffnen" in another app), otherwise the home folder.
#[tauri::command]
fn initial_path() -> PathBuf {
    std::env::args_os()
        .skip(1)
        .find_map(|a| folder_argument(&a.to_string_lossy()))
        .or_else(|| places::places().into_iter().next().map(|p| p.path))
        .unwrap_or_else(|| PathBuf::from("/"))
}

#[tauri::command]
fn open_path(path: PathBuf) -> Result<()> {
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| Error::Io { path, source: std::io::Error::other(e.to_string()) })
}

/// A terminal in `path`: $TERMINAL if set, otherwise the first one that is installed.
#[tauri::command]
fn open_terminal(path: PathBuf) -> Result<()> {
    let mut candidates: Vec<String> = std::env::var("TERMINAL").into_iter().collect();
    candidates.extend(
        ["konsole", "kitty", "alacritty", "wezterm", "foot", "gnome-terminal", "xfce4-terminal", "xterm"]
            .map(String::from),
    );
    for program in candidates {
        let started = std::process::Command::new(&program).current_dir(&path).spawn();
        if started.is_ok() {
            return Ok(());
        }
    }
    Err(Error::Io { path, source: std::io::Error::other("Kein Terminal gefunden.") })
}

#[tauri::command]
fn create_dir(parent: PathBuf, name: String) -> Result<PathBuf> {
    ops::create_dir(&parent, &name)
}

#[tauri::command]
fn create_file(parent: PathBuf, name: String) -> Result<PathBuf> {
    ops::create_file(&parent, &name)
}

#[tauri::command]
fn rename(path: PathBuf, new_name: String) -> Result<PathBuf> {
    ops::rename(&path, &new_name)
}

#[tauri::command]
async fn trash(paths: Vec<PathBuf>) -> Result<()> {
    blocking(move || ops::trash(&paths)).await
}

/// Copies or moves, reporting progress as `transfer:progress` events for job `job`.
#[tauri::command]
async fn transfer(
    app: AppHandle,
    job: String,
    sources: Vec<PathBuf>,
    dest: PathBuf,
    mode: Transfer,
) -> Result<Vec<PathBuf>> {
    blocking(move || {
        let mut last = std::time::Instant::now();
        ops::transfer(&sources, &dest, mode, |progress| {
            // A few updates a second is plenty for a progress bar.
            if last.elapsed().as_millis() >= 80 || progress.done_bytes == progress.total_bytes {
                last = std::time::Instant::now();
                let _ = app.emit(
                    "transfer:progress",
                    TransferProgress { job: job.clone(), progress: progress.clone() },
                );
            }
        })
    })
    .await
}

/// Watches `path` (not its subfolders) and emits `dir:changed` with it when something changes.
#[tauri::command]
fn watch_dir(app: AppHandle, state: State<'_, AppState>, path: PathBuf) -> Result<()> {
    let watched = path.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok_and(|e| !e.kind.is_access()) {
            let _ = app.emit("dir:changed", &watched);
        }
    })
    .map_err(|e| Error::Io { path: path.clone(), source: std::io::Error::other(e.to_string()) })?;
    // A folder that cannot be watched (some network mounts) still works, it just doesn't follow.
    let _ = watcher.watch(&path, RecursiveMode::NonRecursive);
    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
}

fn dirs_trash() -> Option<PathBuf> {
    if cfg!(target_os = "linux") {
        let data = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| Path::new(&h).join(".local/share")))?;
        Some(data.join("Trash/files"))
    } else {
        None
    }
}

/// A folder from the command line: a path or a `file://` URI. A file opens its folder.
fn folder_argument(arg: &str) -> Option<PathBuf> {
    if arg.starts_with('-') {
        return None;
    }
    let path = match arg.strip_prefix("file://") {
        Some(rest) => PathBuf::from(percent_decode(rest.trim_start_matches("localhost"))),
        None => PathBuf::from(arg),
    };
    let path = std::fs::canonicalize(&path).ok()?;
    if path.is_dir() {
        Some(path)
    } else {
        path.parent().map(Path::to_path_buf)
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(b) = s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn run() {
    let builder = tauri::Builder::default();

    // First, so a second start is turned away before it builds anything.
    #[cfg(any(windows, target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        if let Some(folder) = argv.iter().skip(1).find_map(|a| folder_argument(a)) {
            let _ = app.emit("open-folder", folder);
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    builder
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_dir,
            entry_info,
            tree_size,
            sidebar,
            initial_path,
            open_path,
            open_terminal,
            create_dir,
            create_file,
            rename,
            trash,
            transfer,
            watch_dir,
        ])
        .run(tauri::generate_context!())
        .expect("UwUFiles could not start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_file_uris() {
        assert_eq!(percent_decode("/home/mini/Neuer%20Ordner"), "/home/mini/Neuer Ordner");
        assert_eq!(percent_decode("/x/%C3%BC"), "/x/ü");
        assert_eq!(percent_decode("/50%"), "/50%");
    }
}
