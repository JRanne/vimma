import { describe, expect, it } from "vitest";
import { KeyTrack, cssWindow, parseGeometry, parseProbeTitle, promoPrefs } from "../promo.mjs";

describe("parseGeometry", () => {
  it("reads WIDTHxHEIGHT", () => {
    expect(parseGeometry("1920x1080")).toEqual({ width: 1920, height: 1080 });
    expect(parseGeometry("1080x1920")).toEqual({ width: 1080, height: 1920 });
  });
  it("refuses anything else, and odd sizes H.264 cannot encode", () => {
    expect(() => parseGeometry("1920")).toThrow(/WIDTHxHEIGHT/);
    expect(() => parseGeometry("1921x1080")).toThrow(/even/);
  });
});

describe("cssWindow", () => {
  it("divides the screen by the scale", () => {
    expect(cssWindow({ width: 1920, height: 1080 }, 1.5)).toEqual({ width: 1280, height: 720 });
  });
  it("refuses a scale outside 1..3", () => {
    expect(() => cssWindow({ width: 1920, height: 1080 }, 0.5)).toThrow(/scale/);
  });
});

describe("promoPrefs", () => {
  it("proxies the fixture hosts, reads the theme from the given directory, never ~", () => {
    const prefs = promoPrefs({ port: 4321, themeDir: "/tmp/t", scale: 1.5 });
    expect(prefs["network.proxy.http_port"]).toBe(4321);
    expect(prefs["vimma.theme.omarchyPath"]).toBe("/tmp/t");
    expect(prefs["vimma.theme.source"]).toBe("omarchy");
    expect(prefs["vimma.theme.omarchyHook"]).toBe(false);
    expect(prefs["layout.css.devPixelsPerPx"]).toBe("1.5");
  });
});

describe("parseProbeTitle", () => {
  it("is null until the page reports", () => {
    expect(parseProbeTitle("Leave the mouse in the drawer")).toBeNull();
  });
  it("reads the label and the link's centre on the screen", () => {
    expect(parseProbeTitle("probe:ls@812,904")).toEqual({ label: "ls", x: 812, y: 904 });
  });
  it("throws the page's reason when it cannot label its target", () => {
    expect(() => parseProbeTitle("probe-error:2 link(s) cross the viewport's edge")).toThrow(
      /edge/,
    );
  });
  it("refuses anything that is not a label and a point", () => {
    expect(() => parseProbeTitle("probe:{}")).toThrow(/not a probe report/);
    expect(() => parseProbeTitle("probe:ls")).toThrow(/not a probe report/);
  });
});

describe("KeyTrack", () => {
  it("times keys and marks from the clip's first frame", () => {
    const track = new KeyTrack();
    track.mark("hints", 10_400);
    track.key("f", 10_500);
    track.key("l h", 11_250);
    expect(track.resolve(10_000)).toEqual({
      keys: [
        { t: 0.5, keys: "f" },
        { t: 1.25, keys: "l h" },
      ],
      marks: [{ t: 0.4, name: "hints" }],
    });
  });
  it("clamps an event from before the first frame to 0", () => {
    const track = new KeyTrack();
    track.key("j", 900);
    expect(track.resolve(1000).keys).toEqual([{ t: 0, keys: "j" }]);
  });
});
