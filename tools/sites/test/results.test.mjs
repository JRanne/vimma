import { describe, expect, it } from "vitest";
import {
  CHECKS,
  completeChecks,
  exitCode,
  siteStatus,
  statusbarCheck,
  summarize,
} from "../results.mjs";

/** @param {string} id @param {import("../results.mjs").CheckStatus} status @param {string} [reason] */
const c = (id, status, reason) => ({ id, status, ...(reason ? { reason } : {}) });

describe("CHECKS", () => {
  it("lists the checks in the order they run", () => {
    expect(CHECKS).toEqual([
      "load",
      "scroll",
      "find",
      "yank",
      "insert",
      "prefix",
      "shortcuts",
      "hints",
      "errors",
      "statusbar",
    ]);
  });
});

describe("completeChecks", () => {
  it("orders the checks and fills the missing ones as skipped with the reason", () => {
    const out = completeChecks([c("find", "pass"), c("load", "pass")], "timed out");
    expect(out.map((x) => x.id)).toEqual(CHECKS);
    expect(out[0]).toEqual(c("load", "pass"));
    expect(out[2]).toEqual(c("find", "pass"));
    expect(out[1]).toEqual(c("scroll", "skip", "timed out"));
  });

  it("keeps the first result when a check is recorded twice", () => {
    const out = completeChecks([c("load", "fail", "a"), c("load", "pass")], "x");
    expect(out[0]).toEqual(c("load", "fail", "a"));
  });
});

describe("siteStatus", () => {
  it("ok when nothing failed; skip and info never fail a site", () => {
    expect(
      siteStatus({ checks: [c("load", "pass"), c("find", "skip", "r"), c("shortcuts", "info")] }),
    ).toBe("ok");
  });

  it("fail when any check failed", () => {
    expect(siteStatus({ checks: [c("load", "pass"), c("hints", "fail", "no labels")] })).toBe(
      "fail",
    );
  });

  it("blocked or consent when a bot check or consent wall stopped the run", () => {
    expect(siteStatus({ checks: [], block: { kind: "bot-check", reason: "Cloudflare" } })).toBe(
      "blocked",
    );
    expect(siteStatus({ checks: [], block: { kind: "consent", reason: "x" } })).toBe("consent");
  });

  it("a block still reports a failure seen before it (e.g. Vimma errors)", () => {
    expect(
      siteStatus({ checks: [c("errors", "fail")], block: { kind: "bot-check", reason: "x" } }),
    ).toBe("fail");
  });

  it("error when the harness could not drive the site", () => {
    expect(siteStatus({ checks: [c("load", "pass")], error: "vimma-ctl failed" })).toBe("error");
  });
});

describe("statusbarCheck", () => {
  it("passes when every step's state and status bar show the expected mode", () => {
    const steps = [
      { step: "load", expected: "normal", state: "normal", statusbar: "NORMAL" },
      { step: "insert", expected: "insert", state: "insert", statusbar: "INSERT" },
    ];
    expect(statusbarCheck(steps)).toEqual({
      id: "statusbar",
      status: "pass",
      details: { steps: 2 },
    });
  });

  it("fails naming the steps where state or the bar disagree", () => {
    const steps = [
      { step: "load", expected: "normal", state: "normal", statusbar: "NORMAL" },
      { step: "f", expected: "hint", state: "normal", statusbar: "NORMAL" },
      { step: "esc", expected: "normal", state: "normal", statusbar: "INSERT" },
    ];
    const out = statusbarCheck(steps);
    expect(out.status).toBe("fail");
    expect(out.reason).toBe(
      "f: expected hint, state normal, bar NORMAL; esc: expected normal, state normal, bar INSERT",
    );
  });

  it("skips with no steps", () => {
    expect(statusbarCheck([])).toEqual({ id: "statusbar", status: "skip", reason: "no steps ran" });
  });
});

describe("summarize", () => {
  it("counts sites by status and checks by status, per check too", () => {
    const sites = [
      { id: "a", status: "ok", checks: [c("load", "pass"), c("hints", "pass")] },
      { id: "b", status: "fail", checks: [c("load", "pass"), c("hints", "fail")] },
      { id: "c", status: "blocked", checks: [c("load", "skip"), c("hints", "skip")] },
      { id: "d", status: "ok", checks: [c("load", "pass"), c("shortcuts", "info")] },
    ];
    const s = summarize(/** @type {any} */ (sites));
    expect(s.sites).toEqual({ total: 4, ok: 2, fail: 1, blocked: 1, consent: 0, error: 0 });
    expect(s.checks).toEqual({ pass: 4, fail: 1, skip: 2, info: 1 });
    expect(s.byCheck.hints).toEqual({ pass: 1, fail: 1, skip: 1, info: 0 });
  });
});

describe("exitCode", () => {
  it("0 whenever a report was produced, whatever the sites did", () => {
    expect(exitCode({ sites: [{ status: "fail" }], harnessError: null })).toBe(0);
  });

  it("1 when the harness itself failed", () => {
    expect(exitCode({ sites: [], harnessError: "no build" })).toBe(1);
  });
});
