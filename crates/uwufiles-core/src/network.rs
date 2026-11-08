//! Network shares: SMB and NFS folders on a NAS or another computer.
//!
//! - **SMB** needs no root. On KDE it goes through kio-fuse (the same thing Dolphin uses), on
//!   GNOME and others through `gio mount` (gvfs-smb). The password is handed over once and never
//!   written anywhere but the keyring, if the user asks for that.
//! - **NFS** is mounted by the kernel, which needs root once: the share gets a line in
//!   `/etc/fstab` with the `user` option, written by `uwufiles --fstab-add` under pkexec. After
//!   that `mount` works as the user, without a password. No `vers=` is given, so mount.nfs takes
//!   the newest version both sides speak: 4.2, then 4.1, 4.0, and 3 only for old servers.

use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Smb,
    Nfs,
}

/// One share, as the user typed it or picked it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Share {
    pub protocol: Protocol,
    /// A name or an address: `nas.local`, `192.168.1.20`.
    pub host: String,
    /// SMB: the share's name (`daten`). NFS: the exported path (`/volume1/Backups`).
    pub share: String,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub domain: Option<String>,
}

impl Share {
    /// `smb://user@host/share` or `host:/export`, without a password: the share's name in the
    /// keyring and in messages.
    pub fn address(&self) -> String {
        match self.protocol {
            Protocol::Smb => {
                let user = match (&self.domain, &self.user) {
                    (Some(d), Some(u)) if !d.is_empty() => format!("{d};{u}@"),
                    (_, Some(u)) if !u.is_empty() => format!("{u}@"),
                    _ => String::new(),
                };
                format!("smb://{user}{}/{}", self.host, self.share)
            }
            Protocol::Nfs => format!("{}:{}", self.host, self.share),
        }
    }

    fn check(&self) -> Result<()> {
        let host_ok = !self.host.is_empty()
            && !self.host.starts_with('-')
            && self
                .host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || ".-_:[]".contains(c));
        if !host_ok {
            return Err(Error::InvalidName(self.host.clone()));
        }
        let share_ok = match self.protocol {
            Protocol::Smb => {
                !self.share.is_empty()
                    && !self.share.contains(['/', '\\'])
                    && !self.share.chars().any(char::is_control)
            }
            Protocol::Nfs => {
                self.share.starts_with('/')
                    && !self.share.contains("..")
                    && !self.share.chars().any(char::is_control)
            }
        };
        if !share_ok {
            return Err(Error::InvalidName(self.share.clone()));
        }
        for part in [&self.user, &self.domain].into_iter().flatten() {
            if part.chars().any(char::is_control) {
                return Err(Error::InvalidName(part.clone()));
            }
        }
        Ok(())
    }
}

/// What the user pasted: `smb://nas/daten`, `\\nas\daten`, `nfs://nas/volume1/x`, `nas:/volume1/x`.
pub fn parse_address(input: &str) -> Option<Share> {
    let s = input.trim();
    let smb = |rest: &str| {
        let (auth, rest) = match rest.split_once('@') {
            Some((a, r)) if !a.contains('/') => (Some(a), r),
            _ => (None, rest),
        };
        let mut parts = rest.split(['/', '\\']).filter(|p| !p.is_empty());
        let host = parts.next()?.to_string();
        let share = parts.next().unwrap_or("").to_string();
        let (domain, user) = match auth.map(|a| a.split(':').next().unwrap_or(a)) {
            Some(a) => match a.split_once(';') {
                Some((d, u)) => (Some(d.to_string()), Some(u.to_string())),
                None => (None, Some(a.to_string())),
            },
            None => (None, None),
        };
        Some(Share {
            protocol: Protocol::Smb,
            host,
            share,
            user,
            domain,
        })
    };
    if let Some(rest) = s.strip_prefix("smb://") {
        return smb(rest);
    }
    if let Some(rest) = s.strip_prefix("\\\\") {
        return smb(rest);
    }
    if let Some(rest) = s.strip_prefix("nfs://") {
        let (host, path) = rest.split_once('/')?;
        return Some(Share {
            protocol: Protocol::Nfs,
            host: host.to_string(),
            share: format!("/{}", path.trim_end_matches('/')),
            user: None,
            domain: None,
        });
    }
    if let Some((host, path)) = s.split_once(":/") {
        if !host.is_empty() && !host.contains('/') {
            return Some(Share {
                protocol: Protocol::Nfs,
                host: host.to_string(),
                share: format!("/{}", path.trim_end_matches('/')),
                user: None,
                domain: None,
            });
        }
    }
    None
}

