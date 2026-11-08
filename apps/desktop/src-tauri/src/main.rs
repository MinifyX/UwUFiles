// No stray console window next to the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `uwufiles --fstab-add …` is the app itself run as root by pkexec, to add an NFS share.
    if let Some(code) = uwufiles_desktop_lib::fstab_helper() {
        std::process::exit(code);
    }
    uwufiles_desktop_lib::run()
}
