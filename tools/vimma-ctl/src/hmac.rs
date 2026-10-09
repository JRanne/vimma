/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! SHA-256 (FIPS 180-4) and HMAC-SHA256 (RFC 2104), std only (ADR-011), for the handshake's
//! proof: the server answers the client's nonce with `HMAC-SHA256(token, nonce)`, so a process
//! squatting on a stale discovery file's port, which does not know the token, is refused before
//! any command is sent. Tested against the FIPS 180-4 and RFC 4231 vectors.

const K: [u32; 64] = [
    0x428a_2f98,
    0x7137_4491,
    0xb5c0_fbcf,
    0xe9b5_dba5,
    0x3956_c25b,
    0x59f1_11f1,
    0x923f_82a4,
    0xab1c_5ed5,
    0xd807_aa98,
    0x1283_5b01,
    0x2431_85be,
    0x550c_7dc3,
    0x72be_5d74,
    0x80de_b1fe,
    0x9bdc_06a7,
    0xc19b_f174,
    0xe49b_69c1,
    0xefbe_4786,
    0x0fc1_9dc6,
    0x240c_a1cc,
    0x2de9_2c6f,
    0x4a74_84aa,
    0x5cb0_a9dc,
    0x76f9_88da,
    0x983e_5152,
    0xa831_c66d,
    0xb003_27c8,
    0xbf59_7fc7,
    0xc6e0_0bf3,
    0xd5a7_9147,
    0x06ca_6351,
    0x1429_2967,
    0x27b7_0a85,
    0x2e1b_2138,
    0x4d2c_6dfc,
    0x5338_0d13,
    0x650a_7354,
    0x766a_0abb,
    0x81c2_c92e,
    0x9272_2c85,
    0xa2bf_e8a1,
    0xa81a_664b,
    0xc24b_8b70,
    0xc76c_51a3,
    0xd192_e819,
    0xd699_0624,
    0xf40e_3585,
    0x106a_a070,
    0x19a4_c116,
    0x1e37_6c08,
    0x2748_774c,
    0x34b0_bcb5,
    0x391c_0cb3,
    0x4ed8_aa4a,
    0x5b9c_ca4f,
    0x682e_6ff3,
    0x748f_82ee,
    0x78a5_636f,
    0x84c8_7814,
    0x8cc7_0208,
    0x90be_fffa,
    0xa450_6ceb,
    0xbef9_a3f7,
    0xc671_78f2,
];

const H0: [u32; 8] = [
    0x6a09_e667,
    0xbb67_ae85,
    0x3c6e_f372,
    0xa54f_f53a,
    0x510e_527f,
    0x9b05_688c,
    0x1f83_d9ab,
    0x5be0_cd19,
];

const BLOCK: usize = 64;

fn compress(state: &mut [u32; 8], block: &[u8]) {
    let mut schedule = [0u32; 64];
    for (slot, word) in schedule.iter_mut().zip(block.chunks_exact(4)) {
        *slot = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
    }
    for i in 16..64 {
        let (w15, w2) = (schedule[i - 15], schedule[i - 2]);
        let s0 = w15.rotate_right(7) ^ w15.rotate_right(18) ^ (w15 >> 3);
        let s1 = w2.rotate_right(17) ^ w2.rotate_right(19) ^ (w2 >> 10);
        schedule[i] = schedule[i - 16]
            .wrapping_add(s0)
            .wrapping_add(schedule[i - 7])
            .wrapping_add(s1);
    }
    // vars = [a, b, c, d, e, f, g, h] of FIPS 180-4 §6.2.2.
    let mut vars = *state;
    for (round, word) in K.iter().zip(schedule) {
        let e = vars[4];
        let big_s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
        let choose = (e & vars[5]) ^ (!e & vars[6]);
        let t1 = vars[7]
            .wrapping_add(big_s1)
            .wrapping_add(choose)
            .wrapping_add(*round)
            .wrapping_add(word);
        let a = vars[0];
        let big_s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
        let majority = (a & vars[1]) ^ (a & vars[2]) ^ (vars[1] & vars[2]);
        // h = g, g = f, f = e, e = d + t1, d = c, c = b, b = a, a = t1 + t2
        vars.rotate_right(1);
        vars[4] = vars[4].wrapping_add(t1);
        vars[0] = t1.wrapping_add(big_s0.wrapping_add(majority));
    }
    for (s, v) in state.iter_mut().zip(vars) {
        *s = s.wrapping_add(v);
    }
}

