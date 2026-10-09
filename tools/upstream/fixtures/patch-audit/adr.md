# ADR-003 (fixture for test_patch_audit.py)

Prose that names `src/browser/offset-txt.patch` outside the table does not register it.

## Patch register

| Patch                          | Why                               |
| ------------------------------ | --------------------------------- |
| `src/browser/clean-txt.patch`  | Registered and present.           |
| `src/toolkit/failed-txt.patch` | Registered and present.           |
| `src/browser/gone.patch`       | Registered, but the file is gone. |

## Later section

| Patch                        | Not the register |
| ---------------------------- | ---------------- |
| `src/browser/fuzz-txt.patch` | ignored          |
