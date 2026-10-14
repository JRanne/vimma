/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! A blocking control-socket connection: connect, handshake, one request at a time, all under
//! one deadline.

use crate::json::{self, Value};
use crate::protocol::{
    self, Command, CommandResult, Discovery, ErrorBody, MAX_LINE, Response, Role,
};
use std::fmt;
use std::io::{self, BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

/// What went wrong talking to the server. [`Error::exit_code`] maps it to the CLI's exit code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// The server answered the request with an error (exit 1).
    Server(ErrorBody),
    /// Nothing to talk to (exit 3).
    NotRunning(String),
    /// The handshake was refused (exit 4).
    Auth(ErrorBody),
    /// The server broke the protocol, closed early, or was too slow (exit 5).
    Protocol(String),
    /// The server is at its connection limit (exit 3, like not reachable: retry later).
    Busy(ErrorBody),
    /// The server's welcome did not prove it knows the token: not Vimma (exit 4).
    Impostor(String),
    /// The user said no to full control while MCP is on, or did not answer (exit 4;
    /// docs/specs/vimma-mcp.md decision 29 C).
    Denied(ErrorBody),
}

/// Longest allowed timeout; [`Client::connect`] clamps to it so the deadline cannot overflow.
pub const MAX_TIMEOUT: Duration = Duration::from_secs(3600);

/// How long the welcome may take while MCP is on: Vimma asks the user first, for at most
/// `[mcp] ask_timeout` (300 s at most), and answers by then (docs/specs/vimma-mcp.md, 29 C).
pub const ASK_WAIT: Duration = Duration::from_secs(310);

impl Error {
    #[must_use]
    pub fn exit_code(&self) -> i32 {
        match self {
            Error::Server(_) => 1,
            Error::NotRunning(_) | Error::Busy(_) => 3,
            Error::Auth(_) | Error::Impostor(_) | Error::Denied(_) => 4,
            Error::Protocol(_) => 5,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Server(e) => write!(f, "{}: {}", e.code, e.message),
            Error::NotRunning(message) | Error::Impostor(message) => f.write_str(message),
            Error::Auth(e) => write!(f, "authentication failed: {}: {}", e.code, e.message),
            Error::Denied(e) => match &e.reason {
                Some(reason) => write!(f, "full control refused: {} ({reason})", e.message),
                None => write!(f, "full control refused: {}", e.message),
            },
            Error::Protocol(message) => write!(f, "protocol error: {message}"),
            Error::Busy(e) => write!(
                f,
                "Vimma's control socket is busy ({}: {}); try again",
                e.code, e.message
            ),
        }
    }
}

impl std::error::Error for Error {}

/// An authenticated connection.
#[derive(Debug)]
pub struct Client {
    reader: BufReader<TcpStream>,
    deadline: Instant,
    timeout: Duration,
    next_id: u32,
}

