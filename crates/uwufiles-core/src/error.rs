use std::io;
use std::path::PathBuf;

use serde::Serialize;

/// What can go wrong, worded for the person in front of the window. The
/// front end shows `message` as it is, so it is German and says which file.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("„{}“ gibt es nicht (mehr).", .0.display())]
    NotFound(PathBuf),
    #[error("Für „{}“ fehlt die Berechtigung.", .0.display())]
    PermissionDenied(PathBuf),
    #[error("„{}“ gibt es hier schon.", .0)]
    AlreadyExists(String),
    #[error("„{0}“ ist kein gültiger Name.")]
    InvalidName(String),
    #[error("Ein Ordner kann nicht in sich selbst kopiert oder verschoben werden.")]
    IntoItself,
    #[error("Abgebrochen.")]
    Cancelled,
    #[error("Keine Anwendung kann „{0}“ öffnen.")]
    NoApp(String),
    /// A network share: the sentence says what happened and, where it can, what to do.
    #[error("{0}")]
    Network(String),
    #[error("Papierkorb: {0}")]
    Trash(String),
    #[error("{}: {source}", .path.display())]
    Io { path: PathBuf, source: io::Error },
}

impl Error {
    /// An `io::Error` for `path`, sorted into the cases the window words differently.
    pub fn io(path: impl Into<PathBuf>, source: io::Error) -> Self {
        let path = path.into();
        match source.kind() {
            io::ErrorKind::NotFound => Error::NotFound(path),
            io::ErrorKind::PermissionDenied => Error::PermissionDenied(path),
            io::ErrorKind::AlreadyExists => Error::AlreadyExists(
                path.file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
            ),
            _ => Error::Io { path, source },
        }
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
