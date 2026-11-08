//! The sidebar: the user's own folders and the drives that are mounted.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub name: String,
    pub path: PathBuf,
    /// Which icon: home, desktop, documents, downloads, pictures, music, videos, trash.
    pub icon: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    pub name: String,
    pub path: PathBuf,
    pub total_bytes: u64,
    pub free_bytes: u64,
    /// A USB stick or a second disk the user plugged in or mounted (not the system).
    pub removable: bool,
}

/// Persönlicher Ordner, then the XDG folders that exist, named as the system names them.
pub fn places() -> Vec<Place> {
    let mut out = Vec::new();
    if let Some(home) = dirs::home_dir() {
        out.push(Place {
            name: "Persönlicher Ordner".into(),
            path: home,
            icon: "home",
        });
    }
    let xdg: [(Option<PathBuf>, &str, &'static str); 6] = [
        (dirs::desktop_dir(), "Desktop", "desktop"),
        (dirs::document_dir(), "Dokumente", "documents"),
        (dirs::download_dir(), "Downloads", "downloads"),
        (dirs::picture_dir(), "Bilder", "pictures"),
        (dirs::audio_dir(), "Musik", "music"),
        (dirs::video_dir(), "Videos", "videos"),
    ];
    let home = dirs::home_dir();
    for (path, fallback, icon) in xdg {
        let Some(path) = path.filter(|p| p.is_dir()) else {
            continue;
        };
        // An unset XDG folder points at $HOME; that one is already there.
        if Some(&path) == home.as_ref() {
            continue;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| fallback.into());
        out.push(Place { name, path, icon });
    }
    out
}

/// The system disk and everything mounted for the user (/run/media, /media, /mnt).
#[cfg(target_os = "linux")]
pub fn drives() -> Vec<Drive> {
    let mounts = std::fs::read_to_string("/proc/self/mounts").unwrap_or_default();
    let mut out: Vec<Drive> = Vec::new();
    for line in mounts.lines() {
        let mut fields = line.split_whitespace();
        let (Some(device), Some(point), Some(kind)) = (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        // Network shares get their own group in the sidebar (see `network::mounted`).
        if matches!(kind, "cifs" | "smb3" | "nfs" | "nfs4") {
            continue;
        }
        let point = crate::network::unescape_octal(point);
        let is_root = point == "/";
        let user_mount = ["/run/media/", "/media/", "/mnt/"]
            .iter()
            .any(|p| point.starts_with(p));
        if !(is_root || user_mount) || !device.starts_with('/') {
            continue;
        }
        if out.iter().any(|d| d.path == Path::new(&point)) {
            continue;
        }
        let Some((total_bytes, free_bytes)) = space(Path::new(&point)) else {
            continue;
        };
        let name = if is_root {
            "System".to_string()
        } else {
            Path::new(&point)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| point.clone())
        };
        out.push(Drive {
            name,
            path: PathBuf::from(&point),
            total_bytes,
            free_bytes,
            removable: !is_root,
        });
    }
    out
}

#[cfg(not(target_os = "linux"))]
pub fn drives() -> Vec<Drive> {
    Vec::new()
}

/// Total and free bytes of the file system `path` is on.
#[cfg(unix)]
pub fn space(path: &Path) -> Option<(u64, u64)> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let c = CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `c` is a valid NUL-terminated path and `stat` a properly sized out-parameter.
    if unsafe { libc::statvfs(c.as_ptr(), &mut stat) } != 0 {
        return None;
    }
    let block = stat.f_frsize as u64;
    Some((stat.f_blocks as u64 * block, stat.f_bavail as u64 * block))
}

#[cfg(not(unix))]
pub fn space(_path: &Path) -> Option<(u64, u64)> {
    None
}