impl Client {
    /// Connect to `127.0.0.1:<port>` and authenticate; everything, including later calls, must
    /// finish within `timeout`.
    ///
    /// # Errors
    /// [`Error::NotRunning`] when nothing listens, [`Error::Auth`] when the token or protocol is
    /// refused, [`Error::Protocol`] on a malformed or late reply.
    pub fn connect(discovery: &Discovery, timeout: Duration) -> Result<Self, Error> {
        // vimma-ctl's commands are the `full` role. A protocol 2 Vimma says which roles it
        // serves: with only MCP on, the control socket's full side is off (vimma-mcp decision 3).
        if !discovery.roles.contains(&Role::Full) {
            return Err(Error::NotRunning(
                "Vimma's control socket is off (only MCP is on); set the pref \
                 vimma.control.enabled to true"
                    .to_string(),
            ));
        }
        // Speak the newest protocol both sides know: 2 (role full) when the file says 2.
        let protocol = discovery.protocol.min(protocol::PROTOCOL);
        let timeout = timeout.min(MAX_TIMEOUT);
        let deadline = Instant::now()
            .checked_add(timeout)
            .ok_or_else(|| Error::Protocol("timeout out of range".to_string()))?;
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, discovery.port));
        let stream = TcpStream::connect_timeout(&addr, timeout).map_err(|e| {
            Error::NotRunning(format!(
                "Vimma is not running (or the control socket is off): cannot connect to {addr}: \
                 {e}; the discovery file may be stale (pid {})",
                discovery.pid
            ))
        })?;
        let mut client = Self {
            reader: BufReader::new(stream),
            deadline,
            timeout,
            next_id: 1,
        };
        let nonce = random_nonce().map_err(|e| {
            Error::Protocol(format!("cannot read random bytes for the handshake: {e}"))
        })?;
        // 1. hello: a fresh nonce and no token.
        let hello = if protocol >= 2 {
            protocol::hello_v2(&nonce, Role::Full)
        } else {
            protocol::hello(&nonce)
        };
        client.send(&hello)?;
        let reply = client.handshake_reply("challenge")?;
        let challenge = protocol::decode_challenge(&reply).map_err(protocol_error)?;
        if challenge.protocol != protocol {
            return Err(Error::Protocol(format!(
                "server speaks protocol {}, this vimma-ctl speaks {protocol}",
                challenge.protocol
            )));
        }
        // 2. The server proves it knows the token before we send it. A process squatting on a
        // stale discovery file's port cannot: it has seen only the nonce. It gets nothing more.
        let expected = protocol::challenge_proof(&discovery.token, &nonce);
        if !crate::hmac::constant_time_eq(challenge.proof.as_bytes(), expected.as_bytes()) {
            return Err(Error::Impostor(format!(
                "the server on port {} did not prove it knows the token: it is not this Vimma \
                 (the discovery file may be stale); neither the token nor the command was sent",
                discovery.port
            )));
        }
        // 3. auth: now the token; 4. welcome. While MCP is on (the `agent` role is served), Vimma
        // asks the user before it welcomes a full connection: wait for that answer, then give
        // the command its own timeout.
        let asks = protocol >= 2 && discovery.roles.contains(&Role::Agent);
        if asks {
            let code = random_code().map_err(|e| {
                Error::Protocol(format!("cannot read random bytes for the code: {e}"))
            })?;
            let auth = protocol::auth_with_code(&discovery.token, &code);
            auth_then_code(
                || client.send(&auth),
                || {
                    eprintln!(
                        "vimma-ctl: MCP is on: answer y in Vimma to let this vimma-ctl in (full \
                         control); Vimma asks with code {code}: answer y only if it shows {code}"
                    );
                },
            )?;
            if let Some(later) = Instant::now().checked_add(ASK_WAIT) {
                client.deadline = client.deadline.max(later);
            }
        } else {
            client.send(&protocol::auth(&discovery.token))?;
        }
        let reply = client.handshake_reply("welcome")?;
        if asks {
            if let Some(deadline) = Instant::now().checked_add(timeout) {
                client.deadline = deadline;
            }
        }
        let welcome = protocol::decode_welcome(&reply).map_err(protocol_error)?;
        if welcome.protocol != protocol || welcome.role != Role::Full {
            return Err(Error::Protocol(format!(
                "server speaks protocol {} as {}, this vimma-ctl speaks {protocol} as full",
                welcome.protocol,
                welcome.role.name()
            )));
        }
        Ok(client)
    }

    /// The next handshake line: an error response becomes [`Error::Busy`] or [`Error::Auth`].
    fn handshake_reply(&mut self, expected: &str) -> Result<Value, Error> {
        let reply = self.receive()?;
        if reply.get("type") == Some(&Value::String("response".into())) {
            return match protocol::decode_response(&reply).map_err(protocol_error)? {
                Response::Err { error, .. } if error.code == "busy" => Err(Error::Busy(error)),
                // The role asked for is off in Vimma: like a socket that is off (exit 3).
                Response::Err { error, .. } if error.code == "role-off" => Err(Error::NotRunning(
                    format!("{}: {}", error.code, error.message),
                )),
                Response::Err { error, .. } if error.code == "denied" => Err(Error::Denied(error)),
                Response::Err { error, .. } => Err(Error::Auth(error)),
                Response::Ok { .. } => Err(Error::Protocol(format!(
                    "expected {expected}, got a result"
                ))),
            };
        }
        Ok(reply)
    }

    /// Send one command and decode its result.
    ///
    /// # Errors
    /// [`Error::Server`] for an error response, [`Error::Protocol`] for anything malformed.
    pub fn call(&mut self, command: &Command) -> Result<CommandResult, Error> {
        let id = self.next_id;
        self.next_id += 1;
        self.send(&protocol::request(id, command))?;
        let reply = self.receive()?;
        match protocol::decode_response(&reply).map_err(protocol_error)? {
            Response::Ok { id: got, .. } | Response::Err { id: got, .. }
                if got != Some(u64::from(id)) =>
            {
                Err(Error::Protocol(match got {
                    Some(got) => format!("expected id {id}, got {got}"),
                    None => format!("expected id {id}, got null"),
                }))
            }
            Response::Ok { result, .. } => {
                protocol::decode_result(command, &result).map_err(protocol_error)
            }
            Response::Err { error, .. } => Err(Error::Server(error)),
        }
    }

    fn remaining(&self) -> Result<Duration, Error> {
        self.deadline
            .checked_duration_since(Instant::now())
            .filter(|left| !left.is_zero())
            .ok_or_else(|| self.timed_out())
    }

    fn timed_out(&self) -> Error {
        Error::Protocol(format!("no reply within {} s", self.timeout.as_secs_f64()))
    }

    fn io_error(&self, e: &io::Error) -> Error {
        match e.kind() {
            io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut => self.timed_out(),
            _ => Error::Protocol(format!("connection failed: {e}")),
        }
    }

    fn send(&mut self, message: &Value) -> Result<(), Error> {
        let left = self.remaining()?;
        let stream = self.reader.get_mut();
        stream
            .set_write_timeout(Some(left))
            .and_then(|()| stream.write_all(format!("{message}\n").as_bytes()))
            .map_err(|e| self.io_error(&e))
    }

    /// Read one line (at most [`MAX_LINE`] bytes plus the newline) and parse it.
    fn receive(&mut self) -> Result<Value, Error> {
        let mut line = Vec::new();
        loop {
            let left = self.remaining()?;
            self.reader
                .get_ref()
                .set_read_timeout(Some(left))
                .map_err(|e| self.io_error(&e))?;
            let buffer = match self.reader.fill_buf() {
                Ok(buffer) => buffer,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(self.io_error(&e)),
            };
            if buffer.is_empty() {
                return Err(Error::Protocol(
                    "connection closed before a complete reply".to_string(),
                ));
            }
            let (chunk, done) = match buffer.iter().position(|b| *b == b'\n') {
                Some(end) => (&buffer[..end], true),
                None => (buffer, false),
            };
            line.extend_from_slice(chunk);
            let used = chunk.len() + usize::from(done);
            self.reader.consume(used);
            if line.len() > MAX_LINE + 1 {
                return Err(Error::Protocol(format!(
                    "reply line longer than {MAX_LINE} bytes"
                )));
            }
            if done {
                break;
            }
        }
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        if line.len() > MAX_LINE {
            return Err(Error::Protocol(format!(
                "reply line longer than {MAX_LINE} bytes"
            )));
        }
        let text = String::from_utf8(line)
            .map_err(|_| Error::Protocol("reply is not valid UTF-8".to_string()))?;
        json::parse(&text).map_err(|e| Error::Protocol(format!("reply is not valid JSON: {e}")))
    }
}

