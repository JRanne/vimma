// The promo recorder's pure parts (tools/promo/record.mjs): the profile's prefs, the window
// geometry, the probe page's report of a hint label, and the key-overlay track. No I/O
// here, so test/promo.test.mjs covers it without a browser.
/** The fixture sites' host names; the fixture server answers them all as an HTTP proxy. */
export const HOSTS = Object.freeze({
  handbook: "http://handbook.example/",
  news: "http://news.example/",
  mail: "http://mail.example/",
});

/**
 * @param {string} text e.g. "1920x1080"
 * @returns {{ width: number, height: number }}
 */
export function parseGeometry(text) {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(text);
  if (!m)
    throw new Error(`geometry must be WIDTHxHEIGHT, e.g. 1920x1080, got ${JSON.stringify(text)}`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (width % 2 || height % 2) throw new Error(`geometry must be even for H.264, got ${text}`);
  return { width, height };
}

/**
 * The browser window in CSS pixels: the screen divided by the device-pixel scale, so the window
 * fills the Xvfb screen exactly.
 * @param {{ width: number, height: number }} screen
 * @param {number} scale
 */
export function cssWindow(screen, scale) {
  if (!(scale >= 1 && scale <= 3)) throw new Error(`scale must be from 1 to 3, got ${scale}`);
  return { width: Math.round(screen.width / scale), height: Math.round(screen.height / scale) };
}

/**
 * Prefs over the e2e harness's throwaway profile (tools/e2e/launcher.mjs PROFILE_PREFS, which
 * already turns the control socket on): the fixture server as the HTTP proxy, so the address
 * bar shows handbook.example rather than a port; dark chrome and content; larger pixels for a
 * video; smooth scrolling; and the theme read from `themeDir` (a temp copy of a colors.toml),
 * never the user's ~/.local/state/omarchy. Theme changes are applied by `vimma-ctl
 * reload-theme`, so the 2 s poll is slowed right down to keep it from racing the recorder.
 * @param {{ port: number, themeDir: string, scale: number }} options
 * @returns {Record<string, boolean | number | string | null>}
 */
export function promoPrefs({ port, themeDir, scale }) {
  return {
    "network.proxy.type": 1,
    "network.proxy.http": "127.0.0.1",
    "network.proxy.http_port": port,
    "network.proxy.no_proxies_on": "",
    "network.proxy.allow_hijacking_localhost": true,
    "dom.security.https_first": false,
    "dom.security.https_first_schemeless": false,
    "dom.securecontext.allowlist": "handbook.example,news.example,mail.example",
    "security.insecure_connection_icon.enabled": false,
    "security.insecure_connection_text.enabled": false,
    "security.insecure_connection_text.pbmode.enabled": false,
    "ui.systemUsesDarkTheme": 1,
    "layout.css.prefers-color-scheme.content-override": 0,
    "layout.css.devPixelsPerPx": String(scale),
    "ui.prefersReducedMotion": 0,
    "general.smoothScroll": true,
    "vimma.theme.source": "omarchy",
    "vimma.theme.omarchyPath": themeDir,
    "vimma.theme.pollMs": 3_600_000,
    "vimma.theme.omarchyHook": false,
  };
}

/**
 * Read a probe page's title (fixtures/probe.js): `probe:<label>@<x>,<y>` is the hint label of
 * the page's target link and its centre on the screen, `probe-error:<why>` a page the label
 * cannot be worked out for.
 * @param {string} title
 * @returns {{ label: string, x: number, y: number } | null} null until the page has reported
 */
export function parseProbeTitle(title) {
  if (title.startsWith("probe-error:")) {
    throw new Error(
      `the probe page cannot label its target: ${title.slice("probe-error:".length)}`,
    );
  }
  if (!title.startsWith("probe:")) return null;
  const m = /^probe:([a-z]{1,3})@(\d+),(\d+)$/.exec(title);
  if (!m) throw new Error(`not a probe report: ${JSON.stringify(title.slice(0, 80))}`);
  return { label: String(m[1]), x: Number(m[2]), y: Number(m[3]) };
}

/**
 * The key-overlay track: every keystroke the recorder sends, with its time in seconds from the
 * clip's first frame, for the compositor to draw. Times are taken before the keys are sent.
 */
export class KeyTrack {
  constructor() {
    /** @type {{ t: number, keys: string }[]} */
    this.keys = [];
    /** @type {{ t: number, name: string }[]} */
    this.marks = [];
    /** @type {number | null} epoch ms of the clip's first frame */
    this.origin = null;
    /** @type {{ at: number, keys?: string, name?: string }[]} */
    this.pending = [];
  }

  /** @param {string} keys @param {number} at epoch ms */
  key(keys, at) {
    this.pending.push({ at, keys });
  }

  /** @param {string} name @param {number} at epoch ms */
  mark(name, at) {
    this.pending.push({ at, name });
  }

  /**
   * Fix the clip's origin once the first frame's time is known, and resolve every event.
   * @param {number} origin epoch ms of the first frame
   */
  resolve(origin) {
    this.origin = origin;
    for (const e of this.pending) {
      const t = Math.max(0, Math.round(e.at - origin) / 1000);
      if (e.keys !== undefined) this.keys.push({ t, keys: e.keys });
      else if (e.name !== undefined) this.marks.push({ t, name: e.name });
    }
    this.pending = [];
    return { keys: this.keys, marks: this.marks };
  }
}