// ---- finding servers and shares -----------------------------------------------------------

/// A computer in the local network that offers SMB or NFS, found over mDNS (Avahi).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub name: String,
    pub host: String,
    pub protocols: Vec<Protocol>,
}

/// The servers Avahi knows about. Empty when Avahi is not installed or not running.
pub fn discover() -> Vec<Server> {
    let browse = |kind: &'static str| {
        std::thread::spawn(move || {
            run_with_timeout(
                Command::new("avahi-browse").args(["-rtpk", kind]),
                None,
                Duration::from_secs(4),
            )
            .map(|o| o.stdout)
            .unwrap_or_default()
        })
    };
    let smb = browse("_smb._tcp");
    let nfs = browse("_nfs._tcp");
    let mut out = String::new();
    for (protocol, job) in [(Protocol::Smb, smb), (Protocol::Nfs, nfs)] {
        for line in job.join().unwrap_or_default().lines() {
            out.push_str(match protocol {
                Protocol::Smb => "smb",
                Protocol::Nfs => "nfs",
            });
            out.push(' ');
            out.push_str(line);
            out.push('\n');
        }
    }
    parse_avahi(&out)
}

/// Lines of `avahi-browse -rtpk`, each prefixed with `smb ` or `nfs `.
fn parse_avahi(text: &str) -> Vec<Server> {
    let mut servers: Vec<Server> = Vec::new();
    for line in text.lines() {
        let Some((kind, line)) = line.split_once(' ') else {
            continue;
        };
        let f: Vec<&str> = line.split(';').collect();
        // =;iface;IPv4;name;type;domain;hostname;address;port;txt
        if f.len() < 9 || f[0] != "=" || f[2] != "IPv4" {
            continue;
        }
        let protocol = if kind == "nfs" {
            Protocol::Nfs
        } else {
            Protocol::Smb
        };
        let host = f[7].to_string();
        match servers.iter_mut().find(|s| s.host == host) {
            Some(s) => {
                if !s.protocols.contains(&protocol) {
                    s.protocols.push(protocol);
                }
            }
            None => servers.push(Server {
                name: avahi_unescape(f[3]),
                host,
                protocols: vec![protocol],
            }),
        }
    }
    servers.sort_by_key(|s| s.name.to_lowercase());
    servers
}

/// Avahi writes special characters as `\DDD`, in decimal: `EPSON\032WF` is `EPSON WF`.
fn avahi_unescape(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' && i + 4 <= b.len() {
            if let Ok(n) = s[i + 1..i + 4].parse::<u8>() {
                out.push(n);
                i += 4;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// An NFS export and who may mount it, as the server says (`showmount -e`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Export {
    pub path: String,
    /// Addresses or networks the server lets in, `*` for everyone.
    pub clients: Vec<String>,
}

pub fn nfs_exports(host: &str) -> Result<Vec<Export>> {
    probe_host(host)?;
    let out = run_with_timeout(
        Command::new("showmount").args(["-e", "--no-headers", host]),
        None,
        Duration::from_secs(8),
    )
    .map_err(|e| missing_tool(e, "showmount (nfs-utils)"))?;
    if !out.ok {
        return Err(Error::Network(format!(
            "{host} nennt keine NFS-Freigaben. {}",
            out.stderr.trim()
        )));
    }
    Ok(parse_showmount(&out.stdout))
}

fn parse_showmount(text: &str) -> Vec<Export> {
    text.lines()
        .filter_map(|line| {
            let mut f = line.split_whitespace();
            let path = f.next()?.to_string();
            let clients = f
                .next()
                .unwrap_or("*")
                .split(',')
                .map(|c| c.trim().to_string())
                .filter(|c| !c.is_empty())
                .collect();
            Some(Export { path, clients })
        })
        .collect()
}

/// The SMB shares on `host` (`smbclient -L`). Without a user it asks as a guest.
pub fn smb_shares(
    host: &str,
    user: Option<&str>,
    password: Option<&str>,
    domain: Option<&str>,
) -> Result<Vec<String>> {
    probe_host(host)?;
    let mut cmd = Command::new("smbclient");
    cmd.args(["-L", &format!("//{host}"), "-g"]);
    // The password goes through a file only this user can read, never the command line.
    let auth = match user.filter(|u| !u.is_empty()) {
        Some(user) => {
            let mut text = format!("username={user}\npassword={}\n", password.unwrap_or(""));
            if let Some(d) = domain.filter(|d| !d.is_empty()) {
                text.push_str(&format!("domain={d}\n"));
            }
            let file = private_file(&text)?;
            cmd.arg("-A").arg(file.path());
            Some(file)
        }
        None => {
            cmd.arg("-N");
            None
        }
    };
    let out = run_with_timeout(&mut cmd, None, Duration::from_secs(10))
        .map_err(|e| missing_tool(e, "smbclient"))?;
    drop(auth);
    if !out.ok && !out.stdout.contains("Disk|") {
        let why = format!("{}{}", out.stdout, out.stderr);
        return Err(Error::Network(if why.contains("LOGON_FAILURE") {
            "Benutzername oder Passwort stimmen nicht.".into()
        } else if why.contains("ACCESS_DENIED") {
            "Der Server lässt diesen Benutzer nicht herein.".into()
        } else {
            format!("Die Freigaben auf {host} lassen sich nicht lesen.")
        }));
    }
    Ok(parse_smbclient(&out.stdout))
}

fn parse_smbclient(text: &str) -> Vec<String> {
    let mut shares: Vec<String> = text
        .lines()
        .filter_map(|l| l.strip_prefix("Disk|"))
        .filter_map(|l| l.split('|').next())
        // `C$`, `ADMIN$` and the like are for administrators, not for browsing.
        .filter(|n| !n.is_empty() && !n.ends_with('$'))
        .map(String::from)
        .collect();
    shares.sort_by_key(|s| s.to_lowercase());
    shares.dedup();
    shares
}

// ---- what is connected ----------------------------------------------------------------------

/// A network share the kernel has mounted (from the fstab, by UwUFiles or by hand).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mounted {
    pub path: PathBuf,
    pub protocol: Protocol,
    /// `nas:/volume1/x` or `//nas/daten`.
    pub source: String,
    /// The protocol version in use, `4.2` or `3.1.1`.
    pub version: Option<String>,
}

