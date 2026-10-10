/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! A small, strict JSON (RFC 8259) parser and printer: enough for the control protocol's JSON
//! lines without a dependency (ADR-011). Objects keep keys sorted (`BTreeMap`), duplicate keys
//! and lone surrogates are errors, and nesting is limited so a hostile peer cannot overflow the
//! stack.

use std::collections::BTreeMap;
use std::fmt;

/// Deepest nesting of arrays and objects accepted.
pub const MAX_DEPTH: usize = 64;

/// A JSON value.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Value>),
    Object(BTreeMap<String, Value>),
}

/// Where and why parsing failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    /// Byte offset into the input.
    pub offset: usize,
    pub message: String,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} at byte {}", self.message, self.offset)
    }
}

impl std::error::Error for ParseError {}

/// Parse one JSON text (surrounding whitespace allowed).
///
/// # Errors
/// Any deviation from RFC 8259, a duplicate object key, or nesting deeper than [`MAX_DEPTH`].
pub fn parse(text: &str) -> Result<Value, ParseError> {
    let mut parser = Parser {
        text,
        pos: 0,
        depth: 0,
    };
    parser.skip_ws();
    let value = parser.value()?;
    parser.skip_ws();
    if parser.pos != text.len() {
        return Err(parser.error("trailing characters"));
    }
    Ok(value)
}

struct Parser<'a> {
    text: &'a str,
    pos: usize,
    depth: usize,
}

