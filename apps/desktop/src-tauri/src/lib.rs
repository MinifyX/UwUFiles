//! The Tauri host.
//!
//! Thin on purpose: every command unpacks its arguments, calls one function in `uwufiles-core`
//! and hands the answer back. What is worth a test lives in the crate.
//!
//! The only state here is the folder watcher, so the window follows changes made elsewhere.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use notify::{RecursiveMode, Watcher as _};
use serde::Serialize;
use tauri::{AppHandle, Emitter as _, Manager as _, State};
use uwufiles_core::apps::{self, App};
use uwufiles_core::listing::{self, Entry};
use uwufiles_core::ops::{self, Conflict, Progress, Transfer};
use uwufiles_core::places::{self, Drive, Place};
use uwufiles_core::trashbin::{self, TrashEntry};
use uwufiles_core::{Error, Result};

#[derive(Default)]
struct AppState {
    /// The watcher on the folder in view. Replacing it drops (and stops) the old one.
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    /// The stop flag of every copy or move still running, by the job id the page gave it.
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Sidebar {
    places: Vec<Place>,
    drives: Vec<Drive>,
    /// Whether the system has a trash the window can show and restore from.
    trash: bool,
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
    Sidebar {
        places: places::places(),
        drives: places::drives(),
        trash: trashbin::SUPPORTED,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Start {
    path: PathBuf,
    /// The folder came from the command line, so the last session's tabs are not restored.
    explicit: bool,
}

/// The folder to show first: the one the app was started with (`uwufiles ~/Bilder`, or a
/// `file://` URI from "Ordner öffnen" in another app), otherwise the home folder.
#[tauri::command]
fn initial_path() -> Start {
    match std::env::args_os()
        .skip(1)
        .find_map(|a| folder_argument(&a.to_string_lossy()))
    {
        Some(path) => Start {
            path,
            explicit: true,
        },
        None => Start {
            path: places::places()
                .into_iter()
                .next()
                .map(|p| p.path)
                .unwrap_or_else(|| PathBuf::from("/")),
            explicit: false,
        },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    version: String,
    notes: Option<String>,
    /// Whether this copy can update itself. An AppImage can; a copy pacman or apt installed is
    /// theirs to update, so the window only says there is a new version.
    can_install: bool,
}

fn self_updating() -> bool {
    if cfg!(target_os = "linux") {
        std::env::var_os("APPIMAGE").is_some()
    } else {
        true
    }
}

#[tauri::command]
async fn check_update(app: AppHandle) -> std::result::Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt as _;
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo {
        version: u.version,
        notes: u.body,
        can_install: self_updating(),
    }))
}

/// Downloads, checks the signature, installs and starts the new version.
#[tauri::command]
async fn install_update(app: AppHandle) -> std::result::Result<(), String> {
    use tauri_plugin_updater::UpdaterExt as _;
    if !self_updating() {
        return Err("Diese Kopie wird vom Paketmanager aktualisiert.".into());
    }
    let Some(update) = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(());
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

#[tauri::command]
fn open_path(path: PathBuf) -> Result<()> {
    tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| Error::Io {
        path,
        source: std::io::Error::other(e.to_string()),
    })
}

/// A web page in the default browser. Only the project's own pages: the page cannot send the
/// user anywhere else through this.
#[tauri::command]
fn open_url(url: String) -> Result<()> {
    if !url.starts_with("https://github.com/MinifyX/UwUFiles") {
        return Err(Error::InvalidName(url));
    }
    tauri_plugin_opener::open_url(&url, None::<&str>).map_err(|e| Error::Io {
        path: url.into(),
        source: std::io::Error::other(e.to_string()),
    })
}

/// A terminal in `path`: $TERMINAL if set, otherwise the first one that is installed.
#[tauri::command]
fn open_terminal(path: PathBuf) -> Result<()> {
    let mut candidates: Vec<String> = std::env::var("TERMINAL").into_iter().collect();
    candidates.extend(
        [
            "konsole",
            "kitty",
            "alacritty",
            "wezterm",
            "foot",
            "gnome-terminal",
            "xfce4-terminal",
            "xterm",
        ]
        .map(String::from),
    );
    for program in candidates {
        let started = std::process::Command::new(&program)
            .current_dir(&path)
            .spawn();
        if started.is_ok() {
            return Ok(());
        }
    }
    Err(Error::Io {
        path,
        source: std::io::Error::other("Kein Terminal gefunden."),
    })
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

/// The names that are already taken in `dest`, so the page can ask before pasting.
#[tauri::command]
fn conflicts(sources: Vec<PathBuf>, dest: PathBuf) -> Vec<String> {
    ops::conflicts(&sources, &dest)
}

/// Copies or moves, reporting progress as `transfer:progress` events for job `job`.
#[tauri::command]
async fn transfer(
    app: AppHandle,
    state: State<'_, AppState>,
    job: String,
    sources: Vec<PathBuf>,
    dest: PathBuf,
    mode: Transfer,
    on_conflict: Option<Conflict>,
) -> Result<Vec<PathBuf>> {
    let stop = Arc::new(AtomicBool::new(false));
    state.jobs.lock().unwrap().insert(job.clone(), stop.clone());
    let id = job.clone();
    let result = blocking(move || {
        let mut last = std::time::Instant::now();
        ops::transfer(
            &sources,
            &dest,
            mode,
            on_conflict.unwrap_or_default(),
            &stop,
            |progress| {
                // A few updates a second is plenty for a progress bar.
                if last.elapsed().as_millis() >= 80 || progress.done_bytes == progress.total_bytes {
                    last = std::time::Instant::now();
                    let _ = app.emit(
                        "transfer:progress",
                        TransferProgress {
                            job: id.clone(),
                            progress: progress.clone(),
                        },
                    );
                }
            },
        )
    })
    .await;
    state.jobs.lock().unwrap().remove(&job);
    result
}

#[tauri::command]
fn cancel_transfer(state: State<'_, AppState>, job: String) {
    if let Some(stop) = state.jobs.lock().unwrap().get(&job) {
        stop.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
async fn trash_list() -> Result<Vec<TrashEntry>> {
    blocking(trashbin::list).await
}

#[tauri::command]
async fn trash_restore(ids: Vec<String>) -> Result<()> {
    blocking(move || trashbin::restore(&ids)).await
}

#[tauri::command]
async fn trash_purge(ids: Vec<String>) -> Result<()> {
    blocking(move || trashbin::purge(&ids)).await
}

#[tauri::command]
async fn trash_empty() -> Result<()> {
    blocking(trashbin::empty).await
}

/// The apps that can open `path`, the system's default first.
#[tauri::command]
async fn apps_for(path: PathBuf) -> Result<Vec<App>> {
    blocking(move || {
        let mime = apps::mime_type(&path);
        let default = apps::default_app(&mime);
        Ok(apps::apps_for(
            &mime,
            &apps::data_dirs(),
            default.as_deref(),
        ))
    })
    .await
}

#[tauri::command]
async fn launch_app(id: String, paths: Vec<PathBuf>) -> Result<()> {
    blocking(move || apps::launch(&id, &paths, &apps::data_dirs())).await
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
    .map_err(|e| Error::Io {
        path: path.clone(),
        source: std::io::Error::other(e.to_string()),
    })?;
    // A folder that cannot be watched (some network mounts) still works, it just doesn't follow.
    let _ = watcher.watch(&path, RecursiveMode::NonRecursive);
    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
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
            if let Some(b) = s
                .get(i + 1..i + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
            {
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_dir,
            entry_info,
            tree_size,
            sidebar,
            initial_path,
            open_path,
            open_terminal,
            open_url,
            create_dir,
            create_file,
            rename,
            trash,
            conflicts,
            transfer,
            cancel_transfer,
            trash_list,
            trash_restore,
            trash_purge,
            trash_empty,
            apps_for,
            launch_app,
            check_update,
            install_update,
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
        assert_eq!(
            percent_decode("/home/mini/Neuer%20Ordner"),
            "/home/mini/Neuer Ordner"
        );
        assert_eq!(percent_decode("/x/%C3%BC"), "/x/ü");
        assert_eq!(percent_decode("/50%"), "/50%");
    }
}
