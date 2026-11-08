//! "Öffnen mit …": the installed applications that can open a file, read from the
//! `.desktop` files of the freedesktop.org menu spec, and starting one with files.
//!
//! Everything takes the data folders as an argument, so the tests can use their own.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

use crate::{Error, Result};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct App {
    /// The desktop file id, e.g. `org.kde.kate.desktop`.
    pub id: String,
    pub name: String,
    /// A picture of the app's icon on disk, if one was found.
    pub icon: Option<PathBuf>,
    /// The system's default for this kind of file.
    pub default: bool,
    #[serde(skip)]
    exec: String,
    #[serde(skip)]
    mime_types: Vec<String>,
}

/// `$XDG_DATA_HOME` first, then `$XDG_DATA_DIRS`, as the spec orders them.
pub fn data_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(home) = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".local/share")))
    {
        out.push(home);
    }
    let system = std::env::var("XDG_DATA_DIRS").unwrap_or_default();
    let system = if system.is_empty() {
        "/usr/local/share:/usr/share".to_string()
    } else {
        system
    };
    out.extend(
        system
            .split(':')
            .filter(|s| !s.is_empty())
            .map(PathBuf::from),
    );
    out
}

/// The kind of file `path` is, as a MIME type. Asks shared-mime-info (`xdg-mime`), which also
/// looks inside the file; falls back to the extension.
pub fn mime_type(path: &Path) -> String {
    if path.is_dir() {
        return "inode/directory".into();
    }
    if let Ok(out) = Command::new("xdg-mime")
        .arg("query")
        .arg("filetype")
        .arg(path)
        .output()
    {
        let mime = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if out.status.success() && mime.contains('/') {
            return mime;
        }
    }
    mime_from_extension(path)
}

fn mime_from_extension(path: &Path) -> String {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "txt" | "log" | "md" | "conf" | "ini" | "rs" | "ts" | "js" | "py" | "sh" => "text/plain",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "mp3" => "audio/mpeg",
        "ogg" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "mp4" => "video/mp4",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "zip" => "application/zip",
        "html" | "htm" => "text/html",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
    .into()
}

/// The system's default app for `mime`, as a desktop file id.
pub fn default_app(mime: &str) -> Option<String> {
    let out = Command::new("xdg-mime")
        .args(["query", "default", mime])
        .output()
        .ok()?;
    let id = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !id.is_empty()).then_some(id)
}

