/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! The `vimma-ctl` binary against a fake control server (a `std::net::TcpListener` in the test).

use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const TOKEN: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
/// The welcome a real server sends for this `hello` line: its proof is HMAC-SHA256(token, nonce).
fn welcome(hello: &str) -> String {
    welcome_with_key(hello, TOKEN)
}

/// A welcome proving knowledge of `key` (a squatter does not know the token).
fn welcome_with_key(hello: &str, key: &str) -> String {
    let value = vimma_ctl::json::parse(hello).expect("hello is JSON");
    let Some(vimma_ctl::json::Value::String(nonce)) = value.get("nonce") else {
        panic!("hello without a nonce: {hello}")
    };
    let proof = vimma_ctl::hmac::hex(&vimma_ctl::hmac::hmac_sha256(
        key.as_bytes(),
        nonce.as_bytes(),
    ));
    format!(
        r#"{{"type":"welcome","protocol":1,"app":"Vimma","version":"0.1.0","proof":"{proof}"}}"#
    )
}

fn temp_profile() -> PathBuf {
    static N: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "vimma-ctl-it-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_discovery(profile: &Path, port: u16, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let path = profile.join("vimma-control.json");
    fs::write(
        &path,
        format!(r#"{{"protocol":1,"port":{port},"token":"{TOKEN}","pid":1}}"#),
    )
    .unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(mode)).unwrap();
}

/// One accepted connection: the lines it read, in order.
struct Server {
    profile: PathBuf,
    handle: JoinHandle<Vec<String>>,
}

impl Server {
    /// Start a fake server; `script` gets each line read and returns the lines to answer with,
    /// or `None` to stop reading (and close).
    fn start(mut script: impl FnMut(usize, &str) -> Option<Vec<String>> + Send + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let profile = temp_profile();
        write_discovery(&profile, listener.local_addr().unwrap().port(), 0o600);
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut writer = stream.try_clone().unwrap();
            let mut reader = BufReader::new(stream);
            let mut seen = Vec::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                let line = line.trim_end().to_string();
                let reply = script(seen.len(), &line);
                seen.push(line);
                let Some(reply) = reply else { break };
                for out in reply {
                    if writer.write_all(format!("{out}\n").as_bytes()).is_err() {
                        break;
                    }
                }
            }
            seen
        });
        Self { profile, handle }
    }

    /// A well-behaved server: welcome, then `response` (with `"id":1`) to the first request.
    fn answering(response: &'static str) -> Self {
        Self::start(move |n, line| match n {
            0 => Some(vec![welcome(line)]),
            1 => Some(vec![response.into()]),
            _ => None,
        })
    }

    fn lines(self) -> Vec<String> {
        self.handle.join().unwrap()
    }
}

fn vimma_ctl(profile: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_vimma-ctl"))
        .arg("--profile")
        .arg(profile)
        .args(args)
        .env_remove("VIMMA_PROFILE")
        .output()
        .unwrap()
}

fn stdout(o: &Output) -> String {
    String::from_utf8(o.stdout.clone()).unwrap()
}

fn stderr(o: &Output) -> String {
    String::from_utf8(o.stderr.clone()).unwrap()
}

