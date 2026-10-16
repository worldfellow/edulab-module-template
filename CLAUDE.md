# Edulab module

This repo is ONE module for the Edulab Bench platform. It installs per university site; the core handles which university, login, database, files and jobs. Write the module as if only one university exists.

## Before writing anything
- Use the `edulab-module` skill for the exact formats (schema field types, `ctx` API, events, release checks). Don't guess formats.
- Copy the pattern of the existing files (`manifest.json`, `schema/*.json`). Don't read anything else to learn the contract.
- Full human guide (only if the skill doesn't answer it): https://github.com/worldfellow/edulab-bench/blob/main/docs/building-a-module.md

## Layout
- `manifest.json` — name, version, dependsOn, roles, events, settings
- `schema/<entity>.json` — one per table; the core generates table, API, screens, permissions, migrations
- `fixtures/` default data · `src/hooks.ts` event handlers · `src/api/` extra endpoints · `src/jobs/` background jobs · `pages/` custom screens · `migrations/` data moves only · `import/` mappers from the old Edulab product (only if this module replaces one) · `tests/`
- `README.md` = marketplace page (fill every section) · `CHANGELOG.md` one entry per version

## Rules (review rejects violations)
1. New table = new `schema/*.json`. Never hand-write CREATE TABLE or CRUD endpoints.
2. Never touch another module's tables or import its code. Use `link` to `core.*`, events, or a dependency's published API.
3. Every entity has `permissions`; no permission = no access.
4. Names: tables live in this module's own database section (`<module>.<entity>`); roles `<module>:<role>`; events `<module>.<entity>.<past-verb>`.
5. Per-university values go in manifest `settings`, read via `ctx.settings`. No secrets, university names or URLs in code.
6. Personal data fields get `"pii": true`. Money uses type `money`.
7. Everything re-runnable: install twice, handle each event twice → no change.
8. Every change: bump `version` (semver) + `CHANGELOG.md`; update `README.md` if roles/settings/events changed.
