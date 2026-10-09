# Spec: m1-core-logic

Status: implemented (core), awaiting review; host wiring pending · Milestone: M1 · Area: `packages/vimma-core`

## User stories

- As a user, when I click into a search box, a textarea, a rich-text editor or a code editor,
  vimma switches to `insert` and my keys type; on a checkbox, a button or a read-only field my
  keys stay vimma's (`j` scrolls).
- As a user, `f` labels every link on screen with the shortest labels the hint characters allow,
  in reading order; typing narrows them, the last needed key follows the link, `F` opens it in a
  new tab, `Backspace` undoes a key and `Esc` leaves hint mode.
- As a user, `:` opens a command line that takes the commands of plan §2 (`:tabnew`,
  `:tabrename name`, `:q`, `:vsplit`, `:workspace name`, `:source`, …) and any action by name,
  completes them as I type, recalls earlier lines with `Up` / `Down`, and tells me what I
  probably meant when I mistype.
- As a user, `Esc` always does the one obvious thing: cancels what is pending, otherwise leaves
  the mode I am in, and in plain normal mode reaches the page (closing its dialogs, stopping a
  load).
- As the M1 host specs (content actor, hint mode, command line), I hand `vimma-core` plain data
  (an element descriptor, target rects, the command-line text, the mode) and get back decisions.
  Core touches no DOM.

## Scope

`packages/vimma-core/src/`:

| Module         | Exports                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editable.mjs` | `isEditable`, `matchSiteRule`, `TEXT_INPUT_EXCLUDED_TYPES`, `EDITABLE_ROLES`, `KNOWN_EDITORS`, `INSERT_SITE_MODES`                                                           |
| `hints.mjs`    | `DEFAULT_HINT_CHARS`, `HINT_ACTIONS`, `hintLabels`, `orderTargets`, `startHints`, `hintKey`, `visibleHints`, `HintError`                                                     |
| `cmdline.mjs`  | `COMMANDS`, `PENDING_ACTIONS`, `tokenize`, `parseCommandLine`, `completeCommandLine`, `createHistory`, `pushHistory`, `historyPrevious`, `historyNext`, `resetHistoryCursor` |
| `escape.mjs`   | `resolveEscape`                                                                                                                                                              |
| `index.mjs`    | re-exports                                                                                                                                                                   |

Everything is pure: plain data in, frozen plain data out, inputs never mutated. No module
reads the DOM, the clock or storage.

## Insert detection (`editable.mjs`)

The content actor (M1 actor spec) builds a descriptor of the focused element (the deepest
`activeElement`, through open shadow roots and into same-process frames, as Vimium's
`getActiveElement` does) on every `focusin` / `focusout`, and the host enters or leaves
`insert` from `isEditable(descriptor, { site })`.

```js
/**
 * @typedef {object} EditableDescriptor
 * @property {string} tagName              any case (XHTML is lowercase)
 * @property {string} [type]               <input type>, any case; missing or "" = "text"
 * @property {boolean} [readOnly]          the IDL property (input, textarea)
 * @property {boolean} [disabled]          element.matches(":disabled") (covers disabled fieldsets)
 * @property {boolean} [isContentEditable] the computed IDL property (inherits)
 * @property {string} [contentEditable]    the attribute, used only when isContentEditable is absent
 * @property {string | null} [role]        the role attribute (first token is used)
 * @property {boolean} [ariaReadOnly]      aria-readonly="true" on the element
 * @property {boolean} [ariaDisabled]      aria-disabled="true" on the element or an ancestor
 * @property {boolean} [designMode]        ownerDocument.designMode === "on"
 * @property {string[]} [ancestorClasses]  class tokens of the element and its ancestors
 */
