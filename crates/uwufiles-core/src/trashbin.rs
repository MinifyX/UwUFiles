//! The trash: what is in it, putting things back, and emptying it.
//!
//! Only on Linux and Windows, where the `trash` crate can read the trash. Elsewhere the list is
//! empty and the window shows no trash place.

use std::path::PathBuf;

use serde::Serialize;

use crate::listing::Kind;
use crate::{Error, Result};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    /// The trash's own id for it; what `restore` and `purge` take.
    pub id: String,
    pub name: String,
    /// Where it was before it was trashed, and where `restore` puts it back.
    pub original_path: PathBuf,
    /// Milliseconds since 1970.
    pub deleted: f64,
    pub kind: Kind,
}

#[cfg(any(target_os = "linux", windows))]
mod imp {
    use super::*;
    use trash::os_limited;

    fn items() -> Result<Vec<trash::TrashItem>> {
        os_limited::list().map_err(|e| Error::Trash(e.to_string()))
    }

    fn pick(ids: &[String]) -> Result<Vec<trash::TrashItem>> {
        Ok(items()?
            .into_iter()
            .filter(|i| ids.iter().any(|id| *id == i.id.to_string_lossy()))
            .collect())
    }

    pub fn list() -> Result<Vec<TrashEntry>> {
        let mut out: Vec<TrashEntry> = items()?
            .into_iter()
            .map(|i| {
                let name = i.name.to_string_lossy().into_owned();
                let original_path = i.original_path();
                let is_dir = std::fs::symlink_metadata(&original_path).is_ok_and(|m| m.is_dir())
                    || os_limited::metadata(&i)
                        .is_ok_and(|m| matches!(m.size, trash::TrashItemSize::Entries(_)));
                TrashEntry {
                    id: i.id.to_string_lossy().into_owned(),
                    kind: if is_dir {
                        Kind::Folder
                    } else {
                        Kind::from_name(&name)
                    },
                    name,
                    original_path,
                    deleted: i.time_deleted as f64 * 1000.0,
                }
            })
            .collect();
        out.sort_by(|a, b| b.deleted.total_cmp(&a.deleted));
        Ok(out)
    }

    /// Puts the items back where they were. Fails, and restores nothing, if one of those places
    /// is taken again.
    pub fn restore(ids: &[String]) -> Result<()> {
        let picked = pick(ids)?;
        if let Some(taken) = picked
            .iter()
            .find(|i| i.original_path().symlink_metadata().is_ok())
        {
            return Err(Error::AlreadyExists(
                taken.name.to_string_lossy().into_owned(),
            ));
        }
        os_limited::restore_all(picked).map_err(|e| Error::Trash(e.to_string()))
    }

    /// Deletes the items for good.
    pub fn purge(ids: &[String]) -> Result<()> {
        os_limited::purge_all(pick(ids)?).map_err(|e| Error::Trash(e.to_string()))
    }

    pub fn empty() -> Result<()> {
        os_limited::purge_all(items()?).map_err(|e| Error::Trash(e.to_string()))
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod imp {
    use super::*;
    pub fn list() -> Result<Vec<TrashEntry>> {
        Ok(Vec::new())
    }
    pub fn restore(_: &[String]) -> Result<()> {
        Err(Error::Trash("auf diesem System nicht möglich".into()))
    }
    pub fn purge(_: &[String]) -> Result<()> {
        restore(&[])
    }
    pub fn empty() -> Result<()> {
        restore(&[])
    }
}

pub use imp::{empty, list, purge, restore};

/// Whether this system has a trash UwUFiles can show.
pub const SUPPORTED: bool = cfg!(any(target_os = "linux", windows));
