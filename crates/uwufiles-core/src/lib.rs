//! Everything UwUFiles does to the file system, with no Tauri in sight.
//!
//! - [`listing`]: what is in a folder, as the window shows it.
//! - [`ops`]: making, renaming, copying, moving and trashing.
//! - [`network`]: SMB and NFS shares — finding, connecting, the fstab lines NFS needs.
//! - [`places`]: the sidebar — the user's folders and the mounted drives.
//! - [`trashbin`]: what is in the trash, putting it back, emptying it.
//! - [`apps`]: "Öffnen mit …" — the installed apps for a kind of file.
//!
//! The desktop app (`apps/desktop/src-tauri`) is a thin layer of commands
//! over these, so all of it can be tested against a temporary folder.

pub mod apps;
pub mod error;
pub mod listing;
pub mod network;
pub mod ops;
pub mod places;
pub mod trashbin;

pub use error::{Error, Result};
