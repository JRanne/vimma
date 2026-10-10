# ADR-003 (fixture for test_patch_audit.py: budgets and review dates)

## Patch register

| Patch                           | Hunks | Lines | Reviewed   | Why                             |
| ------------------------------- | ----- | ----- | ---------- | ------------------------------- |
| `src/browser/applied-txt.patch` | 1     | 2     | 2026-09-01 | Exactly at its budget.          |
| `src/browser/clean-txt.patch`   | 2     | 10    | 2026-10-01 | Under its budget.               |
| `src/browser/missing-txt.patch` | 1     | 2     | 2026-07-10 | Reviewed 92 days before today.  |
| `src/browser/offset-txt.patch`  | 1     | 2     | 2026-07-09 | Reviewed 93 days before today.  |
| `src/toolkit/failed-txt.patch`  | 2     | 4     | 2026-01-01 | Within budget, long unreviewed. |
| `src/toolkit/fuzz-txt.patch`    | 1     | 2     | 2026-10-10 | Reviewed today.                 |
