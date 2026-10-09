# Runbook

## Machine

- Dev box: 16 cores, 58 GiB RAM, 475 GB disk (230 GB free on 2026-10-09), Linux (Omarchy), Node 22.21, Python 3.

## First Firefox build (plan §10 step 3)

| Step                   | Date       | Result                                                                                                                                                                                                         |
| ---------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surfer setup-project` | 2026-10-09 | Firefox stable 157.0.1; name Vimma, binary `vimma`, app id `dev.vimma.browser`. The prompts were scripted; Surfer crashed after writing the config (import cycle), so `binaryName`/`appId` were fixed by hand. |
| `surfer download`      | 2026-10-09 | 753 s (12.5 min) incl. unpack and `git init` of `engine/`. `.surfer/` 774 MB, `engine/` 7.6 GB.                                                                                                                |
| `surfer bootstrap`     | 2026-10-09 | toolchains into `~/.mozbuild` (clang, cbindgen, …); no errors                                                                                                                                                  |
| `surfer build`         | 2026-10-09 | 2321 s (38.7 min) wall, CPU 75 %, on Ryzen AI 7 PRO 350 (16 threads), 58 GB RAM. `engine/` 22 GB after build.                                                                                                  |

`configs/common/mozconfig` still has `MOZ_SOURCE_REPO=https://github.com/example/example`; set it when the GitHub repo exists.

```sh
npx surfer setup-project   # interactive: name vimma, Firefox release
npx surfer download
npx surfer bootstrap
npx surfer build
npx surfer run
```

## Smoke check

```sh
engine/obj-x86_64-pc-linux-gnu/dist/bin/vimma --version   # "Mozilla vimma 1.0.0"
engine/obj-x86_64-pc-linux-gnu/dist/bin/vimma --headless --no-remote --profile "$(mktemp -d)" \
  --screenshot /tmp/shot.png "data:text/html,<h1>ok</h1>"
```

Known after first build (branding not done yet, brand defaults to `unofficial`): version string is
`Mozilla vimma 1.0.0`, and a fresh profile logs "Failed to import bookmarks from
chrome://browser/content/default-bookmarks.html". Both belong to the M0 branding task.
