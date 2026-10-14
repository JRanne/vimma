/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! `vimma-ctl`: drive a running Vimma over its control socket.

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let env = vimma_ctl::discovery::Env::from_process();
    let code = vimma_ctl::cli::run_with_input(
        &args,
        &env,
        Box::new(std::io::stdin()),
        &mut std::io::stdout().lock(),
        &mut std::io::stderr().lock(),
    );
    std::process::exit(code);
}
