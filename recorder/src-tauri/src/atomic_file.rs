//! Replace metadata only after the entire new file is safely on disk.
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

pub fn write(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(".{}.{}.tmp", std::process::id(), NEXT_TEMP.fetch_add(1, Ordering::Relaxed)));
    let temporary = std::path::PathBuf::from(name);
    let result = (|| {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)?;
        #[cfg(unix)]
        if let Some(parent) = path.parent() {
            std::fs::File::open(parent)?.sync_all()?;
        }
        Ok(())
    })();
    if result.is_err() { let _ = std::fs::remove_file(temporary); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_existing_metadata_without_leaving_temporary_files() {
        let dir = std::env::temp_dir().join(format!("recorder-atomic-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("pending.json");
        write(&path, br#"{"transferComplete":false}"#).unwrap();
        write(&path, br#"{"transferComplete":true}"#).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), br#"{"transferComplete":true}"#);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