#[cfg(target_os = "linux")]
pub fn mounted() -> Vec<Mounted> {
    parse_mounts(&std::fs::read_to_string("/proc/self/mounts").unwrap_or_default())
}

#[cfg(not(target_os = "linux"))]
pub fn mounted() -> Vec<Mounted> {
    Vec::new()
}

fn parse_mounts(text: &str) -> Vec<Mounted> {
    text.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split_whitespace().collect();
            let [source, point, kind, options, ..] = f[..] else {
                return None;
            };
            let protocol = match kind {
                "nfs" | "nfs4" => Protocol::Nfs,
                "cifs" | "smb3" => Protocol::Smb,
                _ => return None,
            };
            let version = options
                .split(',')
                .find_map(|o| o.strip_prefix("vers="))
                .map(String::from);
            Some(Mounted {
                path: PathBuf::from(unescape_octal(point)),
                protocol,
                source: unescape_octal(source),
                version,
            })
        })
        .collect()
}

/// Where `share` is mounted right now, if it is (kernel mounts only).
pub fn mounted_at(share: &Share) -> Option<Mounted> {
    let source = match share.protocol {
        Protocol::Nfs => share.address(),
        Protocol::Smb => format!("//{}/{}", share.host, share.share),
    };
    mounted()
        .into_iter()
        .find(|m| m.source.trim_end_matches('/') == source.trim_end_matches('/'))
}

// ---- connecting -------------------------------------------------------------------------------

/// Where a share is now, as a folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connected {
    pub path: PathBuf,
    /// `NFS 4.2`, `SMB über KDE`, …
    pub how: String,
}

/// What an NFS share needs before the user can mount it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NfsSetup {
    /// There is a line in the fstab the user may mount; nothing to do.
    Ready { mount_point: PathBuf },
    /// The fstab needs this line (and the folder created): root, once.
    NeedsEntry { mount_point: PathBuf, line: String },
}

/// The line UwUFiles writes above its own fstab entries, so it can find them again.
pub const FSTAB_MARK: &str = "# UwUFiles:";