impl Parser<'_> {
    fn error(&self, message: &str) -> ParseError {
        ParseError {
            offset: self.pos,
            message: message.to_string(),
        }
    }

    fn peek(&self) -> Option<u8> {
        self.text.as_bytes().get(self.pos).copied()
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn eat(&mut self, byte: u8) -> bool {
        let found = self.peek() == Some(byte);
        if found {
            self.pos += 1;
        }
        found
    }

    fn literal(&mut self, word: &str, value: Value) -> Result<Value, ParseError> {
        if self.text[self.pos..].starts_with(word) {
            self.pos += word.len();
            Ok(value)
        } else {
            Err(self.error("invalid literal"))
        }
    }

    fn value(&mut self) -> Result<Value, ParseError> {
        match self.peek() {
            None => Err(self.error("unexpected end of input")),
            Some(b'n') => self.literal("null", Value::Null),
            Some(b't') => self.literal("true", Value::Bool(true)),
            Some(b'f') => self.literal("false", Value::Bool(false)),
            Some(b'"') => self.string().map(Value::String),
            Some(b'[') => self.nested(Self::array),
            Some(b'{') => self.nested(Self::object),
            Some(b'-' | b'0'..=b'9') => self.number(),
            Some(_) => Err(self.error("unexpected character")),
        }
    }

    fn nested(
        &mut self,
        inner: fn(&mut Self) -> Result<Value, ParseError>,
    ) -> Result<Value, ParseError> {
        if self.depth == MAX_DEPTH {
            return Err(self.error("nesting too deep"));
        }
        self.depth += 1;
        self.pos += 1; // the opening bracket
        let value = inner(self);
        self.depth -= 1;
        value
    }

    fn array(&mut self) -> Result<Value, ParseError> {
        let mut items = Vec::new();
        self.skip_ws();
        if self.eat(b']') {
            return Ok(Value::Array(items));
        }
        loop {
            self.skip_ws();
            items.push(self.value()?);
            self.skip_ws();
            if self.eat(b']') {
                return Ok(Value::Array(items));
            }
            if !self.eat(b',') {
                return Err(self.error("expected ',' or ']'"));
            }
        }
    }

    fn object(&mut self) -> Result<Value, ParseError> {
        let mut map = BTreeMap::new();
        self.skip_ws();
        if self.eat(b'}') {
            return Ok(Value::Object(map));
        }
        loop {
            self.skip_ws();
            if self.peek() != Some(b'"') {
                return Err(self.error("expected a string key"));
            }
            let key_at = self.pos;
            let key = self.string()?;
            self.skip_ws();
            if !self.eat(b':') {
                return Err(self.error("expected ':'"));
            }
            self.skip_ws();
            let value = self.value()?;
            if map.contains_key(&key) {
                return Err(ParseError {
                    offset: key_at,
                    message: format!("duplicate key {}", Value::String(key)),
                });
            }
            map.insert(key, value);
            self.skip_ws();
            if self.eat(b'}') {
                return Ok(Value::Object(map));
            }
            if !self.eat(b',') {
                return Err(self.error("expected ',' or '}'"));
            }
        }
    }

    fn digits(&mut self) -> usize {
        let start = self.pos;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
        self.pos - start
    }

    fn number(&mut self) -> Result<Value, ParseError> {
        let start = self.pos;
        self.eat(b'-');
        if self.eat(b'0') {
            if matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(self.error("leading zero"));
            }
        } else if self.digits() == 0 {
            return Err(self.error("expected a digit"));
        }
        if self.eat(b'.') && self.digits() == 0 {
            return Err(self.error("expected a digit after '.'"));
        }
        if self.eat(b'e') || self.eat(b'E') {
            if !self.eat(b'+') {
                self.eat(b'-');
            }
            if self.digits() == 0 {
                return Err(self.error("expected an exponent"));
            }
        }
        self.text[start..self.pos]
            .parse::<f64>()
            .ok()
            .filter(|n| n.is_finite())
            .map(Value::Number)
            .ok_or_else(|| self.error("number out of range"))
    }

    fn hex4(&mut self) -> Result<u32, ParseError> {
        let digits = self
            .text
            .get(self.pos..self.pos + 4)
            .filter(|d| d.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or_else(|| self.error("invalid \\u escape"))?;
        let code = u32::from_str_radix(digits, 16).map_err(|_| self.error("invalid \\u escape"))?;
        self.pos += 4;
        Ok(code)
    }

    fn unicode_escape(&mut self) -> Result<char, ParseError> {
        let first = self.hex4()?;
        let code = match first {
            0xD800..=0xDBFF => {
                if !(self.eat(b'\\') && self.eat(b'u')) {
                    return Err(self.error("lone surrogate"));
                }
                let second = self.hex4()?;
                if !(0xDC00..=0xDFFF).contains(&second) {
                    return Err(self.error("lone surrogate"));
                }
                0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00)
            }
            0xDC00..=0xDFFF => return Err(self.error("lone surrogate")),
            other => other,
        };
        char::from_u32(code).ok_or_else(|| self.error("invalid \\u escape"))
    }

    fn string(&mut self) -> Result<String, ParseError> {
        self.pos += 1; // the opening quote
        let mut out = String::new();
        loop {
            let run_start = self.pos;
            while let Some(b) = self.peek() {
                if b == b'"' || b == b'\\' || b < 0x20 {
                    break;
                }
                self.pos += 1;
            }
            // The run ends at an ASCII byte or the end, so it is a char boundary.
            out.push_str(&self.text[run_start..self.pos]);
            match self.peek() {
                None => return Err(self.error("unterminated string")),
                Some(b'"') => {
                    self.pos += 1;
                    return Ok(out);
                }
                Some(b'\\') => {
                    self.pos += 1;
                    let escaped = match self.peek() {
                        Some(b'"') => '"',
                        Some(b'\\') => '\\',
                        Some(b'/') => '/',
                        Some(b'b') => '\u{8}',
                        Some(b'f') => '\u{c}',
                        Some(b'n') => '\n',
                        Some(b'r') => '\r',
                        Some(b't') => '\t',
                        Some(b'u') => {
                            self.pos += 1;
                            out.push(self.unicode_escape()?);
                            continue;
                        }
                        _ => return Err(self.error("invalid escape")),
                    };
                    self.pos += 1;
                    out.push(escaped);
                }
                Some(_) => return Err(self.error("control character in string")),
            }
        }
    }
}

