// The promo video's shots (tools/promo/record.mjs): what each clip shows and the keys that do
// it. `setup` runs before the recording starts; `run` is what the camera sees. Every step
// waits on Vimma's state through vimma-ctl; the only sleeps are `hold`, the pacing pauses
// that let a viewer follow (a multiple of --pace).
import { HOSTS } from "./promo.mjs";

const ARTICLE = `${HOSTS.handbook}modal-browsing.html`;
const ARTICLE_TITLE = "Leave the mouse in the drawer · Handbook";
const PANES_TITLE = "Panes, the tmux way · Handbook";
const NEWS = `${HOSTS.news}front.html`;
const NEWS_TITLE = "Front page · news.example";
const START_URL = "chrome://browser/content/vimma/start/start.html";

/** @typedef {import("./record.mjs").Director} Director */
/** @typedef {{ name: string, setup: (d: Director) => Promise<void>,
 *   run: (d: Director) => Promise<void> }} Shot */

/** @param {any} s */
const selected = (s) => s.tabs.find((/** @type {any} */ t) => t.selected);

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

/** @type {Shot} 3: j/k, link hints with two letters, / find with a match count */
const keys = {
  name: "keys",
  async setup(d) {
    const probe = await d.probeHintLabel(ARTICLE);
    d.labels.target = probe.label;
    d.points.target = { x: probe.x, y: probe.y };
    await only(d, ARTICLE, ARTICLE_TITLE);
  },
  async run(d) {
    await d.hold(1.4);
    d.mark("scroll");
    for (let i = 0; i < 5; i++) await d.key("j", 0.55);
    await d.hold(0.4);
    for (let i = 0; i < 2; i++) await d.key("k", 0.55);
    // back to the top, where the probe worked out the label
    await d.key("g g", 1.2);
    d.mark("hints");
    await d.key("f", 0);
    await d.until((s) => s.mode === "hint", "hint mode");
    await d.hold(2.4);
    const label = d.labels.target ?? "";
    for (const c of label.slice(0, -1)) await d.key(c, 1.3);
    await d.key(label.slice(-1), 0);
    await d.until(
      (s) => selected(s)?.title === PANES_TITLE && s.mode === "normal",
      "the hinted link followed",
    );
    await d.hold(1.4);
    d.mark("find");
    await d.key("/", 0);
    await d.until((s) => s.mode === "command", "the find bar");
    await d.hold(0.5);
    await d.type("pane", 0.4);
    await d.hold(1.8);
    await d.key("enter", 0);
    await d.until((s) => s.mode === "normal", "find closed");
    await d.hold(0.8);
    await d.key("n", 1.0);
    await d.key("n", 1.6);
  },
};

/** @type {Shot} 4: ctrl+b v splits, ctrl+b h / l move focus, ctrl+b z zooms and unzooms */
const panes = {
  name: "panes",
  async setup(d) {
    await only(d, ARTICLE, ARTICLE_TITLE);
  },
  async run(d) {
    await d.hold(1.2);
    await d.prefix("v");
    await d.until(
      (s) => s.panes?.root?.children?.length === 2 && selected(s)?.url === START_URL,
      "a split with the start page on the right",
    );
    await d.hold(0.9);
    await d.open(NEWS);
    await d.until((s) => selected(s)?.title === NEWS_TITLE, "the news page in the right pane");
    await d.hold(1.0);
    await d.prefix("h");
    await d.until((s) => selected(s)?.title === ARTICLE_TITLE, "focus on the left pane");
    await d.hold(0.4);
    for (let i = 0; i < 3; i++) await d.key("j", 0.5);
    await d.hold(0.4);
    await d.prefix("l");
    await d.until((s) => selected(s)?.title === NEWS_TITLE, "focus on the right pane");
    await d.hold(0.4);
    for (let i = 0; i < 3; i++) await d.key("j", 0.5);
    await d.hold(0.5);
    await d.prefix("z");
    await d.until((s) => s.panes?.zoomed === true, "the right pane zoomed");
    await d.hold(1.8);
    await d.prefix("z");
    await d.until((s) => s.panes?.zoomed === false, "back to the split");
    await d.hold(1.6);
  },
};

/** @type {Shot} 5: ctrl+b ) / ( between workspaces, signed in differently in each */
const workspaces = {
  name: "workspaces",
  async setup(d) {
    const inbox = (/** @type {string} */ who) => `Inbox (${who}) · mail.example`;
    await only(d, `${HOSTS.mail}signin.html#personal`, inbox("personal"));
    await d.send("ctrl+b shift+n");
    await d.until((s) => s.mode === "command", "the new-workspace prompt");
    await d.send("w o r k enter");
    await d.until((s) => s.workspace === "work", "the work workspace");
    await only(d, `${HOSTS.mail}signin.html#work`, inbox("work"));
    await d.send("ctrl+b (");
    await d.until(
      (s) => s.workspace === "main" && selected(s)?.title === inbox("personal"),
      "back in main",
    );
  },
  async run(d) {
    const inbox = (/** @type {string} */ who) => `Inbox (${who}) · mail.example`;
    await d.hold(2.0);
    await d.prefix(")");
    await d.until(
      (s) => s.workspace === "work" && selected(s)?.title === inbox("work"),
      "the work inbox",
    );
    await d.hold(3.0);
    await d.prefix("(");
    await d.until(
      (s) => s.workspace === "main" && selected(s)?.title === inbox("personal"),
      "the personal inbox",
    );
    await d.hold(2.6);
    await d.prefix(")");
    await d.until((s) => s.workspace === "work", "the work inbox again");
    await d.hold(2.6);
  },
};

/** @type {Shot} 6: the Omarchy theme file changes and Vimma recolours live */
const theme = {
  name: "theme",
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
    await d.theme("gruvbox");
    await d.hold(2.8);
    await d.theme("rose-pine");
    await d.hold(2.8);
    await d.theme("tokyo-night");
    await d.hold(2.2);
  },
};

/** @type {Shot} 7: the ctrl+b ? overlay, filtered */
const help = {
  name: "help",
  async setup(d) {
    await only(d, ARTICLE, ARTICLE_TITLE);
  },
  async run(d) {
    await d.hold(1.0);
    await d.prefix("?");
    await d.until((s) => s.mode === "help", "the bindings overlay");
    await d.hold(1.6);
    await d.key("/", 0.6);
    await d.type("pane", 0.4);
    await d.hold(2.6);
  },
};

/** @type {readonly Shot[]} in storyboard order */
export const SHOTS = Object.freeze([keys, panes, workspaces, theme, help]);