/// What `share` needs in `fstab` (its text), and where it will be.
pub fn nfs_setup(share: &Share, fstab: &str) -> Result<NfsSetup> {
    share.check()?;
    let source = share.address();
    for line in fstab.lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() >= 4 && !f[0].starts_with('#') && unescape_octal(f[0]) == source {
            let point = PathBuf::from(unescape_octal(f[1]));
            if f[3].split(',').any(|o| o == "user" || o == "users") {
                return Ok(NfsSetup::Ready { mount_point: point });
            }
            return Err(Error::Network(format!(
                "{source} steht schon in /etc/fstab (unter {}), aber ohne die Option „user“. \
                 Häng es dort ein oder ergänze „user“ in der Zeile.",
                point.display()
            )));
        }
    }
    let base = share
        .share
        .rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or(&share.host);
    let clean = |s: &str| -> String {
        s.chars()
            .map(|c| {
                if c.is_alphanumeric() || "._-".contains(c) {
                    c
                } else {
                    '_'
                }
            })
            .collect()
    };
    let taken = |p: &Path| {
        let text = p.to_string_lossy();
        fstab
            .lines()
            .any(|l| l.split_whitespace().nth(1).map(unescape_octal).as_deref() == Some(&*text))
            || std::fs::read_dir(p).is_ok_and(|mut d| d.next().is_some())
    };
    let mut point = PathBuf::from("/mnt").join(clean(base));
    if taken(&point) {
        point = PathBuf::from("/mnt").join(format!("{}-{}", clean(base), clean(&share.host)));
    }
    let line = format!(
        "{}  {}  nfs  user,noauto,nofail,_netdev,x-systemd.mount-timeout=20  0 0",
        escape_octal(&source),
        escape_octal(&point.to_string_lossy()),
    );
    Ok(NfsSetup::NeedsEntry {
        mount_point: point,
        line,
    })
}

/// `fstab` with UwUFiles' entry for `line` added (run as root by `uwufiles --fstab-add`).
pub fn fstab_with(fstab: &str, line: &str) -> Result<String> {
    if line.contains('\n') || !line.contains("  nfs  user,") {
        return Err(Error::InvalidName(line.into()));
    }
    let source = line.split_whitespace().next().unwrap_or_default();
    let mut out = fstab.trim_end_matches('\n').to_string();
    out.push_str(&format!(
        "\n\n{FSTAB_MARK} {}\n{line}\n",
        unescape_octal(source)
    ));
    Ok(out)
}

/// `fstab` without UwUFiles' entry for `source` (and only UwUFiles' own: hand-written lines stay).
pub fn fstab_without(fstab: &str, source: &str) -> String {
    let mark = format!("{FSTAB_MARK} {source}");
    let mut out: Vec<&str> = Vec::new();
    let mut lines = fstab.lines().peekable();
    while let Some(line) = lines.next() {
        if line.trim() == mark {
            if lines.peek().is_some_and(|next| {
                next.split_whitespace()
                    .next()
                    .map(unescape_octal)
                    .as_deref()
                    == Some(source)
            }) {
                lines.next();
            }
            // The blank line UwUFiles put in front goes too.
            if out.last().is_some_and(|l| l.trim().is_empty()) {
                out.pop();
            }
            continue;
        }
        out.push(line);
    }
    let mut text = out.join("\n");
    text.push('\n');
    text
}

/// Mounts an NFS share whose fstab line is there (see [`nfs_setup`]). No root needed.
pub fn mount_nfs(share: &Share, mount_point: &Path) -> Result<Connected> {
    share.check()?;
    if let Some(m) = mounted_at(share) {
        return Ok(Connected {
            how: nfs_label(m.version.as_deref()),
            path: m.path,
        });
    }
    probe_host(&share.host)?;
    let out = run_with_timeout(
        Command::new("mount").arg(mount_point),
        None,
        Duration::from_secs(30),
    )
    .map_err(|e| missing_tool(e, "mount"))?;
    if !out.ok {
        return Err(Error::Network(nfs_error(&share.host, &out.stderr)));
    }
    let version = mounted_at(share).and_then(|m| m.version);
    Ok(Connected {
        path: mount_point.to_path_buf(),
        how: nfs_label(version.as_deref()),
    })
}

fn nfs_label(version: Option<&str>) -> String {
    match version {
        Some(v) => format!("NFS {v}"),
        None => "NFS".into(),
    }
}

fn nfs_error(host: &str, stderr: &str) -> String {
    let e = stderr.to_lowercase();
    if e.contains("access denied") || e.contains("permission denied") {
        let me = own_address(host)
            .map(|a| format!(" ({a})"))
            .unwrap_or_default();
        format!(
            "{host} lässt diesen Rechner{me} nicht herein. Erlaube ihn in den NFS-Rechten der \
             Freigabe auf dem NAS und versuch es noch einmal."
        )
    } else if e.contains("only root") || e.contains("must be superuser") {
        "Dieser Eintrag in /etc/fstab erlaubt das Einhängen nur root.".into()
    } else if e.contains("timed out") || e.contains("no route") || e.contains("refused") {
        format!("{host} antwortet nicht auf NFS. Ist NFS auf dem NAS eingeschaltet?")
    } else if e.contains("no such file") {
        "Diese Freigabe gibt es auf dem Server nicht.".into()
    } else {
        format!("NFS: {}", stderr.trim())
    }
}

