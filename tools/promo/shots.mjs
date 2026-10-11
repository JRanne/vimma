// The promo video's shots (tools/promo/record.mjs): what each clip shows and the keys that do
// it. `setup` runs before the recording starts; `run` is what the camera sees. Every step
// waits on Vimma's state through vimma-ctl; the only sleeps are `hold`, the pacing pauses
// that let a viewer follow (a multiple of --pace). `theme` is the shot's `[theme] source`:
// "file" (the default) shows the built-in palette, "omarchy" the recorder's temp theme
// directory, which starts empty, so the built-in palette shows there too until a shot sets one.
import { HOSTS } from "./promo.mjs";

const ARTICLE = `${HOSTS.handbook}modal-browsing.html`;
const ARTICLE_TITLE = "Leave the mouse in the drawer · Handbook";
const PANES = `${HOSTS.handbook}panes.html`;
const PANES_TITLE = "Panes, the tmux way · Handbook";
const NEWS = `${HOSTS.news}front.html`;
const NEWS_TITLE = "Front page · news.example";
const START_URL = "chrome://browser/content/vimma/start/start.html";
const ADDONS = "about:addons";
const ADDONS_TITLE = "Add-ons Manager";
/**
 * The hint label of "Themes" in about:addons' sidebar, on the extensions view of a profile with
 * none installed (promoPrefs opens it there): in reading order the skip link, the search box,
 * its button, the gear, Extensions, then Themes. The page is Firefox's and takes no probe
 * script, so this is checked by eye: a test recording's stills must show Themes followed.
 */
const ADDONS_THEMES_LABEL = "h";

/** @typedef {import("./record.mjs").Director} Director */
/** @typedef {{ name: string, theme?: "file" | "omarchy", setup: (d: Director) => Promise<void>,
 *   run: (d: Director) => Promise<void> }} Shot */

/** @param {any} s */
const selected = (s) => s.tabs.find((/** @type {any} */ t) => t.selected);

/** @param {string} who */
const inbox = (who) => `Inbox (${who}) · mail.example`;

/**
 * The panes in the window's split: 1 without one.
 * @param {any} s
 */
function paneCount(s) {
  /** @param {any} n @returns {number} */
  const leaves = (n) => (n.children ? n.children.reduce((a, c) => a + leaves(c), 0) : 1);
  return s.panes?.root ? leaves(s.panes.root) : 1;
}

/**
 * The split's shape (axes, nesting and sizes), to see a layout change.
 * @param {any} s
 */
function shape(s) {
  /** @param {any} n @returns {any} */
  const strip = (n) =>
    n.children ? { axis: n.axis, ratios: n.ratios, children: n.children.map(strip) } : 0;
  return JSON.stringify(s.panes?.root ? strip(s.panes.root) : null);
}

/**
 * tmux's tiled layout at four panes: two splits of two, a 2x2 grid.
 * @param {any} s
 */
function isGrid(s) {
  const root = s.panes?.root;
  return (
    root?.children?.length === 2 &&
    root.children.every((/** @type {any} */ c) => c.children?.length === 2 && c.axis !== root.axis)
  );
}

/**
 * Open `url` in a new tab, wait for `title`, then close every other tab, so the status bar
 * says `tab 1/1`.
 * @param {Director} d
 * @param {string} url
 * @param {string} title
 */
async function only(d, url, title) {
  await d.open(url);
  await d.until((s) => selected(s)?.title === title && s.mode === "normal", `"${title}" loaded`);
  while ((await d.state()).tabs.length > 1) {
    const before = (await d.state()).tabs.length;
    const first = (await d.state()).tabs[0];
    if (first.title === title) throw new Error(`a second "${title}" tab is open`);
    await d.send("ctrl+b 1");
    await d.until((s) => s.tabs[0].selected, "the first tab selected");
    await d.send("ctrl+b shift+x");
    await d.until((s) => s.tabs.length === before - 1, "a tab closed");
  }
  await d.until((s) => selected(s)?.title === title && s.mode === "normal", `back on "${title}"`);
}

/**
 * Open `url` in another tab (off camera) and wait for `title`.
 * @param {Director} d
 * @param {string} url
 * @param {string} title
 */
async function also(d, url, title) {
  await d.open(url);
  await d.until((s) => selected(s)?.title === title && s.mode === "normal", `"${title}" loaded`);
}

/** @type {Shot} j/k, link hints with two letters, / find with a match count */
const keys = {
  name: "keys",
  async setup(d) {
    const probe = await d.probeHintLabel(ARTICLE);
    d.labels.target = probe.label;
    d.points.target = { x: probe.x, y: probe.y };
    await only(d, ARTICLE, ARTICLE_TITLE);
  },
  async run(d) {
    await d.hold(1.2);
    d.mark("scroll");
    for (let i = 0; i < 3; i++) await d.key("j", 0.5);
    await d.key("k", 0.5);
    // back to the top, where the probe worked out the label
    await d.key("g g", 1.0);
    d.mark("hints");
    await d.key("f", 0);
    await d.until((s) => s.mode === "hint", "hint mode");
    await d.hold(2.0);
    const label = d.labels.target ?? "";
    for (const c of label.slice(0, -1)) await d.key(c, 1.1);
    await d.key(label.slice(-1), 0);
    await d.until(
      (s) => selected(s)?.title === PANES_TITLE && s.mode === "normal",
      "the hinted link followed",
    );
    await d.hold(1.2);
    d.mark("find");
    await d.key("/", 0);
    await d.until((s) => s.mode === "command", "the find bar");
    await d.hold(0.4);
    await d.type("pane", 0.35);
    await d.hold(1.4);
    await d.key("enter", 0);
    await d.until((s) => s.mode === "normal", "find closed");
    await d.hold(0.6);
    await d.key("n", 1.4);
  },
};