/// SHA-256 of `data`.
#[must_use]
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut state = H0;
    let mut blocks = data.chunks_exact(BLOCK);
    for block in &mut blocks {
        compress(&mut state, block);
    }
    // The tail, 0x80, zeros, then the length in bits (big endian) fill one or two blocks.
    let tail = blocks.remainder();
    let mut last = [0u8; 2 * BLOCK];
    last[..tail.len()].copy_from_slice(tail);
    last[tail.len()] = 0x80;
    let end = if tail.len() < BLOCK - 8 {
        BLOCK
    } else {
        2 * BLOCK
    };
    let bits = (data.len() as u64).wrapping_mul(8);
    last[end - 8..end].copy_from_slice(&bits.to_be_bytes());
    for block in last[..end].chunks_exact(BLOCK) {
        compress(&mut state, block);
    }
    let mut out = [0u8; 32];
    for (chunk, word) in out.chunks_exact_mut(4).zip(state) {
        chunk.copy_from_slice(&word.to_be_bytes());
    }
    out
}

/// HMAC-SHA256 of `message` under `key`.
#[must_use]
pub fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut block = [0u8; BLOCK];
    if key.len() > BLOCK {
        block[..32].copy_from_slice(&sha256(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner = Vec::with_capacity(BLOCK + message.len());
    inner.extend(block.iter().map(|b| b ^ 0x36));
    inner.extend_from_slice(message);
    let mut outer = Vec::with_capacity(BLOCK + 32);
    outer.extend(block.iter().map(|b| b ^ 0x5c));
    outer.extend_from_slice(&sha256(&inner));
    sha256(&outer)
}

/// Lowercase hex.
#[must_use]
pub fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::new(), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

/// Compare in time that depends only on the lengths.
#[must_use]
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |diff, (x, y)| diff | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_fips_180_vectors() {
        assert_eq!(
            hex(&sha256(b"")),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            hex(&sha256(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            hex(&sha256(
                b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
            )),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
        assert_eq!(
            hex(&sha256(&vec![b'a'; 1_000_000])),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
        // Padding edges: 55, 56 and 64 bytes (Python's hashlib).
        assert_eq!(
            hex(&sha256(&[b'x'; 55])),
            "d5e285683cd4efc02d021a5c62014694958901005d6f71e89e0989fac77e4072"
        );
        assert_eq!(
            hex(&sha256(&[b'x'; 56])),
            "04c26261370ee7541549d16dee320c723e3fd14671e66a099afe0a377c16888e"
        );
        assert_eq!(
            hex(&sha256(&[b'x'; 64])),
            "7ce100971f64e7001e8fe5a51973ecdfe1ced42befe7ee8d5fd6219506b5393c"
        );
    }

    #[test]
    fn hmac_rfc_4231_vectors() {
        // Test case 1
        assert_eq!(
            hex(&hmac_sha256(&[0x0b; 20], b"Hi There")),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
        // Test case 2
        assert_eq!(
            hex(&hmac_sha256(b"Jefe", b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        // Test case 3
        assert_eq!(
            hex(&hmac_sha256(&[0xaa; 20], &[0xdd; 50])),
            "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe"
        );
        // Test case 6: a key longer than the block is hashed first.
        assert_eq!(
            hex(&hmac_sha256(
                &[0xaa; 131],
                b"Test Using Larger Than Block-Size Key - Hash Key First"
            )),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
        // Test case 7
        assert_eq!(
            hex(&hmac_sha256(
                &[0xaa; 131],
                b"This is a test using a larger than block-size key and a larger than \
block-size data. The key needs to be hashed before being used by the HMAC algorithm."
            )),
            "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2"
        );
    }

    #[test]
    fn constant_time_eq_compares_whole_slices() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
        assert!(constant_time_eq(b"", b""));
    }
}