/// Every app in `dirs` that says it opens `mime`, the default first, then by name. A text file of
/// a special kind (`text/x-rust`) also gets the apps for plain text.
pub fn apps_for(mime: &str, dirs: &[PathBuf], default: Option<&str>) -> Vec<App> {
    let mut apps: Vec<App> = all_apps(dirs)
        .into_values()
        .filter(|a| {
            a.mime_types.iter().any(|m| {
                m == mime
                    || (mime.starts_with("text/") && m == "text/plain")
                    || m.strip_suffix("/*")
                        .is_some_and(|group| mime.starts_with(&format!("{group}/")))
            })
        })
        .map(|mut a| {
            a.default = default == Some(a.id.as_str());
            a
        })
        .collect();
    apps.sort_by(|a, b| {
        b.default
            .cmp(&a.default)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    apps
}

/// Every visible application, by id. An id found in an earlier folder hides the later ones (the
/// user's own copy wins over the system's).
fn all_apps(dirs: &[PathBuf]) -> HashMap<String, App> {
    let mut found: HashMap<String, App> = HashMap::new();
    let mut hidden: Vec<String> = Vec::new();
    for dir in dirs {
        let base = dir.join("applications");
        for (id, file) in desktop_files(&base) {
            if found.contains_key(&id) || hidden.contains(&id) {
                continue;
            }
            let Ok(text) = fs::read_to_string(&file) else {
                continue;
            };
            match parse_desktop(&id, &text) {
                Some(app) => {
                    found.insert(id, app);
                }
                None => hidden.push(id),
            }
        }
    }
    for app in found.values_mut() {
        app.icon = app
            .icon
            .take()
            .and_then(|name| resolve_icon(&name.to_string_lossy(), dirs));
    }
    found
}

/// `.desktop` files under `base`, with their ids (`kde/foo.desktop` → `kde-foo.desktop`).
fn desktop_files(base: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let mut stack = vec![base.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(read) = fs::read_dir(&dir) else {
            continue;
        };
        for item in read.flatten() {
            let path = item.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "desktop") {
                if let Ok(rel) = path.strip_prefix(base) {
                    out.push((rel.to_string_lossy().replace('/', "-"), path));
                }
            }
        }
    }
    out
}

/// The `[Desktop Entry]` group of a desktop file. `None` for one that should not be offered
/// (hidden, not an application, nothing to run).
pub fn parse_desktop(id: &str, text: &str) -> Option<App> {
    let mut in_entry = false;
    let mut fields: HashMap<&str, &str> = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            fields.entry(key.trim()).or_insert(value.trim());
        }
    }
    let yes = |k: &str| fields.get(k).is_some_and(|v| *v == "true");
    if fields.get("Type").is_some_and(|t| *t != "Application") || yes("Hidden") || yes("NoDisplay")
    {
        return None;
    }
    let exec = fields.get("Exec")?.to_string();
    let name = fields
        .get("Name[de_DE]")
        .or_else(|| fields.get("Name[de]"))
        .or_else(|| fields.get("Name"))?
        .to_string();
    let mime_types = fields
        .get("MimeType")
        .map(|m| {
            m.split(';')
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    Some(App {
        id: id.to_string(),
        name,
        icon: fields.get("Icon").map(PathBuf::from),
        default: false,
        exec,
        mime_types,
    })
}

/// A picture for an icon name, from the hicolor theme or pixmaps. Absolute paths are taken as
/// they are.
fn resolve_icon(name: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    let direct = Path::new(name);
    if direct.is_absolute() {
        return direct.is_file().then(|| direct.to_path_buf());
    }
    let sizes = [
        "scalable", "256x256", "128x128", "96x96", "64x64", "48x48", "32x32",
    ];
    for dir in dirs {
        for theme in ["hicolor", "breeze"] {
            for size in sizes {
                for sub in ["apps", ""] {
                    for ext in ["svg", "png"] {
                        let p = dir
                            .join("icons")
                            .join(theme)
                            .join(size)
                            .join(sub)
                            .join(format!("{name}.{ext}"));
                        if p.is_file() {
                            return Some(p);
                        }
                    }
                }
            }
        }
        for ext in ["svg", "png", "xpm"] {
            let p = dir.join("pixmaps").join(format!("{name}.{ext}"));
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// The command line `exec` stands for with `paths` filled in. More than one command when the app
/// takes one file at a time (`%f`, `%u`) and several are opened.
pub fn command_lines(exec: &str, paths: &[PathBuf]) -> Vec<Vec<String>> {
    let words = split_exec(exec);
    let takes_many = words.iter().any(|w| w.contains("%F") || w.contains("%U"));
    let runs: Vec<&[PathBuf]> = if takes_many || paths.len() <= 1 {
        vec![paths]
    } else {
        paths.chunks(1).collect()
    };
    runs.into_iter()
        .map(|batch| {
            let mut argv = Vec::new();
            for word in &words {
                match word.as_str() {
                    "%f" | "%u" => {
                        argv.extend(batch.first().map(|p| p.to_string_lossy().into_owned()))
                    }
                    "%F" | "%U" => {
                        argv.extend(batch.iter().map(|p| p.to_string_lossy().into_owned()))
                    }
                    // Icon, name and file location of the entry: nothing to give here.
                    "%i" | "%c" | "%k" => {}
                    other => {
                        let cleaned = strip_field_codes(other);
                        if !cleaned.is_empty() {
                            argv.push(cleaned);
                        }
                    }
                }
            }
            argv
        })
        .collect()
}

/// A word with `%%` turned into `%` and any other field code (`%d`, `%v` …, deprecated) dropped.
fn strip_field_codes(word: &str) -> String {
    let mut out = String::new();
    let mut chars = word.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            if let Some('%') = chars.next() {
                out.push('%');
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Splits an Exec line into words, honouring double quotes and backslash escapes.
fn split_exec(exec: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut chars = exec.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => quoted = !quoted,
            '\\' if quoted => {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            ' ' | '\t' if !quoted => {
                if !current.is_empty() {
                    words.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(c),
        }
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

/// Starts app `id` with `paths`, detached from UwUFiles.
pub fn launch(id: &str, paths: &[PathBuf], dirs: &[PathBuf]) -> Result<()> {
    let app = all_apps(dirs)
        .remove(id)
        .ok_or_else(|| Error::NoApp(id.into()))?;
    for argv in command_lines(&app.exec, paths) {
        let Some((program, args)) = argv.split_first() else {
            continue;
        };
        Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| Error::io(PathBuf::from(program), e))?;
    }
    Ok(())
}
