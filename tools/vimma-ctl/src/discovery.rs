/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Finding the profile and reading its discovery file (Linux first; spec § Profile discovery).

use crate::json;
use crate::protocol::{Discovery, decode_discovery};
use std::fmt;
use std::path::{Path, PathBuf};

/// The discovery file's name inside the profile.
pub const FILE_NAME: &str = "vimma-control.json";
/// The pref that turns the control socket on.
pub const PREF: &str = "vimma.control.enabled";

/// The environment discovery depends on, injected so tests need not touch the process's.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Env {
    pub home: Option<PathBuf>,
    pub xdg_config_home: Option<PathBuf>,
    /// `VIMMA_PROFILE`: a profile directory, like `--profile`.
    pub profile: Option<PathBuf>,
}

impl Env {
    /// Read `HOME`, `XDG_CONFIG_HOME` and `VIMMA_PROFILE`; empty values count as unset.
    #[must_use]
    pub fn from_process() -> Self {
        let var = |name: &str| {
            std::env::var_os(name)
                .filter(|v| !v.is_empty())
                .map(PathBuf::from)
        };
        Self {
            home: var("HOME"),
            xdg_config_home: var("XDG_CONFIG_HOME"),
            profile: var("VIMMA_PROFILE"),
        }
    }
}

/// Why no usable discovery file was found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryError(pub String);

impl fmt::Display for DiscoveryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for DiscoveryError {}

/// The directory holding `profiles.ini`: `$XDG_CONFIG_HOME/vimma/vimma` (default
/// `~/.config/vimma/vimma`), or the legacy `~/.vimma/vimma` when that exists.
#[must_use]
pub fn profiles_root(env: &Env) -> Option<PathBuf> {
    if let Some(home) = &env.home {
        let legacy = home.join(".vimma/vimma");
        if legacy.is_dir() {
            return Some(legacy);
        }
    }
    let config = env
        .xdg_config_home
        .clone()
        .or_else(|| env.home.as_ref().map(|home| home.join(".config")))?;
    Some(config.join("vimma/vimma"))
}

/// `[section]` → key/value pairs, in file order.
fn parse_ini(text: &str) -> Vec<(String, Vec<(String, String)>)> {
    let mut sections: Vec<(String, Vec<(String, String)>)> = Vec::new();
    for line in text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            sections.push((name.trim().to_string(), Vec::new()));
        } else if let (Some((key, value)), Some(section)) =
            (line.split_once('='), sections.last_mut())
        {
            section
                .1
                .push((key.trim().to_string(), value.trim().to_string()));
        }
    }
    sections
}

fn lookup<'a>(pairs: &'a [(String, String)], key: &str) -> Option<&'a str> {
    pairs
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
        .filter(|v| !v.is_empty())
}

/// The default profile named by a `profiles.ini`: the first `[Install…]` section's `Default`,
/// else the `[Profile…]` with `Default=1`, else the only `[Profile…]`.
#[must_use]
pub fn profile_from_ini(text: &str, root: &Path) -> Option<PathBuf> {
    let sections = parse_ini(text);
    // Install sections hold a Path value as written in [Profile…], i.e. relative to the root
    // unless absolute; `Path::join` keeps an absolute path as it is.
    if let Some(path) = sections
        .iter()
        .filter(|(name, _)| name.starts_with("Install"))
        .find_map(|(_, pairs)| lookup(pairs, "Default"))
    {
        return Some(root.join(path));
    }
    let profiles: Vec<&Vec<(String, String)>> = sections
        .iter()
        .filter(|(name, pairs)| name.starts_with("Profile") && lookup(pairs, "Path").is_some())
        .map(|(_, pairs)| pairs)
        .collect();
    let chosen = profiles
        .iter()
        .find(|pairs| lookup(pairs, "Default") == Some("1"))
        .or(if profiles.len() == 1 {
            profiles.first()
        } else {
            None
        })?;
    let path = lookup(chosen, "Path")?;
    Some(if lookup(chosen, "IsRelative") == Some("0") {
        PathBuf::from(path)
    } else {
        root.join(path)
    })
}