impl Value {
    /// The value of `key` when this is an object that has it.
    #[must_use]
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(map) => map.get(key),
            _ => None,
        }
    }

    /// The number as a `u64` when it is a non-negative integer no larger than 2^53 - 1, the
    /// range where an `f64` is exact.
    #[must_use]
    pub fn as_u64(&self) -> Option<u64> {
        const MAX_EXACT: f64 = 9_007_199_254_740_991.0;
        match self {
            // Integral and in range, so its decimal form has no point or exponent; going through
            // it avoids a lossy `as` cast.
            Value::Number(n) if n.fract() == 0.0 && (0.0..=MAX_EXACT).contains(n) => {
                // -0 is in the range but prints as "-0", which u64 does not parse.
                format!("{}", n.abs()).parse().ok()
            }
            _ => None,
        }
    }
}

impl fmt::Display for Value {
    /// Compact JSON on one line.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Null => f.write_str("null"),
            Value::Bool(b) => write!(f, "{b}"),
            // Rust prints the shortest round-tripping decimal, never an exponent: valid JSON.
            Value::Number(n) => write!(f, "{n}"),
            Value::String(s) => write_string(f, s),
            Value::Array(items) => {
                f.write_str("[")?;
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        f.write_str(",")?;
                    }
                    write!(f, "{item}")?;
                }
                f.write_str("]")
            }
            Value::Object(map) => {
                f.write_str("{")?;
                for (i, (key, value)) in map.iter().enumerate() {
                    if i > 0 {
                        f.write_str(",")?;
                    }
                    write_string(f, key)?;
                    write!(f, ":{value}")?;
                }
                f.write_str("}")
            }
        }
    }
}