/// Send the auth that carries the full-control code, and only then show the user the code
/// (review of #177): a process reading the terminal learns it too late to race its own auth with
/// it in. A failed send shows nothing.
fn auth_then_code(
    send: impl FnOnce() -> Result<(), Error>,
    say: impl FnOnce(),
) -> Result<(), Error> {
    send()?;
    say();
    Ok(())
}

/// 32 bytes from the OS CSPRNG as 64 lowercase hex chars.
fn random_nonce() -> io::Result<String> {
    use std::io::Read;
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(crate::hmac::hex(&bytes))
}

/// Four characters of 2-9 and A-Z without I and O: 20 bits, enough to tell this vimma-ctl's
/// question from one another client raced in, and easy to compare by eye.
fn random_code() -> io::Result<String> {
    use std::io::Read;
    const ALPHABET: &[u8; 32] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let mut bytes = [0u8; 4];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes
        .iter()
        .map(|b| char::from(ALPHABET[usize::from(b % 32)]))
        .collect())
}

fn protocol_error(e: protocol::DecodeError) -> Error {
    Error::Protocol(e.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(code: &str) -> ErrorBody {
        ErrorBody {
            code: code.into(),
            message: "m".into(),
            reason: None,
        }
    }

    // Review of #177 (follow-up): the code reaches the terminal only after the auth carrying it
    // was sent, so a process reading the user's terminal has no window to race its own auth
    // with the same code in; and a failed send prints no code.
    #[test]
    fn the_code_is_shown_only_after_its_auth_was_sent() {
        let events = std::cell::RefCell::new(Vec::new());
        auth_then_code(
            || {
                events.borrow_mut().push("auth");
                Ok(())
            },
            || events.borrow_mut().push("code"),
        )
        .unwrap();
        assert_eq!(*events.borrow(), ["auth", "code"]);

        let shown = std::cell::Cell::new(false);
        let failed = auth_then_code(|| Err(Error::Protocol("closed".into())), || shown.set(true));
        assert!(failed.is_err());
        assert!(!shown.get(), "no code without its auth");
    }

    #[test]
    fn exit_codes() {
        assert_eq!(Error::Server(body("failed")).exit_code(), 1);
        assert_eq!(Error::NotRunning("x".into()).exit_code(), 3);
        assert_eq!(Error::Auth(body("unauthorized")).exit_code(), 4);
        assert_eq!(Error::Protocol("x".into()).exit_code(), 5);
        assert_eq!(Error::Busy(body("busy")).exit_code(), 3);
        assert_eq!(Error::Impostor("x".into()).exit_code(), 4);
        assert_eq!(Error::Denied(body("denied")).exit_code(), 4);
    }

    #[test]
    fn busy_says_to_retry() {
        assert_eq!(
            Error::Busy(body("busy")).to_string(),
            "Vimma's control socket is busy (busy: m); try again"
        );
    }

    #[test]
    fn a_huge_timeout_does_not_overflow_the_deadline() {
        let port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let discovery = Discovery {
            protocol: 1,
            port,
            token: "0".repeat(64),
            pid: 1,
            roles: vec![Role::Full],
        };
        let result = Client::connect(&discovery, Duration::MAX);
        assert!(matches!(result, Err(Error::NotRunning(_))), "{result:?}");
    }

    #[test]
    fn messages_name_the_code() {
        assert_eq!(
            Error::Server(body("invalid-args")).to_string(),
            "invalid-args: m"
        );
        assert_eq!(
            Error::Auth(body("unauthorized")).to_string(),
            "authentication failed: unauthorized: m"
        );
        assert_eq!(
            Error::Protocol("bad".into()).to_string(),
            "protocol error: bad"
        );
        assert_eq!(Error::NotRunning("gone".into()).to_string(), "gone");
    }
}