/// Connects an SMB share as the user: kio-fuse if there is one (KDE), otherwise gvfs.
pub fn connect_smb(share: &Share, password: Option<&str>) -> Result<Connected> {
    share.check()?;
    if let Some(m) = mounted_at(share) {
        return Ok(Connected {
            path: m.path,
            how: "SMB".into(),
        });
    }
    probe_host(&share.host)?;
    match kio_fuse(share, password) {
        Ok(path) => {
            return Ok(Connected {
                path,
                how: "SMB über KDE".into(),
            })
        }
        Err(KioFuse::Unavailable) => {}
        Err(KioFuse::Failed(why)) => return Err(Error::Network(smb_error(&why))),
    }
    gio_mount(share, password)
}

enum KioFuse {
    Unavailable,
    Failed(String),
}

fn kio_fuse(share: &Share, password: Option<&str>) -> std::result::Result<PathBuf, KioFuse> {
    let conn = zbus::blocking::Connection::session().map_err(|_| KioFuse::Unavailable)?;
    let proxy = zbus::blocking::Proxy::new(
        &conn,
        "org.kde.KIOFuse",
        "/org/kde/KIOFuse",
        "org.kde.KIOFuse.VFS",
    )
    .map_err(|_| KioFuse::Unavailable)?;
    let mut url = String::from("smb://");
    if let Some(user) = share.user.as_deref().filter(|u| !u.is_empty()) {
        if let Some(d) = share.domain.as_deref().filter(|d| !d.is_empty()) {
            url.push_str(&encode_userinfo(d));
            url.push(';');
        }
        url.push_str(&encode_userinfo(user));
        if let Some(p) = password.filter(|p| !p.is_empty()) {
            url.push(':');
            url.push_str(&encode_userinfo(p));
        }
        url.push('@');
    }
    url.push_str(&share.host);
    url.push('/');
    url.push_str(&encode_userinfo(&share.share));
    // kio-fuse keeps the password for this mount only; the folder's path has none in it.
    match proxy.call::<_, _, String>("mountUrl", &(url,)) {
        Ok(path) => Ok(PathBuf::from(path)),
        Err(zbus::Error::MethodError(name, msg, _))
            if name.as_str().ends_with("ServiceUnknown")
                || name.as_str().ends_with("NameHasNoOwner") =>
        {
            let _ = msg;
            Err(KioFuse::Unavailable)
        }
        Err(zbus::Error::MethodError(_, msg, _)) => Err(KioFuse::Failed(msg.unwrap_or_default())),
        Err(e) => Err(KioFuse::Failed(e.to_string())),
    }
}

