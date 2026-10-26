# Edulab module

This repo is ONE module for the Edulab Bench platform. It installs per university site; the core handles which university, login, database, files and jobs. Write the module as if only one university exists.

## Architecture (how your module runs)
- **Bench** = one Node 24 / NestJS process that serves every university. It loads each installed module from its folder (`manifest.json` + `schema/` + `src/`). There is no separate server per module and no separate deploy.
- **Site** = one university at `<site>.<domain>` (the Host header picks the site). Each site has:
  - its own Postgres database `site_<site>`;
  - its own Keycloak realm `<site>`.
- **Control plane** (`admin.<domain>`, superadmin only):
  - creates a site (database, realm, portal client and admin user in about 2 s);
  - installs modules on a site, dependencies first.
- **Database of one site:**
  - `core.*` holds shared masters: student, college, programme, department, faculty, subject, academic_year, user, user_scope.
  - `<module>.*` holds each module's own tables.
  - `platform.*` holds installed modules, migration history, the audit log, the event outbox and the import id map.
  - Your code runs as the database role `s_<site>_<module>`. It can write only your own section and read `core`.
- **Login:** Keycloak realm roles are your manifest roles (`<module>:<role>`). A signed-in user is matched to a `core.user` row. `core.user_scope` limits a user to colleges, hostels or sections, and is what `scope` permissions use.
- **Generated for every entity** in `schema/*.json`, so never hand-write any of these:
  - the table and its migrations;
  - the REST API `/api/<module>/<entity>` (list, get, create, patch, delete), with permissions applied per row;
  - the screens `/m/<module>/<entity>` (list and form);
  - Data Import (CSV template, preview, per-row results);
  - change history when `trackChanges` is set.
- **Events:** a write emits `<module>.<entity>.created` etc. into `platform.outbox`. The core delivers each event at least once to every module that declares it in `listens` and registers `on(event, handler)` in `src/hooks.ts` (`import { on } from "@edulab/core"`). Handlers must be idempotent.
- **Money** is paise (integer) in the API, the database and CSV imports. Screens show and accept rupees.
- **Other modules:** link to them only through a declared `dependsOn` and their tables' ids, or react to their events. Never read their tables with SQL or import their code.

## Before writing anything
- Use the `edulab-module` skill for the exact formats (schema field types, `ctx` API, events, release checks). Don't guess formats.
- Copy the pattern of the existing files (`manifest.json`, `schema/*.json`). Don't read anything else to learn the contract.
- Full human guide (only if the skill doesn't answer it): docs/building-a-module.md (core data model: docs/core-entities.md)

## Layout
- `manifest.json` — name, version, dependsOn, roles, events, settings
- `schema/<entity>.json` — one per table; the core generates table, API, screens, permissions, migrations
- `fixtures/` default data · `src/hooks.ts` event handlers · `src/api/` extra endpoints · `src/jobs/` background jobs · `pages/` custom screens · `migrations/` data moves only · `import/` mappers from the old Edulab product (only if this module replaces one) · `tests/`
- `README.md` = marketplace page (fill every section) · `CHANGELOG.md` one entry per version

## Rules (review rejects violations)
1. New table = new `schema/*.json`. Never hand-write CREATE TABLE or CRUD endpoints.
2. Never touch another module's tables or import its code. Use `link` to `core.*`, events, or a dependency's published API.
3. Every entity has `permissions`; no permission = no access. `onlyOwn` = rows about the user themselves; `scope` = rows in the colleges/hostels/departments… assigned to the user. Never fake one with the other.
4. Names: tables live in this module's own database section (`<module>.<entity>`); roles `<module>:<role>`; events `<module>.<entity>.<past-verb>`.
5. Per-university values go in manifest `settings`, read via `ctx.settings`. Secrets are declared in manifest `secrets` and read via `ctx.secrets`. No secrets, university names or URLs in code.
6. Personal data fields get `"pii": true`. Money uses type `money`.
7. Everything re-runnable: install twice, handle each event twice → no change.
8. Every change: bump `version` (semver) + `CHANGELOG.md`; update `README.md` if roles/settings/events changed.
9. No dependency cycles. If A depends on B, B never listens to A; A calls B's API instead.
