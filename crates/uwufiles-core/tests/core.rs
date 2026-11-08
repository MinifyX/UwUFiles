use std::fs;

use std::sync::atomic::AtomicBool;
use uwufiles_core::listing::{self, natural_cmp, Kind};

use uwufiles_core::ops::{self, Conflict, Transfer};
use uwufiles_core::Error;

static GO: AtomicBool = AtomicBool::new(false);

#[test]
fn lists_folders_first_and_sorts_like_people() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["Bild 10.png", "bild 2.png", "notes.txt", ".hidden"] {
        fs::write(dir.path().join(name), "x").unwrap();
    }
    fs::create_dir(dir.path().join("zeug")).unwrap();

    let names: Vec<_> = listing::list(dir.path(), false)
        .unwrap()
        .into_iter()
        .map(|e| e.name)
        .collect();
    assert_eq!(names, ["zeug", "bild 2.png", "Bild 10.png", "notes.txt"]);

    let all = listing::list(dir.path(), true).unwrap();
    assert!(all.iter().any(|e| e.name == ".hidden" && e.hidden));
    let folder = all.iter().find(|e| e.name == "zeug").unwrap();
    assert_eq!((folder.kind, folder.size), (Kind::Folder, Some(0)));
    assert_eq!(
        all.iter().find(|e| e.name == "notes.txt").unwrap().kind,
        Kind::Text
    );
}

#[test]
fn natural_order() {
    assert!(natural_cmp("a2", "a10").is_lt());
    assert!(natural_cmp("A", "b").is_lt());
    assert!(natural_cmp("x007", "x7").is_eq());
}

#[test]
fn kinds() {
    assert_eq!(Kind::from_name("Foto.JPG"), Kind::Image);
    assert_eq!(Kind::from_name(".bashrc"), Kind::Other);
    assert_eq!(Kind::from_name("x.tar.gz"), Kind::Archive);
}

#[test]
fn copying_into_the_same_folder_makes_a_copy() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("brief.txt");
    fs::write(&file, "hallo").unwrap();

    let first = ops::transfer(
        std::slice::from_ref(&file),
        dir.path(),
        Transfer::Copy,
        Conflict::KeepBoth,
        &GO,
        |_| {},
    )
    .unwrap();
    let second = ops::transfer(
        std::slice::from_ref(&file),
        dir.path(),
        Transfer::Copy,
        Conflict::KeepBoth,
        &GO,
        |_| {},
    )
    .unwrap();
    assert_eq!(first[0].file_name().unwrap(), "brief (Kopie).txt");
    assert_eq!(second[0].file_name().unwrap(), "brief (Kopie 2).txt");
    assert_eq!(fs::read_to_string(&second[0]).unwrap(), "hallo");
}

#[test]
fn copies_folders_recursively_with_progress() {
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("src");
    fs::create_dir_all(src.join("a/b")).unwrap();
    fs::write(src.join("a/b/c.txt"), "12345").unwrap();
    let dest = dir.path().join("dest");
    fs::create_dir(&dest).unwrap();

    let mut last = 0;
    let out = ops::transfer(
        std::slice::from_ref(&src),
        &dest,
        Transfer::Copy,
        Conflict::KeepBoth,
        &GO,
        |p| {
            assert_eq!(p.total_bytes, 5);
            last = p.done_bytes;
        },
    )
    .unwrap();
    assert_eq!(last, 5);
    assert_eq!(
        fs::read_to_string(out[0].join("a/b/c.txt")).unwrap(),
        "12345"
    );
    assert!(src.exists());
}

#[test]
fn moves_and_refuses_into_itself() {
    let dir = tempfile::tempdir().unwrap();
    let folder = dir.path().join("ordner");
    fs::create_dir(&folder).unwrap();
    let inner = folder.join("innen");
    fs::create_dir(&inner).unwrap();

    assert!(matches!(
        ops::transfer(
            std::slice::from_ref(&folder),
            &inner,
            Transfer::Move,
            Conflict::KeepBoth,
            &GO,
            |_| {}
        ),
        Err(Error::IntoItself)
    ));

    let file = dir.path().join("f.txt");
    fs::write(&file, "x").unwrap();
    let out = ops::transfer(
        std::slice::from_ref(&file),
        &folder,
        Transfer::Move,
        Conflict::KeepBoth,
        &GO,
        |_| {},
    )
    .unwrap();
    assert!(!file.exists());
    assert_eq!(out[0], folder.join("f.txt"));
}