/// The profile directory: `explicit` (`--profile`), else `VIMMA_PROFILE`, else the default
/// profile from `profiles.ini`.
///
/// # Errors
/// When there is no home directory, no `profiles.ini`, or it names no profile.
pub fn find_profile(explicit: Option<&Path>, env: &Env) -> Result<PathBuf, DiscoveryError> {
    if let Some(dir) = explicit
        .map(Path::to_path_buf)
        .or_else(|| env.profile.clone())
    {
        return Ok(dir);
    }
    let root = profiles_root(env).ok_or_else(|| {
        DiscoveryError("cannot find the Vimma profile: HOME is not set; pass --profile".into())
    })?;
    let ini = root.join("profiles.ini");
    let text = std::fs::read_to_string(&ini).map_err(|e| {
        DiscoveryError(format!(
            "cannot find the Vimma profile: cannot read {}: {e}; has Vimma run? Or pass --profile",
            ini.display()
        ))
    })?;
    profile_from_ini(&text, &root).ok_or_else(|| {
        DiscoveryError(format!(
            "cannot find the Vimma profile: {} names no default profile; pass --profile",
            ini.display()
        ))
    })
}

/// Read and check `<profile>/vimma-control.json`.
///
/// # Errors
/// When the file is missing, readable by group or others, or not a valid discovery file.
pub fn read_discovery(profile: &Path) -> Result<Discovery, DiscoveryError> {
    let path = profile.join(FILE_NAME);
    let metadata = std::fs::metadata(&path).map_err(|e| {
        DiscoveryError(format!(
            "Vimma is not running (or the control socket is off): no {} ({e}); \
             set the pref {PREF} to true",
            path.display()
        ))
    })?;
    check_mode(&path, &metadata)?;
    let text = std::fs::read_to_string(&path)
        .map_err(|e| DiscoveryError(format!("cannot read {}: {e}", path.display())))?;
    let value = json::parse(&text)
        .map_err(|e| DiscoveryError(format!("{} is not valid JSON: {e}", path.display())))?;
    decode_discovery(&value)
        .map_err(|e| DiscoveryError(format!("{} is not a discovery file: {e}", path.display())))
}

#[cfg(unix)]
fn check_mode(path: &Path, metadata: &std::fs::Metadata) -> Result<(), DiscoveryError> {
    use std::os::unix::fs::PermissionsExt;
    let mode = metadata.permissions().mode() & 0o777;
    if mode & 0o077 != 0 {
        return Err(DiscoveryError(format!(
            "refusing {}: mode {mode:o} lets other users read the token; run chmod 600 on it",
            path.display()
        )));
    }
    Ok(())
}

