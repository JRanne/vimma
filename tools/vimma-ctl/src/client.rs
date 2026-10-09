/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! A blocking control-socket connection: connect, handshake, one request at a time, all under
//! one deadline.

use crate::json::{self, Value};
use crate::protocol::{
    self, Command, CommandResult, Discovery, ErrorBody, MAX_LINE, PROTOCOL, Response,
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
}

/// Longest allowed timeout; [`Client::connect`] clamps to it so the deadline cannot overflow.
pub const MAX_TIMEOUT: Duration = Duration::from_secs(3600);

impl Error {
    #[must_use]
    pub fn exit_code(&self) -> i32 {
        match self {
            Error::Server(_) => 1,
            Error::NotRunning(_) | Error::Busy(_) => 3,
            Error::Auth(_) => 4,
            Error::Protocol(_) => 5,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Server(e) => write!(f, "{}: {}", e.code, e.message),
            Error::NotRunning(message) => f.write_str(message),
            Error::Auth(e) => write!(f, "authentication failed: {}: {}", e.code, e.message),
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
        client.send(&protocol::hello(&discovery.token))?;
        let reply = client.receive()?;
        if reply.get("type") == Some(&Value::String("response".into())) {
            return match protocol::decode_response(&reply).map_err(protocol_error)? {
                Response::Err { error, .. } if error.code == "busy" => Err(Error::Busy(error)),
                Response::Err { error, .. } => Err(Error::Auth(error)),
                Response::Ok { .. } => Err(Error::Protocol(
                    "expected welcome, got a result".to_string(),
                )),
            };
        }
        let welcome = protocol::decode_welcome(&reply).map_err(protocol_error)?;
        if welcome.protocol != PROTOCOL {
            return Err(Error::Protocol(format!(
                "server speaks protocol {}, this vimma-ctl speaks {PROTOCOL}",
                welcome.protocol
            )));
        }
        Ok(client)
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
        }
    }

    #[test]
    fn exit_codes() {
        assert_eq!(Error::Server(body("failed")).exit_code(), 1);
        assert_eq!(Error::NotRunning("x".into()).exit_code(), 3);
        assert_eq!(Error::Auth(body("unauthorized")).exit_code(), 4);
        assert_eq!(Error::Protocol("x".into()).exit_code(), 5);
        assert_eq!(Error::Busy(body("busy")).exit_code(), 3);
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
