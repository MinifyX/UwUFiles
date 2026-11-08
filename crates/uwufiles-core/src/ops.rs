//! Making, renaming, copying, moving and trashing.
//!
//! Nothing here overwrites: a name that is taken gets " (Kopie)", then " (Kopie 2)" … in front of
//! the extension, like other file managers do when you paste into the same folder.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::{Error, Result};

/// A new, empty folder `name` in `parent`. Returns its path.
pub fn create_dir(parent: &Path, name: &str) -> Result<PathBuf> {
    let path = parent.join(valid_name(name)?);
    fs::create_dir(&path).map_err(|e| Error::io(&path, e))?;
    Ok(path)
}

/// A new, empty file `name` in `parent`. Returns its path.
pub fn create_file(parent: &Path, name: &str) -> Result<PathBuf> {
    let path = parent.join(valid_name(name)?);
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| Error::io(&path, e))?;
    Ok(path)
}

/// Renames `path` to `new_name` in the same folder. Returns the new path.
pub fn rename(path: &Path, new_name: &str) -> Result<PathBuf> {
    let name = valid_name(new_name)?;
    let parent = path.parent().ok_or_else(|| Error::InvalidName(new_name.into()))?;
    let target = parent.join(name);
    if target == path {
        return Ok(target);
    }
    // Only a change of case is allowed onto an existing name (case-insensitive file systems).
    let same_file_other_case = target
        .file_name()
        .zip(path.file_name())
        .is_some_and(|(a, b)| a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase());
    if target.symlink_metadata().is_ok() && !same_file_other_case {
        return Err(Error::AlreadyExists(name.into()));
    }
    fs::rename(path, &target).map_err(|e| Error::io(path, e))?;
    Ok(target)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Transfer {
    Copy,
    Move,
}

/// How far a copy or move has got, for the progress bar.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub done_bytes: u64,
    pub total_bytes: u64,
    pub current: String,
}

/// Copies or moves every source into `dest`. Returns the new paths, in order.
///
/// A move inside one file system is a rename and costs nothing; across file systems (to a USB
/// stick) it is a copy followed by a delete of the source, only once the copy has succeeded.
pub fn transfer(
    sources: &[PathBuf],
    dest: &Path,
    mode: Transfer,
    mut progress: impl FnMut(&Progress),
) -> Result<Vec<PathBuf>> {
    for source in sources {
        if dest.starts_with(source) {
            return Err(Error::IntoItself);
        }
    }
    let total_bytes: u64 = sources.iter().map(|s| tree_size(s)).sum();
    let mut state = Progress { done_bytes: 0, total_bytes, current: String::new() };
    let mut out = Vec::with_capacity(sources.len());

    for source in sources {
        let name = source.file_name().ok_or_else(|| Error::NotFound(source.clone()))?;
        state.current = name.to_string_lossy().into_owned();
        progress(&state);

        // Moving onto itself (same folder) is nothing to do.
        if mode == Transfer::Move && source.parent() == Some(dest) {
            out.push(source.clone());
            continue;
        }
        let target = free_name(dest, &name.to_string_lossy());

        if mode == Transfer::Move {
            match fs::rename(source, &target) {
                Ok(()) => {
                    state.done_bytes += tree_size(&target);
                    progress(&state);
                    out.push(target);
                    continue;
                }
                // Another file system: fall through to copy + delete.
                Err(e) if is_cross_device(&e) => {}
                Err(e) => return Err(Error::io(source, e)),
            }
        }

        copy_tree(source, &target, &mut state, &mut progress)?;
        if mode == Transfer::Move {
            remove_tree(source)?;
        }
        out.push(target);
    }
    Ok(out)
}

/// Moves every path to the trash.
pub fn trash(paths: &[PathBuf]) -> Result<()> {
    trash::delete_all(paths).map_err(|e| Error::Trash(e.to_string()))
}

/// `name` in `dir` if it is free, otherwise "name (Kopie).ext", "name (Kopie 2).ext" …
pub fn free_name(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if first.symlink_metadata().is_err() {
        return first;
    }
    // ".bashrc" has no extension; "archiv.tar.gz" keeps ".tar.gz" together.
    let (stem, ext) = split_extension(name);
    (1..)
        .map(|n| {
            let tag = if n == 1 { "Kopie".to_string() } else { format!("Kopie {n}") };
            dir.join(format!("{stem} ({tag}){ext}"))
        })
        .find(|p| p.symlink_metadata().is_err())
        .expect("an unbounded range always finds a free name")
}

fn split_extension(name: &str) -> (&str, &str) {
    let lower = name.to_ascii_lowercase();
    for double in [".tar.gz", ".tar.xz", ".tar.zst", ".tar.bz2"] {
        if lower.ends_with(double) && name.len() > double.len() {
            return name.split_at(name.len() - double.len());
        }
    }
    match name.rfind('.') {
        Some(0) | None => (name, ""),
        Some(i) => name.split_at(i),
    }
}

fn valid_name(name: &str) -> Result<&str> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\0')
        || (cfg!(windows) && trimmed.contains(['\\', ':', '*', '?', '"', '<', '>', '|']))
    {
        return Err(Error::InvalidName(name.into()));
    }
    Ok(trimmed)
}

fn copy_tree(
    source: &Path,
    target: &Path,
    state: &mut Progress,
    progress: &mut impl FnMut(&Progress),
) -> Result<()> {
    let meta = fs::symlink_metadata(source).map_err(|e| Error::io(source, e))?;
    if meta.file_type().is_symlink() {
        // Links are copied as links, never followed: a link to / must not copy the disk.
        let points_to = fs::read_link(source).map_err(|e| Error::io(source, e))?;
        symlink(&points_to, target).map_err(|e| Error::io(target, e))?;
    } else if meta.is_dir() {
        fs::create_dir(target).map_err(|e| Error::io(target, e))?;
        for item in fs::read_dir(source).map_err(|e| Error::io(source, e))? {
            let item = item.map_err(|e| Error::io(source, e))?;
            copy_tree(&item.path(), &target.join(item.file_name()), state, progress)?;
        }
        let _ = fs::set_permissions(target, meta.permissions());
    } else {
        fs::copy(source, target).map_err(|e| Error::io(source, e))?;
        state.done_bytes += meta.len();
        progress(state);
    }
    Ok(())
}

fn remove_tree(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path).map_err(|e| Error::io(path, e))?;
    let result = if meta.is_dir() { fs::remove_dir_all(path) } else { fs::remove_file(path) };
    result.map_err(|e| Error::io(path, e))
}

/// Bytes under `path`, not following links. Unreadable parts count as nothing.
pub fn tree_size(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else { return 0 };
    if meta.is_dir() {
        fs::read_dir(path)
            .map(|r| r.filter_map(|i| i.ok()).map(|i| tree_size(&i.path())).sum())
            .unwrap_or(0)
    } else {
        meta.len()
    }
}

fn is_cross_device(e: &io::Error) -> bool {
    #[cfg(unix)]
    {
        e.raw_os_error() == Some(libc::EXDEV)
    }
    #[cfg(windows)]
    {
        // ERROR_NOT_SAME_DEVICE
        e.raw_os_error() == Some(17)
    }
}

#[cfg(unix)]
fn symlink(points_to: &Path, at: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(points_to, at)
}

#[cfg(windows)]
fn symlink(points_to: &Path, at: &Path) -> io::Result<()> {
    if points_to.is_dir() {
        std::os::windows::fs::symlink_dir(points_to, at)
    } else {
        std::os::windows::fs::symlink_file(points_to, at)
    }
}