/// `gio mount` asks for user, domain and password on the terminal; this answers it.
fn gio_mount(share: &Share, password: Option<&str>) -> Result<Connected> {
    let uri = format!("smb://{}/{}", share.host, share.share);
    let mut child = Command::new("gio")
        .args(["mount", &uri])
        .env("LC_ALL", "C")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| {
            Error::Network(
                "Für SMB braucht UwUFiles kio-fuse (KDE) oder gvfs-smb. Installier eins davon."
                    .into(),
            )
        })?;
    let mut stdin = child.stdin.take().expect("piped");
    let mut stdout = child.stdout.take().expect("piped");
    let answers = (
        share.user.clone().unwrap_or_default(),
        share.domain.clone().unwrap_or_default(),
        password.unwrap_or_default().to_string(),
    );
    let reader = std::thread::spawn(move || {
        let mut seen = String::new();
        let mut asked_password = 0;
        let mut byte = [0u8; 1];
        while stdout.read(&mut byte).is_ok_and(|n| n == 1) {
            seen.push(byte[0] as char);
            if !seen.ends_with(": ") {
                continue;
            }
            let prompt = seen.rsplit('\n').next().unwrap_or("").to_string();
            let answer = if prompt.starts_with("User") {
                &answers.0
            } else if prompt.starts_with("Domain") {
                &answers.1
            } else if prompt.starts_with("Password") {
                asked_password += 1;
                if asked_password > 1 {
                    return false;
                }
                &answers.2
            } else {
                continue;
            };
            if writeln!(stdin, "{answer}").is_err() {
                break;
            }
            seen.clear();
        }
        true
    });
    let mut reader = Some(reader);
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| Error::io(&uri, e))? {
            break Some(status);
        }
        // The reader gives up when the password was asked for a second time: it was wrong.
        if reader.as_ref().is_some_and(|r| r.is_finished())
            && !reader.take().is_some_and(|r| r.join().unwrap_or(false))
        {
            break None;
        }
        if std::time::Instant::now() > deadline {
            break None;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let mut stderr = String::new();
    if let Some(mut e) = child.stderr.take() {
        if status.is_some() {
            let _ = e.read_to_string(&mut stderr);
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    match status {
        Some(s) if s.success() || stderr.contains("already mounted") => {}
        Some(_) => return Err(Error::Network(smb_error(&stderr))),
        None => {
            return Err(Error::Network(
                "Benutzername oder Passwort stimmen nicht.".into(),
            ))
        }
    }
    let info = run_with_timeout(
        Command::new("gio").args(["info", &uri]).env("LC_ALL", "C"),
        None,
        Duration::from_secs(10),
    )
    .map_err(|e| missing_tool(e, "gio"))?;
    let path = info
        .stdout
        .lines()
        .find_map(|l| l.trim().strip_prefix("local path:"))
        .map(|p| PathBuf::from(p.trim()))
        .ok_or_else(|| {
            Error::Network("gvfs hat die Freigabe verbunden, aber keinen Ordner dafür.".into())
        })?;
    Ok(Connected {
        path,
        how: "SMB über gvfs".into(),
    })
}

fn smb_error(why: &str) -> String {
    let w = why.to_lowercase();
    if w.contains("logon")
        || w.contains("password")
        || w.contains("access denied")
        || w.contains("authentication")
    {
        "Benutzername oder Passwort stimmen nicht.".into()
    } else if w.contains("does not exist")
        || w.contains("bad_network_name")
        || w.contains("not found")
    {
        "Diese Freigabe gibt es auf dem Server nicht.".into()
    } else if why.trim().is_empty() {
        "Die Freigabe ließ sich nicht verbinden.".into()
    } else {
        format!("SMB: {}", why.trim())
    }
}

/// Unhooks a share. NFS and gvfs really unmount; kio-fuse drops its connection by itself after a
/// while, so there is nothing to do but stop showing it.
pub fn disconnect(path: &Path) -> Result<()> {
    if mounted().iter().any(|m| m.path == path) {
        let out = run_with_timeout(
            Command::new("umount").arg(path),
            None,
            Duration::from_secs(20),
        )
        .map_err(|e| missing_tool(e, "umount"))?;
        if !out.ok {
            return Err(Error::Network(if out.stderr.contains("busy") {
                "Die Freigabe wird noch benutzt (ein Programm hat dort etwas offen).".into()
            } else {
                format!("Trennen ging nicht: {}", out.stderr.trim())
            }));
        }
        return Ok(());
    }
    let text = path.to_string_lossy();
    if text.contains("/gvfs/") {
        let out = run_with_timeout(
            Command::new("gio").args(["mount", "-u"]).arg(path),
            None,
            Duration::from_secs(20),
        )
        .map_err(|e| missing_tool(e, "gio"))?;
        if !out.ok {
            return Err(Error::Network(format!(
                "Trennen ging nicht: {}",
                out.stderr.trim()
            )));
        }
    }
    Ok(())
}

// ---- the keyring -------------------------------------------------------------------------------

/// Passwords live in the desktop's keyring (KWallet, GNOME Keyring) through `secret-tool`.
pub mod secrets {
    use super::*;

    const ATTR: [&str; 2] = ["application", "uwufiles"];

    pub fn store(share: &Share, password: &str) -> Result<()> {
        let key = share.address();
        let out = run_with_timeout(
            Command::new("secret-tool")
                .args(["store", "--label", &format!("UwUFiles: {key}")])
                .args(ATTR)
                .args(["share", &key]),
            Some(password.as_bytes()),
            Duration::from_secs(60),
        )
        .map_err(|e| missing_tool(e, "secret-tool (libsecret)"))?;
        if !out.ok {
            return Err(Error::Network(
                "Der Schlüsselbund hat das Passwort nicht genommen.".into(),
            ));
        }
        Ok(())
    }

    pub fn lookup(share: &Share) -> Option<String> {
        let out = run_with_timeout(
            Command::new("secret-tool")
                .arg("lookup")
                .args(ATTR)
                .args(["share", &share.address()]),
            None,
            Duration::from_secs(60),
        )
        .ok()?;
        (out.ok && !out.stdout.is_empty()).then_some(out.stdout)
    }

    pub fn forget(share: &Share) {
        let _ = run_with_timeout(
            Command::new("secret-tool")
                .arg("clear")
                .args(ATTR)
                .args(["share", &share.address()]),
            None,
            Duration::from_secs(20),
        );
    }
}

// ---- helpers --------------------------------------------------------------------------------

struct Output {
    ok: bool,
    stdout: String,
    stderr: String,
}

/// Runs `cmd`, feeding `input`, and gives up after `limit` (a server that is gone must not hang
/// the window).
fn run_with_timeout(
    cmd: &mut Command,
    input: Option<&[u8]>,
    limit: Duration,
) -> std::io::Result<Output> {
    let mut child = cmd
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    if let (Some(data), Some(mut stdin)) = (input, child.stdin.take()) {
        let _ = stdin.write_all(data);
    }
    let mut out_pipe = child.stdout.take().expect("piped");
    let mut err_pipe = child.stderr.take().expect("piped");
    let out_thread = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = out_pipe.read_to_string(&mut s);
        s
    });
    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = err_pipe.read_to_string(&mut s);
        s
    });
    let deadline = std::time::Instant::now() + limit;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break Some(status);
        }
        if std::time::Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(30));
    };
    let stdout = out_thread.join().unwrap_or_default();
    let mut stderr = err_thread.join().unwrap_or_default();
    if status.is_none() {
        stderr.push_str("timed out");
    }
    Ok(Output {
        ok: status.is_some_and(|s| s.success()),
        stdout,
        stderr,
    })
}

