# EMA Leads Funnel — Test Results

## Run metadata

| Field | Value |
|---|---|
| Date / time | <ISO timestamp> |
| Environment | dev (localhost:80 proxy) / staging / prod-like |
| Suite | smoke (`--grep @smoke`) / full regression |
| Command | `pnpm exec playwright test` (from `tests/`) |
| Git ref | <branch @ short SHA> |
| Runner | <who/what triggered> |

## Summary

| Metric | Count |
|---|---|
| Total | |
| Passed | |
| Failed | |
| Expected failures (known defects) | |
| Blocked / fixme (skipped) | |
| Flaky (passed on retry) | |
| Duration | |

## Per-scope results

| Scope | Passed | Failed | Blocked | Notes |
|---|---|---|---|---|
| A. Lead capture | | | | |
| B. Qualification | | | | |
| C. Outreach | | | | |
| D. Conversion | | | | |
| E. Pipeline | | | | |
| F. Negative | | | | |
| G. RBAC | | | | |
| H. Audit | | | | |

## Failures

For each failure: test name, error excerpt, screenshot/trace path
(`tests/test-results/...`), and whether it maps to an existing defect
(`docs/leads-funnel-defect-log-template.md`) or a new one.

| Test | Error | Evidence | Defect |
|---|---|---|---|
| | | | |

## Artifacts

- HTML report: `tests/playwright-report/index.html`
  (`pnpm exec playwright show-report`)
- Screenshots / videos / traces (failures only): `tests/test-results/`

## Sign-off

| Role | Name | Verdict | Date |
|---|---|---|---|
| QA | | Pass / Fail | |
