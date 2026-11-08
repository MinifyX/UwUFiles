//! What is in a folder.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::{Error, Result};

/// One row (or tile) of the window.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: PathBuf,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub hidden: bool,
    /// Bytes for a file; for a folder the number of things in it, if it could be read.
    pub size: Option<u64>,
    /// Milliseconds since 1970, for `new Date()` on the other side.
    pub modified: Option<f64>,
    pub kind: Kind,
}

/// What the window draws for an entry: its icon, and whether it gets a picture preview.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Folder,
    Image,
    Video,
    Audio,
    Archive,
    Code,
    Document,
    Spreadsheet,
    Text,
    Other,
}

impl Kind {
    pub fn from_name(name: &str) -> Kind {
        let ext = match name.rsplit_once('.') {
            Some((stem, ext)) if !stem.is_empty() => ext.to_ascii_lowercase(),
            _ => return Kind::Other,
        };
        match ext.as_str() {
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "bmp" | "svg" | "ico" | "heic" | "tif"
            | "tiff" => Kind::Image,
            "mp4" | "mkv" | "webm" | "mov" | "avi" | "m4v" | "wmv" | "flv" => Kind::Video,
            "mp3" | "flac" | "ogg" | "opus" | "wav" | "m4a" | "aac" | "wma" => Kind::Audio,
            "zip" | "tar" | "gz" | "tgz" | "xz" | "zst" | "bz2" | "7z" | "rar" | "deb" | "rpm"
            | "iso" | "appimage" => Kind::Archive,
            "rs" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "py" | "c" | "h" | "cpp" | "hpp" | "go"
            | "java" | "kt" | "swift" | "sh" | "fish" | "zsh" | "lua" | "rb" | "php" | "cs"
            | "html" | "css" | "scss" | "json" | "toml" | "yaml" | "yml" | "xml" | "sql" => {
                Kind::Code
            }
            "pdf" | "doc" | "docx" | "odt" | "rtf" | "epub" | "ppt" | "pptx" | "odp" => {
                Kind::Document
            }
            "xls" | "xlsx" | "ods" | "csv" | "tsv" => Kind::Spreadsheet,
            "txt" | "md" | "log" | "ini" | "conf" | "cfg" => Kind::Text,
            _ => Kind::Other,
        }
    }
}

/// Everything in `dir`, folders first, then by name as people sort (case-insensitive, numbers by
/// value). Entries that vanish while being read are skipped rather than failing the whole folder.
pub fn list(dir: &Path, show_hidden: bool) -> Result<Vec<Entry>> {
    let read = fs::read_dir(dir).map_err(|e| Error::io(dir, e))?;
    let mut entries: Vec<Entry> = read
        .filter_map(|item| item.ok())
        .filter_map(|item| entry(&item.path()))
        .filter(|e| show_hidden || !e.hidden)
        .collect();
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| natural_cmp(&a.name, &b.name)));
    Ok(entries)
}

/// One entry, read fresh. `None` if it is gone.
pub fn entry(path: &Path) -> Option<Entry> {
    let link = fs::symlink_metadata(path).ok()?;
    let is_symlink = link.file_type().is_symlink();
    // A link shows what it points at; a dangling one shows as itself.
    let meta = if is_symlink { fs::metadata(path).unwrap_or(link) } else { link };
    let name = path.file_name()?.to_string_lossy().into_owned();
    let is_dir = meta.is_dir();
    let size = if is_dir {
        fs::read_dir(path).ok().map(|r| r.count() as u64)
    } else {
        Some(meta.len())
    };
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64);
    Some(Entry {
        hidden: name.starts_with('.'),
        kind: if is_dir { Kind::Folder } else { Kind::from_name(&name) },
        name,
        path: path.to_path_buf(),
        is_dir,
        is_symlink,
        size,
        modified,
    })
}

/// "Bild 2" before "Bild 10", "abc" next to "ABC".
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut s = String::new();
                    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
                        s.push(c);
                        it.next();
                    }
                    s
                };
                let (na, nb) = (take(&mut a), take(&mut b));
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let ord = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(x), Some(y)) => {
                let ord = x.to_lowercase().cmp(y.to_lowercase());
                if ord != Ordering::Equal {
                    return ord;
                }
                a.next();
                b.next();
            }
        }
    }
}