fn write_string(f: &mut fmt::Formatter<'_>, s: &str) -> fmt::Result {
    f.write_str("\"")?;
    for c in s.chars() {
        match c {
            '"' => f.write_str("\\\"")?,
            '\\' => f.write_str("\\\\")?,
            '\n' => f.write_str("\\n")?,
            '\r' => f.write_str("\\r")?,
            '\t' => f.write_str("\\t")?,
            c if u32::from(c) < 0x20 => write!(f, "\\u{:04x}", u32::from(c))?,
            c => write!(f, "{c}")?,
        }
    }
    f.write_str("\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(pairs: &[(&str, Value)]) -> Value {
        Value::Object(
            pairs
                .iter()
                .map(|(k, v)| ((*k).to_string(), v.clone()))
                .collect(),
        )
    }

    #[test]
    fn parses_scalars() {
        assert_eq!(parse("null"), Ok(Value::Null));
        assert_eq!(parse(" true "), Ok(Value::Bool(true)));
        assert_eq!(parse("false"), Ok(Value::Bool(false)));
        assert_eq!(parse("0"), Ok(Value::Number(0.0)));
        assert_eq!(parse("-12.5e2"), Ok(Value::Number(-1250.0)));
        assert_eq!(parse("1E+2"), Ok(Value::Number(100.0)));
        assert_eq!(parse("\"hi\""), Ok(Value::String("hi".into())));
    }

    #[test]
    fn parses_nested_structures() {
        let value = parse(r#"{"b": [1, {"c": null}], "a": "x"}"#).unwrap();
        let expected = obj(&[
            ("a", Value::String("x".into())),
            (
                "b",
                Value::Array(vec![Value::Number(1.0), obj(&[("c", Value::Null)])]),
            ),
        ]);
        assert_eq!(value, expected);
        assert_eq!(parse("[]"), Ok(Value::Array(vec![])));
        assert_eq!(parse("{ }"), Ok(obj(&[])));
    }

    #[test]
    fn decodes_string_escapes() {
        let value = parse(r#""a\"b\\c\/d\b\f\n\r\té😀""#).unwrap();
        assert_eq!(
            value,
            Value::String("a\"b\\c/d\u{8}\u{c}\n\r\té\u{1F600}".into())
        );
        assert_eq!(parse("\"é\""), Ok(Value::String("é".into())));
    }

    #[test]
    fn rejects_invalid_json() {
        for bad in [
            "",
            "nul",
            "tru",
            "01",
            "1.",
            ".5",
            "-",
            "1e",
            "+1",
            "\"open",
            "\"tab\there\"",
            r#""\x""#,
            r#""\u12""#,
            r#""\ud800""#,
            r#""\ude00""#,
            r#""\ud800A""#,
            "[1,]",
            "[1 2]",
            "{\"a\" 1}",
            "{\"a\":1,}",
            "{1:2}",
            "{\"a\":1} x",
            "[",
            "{",
            "NaN",
            "Infinity",
        ] {
            assert!(parse(bad).is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn rejects_duplicate_keys() {
        let err = parse(r#"{"a":1,"a":2}"#).unwrap_err();
        assert_eq!(err.message, "duplicate key \"a\"");
    }

    #[test]
    fn limits_nesting_depth() {
        let ok = "[".repeat(MAX_DEPTH) + &"]".repeat(MAX_DEPTH);
        assert!(parse(&ok).is_ok());
        let deep = "[".repeat(MAX_DEPTH + 1) + &"]".repeat(MAX_DEPTH + 1);
        assert_eq!(parse(&deep).unwrap_err().message, "nesting too deep");
        let hostile = "[".repeat(1_000_000);
        assert!(parse(&hostile).is_err());
    }

    #[test]
    fn reports_the_offset() {
        let err = parse("[1, x]").unwrap_err();
        assert_eq!(err.offset, 4);
        assert_eq!(err.to_string(), format!("{} at byte 4", err.message));
    }

    #[test]
    fn prints_compact_json_with_sorted_keys() {
        let value = obj(&[
            ("z", Value::Number(1.0)),
            ("a", Value::Array(vec![Value::Bool(true), Value::Null])),
            ("m", Value::Number(-2.5)),
            ("big", Value::Number(9_007_199_254_740_991.0)),
        ]);
        assert_eq!(
            value.to_string(),
            r#"{"a":[true,null],"big":9007199254740991,"m":-2.5,"z":1}"#
        );
    }

    #[test]
    fn escapes_strings_when_printing() {
        let value = Value::String("q\"b\\n\n\u{1}é/".into());
        assert_eq!(value.to_string(), r#""q\"b\\n\n\u0001é/""#);
    }

    #[test]
    fn round_trips() {
        let text = r#"{"a":[1,2.5,-3,"x\ty",{"b":false}],"c":null,"e":1e300}"#;
        let value = parse(text).unwrap();
        assert_eq!(parse(&value.to_string()).unwrap(), value);
    }

    #[test]
    fn as_u64_accepts_exact_non_negative_integers_only() {
        let n = |text: &str| parse(text).unwrap().as_u64();
        assert_eq!(n("0"), Some(0));
        assert_eq!(n("42"), Some(42));
        assert_eq!(n("4.2e1"), Some(42));
        assert_eq!(n("9007199254740991"), Some(9_007_199_254_740_991));
        assert_eq!(n("9007199254740992"), None);
        assert_eq!(n("-1"), None);
        assert_eq!(n("1.5"), None);
        assert_eq!(n("\"1\""), None);
        // Regression (property test, seed 20261010): -0 is the integer 0, as Number.isInteger
        // says in vimma-core's validator; it read as no number at all.
        assert_eq!(n("-0"), Some(0));
        assert_eq!(n("-0.0e5"), Some(0));
    }

    #[test]
    fn get_reads_object_fields_only() {
        let value = parse(r#"{"a":1}"#).unwrap();
        assert_eq!(value.get("a"), Some(&Value::Number(1.0)));
        assert_eq!(value.get("b"), None);
        assert_eq!(Value::Null.get("a"), None);
    }
}