#[test]
fn create_and_rename() {
    let dir = tempfile::tempdir().unwrap();
    let made = ops::create_dir(dir.path(), "  Neuer Ordner ").unwrap();
    assert_eq!(made.file_name().unwrap(), "Neuer Ordner");
    assert!(matches!(
        ops::create_dir(dir.path(), "Neuer Ordner"),
        Err(Error::AlreadyExists(_))
    ));
    assert!(matches!(
        ops::create_dir(dir.path(), "a/b"),
        Err(Error::InvalidName(_))
    ));

    let file = ops::create_file(dir.path(), "leer.txt").unwrap();
    assert!(matches!(
        ops::rename(&file, "Neuer Ordner"),
        Err(Error::AlreadyExists(_))
    ));
    let renamed = ops::rename(&file, "voll.txt").unwrap();
    assert!(renamed.exists() && !file.exists());
}

#[test]
fn free_names_keep_double_extensions() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.tar.gz"), "").unwrap();
    fs::write(dir.path().join(".bashrc"), "").unwrap();
    assert_eq!(
        ops::free_name(dir.path(), "a.tar.gz").file_name().unwrap(),
        "a (Kopie).tar.gz"
    );
    assert_eq!(
        ops::free_name(dir.path(), ".bashrc").file_name().unwrap(),
        ".bashrc (Kopie)"
    );
}

#[test]
fn conflicts_skip_and_cancel() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("a");
    let b = dir.path().join("b");
    fs::create_dir_all(&a).unwrap();
    fs::create_dir_all(&b).unwrap();
    fs::write(a.join("x.txt"), "neu").unwrap();
    fs::write(a.join("y.txt"), "y").unwrap();
    fs::write(b.join("x.txt"), "alt").unwrap();
    let sources = [a.join("x.txt"), a.join("y.txt")];

    assert_eq!(ops::conflicts(&sources, &b), ["x.txt"]);
    // Pasting where it came from is never a conflict.
    assert!(ops::conflicts(&sources, &a).is_empty());

    let out = ops::transfer(&sources, &b, Transfer::Copy, Conflict::Skip, &GO, |_| {}).unwrap();
    assert_eq!(out, [b.join("y.txt")]);
    assert_eq!(fs::read_to_string(b.join("x.txt")).unwrap(), "alt");

    let stop = AtomicBool::new(true);
    let c = dir.path().join("c");
    fs::create_dir(&c).unwrap();
    assert!(matches!(
        ops::transfer(
            &sources,
            &c,
            Transfer::Copy,
            Conflict::KeepBoth,
            &stop,
            |_| {}
        ),
        Err(Error::Cancelled)
    ));
    assert_eq!(fs::read_dir(&c).unwrap().count(), 0);
}

#[test]
fn desktop_files() {
    use uwufiles_core::apps::{self, command_lines, parse_desktop};
    let dir = tempfile::tempdir().unwrap();
    let apps_dir = dir.path().join("applications");
    fs::create_dir_all(&apps_dir).unwrap();
    fs::write(
        apps_dir.join("kate.desktop"),
        "[Desktop Entry]\nType=Application\nName=Kate\nName[de]=Kate (de)\nExec=kate -b %U\nMimeType=text/plain;\n\n[Desktop Action new]\nName=Neu\n",
    )
    .unwrap();
    fs::write(
        apps_dir.join("geheim.desktop"),
        "[Desktop Entry]\nType=Application\nName=X\nExec=x\nNoDisplay=true\nMimeType=text/plain;\n",
    )
    .unwrap();
    fs::write(
        apps_dir.join("gimp.desktop"),
        "[Desktop Entry]\nType=Application\nName=GIMP\nExec=gimp %f\nMimeType=image/*;\n",
    )
    .unwrap();

    let dirs = [dir.path().to_path_buf()];
    let for_rust = apps::apps_for("text/x-rust", &dirs, Some("kate.desktop"));
    assert_eq!(for_rust.len(), 1);
    assert_eq!(
        (for_rust[0].name.as_str(), for_rust[0].default),
        ("Kate (de)", true)
    );
    assert_eq!(apps::apps_for("image/png", &dirs, None)[0].name, "GIMP");

    let gimp = parse_desktop("gimp.desktop", "[Desktop Entry]\nName=GIMP\nExec=gimp %f\n").unwrap();
    assert_eq!(gimp.name, "GIMP");
    let two = [
        std::path::PathBuf::from("/a b.png"),
        std::path::PathBuf::from("/c.png"),
    ];
    assert_eq!(
        command_lines("gimp %f", &two),
        [vec!["gimp", "/a b.png"], vec!["gimp", "/c.png"]]
    );
    assert_eq!(
        command_lines("\"/opt/my app/run\" --x %U %i", &two),
        [vec!["/opt/my app/run", "--x", "/a b.png", "/c.png"]]
    );
    assert_eq!(command_lines("app 100%% %d", &[]), [vec!["app", "100%"]]);
}