/** @typedef {{ editable: boolean, reason: string }} EditableResult */
```

Rules, first match wins:

| #   | Condition                                                                                                                             | Result | `reason`             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------- |
| 1   | `site = "never"`                                                                                                                      | no     | `site:never`         |
| 2   | `site = "always"`                                                                                                                     | yes    | `site:always`        |
| 3   | `designMode`                                                                                                                          | yes    | `design-mode`        |
| 4   | `disabled`                                                                                                                            | no     | `disabled`           |
| 5   | `ariaDisabled`                                                                                                                        | no     | `aria-disabled`      |
| 6   | `readOnly`                                                                                                                            | no     | `readonly`           |
| 7   | `<input>` whose type is in `TEXT_INPUT_EXCLUDED_TYPES` (button checkbox color file hidden image radio range reset submit)             | no     | `input:<type>`       |
| 8   | any other `<input>` (text, search, email, url, tel, password, number, date, time, …, and unknown types, which browsers treat as text) | yes    | `input:<type>`       |
| 9   | `<textarea>`, `<select>`                                                                                                              | yes    | `textarea`, `select` |
| 10  | `<embed>`, `<object>`                                                                                                                 | yes    | `embed`              |
| 11  | `isContentEditable` (or, when absent, `contentEditable` ∈ `"true"`, `""`, `"plaintext-only"`)                                         | yes    | `contenteditable`    |
| 12  | an `ancestorClasses` token names a `KNOWN_EDITORS` entry                                                                              | yes    | `editor:<name>`      |
| 13  | `role` ∈ `EDITABLE_ROLES` (textbox searchbox combobox spinbutton application) and not `ariaReadOnly`                                  | yes    | `role:<role>`        |
| 14  | `role` ∈ `EDITABLE_ROLES` with `ariaReadOnly`                                                                                         | no     | `aria-readonly`      |
| 15  | otherwise                                                                                                                             | no     | `none`               |

`KNOWN_EDITORS` (class → name): `monaco-editor` → `monaco` (Monaco / VS Code web),
`cm-editor` → `codemirror6`, `CodeMirror` → `codemirror5`, `ace_editor` → `ace`,
`ProseMirror` → `prosemirror`, `ql-editor` → `quill`. Classes match whole tokens. Most of them
focus a textarea or a contenteditable and are caught earlier; the marker catches the editors'
own focusable wrappers (Monaco's and Ace's scroll containers, CodeMirror 6's
`tabindex` content element when it is not contenteditable) that otherwise read as `none`.

**Per-site override (data shape only; config wiring is the M5 follow-up).**

```js
/** @typedef {"auto" | "never" | "always"} InsertSiteMode */
/** @typedef {{ match: string, insert: InsertSiteMode }} InsertSiteRule */
```

Proposed config: `[[insert.sites]]` array of tables, `match = "docs.google.com"`,
`insert = "always"`. Not `[modal.insert] sites`: `[modal.insert]` is a keymap table and `sites`
would read as the key sequence `s i t e s`. `matchSiteRule(host, rules)` returns the rule whose
`match` equals the host or is a dot-suffix of it (`example.com` matches `www.example.com`, not
`badexample.com`), the longest such match winning, the earlier rule on a tie; case-insensitive;
a trailing dot on the host is ignored. `auto` = the heuristic; `never` = keys stay vimma's
(sites that grab focus with fake inputs); `always` = everything focused is editable (canvas
editors, web terminals).

## Hints (`hints.mjs`)

- `DEFAULT_HINT_CHARS = "asdfghjkl"`: the home row, without `;` (Nordic and German layouts put
  other letters there).
- `hintLabels(n, chars = DEFAULT_HINT_CHARS)` → `string[]` of length `n`. With `k` characters:
  `n ≤ k` gives the first `n` characters. Otherwise `L = ⌈log_k n⌉`, the `b = k^(L-1)` strings of
  length `L - 1` in charset order are the base, and the last
  `s = ⌈(n − b) / (k − 1)⌉` of them are extended by every character, which is the fewest
  extensions that give `n` labels (each extension loses one label and gains `k`; Tridactyl's
  `hintnames_short` reasons the same way). Labels: the unextended base in order, then the
  extensions in order, cut at `n`. So the shortest labels go to the first targets and are made
  of the first (most comfortable) characters.
- Charset: ≥ 2 distinct single characters, none of them whitespace or uppercase →
  else `HintError("bad-charset")`. `n` a non-negative integer, else `HintError("bad-count")`.
- `orderTargets(targets)`: targets are `{ rect: { x, y, width, height }, … }` (any extra fields
  pass through). Sorted by `(y, x, height, width)`, then swept into rows: a target joins the
  current row while its `y` is above the row's first target's vertical centre; rows are read
  top to bottom, each left to right. Inline links on one line with different heights stay one
  row; a target lower than half a line starts a new one. Ties keep a total order, so the result
  depends only on the rects, not on the input order.
- `HINT_ACTIONS = ["hint.follow", "hint.follow_new_tab"]` (`f`, `F`; plan §2 lists only these).
  Yank-link and focus-input hints are out of scope.
- `startHints(targets, { action, chars })` → `HintState = { action, chars, typed: "", hints:
[{ label, target }] }` with targets in `orderTargets` order. Zero targets →
  `HintError("no-targets")` (the host says "no links" and stays in normal). A single target is
  still labelled (no surprise follow on `f`).
- `hintKey(state, chord)` → `{ state, result }`:

  | Key                                           | `result`                                                         | state                 |
  | --------------------------------------------- | ---------------------------------------------------------------- | --------------------- |
  | `Esc` (no modifiers)                          | `{ kind: "cancel" }`                                             | unchanged             |
  | `Backspace` with keys typed                   | `{ kind: "narrow", visible }`                                    | last key removed      |
  | `Backspace` with nothing typed                | `{ kind: "ignored" }`                                            | unchanged             |
  | a label character (shift / caps lock ignored) | narrows to one hint: `{ kind: "select", action, target, label }` | `typed` extended      |
  |                                               | narrows to several: `{ kind: "narrow", visible }`                | `typed` extended      |
  |                                               | matches no label: `{ kind: "ignored" }`                          | unchanged (typo-safe) |
  | anything else, or with ctrl / alt / meta      | `{ kind: "ignored" }`                                            | unchanged             |

  Labels are prefix-free, so narrowing to one hint is the exact match: the hint is followed
  without `Enter`, as in Vimium.

- `visibleHints(state)` → the hints whose label starts with `typed`, in order.
- Flow for the hint host spec: the dispatcher sees keys first (so `ctrl+b` works in every mode
  and the `[modal.hint]` `<Esc>` binding stays authoritative); a `pass` in `hint` mode goes to
  `hintKey`.

## Command line (`cmdline.mjs`)

**Grammar.** An optional leading `:`, whitespace, a command word, then arguments. `tokenize`
splits arguments on whitespace; `"…"` groups with `\"` and `\\` escapes, `'…'` groups literally;
an unclosed quote is an `unterminated-quote` error at its column. A command that takes text
gets the arguments joined with one space (`:tabrename "a  b"` keeps both spaces).

