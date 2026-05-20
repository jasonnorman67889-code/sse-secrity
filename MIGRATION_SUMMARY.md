# Migration Summary

Date: 2026-05-20

## Repository Mapping

- Active project repository path: `sovereign-command-center-2`
- `origin`: `https://github.com/jasonnorman67889-code/sse-secrity.git`
- `upstream`: `git@github.com:rn890432-tech/sse-security-as-code.git`

## Migration Actions Completed

1. Repointed project `origin` to the new repository.
2. Preserved prior remote as `upstream`.
3. Pushed project history to new `origin/main`.
4. Synced current workspace state to new `origin/main`.
5. Added runtime artifact ignore rules and removed tracked runtime logs/caches.

## Backup Branches Created (root repository)

- `backup/root-before-align-20260520-060804`
- `backup/root-before-final-sync-20260520-061004`

## Post-Migration Validation

- `npm run lint` passes.
- `npm run check` passes.
- `npm run test:correlation` passes.

## CI Runbook

Use these commands from `sovereign-command-center-2` to validate quality gates locally before or after GitHub Actions:

```powershell
npm run lint
npm run check
npm run test:correlation
```

Expected outcomes:

- `lint`: Prettier check passes and ESLint reports no errors.
- `check`: Svelte type diagnostics report 0 errors and 0 warnings.
- `test:correlation`: Vitest correlation suites pass.

GitHub Actions workflow used by this project:

- `.github/workflows/sovereign-validation.yml`
- Workflow name: `Sovereign Validation`

## Notes

- `scripts/sql/correlation_schema.sql` is SQLite syntax. If SQL tooling is configured for T-SQL, editor diagnostics may show syntax errors even though the script is valid for SQLite.