fn missing_tool(e: std::io::Error, tool: &str) -> Error {
    if e.kind() == std::io::ErrorKind::NotFound {
        Error::Network(format!("Dafür fehlt {tool} auf diesem System."))
    } else {
        Error::Network(e.to_string())
    }
}

/// A quick look whether `host` is there at all, so a typo fails in a second, not after a minute.
fn probe_host(host: &str) -> Result<()> {
    use std::net::{TcpStream, ToSocketAddrs};
    let addrs: Vec<_> = (host.trim_matches(['[', ']']), 0)
        .to_socket_addrs()
        .map_err(|_| Error::Network(format!("„{host}“ ist im Netzwerk nicht zu finden.")))?
        .collect();
    for port in [445, 2049, 111] {
        for addr in &addrs {
            let mut a = *addr;
            a.set_port(port);
            if TcpStream::connect_timeout(&a, Duration::from_millis(1500)).is_ok() {
                return Ok(());
            }
        }
    }
    Err(Error::Network(format!(
        "{host} antwortet nicht. Ist das NAS an?"
    )))
}

/// This computer's address as `host` sees it (the one the route to it goes out from).
fn own_address(host: &str) -> Option<std::net::IpAddr> {
    use std::net::{ToSocketAddrs, UdpSocket};
    let target = (host, 2049).to_socket_addrs().ok()?.next()?;
    let socket = UdpSocket::bind(if target.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    })
    .ok()?;
    socket.connect(target).ok()?;
    socket.local_addr().ok().map(|a| a.ip())
}

/// A file only this user can read, gone when dropped.
fn private_file(text: &str) -> Result<tempfile::NamedTempFile> {
    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let mut file = tempfile::Builder::new()
        .prefix("uwufiles-smb-")
        .tempfile_in(&dir)
        .map_err(|e| Error::io(&dir, e))?;
    // tempfile creates it 0600 already.
    file.write_all(text.as_bytes())
        .map_err(|e| Error::io(file.path(), e))?;
    Ok(file)
}

/// The characters a URL's user or password part may carry as they are.
fn encode_userinfo(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// fstab and /proc/mounts write a space as `\040`.
fn escape_octal(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        match c {
            ' ' => out.push_str("\\040"),
            '\t' => out.push_str("\\011"),
            '\\' => out.push_str("\\134"),
            '#' => out.push_str("\\043"),
            c => out.push(c),
        }
    }
    out
}