/** @type {Shot} link hints on about:addons, a page no extension may touch */
const addons = {
  name: "addons",
  async setup(d) {
    // no dry run of the label: about:addons opens on the view it last showed, and on Themes the
    // same label is the Light/Dark switch, which would change the browser's colour scheme
    await only(d, ADDONS, ADDONS_TITLE);
  },
  async run(d) {
    await d.hold(1.4);
    d.mark("hints");
    await d.key("f", 0);
    await d.until((s) => s.mode === "hint", "hint mode");
    await d.hold(2.2);
    await d.key(ADDONS_THEMES_LABEL, 0);
    await d.until(
      (s) => s.mode === "normal" && selected(s)?.url === ADDONS,
      "Themes followed on about:addons",
    );
    await d.hold(2.4);
  },
};

/** @type {Shot} ctrl+b enter three times: a dwindle spiral; ctrl+b space through the presets */
const tiling = {
  name: "tiling",
  async setup(d) {
    await only(d, ARTICLE, ARTICLE_TITLE);
  },
  async run(d) {
    await d.hold(1.2);
    d.mark("split");
    for (let n = 2; n <= 4; n++) {
      await d.prefix("enter");
      await d.until(
        (s) => paneCount(s) === n && selected(s)?.url === START_URL,
        `${n} panes, the new one on the start page`,
      );
      await d.hold(0.8);
    }
    await d.hold(0.3);
    d.mark("layouts");
    // even-horizontal, even-vertical, main-vertical, main-horizontal, tiled
    for (let i = 0; i < 5; i++) {
      const before = shape(await d.state());
      await d.prefix("space");
      await d.until((s) => shape(s) !== before, "the next layout preset");
      await d.hold(i === 4 ? 0 : 0.9);
    }
    await d.until(isGrid, "the tiled preset: a 2x2 grid");
    await d.hold(2.0);
  },
};

/** @type {Shot} the side panel: space marks three tabs, Enter shows them together as panes */
const marks = {
  name: "marks",
  async setup(d) {
    await only(d, ARTICLE, ARTICLE_TITLE);
    await also(d, `${HOSTS.mail}signin.html#personal`, inbox("personal"));
    await also(d, NEWS, NEWS_TITLE);
    await also(d, PANES, PANES_TITLE);
    await d.send("ctrl+b 1");
    await d.until((s) => s.tabs[0].selected && s.mode === "normal", "the first tab selected");
  },
  async run(d) {
    await d.hold(1.2);
    await d.prefix("b");
    await d.until((s) => s.mode === "panel", "the side panel");
    await d.hold(1.2);
    d.mark("mark");
    // marks the article, skips the inbox, marks the news and the panes page
    await d.key("space", 0.8);
    await d.key("j", 0.8);
    await d.key("space", 0.8);
    await d.key("space", 1.2);
    d.mark("together");
    await d.key("enter", 0);
    await d.until((s) => paneCount(s) === 3 && s.mode === "normal", "three panes");
    await d.hold(2.6);
  },
};

/** @type {Shot} ctrl+^ flips between two workspaces, signed in differently in each */
const flip = {
  name: "flip",
  async setup(d) {
    await only(d, `${HOSTS.mail}signin.html#personal`, inbox("personal"));
    await d.send("ctrl+b shift+n");
    await d.until((s) => s.mode === "command", "the new-workspace prompt");
    await d.send("w o r k enter");
    await d.until((s) => s.workspace === "work", "the work workspace");
    await only(d, `${HOSTS.mail}signin.html#work`, inbox("work"));
    // back in main, so work is the workspace ctrl+^ goes back to
    await d.send("ctrl+b (");
    await d.until(
      (s) => s.workspace === "main" && selected(s)?.title === inbox("personal"),
      "back in main",
    );
  },
  async run(d) {
    await d.hold(1.6);
    for (const [ws, who] of [
      ["work", "work"],
      ["main", "personal"],
      ["work", "work"],
    ]) {
      await d.key("ctrl+^", 0);
      await d.until(
        (s) => s.workspace === ws && selected(s)?.title === inbox(who),
        `the ${who} inbox`,
      );
      await d.hold(1.8);
    }
  },
};

/** @type {Shot} the built-in palette, an Omarchy theme set live, and back */
const theme = {
  name: "theme",
  theme: "omarchy",
  async setup(d) {
    await only(d, ARTICLE, ARTICLE_TITLE);
    await d.send("ctrl+b v");
    await d.until(
      (s) => s.panes?.root?.children?.length === 2 && selected(s)?.url === START_URL,
      "a split with the start page on the right",
    );
    // the new pane's address bar has focus: Esc twice puts it back in the page (normal mode)
    await d.send("esc");
    await d.send("esc");
    await d.until((s) => s.mode === "normal", "focus back in the start page");
  },
  async run(d) {
    await d.hold(2.0);
    await d.theme("rose-pine");
    await d.hold(2.8);
    await d.builtinTheme();
    await d.hold(2.4);
  },
};

/** @type {Shot} the ctrl+b ? overlay, filtered */
const help = {
  name: "help",
  async setup(d) {
    await only(d, ARTICLE, ARTICLE_TITLE);
  },
  async run(d) {
    await d.hold(1.0);
    await d.prefix("?");
    await d.until((s) => s.mode === "help", "the bindings overlay");
    await d.hold(1.2);
    await d.key("/", 0.5);
    await d.type("pane", 0.35);
    await d.hold(2.2);
  },
};

/** @type {readonly Shot[]} in storyboard order */
export const SHOTS = Object.freeze([keys, addons, tiling, marks, flip, theme, help]);