**Commands** (plan §2, Neovim column):

| Command             | Aliases | Argument | Action                                                                     |
| ------------------- | ------- | -------- | -------------------------------------------------------------------------- |
| `:open url`         |         | required | `page.open` (missing, see below)                                           |
| `:tabnew [url]`     |         | optional | `tab.new` (+ `text`)                                                       |
| `:tabrename [name]` |         | optional | `tab.rename` (+ `text`; without it, the rename prompt as `prefix+shift+t`) |
| `:q`                | `quit`  | none     | `pane.close` (the last pane's close closes the tab, as in Vim)             |
| `:vsplit`           | `vs`    | none     | `pane.split_vertical`                                                      |
| `:split`            | `sp`    | none     | `pane.split_horizontal`                                                    |
| `:wsnext`           |         | none     | `workspace.next`                                                           |
| `:wsprev`           |         | none     | `workspace.previous`                                                       |
| `:workspace [name]` |         | optional | without: `workspace.picker`; with: `workspace.switch` (missing)            |
| `:ls`               |         | none     | `goto.picker`                                                              |
| `:sidebar`          |         | none     | `sidebar.toggle`                                                           |
| `:map`              |         | none     | `help.show` (`:map j k` is an error: bindings live in `config.toml`)       |
| `:source`           |         | none     | `config.reload`                                                            |

Any action works as a command too, by config name or unambiguous dotted id (`:scroll_down`,
`:tab.next`, `:select_tab_3` → `{ id: "tab.goto", arg: 3 }`); they take no arguments. Lookup
order: command name or alias, action, then a unique prefix of a command name (`:tabr`,
`:wsn`), as Vim abbreviates. `:3tabnext`-style counts, ranges and `!` are out of scope.

```js
/** @typedef {{ code: string, message: string, suggestions: readonly string[], column?: number }} CommandError */
/**
 * @typedef {{ kind: "run", command: string, action: Action, text?: string }
 *   | { kind: "empty" }
 *   | { kind: "error", error: CommandError }} CommandResult
 */
```

`parseCommandLine(text)` → `CommandResult`. Error codes: `unknown-command` (suggestions: up to
3 names starting with the word, else the closest by edit distance via `closest`),
`ambiguous-command` (suggestions: the candidates), `missing-argument`, `unexpected-argument`,
`unterminated-quote`. An empty line is `empty` (Vim does nothing).

**Completion.** `completeCommandLine(text, { limit = 20 })` → `{ word, candidates: [{ value,
kind: "command" | "action", description }] }` for the command word (the cursor is assumed at
the end; once the line has a space after the word there is nothing to complete, `[]`; argument
completion needs host data and is out of scope). Candidates: command names and aliases, then
action config names. An exact match first, then prefix matches (commands before actions, in
table order), then subsequence ("fuzzy") matches ranked by the span they cover, then position.
Case-insensitive. Action names only, not dotted ids or aliases, to keep the list short.

**History.** `createHistory({ limit = 100 })` → `{ entries, limit, index: null, draft: "" }`.
`pushHistory(h, line)` trims; empty lines are not stored; a line already present moves to the
newest place (Vim keeps one copy); beyond `limit` the oldest goes. `historyPrevious(h, current)`
→ `{ history, text }`: the first `Up` saves `current` as the draft, and like Vim only entries
starting with the draft are recalled, newest first; at the oldest match it stays (no wrap).
`historyNext` walks back; past the newest it returns the draft and clears the cursor.
`resetHistoryCursor(h)` after `Enter` / `Esc`.

### Missing actions (for the host spec; the dispatcher contract is unchanged)

- `page.open` (`:open url`) and `workspace.switch` (`:workspace name`) are not in
  `actions.mjs`. `PENDING_ACTIONS` lists them and a test pins the list, so adding them to
  `actions.mjs` (with `npm run gen-docs`) is a deliberate change in the host spec.
- Free-text arguments (`:open url`, `:tabnew url`, `:tabrename name`, `:workspace name`) ride
  on `CommandResult.text`, not on `Action`: the dispatcher's `Action = { id, count?, arg? }`
  (numeric `arg`) is untouched. The host spec decides whether `Action` grows a `text`.
- `:bug` (plan §4, M6) and `:set` (not in plan) are not commands yet.

## Esc (`escape.mjs`)

`resolveEscape({ mode, pending = false, previous = "normal" })`, plan §2:

| State                                             | Result                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| a prefix, sequence or count is pending (any mode) | `{ kind: "cancel", mode }`: pending cleared, mode unchanged                     |
| `insert`                                          | `{ kind: "action", action: { id: "mode.normal" }, mode: "normal", blur: true }` |
| `visual`                                          | `mode.normal`, `mode: "normal"`, `collapseSelection: true`                      |
| `command`                                         | `command.cancel`, `mode: "normal"`                                              |
| `hint`                                            | `hint.cancel`, `mode: "normal"`                                                 |
| `help`                                            | `help.close`, `mode: previous` (the overlay returns where it was opened)        |
| `panel`                                           | `panel.close`, `mode: previous`                                                 |
| `normal`, nothing pending                         | `{ kind: "pass" }`: the page gets `Esc`                                         |

Pending wins: `ctrl+b` in `insert` then `Esc` cancels the prefix and stays in `insert`. `blur`
tells the actor to blur the editable element, otherwise the next focus report would put the
user straight back in `insert` (Vimium and Tridactyl both blur). A test pins every action to
the default keymap's `<Esc>` binding for that mode, so this table and `defaults.mjs` cannot
drift. A user who rebinds `<Esc>` in a mode gets the dispatcher's answer first.

## Tests (write first)

`editable.test.mjs`, `hints.test.mjs`, `cmdline.test.mjs`, `escape.test.mjs`; table-driven with
`test.each`, properties with fast-check.

Insert detection:

- Given `<input>` with type missing, `text`, `SEARCH`, `email`, `password`, `number`, `date`,
  `datetime-local`, `tel`, `url`, `foo`, then editable with `input:<type>`.
- Given `<input type>` `checkbox`, `radio`, `submit`, `button`, `file`, `range`, `color`,
  `hidden`, `image`, `reset`, then not editable.
- Given a text input that is `disabled`, `readOnly` or `ariaDisabled`, then not editable with
  that reason; given a `readOnly` textarea, then `readonly`.
- Given `textarea`, `select`, `embed`, `object` (any case), then editable.
- Given a `div` with `isContentEditable`, then `contenteditable`; with `isContentEditable: false`
  and `contentEditable: "true"`, then not (the computed property wins); without
  `isContentEditable` and `contentEditable` `"true"` / `""` / `"plaintext-only"`, then editable;
  `"false"`, `"inherit"`, then not.
- Given a `div` with role `textbox`, `searchbox`, `combobox`, `spinbutton`, `application`,
  `TextBox`, `"textbox foo"`, then editable; with `ariaReadOnly`, then `aria-readonly`; role
  `button`, `listbox`, then `none`.
- Given a `div` inside each `KNOWN_EDITORS` class, then `editor:<name>`; `monaco-editorx` does
  not match; a read-only textarea inside Monaco is `readonly` (rule 6 comes first).
- Given `designMode`, a `body`, then `design-mode`; site `never` beats `designMode`; site
  `always` makes a `div` editable; site `auto` changes nothing.
- `matchSiteRule`: exact host, subdomain, not `badexample.com`, longest match wins, first on tie,
  case-insensitive, trailing dot, no match → `undefined`.

Hints:

- Given 0, 1, 9 targets and the default chars, then `[]`, `["a"]`, the nine characters.
- Given 10 targets, then 8 one-letter labels `a…k` and `la`, `ls`; given 12, `la ls ld lf`.
- Given 81 targets, then all two-letter labels; 82 → three-letter labels appear, 80 two-letter.
- Property (n ∈ 0…2000, charsets of 2–12 characters): exactly `n` labels; unique; prefix-free;
  every character from the charset; lengths ∈ {L−1, L} with `L = ⌈log_k n⌉`; minimal: the
  Kraft sum `Σ k^(L−|ℓ|)` ≤ `k^L`, and making one more label short would exceed it; ordered by
  length then charset order; `hintLabels(n)` is deterministic.
- Charset `"a"`, `"aa"`, `"aB"`, `"a "`, `""` → `bad-charset`; `n = -1`, `1.5` → `bad-count`.
- `orderTargets`: a 3 × 3 grid shuffled reads row by row; links on one text line with tops 100,
  102, 98 and heights 16 stay one row left to right; a target 9 px lower (more than half a
  16 px line) starts a new row; extra fields pass through. Property: a permutation of the input,
  invariant under shuffling the input (as rects).
- Given 12 targets with `hint.follow`, when `l` then `s`, then `narrow` with 4 visible, then
  `select` with the second `l…` target and `action: "hint.follow"`.
- Given `F`'s action, the select carries `hint.follow_new_tab`. An unknown action →
  `HintError("bad-action")`.
- Given typed `l`, when `Backspace`, then `typed` is empty and 12 visible; when `Backspace` with
  nothing typed, then `ignored`.
- When `z`, `ctrl+a`, `1`, `enter`, then `ignored` and the state unchanged; when `x` after `l`
  where no `lx` exists, then `ignored`.
- When `shift+a`, then selects `a` (caps lock); when `Esc`, then `cancel`; `shift+esc` is
  `ignored`.
- `HINT_ACTIONS` are action ids in `actions.mjs`.

Command line:

- `tokenize`: plain words; `"a  b"`; single quotes are literal (`'a \ "b'`); `"say \"hi\""`;
  `"back\\slash"`; `"\n"` stays `\n`; `"" ''` are two empty tokens;
  `"open` → `unterminated-quote` with its column; adjacent quoted and bare text joins (`a"b c"`
  → `ab c`).
- Each `COMMANDS` row parses: `:tabnew`, `tabnew https://x`, `:tabrename "my tab"`, `:q`,
  `:quit`, `:vs`, `:sp`, `:wsnext`, `:wsprev`, `:workspace`, `:workspace work`, `:ls`,
  `:sidebar`, `:map`, `:source`, `:open example.com`.
- `:open` → `missing-argument`; `:q now`, `:map j k` → `unexpected-argument`.
- `:scroll_down`, `:tab.next`, `:select_tab_3`, `:prev_workspace` → their actions;
  `:scroll_down 3` → `unexpected-argument`; `:tab.goto` (ambiguous id) → `unknown-command`.
- `:tabr x`, `:wsn` → unique-prefix commands; `:ws` → `ambiguous-command` listing `wsnext`,
  `wsprev` (`workspace` does not start with `ws`); `:tabnwe` → `unknown-command` suggesting `tabnew`.
- `""`, `":"`, `"  :  "` → `empty`.
- Every command maps to an action in `actions.mjs` or in `PENDING_ACTIONS`, which equals
  `["page.open", "workspace.switch"]` and has no overlap with `actions.mjs`.
- Completion: `tab` → `tabnew`, `tabrename` first, then actions; `wsp` → `wsprev`; fuzzy `scd`
  → `scroll_down` before `scroll_half_down`; `""` → every command then every action, cut at
  `limit`; `tabnew x` → `[]`; each candidate has a description.
- History: push dedupes to newest, drops empty, honours `limit`; Up/Down walk with the draft
  restored; prefix-filtered Up; no wrap at the oldest; Down with no cursor returns `current`;
  reset clears the cursor.

Esc:

- One `test.each` row per line of the table above, with and without `pending`, `previous`
  defaulting to `normal`.
- For every mode whose Esc result is an action, the default keymap binds `<Esc>` in that mode to
  the same action id. An unknown mode throws.

Coverage ≥ 90 % lines, branches, functions on `packages/vimma-core` (vendor excluded).

## Out of scope

- The content actor, `focusin` tracking, building descriptors, shadow DOM and frame traversal,
  hint rendering and target collection, the command-line UI: the M1 host specs.
- Config keys for `[[insert.sites]]` and `hint_chars` (shape only here; wiring with the next
  config schema version and migration).
- Hint text filtering (typing link text), hint rotation, yank-link and focus-input hints.
- Argument completion (workspace names, URLs from history), `:set`, `:bug`, counts and ranges.

## docs/guide.md

Unchanged: nothing here is reachable by a user until the host specs wire it. Each host spec
updates the guide for what it makes visible (insert mode, `f` / `F`, `:`, `Esc`).

## Settled (2026-10-09)

**Editable heuristics: our own rules, informed by Vimium and Tridactyl; no code copied.**
Sources read at these commits:

- Vimium (MIT), `lib/dom_utils.js` (`isSelectable`, `isEditable`, `isEmbed`, `isFocusable`) and
  `content_scripts/mode_insert.js` (`getActiveElement` through shadow roots, blur on exit),
  philc/vimium@5aa29614bf1dce05e0d316f8c38722e17f9b38c3.
- Tridactyl (Apache-2.0), `src/lib/dom.ts` (`isTextEditable`, `isEditableHTMLInput`) and
  `src/content/hinting.ts` (`hintnames_short`),
  tridactyl/tridactyl@6a84f6f4fa71bd0ab84539c619f7b79fa241c63a.

| Question                   | Vimium                                                                                 | Tridactyl                                                   | vimma                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<input>` types            | deny list (button checkbox color file hidden image radio reset submit); unknown = text | allow list (text search email url number password date tel) | Vimium's deny list plus `range` (it takes no characters): unknown types are text in browsers, so a deny list stays right as types are added        |
| `readOnly`, `disabled`     | not checked                                                                            | `readOnly`, disabled input, `aria-disabled` on an ancestor  | all three (Tridactyl), checked before everything else                                                                                              |
| `select`, `embed`/`object` | editable / focusable                                                                   | `select`, `object` editable                                 | editable (they take keys)                                                                                                                          |
| contenteditable            | `isContentEditable`                                                                    | `isContentEditable`                                         | the computed property, attribute only as a fallback                                                                                                |
| ARIA                       | none                                                                                   | `role=application`, `combobox`, `listbox`, `option` widgets | `textbox searchbox combobox spinbutton application`; `listbox` / `option` are arrow-key widgets that leave letters free; `aria-readonly` respected |
| `designMode`               | via `body.isContentEditable`                                                           | via `isContentEditable`                                     | explicit flag (some engines do not reflect it on `body`)                                                                                           |
| code editors               | via their textarea / contenteditable                                                   | same                                                        | same, plus class markers for their non-editable wrappers                                                                                           |

- Hint labels follow Vimium's breadth-first idea (shortest prefix-free labels; Vimium's
  `hintStrings` expands the queue front) but are computed in closed form and assigned in reading
  order without Vimium's reverse-and-sort scattering, so the first targets get the
  one-character labels. Neither project's code is used.
- `:q` maps to `pane.close`, not `tab.close`: in Vim `:q` closes a window and the last window
  closes the tab page; plan §2 lists `:q` for both rows.
- Commands return `text` beside `Action` rather than changing `Action` (dispatcher contract,
  plan §2) in a core-only spec.
