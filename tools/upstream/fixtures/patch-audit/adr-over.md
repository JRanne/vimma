# ADR-003 (fixture for test_patch_audit.py: over budget, or no budget)

## Patch register

| Patch                           | Hunks | Lines | Reviewed   | Why                            |
| ------------------------------- | ----- | ----- | ---------- | ------------------------------ |
| `src/browser/applied-txt.patch` | 1     | 2     | 2026-10-01 | Within budget.                 |
| `src/browser/clean-txt.patch`   | 1     | 1     | 2026-10-01 | One changed line too many.     |
| `src/browser/missing-txt.patch` | 1     | 2     | 2026-10-01 | Within budget.                 |
| `src/browser/offset-txt.patch`  |       | 2     | 2026-10-01 | No hunk budget.                |
| `src/toolkit/failed-txt.patch`  | 1     | 4     | 2026-10-01 | One hunk too many.             |
| `src/toolkit/fuzz-txt.patch`    | 1     | 2     | soon       | A review date that is not one. |
