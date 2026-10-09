import { describe, expect, it } from "vitest";
import { describeOutcome, redactReport } from "../src/report.mjs";

describe("redactReport", () => {
  const home = "/home/alice";

  it("turns paths under $HOME into ~", () => {
    expect(redactReport("config: /home/alice/.config/vimma/config.toml:4: x", home)).toBe(
      "config: ~/.config/vimma/config.toml:4: x",
    );
    expect(redactReport("home is /home/alice", home)).toBe("home is ~");
  });

  it("leaves other paths and look-alike prefixes alone", () => {
    expect(redactReport("/home/alicebob/x and /etc/vimma", home)).toBe(
      "/home/alicebob/x and /etc/vimma",
    );
  });

  it("drops URLs, whatever the scheme", () => {
    expect(redactReport("at https://example.com/secret?q=1 and file:///tmp/x.", home)).toBe(
      "at <url> and <url>.",
    );
    expect(redactReport("moz-extension://abc/page", home)).toBe("<url>");
  });

  it("keeps about: pages and plain words", () => {
    expect(redactReport("about:vimma report, mode: normal", home)).toBe(
      "about:vimma report, mode: normal",
    );
  });

  it("does nothing special without a home", () => {
    expect(redactReport("/home/alice/x", "")).toBe("/home/alice/x");
  });
});

describe("describeOutcome", () => {
  it("names the action, or pass, cancel, pending", () => {
    expect(describeOutcome({ kind: "action", action: { id: "scroll.down" } })).toBe("scroll.down");
    expect(describeOutcome({ kind: "pass" })).toBe("pass");
    expect(describeOutcome({ kind: "cancel" })).toBe("cancel");
    expect(describeOutcome({ kind: "pending" })).toBe("…");
  });
});