/// The other way round: `\040` back to a space.
pub fn unescape_octal(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 4 <= bytes.len() {
            if let Ok(n) = u8::from_str_radix(&s[i + 1..i + 4], 8) {
                out.push(n);
                i += 4;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nfs(host: &str, path: &str) -> Share {
        Share {
            protocol: Protocol::Nfs,
            host: host.into(),
            share: path.into(),
            user: None,
            domain: None,
        }
    }

    #[test]
    fn parses_addresses() {
        let s = parse_address("smb://mini@nas.local/daten/Fotos").unwrap();
        assert_eq!(
            (s.protocol, &*s.host, &*s.share),
            (Protocol::Smb, "nas.local", "daten")
        );
        assert_eq!(s.user.as_deref(), Some("mini"));
        let s = parse_address(r"\\192.168.1.2\Filme").unwrap();
        assert_eq!((&*s.host, &*s.share), ("192.168.1.2", "Filme"));
        let s = parse_address("smb://WORK;anna:geheim@nas/x").unwrap();
        assert_eq!(
            (s.domain.as_deref(), s.user.as_deref()),
            (Some("WORK"), Some("anna"))
        );
        let s = parse_address("nas:/volume1/Backups/").unwrap();
        assert_eq!((s.protocol, &*s.share), (Protocol::Nfs, "/volume1/Backups"));
        let s = parse_address("nfs://nas/volume1/ISO").unwrap();
        assert_eq!(s.address(), "nas:/volume1/ISO");
        assert!(parse_address("nas").is_none());
    }

    #[test]
    fn rejects_odd_hosts_and_shares() {
        assert!(nfs("-o evil", "/x").check().is_err());
        assert!(nfs("nas", "volume1").check().is_err());
        assert!(nfs("nas", "/a/../etc").check().is_err());
        assert!(nfs("nas", "/a\nb").check().is_err());
        assert!(nfs("192.168.1.2", "/volume1/ISO").check().is_ok());
    }

    #[test]
    fn reads_avahi_showmount_and_smbclient() {
        let avahi = "smb =;eno1;IPv4;VZOnlineStation;Microsoft Windows Network;local;VZ.local;192.168.194.2;445;\n\
                     smb =;eno1;IPv6;VZOnlineStation;Microsoft Windows Network;local;VZ.local;fe80::1;445;\n\
                     nfs =;eno1;IPv4;VZOnlineStation;NFS;local;VZ.local;192.168.194.2;2049;\n\
                     smb =;eno1;IPv4;EPSON\\032WF-7840;Microsoft Windows Network;local;E.local;192.168.194.72;445;";
        let servers = parse_avahi(avahi);
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].name, "EPSON WF-7840");
        assert_eq!(servers[1].protocols, vec![Protocol::Smb, Protocol::Nfs]);

        let exports =
            parse_showmount("/volume1/ISO 192.168.194.25,192.168.10.10\n/volume1/Pub *\n");
        assert_eq!(exports[0].clients, vec!["192.168.194.25", "192.168.10.10"]);
        assert_eq!(exports[1].clients, vec!["*"]);

        let shares = parse_smbclient("Disk|daten|\nDisk|IPC$|IPC\nPrinter|epson|\nDisk|Filme|x\n");
        assert_eq!(shares, vec!["daten", "Filme"]);
    }

    #[test]
    fn reads_mounts() {
        let m = parse_mounts(
            "192.168.194.2:/volume1/ISO /mnt/ISO nfs4 rw,relatime,vers=4.1,rsize=131072 0 0\n\
             //nas/Mein\\040Ordner /mnt/x cifs rw,vers=3.1.1 0 0\n\
             /dev/sda1 / btrfs rw 0 0\n",
        );
        assert_eq!(m.len(), 2);
        assert_eq!(m[0].version.as_deref(), Some("4.1"));
        assert_eq!(m[1].source, "//nas/Mein Ordner");
    }

    #[test]
    fn writes_and_removes_its_own_fstab_entries() {
        let fstab = "UUID=1 / btrfs defaults 0 0\n";
        let share = nfs("nas", "/volume1/Mein ISO");
        let NfsSetup::NeedsEntry { mount_point, line } = nfs_setup(&share, fstab).unwrap() else {
            panic!("expected a new entry");
        };
        assert_eq!(mount_point, PathBuf::from("/mnt/Mein_ISO"));
        assert!(line.starts_with("nas:/volume1/Mein\\040ISO  /mnt/Mein_ISO  nfs  user,noauto"));
        assert!(
            !line.contains("vers="),
            "mount.nfs picks the newest version itself"
        );

        let added = fstab_with(fstab, &line).unwrap();
        assert!(matches!(
            nfs_setup(&share, &added).unwrap(),
            NfsSetup::Ready { .. }
        ));
        assert_eq!(fstab_without(&added, &share.address()), fstab);

        assert!(fstab_with(fstab, "/dev/sda1 / ext4 defaults 0 0").is_err());
        let by_hand = "nas:/volume1/Mein\\040ISO /srv/iso nfs defaults 0 0\n";
        assert!(nfs_setup(&share, by_hand).is_err());
        assert_eq!(fstab_without(by_hand, &share.address()), by_hand);
    }

    #[test]
    fn encodes_passwords_for_urls() {
        assert_eq!(encode_userinfo("p@ss:wört/1"), "p%40ss%3Aw%C3%B6rt%2F1");
    }
}