#[test]
fn authenticates_and_sends_keys() {
    let server = Server::answering(r#"{"type":"response","id":1,"ok":true,"result":{"sent":2}}"#);
    let out = vimma_ctl(&server.profile, &["send-keys", "ctrl+b", "c"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(stdout(&out), "");
    let lines = server.lines();
    let hello = vimma_ctl::json::parse(&lines[0]).unwrap();
    let Some(vimma_ctl::json::Value::String(nonce)) = hello.get("nonce") else {
        panic!("no nonce: {}", lines[0])
    };
    assert!(
        nonce.len() == 64
            && nonce
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()),
        "nonce is 64 lowercase hex: {nonce}"
    );
    assert_eq!(
        lines[0],
        format!(r#"{{"nonce":"{nonce}","protocol":1,"token":"{TOKEN}","type":"hello"}}"#)
    );
    assert_eq!(
        lines[1],
        r#"{"args":{"keys":"ctrl+b c"},"command":"send-keys","id":1,"type":"request"}"#
    );
}

#[test]
fn reports_a_refused_token_with_exit_4() {
    let server = Server::start(|_, _| {
        Some(vec![
            r#"{"type":"response","id":null,"ok":false,"error":{"code":"unauthorized","message":"bad token"}}"#
                .into(),
        ])
    });
    let out = vimma_ctl(&server.profile, &["state"]);
    assert_eq!(out.status.code(), Some(4));
    assert_eq!(
        stderr(&out),
        "vimma-ctl: authentication failed: unauthorized: bad token\n"
    );
    assert_eq!(server.lines().len(), 1, "no request after a refused hello");
}

#[test]
fn prints_state_for_people() {
    let server = Server::answering(
        r#"{"type":"response","id":1,"ok":true,"result":{"mode":"normal","pending":null,"workspace":null,"tabs":[{"id":"12","url":"https://example.com/","title":"Example","selected":true}],"panes":null}}"#,
    );
    let out = vimma_ctl(&server.profile, &["state"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(
        stdout(&out),
        "mode: normal\npending: -\nworkspace: -\ntabs: 1\n* 12  Example  https://example.com/\n"
    );
    assert_eq!(
        server.lines()[1],
        r#"{"args":{},"command":"state","id":1,"type":"request"}"#
    );
}

#[test]
fn prints_state_as_json() {
    let server = Server::answering(
        r#"{"type":"response","id":1,"ok":true,"result":{"mode":"insert","pending":null,"workspace":"work","tabs":[],"panes":null,"later":true}}"#,
    );
    let out = vimma_ctl(&server.profile, &["state", "--json"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(
        stdout(&out),
        "{\"later\":true,\"mode\":\"insert\",\"panes\":null,\"pending\":null,\"tabs\":[],\"workspace\":\"work\"}\n"
    );
    drop(server.lines());
}

#[test]
fn opens_a_url_and_prints_the_tab() {
    let server = Server::answering(r#"{"type":"response","id":1,"ok":true,"result":{"tab":"14"}}"#);
    let out = vimma_ctl(&server.profile, &["open", "https://example.com/"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(stdout(&out), "14\n");
    assert_eq!(
        server.lines()[1],
        r#"{"args":{"url":"https://example.com/","where":"tab"},"command":"open","id":1,"type":"request"}"#
    );
}

#[test]
fn reports_a_server_error_with_exit_1() {
    let server = Server::answering(
        r#"{"type":"response","id":1,"ok":false,"error":{"code":"invalid-args","message":"url scheme must be http, https, file or about"}}"#,
    );
    let out = vimma_ctl(&server.profile, &["open", "javascript:alert(1)"]);
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(
        stderr(&out),
        "vimma-ctl: invalid-args: url scheme must be http, https, file or about\n"
    );
    drop(server.lines());
}

#[test]
fn rejects_malformed_responses_with_exit_5() {
    for (bad, expected) in [
        ("this is not json", "not valid JSON"),
        (
            r#"{"type":"response","id":2,"ok":true,"result":{"sent":1}}"#,
            "expected id 1, got 2",
        ),
        (
            r#"{"type":"response","id":1,"ok":true,"result":{"sent":"1"}}"#,
            "result.sent",
        ),
        (
            r#"{"type":"response","id":1,"ok":false,"error":{"code":"nope","message":"x"}}"#,
            "error.code",
        ),
    ] {
        let server = Server::answering(bad);
        let out = vimma_ctl(&server.profile, &["send-keys", "j"]);
        assert_eq!(out.status.code(), Some(5), "{bad}: {}", stderr(&out));
        let err = stderr(&out);
        assert!(err.starts_with("vimma-ctl: protocol error: "), "{err}");
        assert!(err.contains(expected), "{bad}: {err}");
        drop(server.lines());
    }
}

#[test]
fn rejects_a_malformed_welcome_and_an_early_close() {
    let server = Server::start(|_, _| Some(vec![r#"{"type":"welcome","protocol":"1"}"#.into()]));
    let out = vimma_ctl(&server.profile, &["state"]);
    assert_eq!(out.status.code(), Some(5), "{}", stderr(&out));
    drop(server.lines());

    let server = Server::start(|_, _| None);
    let out = vimma_ctl(&server.profile, &["state"]);
    assert_eq!(out.status.code(), Some(5), "{}", stderr(&out));
    assert!(
        stderr(&out).contains("connection closed"),
        "{}",
        stderr(&out)
    );
    drop(server.lines());
}

#[test]
fn rejects_an_oversized_line() {
    let server = Server::start(|_, _| Some(vec!["x".repeat(1024 * 1024 + 1)]));
    let out = vimma_ctl(&server.profile, &["state"]);
    assert_eq!(out.status.code(), Some(5), "{}", stderr(&out));
    assert!(stderr(&out).contains("longer than"), "{}", stderr(&out));
    drop(server.lines());
}

#[test]
fn times_out_when_the_server_is_silent() {
    let server = Server::start(|_, _| Some(vec![]));
    let started = Instant::now();
    let out = vimma_ctl(&server.profile, &["--timeout", "0.5", "state"]);
    let elapsed = started.elapsed();
    assert_eq!(out.status.code(), Some(5), "{}", stderr(&out));
    assert_eq!(
        stderr(&out),
        "vimma-ctl: protocol error: no reply within 0.5 s\n"
    );
    assert!(elapsed < Duration::from_secs(3), "{elapsed:?}");
    drop(server.lines());
}

#[test]
fn times_out_after_the_handshake_too() {
    let server = Server::start(|n, line| {
        if n == 0 {
            Some(vec![welcome(line)])
        } else {
            Some(vec![])
        }
    });
    let out = vimma_ctl(&server.profile, &["--timeout", "0.5", "state"]);
    assert_eq!(out.status.code(), Some(5), "{}", stderr(&out));
    assert!(stderr(&out).contains("no reply within 0.5 s"));
    drop(server.lines());
}

#[test]
fn reports_an_absent_server_with_exit_3() {
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    };
    let profile = temp_profile();
    write_discovery(&profile, port, 0o600);
    let out = vimma_ctl(&profile, &["state"]);
    assert_eq!(out.status.code(), Some(3));
    let err = stderr(&out);
    assert!(
        err.starts_with(&format!(
            "vimma-ctl: Vimma is not running (or the control socket is off): cannot connect to 127.0.0.1:{port}"
        )),
        "{err}"
    );
    assert!(err.contains("stale"), "{err}");
}

#[test]
fn reports_a_missing_discovery_file_with_exit_3() {
    let profile = temp_profile();
    let out = vimma_ctl(&profile, &["state"]);
    assert_eq!(out.status.code(), Some(3));
    let err = stderr(&out);
    assert!(err.contains("vimma-control.json"), "{err}");
    assert!(err.contains("vimma.control.enabled"), "{err}");
}

#[test]
fn refuses_an_insecure_discovery_file() {
    let profile = temp_profile();
    write_discovery(&profile, 1, 0o640);
    let out = vimma_ctl(&profile, &["state"]);
    assert_eq!(out.status.code(), Some(3));
    assert!(stderr(&out).contains("chmod 600"), "{}", stderr(&out));
}

#[test]
fn finds_the_default_profile_through_profiles_ini() {
    let server = Server::answering(r#"{"type":"response","id":1,"ok":true,"result":{"sent":1}}"#);
    let config = temp_profile();
    let root = config.join("vimma/vimma");
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("profiles.ini"),
        format!(
            "[InstallABC]\nDefault={}\n\n[Profile0]\nName=default\nIsRelative=1\nPath=other\nDefault=1\n",
            server.profile.display()
        ),
    )
    .unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_vimma-ctl"))
        .args(["send-keys", "j"])
        .env("XDG_CONFIG_HOME", &config)
        .env("HOME", &config)
        .env_remove("VIMMA_PROFILE")
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0), "{}", stderr(&out));
    drop(server.lines());
}

#[test]
fn rejects_a_huge_timeout_without_panicking() {
    let out = vimma_ctl(Path::new("/nonexistent"), &["--timeout", "1e19", "state"]);
    assert_eq!(out.status.code(), Some(2), "{}", stderr(&out));
    assert!(
        stderr(&out).starts_with("vimma-ctl: --timeout must be at most 3600 seconds\n"),
        "{}",
        stderr(&out)
    );
}

#[test]
fn reports_a_busy_server_with_exit_3() {
    let server = Server::start(|_, _| {
        Some(vec![
            r#"{"type":"response","id":null,"ok":false,"error":{"code":"busy","message":"8 connections open"}}"#
                .into(),
        ])
    });
    let out = vimma_ctl(&server.profile, &["state"]);
    assert_eq!(out.status.code(), Some(3), "{}", stderr(&out));
    assert_eq!(
        stderr(&out),
        "vimma-ctl: Vimma's control socket is busy (busy: 8 connections open); try again\n"
    );
    drop(server.lines());
}

#[test]
fn reports_a_drop_after_the_handshake_with_exit_5() {
    // The server's idle timeout or connection cap closing an authenticated connection.
    let server = Server::start(|n, line| {
        if n == 0 {
            Some(vec![welcome(line)])
        } else {
            None
        }
    });
    let out = vimma_ctl(&server.profile, &["state"]);
    assert_eq!(out.status.code(), Some(5), "{}", stderr(&out));
    assert_eq!(
        stderr(&out),
        "vimma-ctl: protocol error: connection closed before a complete reply\n"
    );
    drop(server.lines());
}

#[test]
fn usage_errors_exit_2() {
    let out = vimma_ctl(Path::new("/nonexistent"), &["frobnicate"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(stderr(&out).starts_with("vimma-ctl: unknown command \"frobnicate\"\n"));
}

#[test]
fn the_fake_server_speaks_on_loopback_only() {
    // Guard for the tests themselves: the client must dial 127.0.0.1, which this connects to.
    let server = Server::start(|_, _| None);
    let port = fs::read_to_string(server.profile.join("vimma-control.json")).unwrap();
    assert!(port.contains("\"port\":"));
    let addr = format!(
        "127.0.0.1:{}",
        port.split("\"port\":")
            .nth(1)
            .unwrap()
            .split(',')
            .next()
            .unwrap()
    );
    drop(TcpStream::connect(addr).unwrap());
    drop(server.lines());
}

#[test]
fn a_fresh_nonce_per_connection() {
    let first = Server::answering(r#"{"type":"response","id":1,"ok":true,"result":{"sent":1}}"#);
    let second = Server::answering(r#"{"type":"response","id":1,"ok":true,"result":{"sent":1}}"#);
    assert_eq!(
        vimma_ctl(&first.profile, &["send-keys", "j"]).status.code(),
        Some(0)
    );
    assert_eq!(
        vimma_ctl(&second.profile, &["send-keys", "j"])
            .status
            .code(),
        Some(0)
    );
    assert_ne!(first.lines()[0], second.lines()[0], "nonces differ");
}

#[test]
fn refuses_a_squatter_that_cannot_prove_the_token() {
    // Something else bound a stale discovery file's port: it answers welcome without knowing the
    // token. vimma-ctl must stop before sending the command (exit 4).
    let server = Server::start(|n, line| match n {
        0 => Some(vec![welcome_with_key(line, &"f".repeat(64))]),
        _ => Some(vec![
            r#"{"type":"response","id":1,"ok":true,"result":{"sent":1}}"#.into(),
        ]),
    });
    let out = vimma_ctl(&server.profile, &["send-keys", "secret"]);
    assert_eq!(out.status.code(), Some(4), "{}", stderr(&out));
    assert!(
        stderr(&out).contains("did not prove it knows the token"),
        "{}",
        stderr(&out)
    );
    assert_eq!(
        server.lines().len(),
        1,
        "nothing sent after the bad welcome"
    );
}

#[test]
fn refuses_a_welcome_without_a_proof() {
    let server = Server::start(|n, _| match n {
        0 => Some(vec![
            r#"{"type":"welcome","protocol":1,"app":"Vimma","version":"0.1.0"}"#.into(),
        ]),
        _ => Some(vec![
            r#"{"type":"response","id":1,"ok":true,"result":{"sent":1}}"#.into(),
        ]),
    });
    let out = vimma_ctl(&server.profile, &["send-keys", "secret"]);
    assert_ne!(out.status.code(), Some(0), "{}", stderr(&out));
    assert_eq!(
        server.lines().len(),
        1,
        "nothing sent after the bad welcome"
    );
}

#[test]
fn reports_a_discovery_file_whose_process_has_exited() {
    let profile = temp_profile();
    let path = profile.join("vimma-control.json");
    fs::write(
        &path,
        format!(r#"{{"protocol":1,"port":4000,"token":"{TOKEN}","pid":999999999}}"#),
    )
    .unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    }
    let out = vimma_ctl(&profile, &["state"]);
    assert_eq!(out.status.code(), Some(3), "{}", stderr(&out));
    assert!(
        stderr(&out).contains("pid 999999999") && stderr(&out).contains("stale"),
        "{}",
        stderr(&out)
    );
}
