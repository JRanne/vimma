# Runbook

## Machine

- Dev box: 16 cores, 58 GiB RAM, 475 GB disk (230 GB free on 2026-10-09), Linux (Omarchy), Node 22.21, Python 3.

## First Firefox build (plan §10 step 3)

Not yet run. Record here: Firefox version, `surfer download` time, `surfer build` wall time, disk used by `engine/`.

```sh
npx surfer setup-project   # interactive: name vimma, Firefox release
npx surfer download
npx surfer bootstrap
npx surfer build
npx surfer run
```