#[cfg(not(unix))]
fn check_mode(_path: &Path, _metadata: &std::fs::Metadata) -> Result<(), DiscoveryError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn temp_dir() -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "vimma-ctl-unit-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(unix)]
    fn write_mode(path: &Path, text: &str, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        fs::write(path, text).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
    }

    const REAL_INI: &str = "[Install4F96D1932A9F858E]\nDefault=jpa751c5.default-release\nLocked=1\n\n\
        [Profile1]\nName=default\nIsRelative=1\nPath=73jd4zyp.default\nDefault=1\n\n\
        [Profile0]\nName=default-release\nIsRelative=1\nPath=jpa751c5.default-release\n\n\
        [General]\nStartWithLastProfile=1\nVersion=2\n";

    #[test]
    fn install_section_default_wins_over_profile_default() {
        let root = Path::new("/r");
        assert_eq!(
            profile_from_ini(REAL_INI, root),
            Some(root.join("jpa751c5.default-release"))
        );
    }

    #[test]
    fn falls_back_to_the_default_profile_then_the_only_one() {
        let root = Path::new("/r");
        let two = "[Profile0]\nPath=a\nIsRelative=1\n[Profile1]\nPath=b\nIsRelative=1\nDefault=1\n";
        assert_eq!(profile_from_ini(two, root), Some(root.join("b")));
        let one =
            "; comment\n# comment\n[General]\nVersion=2\n[Profile0]\n Path = only \nIsRelative=1\n";
        assert_eq!(profile_from_ini(one, root), Some(root.join("only")));
        let ambiguous = "[Profile0]\nPath=a\nIsRelative=1\n[Profile1]\nPath=b\nIsRelative=1\n";
        assert_eq!(profile_from_ini(ambiguous, root), None);
        assert_eq!(profile_from_ini("", root), None);
    }

    #[test]
    fn absolute_paths_are_kept() {
        let ini = "[Profile0]\nPath=/elsewhere/p\nIsRelative=0\nDefault=1\n";
        assert_eq!(
            profile_from_ini(ini, Path::new("/r")),
            Some(PathBuf::from("/elsewhere/p"))
        );
    }

    #[test]
    fn install_default_may_be_absolute() {
        let ini = "[InstallABC]\nDefault=/abs/p\n[Profile0]\nPath=x\nIsRelative=1\n";
        assert_eq!(
            profile_from_ini(ini, Path::new("/r")),
            Some(PathBuf::from("/abs/p"))
        );
    }

    #[test]
    fn root_prefers_xdg_then_home_then_legacy() {
        let home = temp_dir();
        let env = Env {
            home: Some(home.clone()),
            xdg_config_home: Some(PathBuf::from("/xdg")),
            profile: None,
        };
        assert_eq!(profiles_root(&env), Some(PathBuf::from("/xdg/vimma/vimma")));
        let env = Env {
            xdg_config_home: None,
            ..env
        };
        assert_eq!(profiles_root(&env), Some(home.join(".config/vimma/vimma")));
        fs::create_dir_all(home.join(".vimma/vimma")).unwrap();
        assert_eq!(profiles_root(&env), Some(home.join(".vimma/vimma")));
        assert_eq!(profiles_root(&Env::default()), None);
    }

    #[test]
    fn find_profile_order() {
        let root = temp_dir();
        let env = Env {
            home: None,
            xdg_config_home: Some(root.clone()),
            profile: Some(PathBuf::from("/from-env")),
        };
        assert_eq!(
            find_profile(Some(Path::new("/explicit")), &env),
            Ok(PathBuf::from("/explicit"))
        );
        assert_eq!(find_profile(None, &env), Ok(PathBuf::from("/from-env")));
        let env = Env {
            profile: None,
            ..env
        };
        let err = find_profile(None, &env).unwrap_err();
        assert!(err.0.contains("profiles.ini"), "{err}");
        fs::create_dir_all(root.join("vimma/vimma")).unwrap();
        fs::write(root.join("vimma/vimma/profiles.ini"), REAL_INI).unwrap();
        assert_eq!(
            find_profile(None, &env),
            Ok(root.join("vimma/vimma/jpa751c5.default-release"))
        );
        fs::write(root.join("vimma/vimma/profiles.ini"), "[General]\n").unwrap();
        assert!(
            find_profile(None, &env)
                .unwrap_err()
                .0
                .contains("--profile")
        );
        assert!(find_profile(None, &Env::default()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn reads_a_0600_discovery_file() {
        let dir = temp_dir();
        let text = format!(r#"{{"protocol":1,"port":4000,"token":"{TOKEN}","pid":7}}"#);
        write_mode(&dir.join(FILE_NAME), &text, 0o600);
        let found = read_discovery(&dir).unwrap();
        assert_eq!(found.port, 4000);
        assert_eq!(found.pid, 7);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_file_others_can_read() {
        let dir = temp_dir();
        let text = format!(r#"{{"protocol":1,"port":4000,"token":"{TOKEN}","pid":7}}"#);
        write_mode(&dir.join(FILE_NAME), &text, 0o644);
        let err = read_discovery(&dir).unwrap_err();
        assert!(err.0.contains("chmod 600"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn reports_missing_and_invalid_files() {
        let dir = temp_dir();
        let err = read_discovery(&dir).unwrap_err();
        assert!(err.0.contains("not running"), "{err}");
        assert!(err.0.contains(PREF), "{err}");
        write_mode(&dir.join(FILE_NAME), "{", 0o600);
        assert!(
            read_discovery(&dir)
                .unwrap_err()
                .0
                .contains("not valid JSON")
        );
        write_mode(&dir.join(FILE_NAME), r#"{"port":1}"#, 0o600);
        assert!(read_discovery(&dir).unwrap_err().0.contains("protocol"));
    }
}
